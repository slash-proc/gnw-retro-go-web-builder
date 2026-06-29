/**
 * Flash-install image orchestrator — the back half of the FrogFS pipeline
 * (docs/FROGFS_PIPELINE.md). Mirrors retro-go's flash build, which writes THREE
 * regions (Makefile.common `flash` target):
 *   - intflash blob  → a bank (caller flashes; see engine + docs/BINARY_PATCHING.md)
 *   - FrogFS image   → extflash bottom (EXTFLASH_OFFSET): read-only content
 *   - LittleFS image → extflash top (FILESYSTEM_OFFSET, grows down): the cores,
 *                       pre-populated; the firmware writes SAVES into the same
 *                       partition at runtime (it only re-formats on corruption).
 *
 * Content split (gen_frogfs_image.py DEFAULT_DIRS=bios/covers/fonts/roms vs
 * gen_littlefs_image.py DEFAULT_DIRS=cores):
 *   - `cores/*`           → LittleFS image  (active-system selection = follow-up; v1 packs all)
 *   - everything else     → FrogFS image    (bios, fonts, roms+homebrew, lang; +user ROMs)
 *
 * FrogFS assembly mirrors gen_frogfs_image.py main(): dest-map + `/bios` merge +
 * msx-bios omission, then stage→pack→FrogFsImage. The MD double-byteswap is
 * intentional (staging swaps; the lzma packer swaps back before compressing).
 * The caller patches the layout superblock with the FrogFS length + the LittleFS
 * partition length (docs/BINARY_PATCHING.md v2).
 */
import { FrogFsImage } from "./frogfs.js";
import { LittleFsImage, type LittlefsModuleOpts } from "./littlefs.js";
import { stageFrogfsTree, type StagedFile } from "./staging.js";
import { packStagedRoms, type LzmaRaw } from "./romLzma.js";

export interface FlashImageOpts {
  compressGbSpeed?: boolean;
  /** If true (default), all cores are included in FrogFS. If false, only cores matching active systems are included. */
  installAllCores?: boolean;
  /** Homebrew selection (keys). */
  selectedHomebrew?: Set<string>;
  /** Supported homebrew definitions to resolve deviceFiles to keys. */
  homebrewTitles?: { key: string; deviceFiles: string[] }[];
}

export interface FlashImageInputs {
  /** Default content from the artifact bundle, keyed relative to `sd_content/`
   *  ("cores/tgb.bin", "bios/msx/MSX.rom", "lang/de_de.bin", "roms/homebrew/celeste.bin"). */
  defaultContent: Map<string, Uint8Array>;
  /** User folder scan, keyed "<system>/<file>" ("nes/mario.nes"); "bios/*" → `/bios`. */
  userRoms: Map<string, Uint8Array>;
  /** Injected raw-LZMA compressor (== gnw-patch WASM `lzma_alone_compress`). */
  lzmaRaw: LzmaRaw;
  /** Build per-ROM `.lzma` sidecars (default true). `false` ⇒ store ROMs RAW (XiP,
   *  no on-device decompress / heap OOM); `lzmaRaw` is then unused. */
  compress?: boolean;
  /** Options passed down from the UI/flash flow. */
  opts?: FlashImageOpts;
  /** Explicit files to inject into the LittleFS partition (e.g. migrating saves/config). */
  lfsData?: Map<string, Uint8Array>;
}

export interface FlashAssemblyPlan {
  /** Staged + lzma-packed FrogFS tree (read-only content). */
  frogfsFiles: StagedFile[];
  /** Cores destined for the LittleFS image, keyed "cores/<rel>". */
  coreFiles: StagedFile[];
  /** Active `/roms` system dirnames (e.g. ["homebrew","md","nes"]). */
  systems: string[];
  stats: { frogfsFiles: number; coreFiles: number; compressed: number; skipped: number; omittedMsxBios: boolean };
}

/** LittleFS partition geometry (from the detected extflash + chosen split). */
export interface LittlefsGeometry {
  /** Device erase block size (e.g. 4096). */
  blockSize: number;
  /** Partition bytes / blockSize. */
  blockCount: number;
  moduleOpts?: LittlefsModuleOpts;
}

