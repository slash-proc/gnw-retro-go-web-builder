// Official Firmware flow: detect/validate genuine stock dumps, back them up to a
// user-picked folder (gnwmanager naming), and patch+flash the stock firmware into a
// Retro-Go dual-boot. Detection hashes the dumps against gnwmanager's stock-ROM SHA-1s
// (cli/gnw_patch/{mario,zelda}.py); the patch itself runs in engine/patch.ts (byte-exact
// ported engine + WASM liblzma). Ported from frontend/patch.js.
import type { GnwFlasher } from "@gnw/gnw-flasher";
import { patchModel } from "./patch.js";
import { flashImage, dumpRegion } from "./flasher.js";

export type OfwModel = "mario" | "zelda";

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
  flasher: GnwFlasher,
  model: OfwModel,
  internal: Uint8Array,
  external: Uint8Array,
  options: Record<string, unknown>,
  report: ProgressReport,
  extFlashBytes = 0,
): Promise<void> {
  const res = await patchModel(model, internal, external, options);
  // Hard capacity guard: the patched external image must fit the device's external flash chip
  // (e.g. a Zelda 4 MB external can't be flashed onto a 1 MB Mario chip).
  if (extFlashBytes > 0 && res.external.length > extFlashBytes) {
    throw new Error(
      `Patched external image is ${(res.external.length / 1048576).toFixed(2)} MB but this device's ` +
        `external flash is only ${(extFlashBytes / 1048576).toFixed(2)} MB — it won't fit.`,
    );
  }
  const intLen = res.internal.length;
  const total = intLen + res.external.length;
  await flashImage(flasher, 1, 0, res.internal, (d, t) =>
    report(d, total, { value: d, max: t, label: "internal → bank 1" }),
  );
  if (res.external.length) {
    await flashImage(flasher, 0, 0, res.external, (d, t) =>
      report(intLen + d, total, { value: d, max: t, label: "external → bank 0" }),
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

/** Scan a folder's TOP LEVEL for EVERY `{internal,flash}_flash_backup_{model}.bin` pair present
 *  (a folder commonly holds both Mario and Zelda) and validate each. Returns one entry per model
 *  found, in `DEVICES` order; empty if none. */
export async function scanBackupFolder(dir: BackupDir): Promise<FoundBackup[]> {
  const files = new Map<string, FsFileHandle>();
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") files.set(name, handle);
  }
  const found: FoundBackup[] = [];
  for (const model of Object.keys(DEVICES) as OfwModel[]) {
    const ih = files.get(intBackupName(model));
    const eh = files.get(extBackupName(model));
    if (!ih || !eh) continue;
    const internal = new Uint8Array(await (await ih.getFile()).arrayBuffer());
    const external = new Uint8Array(await (await eh.getFile()).arrayBuffer());
    const det = await detectDevice(internal, external);
    found.push({
      model,
      internal,
      external,
      internalOk: det.model === model && det.internalOk,
      externalOk: det.externalOk,
    });
  }
  return found;
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
