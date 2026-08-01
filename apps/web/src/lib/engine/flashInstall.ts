/**
 * Flash-install engine glue — turns a fetched artifact bundle + the user's ROM
 * folder into a flashable install, then writes it to the device.
 *
 * Pipeline (docs/FROGFS_PIPELINE.md, docs/BINARY_PATCHING.md):
 *   bundle.contentFor(bank,false) + userRoms ──planFlashImage──▶ FrogFS tree + cores tree
 *   ──buildFrogfsFromPlan──▶ FrogFS image      (measure length)
 *   ──planFlashLayout──▶ extflash geometry      (8 MiB LittleFS floor + budget)
 *   ──buildCoresLittlefs──▶ cores LittleFS image
 *   ──patchSuperblock──▶ patched intflash blob  (host-set extflash geometry)
 *
 * Then flash three regions: intflash blob → chosen bank; FrogFS → extflash bottom;
 * LittleFS → extflash top. The `lzmaRaw` for ROM `.lzma` sidecars is the patcher's
 * byte-exact WASM liblzma (loadLiblzma).
 */
import {
  planFlashImage,
  planFlashLayout,
  buildFrogfsFromPlan,
  buildCoresLittlefs,
  type FlashLayout,
  type FlashAssemblyPlan,
} from "@gnw/fs-builders";
import { patchSuperblock } from "@gnw/gnw-patch";
import type { GnwFlasher, LogFn, ProgressFn } from "@gnw/gnw-flasher";
import littlefsWasmUrl from "@gnw/fs-builders/vendor/littlefs-wasm/littlefs.wasm?url";
import { loadLiblzma } from "./patch.js";
import { flashImage } from "./flasher.js";
import type { FirmwareBundle } from "../artifacts.js";

export interface FlashInstallInputs {
  bundle: FirmwareBundle;
  /** 1 = overwrite stock (0x08000000), 2 = keep stock for dual-boot (0x08100000). */
  bank: 1 | 2;
  /** Detected total extflash size, bytes (gnw-flasher info().externalFlashSizeBytes). */
  extflashSize: number;
  /** Device's min erase/block size, bytes (info().minEraseSizeBytes). The LittleFS
   *  image MUST use the device's actual erase size or it won't mount. */
  blockSize: number;
  /** User folder scan: "<system>/<file>" → bytes ("nes/mario.nes"); "bios/*" → /bios. */
  userRoms: Map<string, Uint8Array>;
  /** Expert: bytes reserved at the extflash bottom = the FrogFS base offset (default 0). */
  reservedOffset?: number;
  /** Existing FrogFS state from the device to preserve file data ordering/alignment. */
  frogfsState?: { order: string[]; dataStart: number };
  /** Explicit LittleFS size request (bytes). undefined = auto (remaining space). */
  littlefsLength?: number;
  /** Explicit override of the intflash payload (e.g. custom fw). undefined = use bundle. */
  blobOverride?: Uint8Array;
  /** Debug: patch the layout superblock into the intflash blob (default true). Set false
   *  to flash a blob whose geometry is already baked in — isolates "is the superblock the
   *  problem, or the LittleFS image?". */
  patchSuperblockEnabled?: boolean;
  /** Explicit files to inject into the LittleFS partition (e.g. migrating saves/config). */
  lfsData?: Map<string, Uint8Array>;
  /** Options passed down to planFlashImage for filtering (e.g. unselected homebrew). */
  opts?: {
    selectedHomebrew?: Set<string>;
    homebrewTitles?: { key: string; deviceFiles: string[] }[];
    installAllCores?: boolean;
  };
  /** If true, uses the SD card blob and skips FrogFS/LittleFS image building. */
  sdCard?: boolean;
  /** Fired right after each real internal sub-operation completes — lets callers drive a
   *  named sub-step checklist without this function needing to know about any UI reporter.
   *  `"frogfs"`/`"littlefs"`/`"superblock"` are the Flash-mode steps. The sdCard path only
   *  ever fires `"sdcache"` once (a distinct name from `"superblock"` even though both patch
   *  the same underlying struct — self-descriptive of WHAT it does, matching frogfs/littlefs,
   *  not the generic patching mechanism: it sets the round-robin ROM-cache's reserved-offset
   *  boundary, not FrogFS/LittleFS geometry, which SD firmware doesn't use). */
  onStep?: (step: "frogfs" | "littlefs" | "superblock" | "sdcache") => void;
}

