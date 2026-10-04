// Official Firmware flow: detect/validate genuine stock dumps, back them up to a
// user-picked folder (gnwmanager naming), and patch+flash the stock firmware into a
// Retro-Go dual-boot. Detection hashes the dumps against gnwmanager's stock-ROM SHA-1s
// (cli/gnw_patch/{mario,zelda}.py); the patch itself runs in engine/patch.ts (byte-exact
// ported engine + WASM liblzma). Ported from frontend/patch.js.
import type { GnwFlasher } from "@gnw/gnw-flasher";
import { patchModel } from "./patch.js";
import { flashImage, dumpRegion } from "./flasher.js";
import { LOCKED_MODEL } from "./itcmModel.js";
export { detectModelFromItcm } from "./itcmModel.js";
import { dbg, dbgLog } from "../debug.js";
import { hashHex } from "../cryptoHash.js";
import { electronDirHandle, electronFs } from "../electronFs.js";
import bootloaderUrl from "@gnw/gnw-patch/vendor/gnw_bootloader_0x08032000.bin?url";
import unlockPayloadUrl from "@gnw/gnw-flasher/blobs/unlock.bin?url";
import { formatNumber } from "../util.js";

export type OfwModel = "mario" | "zelda";

/** Bank-1 offset the SD bootloader is linked for — 0x08000000 + 200 KiB. The patched
 *  internal image is deliberately capped at 200 KiB in bootloader mode to leave this
 *  region free (see gnw-patch's _common_prepare port), so the two never overlap. */
const BOOTLOADER_OFFSET = 200 << 10; // 0x32000 → flashed at 0x08032000

const SHEET_OFFSET = 8192; // mario external hash excludes the trailing save bank
const INTERNAL_STOCK_LEN = 0x20000; // 128 KiB stock internal image (also the patch-engine input size)
const GNWMANAGER_INTERNAL_READ_CHUNK = INTERNAL_STOCK_LEN;
const GNWMANAGER_EXTERNAL_READ_CHUNK = 256 << 10;
let unlockPayload: Uint8Array | null = null;

interface DeviceDesc {
  name: string;
  internalSha1: string;
  externalSha1: string;
  /** Slice of the external dump that the stock hash is taken over. */
  externalSlice: (b: Uint8Array) => Uint8Array;
  externalSizeMiB: number;
}

/** Stock-ROM SHA-1s (gnwmanager cli/gnw_patch/{mario,zelda}.py). External hashes are over
 *  RAW dump bytes: Mario hashes ext[:-8192]; Zelda hashes ext[0x20000:0x3254A0]. */
export const DEVICES: Record<OfwModel, DeviceDesc> = {
  mario: {
    name: "MARIO",
    internalSha1: "efa04c387ad7b40549e15799b471a6e1cd234c76",
    externalSha1: "eea70bb171afece163fb4b293c5364ddb90637ae",
    externalSlice: (b) => b.subarray(0, Math.max(0, b.length - SHEET_OFFSET)),
    externalSizeMiB: 1,
  },
  zelda: {
    name: "ZELDA",
    internalSha1: "ac14bcea6e4ff68c88fd2302c021025a2fb47940",
    externalSha1: "1c1c0ed66d07324e560dcd9e86a322ec5e4c1e96",
    externalSlice: (b) => b.subarray(0x20000, 0x3254a0),
    externalSizeMiB: 4,
  },
};

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  return hashHex("SHA-1", bytes);
}

export interface DetectResult {
  /** The model whose stock internal ROM matched, or null if none did. */
  model: OfwModel | null;
  internalOk: boolean;
  externalOk: boolean;
  internalSha1: string;
  externalSha1: string;
}

/** Detect the model from the internal dump and validate both dumps are genuine stock
 *  backups. Tolerates a larger internal dump by also checking its leading 128 KiB. */
export async function detectDevice(intBytes: Uint8Array, extBytes: Uint8Array): Promise<DetectResult> {
  const intCandidates = [intBytes];
  if (intBytes.length > INTERNAL_STOCK_LEN) intCandidates.push(intBytes.subarray(0, INTERNAL_STOCK_LEN));
  const intHashes = await Promise.all(intCandidates.map(sha1Hex));

  for (const model of Object.keys(DEVICES) as OfwModel[]) {
    const dev = DEVICES[model];
    if (!intHashes.includes(dev.internalSha1)) continue;
    const slice = dev.externalSlice(extBytes);
    const extHash = slice.length > 0 ? await sha1Hex(slice) : "(slice out of range)";
    return {
      model,
      internalOk: true,
      externalOk: extHash === dev.externalSha1,
      internalSha1: intHashes[0],
      externalSha1: extHash,
    };
  }
  return { model: null, internalOk: false, externalOk: false, internalSha1: intHashes[0], externalSha1: "" };
}

// --- Backup file naming (gnwmanager cli/_unlock.py) ------------------------------------
export const intBackupName = (m: OfwModel): string => `internal_flash_backup_${m}.bin`;
export const extBackupName = (m: OfwModel): string => `flash_backup_${m}.bin`;
export const itcmBackupName = (m: OfwModel): string => `itcm_backup_${m}.bin`;
const unverifiedInternalName = (m: OfwModel): string => `internal_flash_unverified_${m}.bin`;

// --- Device-side dump -----------------------------------------------------------------
export interface BackupDumps {
  internal: Uint8Array; // 128 KiB stock internal (bank 1)
  external: Uint8Array; // full external flash (bank 0)
}

export type LockedBackupStage =
  | "identify"
  | "read-external"
  | "save-external"
  | "reuse-external"
  | "flash-payload"
  | "power-cycle"
  | "read-internal"
  | "verify-backups"
  | "restore-external"
  | "done";
export type LockedBackupProgress = (
  stage: LockedBackupStage,
  done?: number,
  total?: number,
  outcome?: "error",
) => void;

