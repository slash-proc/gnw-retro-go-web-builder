# Vendored patch-engine assets

- **`lzma-wasm/liblzma.{mjs,wasm}`** — xz **5.4.1** `liblzma` compiled to WASM
  (emscripten) via `../wasm/build.sh` + `../wasm/wrapper.c`. Produces output
  **byte-identical** to the container's Python `liblzma` 5.4.1, which the patcher
  requires (layout decisions depend on exact compressed lengths). xz 5.4.1
  predates the xz-utils backdoor (5.6.0/5.6.1). Rebuild:
  `docker run --rm -v "$PWD/packages/gnw-patch":/pkg -w /pkg/wasm emscripten/emsdk:3.1.74 bash build.sh`.
  Validate: `node packages/gnw-patch/wasm/validate.mjs` (72/72 vectors).

- **`symbols_{mario,zelda}.json`** — ELF `.symtab` (name → address) extracted
  from gnwmanager's `binaries/<model>/default.elf`, replacing runtime ELF parsing.

- **`novel_{mario,zelda}.bin`** — gnwmanager's compiled novel-code payload
  (`binaries/<model>/default.bin`, Apache-2.0), copied into the patched internal
  image past `STOCK_ROM_END`.

- **`symbols_{mario,zelda}_boot.json` / `novel_{mario,zelda}_boot.bin`** — the
  **dual-boot** counterparts, from `binaries/<model>/0x08032000.{elf,bin}`.
  gnwmanager selects these whenever `bootloader=True` (`cli/_patch.py`
  `_common_prepare`). They are NOT interchangeable with the `default` pair:
  46-47 symbols sit at different addresses (including `read_buttons`, which the
  patch emits a `bl` to), and `bootloader` resolves to the same address in both
  while being a *different implementation* — the blobs differ across ~7.3 KB
  starting just past `STOCK_ROM_END`. The `_boot` variant also changes the
  extend length (+73728 → 200 KiB total, vs +0x20000 → 256 KiB), reserving
  `0x08032000` onward for the bootloader below.

- **`gnw_bootloader_0x08032000.bin`** — SylverB's SD bootloader, release
  **v1.0.8** of `sylverb/game-and-watch-bootloader`, asset
  `gnw_bootloader_0x08032000.bin` (50,248 bytes, sha256
  `43fd718c1a53dda140f29e4025fc8b6d3bfa71f19a710139135f998e4de022d7`).
  Linked for `0x08032000` (verified: reset PC `0x0803a53d` falls inside it), and
  flashed there by `engine/ofw.ts` after the patched internal image.
  gnwmanager downloads this at runtime (`cli/_bootloader.py`, resolving `latest`);
  we pin a vendored copy instead — the browser can't fetch it directly anyway
  (GitHub release assets send no CORS headers, and `infra/cors-proxy` is
  deliberately locked to one repo + a two-asset allowlist), and a floating
  `latest` would make a byte-exactness-validated pipeline non-reproducible for
  a binary we flash to the device. To bump it: download the new asset here and
  update the version + hash above.

Regenerate the symbol tables with `tools/extract_symbols.py` (pure stdlib; use
`--verify` to confirm it still reproduces an existing file exactly).

All are derived from gnwmanager (branch `remove-keystone-engine`) except the
bootloader binary. The engine output is validated byte-for-byte against a Python
oracle (`test/oracle.py` → `test/engine.mjs`), which covers **both** the default
and bootloader variants — the bootloader case was uncovered until 2026-08, which
is how the unported `bootloader` branch shipped unnoticed.
