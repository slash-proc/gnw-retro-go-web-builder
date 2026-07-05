/**
 * ROM folder scan — turns a user-picked directory into the `userRoms` map that
 * feeds the flash-install pipeline (engine/flashInstall.ts → @gnw/fs-builders).
 *
 * The map is keyed by the path RELATIVE to the picked folder ("nes/mario.nes",
 * "bios/pce/syscard3.pce"): the top segment is the system (retro-go `/roms/<system>`),
 * and a top-level `bios/` folder merges into `/bios`. That's exactly what
 * planFlashImage expects (it routes `bios/*` → /bios, everything else → /roms/*).
 *
 * Supports two folder-picking strategies:
 *   1. File System Access API (`showDirectoryPicker`) — Chromium; read + write-back
 *   2. `<input webkitdirectory>` fallback — Firefox/Safari; read-only
 */

export interface SystemSummary {
  system: string; // top-level folder name ("nes", "md", "bios", …)
  files: number;
  bytes: number;
}

export interface RomScanSummary {
  /** Per top-level folder (systems + a "bios" entry if the user supplied BIOS). */
  systems: SystemSummary[];
  totalFiles: number;
  totalBytes: number;
}

export interface RomScanResult {
  /** "<system>/<file>" → bytes; "bios/*" entries merge into /bios downstream. */
  userRoms: Map<string, Uint8Array>;
  summary: RomScanSummary;
  /** The picked directory handle — kept so the location can be remembered + re-scanned later.
   *  May be a read-only shim (InputDirHandle) in Firefox. */
  dir: RomDirHandle;
  /** Whether the user picked the SD root containing a 'roms/' folder */
  hasRomsPrefix?: boolean;
}

// Minimal File System Access API surface (not all in lib.dom yet).
/** A picked ROM directory handle (re-usable to remember + re-scan the location). */
export type RomDirHandle = FsDirHandle;
interface FsDirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]>;
  /** True for native FSAA handles that support write-back (getDirectoryHandle, getFileHandle, createWritable). */
  readonly writable?: boolean;
}
interface FsFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FsDirHandle>;
  }
}

import { HOMEBREW_DEVICE_FILES, HOMEBREW_SOURCE_ROMS } from "./engine/homebrew.js";
import { download } from "./util.js";
import {
  parseCoreHeader,
  evaluateCoreVersions,
  CORE_HEADER_PROBE_BYTES,
  type CoreVersionCheck,
} from "./engine/coreVersion.js";

const isHidden = (name: string): boolean => name.startsWith(".");

async function walk(
  dir: FsDirHandle,
  prefix: string,
  out: Map<string, Uint8Array>,
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (isHidden(name)) continue; // .DS_Store, .git, … (the pipeline also drops .DS_Store)
    const rel = prefix ? `${prefix}/${name}` : name;
    const isInsideHomebrew = prefix === "homebrew" || prefix === "roms/homebrew";

    if (handle.kind === "directory") {
      // Do not recurse into subdirectories inside homebrew
      if (!isInsideHomebrew) {
        await walk(handle, rel, out);
      }
    } else {
      if (isInsideHomebrew) {
        // Cover art (celeste.png, "Zelda 3.png", …) also lives directly in homebrew/ (see
        // GameDetailsPanel.svelte's applyPreview()/getCoverUrl() in RomManagementTab.svelte)
        // — it's neither a device file nor a source ROM, so the exact-name whitelist below
        // was silently dropping it from every scan, regardless of whether it was placed
        // manually or written here by our own UI. Without this, a homebrew cover could never
        // survive a rescan/reload no matter how it got there.
        const isCoverImage = /\.(png|jpe?g|img)$/i.test(name);
        const isWhitelisted = isCoverImage || HOMEBREW_DEVICE_FILES.has(name) || HOMEBREW_SOURCE_ROMS.has(name);
        if (!isWhitelisted) continue;
      }
      const file = await handle.getFile();
      out.set(rel, new Uint8Array(await file.arrayBuffer()));
    }
  }
}

/** Build the per-system summary from a userRoms map (top segment = system). */
export function summarize(userRoms: Map<string, Uint8Array>): RomScanSummary {
  const bySystem = new Map<string, SystemSummary>();
  let totalBytes = 0;
  for (const [path, data] of userRoms) {
    const system = path.split("/")[0] || "(root)";
    const s = bySystem.get(system) ?? { system, files: 0, bytes: 0 };
    s.files += 1;
    s.bytes += data.length;
    bySystem.set(system, s);
    totalBytes += data.length;
  }
  return {
    systems: [...bySystem.values()].sort((a, b) => a.system.localeCompare(b.system)),
    totalFiles: userRoms.size,
    totalBytes,
  };
}

/** Recursively read a picked directory into a userRoms map + summary. */
export async function scanRomDirectory(dir: FsDirHandle): Promise<RomScanResult> {
  const raw = new Map<string, Uint8Array>();
  await walk(dir, "", raw);
  
  const userRoms = new Map<string, Uint8Array>();
  let hasRomsPrefix = false;
  for (const [key, val] of raw) {
    if (key.startsWith("roms/")) {
      hasRomsPrefix = true;
      userRoms.set(key.slice(5), val);
    } else {
      userRoms.set(key, val);
    }
  }

  const summary = summarize(userRoms);
  return { userRoms, summary, dir, hasRomsPrefix };
}