/** The GnWManager unlock payload paints the display blue before its cold-boot copy is done.
 * A blue screen alone therefore does not prove that the required power-cycle happened. Only
 * resume in place once the PC reaches the payload's post-copy loop (either model's ITCM base). */
export async function isLockedBackupBlueScreen(transport: {
  halt(): Promise<void>;
  readWord(addr: number): Promise<number>;
  readRegister(name: string): Promise<number>;
}): Promise<boolean> {
  let halted = false;
  try {
    if (!(await isLockedBackupBlueDisplay(transport))) return false;
    await transport.halt();
    halted = true;
    if (!(await isLockedBackupBlueDisplay(transport))) {
      await transport.resume();
      halted = false;
      return false;
    }
    const pc = (await transport.readRegister("pc")) >>> 0;
    const address = pc & ~1;
    const copyComplete = (address >= 0x4e2 && address <= 0x4ea) || (address >= 0x502 && address <= 0x50a);
    dbg(`[locked-backup] blue-screen signature; PC=0x${pc.toString(16)} copyComplete=${copyComplete}`);
    const matches = copyComplete;
    if (!matches) {
      // The payload is still copying SRAM. Let it continue and poll again shortly.
      await transport.resume();
      halted = false;
    }
    return matches;
  } catch (error) {
    if (halted) await transport.resume().catch(() => {});
    dbg(`[locked-backup] blue-screen probe failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** True as soon as the payload has painted its blue screen, even while its SRAM copy runs. */
export async function isLockedBackupBlueDisplay(transport: {
  readWord(addr: number): Promise<number>;
}, onDiagnostic?: (detail: string) => void): Promise<boolean> {
  try {
    const words: number[] = [];
    for (const address of [0x50001084, 0x5000109c, 0x50001104, 0x5000102c])
      words.push((await transport.readWord(address)) >>> 0);
    const matches = words[0] === 0 && words[1] === 0xff0000ff && words[2] === 0 && words[3] === 0;
    onDiagnostic?.(`${words.map((word) => word.toString(16).padStart(8, "0")).join(" ")} match=${matches}`);
    return matches;
  } catch (error) {
    const message = `read failed: ${error instanceof Error ? error.message : String(error)}`;
    onDiagnostic?.(message);
    dbg(`[locked-backup] blue-display probe failed: ${message}`);
    return false;
  }
}

/** The payload paints blue before copying flash to SRAM. Confirm it reached its watchdog
 * loop after the copy before reading SRAM. Zelda's ITCM image is based at offset 0x20,
 * which shifts the payload's PC addresses by 0x20. */
async function waitForLockedPayloadCopy(transport: {
  halt(): Promise<void>;
  resume(): Promise<void>;
  readRegister(name: string): Promise<number>;
}, model: OfwModel, abortSignal?: AbortSignal): Promise<void> {
  const COPY_COMPLETE_PC_MIN = 0x4e2 + LOCKED_MODEL[model].itcmOffset;
  const COPY_COMPLETE_PC_MAX = 0x4ea + LOCKED_MODEL[model].itcmOffset;
  const isCopyComplete = (pc: number) => {
    const address = (pc >>> 0) & ~1;
    return address >= COPY_COMPLETE_PC_MIN && address <= COPY_COMPLETE_PC_MAX;
  };
  let pc = (await transport.readRegister("pc")) >>> 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (abortSignal?.aborted) throw new Error("Operation aborted");
    if (isCopyComplete(pc)) {
      dbg(`[locked-backup] payload copy complete; PC=0x${pc.toString(16)} after ${attempt} resume(s)`);
      return;
    }
    await transport.resume();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await transport.halt();
    pc = (await transport.readRegister("pc")) >>> 0;
  }
  throw new Error(`Blue-screen payload did not reach its post-copy loop (PC 0x${pc.toString(16)}); internal SRAM was not read.`);
}

/** Reuse the original ITCM signature captured before a prior attempt modified extflash.
 *  Identify by content hash, not by filename; include legacy dated backup folders. */
async function findSavedItcm(dir: BackupDir, expectedModel?: OfwModel): Promise<{ model: OfwModel; bytes: Uint8Array } | null> {
  const dirs = [dir];
  for await (const [name, handle] of dir.entries())
    if (handle.kind === "directory" && name.startsWith("backups-")) dirs.push(handle);
  let match: { model: OfwModel; bytes: Uint8Array } | null = null;
  for (const source of dirs) {
    for await (const [, handle] of source.entries()) {
      if (handle.kind !== "file") continue;
      const file = await handle.getFile();
      if (file.size !== 1300) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      for (const model of (expectedModel ? [expectedModel] : Object.keys(LOCKED_MODEL)) as OfwModel[])
        if (await sha1Hex(bytes) === LOCKED_MODEL[model].itcmSha1) {
          if (expectedModel) return { model, bytes };
          if (match && match.model !== model) return null;
          match = { model, bytes };
        }
    }
  }
  return match;
}

/** Dump the stock internal (128 KiB) + full external flash over the loaded RAM util.
 *  `extSize` comes from the device info (externalFlashSizeBytes). */
export async function dumpBackup(
  flasher: GnwFlasher,
  extSize: number,
  report?: (done: number, total: number, label: string) => void,
  abortSignal?: AbortSignal,
): Promise<BackupDumps> {
  const total = INTERNAL_STOCK_LEN + extSize;
  if (abortSignal?.aborted) throw new Error("Operation aborted");
  const internal = await dumpRegion(flasher, 1, 0, INTERNAL_STOCK_LEN, (d) =>
    report?.(d, total, "internal flash"),
  );
  if (abortSignal?.aborted) throw new Error("Operation aborted");
  const external = await dumpRegionInChunks(flasher, 0, 0, extSize, GNWMANAGER_EXTERNAL_READ_CHUNK, (d) =>
    report?.(INTERNAL_STOCK_LEN + d, total, "external flash"), abortSignal,
  );
  return { internal, external };
}

/** Match GnWManager's DeviceModel.read_external_flash() operation boundaries. Its host
 *  backend reads external flash in 256 KiB calls; keep the same boundaries here while the
 *  SWD transport handles probe-specific packetization underneath. */
async function dumpRegionInChunks(
  flasher: GnwFlasher,
  bank: number,
  offset: number,
  size: number,
  chunkSize: number,
  onProgress?: (done: number, total: number) => void,
  abortSignal?: AbortSignal,
): Promise<Uint8Array> {
  const result = new Uint8Array(size);
  for (let done = 0; done < size;) {
    if (abortSignal?.aborted) throw new Error("Operation aborted");
    const length = Math.min(chunkSize, size - done);
    const chunk = await dumpRegion(flasher, bank, offset + done, length, (chunkDone) =>
      onProgress?.(done + chunkDone, size),
    );
    if (chunk.byteLength !== length)
      throw new Error(`Short flash read at 0x${(offset + done).toString(16)}: got ${chunk.byteLength} of ${length} bytes`);
    result.set(chunk, done);
    done += length;
    if (abortSignal?.aborted) throw new Error("Operation aborted");
  }
  return result;
}

/** Read a stock backup from an RDP-locked device using gnwmanager's unlock payload, without
 * clearing RDP. The caller must write and hash-verify the returned pair before unlocking. */
export async function dumpLockedBackup(
  deps: {
    transport: () => { readMemory(addr: number, len: number, onProgress?: (done: number, total: number) => void, reportProgress?: boolean, requestSize?: number): Promise<Uint8Array>; setClockFrequency(hz: number): Promise<void>; halt(): Promise<void>; resume(): Promise<void>; readRegister(name: string): Promise<number> };
    initialSwdClockHz: number;
    persistSwdClockHz: (hz: number) => void;
    reconnect: () => Promise<void>;
    ensureStub: (forceReboot?: boolean) => Promise<GnwFlasher>;
    /** Used only to choose a saved ITCM snapshot while resuming a blue-screen read. */
    expectedModel?: OfwModel;
    requestPowerCycle: (abortSignal?: AbortSignal) => Promise<void>;
    requestReadFailureChoice: (message: string, nextSwdClockHz: number, abortSignal?: AbortSignal) => Promise<"retry" | "restore" | "stop">;
    resumeFromBlueScreen?: boolean;
  },
  backupDir: BackupDir,
  existingBackups: FoundBackup[] = [],
  progress?: LockedBackupProgress,
  abortSignal?: AbortSignal,
): Promise<{ model: OfwModel; dumps: BackupDumps; directory: BackupDir }> {
  if (abortSignal?.aborted) throw new Error("Operation aborted");
  // Do not try protected reads against a merely attached adapter. Ensure the flasher/recovery
  // stub is live before probing ITCM or external flash; stock firmware can reject SWD reads.
  let flasher: GnwFlasher | null = deps.resumeFromBlueScreen ? null : await deps.ensureStub();
  if (abortSignal?.aborted) throw new Error("Operation aborted");
  progress?.("identify");
  let savedItcm: Awaited<ReturnType<typeof findSavedItcm>> = null;
  let model: OfwModel | null = null;
  let itcm = new Uint8Array();
  if (deps.resumeFromBlueScreen) {
    // ITCM has been replaced by the running payload. A saved snapshot is the only safe
    // source, and when multiple devices share a directory it must match the known target.
    savedItcm = await findSavedItcm(backupDir, deps.expectedModel);
    model = savedItcm?.model ?? null;
    itcm = savedItcm?.bytes ?? itcm;
    if (!savedItcm)
      throw new Error("Blue-screen mode is active, but no verified ITCM backup for this device is available to resume safely.");
  } else {
    // Always identify the connected console first. A directory may contain another device's
    // ITCM and firmware pair; selecting the first saved signature can make a Mario console
    // silently reuse Zelda data (or the reverse).
    if (!flasher) flasher = await deps.ensureStub();
    for (const candidate of Object.keys(LOCKED_MODEL) as OfwModel[]) {
      const sig = LOCKED_MODEL[candidate];
      const bytes = await deps.transport().readMemory(sig.itcmOffset, 1300);
      if (abortSignal?.aborted) throw new Error("Operation aborted");
      if (await sha1Hex(bytes) === sig.itcmSha1) {
        model = candidate;
        itcm = bytes;
        break;
      }
    }
    if (model) {
      savedItcm = await findSavedItcm(backupDir, model);
      if (savedItcm) itcm = savedItcm.bytes;
    }
  }
  if (!model) throw new Error("Unable to identify stock firmware from its ITCM hash; device was not changed.");
  if (!savedItcm) {
    // Persist the original ITCM before any external-flash writes, matching GnWManager's
    // resume behavior. Subsequent retries can rebuild the payload without depending on the
    // device still running original code.
    await writeFile(backupDir, itcmBackupName(model), itcm);
    if (abortSignal?.aborted) throw new Error("Operation aborted");
    const saved = new Uint8Array(await (await (await backupDir.getFileHandle(itcmBackupName(model))).getFile()).arrayBuffer());
    if (await sha1Hex(saved) !== LOCKED_MODEL[model].itcmSha1)
      throw new Error("Saved ITCM backup failed hash verification; device was not changed.");
  }
  const dev = DEVICES[model];
  const extSize = dev.externalSizeMiB * (1 << 20);
  const target = backupDir;
  const existingExternal = existingBackups.find((backup) => backup.model === model && backup.externalOk);
  let external: Uint8Array;
  if (existingExternal) {
    // A prior attempt already captured this exact stock image. Rehash and reuse it so a retry
    // of the internal read does not spend time dumping external flash again.
    external = existingExternal.external;
    if (external.length !== extSize || await sha1Hex(dev.externalSlice(external)) !== dev.externalSha1)
      throw new Error("Saved external stock firmware failed hash verification; device was not changed.");
    if (abortSignal?.aborted) throw new Error("Operation aborted");
    progress?.("reuse-external");
  } else {
    if (deps.resumeFromBlueScreen)
      throw new Error("The blue-screen payload is running, but no verified external backup is available to resume safely.");
    if (!flasher) flasher = await deps.ensureStub();
    progress?.("read-external", 0, extSize);
    external = await dumpRegionInChunks(flasher, 0, 0, extSize, GNWMANAGER_EXTERNAL_READ_CHUNK,
      (d, t) => progress?.("read-external", d, t), abortSignal);
    if (abortSignal?.aborted) throw new Error("Operation aborted");
    if (await sha1Hex(dev.externalSlice(external)) !== dev.externalSha1)
      throw new Error("External stock firmware hash mismatch; device was not changed.");
    progress?.("save-external");
    await writeFile(target, extBackupName(model), external);
    const externalFile = await (await target.getFileHandle(extBackupName(model))).getFile();
    if (abortSignal?.aborted) throw new Error("Operation aborted");
    if (await sha1Hex(dev.externalSlice(new Uint8Array(await externalFile.arrayBuffer()))) !== dev.externalSha1)
      throw new Error("Saved external backup failed hash verification; device was not changed.");
  }
  let modifiedExternal: Uint8Array | null = null;
  if (!deps.resumeFromBlueScreen) {
    if (!unlockPayload) unlockPayload = new Uint8Array(await (await fetch(unlockPayloadUrl)).arrayBuffer());
    modifiedExternal = new Uint8Array(external);
    const payloadOffset = LOCKED_MODEL[model].payloadOffset;
    if (payloadOffset + unlockPayload.length > external.length || unlockPayload.length > itcm.length)
      throw new Error("Unlock payload does not fit the detected stock firmware.");
    for (let i = 0; i < unlockPayload.length; i++)
      modifiedExternal[payloadOffset + i] = unlockPayload[i] ^ itcm[i] ^ external[payloadOffset + i];
  }

  // The validated external dump is already saved to disk before temporarily replacing it.
  let internal = new Uint8Array();
  let previousRejectedInternal: Uint8Array | null = null;
  let scalarReadDiagnosticDone = false;
  let readSwdClockHz = deps.initialSwdClockHz;
  let diskPair: FoundBackup | undefined;
  let internalReadFailed = false;
  let userChoseStop = false;
  try {
    if (!deps.resumeFromBlueScreen) {
      progress?.("flash-payload");
      // Acquire through the getter so flashImage can force a clean RAM-stub boot and retry
      // after a mailbox counter desync. Passing the cached object directly made this write
      // non-retryable: on the first failed chunk the catch below restored stock firmware,
      // skipping the cold boot that produces the blue screen and internal read.
      await flashImage(
        (forceReboot) => deps.ensureStub(forceReboot), 0, 0, modifiedExternal!,
        (done, total) => progress?.("flash-payload", done, total),
        dbgLog("locked-backup-payload"),
        { abortSignal },
      );
      if (abortSignal?.aborted) throw new Error("Operation aborted");
      progress?.("power-cycle");
      await deps.requestPowerCycle(abortSignal);
    }
    // Match gnwmanager: after the payload's cold boot, halt before reading the staged SRAM.
    // Retry the read a bounded number of times automatically; after that, the user can retry
    // in place while the blue-screen payload is still running, without reflashing or power-cycling.
    const readAndValidateInternal = async (): Promise<Uint8Array> => {
      let actualInternalHash = "";
      // Announce this stage before the payload wait. The wait can fail before an SRAM transfer
      // starts; otherwise recovery jumps straight to restoring external flash while the UI
      // misleadingly leaves internal read pending.
      progress?.("read-internal", 0, INTERNAL_STOCK_LEN);
      try {
        // The power-cycle prompt can now continue as soon as the screen turns blue;
        // wait for the payload's SRAM copy loop before reading the staged firmware.
        await waitForLockedPayloadCopy(deps.transport(), model, abortSignal);
      } catch (error) {
        progress?.("read-internal", undefined, undefined, "error");
        throw error;
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (abortSignal?.aborted) throw new Error("Operation aborted");
        progress?.("read-internal", 0, INTERNAL_STOCK_LEN);
        try {
          await deps.transport().halt();
          const data = await deps.transport().readMemory(0x24000000, INTERNAL_STOCK_LEN,
            (d, t) => progress?.("read-internal", d, t), true, GNWMANAGER_INTERNAL_READ_CHUNK);
          if (abortSignal?.aborted) throw new Error("Operation aborted");
          internal = data;
          actualInternalHash = await sha1Hex(data);
          dbg(`[locked-backup] SRAM read ${attempt}/3 SHA-1 ${actualInternalHash}${actualInternalHash === dev.internalSha1 ? " (valid)" : " (mismatch)"}`);
          // Compare a few words through DAP_Transfer (readWord) against the bulk
          // DAP_TransferBlock dump. This separates bad MEM-AP block transfers from
          // a bad target address/state without rereading the whole 128 KiB.
          if (!scalarReadDiagnosticDone && actualInternalHash !== dev.internalSha1) {
            scalarReadDiagnosticDone = true;
            const scalarTransport = deps.transport();
            const samples = [
              { offset: 0x80, words: 8 },
              { offset: 0x1f000, words: 4 },
              { offset: 0x1f310, words: 4 },
              { offset: 0x1fff0, words: 4 },
            ];
            try {
              for (const sample of samples) {
                const bulkView = new DataView(data.buffer, data.byteOffset + sample.offset, sample.words * 4);
                const bulk = Array.from({ length: sample.words }, (_, i) =>
                  bulkView.getUint32(i * 4, true).toString(16).padStart(8, "0"),
                ).join("");
                const scalarWords: string[] = [];
                for (let i = 0; i < sample.words; i++) {
                  const word = await scalarTransport.readWord(0x24000000 + sample.offset + i * 4);
                  scalarWords.push((word >>> 0).toString(16).padStart(8, "0"));
                }
                dbg(`[locked-backup] SRAM scalar compare offset=0x${sample.offset.toString(16)} words=${sample.words} bulk=${bulk} scalar=${scalarWords.join("")}`);
              }
              const widthTransport = scalarTransport as typeof scalarTransport & {
                readMemoryUnitAtWidth?: (addr: number, widthBytes: 1 | 2 | 4) => Promise<number>;
              };
              if (widthTransport.readMemoryUnitAtWidth) {
                for (const offset of [0x80, 0x1f000, 0x1f310, 0x1fff0]) {
                  const addr = 0x24000000 + offset;
                  const values: string[] = [];
                  for (const width of [1, 2, 4] as const) {
                    const value = await widthTransport.readMemoryUnitAtWidth(addr, width);
                    values.push(`${width}B=0x${value.toString(16).padStart(8, "0")}`);
                  }
                  dbg(`[locked-backup] SRAM width probe offset=0x${offset.toString(16)} ${values.join(" ")}`);
                }
              }
            } catch (error) {
              dbg(`[locked-backup] SRAM scalar comparison failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          if (previousRejectedInternal) {
            let changedBytes = 0;
            let changedBlocks = 0;
            let firstChanged = -1;
            let lastChanged = -1;
            for (let off = 0; off < data.length; off += 1024) {
              let blockChanged = false;
              const end = Math.min(data.length, off + 1024);
              for (let i = off; i < end; i++) {
                if (data[i] !== previousRejectedInternal[i]) {
                  changedBytes++;
                  blockChanged = true;
                }
              }
              if (blockChanged) {
                changedBlocks++;
                if (firstChanged < 0) firstChanged = off;
                lastChanged = off;
              }
            }
            dbg(`[locked-backup] SRAM repeat comparison: ${changedBytes} bytes changed in ${changedBlocks}/128 1 KiB blocks${firstChanged < 0 ? "" : ` (0x${firstChanged.toString(16)}–0x${lastChanged.toString(16)})`}`);
          }
          previousRejectedInternal = data.slice();
          if (actualInternalHash === dev.internalSha1) {
            if (readSwdClockHz !== deps.initialSwdClockHz) deps.persistSwdClockHz(readSwdClockHz);
            return data;
          }
        } catch (error) {
          progress?.("read-internal", undefined, undefined, "error");
          throw error;
        }
        if (attempt < 3) {
          if (deps.resumeFromBlueScreen) await waitForLockedPayloadCopy(deps.transport(), model, abortSignal);
          else await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      progress?.("verify-backups");
      // The transfer completed, but its bytes did not constitute a valid firmware dump. Mark
      // both the unusable read and the hash-validation stage failed in the modal.
      progress?.("read-internal", undefined, undefined, "error");
      progress?.("verify-backups", undefined, undefined, "error");
      // Keep the last rejected read for diagnosis, separate from the canonical backup file.
      // It remains untrusted and is never used by the patch or unlock path.
      await writeFile(target, unverifiedInternalName(model), internal);
      throw new Error(`Internal stock firmware hash mismatch after 3 reads (actual SHA-1 ${actualInternalHash}); rejected bytes saved as ${unverifiedInternalName(model)}.`);
    };

    while (true) {
      internalReadFailed = false;
      try {
        internal = await readAndValidateInternal();
        break;
      } catch (error) {
        if (abortSignal?.aborted) throw error;
        internalReadFailed = true;
        const message = error instanceof Error ? error.message : String(error);
        const nextSwdClockHz = Math.max(1_000_000, Math.floor(readSwdClockHz / 2));
        const choice = await deps.requestReadFailureChoice(message, nextSwdClockHz, abortSignal);
        if (choice === "retry") {
          if (nextSwdClockHz < readSwdClockHz) {
            await deps.transport().setClockFrequency(nextSwdClockHz);
            readSwdClockHz = nextSwdClockHz;
            dbg(`[locked-backup] user retry lowering SWD clock to ${readSwdClockHz} Hz`);
          } else {
            dbg(`[locked-backup] user retry stays at minimum SWD clock ${readSwdClockHz} Hz`);
          }
          continue;
        }
        userChoseStop = choice === "stop";
        throw error;
      }
    }

    progress?.("verify-backups");
    try {
      if (abortSignal?.aborted) throw new Error("Operation aborted");
      const validated = await detectDevice(internal, external);
      if (abortSignal?.aborted) throw new Error("Operation aborted");
      if (validated.model !== model || !validated.internalOk || !validated.externalOk)
        throw new Error("Combined stock firmware hash verification failed.");
      progress?.("verify-backups");
      await writeBackupInto(target, model, { internal, external });
      if (abortSignal?.aborted) throw new Error("Operation aborted");
      diskPair = (await scanBackupFolder(target)).find((b) => b.model === model && b.internalOk && b.externalOk);
      if (!diskPair) throw new Error("Saved firmware backups did not pass hash verification.");
    } catch (error) {
      progress?.("verify-backups", undefined, undefined, "error");
      throw error;
    }
  } catch (e) {
    if (internalReadFailed && userChoseStop) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`${message} The temporary read payload remains on the device; retry the backup later or restore the saved external firmware.`);
    }
    // The original external image is still held in memory. Restore it on cancel/failure too.
    try {
      progress?.("restore-external");
      // A physical target power-cycle can leave the probe's SWD session stale. gnwmanager
      // closes/reopens its backend around this same step; do the equivalent before attempting
      // recovery so a transient transfer-count error doesn't strand the temporary payload.
      await deps.reconnect();
      await flashImage(
        () => deps.ensureStub(), 0, 0, external,
        (done, total) => progress?.("restore-external", done, total),
        dbgLog("locked-backup-restore"),
      );
      // flashImage waits for the device to hash-check every programmed 256 KiB block and
      // reports completion only after the device is idle. A second SWD dump of the whole
      // external image would duplicate that verification and add hundreds of KiB of traffic.
      progress?.("done");
    } catch (restoreError) {
      throw new Error(`Backup failed (${e instanceof Error ? e.message : String(e)}); restoring stock external flash also failed (${restoreError instanceof Error ? restoreError.message : String(restoreError)}).`);
    }
    throw e;
  }

  // Return to untouched stock firmware before any caller can reach ensureUnlocked().
  progress?.("restore-external");
  await flashImage(
    () => deps.ensureStub(), 0, 0, external,
    (done, total) => progress?.("restore-external", done, total),
    dbgLog("locked-backup-restore"),
  );
  // flashImage returns after the device has hash-verified every block and reached IDLE.
  if (!diskPair) throw new Error("Saved firmware backups did not pass hash verification; do not unlock the device.");
  progress?.("done");
  return { model, dumps: { internal: diskPair.internal, external: diskPair.external }, directory: target };
}

