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
import {
  resolveInstallPaths,
  DEFAULT_INSTALL_PATHS,
  under,
  type InstallPaths,
} from "./installPaths.js";

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
   *  ("cores/tgb.bin", "bios/msx/MSX.rom", "lang/de_de.bin", "homebrews/celeste.bin" — the manifest declares the directory for each role). */
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
  /** The firmware's own `manifest.json.paths` (raw, absolute-from-root values). Absent roles
   *  fall back to `DEFAULT_INSTALL_PATHS`; a declared-but-malformed value throws
   *  `InstallPathError`. See installPaths.ts. */
  paths?: Readonly<Record<string, unknown>> | null;
  /**
   * Keys in `userRoms` (pre-`userDest`) whose artifact is `mapped`: memory the device executes
   * or indexes in place, not a file it opens.
   *
   * Its only job here is ROUTING. A mapped file must be one contiguous run at a known address,
   * and of the two partitions only FrogFS gives that -- LittleFS scatters a file across blocks,
   * so a file there has no address to hand the core. So `mapped` OVERRIDES the role directory:
   * `cores/gba.xip` goes to FrogFS even though every other `cores/` key goes to LittleFS.
   * Ruled by the owner, and not a judgement call at the placement site: "mapped: true = flash =
   * frogfs and it's unambiguous".
   *
   * The relocation itself is a separate post-pass (`mappedReloc.ts`), because the address is
   * not knowable until the image is packed.
   */
  mappedKeys?: ReadonlySet<string>;
}

