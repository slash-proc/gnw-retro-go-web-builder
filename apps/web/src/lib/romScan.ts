/**
 * ROM folder scan — turns a user-picked directory into the `userRoms` map that
 * feeds the flash-install pipeline (engine/flashInstall.ts → @gnw/fs-builders).
 *
 * The map is keyed by the path RELATIVE to the picked folder ("nes/mario.nes",
 * "bios/pce/syscard3.pce"): the top segment is the system (retro-go `/roms/<system>`),
 * and a top-level `bios/` folder merges into `/bios`. That's exactly what
 * planFlashImage expects (it routes `bios/*` → /bios, everything else → /roms/*).
 *
 * Chromium-only (File System Access API), matching the WebUSB requirement.
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
  /** The picked directory handle — kept so the location can be remembered + re-scanned later. */
  dir: RomDirHandle;
}

// Minimal File System Access API surface (not all in lib.dom yet).
/** A picked ROM directory handle (re-usable to remember + re-scan the location). */
export type RomDirHandle = FsDirHandle;
interface FsDirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]>;
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

const isHidden = (name: string): boolean => name.startsWith(".");

async function walk(
  dir: FsDirHandle,
  prefix: string,
  out: Map<string, Uint8Array>,
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (isHidden(name)) continue; // .DS_Store, .git, … (the pipeline also drops .DS_Store)
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await walk(handle, rel, out);
    } else {
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
  const userRoms = new Map<string, Uint8Array>();
  await walk(dir, "", userRoms);
  return { userRoms, summary: summarize(userRoms), dir };
}

/** Browser support check (Chromium). */
export const folderPickerSupported = (): boolean =>
  typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

const CONSOLE_DIRS = new Set([
  "nes", "snes", "gb", "gbc", "gba", "sms", "gg", "md", "pce", "sg", "gw"
]);

async function getValidRoot(dir: FsDirHandle): Promise<FsDirHandle | null> {
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
        return romsFolder;
      }
    }
  }

  return null;
}

/**
 * Prompt for a folder then scan it. Returns null if the user cancels the picker.
 */
export async function pickAndScanRomFolder(): Promise<RomScanResult | null> {
  if (!folderPickerSupported()) {
    throw new Error("This browser doesn't support folder selection (Chromium required).");
  }
  let dir: FsDirHandle;
  try {
    dir = await window.showDirectoryPicker!({ id: "gnw-roms", mode: "read" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null; // user cancelled
    throw e;
  }

  const validRoot = await getValidRoot(dir);
  if (!validRoot) {
    throw new Error("Invalid folder selected. Please select your 'roms' folder containing console subfolders (e.g., nes, gbc, md).");
  }

  return scanRomDirectory(validRoot);
}
