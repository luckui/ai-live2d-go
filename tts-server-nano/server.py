"""
MOSS-TTS-Nano Adapter Server

将 MOSS-TTS-Nano 的 NanoTTSService 包装为标准 /tts/generate API。
speaker 名称映射到 voices/ 目录下的参考音频文件。

API:
  POST /tts/generate  { text, speaker, language } → audio/wav 流
  GET  /speakers      → 可用音色列表
  GET  /health        → 健康检查
"""

import asyncio
import io
import logging
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("nano-tts-adapter")

VOICES_DIR = Path(__file__).parent / "voices"

# ── Voice name → (audio file, description) ──────────────────────────

VOICE_MAP: dict[str, tuple[str, str]] = {
    # ── 中文 ──
    # zh_1.wav  — demo: "欢迎关注模思智能" 男声
    # zh_3.wav  — demo: "京味胡同闲聊" 北京大爷口吻，明确男声
    # zh_4.wav  — demo: "台湾腔" 偏活泼，女声
    # zh_6.wav  — demo: "深夜温柔晚安" 温柔，女声
    # zh_10.wav — demo: "中国人的时间观念与文化逻辑" 讲座风格，男声
    # zh_11.wav — demo: "杨幂 - 与自己同行" 杨幂，女声
    "Junhao":   ("zh_1.wav",       "中文男声 · 知性"),
    "Laobei":   ("zh_3.wav",       "中文男声 · 京味"),
    "Jiangshi": ("zh_10.wav",      "中文男声 · 讲坛"),
    "Xiaoyu":   ("zh_4.wav",       "中文女声 · 台湾腔"),
    "Wanan":    ("zh_6.wav",       "中文女声 · 温柔"),
    "Yangmi":   ("zh_11.wav",      "中文女声 · 杨幂"),
    # ── 英文 ──
    # en_2.wav  — demo: "The Bitter Lesson" 学术腔，男声
    # en_3.wav  — demo: "A Gentle Reminder" 温柔短文，女声
    # en_4.wav  — demo: "English News" 新闻播报，男声
    # en_6.wav  — demo: "Welcome to OpenMOSS" 介绍，男声
    # en_7.wav  — demo: "Taylor Swift" 演讲，女声
    # en_8.wav  — demo: "The Quiet Motion of the World" 文学叙述，男声
    "Ava":      ("en_3.wav",       "English F · Gentle"),
    "Taylor":   ("en_7.wav",       "English F · Taylor Swift"),
    "Adam":     ("en_4.wav",       "English M · News"),
    "Rich":     ("en_2.wav",       "English M · Academic"),
    "MOSS":     ("en_6.wav",       "English M · OpenMOSS"),
    "Narrator": ("en_8.wav",       "English M · Literary"),
    # ── 日文 ──
    # jp_2.wav  — demo: "ニュース" 新闻播报
    "Yui":      ("jp_2.wav",       "日本語 · ニュース"),
    # ── 自定义 ──
    "Hiyori":   ("hiyori-ch.wav",  "Hiyori カスタム"),
}


# ── 工具函数 ─────────────────────────────────────────────────────────

def waveform_to_wav(waveform: np.ndarray, sample_rate: int) -> bytes:
    """将 float32/int16 numpy 波形转换为 WAV bytes。"""
    if waveform.ndim > 1:
        # 取第一个通道
        waveform = waveform[0] if waveform.shape[0] <= waveform.shape[-1] else waveform[:, 0]
    if waveform.dtype in (np.float32, np.float64):
        pcm = (np.clip(waveform, -1.0, 1.0) * 32767).astype(np.int16)
    else:
        pcm = waveform.astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


# ── 本地模型路径（优先使用 download_models.py 下载到 models/ 的本地权重） ──

MODELS_DIR = Path(__file__).parent / "models"
LOCAL_TTS_MODEL = MODELS_DIR / "tts-nano"
LOCAL_AUDIO_TOKENIZER = MODELS_DIR / "audio-tokenizer-nano"


# ── FastAPI App ──────────────────────────────────────────────────────

runtime: Optional[object] = None  # NanoTTSService instance