export interface FlashImages {
  /** Raw FrogFS image (read-only content partition, extflash bottom). */
  frogfs: Uint8Array;
  /** Raw LittleFS image (cores + room for saves, extflash top). */
  littlefs: Uint8Array;
  plan: FlashAssemblyPlan;
}

const BIOS = "bios/";
const ROMS = "roms/";
const CORES = "cores/";

const defaultDest = (key: string): string =>
  key.startsWith(ROMS + "bios/") ? BIOS + key.slice((ROMS + "bios/").length) : key;

export function userDest(rel: string): string {
  if (rel.startsWith("roms/")) return rel;
  if (rel.startsWith("covers/")) return rel;
  if (rel.startsWith("bios/")) return rel;
  if (rel.startsWith("cheats/")) return "roms/" + rel.slice(7);
  
  const slash = rel.indexOf("/");
  if (slash > 0) {
    const sys = rel.slice(0, slash);
    if (sys.endsWith("_bios")) {
      const realSys = sys.slice(0, -5);
      return `bios/${realSys}/${rel.slice(slash + 1)}`;
    }
  }

  return `roms/${rel}`;
}

function systemUnderRoms(dest: string): string | null {
  if (!dest.startsWith(ROMS)) return null;
  const rest = dest.slice(ROMS.length);
  const i = rest.indexOf("/");
  return i < 0 ? null : rest.slice(0, i);
}

/**
 * Resolve inputs → the FrogFS tree + the cores tree (no image build). Splits
 * `cores/*` to LittleFS; routes everything else through the FrogFS staging.
 */
export function planFlashImage(inputs: FlashImageInputs): FlashAssemblyPlan {
  const { defaultContent, userRoms, lzmaRaw, compress, opts } = inputs;

  // 1) All content → FrogFS dest-keyed tree (user overrides).
  const tree = new Map<string, Uint8Array>();
  const coreTree = new Map<string, Uint8Array>();
  for (const [key, data] of defaultContent) {
    if (key.startsWith(CORES)) {
      coreTree.set(key, new Uint8Array(data));
    } else {
      tree.set(defaultDest(key), data);
    }
  }
  for (const [rel, data] of userRoms) {
    tree.set(userDest(rel), data);
  }
  if (inputs.lfsData) {
    for (const [key, data] of inputs.lfsData) {
      coreTree.set(key, data);
    }
  }

  // 2) Active /roms systems → omit bios/msx when no MSX games present.
  const systems = new Set<string>();
  for (const dest of tree.keys()) {
    const s = systemUnderRoms(dest);
    if (s) systems.add(s);
  }
  const omittedMsxBios = !systems.has("msx");
  if (omittedMsxBios) {
    for (const dest of [...tree.keys()])
      if (dest === "bios/msx" || dest.startsWith("bios/msx/")) tree.delete(dest);
  }

  // 2.5) Filter unselected default homebrew (e.g. celeste.bin from the firmware bundle).
  // On-device homebrew that was selected is already in `tree` via `userRoms` (readGameData).
  // But the bundle ALWAYS contains default homebrew like celeste.bin. We must prune them
  // if the user explicitly unselected them.
  if (opts?.selectedHomebrew) {
    for (const dest of [...tree.keys()]) {
      if (!dest.startsWith("roms/homebrew/")) continue;
      const file = dest.slice("roms/homebrew/".length);
      // We only care about known titles. Unrecognized homebrew is left alone.
      // (Actually, the bundle only provides known ones, but just in case).
      const hb = opts.homebrewTitles?.find((t) => t.deviceFiles.includes(file));
      if (hb && !opts.selectedHomebrew.has(hb.key)) {
        tree.delete(dest);
      }
    }
  }

  // 2.6) Filter cores if installAllCores is false
  if (opts?.installAllCores === false) {
    for (const [path, data] of [...coreTree]) {
      if (path !== CORES && path.startsWith(CORES)) {
        const coreName = path.slice(CORES.length).replace(".bin", "");
        if (!systems.has(coreName)) coreTree.delete(path);
      }
    }
  }

  // 3) FrogFS: stage (byteswap MD / skip-ext / .DS_Store) → lzma sidecars. Order
  //    mirrors gen_frogfs_image.py (stage_input_dirs then pack_staged_roms).
  const raw: StagedFile[] = [...tree].map(([path, data]) => ({ path, data }));
  
  const getGameBase = (path: string): string => {
    let p = path;
    if (path.startsWith("covers/")) p = path.slice(7);
    else if (path.startsWith("roms/cheats/")) p = path.slice(12);
    else if (path.startsWith("roms/")) p = path.slice(5);
    else return path; // Not a game file, use full path as base
    
    // Check if it's in a system dir (has a slash)
    const slash = p.indexOf("/");
    if (slash > 0) {
      const lastDot = p.lastIndexOf(".");
      return p.slice(0, lastDot > slash ? lastDot : undefined);
    }
    return path;
  };

  raw.sort((a, b) => {
    const baseA = getGameBase(a.path);
    const baseB = getGameBase(b.path);
    if (baseA !== baseB) return baseA < baseB ? -1 : 1;
    return a.path < b.path ? -1 : 1;
  });

  const staged = stageFrogfsTree(raw);
  const packed =
    compress === false
      ? { files: staged, compressed: 0, skipped: staged.length }
      : packStagedRoms(staged, lzmaRaw, { compressGbSpeed: opts?.compressGbSpeed });

  // 4) Package cores
  const coreFiles: StagedFile[] = [...coreTree].map(([path, data]) => ({ path, data }));

  return {
    frogfsFiles: packed.files,
    coreFiles,
    systems: [...systems].sort(),
    stats: {
      frogfsFiles: packed.files.length,
      coreFiles: coreFiles.length,
      compressed: packed.compressed,
      skipped: packed.skipped,
      omittedMsxBios,
    },
  };
}

