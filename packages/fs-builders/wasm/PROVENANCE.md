# LittleFS WASM

`littlefs/` is a verbatim copy of the **littlefs v2.11 (disk v2.1)** sources the
Game & Watch firmware vendors (`lfs.c`, `lfs.h`, `lfs_util.c`, `lfs_util.h` from
`references/game-and-watch-retro-go-sd/Core/Src/porting/lib/littlefs/`). This is
the same library version `gnwmanager` drives via **littlefs-python 0.17.1**, so
images we build mount on the host tooling and the device.

`lfs_wrapper.c` adds a RAM block device + a small C API (create/mkdir/write/
read/mount) for building and reading standalone images in the browser.

**Build** (emscripten, mirrors `gnw-patch/wasm/`):
```
docker run --rm -v "$PWD/packages/fs-builders":/pkg -w /pkg/wasm \
  emscripten/emsdk:3.1.74 bash build.sh
```
→ `../vendor/littlefs-wasm/littlefs.{mjs,wasm}`.

**Validate** (no hardware):
```
docker compose exec dev node   packages/fs-builders/test/littlefs.mjs   # round-trip
docker compose exec dev python3 packages/fs-builders/test/lfs_oracle.py  # littlefs-python cross-mount
```
Round-trip (build → remount → read) and a cross-mount in littlefs-python 0.17.1
both pass. LittleFS image bytes aren't reliably deterministic across configs, so
validation is mount-and-read, not byte-diff (see `docs/LITTLEFS.md`).

The image is a stock layout (block 0 first). The on-device partition grows
**downward from end-of-flash** (gnwmanager `filesystem.py`); the gnw-flasher LFS
binding applies that block→address mapping when reading/writing the device.