/** Restore a previously hash-validated external stock image from the selected folder. This is
 *  intentionally usable when the internal read failed after the temporary payload was flashed. */
export async function restoreSavedExternal(
  dir: BackupDir,
  model: OfwModel,
  flasherOrGetter: GnwFlasher | ((force?: boolean) => Promise<GnwFlasher>),
  progress?: (done: number, total: number) => void,
): Promise<void> {
  const backup = (await scanBackupFolder(dir)).find((b) => b.model === model && b.externalOk);
  if (!backup) throw new Error(`No hash-verified ${model} external firmware dump was found in the selected folder.`);
  const desc = DEVICES[model];
  if (await sha1Hex(desc.externalSlice(backup.external)) !== desc.externalSha1)
    throw new Error("The saved external firmware failed hash verification; it will not be flashed.");
  await flashImage(flasherOrGetter, 0, 0, backup.external, progress, dbgLog("locked-backup-recovery"));
  // flashImage returns only after the device has hash-verified every block and reached IDLE.
}


// --- Patch + flash --------------------------------------------------------------------
export type ProgressReport = (
  done: number,
  total: number,
  sub?: { value: number; max: number; label: string },
) => void;

/** Patch validated stock dumps into a dual-boot image and flash internal→bank1 +
 *  external→bank0. Progress is weighted across the two images (overall) with a per-bank
 *  sub-bar, mirroring the Retro-Go flash flow. Patching itself is CPU-only (no progress)
 *  so the bars sit indeterminate until the first flash starts. */
