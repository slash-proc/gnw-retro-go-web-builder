// Add files to the device's EXISTING LittleFS partition, without rebuilding it.
//
// The LittleFS partition holds the user's saves as well as the cores, so a ROM install can
// never reformat it. That is why a source-supplied core reached the device by no path at all:
// the ROM install writes FrogFS only, and the firmware install carries no source assets.
//
// The mechanism is `writeIntoLittleFs` (packages/fs-builders): mount the device's own image
// through the lazy missing-block protocol `lfsBrowser.ts` already uses for reads, write into
// it, and get back only the blocks littlefs rewrote. Those are flashed individually.
//
// ALIGNMENT. LittleFS is mounted at `minEraseSizeBytes`, so one littlefs block IS one erase
// block, and a block's write offset is `part.offset + part.size - (block + 1) * blockSize`.
// The partition's own offset and size are erase-aligned, so every offset here is too. Erasing
// at an unaligned offset hangs the device mid-erase, so this identity is checked below rather
// than trusted.
import { device } from "../device.svelte.js";
import { writeIntoLittleFs, type StagedFile } from "@gnw/fs-builders";
import { readMemoryPaced } from "./chunkedRead.js";
import { EXTBASE } from "./addr.js";
import { flashImage } from "./flasher.js";
import type { GnwFlasher, LogFn } from "@gnw/gnw-flasher";

export interface LfsWriteReport {
  filesWritten: number;
  blocksRead: number;
  blocksWritten: number;
  /** Files the device already held byte for byte. Not rewritten: see writeIntoLittleFs. */
  skipped: number;
}

