/**
 * Flash-install engine glue — turns a fetched artifact bundle + the user's ROM
 * folder into a flashable install, then writes it to the device.
 *
 * Pipeline (docs/FROGFS_PIPELINE.md, docs/BINARY_PATCHING.md):
 *   bundle.sdContent + userRoms ──planFlashImage──▶ FrogFS tree + cores tree
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
  /** Expert: explicit LittleFS partition size in bytes (default: auto, 8 MiB floor). */
  littlefsLength?: number;
  /** Debug: use this intflash blob instead of the bundle's CI blob for `bank` (e.g. a
   *  locally-built firmware). The FrogFS/LittleFS content still comes from the bundle. */
  blobOverride?: Uint8Array;
  /** Debug: patch the layout superblock into the intflash blob (default true). Set false
   *  to flash a blob whose geometry is already baked in — isolates "is the superblock the
   *  problem, or the LittleFS image?". */
  patchSuperblockEnabled?: boolean;
}

export interface FlashInstall {
  bank: 1 | 2;
  /** Patched intflash blob (layout superblock written) → flash to the bank. */
  intflash: Uint8Array;
  /** FrogFS image → flash to extflash at layout.frogfsOffset. */
  frogfs: Uint8Array;
  /** LittleFS (cores + room for saves) → flash to extflash at layout.littlefsOffset. */
  littlefs: Uint8Array;
  layout: FlashLayout;
  plan: FlashAssemblyPlan;
}

export class BudgetError extends Error {}

/** Build a flashable install (no device I/O). Throws BudgetError if it won't fit. */
export async function buildFlashInstall(inp: FlashInstallInputs): Promise<FlashInstall> {
  const lzmaRaw = await loadLiblzma();

  const plan = planFlashImage({
    defaultContent: inp.bundle.sdContent,
    userRoms: inp.userRoms,
    lzmaRaw,
  });
  const frogfs = buildFrogfsFromPlan(plan, {
    previousOrder: inp.frogfsState?.order,
    dataStart: inp.frogfsState?.dataStart,
  });
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
  userRoms: Map<string, Uint8Array>,
  opts?: { installAllCores?: boolean }
): Promise<FrogfsImage> {
  // RAW (uncompressed) ROMs for execute-in-place — no per-ROM .lzma sidecars (no on-device
  // decompress → no heap OOM). lzmaRaw is unused in raw mode but the planner still wants it.
  const lzmaRaw = await loadLiblzma();
  const plan = planFlashImage({ defaultContent: bundle.sdContent, userRoms, lzmaRaw, compress: false, opts: { installAllCores: opts?.installAllCores } });
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
  flasher: GnwFlasher,
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
  await flashImage(flasher, 0, geom.frogfsOffset, frogfs, onProgress, log, {
    compress: true,
    verify: true,
  });
}

export type FlashRegion = "intflash" | "frogfs" | "littlefs";
export const FLASH_REGIONS: readonly FlashRegion[] = ["intflash", "frogfs", "littlefs"];

/** Flash one region: intflash → its bank, FrogFS → extflash bottom, LittleFS → top. */
async function flashRegion(
  flasher: GnwFlasher,
  install: FlashInstall,
  region: FlashRegion,
  onProgress?: (phase: FlashRegion, done: number, total: number) => void,
  log?: LogFn,
): Promise<void> {
  // LZMA transfer + read-back verify (the flasher auto-skips compression per buffer
  // when it doesn't shrink — e.g. already-compressed ROMs).
  const opts = { compress: true, verify: true };
  const report: ProgressFn = (done, total) => onProgress?.(region, done, total);
  if (region === "intflash") {
    const CHUNK_SIZE = 262144;
    for (let offset = 0; offset < install.intflash.length; offset += CHUNK_SIZE) {
      const chunk = install.intflash.subarray(offset, offset + CHUNK_SIZE);
      const chunkReport: ProgressFn = (done) => report(offset + done, install.intflash.length);
      await flashImage(flasher, install.bank, offset, chunk, chunkReport, log, opts);
    }
  } else if (region === "frogfs") {
    await flashImage(flasher, 0, install.layout.frogfsOffset, install.frogfs, report, log, opts);
  } else {
    await flashImage(flasher, 0, install.layout.littlefsOffset, install.littlefs, report, log, opts);
  }
}

/**
 * Write a built install to the device. By default all three regions (intflash bank +
 * FrogFS + LittleFS); pass `regions` to flash a subset (e.g. just the patched intflash).
 */
export async function flashInstallToDevice(
  flasher: GnwFlasher,
  install: FlashInstall,
  onProgress?: (phase: FlashRegion, done: number, total: number) => void,
  log?: LogFn,
  regions: readonly FlashRegion[] = FLASH_REGIONS,
): Promise<void> {
  for (const region of FLASH_REGIONS) {
    if (regions.includes(region)) await flashRegion(flasher, install, region, onProgress, log);
  }
}
