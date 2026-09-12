/**
 * MOVING A CARD'S LEGACY `roms/homebrew` TO THE MANIFEST'S `/homebrews`.
 *
 * Both directories are real and the repo already says so. `DEFAULT_INSTALL_PATHS.homebrew` is
 * `roms/homebrew` (`fs-builders/src/installPaths.ts`), the literal this code used before
 * `manifest.paths` existed; the live manifest declares `"homebrew": "/homebrews"`, a sibling of
 * `/roms`. `homebrewDirs()` returns both so a READ recognises either. This module is the other
 * half: offering to put a card that still has the old layout onto the new one.
 *
 * ── THE CARD'S LAYOUT IS THE EVIDENCE. THE MARKER ONLY EVER ADDS SILENCE ───────────────────
 *
 * The owner set this rule after a dev build made the previous one unreachable, and it is worth
 * stating in his terms because it inverts what an earlier revision did:
 *
 *   "If we see the directory the current wider retro-go-sd release expects, then we know it's
 *    current. If we see /roms/homebrew/ and no /homebrews/, then we know it's not. The INSTALL
 *    file is helpful but it not being there shouldn't prevent us from prompting the user, hey,
 *    this isn't where we expect it to be. If the user declines, they may just want to only
 *    modify an existing older install so we respect that and shut up about it."
 *
 * So the offer is predicated on WHAT IS ON THE CARD, and `data/INSTALL` is a refinement rather
 * than a precondition:
 *
 *   - `roms/homebrew` holding files is the whole trigger. That card is not on the layout the
 *     current release expects, which is the thing worth telling someone.
 *   - A missing, corrupt or unresolvable marker DOES NOT BLOCK THE OFFER. `no-marker`,
 *     `no-release` and `lookup-failed` all still prompt.
 *   - The ONE silence the marker can produce is `firmware-wants-legacy`: the marker resolved,
 *     positively, and that firmware's manifest declares `roms/homebrew`. That is the single
 *     case where moving would hide files from a build that is actually running, so it stays.
 *   - A decline is remembered per card and never raised again. His words: "we respect that and
 *     shut up about it."
 *
 * WHY THE EARLIER, STRICTER GATE HAD TO GO. It required the marker to resolve, and a card whose
 * firmware is built from a local branch carries a `gitTag` no published release matches -- so it
 * answered `no-release` and stayed silent forever, for the owner and every other dev build. A
 * gate that cannot fire for the people running the code is not a safety property.
 *
 * An even earlier revision required `/homebrews` to already exist, which was worse: a card
 * holding ONLY `roms/homebrew` is exactly the card that needs migrating, so that test excluded
 * the entire population the feature is for. Neither test is coming back.
 *
 * ── WHERE THE FILES GO ────────────────────────────────────────────────────────────────────
 *
 * `moveDestination()` prefers the marker's answer and falls back to `deviceInstallPaths()`.
 *
 * That fallback is honest HERE, in a way it would not have been under the old gate. The offer is
 * now predicated on the card not being on the layout the current release expects, and
 * `deviceInstallPaths()` is precisely the path that release declares -- it is the same fact the
 * offer already rests on, not a second weaker one smuggled in. When the marker DOES resolve, its
 * own firmware's directory wins, so a card that can name its build still moves to that build's
 * location rather than to the newest one.
 *
 * The fallback has one failure mode and it is guarded: if nothing has ever been learned,
 * `deviceInstallPaths()` returns the pre-manifest default, which IS the legacy directory. A move
 * onto itself is not a move, so `moveDestination()` returns null and the offer is withheld.
 *
 * ── THE `gitTag` WARNING IN `installMarker.ts`, ADDRESSED RATHER THAN AVOIDED ──────────────
 *
 * That file's header says `gitTag` is "provenance and version comparison ONLY", that "nothing
 * gates on it", and that compatibility rests on `providesAbi` versus a core's `required_abi_*`
 * rather than on the tag. Read literally that could forbid this.
 *
 * It does not, and the distinction is the point. The warning is about inferring CAPABILITY from
 * a version: `if (gitTag < "1.4") refuse this core` is the bug it exists to stop, because an
 * ordering of tags is not a statement about what a build can do. Nothing here compares tags,
 * orders them, or infers anything from them. The tag is used as an IDENTIFIER to look up that
 * release's manifest, and the decision then comes from a field that manifest DECLARES -- the
 * same `paths` object `resolveInstallPaths()` treats as authoritative everywhere else in this
 * codebase. That is the "provenance" use the doc allows, and the answer is a declaration rather
 * than an inference.
 *
 * It would become the forbidden thing the moment anyone replaced the manifest lookup with a
 * comparison against a known-good tag. Do not.
 *
 * Nothing in the marker declares paths directly, so there is no route to this answer that
 * avoids the tag. `providesAbi` and `coreMetaVersion` describe an ABI, not a directory layout.
 *
 * ── NOTHING IS DELETED BEFORE ITS COPY EXISTS ─────────────────────────────────────────────
 *
 * The File System Access API has no rename and no move, so a move is copy-then-delete and a
 * card pulled halfway through is an ordinary outcome rather than an exotic one. One file at a
 * time: write the destination, read it back and compare it to the source, and only then remove
 * the original. A failure at any step leaves the source in place, so the worst case is a file
 * present in both directories -- which the next run reconciles rather than reporting as damage.
 * There is no instant at which a file exists in neither place.
 *
 * A destination that already exists with DIFFERENT bytes is a CONFLICT, never an overwrite. Two
 * files with one name and different contents are two files; picking one silently is the kind of
 * guess this codebase refuses elsewhere (`outputNames.ts` raises `name-collision` for the same
 * reason).
 *
 * ── WHAT "VERIFY" MEANS, AND WHY NOT A HASH ───────────────────────────────────────────────
 *
 * The destination is read back and compared to the source BYTE FOR BYTE. The source bytes are
 * already in memory — they had to be, to be written — so the comparison costs one read of the
 * destination and nothing else. A hash would cost the same read and answer a weaker question,
 * since it proves a digest matched rather than that the file did. Comparing sizes alone is
 * cheaper still and is not enough: a card that writes the right length of wrong bytes passes it.
 *
 * A destination that fails verification is REMOVED before the failure is reported. Leaving a
 * half-written file there would let the next run mistake it for a completed migration, and it is
 * unambiguously ours to delete: the occupied check above means we only ever write a name that
 * was absent. The source is untouched throughout, so a failed verify costs nothing but time.
 *
 * ── AN INTERRUPTED RUN IS A STATE, NOT DAMAGE ─────────────────────────────────────────────
 *
 * File by file means a card pulled halfway leaves some files moved and some not, and running
 * again has to finish the job rather than report a directory full of collisions. So a
 * destination that already holds IDENTICAL bytes is `reconciled`: the copy is provably there, so
 * the legacy original is a leftover and is removed. That is the one delete that happens without
 * a write, and it is the best-evidenced one in the module — it deletes only after reading both
 * files and finding them the same.
 *
 * Identity is content, never the name. The cost is bounded by checking SIZE FIRST and reading
 * only when sizes match: a genuine conflict is almost always a different length and costs no
 * read at all, while the resumed-run case that has to be exact is precisely the one where the
 * sizes agree.
 */
