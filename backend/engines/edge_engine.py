"""Microsoft Edge online neural TTS (edge-tts).

Excellent zh/en quality, requires network. Returns MP3 bytes which the browser
decodes natively.
"""
from __future__ import annotations

import asyncio

from .base import TTSEngine, Voice, mult_to_edge_rate, pitch_to_edge

# Curated subset of the most useful zh-CN and en voices. The full catalogue is
# large; these cover the common bilingual reading needs.
_VOICES = [
    ("zh-CN-XiaoxiaoNeural", "晓晓 Xiaoxiao", "zh", "female"),
    ("zh-CN-XiaoyiNeural", "晓伊 Xiaoyi", "zh", "female"),
    ("zh-CN-YunxiNeural", "云希 Yunxi", "zh", "male"),
    ("zh-CN-YunjianNeural", "云健 Yunjian", "zh", "male"),
    ("zh-CN-YunyangNeural", "云扬 Yunyang", "zh", "male"),
    ("zh-CN-liaoning-XiaobeiNeural", "辽宁晓北 Xiaobei", "zh", "female"),
    ("en-US-AriaNeural", "Aria", "en", "female"),
    ("en-US-JennyNeural", "Jenny", "en", "female"),
    ("en-US-GuyNeural", "Guy", "en", "male"),
    ("en-GB-SoniaNeural", "Sonia (UK)", "en", "female"),
    ("en-GB-RyanNeural", "Ryan (UK)", "en", "male"),
]


class EdgeEngine(TTSEngine):
    name = "edge"

    def __init__(self) -> None:
        self._ok: bool | None = None

    def available(self) -> bool:
        if self._ok is None:
            try:
                import edge_tts  # noqa: F401
                self._ok = True
            except Exception:
                self._ok = False
        return self._ok

    def list_voices(self) -> list[Voice]:
        if not self.available():
            return []
        return [
            Voice(id=f"edge:{vid}", engine="edge", name=name, lang=lang, gender=gender)
            for vid, name, lang, gender in _VOICES
        ]

    def synth(self, text: str, voice: str, rate: float = 1.0,
              pitch: float = 0.0) -> tuple[bytes, str]:
        import edge_tts

        vid = voice.split("edge:", 1)[-1] if voice else "zh-CN-XiaoxiaoNeural"

        async def _run() -> bytes:
            comm = edge_tts.Communicate(
                text, vid,
                rate=mult_to_edge_rate(rate),
                pitch=pitch_to_edge(pitch),
            )
            data = bytearray()
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    data.extend(chunk["data"])
            return bytes(data)

        audio = asyncio.run(_run())
        return audio, "audio/mpeg"