export async function patchAndFlash(
  flasherOrGetter: GnwFlasher | ((force?: boolean) => Promise<GnwFlasher>),
  model: OfwModel,
  internal: Uint8Array,
  external: Uint8Array,
  options: Record<string, unknown>,
  report: ProgressReport,
  abortSignal?: AbortSignal,
  extFlashBytes = 0,
): Promise<void> {
  // Abort is checked HERE as well as downstream, for the same reason restoreStock does it:
  // `flashImage` forwards the signal and GnwFlasher.flash()/program() refuse an aborted
  // operation before touching the bus, but this is a destructive write and must not rely
  // solely on a precondition owned by another package. Same error shape as that precondition
  // (packages/gnw-flasher/src/index.ts) so callers keep matching one message. Checked before
  // patching too: patchModel is pure CPU work on the dumps with no device or filesystem side
  // effects, so there is nothing to skip except seconds of wasted work on an already-cancelled
  // operation.
  if (abortSignal?.aborted) throw new Error("Operation aborted");

  const res = await patchModel(model, internal, external, options);
  // Hard capacity guard: the patched external image must fit the device's external flash chip
  // (e.g. a Zelda 4 MB external can't be flashed onto a 1 MB Mario chip).
  if (extFlashBytes > 0 && res.external.length > extFlashBytes) {
    throw new Error(
      `Patched external image is ${formatNumber(res.external.length / 1048576, 2, 2)} MB but this device's ` +
        `external flash is only ${formatNumber(extFlashBytes / 1048576, 2, 2)} MB — it won't fit.`,
    );
  }
  // In bootloader (dual-boot) mode the SD bootloader is a THIRD image, flashed into the
  // 200 KiB-onward region of bank 1 that the patch deliberately leaves free. gnwmanager
  // does this as a separate `flash-bootloader` step; the browser flow has to do it inline
  // or the device is left with a dual-boot firmware and no bootloader to boot with.
  const wantBootloader = options.bootloader === true;
  const boot = wantBootloader
    ? new Uint8Array(await (await fetch(bootloaderUrl)).arrayBuffer())
    : new Uint8Array(0);
  if (boot.length && res.internal.length > BOOTLOADER_OFFSET) {
    throw new Error(
      `Patched internal image is ${res.internal.length} bytes, which overlaps the bootloader ` +
        `region at 0x${(0x08000000 + BOOTLOADER_OFFSET).toString(16)} — refusing to flash.`,
    );
  }

  // ONE bank-1 image, ONE erase. gnwmanager needs two passes only because `flash-patch`
  // and `flash-bootloader` are separate CLI invocations; we build both images in the same
  // call, so there's no reason to erase bank 1 twice, acquire a second context and re-probe
  // the stub in between. The bootloader lives at a fixed offset inside the same bank, so
  // this is just a splice: patched image at 0, bootloader at 200 KiB, 0xFF in any gap
  // (0xFF = erased state, and the same fill the flasher's own padBytes uses).
  const bank1 = boot.length ? new Uint8Array(BOOTLOADER_OFFSET + boot.length) : res.internal;
  if (boot.length) {
    bank1.fill(0xff);
    bank1.set(res.internal, 0);
    bank1.set(boot, BOOTLOADER_OFFSET);
  }

  const intLen = bank1.length;
  const total = intLen + res.external.length;
  await flashImage(flasherOrGetter, 1, 0, bank1, (d, t) =>
    report(d, total, { value: d, max: t, label: "internal → bank 1" }),
    // Was `undefined`: this flow discarded the flasher's own status-transition log
    // (`status: ERASE/PROGRAM/...`), which is exactly what identifies where a stall
    // happens. flashRegion() has always passed its log through; this one never did.
    dbgLog("ofw-flash"),
    { abortSignal }
  );
  // Between the two writes: an abort raised during the (long) internal write must not be
  // followed by starting the external one.
  if (abortSignal?.aborted) throw new Error("Operation aborted");
  if (res.external.length) {
    await flashImage(flasherOrGetter, 0, 0, res.external, (d, t) =>
      report(intLen + d, total, { value: d, max: t, label: "external → bank 0" }),
      // Was `undefined`: this flow discarded the flasher's own status-transition log
      // (`status: ERASE/PROGRAM/...`), which is exactly what identifies where a stall
      // happens. flashRegion() has always passed its log through; this one never did.
      dbgLog("ofw-flash"),
      { abortSignal }
    );
  }
}