export interface FlashInstall {
  bank: 1 | 2;
  /** Patched intflash blob (layout superblock written) → flash to the bank. */
  intflash: Uint8Array;
  /** FrogFS image → flash to extflash at layout.frogfsOffset. Empty if sdCard is true. */
  frogfs: Uint8Array;
  /** LittleFS (cores + room for saves) → flash to extflash at layout.littlefsOffset. Empty if sdCard is true. */
  littlefs: Uint8Array;
  layout: FlashLayout;
  plan: FlashAssemblyPlan;
  sdCard?: boolean;
}

export class BudgetError extends Error {}

/** Build a flashable install (no device I/O). Throws BudgetError if it won't fit. */
export async function buildFlashInstall(inp: FlashInstallInputs): Promise<FlashInstall> {
  const lzmaRaw = await loadLiblzma();
  
  if (inp.sdCard) {
    const blobKey = `sd_${inp.bank}` as keyof typeof inp.bundle.blobs;
    const baseBlob = inp.blobOverride ?? inp.bundle.blobs[blobKey];
    if (!baseBlob) throw new Error("SD blob missing from bundle.");

    // WHY: SD firmware's round-robin ROM-cache allocator (Core/Src/gw_flash_alloc.c's
    // circular_flash_write, via gw_layout_reserved_size()) reads the superblock's
    // reservedOffset field to know where it's safe to start writing — keeping it clear of
    // whatever this device ACTUALLY has reserved (existing OFW backups/asset blocks, the FAT
    // module store). Without patching it, the cache falls back to whatever __EXTFLASH_OFFSET__
    // was compiled into this blob at CI build time (0 unless upstream overrides it) — on a
    // dual-boot device with real reserved data past that point, the cache can write over it.
    // `reservedOffset` here is the SAME host-scanned value Flash mode uses to place FrogFS
    // (see RomSection.svelte/Wizard.svelte's `reservedOffset`/`defaultFrogfsOffset`) — this was
    // already being computed and passed in, just silently discarded by this branch until now.
    // `frogfsOffset` is a required superblock field but is functionally inert for SD builds
    // (rg_frogfs.c is compiled out when SD_CARD != 0) — 0 is a valid placeholder.
    const reservedOffset = inp.reservedOffset ?? 0;
    const intflash = (inp.patchSuperblockEnabled ?? true)
      ? patchSuperblock(baseBlob, { frogfsOffset: 0, reservedOffset })
      : baseBlob.slice();
    inp.onStep?.("sdcache");

    // Return empty mock structures for sdCard installs since content sync is handled separately
    return {
      bank: inp.bank,
      intflash,
      frogfs: new Uint8Array(0),
      littlefs: new Uint8Array(0),
      layout: { fits: true, frogfsOffset: 0, littlefsLength: 0, littlefsOffset: 0, littlefsBlockCount: 0, blockSize: inp.blockSize, freeBytes: 0, reservedOffset, frogfsLength: 0, deviceEndOffset: 0, aligned: true },
      plan: { frogfsFiles: [], coreFiles: [], systems: [], stats: { frogfsFiles: 0, coreFiles: 0, compressed: 0, skipped: 0, omittedMsxBios: false } },
      sdCard: true
    };
  }

  const plan = planFlashImage({
    // Content for THIS bank — cores embed bank-specific firmware callback pointers.
    defaultContent: inp.bundle.contentFor(inp.bank, false),
    userRoms: inp.userRoms,
    lzmaRaw,
    compress: false,
    opts: inp.opts,
    lfsData: inp.lfsData,
  });
  const frogfs = buildFrogfsFromPlan(plan, {
    previousOrder: inp.frogfsState?.order,
    dataStart: inp.frogfsState?.dataStart,
  });
  inp.onStep?.("frogfs");
  const coresSize = plan.coreFiles.reduce((n, f) => n + f.data.length, 0);

  const layout = planFlashLayout({
    extflashSize: inp.extflashSize,
    frogfsLength: frogfs.length,
    coresSize,
    blockSize: inp.blockSize,
    reservedOffset: inp.reservedOffset,
    littlefsLength: inp.littlefsLength,
  });
  if (!layout.fits) {
    const over = (-layout.freeBytes / (1024 * 1024)).toFixed(1);
    throw new BudgetError(
      `Content doesn't fit this extflash: FrogFS ${(frogfs.length / 1048576).toFixed(1)} MiB + ` +
        `LittleFS ${(layout.littlefsLength / 1048576).toFixed(1)} MiB exceeds ` +
        `${(inp.extflashSize / 1048576).toFixed(0)} MiB by ${over} MiB. Remove some ROMs.`,
    );
  }

  const littlefs = await buildCoresLittlefs(plan.coreFiles, {
    blockSize: layout.blockSize,
    blockCount: layout.littlefsBlockCount,
    moduleOpts: { locateFile: () => littlefsWasmUrl },
  });
  inp.onStep?.("littlefs");

  const baseBlob = inp.blobOverride ?? inp.bundle.blobs[inp.bank];
  const intflash =
    (inp.patchSuperblockEnabled ?? true)
      ? patchSuperblock(baseBlob, {
          frogfsOffset: layout.frogfsOffset,
          frogfsLength: frogfs.length,
          extflashSize: inp.extflashSize,
          littlefsLength: layout.littlefsLength,
        })
      : baseBlob.slice();
  inp.onStep?.("superblock");

  return { bank: inp.bank, intflash, frogfs, littlefs, layout, plan };
}

