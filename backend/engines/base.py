"""TTS engine abstraction.

Every engine implements `available()`, `list_voices()` and `synth()`.
`synth` returns `(audio_bytes, mime_type)` so engines can return either WAV or MP3.

Rate is a *multiplier* at the API level (1.0 = normal, 0.5 = half speed, 3.0 = 3x).
Each engine maps that multiplier onto its own native rate scale.
Pitch is a semitone-ish offset, default 0.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from typing import Literal


@dataclass
class Voice:
    id: str            # unique id used by the frontend, e.g. "sapi:Microsoft Huihui Desktop"
    engine: str        # "sapi" | "kokoro" | "edge"
    name: str          # human readable
    lang: str          # "zh" | "en" | "ja" | ...
    gender: str = ""   # "female" | "male" | ""

    def to_dict(self) -> dict:
        return asdict(self)


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def mult_to_sapi_rate(mult: float) -> int:
    """SAPI rate is -10..10 and is roughly exponential (~1.5x per ~4 steps).
    Map a speed multiplier onto that scale so 3x -> +10, 1/3x -> -10."""
    if mult <= 0:
        return 0
    rate = 10.0 * math.log(mult) / math.log(3.0)
    return int(round(clamp(rate, -10, 10)))


def mult_to_edge_rate(mult: float) -> str:
    """edge-tts wants a percentage string like '+50%' / '-25%'."""
    pct = int(round((mult - 1.0) * 100))
    return f"{pct:+d}%"


def pitch_to_edge(pitch: float) -> str:
    """edge-tts pitch is an Hz offset string like '+10Hz'."""
    hz = int(round(pitch * 5))  # ~5 Hz per semitone, good enough
    return f"{hz:+d}Hz"


class TTSEngine:
    name: str = "base"

    def available(self) -> bool:  # pragma: no cover - interface
        return False

    def list_voices(self) -> list[Voice]:  # pragma: no cover - interface
        return []

    def synth(self, text: str, voice: str, rate: float = 1.0,
              pitch: float = 0.0) -> tuple[bytes, str]:  # pragma: no cover
        raise NotImplementedError
