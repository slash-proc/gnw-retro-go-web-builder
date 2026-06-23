#!/usr/bin/env bash
# Compile the vendored littlefs (v2.11) + lfs_wrapper.c to a WASM module for
# building/reading LittleFS images in the browser. Run via the emscripten image:
#   docker run --rm -v "$PWD/packages/fs-builders":/pkg -w /pkg/wasm \
#     emscripten/emsdk:3.1.74 bash build.sh
# Outputs ../vendor/littlefs-wasm/littlefs.{mjs,wasm}.
set -euo pipefail

WORK="$(cd "$(dirname "$0")" && pwd)"
LFS="$WORK/littlefs"
OUT="$WORK/../vendor/littlefs-wasm"
mkdir -p "$OUT"

echo "Linking littlefs WASM module…"
emcc "$LFS/lfs.c" "$LFS/lfs_util.c" "$WORK/lfs_wrapper.c" \
  -I "$LFS" -O3 \
  -DLFS_NO_DEBUG -DLFS_NO_WARN -DLFS_NO_ERROR -DLFS_NO_ASSERT \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node \
  -sALLOW_MEMORY_GROWTH=1 -sEXPORT_NAME=createLittlefs \
  -sEXPORTED_FUNCTIONS=_lfs_w_create,_lfs_w_mount,_lfs_w_init,_lfs_w_mount_retry,_lfs_w_mkdir,_lfs_w_write,_lfs_w_read,_lfs_w_filedata,_lfs_w_filelen,_lfs_w_listdir,_lfs_w_dirdata,_lfs_w_missing_block,_lfs_w_mark_loaded,_lfs_w_mark_all_loaded,_lfs_w_unmount,_lfs_w_image,_lfs_w_image_size,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=cwrap,getValue,UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8 \
  -o "$OUT/littlefs.mjs"

echo "Done:"
ls -l "$OUT"
