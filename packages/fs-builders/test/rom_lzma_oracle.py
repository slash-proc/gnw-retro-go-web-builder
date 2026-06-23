#!/usr/bin/env python3
"""Reference for the ROM .lzma sidecar payloads. The sibling
`scripts/rom_frogfs_lzma.py` is NOT mounted in the dev container, so the byte-exact
functions are embedded here VERBATIM (compress_lzma_raw / _byteswap_md16 /
compress_payload_lzma + caps) and driven by Python's stdlib liblzma — an
independent compressor from the WASM liblzma the TS port uses.

Driver: reads cases.json + in/<name>.bin; writes out/<name>.bin (or out/<name>.none
when the reference returns None, e.g. over a size cap).
"""
import json
import lzma
import os
import sys
from struct import pack

# ── verbatim from scripts/rom_frogfs_lzma.py ─────────────────────────────────
MAX_COMPRESSED_NES_SIZE = 0x00060010
MAX_COMPRESSED_PCE_SIZE = 0x00049000
MAX_COMPRESSED_WSV_SIZE = 0x00080000
MAX_COMPRESSED_SG_COL_SIZE = 60 * 1024
MAX_COMPRESSED_A2600_SIZE = 131072
MAX_COMPRESSED_A7800_SIZE = 131200
MAX_COMPRESSED_MSX_SIZE = 136 * 1024
MAX_COMPRESSED_VIDEOPAC_SIZE = 136 * 1024

DONT_COMPRESS = object()


def compress_lzma_raw(data: bytes, level=None) -> bytes:
    if level is DONT_COMPRESS:
        return data
    compressed = lzma.compress(
        data,
        format=lzma.FORMAT_ALONE,
        filters=[{"id": lzma.FILTER_LZMA1, "preset": 6, "dict_size": 16 * 1024}],
    )
    return compressed[13:]


def _byteswap_md16(data: bytes) -> bytes:
    if len(data) < 2:
        return data
    b = bytearray(data)
    for i in range(0, len(b) - 1, 2):
        b[i], b[i + 1] = b[i + 1], b[i]
    return bytes(b)


def compress_payload_lzma(mode, raw, *, compress_gb_speed=False):
    if mode == "gb":
        bank_size = 16384
        banks = [raw[i:i + bank_size] for i in range(0, len(raw), bank_size)]
        compressed_banks = [compress_lzma_raw(bank) for bank in banks]
        compress_its = [True] * len(banks)
        compress_its[0] = False
        if compress_gb_speed:
            compression_credit = 26
            compress_size = [len(b) for b in compressed_banks[1:]]
            compress_size = [i for i in compress_size if i > 98]
            ordered = sorted(compress_size)
            if compression_credit > len(ordered):
                compression_credit = len(ordered) - 1
            compress_threshold = ordered[int(compression_credit)] if ordered else 0
            for i, bank in enumerate(compressed_banks):
                if len(bank) >= compress_threshold:
                    compress_its[i] = False
        out_banks = []
        for bank, compressed_bank, compress_it in zip(banks, compressed_banks, compress_its):
            out_banks.append(compressed_bank if compress_it else compress_lzma_raw(bank, level=DONT_COMPRESS))
        return b"".join(out_banks)

    if mode == "sms_md":
        bank_size = 128 * 1024
        banks = [raw[i:i + bank_size] for i in range(0, len(raw), bank_size)]
        compressed_banks = [compress_lzma_raw(bank) for bank in banks]
        parts = [b"SMS+", pack("<l", len(compressed_banks))]
        for b in compressed_banks:
            parts.append(pack("<l", len(b)))
        parts.extend(compressed_banks)
        return b"".join(parts)

    caps = {
        "nes": MAX_COMPRESSED_NES_SIZE, "pce": MAX_COMPRESSED_PCE_SIZE,
        "msx_rom": MAX_COMPRESSED_MSX_SIZE, "wsv": MAX_COMPRESSED_WSV_SIZE,
        "a2600": MAX_COMPRESSED_A2600_SIZE, "a7800": MAX_COMPRESSED_A7800_SIZE,
        "videopac": MAX_COMPRESSED_VIDEOPAC_SIZE,
        "col": MAX_COMPRESSED_SG_COL_SIZE, "sg": MAX_COMPRESSED_SG_COL_SIZE,
    }
    if mode in caps:
        if len(raw) > caps[mode]:
            return None
        return compress_lzma_raw(raw)
    return None


# ── driver ───────────────────────────────────────────────────────────────────
def main() -> int:
    base = os.path.abspath(sys.argv[1])
    with open(os.path.join(base, "cases.json")) as f:
        cases = json.load(f)
    out_dir = os.path.join(base, "out")
    os.makedirs(out_dir, exist_ok=True)

    for c in cases:
        with open(os.path.join(base, "in", c["name"] + ".bin"), "rb") as f:
            raw = f.read()
        if c.get("byteswapMd"):
            raw = _byteswap_md16(raw)
        out = compress_payload_lzma(c["mode"], raw, compress_gb_speed=c.get("gbSpeed", False))
        if out is None:
            open(os.path.join(out_dir, c["name"] + ".none"), "wb").close()
        else:
            with open(os.path.join(out_dir, c["name"] + ".bin"), "wb") as f:
                f.write(out)
    print(f"rom-lzma oracle wrote {len(cases)} case(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