// --- Backup-folder filesystem helpers (File System Access API, Chromium) ----------------
// A writable directory handle surface (lib.dom doesn't fully type the FS Access API yet).
interface FsWritable {
  write(data: BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
}
interface FsDirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
}
type DirPicker = (opts?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FsDirHandle>;

export type BackupDir = FsDirHandle;

export const backupPickerSupported = (): boolean =>
  typeof window !== "undefined" && (typeof (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker === "function" || !!electronFs());

/** Prompt for a read/write backup folder. Returns null if the user cancels. */
export async function pickBackupFolder(): Promise<BackupDir | null> {
  const desktop = electronFs();
  if (desktop) {
    const picked = await desktop.pickDirectory("gnw-ofw-backups");
    return picked ? electronDirHandle(picked.rootId, picked.name) : null;
  }
  const picker = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
  if (!picker) throw new Error("This browser doesn't support folder selection (Chromium required).");
  try {
    return await picker({ id: "gnw-ofw-backups", mode: "readwrite" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null; // cancelled
    throw e;
  }
}

export interface FoundBackup {
  model: OfwModel;
  internal: Uint8Array;
  external: Uint8Array;
  internalOk: boolean;
  externalOk: boolean;
  /** Physical size of the canonical internal file, even when its contents fail validation. */
  internalFileSize?: number;
  /** Whether a file for this model exists, including a canonical file that failed its hash. */
  internalPresent?: boolean;
  externalPresent?: boolean;
  /** Physical size of the canonical external file, even when its contents fail validation. */
  externalFileSize?: number;
}

type FlatBackupScan = { found: FoundBackup[]; hits: BackupProbeHit[] };

/** Hash-classify plausible dumps independent of filenames. New backups are flat; also inspect
 *  old dated backup subfolders so existing backups made by earlier versions remain usable. */
async function scanFlatBackupFolder(dir: BackupDir): Promise<FlatBackupScan> {
  const dirs = [dir];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory" && name.startsWith("backups-")) dirs.push(handle);
  }
  const candidates: { file: File; bytes: Uint8Array }[] = [];
  const internalFileSizes = new Map<OfwModel, { size: number; modified: number }>();
  const externalFileSizes = new Map<OfwModel, { size: number; modified: number }>();
  for (const source of dirs) {
    for await (const [, handle] of source.entries()) {
      if (handle.kind !== "file") continue;
      const file = await handle.getFile();
      for (const model of Object.keys(DEVICES) as OfwModel[]) {
        if (file.name === intBackupName(model)) {
          const previous = internalFileSizes.get(model);
          if (!previous || file.lastModified >= previous.modified)
            internalFileSizes.set(model, { size: file.size, modified: file.lastModified });
        }
        if (file.name === extBackupName(model)) {
          const previous = externalFileSizes.get(model);
          if (!previous || file.lastModified >= previous.modified)
            externalFileSizes.set(model, { size: file.size, modified: file.lastModified });
        }
      }
      const plausible = file.size === INTERNAL_STOCK_LEN ||
        (Object.values(DEVICES) as DeviceDesc[]).some((d) => file.size === d.externalSizeMiB * 1048576);
      if (plausible) candidates.push({ file, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
  }
  candidates.sort((a, b) => b.file.lastModified - a.file.lastModified);

  const internals = new Map<OfwModel, { bytes: Uint8Array; file: File }>();
  const externals = new Map<OfwModel, { bytes: Uint8Array; file: File }>();
  for (const { bytes, file } of candidates) {
    for (const model of Object.keys(DEVICES) as OfwModel[]) {
      const desc = DEVICES[model];
      if (bytes.length === INTERNAL_STOCK_LEN && !internals.has(model) && await sha1Hex(bytes) === desc.internalSha1)
        internals.set(model, { bytes, file });
      if (bytes.length === desc.externalSizeMiB * 1048576 && !externals.has(model) &&
          await sha1Hex(desc.externalSlice(bytes)) === desc.externalSha1)
        externals.set(model, { bytes, file });
    }
  }

  const found: FoundBackup[] = [];
  const hits: BackupProbeHit[] = [];
  for (const model of Object.keys(DEVICES) as OfwModel[]) {
    const internal = internals.get(model);
    const external = externals.get(model);
    const internalFile = internalFileSizes.get(model);
    const externalFile = externalFileSizes.get(model);
    if (!internal && !external && !internalFile && !externalFile) continue;
    found.push({ model, internal: internal?.bytes ?? new Uint8Array(), external: external?.bytes ?? new Uint8Array(),
      internalOk: !!internal, externalOk: !!external,
      internalPresent: !!internal || !!internalFile,
      externalPresent: !!external || !!externalFile,
      internalFileSize: internal?.file.size ?? internalFile?.size,
      externalFileSize: external?.file.size ?? externalFile?.size });
    if (internal && external) hits.push({ model, at: Math.max(internal.file.lastModified, external.file.lastModified), dirName: dir.name });
  }
  return { found, hits };
}

/** Find stock firmware by expected hashes, not filenames. */
export async function scanBackupFolder(dir: BackupDir): Promise<FoundBackup[]> {
  return (await scanFlatBackupFolder(dir)).found;
}

/** Hash-verified backup presence for the status row. */
export interface BackupProbeHit {
  model: OfwModel;
  /** Newest `lastModified` of the pair, epoch ms. The real file date, not a local record. */
  at: number;
  /** The selected folder. */
  dirName: string;
}

export async function probeBackupFolder(dir: BackupDir): Promise<BackupProbeHit[]> {
  return (await scanFlatBackupFolder(dir)).hits;
}

/** Pick which scanned backup to pre-select: the one matching the connected hardware, else Zelda
 *  (the retro-go-only / unknown default), else the first present. Returns null for an empty list. */
export function defaultBackup(
  found: FoundBackup[],
  deviceModel: OfwModel | "unknown",
): FoundBackup | null {
  if (found.length === 0) return null;
  if (deviceModel !== "unknown") {
    const match = found.find((f) => f.model === deviceModel);
    if (match) return match;
  }
  return found.find((f) => f.model === "zelda") ?? found[0];
}

async function writeFile(dir: BackupDir, name: string, data: Uint8Array): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data as BufferSource);
  await w.close();
}

/** Write the backup pair directly into the selected folder. */
export async function writeBackup(
  dir: BackupDir,
  model: OfwModel,
  dumps: BackupDumps,
): Promise<BackupDir> {
  await writeBackupInto(dir, model, dumps);
  return dir;
}

async function writeBackupInto(target: BackupDir, model: OfwModel, dumps: BackupDumps): Promise<void> {
  await writeFile(target, intBackupName(model), dumps.internal);
  await writeFile(target, extBackupName(model), dumps.external);
}

// --- Restore to stock -----------------------------------------------------------------
/**
 * Write a validated stock backup back onto the device VERBATIM — the exact inverse of
 * `dumpBackup`, and the direct equivalent of gnwmanager's two `flash bank1 …` /
 * `flash ext …` invocations against the backup files.
 *
 * Nothing is patched, computed or re-derived here: whatever bytes came out of the device
 * (and hash-validated as genuine stock in `detectDevice`) go straight back in. The internal
 * dump is the 128 KiB stock image at bank 1 offset 0 — writing it puts the stock reset
 * vector/SP back at 0x08000000, which is what actually makes the device boot the original
 * firmware again. The external dump goes to bank 0 offset 0.
 *
 * Deliberately NOT done here (see the wizard's Restore step for the user-facing rationale):
 *  - Anything above the stock image inside bank 1 (e.g. a dual-boot bootloader at
 *    0x08032000) is left untouched. It is unreachable once the stock vector table is back —
 *    the same thing gnwmanager's restore leaves behind — and erasing it would mean a second
 *    erase/program pass of bank 1 for no functional gain.
 *  - Anything above `external.length` on a larger external flash chip (leftover Retro-Go
 *    FrogFS/LittleFS content) is left untouched. Stock firmware never reads past its own
 *    region, so those bytes are inert, and blanking up to 16 MB would multiply the length of
 *    an already-destructive write window.
 *
 * Progress mirrors `patchAndFlash`: one overall total across both images, with a per-bank
 * sub-bar whose labels ("internal → bank 1" / "external → bank 0") the callers already map
 * onto their flash phases.
 */
export async function restoreStock(
  flasherOrGetter: GnwFlasher | ((force?: boolean) => Promise<GnwFlasher>),
  internal: Uint8Array,
  external: Uint8Array,
  report: ProgressReport,
  abortSignal?: AbortSignal,
  extFlashBytes = 0,
): Promise<void> {
  // Hard capacity guard, same shape as patchAndFlash's: a 4 MB Zelda external backup cannot
  // be written onto a 1 MB Mario chip. Checked here as well as in the UI so no caller can
  // start a partial write that would leave the device with neither firmware intact.
  if (extFlashBytes > 0 && external.length > extFlashBytes) {
    throw new Error(
      `Backup's external image is ${formatNumber(external.length / 1048576, 2, 2)} MB but this device's ` +
        `external flash is only ${formatNumber(extFlashBytes / 1048576, 2, 2)} MB — it won't fit.`,
    );
  }

  // Abort is checked HERE as well as downstream. `flashImage` forwards the signal and
  // GnwFlasher.flash()/program() refuse an aborted operation before touching the bus — but
  // this is the most destructive write in the app, so it does not rely solely on a
  // precondition owned by another package. Same error shape as that precondition
  // (packages/gnw-flasher/src/index.ts) so callers keep matching one message.
  if (abortSignal?.aborted) throw new Error("Operation aborted");

  const total = internal.length + external.length;
  await flashImage(flasherOrGetter, 1, 0, internal, (d, t) =>
    report(d, total, { value: d, max: t, label: "internal → bank 1" }),
    dbgLog("ofw-restore"),
    { abortSignal },
  );
  // Between the two writes: an abort raised during the (long) internal write must not be
  // followed by starting the external one.
  if (abortSignal?.aborted) throw new Error("Operation aborted");
  if (external.length) {
    await flashImage(flasherOrGetter, 0, 0, external, (d, t) =>
      report(internal.length + d, total, { value: d, max: t, label: "external → bank 0" }),
      dbgLog("ofw-restore"),
      { abortSignal },
    );
  }
}
