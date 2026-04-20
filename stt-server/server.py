"""
Hiyori STT Server — faster-whisper + WebSocket

功能：
  - WebSocket 接收 PCM 16kHz 16bit mono 音频流
  - 使用 faster-whisper 进行语音转文字
  - 内置 VAD (Silero VAD via faster-whisper) 自动断句
  - 返回 JSON: { text, start, end, is_final, language }
  - HTTP /health 端点用于健康检查

启动: python server.py [--port 9890] [--model base] [--device auto] [--language zh]

协议：
  WebSocket 二进制帧 = PCM s16le 16kHz mono 原始数据
  WebSocket 文本帧   = JSON 控制指令 { "cmd": "start" | "stop" | "config", ... }
  服务端文本帧       = JSON { "text", "start", "end", "is_final", "language" }
"""

import argparse
import asyncio
import json
import logging
import signal
import sys
import time
from pathlib import Path

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("stt-server")

# ── 全局状态 ──────────────────────────────────────────────────────

model = None          # faster_whisper.WhisperModel
model_lock = asyncio.Lock()
server_config = {
    "model_size": "base",
    "device": "auto",
    "compute_type": "default",
    "language": "zh",
    "port": 9890,
    "vad_threshold": 0.5,
    "beam_size": 5,
}

# ── 模型管理 ──────────────────────────────────────────────────────

def detect_device():
    """检测最佳推理设备"""
    try:
        import torch
        if torch.cuda.is_available():
            vram = torch.cuda.get_device_properties(0).total_mem / (1024**3)
            logger.info(f"CUDA available: {torch.cuda.get_device_name(0)} ({vram:.1f} GB)")
            return "cuda", "float16"
        else:
            logger.info("CUDA not available, using CPU")
    except ImportError:
        logger.info("torch not installed, using CPU with int8")
    return "cpu", "int8"


def load_model():
    """加载 faster-whisper 模型"""
    global model
    from faster_whisper import WhisperModel

    device = server_config["device"]
    compute_type = server_config["compute_type"]

    if device == "auto":
        device, compute_type = detect_device()

    logger.info(f"Loading model: {server_config['model_size']} on {device} ({compute_type})")

    model = WhisperModel(
        server_config["model_size"],
        device=device,
        compute_type=compute_type,
    )
    logger.info("Model loaded successfully")


# ── VAD + 转写 ───────────────────────────────────────────────────

class AudioBuffer:
    """
    累积 PCM 音频并在检测到语音停顿时触发转写。
    使用 faster-whisper 内置的 Silero VAD。
    """

    def __init__(self):
        self.buffer = bytearray()
        self.sample_rate = 16000
        self.bytes_per_sample = 2  # s16le
        # 静音检测：连续 N 秒静音后触发转写
        self.silence_threshold_sec = 0.8
        self.min_audio_sec = 0.5      # 最短音频，太短的丢弃
        self.max_audio_sec = 30.0     # 最长音频，防止内存爆炸
        self.last_voice_time = time.time()
        self.has_voice = False
        # 简单能量 VAD
        self.energy_threshold = 500

    def feed(self, pcm_bytes: bytes) -> bytes | None:
        """
        喂入 PCM 数据，如果检测到语句结束则返回完整音频 bytes，否则返回 None。
        """
        self.buffer.extend(pcm_bytes)

        # 计算当前块的 RMS 能量
        samples = np.frombuffer(pcm_bytes, dtype=np.int16)
        if len(samples) == 0:
            return None

        rms = np.sqrt(np.mean(samples.astype(np.float32) ** 2))

        now = time.time()

        if rms > self.energy_threshold:
            self.has_voice = True
            self.last_voice_time = now

        duration = len(self.buffer) / (self.sample_rate * self.bytes_per_sample)

        # 超过最大长度，强制切断
        if duration >= self.max_audio_sec:
            return self._flush()

        # 有语音且静音超过阈值，触发转写
        if self.has_voice and (now - self.last_voice_time) >= self.silence_threshold_sec:
            if duration >= self.min_audio_sec:
                return self._flush()

        return None

    def _flush(self) -> bytes | None:
        if len(self.buffer) == 0:
            return None
        data = bytes(self.buffer)
        self.buffer.clear()
        self.has_voice = False
        self.last_voice_time = time.time()
        return data

    def force_flush(self) -> bytes | None:
        """强制输出当前缓冲区（停止时使用）"""
        if len(self.buffer) > self.min_audio_sec * self.sample_rate * self.bytes_per_sample:
            return self._flush()
        self.buffer.clear()
        self.has_voice = False
        return None


