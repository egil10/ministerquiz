"""Standardize all portraits to uniform 360x480 WebP files.

Run once after `npm run images` to compress and unify the portrait pool.
Updates data/ministers.json so each person.image points at the .webp.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PORTRAITS = ROOT / "img" / "portraits"
DATA_FILE = ROOT / "data" / "ministers.json"

TARGET_W = 360
TARGET_H = 480
TARGET_RATIO = TARGET_W / TARGET_H  # 0.75
QUALITY = 80
# Bias the vertical crop toward the top so faces stay in frame.
TOP_BIAS = 0.18  # 18% of the slack comes off the top, 82% off the bottom

LANCZOS = getattr(Image, "Resampling", Image).LANCZOS


def smart_crop(im):
    """Crop the image to TARGET_RATIO with a top bias on vertical slack."""
    w, h = im.size
    ratio = w / h
    if abs(ratio - TARGET_RATIO) < 1e-3:
        return im
    if ratio > TARGET_RATIO:
        new_w = int(round(h * TARGET_RATIO))
        x = (w - new_w) // 2
        return im.crop((x, 0, x + new_w, h))
    new_h = int(round(w / TARGET_RATIO))
    slack = h - new_h
    top = int(round(slack * TOP_BIAS))
    return im.crop((0, top, w, top + new_h))


def process_one(path):
    try:
        with Image.open(path) as src:
            im = ImageOps.exif_transpose(src) or src
            if im.mode == "RGBA":
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.split()[-1])
                im = bg
            elif im.mode != "RGB":
                im = im.convert("RGB")
            cropped = smart_crop(im)
            resized = cropped.resize((TARGET_W, TARGET_H), LANCZOS)
            out = path.with_suffix(".webp")
            resized.save(out, "WEBP", quality=QUALITY, method=6)
            return out
    except Exception as e:
        print(f"  ! {path.name}: {e}", file=sys.stderr)
        return None


def main():
    if not PORTRAITS.exists():
        print(f"No portraits dir: {PORTRAITS}", file=sys.stderr)
        return 1

    files = sorted(
        p for p in PORTRAITS.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
    if not files:
        print("No portraits found.", file=sys.stderr)
        return 1

    print(f"Processing {len(files)} portraits -> {TARGET_W}x{TARGET_H} WebP q{QUALITY}")
    converted = {}
    total_in = 0
    total_out = 0
    failed = []

    for i, src in enumerate(files, 1):
        total_in += src.stat().st_size
        out = process_one(src)
        if out is None:
            failed.append(src.name)
            continue
        total_out += out.stat().st_size
        converted[src.stem] = f"/img/portraits/{out.name}"
        if src.resolve() != out.resolve():
            try:
                src.unlink()
            except OSError as e:
                print(f"  ! unlink {src.name}: {e}", file=sys.stderr)
        if i % 50 == 0 or i == len(files):
            print(f"  {i}/{len(files)}")

    print(f"Bytes: {total_in / 1024 / 1024:.1f}MB -> {total_out / 1024 / 1024:.1f}MB")
    print(f"Converted: {len(converted)}    Failed: {len(failed)}")
    if failed:
        print("  failed:", ", ".join(failed))

    if DATA_FILE.exists() and converted:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        rewired = 0
        for person in data.get("people", []):
            pid = str(person.get("id", ""))
            new = converted.get(pid)
            if not new:
                continue
            if person.get("image") != new:
                if not person.get("imageSource") and person.get("image", "").startswith("http"):
                    person["imageSource"] = person["image"]
                person["image"] = new
                rewired += 1
        data["stats"]["images"] = len(converted)
        DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Updated ministers.json ({rewired} paths rewired, stats.images = {len(converted)})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
