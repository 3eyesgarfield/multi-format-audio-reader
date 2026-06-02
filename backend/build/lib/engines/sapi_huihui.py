"""Windows SAPI5 engine (Microsoft Huihui zh-CN and any other installed voice).

Zero-config fallback that always works on Windows. Synthesizes into an in-memory
stream as 22kHz/16bit/mono PCM, then wraps it in a WAV container.
"""
from __future__ import annotations

import gc
import io
import wave

from .base import TTSEngine, Voice, mult_to_sapi_rate

# SpeechAudioFormatType.SAFT22kHz16BitMono
_SAFT_22K_16_MONO = 22
_SAMPLE_RATE = 22050
_SAMPLE_WIDTH = 2  # bytes (16-bit)
_CHANNELS = 1


def _culture_to_lang(culture: str) -> str:
    c = (culture or "").lower()
    if c.startswith("zh"):
        return "zh"
    if c.startswith("en"):
        return "en"
    if c.startswith("ja"):
        return "ja"
    return c.split("-")[0] if c else ""


class SapiEngine(TTSEngine):
    name = "sapi"

    def __init__(self) -> None:
        self._ok: bool | None = None

    def available(self) -> bool:
        if self._ok is None:
            try:
                import win32com.client  # noqa: F401
                self._ok = True
            except Exception:
                self._ok = False
        return self._ok

    def list_voices(self) -> list[Voice]:
        if not self.available():
            return []
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            out: list[Voice] = []
            for tok in speaker.GetVoices():
                name = tok.GetAttribute("Name")
                try:
                    lang_id = tok.GetAttribute("Language")  # hex LCID list
                except Exception:
                    lang_id = ""
                try:
                    gender = tok.GetAttribute("Gender").lower()
                except Exception:
                    gender = ""
                # Prefer the human name; derive lang from the name when possible.
                lang = "zh" if "huihui" in name.lower() else (
                    "ja" if "haruka" in name.lower() else "en")
                out.append(Voice(
                    id=f"sapi:{name}",
                    engine="sapi",
                    name=name,
                    lang=lang,
                    gender=gender,
                ))
            return out
        finally:
            # release COM wrappers before tearing down the apartment to avoid
            # "Win32 exception releasing IUnknown" noise at GC time
            speaker = None  # type: ignore[assignment]
            gc.collect()
            pythoncom.CoUninitialize()

    def synth(self, text: str, voice: str, rate: float = 1.0,
              pitch: float = 0.0) -> tuple[bytes, str]:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            speaker = win32com.client.Dispatch("SAPI.SpVoice")

            # Select the requested voice by display name.
            target = voice.split("sapi:", 1)[-1] if voice else ""
            if target:
                for tok in speaker.GetVoices():
                    if tok.GetAttribute("Name") == target:
                        speaker.Voice = tok
                        break

            speaker.Rate = mult_to_sapi_rate(rate)

            stream = win32com.client.Dispatch("SAPI.SpMemoryStream")
            fmt = win32com.client.Dispatch("SAPI.SpAudioFormat")
            fmt.Type = _SAFT_22K_16_MONO
            stream.Format = fmt
            speaker.AudioOutputStream = stream

            # Pitch via inline XML (SAPI accepts -10..10 absolute pitch).
            if pitch:
                p = max(-10, min(10, int(round(pitch))))
                speaker.Speak(f"<pitch absmiddle='{p}'/>{text}")
            else:
                speaker.Speak(text)

            raw = bytes(stream.GetData())
        finally:
            speaker = None  # type: ignore[assignment]
            stream = None  # type: ignore[assignment]
            fmt = None  # type: ignore[assignment]
            gc.collect()
            pythoncom.CoUninitialize()

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(_CHANNELS)
            wf.setsampwidth(_SAMPLE_WIDTH)
            wf.setframerate(_SAMPLE_RATE)
            wf.writeframes(raw)
        return buf.getvalue(), "audio/wav"