/** A built FrogFS image for a version-agnostic ROM install (no layout/superblock). */
export interface FrogfsImage {
  frogfs: Uint8Array;
  plan: FlashAssemblyPlan;
}

/**
 * Build JUST a FrogFS image (no device I/O, no layout/superblock) for a ROM install:
 * assets (+ user ROMs) repacked. Empty `userRoms` ⇒ an assets-only, bootable FrogFS;
 * a populated folder ⇒ assets + ROMs. Cores are NOT touched here — they live in the
 * LittleFS partition written at base install, and this image never includes them.
 */
export async function buildFrogfsImage(
  bundle: FirmwareBundle,
  bank: 1 | 2,
  userRoms: Map<string, Uint8Array>,
  opts?: { installAllCores?: boolean; selectedHomebrew?: Set<string>; homebrewTitles?: { key: string; deviceFiles: string[] }[] }
): Promise<FrogfsImage> {
  // RAW (uncompressed) ROMs for execute-in-place — no per-ROM .lzma sidecars (no on-device
  // decompress → no heap OOM). lzmaRaw is unused in raw mode but the planner still wants it.
  const lzmaRaw = await loadLiblzma();
  // `bank` is required, not defaulted: homebrew/core binaries in this tree call back into
  // firmware at bank-specific absolute addresses, so guessing here would reintroduce the
  // 0x0810cdcd hardfault.
  const plan = planFlashImage({ defaultContent: bundle.contentFor(bank, false), userRoms, lzmaRaw, compress: false, opts });
  return { frogfs: buildFrogfsFromPlan(plan), plan };
}

/**
 * Flash ONLY the FrogFS region at `frogfsOffset`, leaving intflash, LittleFS, cores and
 * SAVES untouched. Safe because the firmware locates FrogFS by `frogfsOffset` + the image's
 * own `bin_sz` header, and the LittleFS partition base is pinned by the superblock — so a
 * different-sized FrogFS is fine as long as it fits below `ceilingOffset` (the LittleFS base).
 * Fits-check first: throws BudgetError if the image would overrun the gap.
 */
