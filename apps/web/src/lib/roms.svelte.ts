// Shared ROM-folder state. ROM Management is gated on a selected ROM folder (NOT on a
// device connection — ROMs are the prerequisite; a device is only needed to flash-install
// or SD-push). The folder is picked + scanned once via romScan and reused across the tab.
// (RomSection in the Retro-Go tab can migrate onto this store later.)
import {
  pickAndScanRomFolder,
  scanRomDirectory,
  folderPickerSupported,
  summarize,
  type RomScanResult,
  type RomDirHandle,
} from "./romScan.js";
import { saveDir, loadDir, handlePermission } from "./persist.js";
import { toGWCover } from "./screenscraper/gw.js";

const COVER_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp"]);

/**
 * Convert all cover images in the userRoms map to retro-go .img (JPEG) format.
 * Runs on ingest — originals on disk are untouched; only the in-memory session
 * cache holds the converted bytes.
 */
async function convertCoversInMap(userRoms: Map<string, Uint8Array>): Promise<void> {
  const toConvert: string[] = [];
  for (const path of userRoms.keys()) {
    if (path.startsWith("covers/") && path.endsWith(".img")) continue; // already in .img format
    
    // Do not convert Pico-8 cartridges (which are .png files in the pico8/ folder)
    const lower = path.toLowerCase();
    const parts = lower.split("/");
    if (parts[0] === "pico8" && (lower.endsWith(".png") || lower.endsWith(".p8.png"))) {
      continue;
    }

    const dot = path.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = path.slice(dot).toLowerCase();
    if (COVER_IMAGE_EXTS.has(ext)) toConvert.push(path);
  }

  for (const path of toConvert) {
    try {
      const data = userRoms.get(path)!;
      const blob = new Blob([data as BlobPart]);
      const gwBlob = await toGWCover(blob);
      if (gwBlob) {
        let imgPath = path.slice(0, path.lastIndexOf(".")) + ".img";
        if (!imgPath.startsWith("covers/")) {
          imgPath = "covers/" + imgPath;
        }
        // Retain the original high-quality image in userRoms for the UI to display,
        // but generate the .img sidecar for flashing.
        userRoms.set(imgPath, new Uint8Array(await gwBlob.arrayBuffer()));
      }
    } catch (e) {
      console.warn(`Failed to convert cover ${path}:`, e);
    }
  }
}

class RomStore {
  scan = $state<RomScanResult | null>(null);
  scanning = $state(false);
  error = $state<string | null>(null);
  // A remembered folder location from a prior visit that needs a permission re-grant before use.
  pendingHandle = $state<RomDirHandle | null>(null);
  private triedRestore = false;

  /** Folder selection needs the File System Access API (Chromium). */
  get supported(): boolean {
    return folderPickerSupported();
  }

  /** A folder has been picked + scanned. */
  get selected(): boolean {
    return this.scan !== null;
  }

  /** Prompt for a folder, scan it, store the result + remember the location. No-op on cancel. */
  async pickFolder(): Promise<void> {
    this.scanning = true;
    this.error = null;
    try {
      const r = await pickAndScanRomFolder();
      if (r) {
        await convertCoversInMap(r.userRoms);
        r.summary = summarize(r.userRoms);
        this.scan = r; // null = cancelled → keep whatever was there
        this.pendingHandle = null;
        void saveDir("romDir", r.dir);
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.scanning = false;
    }
  }

  /** Silently re-adopt the last-used folder if permission is still granted (no prompt). If it
   *  needs a re-grant, stash it in `pendingHandle` so the UI can offer a reconnect button. */
  async restoreLast(): Promise<void> {
    if (this.triedRestore || this.scan || this.scanning) return;
    this.triedRestore = true;
    const handle = (await loadDir("romDir")) as RomDirHandle | null;
    if (!handle) return;
    if (await handlePermission(handle, "readwrite", false)) await this.adopt(handle);
    else this.pendingHandle = handle;
  }

  /** Re-grant + adopt the remembered folder (call from a user gesture). */
  async reconnect(): Promise<void> {
    const handle = this.pendingHandle;
    if (!handle) return;
    if (await handlePermission(handle, "readwrite", true)) {
      this.pendingHandle = null;
      await this.adopt(handle);
    }
  }

  private async adopt(handle: RomDirHandle): Promise<void> {
    this.scanning = true;
    this.error = null;
    try {
      const result = await scanRomDirectory(handle);
      await convertCoversInMap(result.userRoms);
      result.summary = summarize(result.userRoms);
      this.scan = result;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.scanning = false;
    }
  }

  clear(): void {
    this.scan = null;
    this.error = null;
    this.pendingHandle = null;
  }
}

export const roms = new RomStore();
