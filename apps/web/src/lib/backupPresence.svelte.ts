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
 * directories, re-adopting them silently across reloads, and caching the answer so a status row
 * can ask without trusting a remembered boolean.
 *
 * `probeBackupFolder` hashes plausible-size files in every registered OFW directory and
 * confirms both stock firmware hashes. That way this status cannot claim the user has a usable
 * backup based only on a filename, and a copy in a second directory is not invisible.
 *
 * Advanced and Guided Setup read the same published directory snapshots. `forModel`
 * answers complete/partial from those verified files; a session backup flag does not
 * establish completion. The guided flow retains its stage layout independently.
 *
 * FOUR STATES, and the third one is the point:
 *   unknown       nothing has looked yet, or this browser cannot pick folders at all
 *   disconnected  no remembered folders, or their permissions were not re-granted
 *   none          a folder we CAN read, scanned, holding no usable pair
 *   present       at least one pair is there, ONE HIT PER MODEL
 *
 * `disconnected` is not `none`. Reporting "no backup" when the honest answer is "we have not
 * looked" is the same class of lie as the flag this replaces, and it is the direction that gets
 * someone's firmware erased.
 */
import { loadDir, saveDir, deleteDir, handlePermission } from "./persist.js";
import {
  backupPickerSupported,
  pickBackupFolder,
  scanBackupFolder,
  probeBackupFolder,
  type BackupDir,
  type FoundBackup,
  type BackupProbeHit,
} from "./engine/ofw.js";
import {
  localFolders,
  type LocalFolderRow,
} from "./sources/localFolders.svelte.js";

/** The IndexedDB key `advanced/OfficialFirmwareSection.svelte` already stores the folder under.
 *  Shared on purpose: picking a folder there and reading it here must never disagree. */
const HANDLE_KEY = "ofwBackupDir";

export type BackupPresence =
  | { kind: "unknown" }
  | { kind: "disconnected" }
  | { kind: "none" }
  | { kind: "present"; hits: BackupProbeHit[] };

export interface OfwBackupDirectorySnapshot {
  source: LocalFolderRow;
  backups: FoundBackup[];
}

class BackupPresenceStore {
  /** Bumped when the firmware-backup progress modal closes. FirmwareRail keys the Backup &
   *  Patch page by this value so it remounts and rescans the persisted folder handle. */
  firmwarePageRevision = $state(0);

  /** The cached answer. `unknown` until `refresh()` has completed once. */
  state = $state<BackupPresence>({ kind: "unknown" });
  /** True while a probe is in flight, so overlapping calls collapse into one. Deliberately NOT
   *  `$state`: nothing renders it, and a reactive flag that `refresh()` both reads and writes
   *  before its first `await` is exactly what lets a mount effect retrigger itself. */
  private busy = false;
  private refreshAgain = false;

  /** Shared verified inventory used by Advanced and Guided Setup. */
  snapshots = $state<OfwBackupDirectorySnapshot[]>([]);
  private scanGeneration = 0;

  forModel(model: string): { complete: FoundBackup | null; partial: boolean } {
    const backups = this.snapshots.flatMap(({ backups }) => backups).filter((backup) => backup.model === model);
    const complete = backups.find((backup) => backup.internalOk && backup.externalOk) ?? null;
    return { complete, partial: !complete && backups.some((backup) => backup.internalPresent || backup.externalPresent) };
  }

  private handle: BackupDir | null = null;

  /** Load the source registry and migrate the old one-folder handle into it. */
  async directories(): Promise<LocalFolderRow[]> {
    await localFolders.load();
    const legacy = (await loadDir(HANDLE_KEY)) as BackupDir | null;
    if (legacy) {
      try {
        // adoptOfwBackup deduplicates by handle identity and caps the registry at two entries.
        await localFolders.adoptOfwBackup(legacy);
      } catch {
        // If two newer registered sources already exist, the old pointer is superseded. Remove
        // it so a later load cannot keep trying to resurrect an unregistered third directory.
        await deleteDir(HANDLE_KEY).catch(() => {});
      }
    }
    return localFolders.ofwBackupFolders();
  }

