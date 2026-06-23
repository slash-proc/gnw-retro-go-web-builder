#!/usr/bin/env python3
"""Cross-check our WASM-built LittleFS image against littlefs-python 0.17.1 — the
same engine gnwmanager uses. Mounts test/ref/lfs.img and verifies every file's
sha256 matches the manifest our builder wrote."""
import hashlib
import json
import sys
from pathlib import Path

from littlefs import LittleFS

ref_dir = Path(__file__).parent / "ref"
manifest = json.loads((ref_dir / "manifest.json").read_text())
img = (ref_dir / "lfs.img").read_bytes()

fs = LittleFS(block_size=manifest["blockSize"], block_count=manifest["blockCount"], mount=False)
fs.context.buffer = bytearray(img)
fs.mount()  # raises if our image isn't a valid littlefs filesystem

ok = True
for path, want in manifest["files"].items():
    with fs.open(path, "rb") as f:
        got = hashlib.sha256(f.read()).hexdigest()
    same = got == want
    print(f"  {'OK ' if same else 'FAIL'} {path}")
    ok = ok and same

walk = [(root, dirs, files) for root, dirs, files in fs.walk("/")]
print("tree:", {root: sorted(dirs) + sorted(files) for root, dirs, files in walk})

print("littlefs-python mounted + verified our image ✓" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
