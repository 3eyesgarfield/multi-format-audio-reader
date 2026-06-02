"""Kokoro local neural TTS (82M params, bilingual zh/en, GPU accelerated).

Lazily builds one KPipeline per language code ('z' Mandarin, 'a' American English,
'b' British English) and caches them. Returns 24kHz WAV bytes.

Requires: kokoro, misaki[zh], soundfile, torch (cu128 for Blackwell GPUs).
The engine degrades gracefully to unavailable if those aren't installed yet, so
the app still works with the SAPI + Edge engines.
"""
from __future__ import annotations

import io

from .base import TTSEngine, Voice, clamp

_SAMPLE_RATE = 24000

# Curated Kokoro voices. First letter of the voice id encodes the language pack.
_VOICES = [
    # Chinese (lang_code 'z')
    ("zf_xiaobei", "晓贝 Xiaobei", "zh", "female"),
    ("zf_xiaoni", "晓妮 Xiaoni", "zh", "female"),
    ("zf_xiaoxiao", "晓晓 Xiaoxiao", "zh", "female"),
    ("zf_xiaoyi", "晓伊 Xiaoyi", "zh", "female"),
    ("zm_yunjian", "云健 Yunjian", "zh", "male"),
    ("zm_yunxi", "云希 Yunxi", "zh", "male"),
    ("zm_yunyang", "云扬 Yunyang", "zh", "male"),
    # American English (lang_code 'a')
    ("af_heart", "Heart", "en", "female"),
    ("af_bella", "Bella", "en", "female"),
    ("af_nicole", "Nicole", "en", "female"),
    ("am_michael", "Michael", "en", "male"),
    ("am_fenrir", "Fenrir", "en", "male"),
    # British English (lang_code 'b')
    ("bf_emma", "Emma (UK)", "en", "female"),
    ("bm_george", "George (UK)", "en", "male"),
]


def _lang_code(voice_id: str) -> str:
    first = voice_id[:1]
    return first if first in ("z", "a", "b") else "a"


class KokoroEngine(TTSEngine):
    name = "kokoro"

    def __init__(self) -> None:
        self._ok: bool | None = None
        self._pipelines: dict[str, object] = {}
        self._device: str | None = None

    def available(self) -> bool:
        if self._ok is None:
            try:
                import kokoro  # noqa: F401
                import soundfile  # noqa: F401
                self._ok = True
            except Exception:
                self._ok = False
        return self._ok

    @property
    def device(self) -> str:
        if self._device is None:
            try:
                import torch
                self._device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                self._device = "cpu"
        return self._device

    def _pipeline(self, lang: str):
        if lang not in self._pipelines:
            from kokoro import KPipeline
            try:
                self._pipelines[lang] = KPipeline(lang_code=lang, device=self.device)
            except Exception:
                # GPU init failed (driver mismatch / unsupported card) -> fall back to CPU
                self._device = "cpu"
                self._pipelines[lang] = KPipeline(lang_code=lang, device="cpu")
        return self._pipelines[lang]

    def list_voices(self) -> list[Voice]:
        if not self.available():
            return []
        return [
            Voice(id=f"kokoro:{vid}", engine="kokoro", name=name, lang=lang, gender=gender)
            for vid, name, lang, gender in _VOICES
        ]

    def synth(self, text: str, voice: str, rate: float = 1.0,
              pitch: float = 0.0) -> tuple[bytes, str]:
        import numpy as np
        import soundfile as sf

        vid = voice.split("kokoro:", 1)[-1] if voice else "zf_xiaoxiao"
        pipeline = self._pipeline(_lang_code(vid))
        speed = clamp(rate, 0.5, 2.0)

        chunks = []
        for _, _, audio in pipeline(text, voice=vid, speed=speed):
            if hasattr(audio, "detach"):  # torch tensor
                audio = audio.detach().cpu().numpy()
            chunks.append(np.asarray(audio, dtype=np.float32))

        if not chunks:
            audio = np.zeros(1, dtype=np.float32)
        else:
            audio = np.concatenate(chunks)

        buf = io.BytesIO()
        sf.write(buf, audio, _SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return buf.getvalue(), "audio/wav"