export async function writeFilesToDeviceLfs(
  flasherOrGetter: GnwFlasher | ((force?: boolean) => Promise<GnwFlasher>),
  files: readonly StagedFile[],
  /** `phase` lets the caller distinguish the two halves: mounting and comparing reads the
   *  device (long, and it was completely silent), then the dirty blocks are written. */
  onProgress?: (done: number, total: number, phase: "read" | "write") => void,
  log?: LogFn,
  /** Stops the write between blocks. The block in flight finishes: a littlefs block is one
   *  erase unit, and abandoning it half-erased is the one thing this must not do. */
  abortSignal?: AbortSignal,
): Promise<LfsWriteReport> {
  if (files.length === 0) return { filesWritten: 0, blocksRead: 0, blocksWritten: 0, skipped: 0 };

  const p = device.partitions.find((p) => p.fs === "littlefs");
  if (!p) throw new Error("LittleFS partition not found.");

  const blockSize = p.meta?.blockSize ?? device.info?.minEraseSizeBytes ?? 4096;
  const blockCount = p.meta?.blockCount ?? Math.floor(p.size / blockSize);

  // The device's own erase granularity, not the mount's. They are the same thing today; if a
  // future device reports otherwise, a partial-block write would erase past its own block.
  const eraseSize = device.info?.minEraseSizeBytes ?? blockSize;
  if (blockSize % eraseSize !== 0) {
    throw new Error(`LittleFS block size ${blockSize} is not a multiple of the erase size ${eraseSize}.`);
  }

  // Blocks are numbered from the TOP of the partition down (`gen_littlefs_image.py`
  // reverse_blocks, and `lfsBrowser.ts`'s read address). Block 0 sits at the highest offset.
  const offsetOf = (block: number): number => p.offset + p.size - (block + 1) * blockSize;

  // PROVE the cache instead of discarding it.
  //
  // This used to clear the whole block cache, for a real reason: the cache is not keyed to
  // anything, a firmware install rewrites the partition underneath it, and mounting through a
  // stale one made littlefs compute its free set against a layout the device no longer had --
  // a Retro-Go install came back missing half its boot files. Correct, and expensive: every
  // write then re-read most of the partition over SWD, which is the slow step.
  //
  // The stub can answer the question directly. `gnwmanager_action_hash` hashes external flash
  // on-device in 256 KiB chunks with the H7's hardware unit and returns 32 bytes per chunk
  // (`Core/Src/gnwmanager.c`; `gnwmanager/gnw.py`'s `read_hashes`). So: ask for the partition's
  // chunk hashes, keep the cached blocks of every chunk whose hash is unchanged since those
  // blocks were read, and drop the rest. One request and 32 bytes per 256 KiB replaces reading
  // 256 KiB, and the device stays the authority.
  const HASH_CHUNK = 256 << 10;
  const chunkOf = (offset: number): number => Math.floor((offset - p.offset) / HASH_CHUNK);
  const flasherForHash =
    typeof flasherOrGetter === "function" ? await flasherOrGetter(false) : flasherOrGetter;
  let deviceHashes: string[] = [];
  try {
    const raw = await flasherForHash.readHashes(p.offset, p.size);
    deviceHashes = raw.map((h) => [...h].map((b) => b.toString(16).padStart(2, "0")).join(""));
  } catch (e) {
    // The hash is an accelerator, never a correctness requirement. If the stub cannot answer,
    // fall back to the old behaviour: trust nothing, read everything.
    log?.(`littlefs: device hashes unavailable (${e instanceof Error ? e.message : String(e)}), reading the partition`);
  }
  if (deviceHashes.length === 0) {
    device.lfsBlockCache.clear();
    device.lfsChunkHashes.clear();
  } else {
    let kept = 0;
    let dropped = 0;
    for (const block of [...device.lfsBlockCache.keys()]) {
      const c = chunkOf(offsetOf(block));
      const now = deviceHashes[c];
      if (now !== undefined && device.lfsChunkHashes.get(c) === now) { kept++; continue; }
      device.lfsBlockCache.delete(block);
      dropped++;
    }
    for (const [c, h] of deviceHashes.entries()) {
      if (device.lfsChunkHashes.get(c) !== h) device.lfsChunkHashes.delete(c);
    }
    log?.(`littlefs: ${deviceHashes.length} chunk hash(es) from the device, ${kept} cached block(s) kept, ${dropped} dropped`);
  }

  // A STALL WATCHDOG, because this step can hang forever without one.
  //
  // Every read and write below goes through the serial transport, and a wedged probe leaves a
  // transfer pending indefinitely (the same shape `contextsFree` documents: the deadline is
  // only checked after a read returns, so a read that never returns is never timed out). The
  // flash path has had a 120 s no-progress watchdog for exactly this reason; this path had
  // none, so a stalled mount showed as an install that never ended.
  //
  // No-progress, not total elapsed: a large partition legitimately takes a while, and the timer
  // resets on every block read or written.
  let lastProgress = Date.now();
  const touch = (): void => void (lastProgress = Date.now());
  const STALL_MS = 120000;
  let stallTimer: ReturnType<typeof setInterval> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    stallTimer = setInterval(() => {
      if (Date.now() - lastProgress > STALL_MS) {
        reject(new Error("The LittleFS write stalled for 120 seconds without progress."));
      }
    }, 1000);
  });
  stalled.catch(() => {}); // the race below handles it; this stops an unhandled rejection

  let result;
  try {
    result = await Promise.race([stalled, writeIntoLittleFs(
    blockSize,
    blockCount,
    new Map(files.map((f) => [f.path, f.data])),
    async (block) => {
      touch();
      // The read half is the long one: mounting and comparing walks the partition, and with no
      // progress of its own the step sat on 100% from the previous phase with only the global
      // SWD indicator moving. `blockCount` is the ceiling, not a prediction -- a mount reads far
      // fewer -- so this is a bar that advances and arrives, never a percentage to trust.
      onProgress?.(device.lfsBlockCache.size, blockCount, "read");
      const hit = device.lfsBlockCache.get(block);
      if (hit) return hit;
      // ONE READ PER BLOCK.
      //
      // Not four 1 KB reads, which is what this was, and not a 64 KiB window either, which is
      // what I replaced it with: the window cut round trips 16x and multiplied bytes 16x, and
      // bytes are what costs here. littlefs asks for 16 to 64 bytes at a time (`read_size`,
      // `cache_size` in wasm/lfs_wrapper.c) and our block device faults a whole block, so the
      // amplification is already 64x before any window is added on top.
      const want = offsetOf(block);
      const one = await readMemoryPaced(device.transport!, EXTBASE + want, blockSize, {
        chunkSize: blockSize,
      });
      device.lfsBlockCache.set(block, one);
      // Record which device state this block was read against, so a later write can keep it.
      const c = chunkOf(want);
      if (deviceHashes[c] !== undefined) device.lfsChunkHashes.set(c, deviceHashes[c]);
        return one;
      },
    )]);
  } catch (e) {
    clearInterval(stallTimer);
    throw e;
  }

  let written = 0;
  for (const { block, data } of result.dirty) {
    const offset = offsetOf(block);
    if (offset % eraseSize !== 0) {
      throw new Error(`LittleFS block ${block} lands at unaligned offset 0x${offset.toString(16)}.`);
    }
    // BETWEEN blocks, never inside one. Checked before the write rather than after, so a stop
    // confirmed during the previous block does not start another.
    if (abortSignal?.aborted) throw new Error("Operation aborted");
    await flashImage(flasherOrGetter, 0, offset, data, undefined, log, {
      compress: true,
      verify: false,
      abortSignal,
    });
    // The device now holds what we just wrote; keep the read cache from going stale under it.
    device.lfsBlockCache.set(block, data);
    written++;
    touch();
    onProgress?.(written, result.dirty.length, "write");
  }
  clearInterval(stallTimer);

  // The tree on screen predates this write.
  device.installedLfsTree = null;

  log?.(
    `littlefs: partition ${blockCount} blocks of ${blockSize} B, ${result.fetched.length} read, ` +
      `${result.dirty.length} dirty, ${result.skipped} file(s) already identical`,
  );
  return {
    filesWritten: files.length - result.skipped,
    blocksRead: result.fetched.length,
    blocksWritten: written,
    skipped: result.skipped,
  };
}
