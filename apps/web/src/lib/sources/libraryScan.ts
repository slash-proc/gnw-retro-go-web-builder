/**
 * MERGING MANY LOCAL FOLDERS INTO ONE LIBRARY.
 *
 * `library.svelte.ts` used to scan exactly ONE directory (persisted under the IndexedDB key
 * "romDir"). `localFolders.svelte.ts` now lets the user register as many folders as they like,
 * so the Library has to walk all of them and present a single, de-duplicated
 * set of files. This module is that merge - and only that merge: it is pure, injected, and
 * knows nothing about Svelte, so `test/libraryscan.mjs` runs the real logic with no browser.
 *
 * DEDUP, CHEAPEST TEST FIRST. The ordering is the design, not an implementation detail: the
 * owner's stated worry is that hashing a 1000-ROM library on every load makes the feature
 * unusable. So:
 *
 *   1. BY IDENTITY, before a single byte is read. The same folder registered twice, or a folder
 *      nested inside another already in the list, is dropped from the walk entirely. Handle
 *      identity is `FileSystemHandle.isSameEntry()` and containment is `parent.resolve(child)`
 *      - never a name comparison, because names repeat across drives and change on a rename.
 *      This costs nothing and it is the common case.
 *   2. BY PATH + SIZE. Two entries that agree on their relative path AND their byte length are
 *      duplicate CANDIDATES. Disagreeing sizes are decided here and never hashed. The path
 *      comparison is CASE-FOLDED, because the destination is a FAT/exFAT card that cannot tell
 *      `Zelda.nes` from `ZELDA.nes`; the original spelling is what is kept and shown.
 *   3. BY HASH, colliding paths only. `sha1Hex` (reused from `inputGate.ts`, not a second
 *      hashing path) settles a path offered twice: identical bytes collapse, different bytes
 *      become two entries. Only a path that ALREADY collided is ever hashed, so for a library
 *      with no repeated paths the hash function is called ZERO times - the property the whole
 *      ordering exists to protect, and the one `test/libraryscan.mjs` asserts numerically.
 *      (A size disagreement no longer short-circuits the hash: the surviving variant needs a
 *      content-derived id. It costs a hash of the colliding files only, never of the library.)
 *
 * SAME PATH, DIFFERENT BYTES - BOTH SURVIVE, DISTINGUISHED BY AN INTERNAL ID. The owner's rule
 * is exactly two sentences long: identical content is ignored (one entry), different content is
 * shown twice, told apart by an id the user never sees. So step 3 no longer drops a loser:
 *
 *   - The FIRST variant in scan order keeps the bare relative path as its map key, so every
 *     existing consumer of a duplicate-free library is byte-for-byte unaffected.
 *   - Each FURTHER variant with genuinely different bytes is kept under a key of
 *     `<path><DUP_MARK><id>`, where DUP_MARK is NUL - a byte no filesystem can put in a name, so
 *     `basePath()` is total and lossless and no real path can ever be mistaken for a dup key.
 *   - The ID IS THE CONTENT HASH (`DUP_ID_LEN` hex chars of it). That is what makes it STABLE:
 *     it depends on the bytes and on nothing else - not scan order, not the folder's row id, not
 *     when the folder was registered. Re-running a scan over the same library reproduces the same
 *     ids; removing a folder and adding it back reproduces them too, because the bytes did not
 *     change. (The only key that moves is when the FIRST variant's folder is removed: the next
 *     variant is then no longer a duplicate of anything and takes the bare path. That is a
 *     library change, not a rescan.)
 *   - The id is INTERNAL. It exists in the map key and nowhere else; every consumer that turns a
 *     key into something the user reads, or into a sibling path, goes through `basePath()`.
 *
 * BOTH SHOWN IS NOT BOTH INSTALLED. Two files still cannot land in one directory on a
 * case-folding card. Nothing here picks a winner, renames, or asks: the install refuses, through
 * the same `planNames`/`firstCollisionError` refusal `sources/outputNames.ts` already applies to
 * every other name this app writes. `collisions[]` still records every such path.
 *
 * A FOLDER THAT CANNOT BE READ IS SKIPPED, NOT FATAL. A restored handle needs a permission
 * re-grant (`status: "needs-permission"`) and a handle can be gone (`"missing"`). Either way the
 * folder contributes nothing and its id is reported in `skipped[]` with the reason - it is never
 * treated as an empty folder (which would look like the user's ROMs vanished) and it is never
 * allowed to throw the whole scan (which would take the readable folders down with it).
 */
