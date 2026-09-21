/**
 * The user's LOCAL content folders — the list that replaces the single ROM folder.
 *
 * WHAT CHANGED. `library.svelte.ts` remembers exactly ONE directory, persisted under the handle
 * key "romDir". The redesigned Sources tab lets the user register as many folders as they
 * like and say which targets each one feeds, "so the user doesn't have to enter a directory
 * multiple times": one folder can serve a core AND a homebrew title at once.
 *
 * ONE KIND: A DIRECTORY. There was a `kind` of "roms" or "homebrew", and it made "Any" read
 * as "any target OF THIS KIND" — an implicit rule you could only follow if you already knew
 * both lists existed. A directory now has no declared role. What it has is `usedBy`, and the
 * only distinction is SHARED (empty, serves everything) versus DEDICATED (serves what it
 * names). Records written before this still load: `sanitise()` simply stops reading `kind`,
 * and the next `persist()` drops it. Nothing is re-keyed, so the change is reversible.
 *
 * A ROLE IS NOT A MEMBERSHIP TEST. Every registered directory is walked by the library scan
 * (`libraryScan.ts`'s `romFolderSources`); `usedBy` decides which targets a folder is OFFERED
 * to, never whether it is scanned. That was already this codebase's rule for ROM folders and
 * it now holds for all of them.
 *
 * ASSOCIATION IS BY EMPTINESS. `usedBy` lists target keys (`owner/repo#targetId`, the same
 * shape as `HomebrewTitle.key` in `homebrewTitles.svelte.ts` — core systems are keyed the
 * same way). An EMPTY list means "Any": the folder is offered to every core and every
 * homebrew title. That is the default and the permissive case; adding entries NARROWS it.
 * There is deliberately no separate `any: boolean` — two representations of one fact drift,
 * and "the user removed the last association" and "the user asked for Any" are the same
 * intent.
 *
 * PERSISTENCE (persist.ts's safety contract). Metadata — id, label, the folder's own name,
 * `usedBy` — is JSON in localStorage. The directory HANDLE is not JSON; it goes to
 * IndexedDB under the folder's generated `id`. Keyed by id and never by path or name: both
 * repeat (two "roms" folders on different drives) and both change (a rename on disk), so
 * either would collide or orphan. File CONTENT is never persisted anywhere.
 *
 * DEGRADING HONESTLY. A restored handle still needs a permission re-grant before use, and a
 * handle can be gone entirely (cleared storage, revoked). Neither drops the row: the folder
 * comes back with its remembered name and a `status` of "needs-permission" or "missing", so
 * the user can re-grant or re-point it. A row that silently vanished would look like data
 * loss and leave its associations un-editable.
 *
 * TESTABILITY. Storage is injected (`LocalFolderDeps`), the way `bundleStore.ts` takes a
 * `BundleBlobStore` instead of calling `indexedDB` directly, so `test/localfolders.mjs` runs
 * the real logic — including the failure cases a browser will not stage on request — with no
 * browser at all.
 *
 * MODEL ONLY: no user-visible strings live here. The UI steps own the copy (and every
 * user-visible string in this app is a seven-file i18n edit — see CLAUDE.md).
 */
import { loadSel, saveSel, saveDir, loadDir, deleteDir, handlePermission } from "../persist.js";
import { targetOf } from "./types.js";
import { defaultLibraryScanDeps } from "./libraryScan.js";

const STORAGE_KEY = "localFolders.v1";

/** Internal metadata names must never leak into the directory-source UI. */
export const OFW_BACKUP_FOLDER_NAME = "__ofw_backup__";
/** Reserved association used by the firmware-backup flow. */
export const OFW_BACKUP_USED_BY_KEY = OFW_BACKUP_FOLDER_NAME;

/** IndexedDB key for one folder's handle. Namespaced so it cannot collide with "romDir". */
export function handleKey(id: string): string {
  return `localFolder:${id}`;
}