/** True when the native File System Access API is available (Chromium). */
export const nativeFolderPickerSupported = (): boolean =>
  typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

/** Folder picking is always supported — native FSAA in Chromium, <input webkitdirectory> fallback elsewhere. */
export const folderPickerSupported = (): boolean => true;

/** True when the dir handle supports write-back (getDirectoryHandle / getFileHandle / createWritable). */
export function dirSupportsWriteBack(dir: RomDirHandle | null | undefined): boolean {
  if (!dir) return false;
  // Native FSAA handles have getDirectoryHandle; our InputDirHandle shim does not.
  return typeof (dir as any).getDirectoryHandle === "function";
}

const CONSOLE_DIRS = new Set([
  "nes", "snes", "gb", "gbc", "sms", "gg", "md", "pce", "sg", "gw",
  "a2600", "a7800", "amstrad", "col", "msx", "tama", "videopac", "wsv"
]);

export async function getValidRoot(dir: FsDirHandle): Promise<FsDirHandle | null> {
  let hasConsoleDir = false;
  let romsFolder: FsDirHandle | null = null;

  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      const lower = name.toLowerCase();
      if (CONSOLE_DIRS.has(lower)) {
        hasConsoleDir = true;
      } else if (lower === "roms") {
        romsFolder = handle as FsDirHandle;
      }
    }
  }

  // If we found actual console folders (nes, md, etc) at the root, it's valid.
  if (hasConsoleDir) return dir;
  
  // Otherwise, if there is a 'roms' folder, check inside it for console folders.
  if (romsFolder) {
    for await (const [name, handle] of romsFolder.entries()) {
      if (handle.kind === "directory" && CONSOLE_DIRS.has(name.toLowerCase())) {
        return dir;
      }
    }
  }

  return null;
}

// ── <input webkitdirectory> fallback ─────────────────────────────────────────
// Builds an in-memory FsDirHandle tree from a FileList so the rest of the
// codebase can consume it identically to a native FSAA handle.

/** A read-only directory handle shim built from <input webkitdirectory> FileList. */
class InputDirHandle implements FsDirHandle {
  kind = "directory" as const;
  name: string;
  private children = new Map<string, InputDirHandle | InputFileHandle>();

  constructor(name: string) {
    this.name = name;
  }

  /** Insert a file at a relative path, creating intermediate directories. */
  insert(relPath: string, file: File): void {
    const parts = relPath.split("/");
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let cur: InputDirHandle = this;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let child = cur.children.get(seg);
      if (!child || child.kind !== "directory") {
        child = new InputDirHandle(seg);
        cur.children.set(seg, child);
      }
      cur = child as InputDirHandle;
    }
    const fileName = parts[parts.length - 1];
    cur.children.set(fileName, new InputFileHandle(fileName, file));
  }

  async *entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]> {
    for (const [name, handle] of this.children) {
      yield [name, handle];
    }
  }
}

class InputFileHandle implements FsFileHandle {
  kind = "file" as const;
  name: string;
  private file: File;
  constructor(name: string, file: File) {
    this.name = name;
    this.file = file;
  }
  async getFile(): Promise<File> {
    return this.file;
  }
}

/** Pick a folder via a hidden <input webkitdirectory> element. Returns null on cancel. */
function pickFolderViaInput(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // @ts-ignore — webkitdirectory is non-standard but widely supported
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);

    let resolved = false;
    input.addEventListener("change", () => {
      resolved = true;
      if (input.parentNode) document.body.removeChild(input);
      resolve(input.files && input.files.length > 0 ? input.files : null);
    });
    
    // Cancel detection is notoriously flaky across browsers. When the file dialog
    // closes, the window regains focus. In Firefox, the user has to confirm an
    // interstitial "Upload X files?" prompt. If we rely on a pure timeout from focus,
    // we often cancel prematurely while the browser is building the FileList.
    // The most robust way to detect a true cancel is to wait for the user to interact
    // with the page again (e.g. moving the mouse or clicking) after focus returns.
    window.addEventListener("focus", function onFocus() {
      window.removeEventListener("focus", onFocus);
      
      const onUserActive = () => {
        cleanup();
        if (!resolved) {
          resolved = true;
          if (input.parentNode) document.body.removeChild(input);
          resolve(null);
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onUserActive);
        window.removeEventListener("pointerdown", onUserActive);
        window.removeEventListener("keydown", onUserActive);
      };

      // Give a tiny grace period before listening for interaction, so the focus click
      // itself doesn't trigger the cancel.
      setTimeout(() => {
        if (!resolved) {
          window.addEventListener("pointermove", onUserActive, { once: true });
          window.addEventListener("pointerdown", onUserActive, { once: true });
          window.addEventListener("keydown", onUserActive, { once: true });
        }
      }, 500);
    }, { once: true });

    input.click();
  });
}

