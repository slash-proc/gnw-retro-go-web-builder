#!/usr/bin/env python3
"""Patch oracle: run the upstream gnwmanager patcher on the real stock backups
and emit the reference patched images + the exact liblzma compression vectors.

Outputs (under packages/gnw-patch/test/ref/):
  <model>_internal.bin / <model>_external.bin   reference patched images
  <model>_summary.json                          sizes, sha1, free space
  vectors/<sha1>.in / <sha1>.out                deduped liblzma input/output pairs
  vectors/index.json                            { sha1: {in_len, out_len} }

The vectors are what any byte-exact JS liblzma (WASM) must reproduce; the patched
images are what the ported engine must reproduce. Run inside the dev container
(needs pycryptodome, pyelftools, colorama). Standard patch only (no options).
"""
import hashlib
import json
import sys
from argparse import Namespace
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
GNW = REPO / "references" / "gnwmanager" / "gnwmanager" / "cli"
sys.path.insert(0, str(GNW))  # import the gnw_patch package directly

import gnw_patch  # noqa: E402
from gnw_patch import MarioGnW, ZeldaGnW  # noqa: E402
from gnw_patch import firmware as fw_mod  # noqa: E402

REF = Path(__file__).resolve().parent / "ref"
VEC = REF / "vectors"
REF.mkdir(parents=True, exist_ok=True)
VEC.mkdir(parents=True, exist_ok=True)

# ---- Capture every distinct liblzma input/output (deduped) ------------------
_real_lzma = fw_mod.lzma_compress
_seen = {}


def _recording_lzma(data):
    out = _real_lzma(bytes(data))
    h = hashlib.sha1(bytes(data)).hexdigest()
    if h not in _seen:
        _seen[h] = {"in_len": len(data), "out_len": len(out)}
        (VEC / f"{h}.in").write_bytes(bytes(data))
        (VEC / f"{h}.out").write_bytes(out)
    return out


fw_mod.lzma_compress = _recording_lzma

BINARIES = GNW / "gnw_patch" / "binaries"
BACKUPS = REPO / "backup"

MODELS = {
    "mario": (MarioGnW, Namespace(disable_sleep=False, sleep_time=None, no_save=False,
              no_mario_song=False, no_sleep_images=False, no_smb2=False, compression_ratio=1.4)),
    "zelda": (ZeldaGnW, Namespace(no_la=False, no_sleep_images=False, no_second_beep=False, no_hour_tune=False)),
}

summary_all = {}
for name, (cls, args) in MODELS.items():
    bin_dir = BINARIES / name
    patch_data = (bin_dir / "default.bin").read_bytes()
    elf = bin_dir / "default.elf"
    internal = BACKUPS / f"internal_flash_backup_{name}.bin"
    external = BACKUPS / f"flash_backup_{name}.bin"

    device = cls(str(internal), str(elf), str(external))
    device.crypt()
    novel_code_start = device.internal.STOCK_ROM_END
    device.internal[novel_code_start:] = patch_data[novel_code_start:]
    device.internal.extend(b"\x00" * 0x20000)  # standard (non-bootloader): +128 KiB
    device.args = args

    int_free, cmem_free = device()

    int_bytes = bytes(device.internal)
    ext_bytes = bytes(device.external)
    (REF / f"{name}_internal.bin").write_bytes(int_bytes)
    (REF / f"{name}_external.bin").write_bytes(ext_bytes)
    summary = {
        "internal_len": len(int_bytes),
        "internal_sha1": hashlib.sha1(int_bytes).hexdigest(),
        "external_len": len(ext_bytes),
        "external_sha1": hashlib.sha1(ext_bytes).hexdigest(),
        "internal_free": int_free,
        "compressed_memory_free": cmem_free,
    }
    (REF / f"{name}_summary.json").write_text(json.dumps(summary, indent=2))
    summary_all[name] = summary
    print(f"{name}: int {len(int_bytes)} (free {int_free}) sha1 {summary['internal_sha1'][:12]} | "
          f"ext {len(ext_bytes)} sha1 {summary['external_sha1'][:12]}")

(VEC / "index.json").write_text(json.dumps(_seen, indent=2))
print(f"liblzma vectors captured (distinct): {len(_seen)}")
print(json.dumps(summary_all, indent=2))