/**
 * Whether the folder can be READ right now.
 *   ready            — handle restored and permission granted.
 *   needs-permission — handle restored, permission not (yet) granted; a user gesture fixes it.
 *   missing          — no handle at all; the row survives so the user can re-point it.
 */
export type LocalFolderStatus = "ready" | "needs-permission" | "missing";

/** The persisted half of a folder. Everything here is JSON-safe. */
export interface LocalFolderMeta {
  /** Generated once, stable for the row's life, and the IndexedDB key for its handle. */
  id: string;
  /** The user's own label, or "" — the UI falls back to `folderName` when this is empty. */
  name: string;
  /** The directory's own name at pick time. Kept so a `missing` row is still recognisable. */
  folderName: string;
  /** Target keys this folder serves. EMPTY MEANS ANY (see the header). */
  usedBy: string[];
}

/** A folder plus its live, non-persistable half. */
export interface LocalFolderRow extends LocalFolderMeta {
  status: LocalFolderStatus;
  /** The directory handle, when we have one. Never persisted to localStorage. */
  handle: unknown | null;
}

/** The storage surface this store needs. Defaults to persist.ts; injected by the tests. */
export interface LocalFolderDeps {
  loadSel<T>(key: string, fallback: T): T;
  saveSel(key: string, value: unknown): void;
  loadDir(key: string): Promise<unknown | null>;
  saveDir(key: string, handle: unknown): Promise<void>;
  deleteDir(key: string): Promise<void>;
  handlePermission(handle: unknown, mode: "read" | "readwrite", interactive: boolean): Promise<boolean>;
  /**
   * `FileSystemHandle.isSameEntry()` — directory IDENTITY, for `adopt()`. Deliberately the same
   * implementation the library scan dedupes with (`libraryScan.ts`'s `defaultLibraryScanDeps`)
   * rather than a second one: two answers to "is this the same folder?" would eventually
   * disagree, and `library.svelte.ts`'s `reconnect()` already imports that one for exactly this
   * question.
   */
  isSameEntry(a: unknown, b: unknown): Promise<boolean>;
  newId(): string;
}

const defaultDeps: LocalFolderDeps = {
  loadSel,
  saveSel,
  loadDir,
  saveDir,
  deleteDir,
  handlePermission,
  isSameEntry: defaultLibraryScanDeps.isSameEntry,
  newId: () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `lf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
};

/** Compose the `owner/repo#targetId` key `HomebrewTitle.key` uses. */
export function targetKey(repo: string, targetId: string): string {
  return `${repo}#${targetId}`;
}

/**
 * Does `folder` serve `key`? Empty `usedBy` is "Any" and therefore serves everything.
 *
 * `key` is a TARGET key. The comparison goes through `targetOf` because `usedBy` may hold
 * system-scoped keys (`...@gbc`) since the "Used by" picker started listing one entry per
 * system: a folder narrowed to Game Boy Color still serves the tgb-dual target, and the
 * question asked here -- which folders does this source's config page list, which folders may
 * a converter input be satisfied from -- is asked about the target. Narrowing WITHIN a target
 * is a layout fact, and `coreRegistry.ts`'s `dedicatedFolderPlacement` is what reads it.
 */
export function servesTarget(folder: Pick<LocalFolderMeta, "usedBy">, key: string): boolean {
  return folder.usedBy.length === 0 || folder.usedBy.some((k) => targetOf(k) === key);
}

/** The name to show: the user's label when they gave one, else the folder's own name. */
export function displayName(folder: Pick<LocalFolderMeta, "name" | "folderName">): string {
  const value = folder.name.trim() || folder.folderName;
  return value === OFW_BACKUP_FOLDER_NAME ? "OFW Backup" : value;
}

function readName(handle: unknown): string {
  const n = (handle as { name?: unknown } | null)?.name;
  return typeof n === "string" ? n : "";
}

/** Native directory handles can be persisted; browser fallback shims cannot. */
function canPersistHandle(handle: unknown): boolean {
  return typeof (handle as { getDirectoryHandle?: unknown } | null)?.getDirectoryHandle === "function";
}

/** Coerce one persisted record, dropping anything that is not a usable row. */
function sanitise(raw: unknown): LocalFolderMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : "",
    folderName: typeof r.folderName === "string" ? r.folderName : "",
    usedBy: Array.isArray(r.usedBy)
      ? [...new Set(r.usedBy.filter((k): k is string => typeof k === "string" && !!k))]
      : [],
  };
}

