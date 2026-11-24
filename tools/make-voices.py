#!/usr/bin/env python3
"""Generate the recorded voice clips for Mack and Nova.

Uses the open-source Kokoro text-to-speech model (Apache 2.0) through kokoro-onnx (MIT).

    pip install kokoro-onnx soundfile numpy
    # model files: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
    node tools/voice-lines.mjs > lines.json
    python3 tools/make-voices.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin \
        --lines lines.json --out build/wav
    tools/encode-voices.sh build/wav voice        # WAV -> MP3 + voice/manifest.json

Clips that already exist are skipped, so the script can be stopped and resumed, and after
editing js/lines.js only the new lines are generated.
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

CAST = {
    # who: (voice, language, speed)
    "mack": ("bm_george", "en-gb", 1.12),
    "nova": ("af_heart", "en-us", 1.0),
}
TARGET_RMS = 0.085   # about -21 dBFS, the same for every clip
PEAK = 0.97


def level(samples, sr):
    """Bring every clip to the same loudness, judged on the parts where someone is speaking."""
    x = samples.astype(np.float32)
    frame = int(sr * 0.02)
    n = len(x) // frame
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    voiced = rms[rms > max(0.01, rms.max() * 0.1)]
    if len(voiced):
        x = x * (TARGET_RMS / float(np.sqrt(np.mean(voiced ** 2))))
    peak = float(np.abs(x).max())
    if peak > PEAK:
        x = x * (PEAK / peak)
    fade = int(sr * 0.008)
    if len(x) > fade * 2:
        ramp = np.linspace(0, 1, fade, dtype=np.float32)
        x[:fade] *= ramp
        x[-fade:] *= ramp[::-1]
    return np.concatenate([x, np.zeros(int(sr * 0.03), dtype=np.float32)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--lines", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mack", default=None, help="voice name for Mack, e.g. am_michael")
    ap.add_argument("--nova", default=None, help="voice name for Nova, e.g. af_bella")
    ap.add_argument("--only", default=None, help="only this speaker")
    args = ap.parse_args()

    cast = dict(CAST)
    if args.mack:
        cast["mack"] = (args.mack, "en-gb" if args.mack[0] == "b" else "en-us", CAST["mack"][2])
    if args.nova:
        cast["nova"] = (args.nova, "en-gb" if args.nova[0] == "b" else "en-us", CAST["nova"][2])

    with open(args.lines, encoding="utf-8") as f:
        lines = json.load(f)
    todo = []
    for item in lines:
        if args.only and item["who"] != args.only:
            continue
        path = os.path.join(args.out, item["who"], item["id"] + ".wav")
        if not os.path.exists(path):
            todo.append((item, path))
    print(f"{len(lines)} lines, {len(todo)} to generate", flush=True)
    if not todo:
        return

    kokoro = Kokoro(args.model, args.voices)
    started = time.time()
    seconds = 0.0
    for i, (item, path) in enumerate(todo, 1):
        voice, lang, speed = cast[item["who"]]
        samples, sr = kokoro.create(item["say"], voice=voice, speed=speed, lang=lang)
        samples = level(np.asarray(samples), sr)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".part"
        sf.write(tmp, samples, sr, subtype="PCM_16", format="WAV")
        os.replace(tmp, path)
        seconds += len(samples) / sr
        if i % 20 == 0 or i == len(todo):
            el = time.time() - started
            print(f"{i}/{len(todo)}  {seconds / 60:.1f} min of audio in {el / 60:.1f} min", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
