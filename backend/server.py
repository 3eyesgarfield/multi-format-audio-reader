"""FastAPI TTS sidecar for the reader app.

Endpoints:
  GET  /health      -> status + which engines are available + gpu flag
  GET  /voices      -> aggregated voice list across all available engines
  POST /synthesize  -> audio bytes (wav or mp3) for one piece of text
  POST /ocr         -> recognise text from a posted PNG (scanned PDF pages)
  POST /export      -> stream progress while building an mp3/wav audiobook

Run: python server.py --port 8756
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from engines import SapiEngine, KokoroEngine, EdgeEngine
import ocr
import audio_export

app = FastAPI(title="Reader TTS Sidecar")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ENGINES = {
    "sapi": SapiEngine(),
    "kokoro": KokoroEngine(),
    "edge": EdgeEngine(),
}


def _synth(text: str, engine: str, voice: str, rate: float = 1.0,
           pitch: float = 0.0) -> tuple[bytes, str]:
    eng = ENGINES.get(engine)
    if eng is None or not eng.available():
        raise RuntimeError(f"engine '{engine}' is not available")
    return eng.synth(text, voice, rate=rate, pitch=pitch)


@app.get("/health")
def health() -> JSONResponse:
    gpu = False
    try:
        import torch
        gpu = bool(torch.cuda.is_available())
    except Exception:
        gpu = False
    return JSONResponse({
        "status": "ok",
        "engines": {name: eng.available() for name, eng in ENGINES.items()},
        "ocr": ocr.available(),
        "gpu": gpu,
    })


@app.get("/voices")
async def voices() -> JSONResponse:
    out = []
    for eng in ENGINES.values():
        if eng.available():
            out.extend(v.to_dict() for v in await run_in_threadpool(eng.list_voices))
    return JSONResponse({"voices": out})


@app.post("/synthesize")
async def synthesize(req: Request):
    body = await req.json()
    text = (body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "empty text"}, status_code=400)
    engine = body.get("engine", "sapi")
    voice = body.get("voice", "")
    rate = float(body.get("rate", 1.0))
    pitch = float(body.get("pitch", 0.0))
    try:
        audio, mime = await run_in_threadpool(_synth, text, engine, voice, rate, pitch)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
    return Response(content=audio, media_type=mime)


@app.post("/ocr")
async def ocr_endpoint(req: Request):
    png = await req.body()
    if not png:
        return JSONResponse({"error": "empty image"}, status_code=400)
    try:
        text = await run_in_threadpool(ocr.image_to_text, png)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
    return JSONResponse({"text": text})


@app.post("/export")
async def export(req: Request):
    body = await req.json()
    segments = body.get("segments", [])
    fmt = body.get("format", "mp3")
    gap_ms = int(body.get("gap_ms", 250))
    out_path = body.get("out_path") or os.path.join(
        tempfile.gettempdir(), f"audiobook.{fmt}")

    def event_stream():
        for prog in audio_export.export_segments(
                segments, out_path, _synth, gap_ms=gap_ms, fmt=fmt):
            yield "data: " + json.dumps(prog) + "\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8756)
    args = parser.parse_args()
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
