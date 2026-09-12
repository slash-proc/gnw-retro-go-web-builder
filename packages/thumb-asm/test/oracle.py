#!/usr/bin/env python3
"""Oracle A driver: assemble inputs with the *upstream* pure-Python thumb_asm.

Reads a JSON list of [code, addr] pairs on stdin; writes a JSON list of
[code, addr, bytesOrNull] (null when the upstream assembler rejects the input).
The upstream module is keystone-validated, so JS-matches-this ⟹ JS-matches-keystone.
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

# Import the upstream in-house assembler from the reference checkout (stdlib-only
# module). It lives on the `remove-keystone-engine` branch; the working tree may
# be parked on some other branch, so fall back to reading the blob out of git
# rather than silently (or noisily) failing — the oracle must never be skipped.
REPO = Path(__file__).resolve().parents[3]
SUBMODULE = REPO / "references" / "gnwmanager"
REL = "gnwmanager/cli/gnw_patch/thumb_asm.py"
ASM_FILE = SUBMODULE / REL

if not ASM_FILE.is_file():
    blob = None
    for rev in ("remove-keystone-engine", "upstream/remove-keystone-engine",
                "origin/remove-keystone-engine"):
        try:
            blob = subprocess.run(
                ["git", "-C", str(SUBMODULE), "-c", "safe.directory=*",
                 "show", f"{rev}:{REL}"],
                check=True, capture_output=True,
            ).stdout
            break
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
    if blob is None:
        sys.exit(
            f"ORACLE UNAVAILABLE: {ASM_FILE} is missing and no remove-keystone-engine "
            f"rev in {SUBMODULE} provides {REL}. Oracle A cannot run; do not treat "
            f"this as a pass."
        )
    tmp = Path(tempfile.mkdtemp()) / "thumb_asm.py"
    tmp.write_bytes(blob)
    ASM_FILE = tmp

spec = importlib.util.spec_from_file_location("thumb_asm", ASM_FILE)
thumb_asm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(thumb_asm)

out = []
for code, addr in json.load(sys.stdin):
    try:
        out.append([code, addr, thumb_asm.assemble(code, addr)])
    except Exception:
        out.append([code, addr, None])
json.dump(out, sys.stdout)