  /** Hash-scan every permitted registered OFW directory, preserving each set's source. */
  async scanDirectories(): Promise<OfwBackupDirectorySnapshot[]> {
    const generation = ++this.scanGeneration;
    const rows = await this.directories();
    const snapshots: OfwBackupDirectorySnapshot[] = [];
    for (const source of rows) {
      const handle = source.handle as BackupDir | null;
      if (!handle || source.status !== "ready") {
        snapshots.push({ source, backups: [] });
        continue;
      }
      try {
        snapshots.push({ source, backups: await scanBackupFolder(handle) });
      } catch {
        snapshots.push({ source: { ...source, status: "missing" }, backups: [] });
      }
    }
    if (generation === this.scanGeneration) this.snapshots = snapshots;
    return snapshots;
  }

  /**
   * Re-read the folder and update `state`.
   *
   * Silent by default: it re-adopts a remembered handle only if the permission is ALREADY
   * granted, so opening the Overview tab can never raise a permission prompt out of nowhere.
   * `connect()` is the interactive path, and it is driven by a click.
   */
  async refresh(): Promise<void> {
    if (this.busy) {
      this.refreshAgain = true;
      return;
    }
    // A browser with no directory picker (Firefox) can never connect a folder, so there is
    // nothing here for the user to act on and nothing truthful to claim. It stays `unknown`
    // rather than showing an amber row with a button that cannot work.
    if (!backupPickerSupported()) {
      this.state = { kind: "unknown" };
      return;
    }
    this.busy = true;
    try {
      const rows = await this.directories();
      if (rows.length === 0) {
        this.state = { kind: "disconnected" };
        return;
      }
      const hits: BackupProbeHit[] = [];
      let inaccessible = false;
      for (const source of rows) {
        const handle = source.handle as BackupDir | null;
        if (!handle || !(await handlePermission(handle, "readwrite", false))) {
          inaccessible = true;
          continue;
        }
        this.handle = handle;
        try {
          hits.push(...await probeBackupFolder(handle));
        } catch {
          inaccessible = true;
        }
      }
      // Overview is a model summary, so collapse duplicate copies of one model across sources.
      // The newest verified pair is representative; Advanced retains and displays each source.
      const newest = new Map<string, BackupProbeHit>();
      for (const hit of hits) {
        const previous = newest.get(hit.model);
        if (!previous || hit.at > previous.at) newest.set(hit.model, hit);
      }
      const aggregated = [...newest.values()];
      this.state = aggregated.length > 0
        ? { kind: "present", hits: aggregated }
        : inaccessible ? { kind: "disconnected" } : { kind: "none" };
    } catch {
      // A folder that has been deleted or unmounted since it was remembered throws here. We
      // cannot see it, which is `disconnected` -- never `none`, which would assert something
      // about a folder we failed to open.
      this.state = { kind: "disconnected" };
    } finally {
      this.busy = false;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        void this.refresh();
      }
    }
  }

  /**
   * The remembered folder itself, re-adopted silently, or null if there is not one we can read.
   *
   * For a caller that needs the FULL `scanBackupFolder` result and file bytes rather than
   * this module's hash-verified presence summary -- the guided Return to Stock step, which is about to write those
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
      const rows = await this.directories();
      for (const source of rows) {
        const handle = source.handle as BackupDir | null;
        if (handle && await handlePermission(handle, "readwrite", false)) {
          this.handle = handle;
          return handle;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Pick a backup folder (needs a user gesture), remember it, and report what is in it. */
  async connect(): Promise<void> {
    const picked = await pickBackupFolder();
    if (!picked) return; // cancelled
    this.handle = picked;
    await localFolders.adoptOfwBackup(picked);
    // Keep the legacy pointer aimed at the most recently chosen OFW source while old builds
    // still exist; the registry remains authoritative for this build.
    await saveDir(HANDLE_KEY, picked);
    await this.refresh();
  }

  /** Drop the cached handle so the next `refresh()` re-reads it from storage. For a flow that
   *  changed the stored folder elsewhere. */
  forget(): void {
    this.scanGeneration++;
    this.snapshots = [];
    this.handle = null;
    this.state = { kind: "unknown" };
  }

  requestFirmwarePageReload(): void {
    this.firmwarePageRevision++;
  }
}

export const backupPresence = new BackupPresenceStore();
