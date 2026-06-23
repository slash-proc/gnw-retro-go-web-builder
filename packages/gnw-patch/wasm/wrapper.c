/*
 * Byte-exact liblzma compression for the firmware patcher, matching Python's
 *   lzma.compress(data, format=FORMAT_ALONE,
 *                 filters=[{id: FILTER_LZMA1, preset: 6, dict_size: 16*1024}])[13:]
 * i.e. the LZMA1 "alone" encoder at preset 6 with a 16 KiB dictionary, with the
 * 13-byte .lzma header stripped to yield the raw LZMA1 stream.
 *
 * lzma_alone_compress(in, in_len, &out) -> out_len (raw stream length), or <0 on
 * error. On success *out points to a malloc'd buffer the caller must free().
 */
#include <emscripten.h>
#include <lzma.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define ALONE_HEADER 13

EMSCRIPTEN_KEEPALIVE
int lzma_alone_compress(const uint8_t *in, int in_len, uint8_t **out) {
  lzma_options_lzma opt;
  if (lzma_lzma_preset(&opt, 6)) return -1;
  opt.dict_size = 16 * 1024;

  lzma_stream strm = LZMA_STREAM_INIT;
  if (lzma_alone_encoder(&strm, &opt) != LZMA_OK) return -2;

  size_t cap = (size_t)in_len + in_len / 2 + 4096;
  uint8_t *buf = (uint8_t *)malloc(cap);
  if (!buf) { lzma_end(&strm); return -3; }

  strm.next_in = in;
  strm.avail_in = (size_t)in_len;
  strm.next_out = buf;
  strm.avail_out = cap;

  lzma_ret r;
  for (;;) {
    r = lzma_code(&strm, LZMA_FINISH);
    if (r == LZMA_STREAM_END) break;
    if (r != LZMA_OK) { free(buf); lzma_end(&strm); return -4; }
    if (strm.avail_out == 0) {
      size_t used = cap;
      cap *= 2;
      uint8_t *grown = (uint8_t *)realloc(buf, cap);
      if (!grown) { free(buf); lzma_end(&strm); return -5; }
      buf = grown;
      strm.next_out = buf + used;
      strm.avail_out = cap - used;
    }
  }

  size_t total = cap - strm.avail_out;
  lzma_end(&strm);
  if (total < ALONE_HEADER) { free(buf); return -6; }

  size_t raw = total - ALONE_HEADER;
  memmove(buf, buf + ALONE_HEADER, raw); /* strip the 13-byte .lzma header */
  *out = buf;
  return (int)raw;
}