import {
  DEFAULT_INSTALL_PATHS,
  under,
  type InstallPaths,
} from "@gnw/fs-builders";
import { deviceInstallPaths } from "./engine/devicePaths.js";
import { INSTALL_MARKER_PATH, readInstallMarker } from "./firmwareDist/installMarker.js";
import { loadSel, saveSel } from "./persist.js";

/**
 * The directory handle surface a move needs.
 *
 * Structural, and deliberately not imported from `romScan.ts` — the same reasoning
 * `sdStorage.svelte.ts` records for its own `SdDirLike`: that module pulls in the core registry
 * and the homebrew store, and none of this needs either. It also keeps the suite able to drive
 * the real move against a plain in-memory fixture.
 */
export interface MoveDirLike {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, MoveDirLike | MoveFileLike]>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MoveDirLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<MoveFileLike>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
}

export interface MoveFileLike {
  kind: "file";
  name: string;
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: unknown): Promise<void>; close(): Promise<void> }>;
}

/** The pre-manifest homebrew directory. Never spelled as a fresh literal here. */
export const LEGACY_HOMEBREW_DIR = DEFAULT_INSTALL_PATHS.homebrew;

/** One file the move would touch. `rel` is relative to the homebrew directory itself. */
export interface LegacyFile {
  /** Path below the legacy directory, so `a/b.bin` keeps its subdirectory on the way over. */
  rel: string;
  /** Full path from the storage root, for a log line the user can act on. */
  from: string;
  /** Where it would land, full path from the storage root. */
  to: string;
  size: number;
}