const MIB = 1024 * 1024;
/** LittleFS partition floor — saves + savestates are space-hungry (owner: ~8 MiB min). */
export const LITTLEFS_FLOOR = 8 * MIB;
/** Headroom above the cores for saves, when cores exceed the floor. */
export const SAVES_HEADROOM = 6 * MIB;
/** Ext-flash minimum erase size → LittleFS block size. */
export const DEFAULT_BLOCK_SIZE = 4096;

export interface FlashLayoutInputs {
  /** Detected total extflash size, bytes (gnw-flasher info()). */
  extflashSize: number;
  /** Built FrogFS image length, bytes. */
  frogfsLength: number;
  /** Total cores bytes (sum of the LittleFS core files) — drives partition sizing. */
  coresSize: number;
  blockSize?: number;
  /** Bytes reserved at the extflash bottom (OFW); 0 for a full-wipe flash install.
   *  This is the FrogFS base offset (expert override). */
  reservedOffset?: number;
  /** Explicit LittleFS partition size (bytes) — expert override. Omit for auto
   *  (max(8 MiB floor, cores + headroom)). Rounded up to blockSize. */
  littlefsLength?: number;
  policy?: { littlefsFloor?: number; savesHeadroom?: number };
}

export interface FlashLayout {
  blockSize: number;
  reservedOffset: number;
  /** FrogFS base offset from 0x90000000 (= reservedOffset). */
  frogfsOffset: number;
  frogfsLength: number;
  /** LittleFS partition offset from 0x90000000 (grows down from the top). */
  littlefsOffset: number;
  littlefsLength: number;
  littlefsBlockCount: number;
  /** FrogFS (bottom) and LittleFS (top) don't overlap and stay on-chip. */
  fits: boolean;
  /** Spare extflash between the two regions (negative ⇒ overflow). */
  freeBytes: number;
  /** Offset of the end of extflash (== extflashSize); LittleFS ends exactly here. */
  deviceEndOffset: number;
  /** All region boundaries are block-aligned (extflash size + reserved divisible by
   *  blockSize) — required for erase. False ⇒ the LittleFS write will misalign. */
  aligned: boolean;
}

const roundUp = (n: number, m: number): number => Math.ceil(n / m) * m;

/**
 * Compute the extflash layout for a flash install: FrogFS at the bottom, LittleFS
 * (cores + saves) at the top, sized to the cores with an 8 MiB floor. Pure — the
 * caller patches the superblock with these offsets/lengths and flashes. The budget
 * check (`fits`) catches "ROMs + cores don't fit this chip".
 */
