/**
 * FrogFS staging transforms — the deterministic, per-file rules retro-go's
 * `scripts/gen_frogfs_image.py` applies BEFORE handing a tree to mkfrogfs.
 *
 * Ported 1:1 from `gen_frogfs_image.py` (sibling checkout). Scope here is the
 * pure, content-defined transforms that don't depend on app/UX orchestration:
 *   - MD (Genesis) 16-bit byteswap                 (copy_byteswapped_16)
 *   - /roms skip-by-extension (+ PICO-8 carts)     (skip_roms_file_by_extension)
 *   - MD-rom detection                             (is_md_rom)
 *   - .DS_Store discard                            (the frogfs.yaml filter)
 *
 * NOT ported here (orchestration tied to the install UX / descriptor, deferred):
 * the /bios merge (sd_content/roms/bios → /bios), covers generation, the
 * zelda3/smw homebrew restool gating, msx-bios omission, and `.lzma` ROM
 * sidecars. Those belong in buildFlashImages() once the descriptor is settled.
 *
 * A "staged tree" here is an in-memory list of { path, data } where `path` is a
 * POSIX dest like "roms/md/sonic.md" — the same dests FrogFsImage.addFile takes.
 */

import { FrogFsImage } from "./frogfs.js";

/** Extensions skipped under /roms (gen_frogfs_image.ROMS_SKIP_EXTENSIONS). */
const ROMS_SKIP_EXTENSIONS = new Set([
  ".img",
  ".jpg",
  ".jpeg",
  ".png",
  ".bmp",
  ".wad",
]);

export interface StagedFile {
  /** POSIX dest path, e.g. "roms/md/sonic.md". */
  path: string;
  data: Uint8Array;
}

/** Lowercased final extension (".png" for "a.p8.png"), or "" if none. */
function suffixLower(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** Top-level dest segment ("roms", "bios", ...) of a staged path. */
function destTop(path: string): string {
  const i = path.indexOf("/");
  return i < 0 ? path : path.slice(0, i);
}

/** Path segments below the dest top, e.g. "roms/md/sonic.md" → ["md","sonic.md"]. */
function relParts(path: string): string[] {
  const i = path.indexOf("/");
  return i < 0 ? [] : path.slice(i + 1).split("/");
}

/**
 * MD (Genesis) 16-bit byteswap — swap every adjacent byte pair. A trailing odd
 * byte is passed through unswapped. Matches gen_frogfs_image.copy_byteswapped_16
 * (whose 1 MB-chunk `pending` logic nets to a continuous whole-stream pairing).
 */
export function byteswap16(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  const n = data.length & ~1; // largest even ≤ length
  for (let i = 0; i < n; i += 2) {
    out[i] = data[i + 1];
    out[i + 1] = data[i];
  }
  if (data.length & 1) out[data.length - 1] = data[data.length - 1];
  return out;
}

/** True for PICO-8 carts under /roms/pico8 (.p8 / .p8.png / .png) — not skipped. */
export function isPico8Cartridge(path: string): boolean {
  const parts = relParts(path);
  if (parts.length === 0 || parts[0].toLowerCase() !== "pico8") return false;
  const name = basename(path).toLowerCase();
  return (
    name.endsWith(".p8") || name.endsWith(".p8.png") || name.endsWith(".png")
  );
}

/** True if a /roms file should be skipped by extension (gen_frogfs_image). */
export function shouldSkipRomsFile(path: string): boolean {
  if (destTop(path) !== "roms") return false;
  if (isPico8Cartridge(path)) return false; // .png carts survive
  return ROMS_SKIP_EXTENSIONS.has(suffixLower(basename(path)));
}

/** True if this is a Genesis/MD rom needing the 16-bit byteswap. */
export function isMdRom(path: string): boolean {
  if (destTop(path) !== "roms") return false;
  const parts = relParts(path);
  if (parts.length <= 1 || parts[0].toLowerCase() !== "md") return false;
  const name = basename(path);
  if (name === ".DS_Store") return false;
  const ext = suffixLower(name);
  if (ext === ".ggcodes" || ext === ".mcf" || ext === ".pceplus") return false;
  return true;
}

export function isDsStore(path: string): boolean {
  return basename(path) === ".DS_Store";
}

/**
 * Apply the per-file staging rules to an in-memory tree: discard .DS_Store,
 * skip non-rom assets under /roms, byteswap MD roms. Order/dedup is left to the
 * caller; FrogFsImage sorts by dest regardless.
 */
export function stageFrogfsTree(files: StagedFile[]): StagedFile[] {
  const out: StagedFile[] = [];
  for (const f of files) {
    if (isDsStore(f.path)) continue;
    if (shouldSkipRomsFile(f.path)) continue;
    out.push(
      isMdRom(f.path) ? { path: f.path, data: byteswap16(f.data) } : f,
    );
  }
  return out;
}

/** Convenience: stage a tree then build the raw FrogFS image. */
export function buildFrogfsImage(files: StagedFile[]): Uint8Array {
  const img = new FrogFsImage();
  for (const f of stageFrogfsTree(files)) img.addFile(f.path, f.data);
  return img.build();
}