@asynccontextmanager
async def lifespan(app: FastAPI):
    global runtime

    # 选择模型来源：本地 models/ 目录 > HuggingFace 缓存/远程下载
    checkpoint = str(LOCAL_TTS_MODEL) if LOCAL_TTS_MODEL.exists() else "OpenMOSS-Team/MOSS-TTS-Nano"
    audio_tok  = str(LOCAL_AUDIO_TOKENIZER) if LOCAL_AUDIO_TOKENIZER.exists() else "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano"
    log.info("模型来源: checkpoint=%s  audio_tokenizer=%s", checkpoint, audio_tok)

    from moss_tts_nano_runtime import NanoTTSService

    runtime = NanoTTSService(
        checkpoint_path=checkpoint,
        audio_tokenizer_path=audio_tok,
        device="cpu",
        dtype="auto",
        output_dir=str(Path(__file__).parent / "generated_audio"),
    )

    # 在启动阶段就把模型加载到内存，避免首次合成时超时
    log.info("预加载模型和音频编解码器…")
    info = await asyncio.to_thread(runtime.preload, load_model=True)
    log.info("MOSS-TTS-Nano 模型已全部加载完毕，服务就绪 %s", info)

    yield

    log.info("Shutting down nano-tts-adapter")
    runtime = None


app = FastAPI(
    title="MOSS-TTS-Nano Adapter",
    description="将 MOSS-TTS-Nano 包装为标准 /tts/generate API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request Model ────────────────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str
    speaker: str = "Junhao"
    language: str = "Auto"


# ── Endpoints ────────────────────────────────────────────────────────

@app.post("/tts/generate")
async def tts_generate(req: TTSRequest):
    """合成文本为音频。speaker 为预设名称或参考音频的绝对路径。"""
    if runtime is None:
        raise HTTPException(status_code=503, detail="模型尚未加载完成，请稍候")

    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="文本为空")

    if len(req.text) > 5000:
        raise HTTPException(status_code=400, detail="文本过长（最大 5000 字符）")

    # 解析 speaker → 参考音频路径
    speaker = req.speaker.strip()
    audio_file: Optional[Path] = None

    if speaker in VOICE_MAP:
        audio_file = VOICES_DIR / VOICE_MAP[speaker][0]
    else:
        # 尝试作为文件路径
        candidate = Path(speaker)
        if candidate.is_file():
            audio_file = candidate

    if audio_file is None or not audio_file.exists():
        available = ", ".join(sorted(VOICE_MAP.keys()))
        raise HTTPException(
            status_code=400,
            detail=f"未找到音色 '{speaker}'。可用预设: {available}",
        )

    try:
        # 在线程池中执行阻塞的合成操作，避免卡死事件循环（否则 /health 也会超时）
        text_len = len(req.text.strip())
        # 根据文本长度自适应帧数上限（约 12.5 帧/秒，每帧 ~80ms）
        # 短句给足余量，长句按比例放大，避免截断
        adaptive_frames = max(375, min(750, text_len * 15))

        def _synthesize():
            return runtime.synthesize(
                text=req.text.strip(),
                mode="voice_clone",
                voice=None,
                prompt_audio_path=str(audio_file),
                max_new_frames=adaptive_frames,
                voice_clone_max_text_tokens=150,     # 原 75 太小，长句被截断
                audio_temperature=0.7,                # 略降温度减少杂音
                audio_top_p=0.92,
                audio_repetition_penalty=1.3,         # 稍增重复惩罚，减少模糊重复
            )

        result = await asyncio.to_thread(_synthesize)

        wav_bytes = waveform_to_wav(result["waveform_numpy"], int(result["sample_rate"]))

        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": 'inline; filename="tts.wav"'},
        )
    except Exception as e:
        log.error("合成失败: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/speakers")
async def list_speakers():
    """列出可用音色。"""
    speakers = []
    for name, (file, desc) in VOICE_MAP.items():
        speakers.append({
            "name": name,
            "file": file,
            "description": desc,
            "available": (VOICES_DIR / file).exists(),
        })
    return {"speakers": speakers, "engine": "moss-tts-nano"}


@app.get("/health")
@app.get("/health/")
async def health():
    loaded = runtime is not None and runtime._model is not None
    return {"status": "ok" if loaded else "loading", "engine": "moss-tts-nano", "model_loaded": loaded}


# ── 入口 ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9881)