import { sha1Hex } from "./inputGate.js";
import { resolveBytes, type MaybeLazy as LibraryFile } from "../lazyBytes.js";
import {
  dedicatedFolderPlacement,
  looseFileFolder,
  placementToken,
  isLibrarySource,
  EMPTY_REGISTRY,
  type CoreRegistry,
  type LooseFilePlacement,
} from "./coreRegistry.js";

/** One folder to walk. `handle` is opaque here; the injected scanner knows what it is. */
export interface LibraryScanSource {
  /** `LocalFolderRow.id` - how a collision or a skip is attributed back to a row. */
  id: string;
  handle: unknown;
  /** From `LocalFolderRow.status`; anything but "ready" is skipped without a read. */
  status: "ready" | "needs-permission" | "missing";
  /**
   * Where this source's LOOSE files belong, for a DEDICATED folder.
   *
   * Two layouts have to work, because the owner uses both: a general ROM folder holding
   * `doom/DOOM.WAD`, and a folder registered for a core whose contents ARE the ROMs, with no
   * console directory inside it. A file already sitting under a subdirectory keeps its own
   * path; only a file at the folder's root is placed, so one folder can hold both shapes.
   *
   * One system means one destination for everything; several mean one per extension. Absent for
   * an "Any" folder and for a target the registry cannot resolve — see `coreRegistry.ts`'s
   * `dedicatedFolderPlacement`, which will not guess.
   */
  placement?: LooseFilePlacement;
}

/** Why a folder contributed nothing. */
export type SkipReason = "needs-permission" | "missing" | "duplicate" | "nested" | "error";

export interface SkippedFolder {
  id: string;
  reason: SkipReason;
  /** For "duplicate"/"nested", the folder that already covers this one. */
  coveredBy?: string;
  /** For "error", the message - surfaced, never swallowed. */
  message?: string;
}

/**
 * A relative path offered by more than one folder with DIFFERENT content.
 *
 * Nothing is dropped any more (see the header): every distinct variant is in `files`, and this
 * record exists so a caller can say WHICH paths are doubled and which folders they came from
 * without walking the whole map looking for `DUP_MARK`.
 */
export interface PathCollision {
  path: string;
  /** The folder holding the variant that kept the BARE path (first in scan order). */
  winnerId: string;
  /** The folder(s) whose variants are kept under a `DUP_MARK` key instead. */
  loserIds: string[];
  /** "size" - the first disagreement was a byte length; "hash" - same size, different bytes. */
  decidedBy: "size" | "hash";
}

/**
 * NUL - the one byte no filesystem lets into a name, which is exactly why it separates a path
 * from its duplicate id. `basePath()` can therefore never truncate a legitimate path.
 */
export const DUP_MARK = "\u0000";

/**
 * How much of the content hash becomes the id. 16 hex chars = 64 bits; the ids only ever have
 * to be unique WITHIN one path's handful of variants, so this is enormous overkill on purpose -
 * a collision here would silently merge two different files.
 */
export const DUP_ID_LEN = 16;

/** The key a non-first variant of `path` is stored under. Internal; never rendered. */
export function duplicateKey(path: string, id: string): string {
  return `${path}${DUP_MARK}${id}`;
}

/**
 * The real relative path behind a library key - the ONLY thing that may be shown to the user or
 * used to derive a sibling path (a cover, a cheat file) or a destination on the card. A key with
 * no `DUP_MARK` is returned unchanged, so this is safe to apply to every key unconditionally.
 */
export function basePath(key: string): string {
  const i = key.indexOf(DUP_MARK);
  return i < 0 ? key : key.slice(0, i);
}

