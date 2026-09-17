/**
 * DOES A FIRMWARE BACKUP ACTUALLY EXIST? -- answered from the user's disk, not from a flag.
 *
 * WHY THIS EXISTS. The Overview Status row used to read `device.backupTaken`, a per-unit
 * localStorage boolean set when THIS app finished a backup. That flag lies in both directions.
 * It says "None" to someone holding a perfectly good backup folder -- made by an earlier
 * install, by gnwmanager, or on a browser profile whose site data has since been cleared -- and
 * it keeps saying "you have one" after the files have been deleted. The second direction is the
 * dangerous one now that automatic unlock gates on a backup existing: a mass erase is not a
 * thing to authorise on the strength of a boolean nobody has checked.
 *
 * The truth is the folder. `engine/ofw.ts` already owns reading it; this owns REMEMBERING which
 * folder, re-adopting it silently across reloads, and caching the answer so a status row can ask
 * cheaply and often.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not hash-validate. `scanBackupFolder` reads every
 * candidate in full to check it against the stock SHA-1s, which is right before writing those
 * bytes to a device and far too expensive for a row on a tab the user opens constantly. This
 * uses `probeBackupFolder` (names, sizes, dates) instead. "A file of the right name and a
 * plausible size is here" is a weaker claim than "these bytes are genuine stock", and the copy
 * this drives is careful to make only the weaker one.
 *
 * `device.backupTaken` is NOT replaced. It answers a different question -- "did the guided flow
 * complete its backup step" -- and `Wizard.svelte` needs exactly that, deliberately latched, so
 * that a live derivation cannot delete the step the user is standing on (see its comment). This
 * module answers "does a backup exist on disk", which is the question the Status row was asking
 * with the wrong source.
 *
 * FOUR STATES, and the third one is the point:
 *   unknown       nothing has looked yet, or this browser cannot pick folders at all
 *   disconnected  no remembered folder, or its permission was not re-granted
 *   none          a folder we CAN read, scanned, holding no usable pair
 *   present       at least one pair is there, ONE HIT PER MODEL
 *
 * `disconnected` is not `none`. Reporting "no backup" when the honest answer is "we have not
 * looked" is the same class of lie as the flag this replaces, and it is the direction that gets
 * someone's firmware erased.
 */
import { loadDir, saveDir, handlePermission } from "./persist.js";
import {
  backupPickerSupported,
  pickBackupFolder,
  probeBackupFolder,
  type BackupDir,
  type BackupProbeHit,
} from "./engine/ofw.js";
import { localFolders, OFW_BACKUP_USED_BY_KEY } from "./sources/localFolders.svelte.js";

/** The IndexedDB key `advanced/OfficialFirmwareSection.svelte` already stores the folder under.
 *  Shared on purpose: picking a folder there and reading it here must never disagree. */
const HANDLE_KEY = "ofwBackupDir";

export type BackupPresence =
  | { kind: "unknown" }
  | { kind: "disconnected" }
  | { kind: "none" }
  | { kind: "present"; hits: BackupProbeHit[] };

class BackupPresenceStore {
  /** The cached answer. `unknown` until `refresh()` has completed once. */
  state = $state<BackupPresence>({ kind: "unknown" });
  /** True while a probe is in flight, so overlapping calls collapse into one. Deliberately NOT
   *  `$state`: nothing renders it, and a reactive flag that `refresh()` both reads and writes
   *  before its first `await` is exactly what lets a mount effect retrigger itself. */
  private busy = false;

  private handle: BackupDir | null = null;

  /**
   * Re-read the folder and update `state`.
   *
   * Silent by default: it re-adopts a remembered handle only if the permission is ALREADY
   * granted, so opening the Overview tab can never raise a permission prompt out of nowhere.
   * `connect()` is the interactive path, and it is driven by a click.
   */
  async refresh(): Promise<void> {
    if (this.busy) return;
    // A browser with no directory picker (Firefox) can never connect a folder, so there is
    // nothing here for the user to act on and nothing truthful to claim. It stays `unknown`
    // rather than showing an amber row with a button that cannot work.
    if (!backupPickerSupported()) {
      this.state = { kind: "unknown" };
      return;
    }
    this.busy = true;
    try {
      await localFolders.load();
      let source = localFolders.folders.find((f) => f.usedBy.includes(OFW_BACKUP_USED_BY_KEY));
      let legacy = (await loadDir(HANDLE_KEY)) as BackupDir | null;
      // Migrate the old standalone backup handle exactly once. Removing the OFW source clears
      // this key, so an intentional removal cannot be resurrected on the next startup.
      if (!source && !this.handle && legacy) {
        source = await localFolders.adoptOfwBackup(legacy);
      }
      const handle = (source?.handle as BackupDir | null) ?? legacy;
      if (!handle) {
        this.state = { kind: "disconnected" };
        return;
      }
      if (!(await handlePermission(handle, "readwrite", false))) {
        // Remembered, but this visit has not been granted access. We genuinely cannot see it.
        this.state = { kind: "disconnected" };
        return;
      }
      this.handle = handle;
      // Every model, not just the newest hit. `probeBackupFolder` already returns one entry per
      // model, so knowing WHICH consoles are covered costs nothing over knowing THAT one is:
      // the row that reports "Zelda and Mario" and the row that reported a single date read the
      // same directory entries.
      const hits = await probeBackupFolder(handle);
      this.state = hits.length > 0 ? { kind: "present", hits } : { kind: "none" };
    } catch {
      // A folder that has been deleted or unmounted since it was remembered throws here. We
      // cannot see it, which is `disconnected` -- never `none`, which would assert something
      // about a folder we failed to open.
      this.state = { kind: "disconnected" };
    } finally {
      this.busy = false;
    }
  }

  /**
   * The remembered folder itself, re-adopted silently, or null if there is not one we can read.
   *
   * For a caller that needs the FULL `scanBackupFolder` (hash-validated, bytes read) rather than
   * this module's cheap probe -- the guided Return to Stock step, which is about to write those
   * exact bytes to a device and cannot act on "a file of the right size is here". The folder is
   * remembered in exactly one place and this is how everything else asks for it, so picking a
   * folder on the Firmware tab and restoring from it in the wizard cannot disagree about which
   * folder that is.
   *
   * Silent, like `refresh()`: an already-granted permission only, never a prompt.
   */
  async adopted(): Promise<BackupDir | null> {
    if (!backupPickerSupported()) return null;
    try {
      await localFolders.load();
      const source = localFolders.folders.find((f) => f.usedBy.includes(OFW_BACKUP_USED_BY_KEY));
      const handle = (source?.handle as BackupDir | null) ?? ((await loadDir(HANDLE_KEY)) as BackupDir | null);
      if (!handle) return null;
      if (!(await handlePermission(handle, "readwrite", false))) return null;
      this.handle = handle;
      return handle;
    } catch {
      return null;
    }
  }

  /** Pick a backup folder (needs a user gesture), remember it, and report what is in it. */
  async connect(): Promise<void> {
    const picked = await pickBackupFolder();
    if (!picked) return; // cancelled
    this.handle = picked;
    await saveDir(HANDLE_KEY, picked);
    await localFolders.adoptOfwBackup(picked);
    await this.refresh();
  }

  /** Drop the cached handle so the next `refresh()` re-reads it from storage. For a flow that
   *  changed the stored folder elsewhere. */
  forget(): void {
    this.handle = null;
    this.state = { kind: "unknown" };
  }
}

export const backupPresence = new BackupPresenceStore();
