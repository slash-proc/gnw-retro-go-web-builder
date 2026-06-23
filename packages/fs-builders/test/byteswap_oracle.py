#!/usr/bin/env python3
"""Independent reference for the MD 16-bit byteswap, mirroring
gen_frogfs_image.copy_byteswapped_16 (whole-stream pairing; trailing odd byte
passed through). Reads in_*.bin from <dir>, writes out_*.bin beside them.

Independent reimplementation (not an import) so it's a genuine cross-check.
"""
import os
import sys


def byteswap16(data: bytes) -> bytes:
    out = bytearray(data)
    out[0::2], out[1::2] = out[1::2], out[0::2]
    # bytearray slice-assign with mismatched lengths (odd input) raises, so for
    # odd lengths swap only the even prefix and leave the last byte untouched.
    return bytes(out)


def byteswap16_safe(data: bytes) -> bytes:
    n = len(data) & ~1
    out = bytearray(data)
    body = bytearray(data[:n])
    body[0::2], body[1::2] = body[1::2], body[0::2]
    out[:n] = body
    return bytes(out)


def main() -> int:
    d = os.path.abspath(sys.argv[1])
    for name in sorted(os.listdir(d)):
        if not (name.startswith("in_") and name.endswith(".bin")):
            continue
        with open(os.path.join(d, name), "rb") as f:
            data = f.read()
        out = byteswap16_safe(data)
        with open(os.path.join(d, "out_" + name[3:]), "wb") as f:
            f.write(out)
    print("byteswap oracle wrote outputs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