/** The internal id of a duplicate variant, or "" for the variant holding the bare path. */
export function duplicateIdOf(key: string): string {
  const i = key.indexOf(DUP_MARK);
  return i < 0 ? "" : key.slice(i + DUP_MARK.length);
}

/** True when this key is a non-first variant of a path some other key also claims. */
export function isDuplicateKey(key: string): boolean {
  return key.includes(DUP_MARK);
}

/** One variant of a doubled path. */
export interface DuplicateVariant {
  /** The key in `files` - bare path for the first variant, `DUP_MARK`-suffixed for the rest. */
  key: string;
  /** The variant's own spelling of the path (case can differ between folders). */
  path: string;
  folderId: string;
  /** "" for the first variant; the content-derived id for the rest. */
  dupId: string;
  size: number;
}

/** Every variant of one doubled path, in scan order. */
export interface DuplicateGroup {
  /** The first variant's spelling - what all of these are called on the card. */
  path: string;
  members: DuplicateVariant[];
}

/** What one folder's walk produced. */
export interface FolderScan {
  id: string;
  files: Map<string, LibraryFile>;
  /** Per-FOLDER, never global: one folder's `roms/` layout must not reinterpret another's. */
  hasRomsPrefix: boolean;
}

export interface MergedLibraryScan {
  /** Relative path to bytes, de-duplicated. */
  files: Map<string, LibraryFile>;
  /** Which folder each surviving path came from. */
  origin: Map<string, string>;
  /** Folders actually walked, in scan order. */
  scanned: FolderScan[];
  skipped: SkippedFolder[];
  collisions: PathCollision[];
  /** Paths that survive more than once, with every variant. Empty for a clean library. */
  duplicates: DuplicateGroup[];
  /** How many files reached step 3. Asserted by the tests; useful in a perf report. */
  hashed: number;
}

/** Injected so the tests can stage identity, permission failures and hashing without a browser. */
export interface LibraryScanDeps {
  /** Walk one folder. Throwing is fine - the folder is skipped with reason "error". */
  scan(source: LibraryScanSource): Promise<{ files: Map<string, LibraryFile>; hasRomsPrefix: boolean }>;
  /** `FileSystemHandle.isSameEntry()`. */
  isSameEntry(a: unknown, b: unknown): Promise<boolean>;
  /** `parent.resolve(child)` - non-null (path segments) when `child` is inside `parent`. */
  resolveWithin(parent: unknown, child: unknown): Promise<string[] | null>;
  hash(bytes: Uint8Array): Promise<string>;
}

async function nativeIsSameEntry(a: unknown, b: unknown): Promise<boolean> {
  if (a === b) return true;
  const f = (a as { isSameEntry?: (o: unknown) => Promise<boolean> } | null)?.isSameEntry;
  if (typeof f !== "function") return false;
  try {
    return await f.call(a, b);
  } catch {
    return false;
  }
}

async function nativeResolveWithin(parent: unknown, child: unknown): Promise<string[] | null> {
  const f = (parent as { resolve?: (o: unknown) => Promise<string[] | null> } | null)?.resolve;
  if (typeof f !== "function") return null;
  try {
    return await f.call(parent, child);
  } catch {
    return null;
  }
}

export const defaultLibraryScanDeps: Pick<
  LibraryScanDeps,
  "isSameEntry" | "resolveWithin" | "hash"
> = {
  isSameEntry: nativeIsSameEntry,
  resolveWithin: nativeResolveWithin,
  hash: sha1Hex,
};

/**
 * STEP 1 - identity. Returns the folders worth walking, in the caller's order, plus the ones
 * dropped and why. Nothing is read from disk here.
 *
 * A folder is dropped when it IS one already kept (`isSameEntry`) or is CONTAINED BY one already
 * kept (`resolve` returns a path). A folder that CONTAINS one already kept is kept too - the
 * inner one is then redundant, so it is retro-actively dropped, which is why the kept list is
 * rebuilt rather than appended to blindly.
 */
