"""OCR for scanned/image PDFs via RapidOCR (ONNX, bundled zh+en models, no Paddle).

The frontend renders a page with no text layer to a PNG and posts the bytes here;
we return the recognised text in reading order. Degrades to unavailable if the
optional dependency isn't installed.
"""
from __future__ import annotations

import io

_engine = None


def available() -> bool:
    # build the engine lazily; do NOT cache a failure permanently (first attempt can
    # fail under heavy startup contention) — retry on the next call until it succeeds
    global _engine
    if _engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _engine = RapidOCR()
        except Exception:
            return False
    return _engine is not None


def image_to_text(png_bytes: bytes) -> str:
    if not available():
        raise RuntimeError("OCR engine not installed (pip install rapidocr-onnxruntime)")
    import numpy as np
    from PIL import Image

    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    arr = np.array(img)
    result, _ = _engine(arr)  # type: ignore[misc]
    if not result:
        return ""
    # result rows: [box, text, score] in roughly reading order
    return "\n".join(row[1] for row in result)
