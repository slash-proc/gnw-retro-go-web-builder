// Shared ROM-folder state. ROM Management is gated on a selected ROM folder (NOT on a
// device connection — ROMs are the prerequisite; a device is only needed to flash-install
// or SD-push). The folder is picked + scanned once via romScan and reused across the tab.
// (RomSection in the Retro-Go tab can migrate onto this store later.)
import {
  pickAndScanRomFolder,
  scanRomDirectory,
  folderPickerSupported,
  dirSupportsWriteBack,
  summarize,
  type RomScanResult,
  type RomDirHandle,
} from "./romScan.js";
import { saveDir, loadDir, handlePermission } from "./persist.js";
import { toGWCover } from "./screenscraper/gw.js";
import { device } from "./device.svelte.js";

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
  /** Set when a folder is required but not yet selected — drives FolderGateModal. */
  folderGatePrompt = $state<{
    sd: boolean;
    resolve: () => void;
    reject: (e: Error) => void;
  } | null>(null);
  savesScan = $state<RomScanResult | null>(null);
  dirtyFiles = $state<Set<string>>(new Set());
  folderScanning = $state(false);
  error = $state<string | null>(null);
  // A remembered folder location from a prior visit that needs a permission re-grant before use.
  pendingHandle = $state<RomDirHandle | null>(null);
  private triedRestore = false;

  /** Folder selection is always supported (native FSAA or webkitdirectory fallback). */
  get supported(): boolean {
    return folderPickerSupported();
  }

  /** A folder has been picked + scanned. */
  get selected(): boolean {
    return this.scan !== null;
  }

  /** Prompt for a folder, scan it, store the result + remember the location. No-op on cancel. */
  async pickFolder(): Promise<void> {
    this.folderScanning = true;
    this.error = null;
    try {
      const r = await pickAndScanRomFolder();
      if (r) {
        await convertCoversInMap(r.userRoms);
        r.summary = summarize(r.userRoms);
        this.scan = r; // null = cancelled → keep whatever was there
        this.clearDirty();
        this.pendingHandle = null;
        // Only persist native FSAA handles — InputDirHandle shims aren't structured-cloneable
        if (dirSupportsWriteBack(r.dir)) void saveDir("romDir", r.dir);
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.folderScanning = false;
    }
  }

  async pickSavesFolder(): Promise<void> {
    this.folderScanning = true;
    try {
      const result = await pickAndScanRomFolder();
      if (!result) return;
      this.savesScan = result;
    } catch (e) {
      console.error("Failed to pick saves folder", e);
    } finally {
      this.folderScanning = false;
    }
  }

  /** Silently re-adopt the last-used folder if permission is still granted (no prompt). If it
   *  needs a re-grant, stash it in `pendingHandle` so the UI can offer a reconnect button. */
  async restoreLast(): Promise<void> {
    if (this.triedRestore || this.scan || this.folderScanning) return;
    this.triedRestore = true;
    const handle = (await loadDir("romDir")) as RomDirHandle | null;
    if (!handle) return;
    if (await handlePermission(handle, "readwrite", false)) await this.adoptHandle(handle);
    else this.pendingHandle = handle;
  }

  /** Re-grant + adopt the remembered folder (call from a user gesture). */
  async reconnect(): Promise<void> {
    const handle = this.pendingHandle;
    if (!handle) return;
    if (await handlePermission(handle, "readwrite", true)) {
      this.pendingHandle = null;
      await this.adoptHandle(handle);
    }
  }

  async adoptHandle(handle: RomDirHandle): Promise<void> {
    this.folderScanning = true;
    this.error = null;
    try {
      const result = await scanRomDirectory(handle);
      await convertCoversInMap(result.userRoms);
      result.summary = summarize(result.userRoms);
      this.scan = result;
      this.clearDirty();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.folderScanning = false;
    }
  }

  clear(): void {
    this.scan = null;
    this.savesScan = null;
    this.clearDirty();
    this.error = null;
    this.pendingHandle = null;
  }

  /** Ensure the required folders are available. Resolves immediately if already satisfied;
   *  otherwise surfaces FolderGateModal and waits for the user to provide them. */
  async ensureFolders(sd: boolean): Promise<void> {
    if (this.selected && (!sd || !!device.sdHandle)) return;
    return new Promise<void>((resolve, reject) => {
      this.folderGatePrompt = { sd, resolve, reject };
    });
  }

  /** Always surface FolderGateModal, even if folders are already satisfied — for a "change
   *  folder(s)" affordance (unlike ensureFolders, which no-ops when already satisfied). */
  openFolderGate(sd: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.folderGatePrompt = { sd, resolve, reject };
    });
  }

  resolveFolderGate(): void {
    const p = this.folderGatePrompt;
    this.folderGatePrompt = null;
    p?.resolve();
  }

  cancelFolderGate(): void {
    const p = this.folderGatePrompt;
    this.folderGatePrompt = null;
    p?.reject(new Error("Folder selection cancelled."));
  }

  markDirty(path: string) {
    this.dirtyFiles.add(path);
    // Force reactivity in Svelte 5 by reassigning the Set
    this.dirtyFiles = new Set(this.dirtyFiles);
  }

  clearDirty() {
    this.dirtyFiles = new Set();
  }
}

export const roms = new RomStore();