/** A destination that is already occupied. Reported, never overwritten. */
export interface MoveConflict {
  rel: string;
  from: string;
  to: string;
  /** True when both files have the same byte count; still not proof they are the same file. */
  sameSize: boolean;
}

export interface LegacyScan {
  /** Files under the legacy directory with no destination yet. */
  movable: readonly LegacyFile[];
  /**
   * Files whose destination already holds the IDENTICAL bytes — an interrupted earlier run.
   * The copy is done; only the legacy original is left to remove.
   */
  alreadyThere: readonly LegacyFile[];
  /** Files whose destination exists with different bytes. */
  conflicts: readonly MoveConflict[];
  /** Whether the manifest's homebrew directory exists on this card at all. */
  modernDirExists: boolean;
  /** Whether the legacy directory exists on this card at all. */
  legacyDirExists: boolean;
}

/**
 * Why the offer is or is not being made. Every non-`offer` value is a reason to stay silent,
 * and they are distinct so a log line can say which rather than just "no".
 */
export type MigrationVerdict =
  | "offer"
  /**
   * The marker RESOLVED and that firmware's manifest declares the legacy directory. The one
   * silence the marker can produce, and the only case where moving would hide files from a
   * build that is running. An unresolvable marker is NOT this: it offers.
   */
  | "firmware-wants-legacy"
  /** No legacy files, or nowhere to put them. */
  | "nothing-to-move"
  | "declined";

/**
 * What the card's own firmware reads, or why that could not be established.
 *
 * `known` is the only value that may lead to a move, and `homebrew` is then both the gate's
 * evidence and the move's destination.
 */
export type CardLayout =
  | { known: true; gitTag: string; homebrew: string }
  | { known: false; why: "no-marker" | "no-release" | "lookup-failed" };

/**
 * The two lookups the gate needs, injected.
 *
 * Injected rather than imported so this module stays free of the network and the firmware
 * client, which is what lets the suite drive the real gate with no card and no fetch. The same
 * reasoning `walkSdUsage` records for taking its paths as an argument.
 */
export interface CardFirmwareLookup {
  /** One file's bytes off the card, or null when it is not there or cannot be read. */
  readCardFile: (path: string) => Promise<Uint8Array | null>;
  /**
   * The install paths the release with this `gitTag` declares, or null when no published
   * release matches it. MUST NOT fall back to the newest release: a tag we cannot place is
   * `unknown`, and answering with somebody else's manifest is the whole failure this avoids.
   */
  pathsForGitTag: (gitTag: string) => Promise<InstallPaths | null>;
}

/** Where the firmware writes its install marker. `installMarker.ts` owns the constant. */
export const CARD_MARKER_PATH = INSTALL_MARKER_PATH;

