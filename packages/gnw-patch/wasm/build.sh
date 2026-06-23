#!/usr/bin/env bash
# Compile xz 5.4.1's liblzma + wrapper.c to a WASM module that produces
# byte-identical output to the container's liblzma 5.4.1 (Python's lzma). Run via
# the emscripten/emsdk image; outputs ../vendor/lzma-wasm/liblzma.{mjs,wasm}.
set -euo pipefail

XZ_VER=5.4.1
WORK="$(cd "$(dirname "$0")" && pwd)"   # this package's wasm/ dir
OUT="$WORK/../vendor/lzma-wasm"
mkdir -p "$OUT"

cd /tmp
echo "Fetching xz-$XZ_VER…"
curl -sL "https://github.com/tukaani-project/xz/releases/download/v$XZ_VER/xz-$XZ_VER.tar.gz" -o xz.tar.gz
tar xf xz.tar.gz
cd "xz-$XZ_VER"

echo "Configuring (emscripten, static liblzma only)…"
emconfigure ./configure \
  --disable-shared --enable-static \
  --disable-nls --disable-threads --disable-doc --disable-scripts \
  --disable-xz --disable-xzdec --disable-lzmadec --disable-lzmainfo \
  --disable-lzma-links --disable-symbol-versions >/tmp/configure.log 2>&1 \
  || { echo "configure failed:"; tail -30 /tmp/configure.log; exit 1; }

echo "Building liblzma…"
emmake make -C src/liblzma -j"$(nproc)" >/tmp/make.log 2>&1 \
  || { echo "make failed:"; tail -30 /tmp/make.log; exit 1; }

echo "Linking WASM module…"
emcc "$WORK/wrapper.c" src/liblzma/.libs/liblzma.a \
  -I src/liblzma/api -O3 \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node \
  -sALLOW_MEMORY_GROWTH=1 -sEXPORT_NAME=createLiblzma \
  -sEXPORTED_FUNCTIONS=_lzma_alone_compress,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=cwrap,getValue,HEAPU8 \
  -o "$OUT/liblzma.mjs"

echo "Done:"
ls -l "$OUT"