class LocalFolderStore {
  folders = $state<LocalFolderRow[]>([]);
  /** True once `load()` has finished its IndexedDB pass — the UI can distinguish "no folders"
   *  from "not read yet" without guessing from an empty array. */
  ready = $state(false);

  private deps: LocalFolderDeps;
  /** The read in flight, so concurrent callers await the SAME work instead of racing it. */
  private loading: Promise<void> | null = null;

  constructor(deps: Partial<LocalFolderDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  /**
   * Read metadata, then re-adopt each handle. Idempotent, and safe to call concurrently.
   *
   * THE PROMISE IS MEMOISED, and that is the whole point rather than an optimisation. This used
   * to set a `loaded` flag BEFORE its awaits, so a second caller returned instantly, read an
   * empty `folders`, and proceeded as though the user had no folders at all. Every caller now
   * waits for the same read: `ready` is the only "this is done" signal, and it is set last.
   */
  async load(): Promise<void> {
    if (this.ready) return;
    this.loading ??= this.readAll();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /**
   * ONE BAD ROW MUST NOT TAKE THE LIST WITH IT.
   *
   * `loadDir` and `handlePermission` both talk to the browser, and both can reject: IndexedDB
   * evicted, a handle that no longer deserialises, a permission query on a dead handle. An
   * unguarded rejection escaped the loop, left `folders` never assigned and `ready` false, and
   * destroyed every OTHER folder the user had because one was unreadable. A row that cannot be
   * read degrades to `missing`, which is a state the UI already draws and the user can repair.
   */
  private async readAll(): Promise<void> {
    const stored = this.deps.loadSel<unknown[]>(STORAGE_KEY, []);
    const metas = (Array.isArray(stored) ? stored : [])
      .map(sanitise)
      .filter((m): m is LocalFolderMeta => m !== null);
    const rows: LocalFolderRow[] = [];
    for (const meta of metas) {
      let handle: unknown = null;
      try {
        handle = await this.deps.loadDir(handleKey(meta.id));
      } catch {
        handle = null;
      }
      if (!handle) {
        rows.push({ ...meta, handle: null, status: "missing" });
        continue;
      }
      // Non-interactive: safe on mount, never prompts. A "prompt" state is not a failure.
      let granted = false;
      try {
        granted = await this.deps.handlePermission(handle, "readwrite", false);
      } catch {
        granted = false;
      }
      rows.push({ ...meta, handle, status: granted ? "ready" : "needs-permission" });
    }
    this.folders = rows;
    this.ready = true;
  }

  private persist(): void {
    this.deps.saveSel(
      STORAGE_KEY,
      this.folders.map(({ id, name, folderName, usedBy }) => ({
        id,
        name,
        folderName,
        usedBy: [...usedBy],
      })),
    );
  }

  /** Reassign so Svelte sees the mutation (arrays of objects are not deeply reactive). */
  private replace(id: string, patch: Partial<LocalFolderRow>): LocalFolderRow | undefined {
    let updated: LocalFolderRow | undefined;
    this.folders = this.folders.map((f) => {
      if (f.id !== id) return f;
      updated = { ...f, ...patch };
      return updated;
    });
    if (updated) this.persist();
    return updated;
  }

  get(id: string): LocalFolderRow | undefined {
    return this.folders.find((f) => f.id === id);
  }

  /** Register a picked directory. Returns the new row (its `id` is the caller's handle key). */
  async add(opts: {
    handle: unknown;
    name?: string;
    usedBy?: string[];
  }): Promise<LocalFolderRow> {
    // READ BEFORE WRITE. `persist()` serialises `this.folders`, so adding to a store that has
    // not read yet writes a list holding only the new row and silently deletes every folder the
    // user already had. Awaiting the in-flight read is what makes a pick during startup safe.
    await this.load();
    const id = this.deps.newId();
    const row: LocalFolderRow = {
      id,
      name: opts.name ?? "",
      folderName: readName(opts.handle),
      usedBy: [...new Set((opts.usedBy ?? []).filter((k) => !!k))],
      handle: opts.handle,
      status: "ready",
    };
    this.folders = [...this.folders, row];
    this.persist();
    if (canPersistHandle(opts.handle)) {
      await this.deps.saveDir(handleKey(id), opts.handle);
    }
    return row;
  }

  /**
   * Register a picked directory, or REUSE the row that already holds it.
   *
   * `add()` mints a new id every time, so a user who picks the same folder twice — trivially
   * easy from a file prompt, which offers no list of what is already registered — would end up
   * with two rows for one directory on disk, two IndexedDB handles, and a Sources list that
   * looks like a bug. Identity is `isSameEntry`, never the folder's name: two "DATA" folders on
   * different drives are different folders, and a rename on disk does not make one a new one.
   *
   * Re-picking is a WIDENING, never a narrowing:
   *   - a row already narrowed to some targets gains `usedBy` (it now feeds this one too);
   *   - a row on "Any" (empty `usedBy`) is LEFT ALONE — it already serves every target, and
   *     writing the new keys onto it would quietly restrict a folder the user had opened up;
   *   - a `missing`/`needs-permission` row is re-pointed at the freshly picked handle, which is
   *     the same repair `repoint()` does and the reason a dead row stays visible at all.
   */
  async adopt(opts: {
    handle: unknown;
    name?: string;
    usedBy?: string[];
  }): Promise<LocalFolderRow> {
    // Same reason as `add()`, plus one of its own: the duplicate check below walks `folders`,
    // and against an unread store it finds nothing and mints a second row for a folder that is
    // already registered.
    await this.load();
    const keys = [...new Set((opts.usedBy ?? []).filter((k) => !!k))];
    for (const row of this.folders) {
      if (!row.handle || !(await this.deps.isSameEntry(row.handle, opts.handle))) continue;
      if (row.usedBy.length > 0 && keys.length > 0) {
        const merged = [...new Set([...row.usedBy, ...keys])];
        if (merged.length !== row.usedBy.length) this.replace(row.id, { usedBy: merged });
      }
      if (row.status !== "ready") {
        this.replace(row.id, { handle: opts.handle, status: "ready" });
        await this.deps.saveDir(handleKey(row.id), opts.handle);
      }
      return this.get(row.id) as LocalFolderRow;
    }
    return this.add(opts);
  }

  /** Register the firmware-backup directory with its reserved association. */
  async adoptOfwBackup(handle: unknown): Promise<LocalFolderRow> {
    await this.load();
    for (const row of this.folders) {
      const same = row.handle ? await this.deps.isSameEntry(row.handle, handle) : false;
      const legacy = !row.handle &&
        (row.name === OFW_BACKUP_FOLDER_NAME || row.folderName === OFW_BACKUP_FOLDER_NAME);
      if (!same && !legacy) continue;
      const usedBy = row.usedBy.includes(OFW_BACKUP_USED_BY_KEY)
        ? row.usedBy
        : [...row.usedBy, OFW_BACKUP_USED_BY_KEY];
      const updated = this.replace(row.id, { handle, status: "ready", usedBy, folderName: readName(handle) });
      await this.deps.saveDir(handleKey(row.id), handle);
      return updated ?? row;
    }
    return this.add({ handle, usedBy: [OFW_BACKUP_USED_BY_KEY] });
  }

  /** Set (or clear, with "") the user's label. */
  rename(id: string, name: string): void {
    this.replace(id, { name });
  }

  /** Replace the association list wholesale. `[]` restores "Any". */
  setUsedBy(id: string, keys: string[]): void {
    this.replace(id, { usedBy: [...new Set(keys.filter((k) => !!k))] });
  }

  /** Narrow the folder to also serve `key`. On an "Any" folder this is a NARROWING. */
  associate(id: string, key: string): void {
    const row = this.get(id);
    if (!row || !key || row.usedBy.includes(key)) return;
    this.replace(id, { usedBy: [...row.usedBy, key] });
  }

  /**
   * Drop one association. Removing the last one returns the folder to "Any".
   *
   * `key` is a TARGET key and this drops EVERY key under it, system-scoped ones included. The
   * caller is a source's own config page saying "this folder is not mine any more"; leaving
   * `repo#target@gbc` behind would have the row reappear there one render later, since
   * `servesTarget` matches on the target.
   */
  disassociate(id: string, key: string): void {
    const row = this.get(id);
    if (!row) return;
    this.replace(id, { usedBy: row.usedBy.filter((k) => targetOf(k) !== key) });
  }

  /** Remove a source's dedicated folders, preserving folders shared with other sources. */
  async removeOwnedBy(repo: string, targetKeys: readonly string[]): Promise<void> {
    const keys = new Set(targetKeys);
    const owned = (key: string) => keys.has(key) || key.startsWith(`${repo}#`);
    for (const folder of [...this.folders]) {
      if (folder.usedBy.length === 0) continue; // shared "Any" folder
      const mine = folder.usedBy.filter(owned);
      if (mine.length === 0) continue;
      const others = folder.usedBy.filter((key) => !owned(key));
      if (others.length === 0) {
        await this.remove(folder.id);
      } else {
        this.replace(folder.id, { usedBy: others });
      }
    }
  }

  /** Forget a folder AND its handle — skipping the handle leaks IndexedDB entries forever. */
  async remove(id: string): Promise<void> {
    const row = this.get(id);
    if (!row) return;
    this.folders = this.folders.filter((f) => f.id !== id);
    this.persist();
    await this.deps.deleteDir(handleKey(id));
    if (row.usedBy.includes(OFW_BACKUP_USED_BY_KEY) || row.name === OFW_BACKUP_FOLDER_NAME || row.folderName === OFW_BACKUP_FOLDER_NAME) {
      await this.deps.deleteDir("ofwBackupDir");
    }
  }

  /** Re-grant permission for a restored handle. Call from a user gesture. */
  async grant(id: string): Promise<boolean> {
    const row = this.get(id);
    if (!row || !row.handle) return false;
    const ok = await this.deps.handlePermission(row.handle, "readwrite", true);
    this.replace(id, { status: ok ? "ready" : "needs-permission" });
    return ok;
  }

  /** Point an existing row (typically `missing`) at a freshly picked directory, keeping its
   *  id, label and associations — the whole reason a dead row stays visible. */
  async repoint(id: string, handle: unknown): Promise<void> {
    if (!this.get(id)) return;
    this.replace(id, { handle, folderName: readName(handle), status: "ready" });
    await this.deps.saveDir(handleKey(id), handle);
  }

  /** Every folder offered to `key` — the "Any" ones plus those naming it. */
  foldersFor(key: string): LocalFolderRow[] {
    return this.folders.filter((f) => servesTarget(f, key));
  }

  /** Folders that are actually usable right now (handle present and permitted). */
  readyFoldersFor(key: string): LocalFolderRow[] {
    return this.foldersFor(key).filter((f) => f.status === "ready");
  }
}

export { LocalFolderStore };
export const localFolders = new LocalFolderStore();