/**
 * Ask the card what firmware it runs and where that firmware reads homebrew.
 *
 * Called ONLY once a legacy directory with files has actually been found, so a card with
 * nothing to migrate costs no network at all. Offline, or with the release index unreachable,
 * `pathsForGitTag` fails and the answer is `unknown` -- which means no prompt, the correct
 * direction for a failure on a move that deletes.
 */
export async function cardHomebrewLayout(lookup: CardFirmwareLookup): Promise<CardLayout> {
  let marker: ReturnType<typeof readInstallMarker> = null;
  try {
    marker = readInstallMarker(await lookup.readCardFile(CARD_MARKER_PATH));
  } catch {
    // `readInstallMarker` treats every malformed shape as absence already; this catches the
    // read itself failing. Same answer either way, per the doc's "missing or mismatched marker
    // is unknown, not an error".
    marker = null;
  }
  if (!marker || !marker.gitTag) return { known: false, why: "no-marker" };

  let paths: InstallPaths | null = null;
  try {
    paths = await lookup.pathsForGitTag(marker.gitTag);
  } catch {
    return { known: false, why: "lookup-failed" };
  }
  if (!paths) return { known: false, why: "no-release" };
  return { known: true, gitTag: marker.gitTag, homebrew: paths.homebrew };
}

/** True when the card's firmware reads somewhere other than the pre-manifest default. */
export function readsModernLayout(layout: CardLayout): boolean {
  return layout.known && layout.homebrew !== DEFAULT_INSTALL_PATHS.homebrew;
}

/**
 * Where the files should go, or null when there is nowhere to put them.
 *
 * The marker's answer wins when it resolved, so a card that can name its own build moves to
 * THAT build's directory rather than to the newest release's. Otherwise the current release's
 * declared path, which is sound here for the reason the header gives: the offer is already
 * predicated on the card not matching that layout.
 *
 * Null when the only path available is the legacy directory itself -- which happens when nothing
 * has been learned and `deviceInstallPaths()` is still the pre-manifest default. Moving a file
 * onto itself is not a move, and the caller turns this into `nothing-to-move` rather than
 * walking a directory to copy each file over itself.
 */
export function moveDestination(
  layout: CardLayout,
  currentRelease: InstallPaths = deviceInstallPaths(),
): string | null {
  const dir = layout.known ? layout.homebrew : currentRelease.homebrew;
  return dir === LEGACY_HOMEBREW_DIR ? null : dir;
}

/** Walk one directory tree, yielding `[relativePath, fileHandle]`. Depth-first, files only. */
async function* filesUnder(
  dir: MoveDirLike,
  prefix = "",
): AsyncGenerator<[string, MoveFileLike]> {
  for await (const [name, handle] of dir.entries()) {
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (handle.kind === "directory") {
      yield* filesUnder(handle, rel);
    } else {
      yield [rel, handle];
    }
  }
}

/** Resolve a `a/b/c` path to its directory handle, or null when any segment is missing. */
async function dirAt(
  root: MoveDirLike,
  path: string,
  create = false,
): Promise<MoveDirLike | null> {
  let cur = root;
  for (const seg of path.split("/")) {
    if (seg === "") continue;
    try {
      cur = await cur.getDirectoryHandle(seg, create ? { create: true } : undefined);
    } catch {
      return null;
    }
  }
  return cur;
}

/**
 * What is under the legacy directory, and which of it already has a namesake at the
 * destination. Reads metadata only; nothing here opens a file's bytes.
 */
