#!/usr/bin/env python3
"""Reference for the layout-superblock patcher (== retro-go tools/patch_superblock.py).
Locates the GnwLayoutSuperblock by magic scan, writes the override fields + flags,
recomputes crc32 over [0x00,0x1C). Uses zlib.crc32 — the standard reflected IEEE
CRC-32, identical to the firmware's crc32_le(0, ...) — so the device's
gw_layout_valid() accepts it. Byte-exact reference for the TS patchSuperblock.

Usage: superblock_oracle.py IN OUT --frogfs-offset N [--frogfs-length N]
       [--extflash-size N] [--reserved-offset N]
"""
import argparse
import struct
import sys
import zlib

MAGIC = bytes([0x47, 0x57, 0x4C, 0x42])  # "GWLB" LE
SIZE = 36
VERSION = 2
FLAG_FROGFS_OFFSET = 1 << 0
FLAG_EXTFLASH_SIZE = 1 << 1
FLAG_RESERVED_OFFSET = 1 << 2
FLAG_LITTLEFS_LENGTH = 1 << 3


def locate(data: bytes) -> int:
    hits = []
    for i in range(0, len(data) - SIZE + 1, 4):
        if data[i:i + 4] != MAGIC:
            continue
        version, struct_size = struct.unpack_from("<HH", data, i + 4)
        if 1 <= version <= VERSION and struct_size >= SIZE:
            hits.append(i)
    if not hits:
        raise SystemExit("layout superblock not found")
    if len(hits) > 1:
        raise SystemExit(f"multiple superblocks at {[hex(h) for h in hits]}")
    return hits[0]


def patch(data: bytearray, off: int, args) -> None:
    if args.frogfs_offset & 0xFFF:
        raise SystemExit("frogfs-offset must be 4 KiB-aligned")
    flags = struct.unpack_from("<I", data, off + 0x1C)[0]
    struct.pack_into("<I", data, off + 0x08, args.frogfs_offset & 0xFFFFFFFF)
    flags |= FLAG_FROGFS_OFFSET
    if args.frogfs_length is not None:
        struct.pack_into("<I", data, off + 0x0C, args.frogfs_length & 0xFFFFFFFF)
    if args.extflash_size is not None:
        struct.pack_into("<I", data, off + 0x10, args.extflash_size & 0xFFFFFFFF)
        flags |= FLAG_EXTFLASH_SIZE
    if args.reserved_offset is not None:
        struct.pack_into("<I", data, off + 0x14, args.reserved_offset & 0xFFFFFFFF)
        flags |= FLAG_RESERVED_OFFSET
    if args.littlefs_length is not None:
        struct.pack_into("<I", data, off + 0x18, args.littlefs_length & 0xFFFFFFFF)
        flags |= FLAG_LITTLEFS_LENGTH
    struct.pack_into("<I", data, off + 0x1C, flags & 0xFFFFFFFF)
    crc = zlib.crc32(bytes(data[off:off + 0x20])) & 0xFFFFFFFF
    struct.pack_into("<I", data, off + 0x20, crc)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("outfile")
    ap.add_argument("--frogfs-offset", type=lambda s: int(s, 0), required=True)
    ap.add_argument("--frogfs-length", type=lambda s: int(s, 0))
    ap.add_argument("--extflash-size", type=lambda s: int(s, 0))
    ap.add_argument("--reserved-offset", type=lambda s: int(s, 0))
    ap.add_argument("--littlefs-length", type=lambda s: int(s, 0))
    args = ap.parse_args()

    data = bytearray(open(args.infile, "rb").read())
    off = locate(data)
    patch(data, off, args)
    with open(args.outfile, "wb") as f:
        f.write(data)
    print(f"patched superblock @ {hex(off)} → {args.outfile}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
