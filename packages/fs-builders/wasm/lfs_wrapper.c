/*
 * LittleFS image builder/reader for the browser. Wraps the vendored littlefs
 * (v2.11, disk v2.1 — the exact source the Game & Watch firmware runs) with a
 * RAM block device so we can build a standalone LFS image (block 0 first) and
 * read it back for validation, with zero hardware. The on-device partition
 * layout (blocks growing downward from end-of-flash, gnwmanager filesystem.py)
 * is handled by the flasher when writing this image, not here.
 *
 * One filesystem at a time (sufficient for our use). All functions return 0 on
 * success or a negative lfs_error.
 */
#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "lfs.h"

static lfs_t g_lfs;
static struct lfs_config g_cfg;
static uint8_t *g_buf = NULL; /* image buffer: block_count * block_size */
static uint8_t *g_loaded = NULL; /* bitmap of loaded blocks */
static uint32_t g_size = 0;
static uint32_t g_block_count = 0;
static uint32_t g_block_size = 0;
static uint8_t *g_filebuf = NULL; /* last file read */
static uint32_t g_filelen = 0;
static int g_missing_block = -1;

static int bd_read(const struct lfs_config *c, lfs_block_t block, lfs_off_t off,
                   void *buffer, lfs_size_t size) {
  if (g_loaded && !(g_loaded[block / 8] & (1 << (block % 8)))) {
    g_missing_block = block;
    return LFS_ERR_IO;
  }
  memcpy(buffer, g_buf + (block * c->block_size) + off, size);
  return 0;
}
static int bd_prog(const struct lfs_config *c, lfs_block_t block, lfs_off_t off,
                   const void *buffer, lfs_size_t size) {
  memcpy(g_buf + (block * c->block_size) + off, buffer, size);
  return 0;
}
static int bd_erase(const struct lfs_config *c, lfs_block_t block) {
  memset(g_buf + (block * c->block_size), 0xFF, c->block_size);
  return 0;
}
static int bd_sync(const struct lfs_config *c) {
  (void)c;
  return 0;
}

static void setup_cfg(uint32_t block_size, uint32_t block_count) {
  memset(&g_cfg, 0, sizeof(g_cfg));
  g_cfg.read = bd_read;
  g_cfg.prog = bd_prog;
  g_cfg.erase = bd_erase;
  g_cfg.sync = bd_sync;
  g_cfg.read_size = 16;
  g_cfg.prog_size = 16;
  g_cfg.block_size = block_size;
  g_cfg.block_count = block_count;
  g_cfg.block_cycles = 500; /* matches gnwmanager get_filesystem() */
  g_cfg.cache_size = 64;    /* factor of block_size, multiple of read/prog */
  g_cfg.lookahead_size = 32;
}

static int alloc_buf(uint32_t block_size, uint32_t block_count) {
  g_block_size = block_size;
  g_block_count = block_count;
  g_size = block_size * block_count;
  free(g_buf);
  g_buf = (uint8_t *)malloc(g_size);
  if (!g_buf) return LFS_ERR_NOMEM;
  memset(g_buf, 0xFF, g_size);

  free(g_loaded);
  uint32_t loaded_size = (block_count + 7) / 8;
  g_loaded = (uint8_t *)malloc(loaded_size);
  if (!g_loaded) return LFS_ERR_NOMEM;
  memset(g_loaded, 0, loaded_size);

  g_missing_block = -1;
  return 0;
}

EMSCRIPTEN_KEEPALIVE int lfs_w_missing_block(void) { return g_missing_block; }
EMSCRIPTEN_KEEPALIVE void lfs_w_mark_loaded(uint32_t block) {
  if (g_loaded && block < g_block_count) {
    g_loaded[block / 8] |= (1 << (block % 8));
  }
}
EMSCRIPTEN_KEEPALIVE void lfs_w_mark_all_loaded(void) {
  if (g_loaded) {
    memset(g_loaded, 0xFF, (g_block_count + 7) / 8);
  }
}

EMSCRIPTEN_KEEPALIVE
int lfs_w_create(uint32_t block_size, uint32_t block_count) {
  int err = alloc_buf(block_size, block_count);
  if (err) return err;
  lfs_w_mark_all_loaded();
  setup_cfg(block_size, block_count);
  err = lfs_format(&g_lfs, &g_cfg);
  if (err) return err;
  return lfs_mount(&g_lfs, &g_cfg);
}

EMSCRIPTEN_KEEPALIVE
int lfs_w_mount(const uint8_t *img, uint32_t block_size, uint32_t block_count) {
  int err = alloc_buf(block_size, block_count);
  if (err) return err;
  if (img) {
    memcpy(g_buf, img, g_size);
    lfs_w_mark_all_loaded();
  }
  setup_cfg(block_size, block_count);
  
  g_missing_block = -1;
  return lfs_mount(&g_lfs, &g_cfg);
}

