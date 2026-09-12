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
  relocateMappedInFrogfs,
  MappedRelocError,
  type FlashLayout,
  type FlashAssemblyPlan,
  type MappedSpec,
  type MappedResult,
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
  /**
   * `userRoms` keys whose artifact declares `mapped` -- memory the device runs in place, not a
   * file it opens. Routes the file to FrogFS whatever its role directory says, and drives the
   * relocation post-pass below. Absent/empty means nothing to do, which is every install today
   * and every SD install ever.
   */
  mappedArtifacts?: ReadonlyMap<string, MappedSpec>;
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
  onStep?: (step: "frogfs" | "littlefs" | "superblock" | "sdcache" | "mapped") => void;
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
  /** Mapped artifacts placed and (where `relocBase` applied) relocated. Empty on SD and on
   *  every install with no mapped artifact, which is all of them today. */
  mappedPlaced: MappedResult[];
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
    // module store).
    //
    // CORRECTED (this comment said the opposite until docs/RETRO_GO_EXTFLASH_WRITES.md checked
    // it): patching reservedOffset is an override that WIDENS the reservation, not the only
    // thing holding the line. An unpatched superblock does NOT fall back to __EXTFLASH_OFFSET__
    // — `gw_layout_reserved_size()` falls back to `get_ofw_extflash_size()`
    // (Core/Src/retro-go/gw_layout_superblock.c:61-67), which reads the booted OFW's own
    // extflash footprint out of bank-1 metadata (Core/Src/gw_ofw.c:38-43), and
    // `get_reserved_extflash_size()` then takes the MAX of that and __EXTFLASH_OFFSET__
    // (Core/Src/gw_flash_alloc.c:89-99). So the stock behaviour already floors the cache above
    // the OFW's assets. We patch because the firmware's own floor describes only the single
    // booted game: it does not know about OFW backups, asset blocks or the FAT module store,
    // which our host-side scan does see.
    // `reservedOffset` here is the SAME host-scanned value Flash mode uses to place FrogFS
    // (see RomSection.svelte/Wizard.svelte's `reservedOffset`/`defaultFrogfsOffset`) — this was
    // already being computed and passed in, just silently discarded by this branch until now.
    // `frogfsOffset` is a required superblock field but is functionally inert for SD builds
    // (rg_frogfs.c is compiled out when SD_CARD != 0) — 0 is a valid placeholder.
    const reservedOffset = inp.reservedOffset ?? 0;
    const intflash = (inp.patchSuperblockEnabled ?? true)
      ? patchSuperblock(baseBlob, { frogfsOffset: 0, reservedOffset, declared: inp.bundle.manifest?.dist?.firmware?.superblock })
      : baseBlob.slice();
    inp.onStep?.("sdcache");

    // Return empty mock structures for sdCard installs since content sync is handled separately
    return {
      bank: inp.bank,
      intflash,
      frogfs: new Uint8Array(0),
      littlefs: new Uint8Array(0),
      layout: { fits: true, frogfsOffset: 0, littlefsLength: 0, littlefsOffset: 0, littlefsBlockCount: 0, blockSize: inp.blockSize, freeBytes: 0, reservedOffset, frogfsLength: 0, deviceEndOffset: 0, aligned: true },
      plan: { frogfsFiles: [], coreFiles: [], pendingLfsFiles: [], systems: [], lfsDirs: [], mappedDests: [], stats: { frogfsFiles: 0, coreFiles: 0, compressed: 0, skipped: 0, omittedMsxBios: false } },
      mappedPlaced: [],
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
    mappedKeys: inp.mappedArtifacts ? new Set(inp.mappedArtifacts.keys()) : undefined,
    // Install locations come from the firmware's own manifest (`manifest.json.paths`),
    // not from constants in this repo. `bundle.manifest.dist` is the parsed manifest,
    // carried through verbatim by artifacts.ts — no new plumbing needed. Absent roles fall
    // back to the historical literals; a malformed value throws InstallPathError.
    paths: inp.bundle.manifest?.dist?.paths,
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
      `Content doesn't fit this extflash: FrogFS ${(frogfs.length / 1048576).toFixed(1)} MB + ` +
        `LittleFS ${(layout.littlefsLength / 1048576).toFixed(1)} MB exceeds ` +
        `${(inp.extflashSize / 1048576).toFixed(0)} MB by ${over} MB. Remove some ROMs.`,
    );
  }

  // RELOCATE MAPPED ARTIFACTS -- after the layout fixes `frogfsOffset`, before anything is
  // written. The address of a file executed in place is `EXTBASE + frogfsOffset + dataOffs`,
  // so it is not knowable until the image is packed AND the offset is chosen; and once patched
  // the image must not move, which is why this sits between the two and not beside either.
  // Patching does not change the image length, so `layout` stays valid.
  //
  // 1:1 with `references/game-and-watch-retro-go-sd/scripts/frogfs_pico8_ro.py`, which does
  // this to the built `frogfs.bin` at firmware build time. Refuses rather than guesses.
  //
  // Re-keyed from the input key to the packed dest, because those differ (`userDest`) and the
  // image only knows the dest.
  const mappedByDest = new Map<string, MappedSpec>();
  for (const { key, dest } of plan.mappedDests) {
    const spec = inp.mappedArtifacts?.get(key);
    if (spec) mappedByDest.set(dest, spec);
  }
  const mappedPlaced: MappedResult[] =
    mappedByDest.size > 0 ? relocateMappedInFrogfs(frogfs, layout.frogfsOffset, mappedByDest) : [];
  if (mappedPlaced.length > 0) inp.onStep?.("mapped");

  const littlefs = await buildCoresLittlefs(
    plan.coreFiles,
    {
      blockSize: layout.blockSize,
      blockCount: layout.littlefsBlockCount,
      moduleOpts: { locateFile: () => littlefsWasmUrl },
    },
    plan.lfsDirs,
  );
  inp.onStep?.("littlefs");

  const baseBlob = inp.blobOverride ?? inp.bundle.blobs[inp.bank];
  const intflash =
    (inp.patchSuperblockEnabled ?? true)
      ? patchSuperblock(baseBlob, {
          frogfsOffset: layout.frogfsOffset,
          frogfsLength: frogfs.length,
          extflashSize: inp.extflashSize,
          littlefsLength: layout.littlefsLength,
          // The manifest's own statement of the struct we are about to overwrite. A
          // GNW_LAYOUT_VERSION bump (or a resized/renamed struct) must refuse here rather
          // than write this patcher's field layout into someone's firmware. Absent for a
          // bundle with no manifest (dev blobs) — then the historical behaviour applies.
          declared: inp.bundle.manifest?.dist?.firmware?.superblock,
        })
      : baseBlob.slice();
  inp.onStep?.("superblock");

  return { bank: inp.bank, intflash, frogfs, littlefs, layout, plan, mappedPlaced };
}