export async function scanLegacyHomebrew(
  root: MoveDirLike,
  homebrewDir: string,
): Promise<LegacyScan> {
  const legacyDir = await dirAt(root, LEGACY_HOMEBREW_DIR);
  // `create: false`. The destination is brought into being by the first file that lands in it
  // (`moveOne` passes `create`), so a declined or failed run leaves no empty directory behind.
  const modernDir = await dirAt(root, homebrewDir);
  const modernDirExists = modernDir !== null;
  const empty = { movable: [], alreadyThere: [], conflicts: [] };
  if (!legacyDir) return { ...empty, modernDirExists, legacyDirExists: false };

  // Every destination already present, by name, so the occupied test is a lookup rather than a
  // probe per file. The handle comes along because deciding identity needs its bytes.
  const taken = new Map<string, MoveFileLike>();
  if (modernDir) {
    for await (const [rel, handle] of filesUnder(modernDir)) taken.set(rel, handle);
  }

  const movable: LegacyFile[] = [];
  const alreadyThere: LegacyFile[] = [];
  const conflicts: MoveConflict[] = [];
  for await (const [rel, handle] of filesUnder(legacyDir)) {
    let size = -1;
    try {
      size = (await handle.getFile()).size;
    } catch {
      // A source we cannot read is not movable. Reporting it as a conflict would be wrong; it
      // is simply skipped, and the legacy directory then stays behind, which is the signal.
      continue;
    }
    const from = under(LEGACY_HOMEBREW_DIR, rel);
    const to = under(homebrewDir, rel);
    const dest = taken.get(rel);
    if (!dest) {
      movable.push({ rel, from, to, size });
      continue;
    }
    const same = await sameContents(handle, dest, size);
    if (same === true) alreadyThere.push({ rel, from, to, size });
    else conflicts.push({ rel, from, to, sameSize: same === "same-size" });
  }
  return { movable, alreadyThere, conflicts, modernDirExists, legacyDirExists: true };
}

/**
 * Whether two files hold the same bytes. `true`, or why not.
 *
 * SIZE FIRST, and the read only happens when it has to. A different length is a different file
 * and needs no read; an equal length is the case that actually has to be decided, which is also
 * the resumed-run case. `"same-size"` is returned rather than `false` so the conflict report can
 * say the two agree on length and still differ, which is the shape worth seeing.
 */
async function sameContents(
  a: MoveFileLike,
  b: MoveFileLike,
  aSize: number,
): Promise<true | "same-size" | false> {
  try {
    const bFile = await b.getFile();
    if (bFile.size !== aSize) return false;
    const [x, y] = [new Uint8Array(await (await a.getFile()).arrayBuffer()), new Uint8Array(await bFile.arrayBuffer())];
    if (x.length !== y.length) return "same-size";
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return "same-size";
    return true;
  } catch {
    // Unreadable on either side. It is THERE, so it occupies the name, but nothing was compared
    // and nothing may claim they match.
    return "same-size";
  }
}

/** Where a decline is remembered. Rides `persist.ts`'s `gnw:` namespace, already inventoried. */
const DECLINED_KEY = "sdHomebrewMoveDeclined";

/**
 * Cards whose owner has said no, by folder name.
 *
 * Keyed by name rather than by handle because a handle is not comparable across reloads, and
 * the same reasoning the stated-capacity record uses: a name is the closest stable thing a
 * picked directory offers. A different card therefore gets asked, which is the right direction
 * for the error — being asked once more beats never being asked again.
 */
function declinedCards(): Record<string, true> {
  const raw = loadSel<Record<string, true> | null>(DECLINED_KEY, null);
  return raw && typeof raw === "object" ? raw : {};
}

export function hasDeclinedMove(folderName: string): boolean {
  return declinedCards()[folderName] === true;
}

export function rememberDeclinedMove(folderName: string): void {
  saveSel(DECLINED_KEY, { ...declinedCards(), [folderName]: true });
}

/**
 * The whole gate in one call: both facts, the decline, and whether there is anything to do.
 *
 * Order matters for the log line rather than for correctness: the layout test comes first
 * because it is the one that means "we cannot tell", and that is the answer worth seeing.
 */
