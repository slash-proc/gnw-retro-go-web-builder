#!/usr/bin/env python3
"""Oracle A driver: assemble inputs with the *upstream* pure-Python thumb_asm.

Reads a JSON list of [code, addr] pairs on stdin; writes a JSON list of
[code, addr, bytesOrNull] (null when the upstream assembler rejects the input).
The upstream module is keystone-validated, so JS-matches-this ⟹ JS-matches-keystone.
"""
import json
import sys
from pathlib import Path

# Import the upstream in-house assembler from the submodule (stdlib-only module).
REPO = Path(__file__).resolve().parents[3]
ASM_DIR = REPO / "references" / "gnwmanager" / "gnwmanager" / "cli" / "gnw_patch"
sys.path.insert(0, str(ASM_DIR))
import thumb_asm  # noqa: E402

out = []
for code, addr in json.load(sys.stdin):
    try:
        out.append([code, addr, thumb_asm.assemble(code, addr)])
    except Exception:
        out.append([code, addr, None])
json.dump(out, sys.stdout)
