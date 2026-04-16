"""
Local TTS Server — 轻量级本地语音合成服务。

独立运行的 FastAPI 服务，与 live2d-pet 通过 HTTP API 通信。
不打包进 Electron，由用户按需安装启动。

当前引擎: edge-tts（零配置，免费，高质量）
后续可扩展: MOSS-TTS 等本地离线引擎（需单独验证后再接入）

API:
  POST /tts/generate  { text, speaker, language } → 音频流
  GET  /speakers      → 可用音色列表
  GET  /health        → 健康检查
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from engines import TTSEngine
from engines.edge_engine import EdgeTTSEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("tts-server")

# ── Config ───────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent / "config.yaml"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


def create_engine(config: dict) -> TTSEngine:
    edge_cfg = config.get("edge", {})
    return EdgeTTSEngine(
        default_voice=edge_cfg.get("default_voice", "zh-CN-XiaoxiaoNeural"),
        rate=edge_cfg.get("rate", "+0%"),
        volume=edge_cfg.get("volume", "+0%"),
    )


# ── App ──────────────────────────────────────────────────────────────

engine: Optional[TTSEngine] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    config = load_config()
    engine = create_engine(config)
    log.info("TTS server started with engine: %s", engine.name)
    yield
    log.info("TTS server shutting down")


app = FastAPI(
    title="Local TTS Server",
    description="轻量级本地语音合成服务",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request/Response Models ──────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str
    speaker: str = ""
    language: str = "Auto"


# ── Endpoints ────────────────────────────────────────────────────────

@app.post("/tts/generate")
async def tts_generate(req: TTSRequest):
    """Synthesize text to audio. Returns audio/mpeg stream."""
    if engine is None:
        raise HTTPException(status_code=503, detail="Engine not initialized")

    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is empty")

    if len(req.text) > 5000:
        raise HTTPException(status_code=400, detail="Text too long (max 5000 chars)")

    try:
        audio_bytes = await engine.synthesize(
            text=req.text.strip(),
            speaker=req.speaker,
            language=req.language,
        )
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Content-Disposition": 'inline; filename="tts.mp3"'},
        )
    except Exception as e:
        log.error("TTS synthesis failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/speakers")
async def list_speakers():
    """List available TTS voices/speakers."""
    if engine is None:
        raise HTTPException(status_code=503, detail="Engine not initialized")
    speakers = await engine.list_speakers()
    return {"speakers": speakers, "engine": engine.name}


@app.get("/health")
@app.get("/health/")
async def health():
    """Health check endpoint."""
    if engine is None:
        return {"status": "starting"}
    return await engine.health_check()


@app.get("/")
async def root():
    return {
        "service": "Local TTS Server",
        "engine": engine.name if engine else "starting",
        "endpoints": ["/tts/generate", "/speakers", "/health"],
    }


# ── Main ─────────────────────────────────────────────────────────────

def main():
    import uvicorn

    config = load_config()
    server_cfg = config.get("server", {})
    host = server_cfg.get("host", "127.0.0.1")
    port = server_cfg.get("port", 9880)

    log.info("Starting TTS server on %s:%d", host, port)
    uvicorn.run(
        "server:app",
        host=host,
        port=port,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    main()