export async function dedupeSources(
  sources: LibraryScanSource[],
  deps: Pick<LibraryScanDeps, "isSameEntry" | "resolveWithin">,
): Promise<{ kept: LibraryScanSource[]; skipped: SkippedFolder[] }> {
  const kept: LibraryScanSource[] = [];
  const skipped: SkippedFolder[] = [];

  for (const src of sources) {
    if (src.status !== "ready" || !src.handle) {
      skipped.push({ id: src.id, reason: src.status === "missing" ? "missing" : "needs-permission" });
      continue;
    }
    let covered = false;
    for (const k of kept) {
      if (await deps.isSameEntry(k.handle, src.handle)) {
        skipped.push({ id: src.id, reason: "duplicate", coveredBy: k.id });
        covered = true;
        break;
      }
      if ((await deps.resolveWithin(k.handle, src.handle)) !== null) {
        skipped.push({ id: src.id, reason: "nested", coveredBy: k.id });
        covered = true;
        break;
      }
    }
    if (covered) continue;

    // This folder may be the PARENT of something already kept; that inner folder is now
    // redundant. Drop it rather than walking the same files twice under two ids.
    for (let i = kept.length - 1; i >= 0; i--) {
      if ((await deps.resolveWithin(src.handle, kept[i].handle)) !== null) {
        skipped.push({ id: kept[i].id, reason: "nested", coveredBy: src.id });
        kept.splice(i, 1);
      }
    }
    kept.push(src);
  }
  return { kept, skipped };
}

/**
 * STEPS 2 + 3 - merge already-walked folders.
 *
 * A path offered for the first time is stored under its own spelling and costs nothing. A path
 * offered AGAIN is a collision candidate, and only then is anything hashed: the newcomer once,
 * plus any already-kept variant of the same byte length (a variant of a different length cannot
 * be the same file, so it is never hashed to find that out). If the newcomer's hash matches a
 * kept variant, it IS that file arriving twice and is ignored. If it matches none, it is a
 * genuinely different file sharing a name and it SURVIVES, under `duplicateKey(path, id)`.
 *
 * "SAME PATH" IS CASE-FOLDED. The destination is a FAT or exFAT card, which case-folds, so
 * `nes/Zelda.nes` and `nes/ZELDA.nes` are ONE file there and two in any ordinary Map. An
 * unfolded merge reports two ROMs, budgets for two, and then writes one over the other on the
 * card - the same class of bug spec/05 states for converted output names, in the one other
 * place this app builds a set of names. The FOLD is only ever the grouping key; each variant is
 * stored, reported and shown under its OWN original spelling, which is what it is really called
 * in its source folder. Two case-variants with the same bytes therefore still collapse to one,
 * and two case-variants with different bytes are two entries here and a refused install.
 */
