#!/usr/bin/env python3
"""Extract an ELF `.symtab` into the vendor/symbols_*.json shape (name -> address).

Why this exists: the vendored symbol tables were originally produced by hand, so there
was no way to regenerate them or to derive the matching table for a *different* build
variant. That gap is exactly how the bootloader patch path shipped using the
non-bootloader (`default.elf`) addresses — 46 symbols, including `read_buttons`, sit at
different addresses in `0x08032000.elf`.

Extraction rule (reverse-engineered from the existing vendored files and verified to
reproduce them exactly — see --verify):
  * take `.symtab` entries only
  * skip FILE and SECTION entries
  * skip undefined symbols (st_shndx == SHN_UNDEF); these are link-time externs with
    address 0 and would otherwise shadow nothing useful
  * later duplicates overwrite earlier ones (plain dict assignment)

Pure stdlib on purpose (no pyelftools): this repo keeps packages dependency-free, and a
40-line 32-bit-LE ELF reader is less surface than a build dependency.

Usage:
  extract_symbols.py <in.elf> [-o out.json]
  extract_symbols.py --verify <in.elf> <expected.json>
"""
import argparse
import json
import struct
import sys

SHT_SYMTAB = 2
SHN_UNDEF = 0
STT_FILE = 4
STT_SECTION = 3


def _sections(buf):
    """Yield (name_off, type, offset, size, entsize, link) per section header."""
    e_shoff, = struct.unpack_from("<I", buf, 0x20)
    e_shentsize, e_shnum = struct.unpack_from("<HH", buf, 0x2E)
    for i in range(e_shnum):
        off = e_shoff + i * e_shentsize
        sh_name, sh_type = struct.unpack_from("<II", buf, off)
        sh_offset, sh_size = struct.unpack_from("<II", buf, off + 0x10)
        sh_link, = struct.unpack_from("<I", buf, off + 0x18)
        sh_entsize, = struct.unpack_from("<I", buf, off + 0x24)
        yield sh_name, sh_type, sh_offset, sh_size, sh_entsize, sh_link


def extract(path):
    buf = open(path, "rb").read()
    if buf[:4] != b"\x7fELF" or buf[4] != 1:
        raise SystemExit(f"{path}: not a 32-bit ELF")

    secs = list(_sections(buf))
    symtab = next((s for s in secs if s[1] == SHT_SYMTAB), None)
    if symtab is None:
        raise SystemExit(f"{path}: no .symtab")
    _, _, sym_off, sym_size, sym_entsize, sym_link = symtab
    _, _, str_off, str_size, _, _ = secs[sym_link]  # associated .strtab

    def name_at(o):
        end = buf.index(b"\0", str_off + o)
        return buf[str_off + o:end].decode("utf-8", "replace")

    out = {}
    for i in range(sym_size // sym_entsize):
        o = sym_off + i * sym_entsize
        st_name, st_value = struct.unpack_from("<II", buf, o)
        st_info, _st_other, st_shndx = struct.unpack_from("<BBH", buf, o + 0x0C)
        st_type = st_info & 0xF
        if st_type in (STT_FILE, STT_SECTION):
            continue
        if st_shndx == SHN_UNDEF:
            continue
        nm = name_at(st_name)
        if not nm:
            continue
        out[nm] = st_value
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("elf")
    ap.add_argument("expected", nargs="?", help="with --verify: JSON to compare against")
    ap.add_argument("-o", "--out")
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()

    syms = extract(a.elf)

    if a.verify:
        if not a.expected:
            raise SystemExit("--verify needs an expected JSON path")
        ref = json.load(open(a.expected))
        if syms == ref:
            print(f"OK  {a.elf} -> {a.expected} ({len(syms)} symbols, exact match)")
            return 0
        only_new = sorted(set(syms) - set(ref))
        only_ref = sorted(set(ref) - set(syms))
        bad = [(k, syms[k], ref[k]) for k in set(syms) & set(ref) if syms[k] != ref[k]]
        print(f"MISMATCH {a.elf} vs {a.expected}")
        print(f"  extracted={len(syms)} expected={len(ref)}")
        if only_new:
            print(f"  only in extracted: {only_new[:10]}")
        if only_ref:
            print(f"  only in expected:  {only_ref[:10]}")
        if bad:
            print(f"  differing values:  {bad[:10]}")
        return 1

    text = json.dumps(syms, indent=2) + "\n"
    if a.out:
        open(a.out, "w").write(text)
        print(f"wrote {a.out} ({len(syms)} symbols)")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