export function readyToMove(
  scan: LegacyScan,
  folderName: string,
  layout: CardLayout,
  destination: string | null,
): MigrationVerdict {
  // The ONLY silence the marker can produce. Note `layout.known &&`: an unresolvable marker
  // falls straight through to the card's own evidence, which is the owner's rule. Reversing
  // this to `if (!readsModernLayout(layout))` would silence every dev build again.
  if (layout.known && !readsModernLayout(layout)) return "firmware-wants-legacy";
  // Nowhere to move to. `moveDestination` returns null when the only path available is the
  // legacy directory itself, and a move onto itself is not a move.
  if (destination === null) return "nothing-to-move";
  // `alreadyThere` counts: an interrupted run left the copies in place and the originals behind,
  // and finishing that is exactly the job. Offering only on `movable` would strand a card one
  // step from done with no way to be asked again.
  if (scan.movable.length + scan.alreadyThere.length === 0) return "nothing-to-move";
  if (hasDeclinedMove(folderName)) return "declined";
  return "offer";
}

/**
 * Everything one run should act on, in scan order: the copies, then the originals an earlier run
 * already copied. Conflicts are deliberately absent — they are reported, never acted on.
 */
export function movePlan(scan: LegacyScan): readonly LegacyFile[] {
  return [...scan.movable, ...scan.alreadyThere];
}

/**
 * What one file's move did.
 *
 * `reconciled` finishes an interrupted earlier run: the destination already held identical bytes,
 * so only the legacy original needed removing. `skipped` is a real conflict — a destination with
 * different bytes, left exactly as it was found.
 */
export type MoveOutcome = "moved" | "reconciled" | "skipped" | "failed";

export interface MoveResult {
  file: LegacyFile;
  outcome: MoveOutcome;
  /** Present for `failed`, so the log can say which file and why. */
  error?: string;
}

export interface MoveHooks {
  /** Called before each file, for a progress line. */
  onFile?: (file: LegacyFile, index: number, total: number) => void;
  /** Called after each file with its outcome. */
  onResult?: (result: MoveResult) => void;
  /** Checked between files so a cancel lands on a file boundary, never mid-copy. */
  signal?: { aborted: boolean };
}

/**
 * Move the planned files, one at a time, copy before delete.
 *
 * Per file: write the destination, read it back and compare the byte count, then remove the
 * source. The read-back is the point — `createWritable`/`close` resolving is not proof the
 * bytes reached the card, and deleting a source on the strength of a resolved promise is how a
 * half-written file becomes the only copy.
 *
 * Errors are collected rather than thrown. One file that will not copy must not strand the
 * other forty, and every source it could not move is still where it was.
 */