export function planFlashLayout(inp: FlashLayoutInputs): FlashLayout {
  const blockSize = inp.blockSize ?? DEFAULT_BLOCK_SIZE;
  const reservedOffset = inp.reservedOffset ?? 0;
  const floor = inp.policy?.littlefsFloor ?? LITTLEFS_FLOOR;
  const headroom = inp.policy?.savesHeadroom ?? SAVES_HEADROOM;

  const littlefsLength = roundUp(
    inp.littlefsLength ?? Math.max(floor, inp.coresSize + headroom),
    blockSize,
  );
  const littlefsOffset = inp.extflashSize - littlefsLength; // grows down from the top
  const frogfsOffset = reservedOffset;
  const frogfsEnd = frogfsOffset + inp.frogfsLength;

  return {
    blockSize,
    reservedOffset,
    frogfsOffset,
    frogfsLength: inp.frogfsLength,
    littlefsOffset,
    littlefsLength,
    littlefsBlockCount: littlefsLength / blockSize,
    fits: littlefsOffset >= frogfsEnd && littlefsOffset >= 0,
    freeBytes: littlefsOffset - frogfsEnd,
    deviceEndOffset: inp.extflashSize,
    aligned: inp.extflashSize % blockSize === 0 && reservedOffset % blockSize === 0,
  };
}

/** Build just the FrogFS image from a plan (sync). */
export function buildFrogfsFromPlan(
  plan: FlashAssemblyPlan,
  opts?: { previousOrder?: string[]; dataStart?: number },
): Uint8Array {
  const img = new FrogFsImage();
  for (const f of plan.frogfsFiles) img.addFile(f.path, f.data);
  return img.build(opts);
}

/**
 * Reverse a LittleFS image's block order for the G&W extflash layout. The firmware
 * maps littlefs block `b` to flash address `top − (b+1)*block_size` — the partition
 * grows DOWNWARD from the top of extflash (gw_littlefs.c littlefs_api_read/prog/erase,
 * `context = 0x90000000 + extflash_size`). So a linear image (block 0 first) must be
 * block-reversed before it's flashed flat to the partition base. 1:1 with
 * gen_littlefs_image.py `reverse_blocks`. Short images are padded with erased 0xFF.
 */
export function reverseLfsBlocks(image: Uint8Array, blockSize: number, blockCount: number): Uint8Array {
  const full = blockCount * blockSize;
  const src = new Uint8Array(full).fill(0xff); // 0xFF = NOR erased state for any short tail
  src.set(image.subarray(0, Math.min(image.length, full)), 0);
  const out = new Uint8Array(full);
  for (let i = 0; i < blockCount; i++) {
    out.set(src.subarray((blockCount - 1 - i) * blockSize, (blockCount - i) * blockSize), i * blockSize);
  }
  return out;
}

/**
 * Build the cores LittleFS image (async — WASM littlefs), block-reversed for the
 * device's downward partition layout and ready to flash flat at `littlefsOffset`.
 */
export async function buildCoresLittlefs(
  coreFiles: StagedFile[],
  geom: LittlefsGeometry,
): Promise<Uint8Array> {
  const fs = await LittleFsImage.create(geom.blockSize, geom.blockCount, geom.moduleOpts);
  const made = new Set<string>();
  // Sort for deterministic image bytes; create parent dirs before each file.
  for (const f of [...coreFiles].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const segs = f.path.split("/");
    let acc = "";
    for (let i = 0; i < segs.length - 1; i++) {
      acc += "/" + segs[i];
      if (!made.has(acc)) {
        fs.mkdir(acc);
        made.add(acc);
      }
    }
    fs.writeFile("/" + f.path, f.data);
  }
  return reverseLfsBlocks(fs.finish(), geom.blockSize, geom.blockCount);
}

/** Resolve inputs and build both extflash images (FrogFS + cores LittleFS). */
export async function assembleFlashImages(
  inputs: FlashImageInputs,
  littlefs: LittlefsGeometry,
): Promise<FlashImages> {
  const plan = planFlashImage(inputs);
  return {
    frogfs: buildFrogfsFromPlan(plan),
    littlefs: await buildCoresLittlefs(plan.coreFiles, littlefs),
    plan,
  };
}