/** A built FrogFS image for a version-agnostic ROM install (no layout/superblock). */
export interface FrogfsImage {
  frogfs: Uint8Array;
  plan: FlashAssemblyPlan;
  /** Where each MAPPED artifact ended up, and how many words were rebased. Empty when none. */
  mappedPlaced: MappedResult[];
}

/**
 * Build JUST a FrogFS image (no device I/O, no layout/superblock) for a ROM install:
 * assets (+ user ROMs) repacked. Empty `userRoms` ⇒ an assets-only, bootable FrogFS;
 * a populated folder ⇒ assets + ROMs. The BUNDLE's cores are NOT touched here — they live in
 * the LittleFS partition written at base install, and this image never includes them. A
 * source-supplied MAPPED artifact is the exception and belongs in this image by definition:
 * `mapped` means it must live at a real address, and only FrogFS is contiguous.
 *
 * `mappedArtifacts` is keyed by `userRoms` key; `frogfsOffset` is where this image will be
 * written. Both or neither — relocation needs the final address, and this builder does not
 * choose the offset (its caller has it from the live device), so it refuses rather than
 * guessing one.
 */
export async function buildFrogfsImage(
  bundle: FirmwareBundle,
  bank: 1 | 2,
  userRoms: Map<string, Uint8Array>,
  opts?: {
    installAllCores?: boolean;
    selectedHomebrew?: Set<string>;
    homebrewTitles?: { key: string; deviceFiles: string[] }[];
    mappedArtifacts?: ReadonlyMap<string, MappedSpec>;
    frogfsOffset?: number;
  },
  frogfsState?: { order: string[]; dataStart: number },
): Promise<FrogfsImage> {
  // RAW (uncompressed) ROMs for execute-in-place — no per-ROM .lzma sidecars (no on-device
  // decompress → no heap OOM). lzmaRaw is unused in raw mode but the planner still wants it.
  const lzmaRaw = await loadLiblzma();
  // `bank` is required, not defaulted: homebrew/core binaries in this tree call back into
  // firmware at bank-specific absolute addresses, so guessing here would reintroduce the
  // 0x0810cdcd hardfault.
  const plan = planFlashImage({
    defaultContent: bundle.contentFor(bank, false),
    userRoms,
    lzmaRaw,
    compress: false,
    opts,
    // ROUTING only: a mapped artifact must reach FrogFS even when its role says `cores/`,
    // which would otherwise send it to the LittleFS cores tree.
    mappedKeys: opts?.mappedArtifacts ? new Set(opts.mappedArtifacts.keys()) : undefined,
    // Same manifest-declared install locations as buildFlashInstall() above.
    paths: bundle.manifest?.dist?.paths,
  });
  // Same threading as buildFlashInstall() above, and for the same reason: this image goes
  // straight to flashFrogfsRegion(), the incremental differential-flash path. Preserving the
  // previous image's data-section start and file order keeps every retained file at its exact
  // byte offset, so the device's 256 KiB hash blocks still match and get skipped (~20 ms each)
  // instead of being erased and rewritten. Omitting it is not an error — just a silent full
  // rewrite, every time (see CLAUDE.md, "Incremental Flashing (FrogFS)").
  const frogfs = buildFrogfsFromPlan(plan, {
    previousOrder: frogfsState?.order,
    dataStart: frogfsState?.dataStart,
  });

  // Same post-pass as buildFlashInstall(): after the image is packed and its offset is known,
  // before it is written. See the long comment there.
  const mappedByDest = new Map<string, MappedSpec>();
  for (const { key, dest } of plan.mappedDests) {
    const spec = opts?.mappedArtifacts?.get(key);
    if (spec) mappedByDest.set(dest, spec);
  }
  let mappedPlaced: MappedResult[] = [];
  if (mappedByDest.size > 0) {
    if (opts?.frogfsOffset === undefined) {
      throw new MappedRelocError(
        `mapped artifact ${[...mappedByDest.keys()].join(", ")} needs frogfsOffset to place it`,
      );
    }
    mappedPlaced = relocateMappedInFrogfs(frogfs, opts.frogfsOffset, mappedByDest);
  }

  return { frogfs, plan, mappedPlaced };
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
  /** Stops the write at the next 256 KiB block boundary. See PhaseReporter.signal. */
  abortSignal?: AbortSignal,
): Promise<void> {
  const mib = (n: number) => (n / 1048576).toFixed(1);
  const available = geom.ceilingOffset - geom.frogfsOffset;
  if (geom.frogfsOffset + frogfs.length > geom.ceilingOffset) {
    throw new BudgetError(
      `ROMs don't fit the FrogFS gap: image ${mib(frogfs.length)} MB exceeds the ` +
        `${mib(available)} MB before LittleFS. Remove some ROMs.`,
    );
  }
  // No read-back verify — same rationale as flashRegion() below: the device's own
  // BAD_HASH_RAM(_COMPRESSED) check + chunk-retry handshake already catch transport
  // corruption, and a redundant read-back roughly triples WebUSB transaction count,
  // increasing exposure to ST-Link-clone USB-saturation stalls/reboots mid-write.
  await flashImage(flasherOrGetter, 0, geom.frogfsOffset, frogfs, onProgress, log, {
    compress: true,
    verify: false,
    abortSignal,
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
  abortSignal?: AbortSignal,
): Promise<void> {
  // LZMA transfer, no read-back verify — the device's own BAD_HASH_RAM(_COMPRESSED) check
  // plus the chunk-retry handshake already catch transport corruption, same as gnwmanager's
  // reference Python (which never reads back a context-buffer write either). The read-back
  // this used to force on every chunk roughly tripled the WebUSB transaction count per
  // transfer for no benefit the device-side hash check doesn't already provide, and was found
  // to be a major contributor to mid-flash hangs/resets (ST-Link-clone USB saturation). The
  // flasher auto-skips compression per buffer when it doesn't shrink (e.g. already-compressed
  // ROMs).
  const opts = { compress: true, verify: false, abortSignal };
  const report: ProgressFn = (done, total) => onProgress?.(region, done, total);
  if (region === "intflash") {
    const CHUNK_SIZE = 262144;
    for (let offset = 0; offset < install.intflash.length; offset += CHUNK_SIZE) {
      const chunk = install.intflash.subarray(offset, offset + CHUNK_SIZE);
      const chunkReport: ProgressFn = (done) => report(offset + done, install.intflash.length);
      await flashImage(flasherOrGetter, install.bank, offset, chunk, chunkReport, log, opts);
      // Checked between chunks as well as inside flashImage: otherwise a stop confirmed during
      // the last chunk would still sit through this settle before anything noticed.
      if (abortSignal?.aborted) throw new Error("Operation aborted");
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
  /** Stops at the next 256 KiB block boundary, inside whichever region is writing. Regions
   *  after it are never started. */
  abortSignal?: AbortSignal,
): Promise<void> {
  const effectiveRegions = install.sdCard ? ["intflash"] as const : regions;
  for (const region of FLASH_REGIONS) {
    if (effectiveRegions.includes(region)) {
      if (abortSignal?.aborted) throw new Error("Operation aborted");
      onRegion?.(region, "start");
      await flashRegion(flasherOrGetter, install, region, onProgress, log, abortSignal);
      onRegion?.(region, "done");
    }
  }
}