export async function moveLegacyHomebrew(
  root: MoveDirLike,
  files: readonly LegacyFile[],
  homebrewDir: string,
  hooks: MoveHooks = {},
): Promise<MoveResult[]> {
  const results: MoveResult[] = [];
  let index = 0;
  for (const file of files) {
    if (hooks.signal?.aborted) break;
    hooks.onFile?.(file, index++, files.length);
    const result = await moveOne(root, file, homebrewDir);
    results.push(result);
    hooks.onResult?.(result);
  }
  return results;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Remove a destination we wrote and could not verify. Reports whether it went. */
async function discard(dir: MoveDirLike, name: string): Promise<boolean> {
  try {
    await dir.removeEntry(name);
    return true;
  } catch {
    return false;
  }
}

async function moveOne(
  root: MoveDirLike,
  file: LegacyFile,
  homebrewDir: string,
): Promise<MoveResult> {
  const fail = (e: unknown): MoveResult => ({
    file,
    outcome: "failed",
    error: e instanceof Error ? e.message : String(e),
  });
  try {
    const slash = file.rel.lastIndexOf("/");
    const subdir = slash < 0 ? "" : file.rel.slice(0, slash);
    const base = slash < 0 ? file.rel : file.rel.slice(slash + 1);

    const srcDir = await dirAt(root, under(LEGACY_HOMEBREW_DIR, subdir).replace(/\/$/, ""));
    if (!srcDir) return fail(new Error(`source directory is gone: ${file.from}`));
    const srcHandle = await srcDir.getFileHandle(base);
    const bytes = new Uint8Array(await (await srcHandle.getFile()).arrayBuffer());

    const destPath = subdir === "" ? homebrewDir : under(homebrewDir, subdir);
    const destDir = await dirAt(root, destPath, true);
    if (!destDir) return fail(new Error(`could not open ${destPath}`));

    // A destination that is already there is either this file (an interrupted earlier run) or a
    // different one. Comparing decides it; neither answer overwrites anything.
    let existing: MoveFileLike | null = null;
    try {
      existing = await destDir.getFileHandle(base);
    } catch {
      /* absent, which is what we want */
    }
    if (existing) {
      if ((await sameContents(srcHandle, existing, bytes.length)) !== true) {
        return { file, outcome: "skipped" };
      }
      // The copy is provably on the card already. Removing the original finishes the job.
      await srcDir.removeEntry(base);
      return { file, outcome: "reconciled" };
    }

    const destHandle = await destDir.getFileHandle(base, { create: true });
    const writable = await destHandle.createWritable();
    await writable.write(bytes);
    await writable.close();

    // VERIFY BEFORE DELETE, by content. A card that writes the right length of wrong bytes
    // passes a size check, and the source is about to be removed on the strength of this.
    const readBack = new Uint8Array(await (await (await destDir.getFileHandle(base)).getFile()).arrayBuffer());
    if (!bytesEqual(readBack, bytes)) {
      // Ours to remove: the occupied check above means this name was absent before we wrote it.
      // Leaving it would let the next run read it as a finished migration.
      const cleanup = await discard(destDir, base);
      return fail(
        new Error(
          `copy does not match the source (${readBack.length} of ${bytes.length} bytes)` +
            (cleanup ? "" : "; the incomplete copy could not be removed"),
        ),
      );
    }

    await srcDir.removeEntry(base);
    return { file, outcome: "moved" };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Remove the legacy directory once it holds no FILES, at any depth.
 *
 * "No files" rather than "no entries", because a moved `sub/deep.bin` leaves `sub/` behind and
 * an empty directory is debris rather than data — refusing to prune it would leave every card
 * that had one subdirectory looking un-migrated forever. Nothing here can lose content: a
 * directory is only removed after a walk proved it contains no file, so a conflict, an
 * unreadable source or a cancelled run all keep the directory exactly as this module found it.
 *
 * Never `{ recursive: true }`. That flag would delete whatever it met, which is the one
 * behaviour this function exists to avoid; the walk below is what makes the removal provable.
 */
export async function removeLegacyDirIfEmpty(root: MoveDirLike): Promise<boolean> {
  const dir = await dirAt(root, LEGACY_HOMEBREW_DIR);
  if (!dir) return false;
  for await (const _file of filesUnder(dir)) return false;

  const slash = LEGACY_HOMEBREW_DIR.lastIndexOf("/");
  const parentPath = slash < 0 ? "" : LEGACY_HOMEBREW_DIR.slice(0, slash);
  const base = slash < 0 ? LEGACY_HOMEBREW_DIR : LEGACY_HOMEBREW_DIR.slice(slash + 1);
  const parent = parentPath === "" ? root : await dirAt(root, parentPath);
  if (!parent) return false;
  try {
    await pruneEmpty(parent, base);
    return true;
  } catch {
    return false;
  }
}

/** Remove `name` under `parent`, emptying its (file-free) subdirectories from the bottom up. */
async function pruneEmpty(parent: MoveDirLike, name: string): Promise<void> {
  const dir = await parent.getDirectoryHandle(name);
  const children: string[] = [];
  for await (const [child, handle] of dir.entries()) {
    if (handle.kind === "directory") children.push(child);
  }
  for (const child of children) await pruneEmpty(dir, child);
  await parent.removeEntry(name);
}
