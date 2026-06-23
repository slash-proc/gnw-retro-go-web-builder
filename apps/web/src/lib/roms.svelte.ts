// Shared ROM-folder state. ROM Management is gated on a selected ROM folder (NOT on a
// device connection — ROMs are the prerequisite; a device is only needed to flash-install
// or SD-push). The folder is picked + scanned once via romScan and reused across the tab.
// (RomSection in the Retro-Go tab can migrate onto this store later.)
import {
  pickAndScanRomFolder,
  scanRomDirectory,
  folderPickerSupported,
  type RomScanResult,
  type RomDirHandle,
} from "./romScan.js";
import { saveDir, loadDir, handlePermission } from "./persist.js";

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
    if (await handlePermission(handle, "read", false)) await this.adopt(handle);
    else this.pendingHandle = handle;
  }

  /** Re-grant + adopt the remembered folder (call from a user gesture). */
  async reconnect(): Promise<void> {
    const handle = this.pendingHandle;
    if (!handle) return;
    if (await handlePermission(handle, "read", true)) {
      this.pendingHandle = null;
      await this.adopt(handle);
    }
  }

  private async adopt(handle: RomDirHandle): Promise<void> {
    this.scanning = true;
    this.error = null;
    try {
      this.scan = await scanRomDirectory(handle);
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
