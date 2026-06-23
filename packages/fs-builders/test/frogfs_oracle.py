#!/usr/bin/env python3
"""FrogFS oracle: build a reference image from a staging tree using retro-go's
own `mkfrogfs.py` (the submodule copy), so frogfs.mjs can byte-diff against it.

Usage: frogfs_oracle.py <tree_dir> <out_bin>

Mirrors the *raw* case gen_frogfs_image.py emits: a frogfs.yaml with only a
`collect:` mapping (no `compress` rule → mkfrogfs stores every file raw). The
'<tree>/*' glob makes dests relative to the tree root (e.g. roms/nes/smb.nes).
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TOOLS = os.path.join(
    REPO, "references", "game-and-watch-retro-go-sd",
    "Core", "Src", "porting", "lib", "frogfs", "tools",
)
MKFROGFS = os.path.join(TOOLS, "mkfrogfs.py")


def main() -> int:
    tree_dir = os.path.abspath(sys.argv[1])
    out_bin = os.path.abspath(sys.argv[2])
    if not os.path.isfile(MKFROGFS):
        print(f"mkfrogfs.py not found at {MKFROGFS}", file=sys.stderr)
        return 2

    work = os.path.join(os.path.dirname(out_bin), "build")
    shutil.rmtree(work, ignore_errors=True)  # force a clean, deterministic build
    os.makedirs(work, exist_ok=True)
    if os.path.exists(out_bin):
        os.unlink(out_bin)

    yaml_path = os.path.join(work, "frogfs.yaml")
    with open(yaml_path, "w") as f:
        # Quote the source; empty destination → dests are relative to tree root.
        f.write("collect:\n")
        f.write(f'  "{tree_dir}/*": ""\n')

    cmd = [sys.executable, MKFROGFS, "-C", work, yaml_path, work, out_bin]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        print(f"mkfrogfs failed (exit {proc.returncode})", file=sys.stderr)
        return proc.returncode
    if not os.path.isfile(out_bin):
        print("mkfrogfs produced no output", file=sys.stderr)
        return 1
    print(f"oracle wrote {out_bin} ({os.path.getsize(out_bin)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