/** Build an InputDirHandle tree from a webkitdirectory FileList. */
function buildTreeFromFileList(files: FileList): InputDirHandle {
  // webkitRelativePath gives us "folderName/sub/file.ext" — the first segment
  // is the folder the user picked.
  const root = new InputDirHandle("roms");
  let rootName = "";
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relPath = (file as any).webkitRelativePath as string;
    if (!relPath) continue;

    // Strip the top-level folder name (the folder the user actually picked)
    const firstSlash = relPath.indexOf("/");
    if (firstSlash < 0) continue; // shouldn't happen with webkitdirectory
    if (!rootName) rootName = relPath.slice(0, firstSlash);
    const inner = relPath.slice(firstSlash + 1);
    if (!inner) continue;
    root.insert(inner, file);
  }
  // Use the actual folder name the user picked
  if (rootName) (root as any).name = rootName;
  return root;
}

export async function pickFolder(id: string = "gnw-roms"): Promise<FsDirHandle | null> {
  if (nativeFolderPickerSupported()) {
    try {
      return await window.showDirectoryPicker!({ id, mode: "readwrite" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }
  }

  const files = await pickFolderViaInput();
  if (!files) return null;
  return buildTreeFromFileList(files);
}

/** Pick the SD card folder and store it on the device store — the SAME picker used by
 *  FolderGateModal.svelte (ROMs tab) and Wizard.svelte's SD-mode Install Retro-Go gate, so the
 *  user is never asked to pick it twice. No-ops (silently) if the user cancels the picker. */
export async function pickSdCardFolder(): Promise<void> {
  const { device } = await import("./device.svelte.js");
  try {
    const handle = await pickFolder("gnw-sd-card");
    if (handle) {
      device.sdHandle = handle;
      await device.scanSdCardGames();
    }
  } catch {
    // cancelled
  }
}

/**
 * Prompt for a folder then scan it. Returns null if the user cancels the picker.
 * Uses the native File System Access API when available, otherwise falls back to
 * <input webkitdirectory>.
 */
export async function pickAndScanRomFolder(id: string = "gnw-roms"): Promise<RomScanResult | null> {
  const dir = await pickFolder(id);
  if (!dir) return null;

  const validRoot = await getValidRoot(dir);
  if (!validRoot) {
    throw new Error("Invalid folder selected. Please select your 'roms' folder containing console subfolders (e.g., nes, gbc, md).");
  }

  return scanRomDirectory(validRoot);
}

/**
 * Save a file to the user's picked ROM directory. Falls back to a browser
 * download if the directory handle doesn't support write-back (Firefox fallback).
 */
export async function saveFileToDirOrDownload(
  dir: RomDirHandle | null | undefined,
  relativePath: string,
  data: Blob | Uint8Array,
): Promise<void> {
  // Try native FSAA write-back first
  if (dir && dirSupportsWriteBack(dir)) {
    const parts = relativePath.split("/");
    let currentDir: any = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileName = parts[parts.length - 1];
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data instanceof Uint8Array ? new Blob([data as unknown as BlobPart]) : data);
    await writable.close();
    return;
  }

  // Fallback: trigger a browser download
  download(relativePath.split("/").pop() || "cover.png", data);
}

/** Delete a file at `relativePath` from `dir` via FSAA's removeEntry. No-op (not an error) if
 *  the file is already gone, or if `dir` doesn't support write-back (Firefox — nothing is
 *  actually persisted there to delete). */
/** Validate that every core file directly on the SD card (`cores/*.bin`) agrees with the given
 *  firmware version (and with each other, if no firmware version is known — e.g. validating a
 *  bare SD card with no connected/booted device to read a live firmware version from). Unlike
 *  the Flash/LittleFS path, plain `File` objects support `.slice()`, so this only ever reads
 *  the first `CORE_HEADER_PROBE_BYTES` of each core — cheap regardless of core count/size. */
export async function checkSdCoreVersions(
  dir: RomDirHandle | null | undefined,
  firmwareVersion: string | null,
): Promise<CoreVersionCheck> {
  const cores: Record<string, string | null> = {};
  if (dir) {
    for await (const [name, handle] of dir.entries()) {
      if (name !== "cores" || handle.kind !== "directory") continue;
      for await (const [coreName, coreHandle] of handle.entries()) {
        if (coreHandle.kind !== "file" || isHidden(coreName)) continue;
        const path = `cores/${coreName}`;
        try {
          const file = await coreHandle.getFile();
          const head = new Uint8Array(await file.slice(0, CORE_HEADER_PROBE_BYTES).arrayBuffer());
          cores[path] = parseCoreHeader(head)?.tag ?? null;
        } catch {
          cores[path] = null;
        }
      }
    }
  }
  return evaluateCoreVersions(firmwareVersion, cores);
}

export async function deleteFileFromDir(dir: RomDirHandle | null | undefined, relativePath: string): Promise<void> {
  if (!dir || !dirSupportsWriteBack(dir)) return;
  const parts = relativePath.split("/");
  let currentDir: any = dir;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    }
    await currentDir.removeEntry(parts[parts.length - 1]);
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return;
    throw e;
  }
}