export async function mergeFolderScans(
  scans: FolderScan[],
  deps: Pick<LibraryScanDeps, "hash">,
): Promise<Pick<MergedLibraryScan, "files" | "origin" | "collisions" | "duplicates" | "hashed">> {
  const files = new Map<string, LibraryFile>();
  const origin = new Map<string, string>();
  const collisions = new Map<string, PathCollision>();
  let hashed = 0;

  // A kept variant, plus its hash once (and only once) something has forced us to compute it.
  interface Kept extends DuplicateVariant {
    bytes: LibraryFile;
    hash: string | null;
  }
  // Folded path -> every variant kept under it, in scan order. This is the only case-folded
  // structure; `files`, `origin` and `collisions` all stay in each variant's own spelling.
  const groups = new Map<string, Kept[]>();

  // THE ONLY TIER THAT NEEDS BYTES. Identity and path+size are answered from metadata alone, so
  // a zipped ROM is deduped without being inflated; `romBytes` inflates one here only when a
  // path has genuinely collided, which is the rare case the ordering already exists to protect.
  const hashOf = async (v: Kept): Promise<string> => {
    if (v.hash === null) {
      v.hash = await deps.hash(await resolveBytes(v.bytes));
      hashed++;
    }
    return v.hash;
  };

  const collide = (path: string, winnerId: string, loserId: string, by: "size" | "hash"): void => {
    const existing = collisions.get(path);
    if (existing) {
      if (!existing.loserIds.includes(loserId)) existing.loserIds.push(loserId);
      return;
    }
    collisions.set(path, { path, winnerId, loserIds: [loserId], decidedBy: by });
  };

  for (const scan of scans) {
    for (const [path, bytes] of scan.files) {
      const folded = path.toLowerCase();
      const group = groups.get(folded);
      if (group === undefined) {
        groups.set(folded, [
          { key: path, path, folderId: scan.id, dupId: "", size: bytes.length, bytes, hash: null },
        ]);
        files.set(path, bytes);
        origin.set(path, scan.id);
        continue;
      }

      // The newcomer's hash is BOTH the "is this the same file?" test and, if it is not, the
      // id it will be filed under - so it is computed once and reused for both.
      const newcomer: Kept = {
        key: "",
        path,
        folderId: scan.id,
        dupId: "",
        size: bytes.length,
        bytes,
        hash: null,
      };
      const h = await hashOf(newcomer);

      let sameSizeSeen = false;
      let identical = false;
      for (const v of group) {
        // Different length => definitely a different file. Decided without hashing `v`.
        if (v.size !== bytes.length) continue;
        sameSizeSeen = true;
        if ((await hashOf(v)) === h) {
          identical = true;
          break;
        }
      }
      if (identical) continue; // the same file reached us twice; ignore it, exactly as asked.

      // Genuinely different content under a name already taken. Keep it, under an id derived
      // from its own bytes - stable across rescans because the bytes are.
      let id = h.slice(0, DUP_ID_LEN);
      let key = duplicateKey(path, id);
      // Paranoia, not expectation: never let two different files share one key.
      for (let n = 2; files.has(key); n++) {
        id = `${h.slice(0, DUP_ID_LEN)}.${n}`;
        key = duplicateKey(path, id);
      }
      newcomer.key = key;
      newcomer.dupId = id;
      group.push(newcomer);
      files.set(key, bytes);
      origin.set(key, scan.id);
      collide(group[0].path, group[0].folderId, scan.id, sameSizeSeen ? "hash" : "size");
    }
  }

  const duplicates: DuplicateGroup[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    duplicates.push({
      path: group[0].path,
      members: group.map(({ key, path, folderId, dupId, size }) => ({ key, path, folderId, dupId, size })),
    });
  }

  return { files, origin, collisions: [...collisions.values()], duplicates, hashed };
}

/**
 * File a dedicated folder's LOOSE files under the console they were registered for.
 *
 * Only keys with no `/` move: a file the user already put in `gbc/` inside that folder is
 * already where it belongs, and placing it again would produce `gbc/gbc/Zelda.gbc`. With no
 * placement this is the identity, so the general-folder layout is untouched.
 *
 * A file the placement does not claim keeps its own key rather than being dropped. Being
 * unplaced is already how it fails to become a game; deleting it here would also take it away
 * from everything else that reads the scan.
 */
export function applyPlacement(
  files: Map<string, LibraryFile>,
  placement: LooseFilePlacement | undefined,
): Map<string, LibraryFile> {
  if (!placement) return files;
  const out = new Map<string, LibraryFile>();
  for (const [path, bytes] of files) {
    if (path.includes("/")) {
      out.set(path, bytes);
      continue;
    }
    const folder = looseFileFolder(placement, path);
    out.set(folder ? `${folder}/${path}` : path, bytes);
  }
  return out;
}

