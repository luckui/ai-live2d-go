"""
TTS Engine base interface.
"""
from abc import ABC, abstractmethod
from typing import Optional


class TTSEngine(ABC):
    """Base class for all TTS engines."""

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    async def synthesize(
        self,
        text: str,
        speaker: str = "",
        language: str = "Auto",
    ) -> bytes:
        """Synthesize text to WAV audio bytes."""
        ...

    @abstractmethod
    async def list_speakers(self) -> list[dict]:
        """Return list of available speakers/voices."""
        ...

    async def health_check(self) -> dict:
        return {"engine": self.name, "status": "ok"}