export interface FlashAssemblyPlan {
  /** Staged + lzma-packed FrogFS tree (read-only content). */
  frogfsFiles: StagedFile[];
  /** Cores destined for the LittleFS image, keyed "cores/<rel>". */
  coreFiles: StagedFile[];
  /**
   * The subset of `coreFiles` a FrogFS-only install must still deliver into the LittleFS
   * partition itself: cores that came from a SOURCE (`userRoms`) rather than the bundle, and
   * everything under the `data` role.
   *
   * A caller that builds ONLY the FrogFS image discards `coreFiles` wholesale, which is
   * correct for the bundle's cores -- they were written to LittleFS by the firmware install
   * and are already on the device. It is NOT correct for these: a source core has never been
   * written by anything (the firmware install carries no source assets), and `/data` is state
   * the user changed in this session. Discarding them silently installs a core the firmware
   * cannot find, or drops the change. `writeIntoLittleFs` is how a caller delivers them
   * without reformatting the partition the saves live in.
   */
  pendingLfsFiles: StagedFile[];
  /** Active `/roms` system dirnames (e.g. ["homebrew","md","nes"]). */
  systems: string[];
  /**
   * Directories the LittleFS partition must carry even when it holds no files: the `cores` and
   * `data` roles, as the manifest names them.
   *
   * A flash firmware install writes no cores by default (the owner's rule: on Flash a core
   * follows a ROM selection, and there is none in that flow), so without this the partition
   * comes out bare and the file browser says `No files found in LittleFS`, which reads as a
   * failed install rather than an empty one. The structure is the evidence the install worked.
   *
   * `data` additionally has to exist because it is where the firmware writes its own state:
   * `userDest` routes it here precisely because a `/data` file in FrogFS opens EROFS and can
   * never be written back (syscalls.c).
   */
  lfsDirs: string[];
  /**
   * The mapped artifacts that were routed into FrogFS, as `{ key, dest }`. BOTH halves are
   * needed and neither can be recovered from the other: the caller holds its specs under the
   * input `key`, while the relocation post-pass looks the file up in the packed image by its
   * `dest` (post-`userDest`).
   */
  mappedDests: { key: string; dest: string }[];
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

/**
 * `roms/bios/x` in a bundle tree is really a BIOS file: hoist it to the bios role. Both
 * directories come from the manifest now (installPaths.ts), not from a literal here.
 */
const defaultDest = (key: string, paths: InstallPaths): string => {
  const nested = under(paths.roms, "bios/");
  return key.startsWith(nested) ? under(paths.bios, key.slice(nested.length)) : key;
};

export function userDest(rel: string, paths: InstallPaths = DEFAULT_INSTALL_PATHS): string {
  if (rel.startsWith(paths.roms + "/")) return rel;
  if (rel.startsWith(paths.covers + "/")) return rel;
  if (rel.startsWith(paths.bios + "/")) return rel;
  // A core from a SOURCE arrives here already rooted at the cores role: `placement.ts`'s
  // `assetPrefix` rewrites only the homebrew and roms directories, so a core's directory
  // passes through it untouched. Without this line the fallback prefixed it and the core
  // shipped as `roms/cores/<file>` inside FrogFS, where the firmware never looks — seen on
  // the owner's device. `engine/devicePaths.ts`'s `sdDestPath` carries the same rule for SD;
  // the two mappers must agree on a core, and `flashImage.mjs` pins that they do.
  if (rel.startsWith(paths.cores + "/")) return rel;
  // Cheats keep their own tree: the firmware builds cheat paths from
  // ODROID_BASE_PATH_CHEATS ("/cheats", retro-go-stm32/components/odroid/config.h:63) after
  // stripping the "/roms" prefix off the ROM path (odroid_system_get_path_buf,
  // Core/Src/porting/odroid_system.c:91-95) — so /roms/nes/x.nes reads /cheats/nes/x.ggcodes.
  if (rel.startsWith(paths.cheats + "/")) return rel;
  // `/data` is the firmware's own writable state (Retro-Go's config, and `data/favorites.txt`
  // which it rewrites at runtime). It must NOT be prefixed into `roms/`, and it must not reach
  // FrogFS: `is_frogfs_path` (references/game-and-watch-retro-go-sd/Core/Src/syscalls.c:441)
  // lists roms/covers/bios/fonts/font and cores/pico8.ro and nothing else, so on a flash-only
  // device every other path resolves to LittleFS. A `/data` file placed in FrogFS opens EROFS
  // (`_open`, syscalls.c:477) and can never be written back.
  if (rel === paths.data || rel.startsWith(paths.data + "/")) return rel;
  const slash = rel.indexOf("/");
  if (slash > 0) {
    const sys = rel.slice(0, slash);
    if (sys.endsWith("_bios")) {
      const realSys = sys.slice(0, -5);
      return under(paths.bios, `${realSys}/${rel.slice(slash + 1)}`);
    }
    // A bare `homebrew/<file>` key (the shape prepareState/placement.ts produce) lands in
    // whatever directory the firmware declares for the homebrew ROLE — `/homebrews` in the
    // live manifest, NOT `roms/homebrew`. The role name and the directory differ on purpose.
    if (sys === "homebrew") return under(paths.homebrew, rel.slice(slash + 1));
  }

  return under(paths.roms, rel);
}

function systemUnderRoms(dest: string, paths: InstallPaths): string | null {
  const prefix = paths.roms + "/";
  if (!dest.startsWith(prefix)) return null;
  const rest = dest.slice(prefix.length);
  const i = rest.indexOf("/");
  return i < 0 ? null : rest.slice(0, i);
}

/**
 * Resolve inputs → the FrogFS tree + the cores tree (no image build). Splits
 * `cores/*` to LittleFS; routes everything else through the FrogFS staging.
 */
export function planFlashImage(inputs: FlashImageInputs): FlashAssemblyPlan {
  const { defaultContent, userRoms, lzmaRaw, compress, opts } = inputs;
  // Validate + normalize the firmware's declared install locations ONCE, here, at the entry
  // point. Everything below works in the resolved (relative, no trailing slash) form.
  const paths = resolveInstallPaths(inputs.paths);
  const CORES = paths.cores + "/";
  const DATA = paths.data + "/";
  /**
   * `lang/` is a LITERAL, not a manifest role, because the firmware's `paths` object does not
   * declare one (cores, homebrew, bios, roms, covers, cheats, data). The firmware hardcodes it
   * the same way on its side.
   *
   * It belongs in LittleFS because `rg_i18n.c`'s `i18n_load_from_sd` opens the blob with a
   * plain `fopen("/lang/de_de.bin")`, and `syscalls.c`'s `is_frogfs_path()` routes only roms,
   * covers, bios, fonts, font and `cores/pico8.ro` to FrogFS -- so every other path, `/lang`
   * included, resolves to LittleFS. A blob placed in FrogFS is invisible to that open.
   *
   * This shipped wrong and looked fine: English is baked into rodata and the loader is only
   * reached for the other locales, so a flash-only install silently stayed in English. Upstream
   * packs `lang/` into NEITHER partition on a flash-only build (`gen_littlefs_image.py` takes
   * `cores` only, `gen_frogfs_image.py` takes bios/covers/fonts/roms), which is why the right
   * destination was not obvious from the build scripts. The loader settles it.
   */
  const LANG = "lang/";
  // The trees that live in the LittleFS partition rather than FrogFS. `cores` mirrors
  // upstream's `gen_littlefs_image.py` DEFAULT_DIRS; `data` is writable firmware state (see
  // `userDest`); `lang` is read through `fopen` (above). A MAPPED artifact overrides this and
  // goes to FrogFS regardless -- it is addressable memory, and only FrogFS stores a file as one
  // contiguous run.
  const toLittleFs = (dest: string): boolean =>
    dest.startsWith(CORES) || dest.startsWith(DATA) || dest.startsWith(LANG);

  // 1) All content → FrogFS dest-keyed tree (user overrides).
  const tree = new Map<string, Uint8Array>();
  const coreTree = new Map<string, Uint8Array>();
  // Which cores arrived from a SOURCE rather than the bundle. The two are indistinguishable
  // once they are in `coreTree`, and they are not interchangeable to a caller: the bundle's
  // cores are already on the device from the firmware install, a source's have never been
  // written. See `pendingLfsFiles`.
  const pendingLfsKeys = new Set<string>();
  for (const [key, data] of defaultContent) {
    if (toLittleFs(key)) {
      coreTree.set(key, new Uint8Array(data));
    } else {
      tree.set(defaultDest(key, paths), data);
    }
  }
  const mappedDests: { key: string; dest: string }[] = [];
  for (const [rel, data] of userRoms) {
    const dest = userDest(rel, paths);
    // A mapped artifact is addressable memory, so it goes to FrogFS whatever its role says --
    // this is the one case that overrides the split below. See `mappedKeys`.
    if (inputs.mappedKeys?.has(rel)) {
      mappedDests.push({ key: rel, dest });
      tree.set(dest, data);
      continue;
    }
    // Same split the bundle loop above makes, for the same reason: upstream builds the cores
    // into the LittleFS image (`gen_littlefs_image.py` DEFAULT_DIRS = ("cores",)) and FrogFS
    // from bios/covers/fonts/roms. Only `defaultContent` was ever split, so a core supplied by
    // a SOURCE went into the FrogFS tree — the path fix above alone would leave it there.
    if (toLittleFs(dest)) {
      coreTree.set(dest, new Uint8Array(data));
      pendingLfsKeys.add(dest);
    } else tree.set(dest, data);
  }
  if (inputs.lfsData) {
    for (const [key, data] of inputs.lfsData) {
      coreTree.set(key, data);
    }
  }

  // 2) Active /roms systems → omit bios/msx when no MSX games present.
  const systems = new Set<string>();
  for (const dest of tree.keys()) {
    const s = systemUnderRoms(dest, paths);
    if (s) systems.add(s);
  }
  const omittedMsxBios = !systems.has("msx");
  if (omittedMsxBios) {
    for (const dest of [...tree.keys()])
      if (dest === under(paths.bios, "msx") || dest.startsWith(under(paths.bios, "msx/")))
        tree.delete(dest);
  }

  // 2.5) Filter unselected default homebrew (e.g. celeste.bin from the firmware bundle).
  // On-device homebrew that was selected is already in `tree` via `userRoms` (readGameData).
  // But the bundle ALWAYS contains default homebrew like celeste.bin. We must prune them
  // if the user explicitly unselected them.
  if (opts?.selectedHomebrew) {
    const hbPrefix = paths.homebrew + "/";
    for (const dest of [...tree.keys()]) {
      if (!dest.startsWith(hbPrefix)) continue;
      const file = dest.slice(hbPrefix.length);
      // We only care about known titles. Unrecognized homebrew is left alone.
      // (Actually, the bundle only provides known ones, but just in case).
      const hb = opts.homebrewTitles?.find((t) => t.deviceFiles.includes(file));
      if (hb && !opts.selectedHomebrew.has(hb.key)) {
        tree.delete(dest);
      }
    }
  }

  // 2.6) Filter cores if installAllCores is false.
  // The extension is stripped generically, NOT as `.replace(".bin", "")`: a core may ship more
  // than one file, and the second is not a `.bin`. gpSP splits itself into `gba.bin` (RAM) and
  // `gba.xip` (executed in place), so the old form produced the core name `gba.xip`, which can
  // never be a member of `systems` -- it deleted the XIP half of every split core while keeping
  // the half that cannot run without it. `cores/pico8.ro` is the same shape.
  if (opts?.installAllCores === false) {
    for (const path of [...coreTree.keys()]) {
      if (path !== CORES && path.startsWith(CORES)) {
        const coreName = path.slice(CORES.length).replace(/\.[^./]+$/, "");
        if (!systems.has(coreName)) coreTree.delete(path);
      }
    }
  }

  // 3) FrogFS: stage (byteswap MD / skip-ext / .DS_Store) → lzma sidecars. Order
  //    mirrors gen_frogfs_image.py (stage_input_dirs then pack_staged_roms).
  const raw: StagedFile[] = [...tree].map(([path, data]) => ({ path, data }));
  
  const getGameBase = (path: string): string => {
    let p = path;
    const strip = [paths.covers, paths.cheats, paths.roms].find((d) => path.startsWith(d + "/"));
    if (strip !== undefined) p = path.slice(strip.length + 1);
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
  const pendingLfsFiles: StagedFile[] = coreFiles.filter((f) => pendingLfsKeys.has(f.path));

  return {
    frogfsFiles: packed.files,
    coreFiles,
    pendingLfsFiles,
    systems: [...systems].sort(),
    // From the RESOLVED paths, not literals: the firmware declares these directory names and
    // `resolveInstallPaths` is the one place that normalizes them.
    lfsDirs: [paths.cores, paths.data],
    mappedDests: [...mappedDests].sort((a, b) => (a.dest < b.dest ? -1 : a.dest > b.dest ? 1 : 0)),
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
  dirs: readonly string[] = [],
): Promise<Uint8Array> {
  const fs = await LittleFsImage.create(geom.blockSize, geom.blockCount, geom.moduleOpts);
  const made = new Set<string>();
  // The structural directories FIRST, and unconditionally: a flash firmware install writes no
  // cores, so these are the only thing in the partition and their absence reads as a failed
  // install. Sorted for deterministic image bytes, like the files below. `mkdir` is a real
  // `lfs_mkdir`, not a zero-byte file: `rg_storage`'s stat reports `is_dir`, and `opendir` on a
  // file fails, so the two are not interchangeable to the firmware.
  for (const dir of [...dirs].sort()) {
    const path = "/" + dir.replace(/^\/+|\/+$/g, "");
    if (path === "/" || made.has(path)) continue;
    fs.mkdir(path);
    made.add(path);
  }
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
    littlefs: await buildCoresLittlefs(plan.coreFiles, littlefs, plan.lfsDirs),
    plan,
  };
}
