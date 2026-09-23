"""Local real-time transcription server for the Chrome extension."""

import asyncio
import json
import logging
import os
import sys
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel
import websockets

HOST = "127.0.0.1"
PORT = 8765
SAMPLE_RATE = 16_000
WINDOW_SECONDS = 3.2
STEP_SECONDS = 1.2
MAX_BUFFER_SECONDS = 12
MODEL_NAME = os.getenv("YTVN_WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.getenv("YTVN_WHISPER_DEVICE", "auto")
COMPUTE_TYPE = os.getenv("YTVN_WHISPER_COMPUTE", "auto")

logging.basicConfig(level=logging.INFO, format="[YTVN-STT] %(message)s")


def choose_runtime():
    if DEVICE != "auto":
        return DEVICE, COMPUTE_TYPE if COMPUTE_TYPE != "auto" else "float16"
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", COMPUTE_TYPE if COMPUTE_TYPE != "auto" else "float16"
    except Exception:
        pass
    return "cpu", COMPUTE_TYPE if COMPUTE_TYPE != "auto" else "int8"


RUNTIME_DEVICE, RUNTIME_COMPUTE = choose_runtime()
logging.info("loading %s on %s (%s)", MODEL_NAME, RUNTIME_DEVICE, RUNTIME_COMPUTE)
MODEL = WhisperModel(MODEL_NAME, device=RUNTIME_DEVICE, compute_type=RUNTIME_COMPUTE)


def transcribe(audio: np.ndarray, language: Optional[str], task: str):
    segments, info = MODEL.transcribe(
        audio,
        language=language or None,
        task=task,
        beam_size=5,
        best_of=5,
        temperature=0.0,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 450},
        condition_on_previous_text=True,
        word_timestamps=True,
    )
    result = list(segments)
    text = " ".join(segment.text.strip() for segment in result).strip()
    return text, result, info


async def handler(websocket):
    language = "zh"
    task = "transcribe"
    buffer = np.empty(0, dtype=np.float32)
    last_processed = 0
    logging.info("client connected")
    try:
        async for message in websocket:
            if isinstance(message, str):
                config = json.loads(message)
                language = config.get("language") or None
                task = config.get("task", "transcribe")
                await websocket.send(json.dumps({"type": "ready", "model": MODEL_NAME}))
                continue

            samples = np.frombuffer(message, dtype=np.int16).astype(np.float32) / 32768.0
            buffer = np.concatenate((buffer, samples))
            max_samples = SAMPLE_RATE * MAX_BUFFER_SECONDS
            if len(buffer) > max_samples:
                buffer = buffer[-max_samples:]
            if len(buffer) - last_processed < SAMPLE_RATE * STEP_SECONDS:
                continue
            if len(buffer) < SAMPLE_RATE * WINDOW_SECONDS:
                continue

            window = buffer[-int(SAMPLE_RATE * WINDOW_SECONDS):]
            last_processed = max(
                0,
                len(buffer) - int(SAMPLE_RATE * (WINDOW_SECONDS - STEP_SECONDS)),
            )
            text, segments, info = await asyncio.to_thread(transcribe, window, language, task)
            if text:
                await websocket.send(json.dumps({
                    "type": "partial",
                    "text": text,
                    "language": info.language,
                    "timestamp": segments[-1].end if segments else None,
                }, ensure_ascii=False))
    except websockets.ConnectionClosed:
        pass
    except Exception as error:
        logging.exception("client error")
        try:
            await websocket.send(json.dumps({"type": "error", "message": str(error)}, ensure_ascii=False))
        except Exception:
            pass
    finally:
        logging.info("client disconnected")


async def main():
    async with websockets.serve(handler, HOST, PORT, max_size=8 * 1024 * 1024, ping_interval=20):
        logging.info("listening on ws://%s:%s", HOST, PORT)
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
