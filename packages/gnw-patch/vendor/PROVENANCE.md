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

All three are derived from gnwmanager (branch `remove-keystone-engine`). The
engine output is validated byte-for-byte against a Python oracle
(`test/oracle.py` → `test/engine.mjs`).