async def transcribe(audio_bytes: bytes) -> dict | None:
    """对一段完整音频进行转写"""
    global model
    if model is None:
        return None

    # bytes → float32 numpy array
    samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    if len(samples) < 1600:  # < 0.1s
        return None

    async with model_lock:
        try:
            segments, info = model.transcribe(
                samples,
                beam_size=server_config["beam_size"],
                language=server_config["language"],
                vad_filter=True,
                vad_parameters=dict(
                    threshold=server_config["vad_threshold"],
                    min_silence_duration_ms=500,
                ),
            )

            texts = []
            seg_start = None
            seg_end = 0.0

            for seg in segments:
                text = seg.text.strip()
                if text:
                    texts.append(text)
                    if seg_start is None:
                        seg_start = seg.start
                    seg_end = seg.end

            if not texts:
                return None

            full_text = "".join(texts)

            return {
                "text": full_text,
                "start": round(seg_start or 0, 2),
                "end": round(seg_end, 2),
                "is_final": True,
                "language": info.language,
            }

        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return None


# ── WebSocket 处理 ────────────────────────────────────────────────

async def handle_client(websocket):
    """处理单个 WebSocket 客户端连接"""
    logger.info(f"Client connected: {websocket.remote_address}")
    audio_buf = AudioBuffer()
    is_listening = True

    try:
        async for message in websocket:
            # 文本帧 = JSON 控制指令
            if isinstance(message, str):
                try:
                    cmd = json.loads(message)
                    action = cmd.get("cmd", "")

                    if action == "stop":
                        is_listening = False
                        # 强制输出剩余音频
                        remaining = audio_buf.force_flush()
                        if remaining:
                            result = await transcribe(remaining)
                            if result:
                                await websocket.send(json.dumps(result, ensure_ascii=False))
                        await websocket.send(json.dumps({"cmd": "stopped"}))
                        logger.info("Client requested stop")

                    elif action == "start":
                        is_listening = True
                        audio_buf = AudioBuffer()
                        await websocket.send(json.dumps({"cmd": "started"}))
                        logger.info("Client requested start")

                    elif action == "config":
                        # 运行时更新配置（如切换语言）
                        if "language" in cmd:
                            server_config["language"] = cmd["language"]
                        await websocket.send(json.dumps({"cmd": "config_updated"}))

                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON: {message[:100]}")
                continue

            # 二进制帧 = PCM 音频数据
            if not is_listening:
                continue

            audio_data = audio_buf.feed(message)
            if audio_data:
                result = await transcribe(audio_data)
                if result:
                    await websocket.send(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        # websockets.exceptions.ConnectionClosed 等
        logger.info(f"Client disconnected: {websocket.remote_address} ({type(e).__name__})")


# ── HTTP 健康检查 ─────────────────────────────────────────────────

# websockets 13+ 改变了 process_request API：
#   旧版 (<=12): process_request(path, headers) -> (status, headers, body) | None
#   新版 (>=13): process_request(connection, request) -> Response | None
# 需要在运行时检测版本并适配。

try:
    from websockets.http11 import Response as _WsResponse
    from websockets.datastructures import Headers as _WsHeaders
    _NEW_WS_API = True
except ImportError:
    _NEW_WS_API = False


def _health_body() -> bytes:
    return json.dumps({"status": "ok", "model": server_config["model_size"]}).encode()


if _NEW_WS_API:
    async def health_handler(connection, request):
        """websockets >= 13: process_request(connection, request) -> Response | None"""
        if request.path == "/health":
            body = _health_body()
            headers = _WsHeaders([("Content-Type", "application/json"), ("Content-Length", str(len(body)))])
            return _WsResponse(200, "OK", headers, body)
        return None
else:
    async def health_handler(path, request_headers):
        """websockets <= 12: process_request(path, headers) -> (status, headers, body) | None"""
        if path == "/health" or path == "/health/":
            return (200, [("Content-Type", "application/json")], _health_body())
        return None


# ── 主入口 ────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Hiyori STT Server")
    parser.add_argument("--port", type=int, default=9890, help="WebSocket 端口 (default: 9890)")
    parser.add_argument("--model", type=str, default="base", help="Whisper 模型 (tiny/base/small/medium/large-v3)")
    parser.add_argument("--device", type=str, default="auto", help="推理设备 (auto/cpu/cuda)")
    parser.add_argument("--language", type=str, default="zh", help="默认语言 (zh/en/ja/...)")
    parser.add_argument("--beam-size", type=int, default=5, help="Beam size")
    args = parser.parse_args()

    server_config["port"] = args.port
    server_config["model_size"] = args.model
    server_config["device"] = args.device
    server_config["language"] = args.language
    server_config["beam_size"] = args.beam_size

    # 加载模型
    load_model()

    import websockets

    logger.info(f"Starting STT WebSocket server on ws://127.0.0.1:{args.port}")

    stop_event = asyncio.Event()

    # 优雅关闭
    def _signal_handler():
        logger.info("Shutting down...")
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _signal_handler)
        except NotImplementedError:
            # Windows 不支持 add_signal_handler
            signal.signal(sig, lambda s, f: _signal_handler())

    async with websockets.serve(
        handle_client,
        "127.0.0.1",
        args.port,
        process_request=health_handler,
        max_size=2**20,  # 1MB max frame
        ping_interval=30,
        ping_timeout=10,
    ):
        logger.info(f"Uvicorn running on ws://127.0.0.1:{args.port}")
        logger.info("Application startup complete")
        await stop_event.wait()


if __name__ == "__main__":
    asyncio.run(main())
