"""
Edge-TTS engine: uses Microsoft Edge's free neural TTS.

- Zero setup, no API key, no model download
- High quality Chinese/English/Japanese voices
- CPU only, works everywhere
- Requires internet connection
"""
import asyncio
import io
import logging
from typing import Optional

import edge_tts

from . import TTSEngine

log = logging.getLogger(__name__)

# Curated speaker list for common use cases
# Full list available via edge_tts.list_voices()
DEFAULT_SPEAKERS = {
    # Chinese
    "xiaoxiao": "zh-CN-XiaoxiaoNeural",
    "xiaoyi": "zh-CN-XiaoyiNeural",
    "yunjian": "zh-CN-YunjianNeural",
    "yunxi": "zh-CN-YunxiNeural",
    "yunxia": "zh-CN-YunxiaNeural",
    "yunyang": "zh-CN-YunyangNeural",
    # English
    "jenny": "en-US-JennyNeural",
    "aria": "en-US-AriaNeural",
    "guy": "en-US-GuyNeural",
    # Japanese
    "nanami": "ja-JP-NanamiNeural",
    "keita": "ja-JP-KeitaNeural",
}

# Language to default voice mapping
LANG_DEFAULT_VOICE = {
    "zh": "zh-CN-XiaoxiaoNeural",
    "en": "en-US-JennyNeural",
    "ja": "ja-JP-NanamiNeural",
}


def _detect_language(text: str) -> str:
    """Simple language detection based on character ranges."""
    for ch in text:
        if "\u4e00" <= ch <= "\u9fff":
            return "zh"
        if "\u3040" <= ch <= "\u30ff" or "\u31f0" <= ch <= "\u31ff":
            return "ja"
    return "en"


class EdgeTTSEngine(TTSEngine):
    def __init__(self, default_voice: str = "zh-CN-XiaoxiaoNeural",
                 rate: str = "+0%", volume: str = "+0%"):
        self._default_voice = default_voice
        self._rate = rate
        self._volume = volume
        self._voices_cache: Optional[list[dict]] = None

    @property
    def name(self) -> str:
        return "edge-tts"

    async def synthesize(self, text: str, speaker: str = "",
                         language: str = "Auto") -> bytes:
        # Resolve voice name
        voice = self._resolve_voice(text, speaker, language)
        log.info("Synthesizing with voice=%s, text=%s", voice, text[:60])

        communicate = edge_tts.Communicate(
            text=text, voice=voice, rate=self._rate, volume=self._volume
        )

        # Collect audio chunks into WAV-compatible bytes
        audio_chunks = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_chunks.append(chunk["data"])

        if not audio_chunks:
            raise RuntimeError("No audio data received from edge-tts")

        audio_data = b"".join(audio_chunks)
        log.info("Synthesized %d bytes of audio", len(audio_data))
        return audio_data

    def _resolve_voice(self, text: str, speaker: str, language: str) -> str:
        # If speaker is a known alias, use the mapping
        if speaker.lower() in DEFAULT_SPEAKERS:
            return DEFAULT_SPEAKERS[speaker.lower()]

        # If speaker looks like a full voice name (contains "Neural"), use directly
        if speaker and "Neural" in speaker:
            return speaker

        # Auto-detect language from text
        if language == "Auto" or not language:
            lang = _detect_language(text)
        else:
            lang = language[:2].lower()

        return LANG_DEFAULT_VOICE.get(lang, self._default_voice)

    async def list_speakers(self) -> list[dict]:
        if self._voices_cache is None:
            voices = await edge_tts.list_voices()
            self._voices_cache = [
                {
                    "name": v["ShortName"],
                    "display_name": v.get("FriendlyName", v["ShortName"]),
                    "language": v.get("Locale", ""),
                    "gender": v.get("Gender", ""),
                }
                for v in voices
            ]
        return self._voices_cache

    async def health_check(self) -> dict:
        try:
            # Quick test: synthesize a short text
            voices = await edge_tts.list_voices()
            return {"engine": self.name, "status": "ok",
                    "voices_count": len(voices)}
        except Exception as e:
            return {"engine": self.name, "status": "error", "error": str(e)}