EMSCRIPTEN_KEEPALIVE
int lfs_w_init(uint32_t block_size, uint32_t block_count) {
  int err = alloc_buf(block_size, block_count);
  if (err) return err;
  setup_cfg(block_size, block_count);
  return 0;
}

EMSCRIPTEN_KEEPALIVE
int lfs_w_mount_retry(void) {
  g_missing_block = -1;
  return lfs_mount(&g_lfs, &g_cfg);
}

EMSCRIPTEN_KEEPALIVE
int lfs_w_mkdir(const char *path) {
  int err = lfs_mkdir(&g_lfs, path);
  return (err == LFS_ERR_EXIST) ? 0 : err;
}

EMSCRIPTEN_KEEPALIVE
int lfs_w_write(const char *path, const uint8_t *data, uint32_t len) {
  lfs_file_t f;
  int err = lfs_file_open(&g_lfs, &f, path, LFS_O_WRONLY | LFS_O_CREAT | LFS_O_TRUNC);
  if (err) return err;
  lfs_ssize_t n = lfs_file_write(&g_lfs, &f, data, len);
  int cerr = lfs_file_close(&g_lfs, &f);
  if (n < 0) return (int)n;
  if (cerr) return cerr;
  return (n == (lfs_ssize_t)len) ? 0 : LFS_ERR_IO;
}

/* Read a file into g_filebuf; returns length (>=0) or negative error. */
EMSCRIPTEN_KEEPALIVE
int lfs_w_read(const char *path) {
  lfs_file_t f;
  int err = lfs_file_open(&g_lfs, &f, path, LFS_O_RDONLY);
  if (err) return err;
  lfs_soff_t sz = lfs_file_size(&g_lfs, &f);
  if (sz < 0) {
    lfs_file_close(&g_lfs, &f);
    return (int)sz;
  }
  free(g_filebuf);
  g_filebuf = (uint8_t *)malloc(sz ? (size_t)sz : 1);
  if (!g_filebuf) {
    lfs_file_close(&g_lfs, &f);
    return LFS_ERR_NOMEM;
  }
  lfs_ssize_t n = lfs_file_read(&g_lfs, &f, g_filebuf, sz);
  lfs_file_close(&g_lfs, &f);
  if (n < 0) return (int)n;
  g_filelen = (uint32_t)n;
  return (int)n;
}

EMSCRIPTEN_KEEPALIVE uint8_t *lfs_w_filedata(void) { return g_filebuf; }
EMSCRIPTEN_KEEPALIVE uint32_t lfs_w_filelen(void) { return g_filelen; }

static char *g_dirbuf = NULL;
static uint32_t g_dirlen = 0;

EMSCRIPTEN_KEEPALIVE
int lfs_w_listdir(const char *path) {
  lfs_dir_t dir;
  struct lfs_info info;
  g_missing_block = -1;
  int err = lfs_dir_open(&g_lfs, &dir, path);
  if (err) return err;

  uint32_t cap = 1024;
  g_dirlen = 0;
  free(g_dirbuf);
  g_dirbuf = (char *)malloc(cap);
  if (!g_dirbuf) {
    lfs_dir_close(&g_lfs, &dir);
    return LFS_ERR_NOMEM;
  }
  g_dirbuf[0] = '\0';

  while (1) {
    g_missing_block = -1;
    int r = lfs_dir_read(&g_lfs, &dir, &info);
    if (r < 0) {
      lfs_dir_close(&g_lfs, &dir);
      return r; // Could be LFS_ERR_IO
    }
    if (r == 0) break; // End of directory

    if (strcmp(info.name, ".") == 0 || strcmp(info.name, "..") == 0) continue;
    if (g_dirlen + 512 > cap) {
      cap *= 2;
      char *newbuf = (char *)realloc(g_dirbuf, cap);
      if (!newbuf) {
        lfs_dir_close(&g_lfs, &dir);
        return LFS_ERR_NOMEM;
      }
      g_dirbuf = newbuf;
    }
    int n = snprintf(g_dirbuf + g_dirlen, cap - g_dirlen, "%d:%lu:%s\n", info.type, (unsigned long)info.size, info.name);
    if (n > 0) g_dirlen += n;
  }
  lfs_dir_close(&g_lfs, &dir);
  return 0;
}

EMSCRIPTEN_KEEPALIVE char *lfs_w_dirdata(void) { return g_dirbuf; }

EMSCRIPTEN_KEEPALIVE int lfs_w_unmount(void) { return lfs_unmount(&g_lfs); }
EMSCRIPTEN_KEEPALIVE uint8_t *lfs_w_image(void) { return g_buf; }
EMSCRIPTEN_KEEPALIVE uint32_t lfs_w_image_size(void) { return g_size; }