export async function flashFrogfsRegion(
  flasherOrGetter: GnwFlasher | ((force?: boolean) => Promise<GnwFlasher>),
  frogfs: Uint8Array,
  geom: { frogfsOffset: number; ceilingOffset: number },
  onProgress?: ProgressFn,
  log?: LogFn,
): Promise<void> {
  const mib = (n: number) => (n / 1048576).toFixed(1);
  const available = geom.ceilingOffset - geom.frogfsOffset;
  if (geom.frogfsOffset + frogfs.length > geom.ceilingOffset) {
    throw new BudgetError(
      `ROMs don't fit the FrogFS gap: image ${mib(frogfs.length)} MiB exceeds the ` +
        `${mib(available)} MiB before LittleFS. Remove some ROMs.`,
    );
  }
  // No read-back verify — same rationale as flashRegion() below: the device's own
  // BAD_HASH_RAM(_COMPRESSED) check + chunk-retry handshake already catch transport
  // corruption, and a redundant read-back roughly triples WebUSB transaction count,
  // increasing exposure to ST-Link-clone USB-saturation stalls/reboots mid-write.
  await flashImage(flasherOrGetter, 0, geom.frogfsOffset, frogfs, onProgress, log, {
    compress: true,
    verify: false,
  });
}

export type FlashRegion = "intflash" | "frogfs" | "littlefs";
export const FLASH_REGIONS: readonly FlashRegion[] = ["intflash", "frogfs", "littlefs"];

/** Flash one region: intflash → its bank, FrogFS → extflash bottom, LittleFS → top. */
async function flashRegion(
  flasherOrGetter: GnwFlasher | ((force?: boolean) => Promise<GnwFlasher>),
  install: FlashInstall,
  region: FlashRegion,
  onProgress?: (phase: FlashRegion, done: number, total: number) => void,
  log?: LogFn,
): Promise<void> {
  // LZMA transfer, no read-back verify — the device's own BAD_HASH_RAM(_COMPRESSED) check
  // plus the chunk-retry handshake already catch transport corruption, same as gnwmanager's
  // reference Python (which never reads back a context-buffer write either). The read-back
  // this used to force on every chunk roughly tripled the WebUSB transaction count per
  // transfer for no benefit the device-side hash check doesn't already provide, and was found
  // to be a major contributor to mid-flash hangs/resets (ST-Link-clone USB saturation). The
  // flasher auto-skips compression per buffer when it doesn't shrink (e.g. already-compressed
  // ROMs).
  const opts = { compress: true, verify: false };
  const report: ProgressFn = (done, total) => onProgress?.(region, done, total);
  if (region === "intflash") {
    const CHUNK_SIZE = 262144;
    for (let offset = 0; offset < install.intflash.length; offset += CHUNK_SIZE) {
      const chunk = install.intflash.subarray(offset, offset + CHUNK_SIZE);
      const chunkReport: ProgressFn = (done) => report(offset + done, install.intflash.length);
      await flashImage(flasherOrGetter, install.bank, offset, chunk, chunkReport, log, opts);
      await new Promise((r) => setTimeout(r, 50));
    }
  } else if (region === "frogfs") {
    await flashImage(flasherOrGetter, 0, install.layout.frogfsOffset, install.frogfs, report, log, opts);
  } else {
    await flashImage(flasherOrGetter, 0, install.layout.littlefsOffset, install.littlefs, report, log, opts);
  }
}

/**
 * Write a built install to the device. By default all three regions (intflash bank +
 * FrogFS + LittleFS); pass `regions` to flash a subset (e.g. just the patched intflash).
 */
export async function flashInstallToDevice(
  flasherOrGetter: GnwFlasher | ((force?: boolean) => Promise<GnwFlasher>),
  install: FlashInstall,
  onProgress?: (phase: FlashRegion, done: number, total: number) => void,
  log?: LogFn,
  regions: readonly FlashRegion[] = FLASH_REGIONS,
  /** Fired right before/after each region's bytes are written — lets callers drive a named
   *  per-region sub-step checklist (mirrors buildFlashInstall's onStep) without this function
   *  needing to know about any UI reporter. */
  onRegion?: (region: FlashRegion, event: "start" | "done") => void,
): Promise<void> {
  const effectiveRegions = install.sdCard ? ["intflash"] as const : regions;
  for (const region of FLASH_REGIONS) {
    if (effectiveRegions.includes(region)) {
      onRegion?.(region, "start");
      await flashRegion(flasherOrGetter, install, region, onProgress, log);
      onRegion?.(region, "done");
    }
  }
}