/** Walk + merge every source. Never throws for a folder-level failure. */
export async function scanLibraryFolders(
  sources: LibraryScanSource[],
  deps: LibraryScanDeps,
): Promise<MergedLibraryScan> {
  const { kept, skipped } = await dedupeSources(sources, deps);
  const scanned: FolderScan[] = [];
  for (const src of kept) {
    try {
      const r = await deps.scan(src);
      scanned.push({ id: src.id, files: applyPlacement(r.files, src.placement), hasRomsPrefix: r.hasRomsPrefix });
    } catch (e) {
      skipped.push({
        id: src.id,
        reason: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const merged = await mergeFolderScans(scanned, deps);
  return { ...merged, scanned, skipped };
}

// --- Migration off the single "romDir" handle ---------------------------------------------------

/** The slice of `LocalFolderStore` the migration needs; injected so the test can fake it. */
export interface MigrationTarget {
  folders: { id: string; handle: unknown | null }[];
  add(opts: {
    handle: unknown;
    name?: string;
    usedBy?: string[];
  }): Promise<{ id: string }>;
}

/**
 * Adopt a pre-existing single "romDir" folder into the local-folder list as a directory with
 * NO associations (i.e. "Any"). IDEMPOTENT: if any registered folder is already the
 * same entry, nothing happens - so this can run on every load.
 *
 * The "romDir" key is deliberately NOT deleted. Leaving it costs nothing and keeps the change
 * reversible; a later step can retire it once this has shipped.
 */
export async function migrateLegacyRomDir(
  legacyHandle: unknown | null,
  target: MigrationTarget,
  deps: Pick<LibraryScanDeps, "isSameEntry">,
): Promise<{ adopted: boolean; id?: string }> {
  if (!legacyHandle) return { adopted: false };
  for (const f of target.folders) {
    if (!f.handle) continue;
    if (await deps.isSameEntry(f.handle, legacyHandle)) return { adopted: false };
  }
  const row = await target.add({ handle: legacyHandle, usedBy: [] });
  return { adopted: true, id: row.id };
}

// --- The ROM-folder gate ------------------------------------------------------------------------

/** The slice of `LocalFolderStore` the gate needs; injected so the test can fake it. */
export interface GateTarget {
  folders: unknown[];
  load(): Promise<void>;
}

/**
 * Should the folder gate modal open?
 *
 * The question is whether the user has REGISTERED any directory at all, NOT whether a scan
 * happens to be in memory: `library.scan` is per-session, so gating on it re-asked on every
 * reload and on every mount before the first scan resolved — the modal greeting a user who has
 * had folders registered for months.
 *
 * `load()` is awaited (idempotent) rather than read optimistically, so a store that has not
 * finished its IndexedDB pass can never read as "no folders" and pop the modal.
 *
 * STATUS IS DELIBERATELY IGNORED. A `needs-permission` or `missing` row is registered but not
 * usable right now — and it still suppresses the modal. Chrome does not silently re-grant a
 * persisted directory handle, so `needs-permission` is the NORMAL state after a reload for a
 * user who has done nothing wrong; treating it as "no folder" would reinstate the very bug
 * this gate is fixing. Those rows already carry their own recovery affordances (grant/repoint
 * in `ui/LocalFolders.svelte`, plus the always-opens `openFolderGate()` button), so nothing is
 * unreachable — the modal simply stops being the only way there.
 */
export async function romFolderGateNeeded(target: GateTarget): Promise<boolean> {
  await target.load();
  return target.folders.length === 0;
}

// --- The registry IS the library ----------------------------------------------------------------

/**
 * The slice of a `LocalFolderRow` this module needs to decide what the library is made of.
 * Structural, so `localFolders.folders` satisfies it without an import (this module stays
 * Svelte-free and therefore testable offline).
 */
export interface RegistryRow {
  id: string;
  status: "ready" | "needs-permission" | "missing";
  handle: unknown | null;
  /** Target keys this folder serves; EMPTY MEANS ANY. Read only to spot a dedicated folder. */
  usedBy?: string[];
}

/**
 * EVERY registered directory, as scan sources — THE one and only way the
 * library learns what it contains. Nothing else may put files into `library.scan`: a legacy
 * single handle, a fresh pick and a permission re-grant all go through the registry first
 * (`migrateLegacyRomDir` / `localFolders.add` / `localFolders.grant`) and reach the library
 * only from here. That is the whole point — the Library list is the Sources list.
 *
 * MEMBERSHIP IS `isLibrarySource` (coreRegistry.ts), which replaced the `kind: "roms"` filter
 * that used to sit here when the kind itself went away. Shared folders and core-dedicated ones
 * are in; a folder dedicated only to homebrew targets is not, because `romScan.ts` reads every
 * file it walks into memory whole. Read that function's comment before changing this line: the
 * exclusion is a cost rule, not a taxonomy, and getting it wrong loads a game install into RAM.
 *
 * It does decide one thing: LAYOUT. A folder registered for a core is that core's own folder,
 * so its loose files are filed under that console rather than dropped for sitting at the root
 * with no console directory. That is `placement` — one destination when the folder serves one
 * system, one per extension when it serves several. Everything else about association is still
 * applied downstream where a target actually picks files.
 *
 * A non-"ready" row is kept, not dropped: `dedupeSources` reports it in `skipped[]` with the
 * reason, which is how the UI can tell "you have folders that need a re-grant" from "you have
 * no folders".
 */
export function romFolderSources(
  folders: RegistryRow[],
  reg: CoreRegistry = EMPTY_REGISTRY,
): LibraryScanSource[] {
  return folders
    .filter((f) => isLibrarySource(reg, f.usedBy ?? []))
    .map((f) => {
      const placement = dedicatedFolderPlacement(reg, f.usedBy ?? []);
      return { id: f.id, handle: f.handle, status: f.status, ...(placement ? { placement } : {}) };
    });
}

/**
 * A string that changes exactly when the library would scan differently: a ROM folder added,
 * removed, re-pointed or re-granted. The UI watches this instead of re-scanning on
 * every reactive tick, so registering a folder in the Sources tab shows up in the Library
 * immediately and nothing else does.
 *
 * The handle is part of it (by identity, via a per-call side table) because `repoint()` keeps a
 * row's id and status while swapping the directory underneath it.
 */
const handleIds = new WeakMap<object, number>();
let nextHandleId = 0;

/**
 * A stable per-object token for a directory handle. Deliberately MODULE-level (a WeakMap keyed
 * by the handle itself), not per-call: a per-call index would number the handles 0,1,2… in every
 * call and so read as unchanged after a `repoint()` — the one mutation that keeps a row's id and
 * status and swaps only the directory. WeakMap, so a forgotten handle is still collectable.
 */
function handleToken(h: unknown): string {
  if (!h || (typeof h !== "object" && typeof h !== "function")) return "-";
  const key = h as object;
  let n = handleIds.get(key);
  if (n === undefined) {
    n = nextHandleId++;
    handleIds.set(key, n);
  }
  return String(n);
}

export function romFolderSignature(
  folders: RegistryRow[],
  reg: CoreRegistry = EMPTY_REGISTRY,
): string {
  const handleId = handleToken;
  // The resolved PLACEMENT is part of the signature, not just the folder: activating the Doom
  // core turns a dedicated folder's loose WADs into `doom/…` keys, and ticking Game Boy Color
  // on a folder already marked Game Boy changes where half its files land. A signature that
  // ignored either would leave the library showing the previous scan until something else
  // happened to change. `placementToken` keeps the single-system case spelled exactly as the
  // bare prefix was, so folders whose layout did NOT change do not rescan.
  return romFolderSources(folders, reg)
    .map((s) => `${s.id}:${s.status}:${handleId(s.handle)}:${placementToken(s.placement)}`)
    .join("|");
}

/**
 * WHAT THE LIBRARY'S GAME/APP LIST SHOULD RENDER.
 *
 * "Not read yet" and "nothing configured" are different facts and used to be the same empty
 * state: before the registry's IndexedDB pass resolved, the Library showed "Set up your ROM
 * folder to manage games." to users who had folders registered for months. So:
 *
 *   loading — the registry has not finished loading, or the first scan has not finished, or a
 *             scan is running right now. Nothing is known; say so, never accuse the user of
 *             having configured nothing.
 *   list    — a scan is in memory.
 *   empty   — loading has genuinely FINISHED and there is nothing to show. Only then.
 */
export type LibraryListState = "loading" | "list" | "empty";

export function libraryListState(s: {
  /** `localFolders.ready` — the registry's own "my IndexedDB pass is done" flag. */
  registryReady: boolean;
  /** `library.loaded` — a registry-driven scan has completed at least once. */
  loaded: boolean;
  /** `library.folderScanning` — a scan is in flight. */
  scanning: boolean;
  /** `library.scan !== null`. */
  hasScan: boolean;
}): LibraryListState {
  if (!s.registryReady || !s.loaded || s.scanning) return "loading";
  return s.hasScan ? "list" : "empty";
}
