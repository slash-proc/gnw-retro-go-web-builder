// Official Firmware flow: detect/validate genuine stock dumps, back them up to a
// user-picked folder (gnwmanager naming), and patch+flash the stock firmware into a
// Retro-Go dual-boot. Detection hashes the dumps against gnwmanager's stock-ROM SHA-1s
// (cli/gnw_patch/{mario,zelda}.py); the patch itself runs in engine/patch.ts (byte-exact
// ported engine + WASM liblzma). Ported from frontend/patch.js.
import type { GnwFlasher } from "@gnw/gnw-flasher";
import { patchModel } from "./patch.js";
import { flashImage, dumpRegion } from "./flasher.js";
import { dbgLog } from "../debug.js";
import bootloaderUrl from "@gnw/gnw-patch/vendor/gnw_bootloader_0x08032000.bin?url";

export type OfwModel = "mario" | "zelda";

/** Bank-1 offset the SD bootloader is linked for — 0x08000000 + 200 KiB. The patched
 *  internal image is deliberately capped at 200 KiB in bootloader mode to leave this
 *  region free (see gnw-patch's _common_prepare port), so the two never overlap. */
const BOOTLOADER_OFFSET = 200 << 10; // 0x32000 → flashed at 0x08032000

const SHEET_OFFSET = 8192; // mario external hash excludes the trailing save bank
const INTERNAL_STOCK_LEN = 0x20000; // 128 KiB stock internal image (also the patch-engine input size)

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
  const digest = await crypto.subtle.digest("SHA-1", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
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

// --- Device-side dump -----------------------------------------------------------------
export interface BackupDumps {
  internal: Uint8Array; // 128 KiB stock internal (bank 1)
  external: Uint8Array; // full external flash (bank 0)
}

/** Dump the stock internal (128 KiB) + full external flash over the loaded RAM util.
 *  `extSize` comes from the device info (externalFlashSizeBytes). */
export async function dumpBackup(
  flasher: GnwFlasher,
  extSize: number,
  report?: (done: number, total: number, label: string) => void,
): Promise<BackupDumps> {
  const total = INTERNAL_STOCK_LEN + extSize;
  const internal = await dumpRegion(flasher, 1, 0, INTERNAL_STOCK_LEN, (d) =>
    report?.(d, total, "internal flash"),
  );
  const external = await dumpRegion(flasher, 0, 0, extSize, (d) =>
    report?.(INTERNAL_STOCK_LEN + d, total, "external flash"),
  );
  return { internal, external };
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
      `Patched external image is ${(res.external.length / 1048576).toFixed(2)} MB but this device's ` +
        `external flash is only ${(extFlashBytes / 1048576).toFixed(2)} MB — it won't fit.`,
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
  typeof window !== "undefined" && typeof (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker === "function";

/** Prompt for a read/write backup folder. Returns null if the user cancels. */
export async function pickBackupFolder(): Promise<BackupDir | null> {
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
}

/** The dated subfolder `writeBackup` creates when the picked folder is not empty. */
const BACKUP_SUBDIR_PREFIX = "backups-";

/**
 * Every directory a backup pair could be in, NEWEST FIRST: the dated `backups-*` subfolders in
 * descending name order, then the picked folder itself.
 *
 * WHY THIS EXISTS. `writeBackup` puts the pair in the picked folder when that folder is empty
 * and in a `backups-<stamp>/` subfolder when it is not, but the scan only ever looked at the
 * top level. So a user who picked a folder with ANYTHING already in it had their very first
 * backup written somewhere the scan could never see, and was told they had none. Later backups
 * into an already-used folder had the same problem. The top level comes last because it is
 * where the OLDEST backup lives (it is the one written while the folder was still empty).
 *
 * The stamp sorts lexicographically exactly as it sorts chronologically (`backupStamp` is
 * zero-padded, most-significant-first), so ordering these needs no file reads at all.
 */
async function backupDirs(dir: BackupDir): Promise<BackupDir[]> {
  const subs: BackupDir[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory" && name.startsWith(BACKUP_SUBDIR_PREFIX)) subs.push(handle);
  }
  subs.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return [...subs, dir];
}

/** The two file handles of one model's pair in ONE directory, or null if either is absent. */
async function pairHandles(
  dir: BackupDir,
  model: OfwModel,
): Promise<{ internal: FsFileHandle; external: FsFileHandle } | null> {
  const files = new Map<string, FsFileHandle>();
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") files.set(name, handle);
  }
  const internal = files.get(intBackupName(model));
  const external = files.get(extBackupName(model));
  return internal && external ? { internal, external } : null;
}

/** Scan a folder (and its dated `backups-*` subfolders) for EVERY
 *  `{internal,flash}_flash_backup_{model}.bin` pair present -- a folder commonly holds both
 *  Mario and Zelda -- and validate each. Returns one entry per model found, in `DEVICES` order;
 *  empty if none. */
export async function scanBackupFolder(dir: BackupDir): Promise<FoundBackup[]> {
  const dirs = await backupDirs(dir);
  const found: FoundBackup[] = [];
  for (const model of Object.keys(DEVICES) as OfwModel[]) {
    let best: FoundBackup | null = null;
    for (const d of dirs) {
      const handles = await pairHandles(d, model);
      if (!handles) continue;
      const internal = new Uint8Array(await (await handles.internal.getFile()).arrayBuffer());
      const external = new Uint8Array(await (await handles.external.getFile()).arrayBuffer());
      const det = await detectDevice(internal, external);
      const entry: FoundBackup = {
        model,
        internal,
        external,
        internalOk: det.model === model && det.internalOk,
        externalOk: det.externalOk,
      };
      // Newest wins, and the first VALID pair ends the walk -- a folder holding many backups
      // does not get every one of them read. An invalid pair is kept only as a fallback, so a
      // corrupt newest backup can neither hide a good older one nor vanish silently when it is
      // the only thing there (the UI still has something to report as broken).
      if (entry.internalOk && entry.externalOk) {
        best = entry;
        break;
      }
      if (!best) best = entry;
    }
    if (best) found.push(best);
  }
  return found;
}

/**
 * A CHEAP "is there a backup here" probe: filenames and sizes only, no file contents.
 *
 * `scanBackupFolder` above reads every candidate in full (128 KiB internal plus up to 16 MiB
 * external) because it hash-validates against the stock SHA-1s. That is the right thing for the
 * patch flow, which is about to write those exact bytes to a device, and the wrong thing for a
 * status row that just wants to know whether the user has a backup at all. `getFile()` returns
 * a lazy `File`: `size` and `lastModified` come from the directory entry, and nothing is read
 * until something asks for the bytes.
 *
 * Returned newest first, by the same folder ordering `scanBackupFolder` uses.
 */
export interface BackupProbeHit {
  model: OfwModel;
  /** Newest `lastModified` of the pair, epoch ms. The real file date, not a local record. */
  at: number;
  /** The folder the pair actually sits in (the picked folder, or a dated subfolder). */
  dirName: string;
}

export async function probeBackupFolder(dir: BackupDir): Promise<BackupProbeHit[]> {
  const dirs = await backupDirs(dir);
  const hits: BackupProbeHit[] = [];
  for (const d of dirs) {
    for (const model of Object.keys(DEVICES) as OfwModel[]) {
      if (hits.some((h) => h.model === model)) continue; // newest already found
      const handles = await pairHandles(d, model);
      if (!handles) continue;
      const internal = await handles.internal.getFile();
      const external = await handles.external.getFile();
      // Size is the only cheap validity signal there is. A pair that cannot possibly contain a
      // stock image is not a backup, however it is named -- this is what stops a zero-byte or
      // half-written file from reading as "you are covered".
      if (internal.size < INTERNAL_STOCK_LEN) continue;
      if (external.size < DEVICES[model].externalSizeMiB * 1024 * 1024) continue;
      hits.push({
        model,
        at: Math.max(internal.lastModified, external.lastModified),
        dirName: d.name,
      });
    }
  }
  return hits;
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

/** gnwmanager's dated-backup folder name: `backups-YYYY-MM-DD-HH-MM-SS`. */
function backupStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `backups-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function isEmptyDir(dir: BackupDir): Promise<boolean> {
  for await (const [name] of dir.entries()) {
    if (!name.startsWith(".")) return false;
  }
  return true;
}

async function writeFile(dir: BackupDir, name: string, data: Uint8Array): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data as BufferSource);
  await w.close();
}

/** Write the backup pair into `dir` (if empty) or a `backups-<iso>/` subfolder (if not).
 *  Returns the directory the files actually landed in — that becomes the selected folder. */
export async function writeBackup(
  dir: BackupDir,
  model: OfwModel,
  dumps: BackupDumps,
): Promise<BackupDir> {
  const target = (await isEmptyDir(dir)) ? dir : await dir.getDirectoryHandle(backupStamp(), { create: true });
  await writeFile(target, intBackupName(model), dumps.internal);
  await writeFile(target, extBackupName(model), dumps.external);
  return target;
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
      `Backup's external image is ${(external.length / 1048576).toFixed(2)} MB but this device's ` +
        `external flash is only ${(extFlashBytes / 1048576).toFixed(2)} MB — it won't fit.`,
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
