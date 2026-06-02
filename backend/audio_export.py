"""Export a whole document (or chapter range) to an offline audiobook (mp3/wav).

Takes a list of segments, synthesizes each through the chosen engine, stitches the
audio together with short gaps, and writes a single file. Yields progress so the
endpoint can stream it to the UI.

Relies on pydub + ffmpeg (provided by imageio-ffmpeg) to decode the mixed
wav/mp3 engine outputs and to encode the final file.
"""
from __future__ import annotations

import io
import os
from typing import Callable, Iterator

SynthFn = Callable[[str, str, str, float], tuple[bytes, str]]  # (text, engine, voice, rate)


def _ensure_ffmpeg() -> None:
    """Point pydub at the ffmpeg binary shipped by imageio-ffmpeg."""
    try:
        from pydub import AudioSegment
        import imageio_ffmpeg
        AudioSegment.converter = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass  # fall back to a system ffmpeg if present


def export_segments(
    segments: list[dict],
    out_path: str,
    synth: SynthFn,
    gap_ms: int = 250,
    fmt: str = "mp3",
) -> Iterator[dict]:
    """segments: [{text, engine, voice, rate}]. Yields {done, total, path?}."""
    _ensure_ffmpeg()
    from pydub import AudioSegment

    combined = AudioSegment.silent(duration=0)
    gap = AudioSegment.silent(duration=gap_ms)
    total = len(segments)

    for i, seg in enumerate(segments):
        text = (seg.get("text") or "").strip()
        if text:
            audio_bytes, mime = synth(
                text,
                seg.get("engine", "sapi"),
                seg.get("voice", ""),
                float(seg.get("rate", 1.0)),
            )
            sub_fmt = "mp3" if mime == "audio/mpeg" else "wav"
            piece = AudioSegment.from_file(io.BytesIO(audio_bytes), format=sub_fmt)
            combined += piece + gap
        yield {"done": i + 1, "total": total}

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    combined.export(out_path, format=fmt)
    yield {"done": total, "total": total, "path": out_path}
