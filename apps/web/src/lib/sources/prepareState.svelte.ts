/**
 * "Prepare" a homebrew title — the shared flow, extracted verbatim out of
 * `views/RomManagementTab.svelte` (2026-09-07) so the Sources tab can drive it too.
 *
 * It is the ONE entry point for assembling a title's COMPLETE device file set:
 *
 *   1. fetch `targets[].artifacts[]` from the source (hash- and length-verified) — the files
 *      the publisher ships, e.g. the engine `.bin`;
 *   2. run the title's OWN converter over the user's ROM, when it has a tool and the caller
 *      supplied a file the gate accepted.
 *
 * Both halves land in `assets` under `homebrew/<filename>`, which `planFlashImage()` applies
 * AFTER the firmware bundle's own content — so a source's engine `.bin` overrides the bundled
 * copy of the same name.
 *
 * A title with no converter runs step 1 only; it used to run nothing at all, which is why its
 * artifacts were never fetched. Do not reintroduce a `canConvert`-only guard.
 *
 * ## Why this is a store and not component state
 *
 * `extractedAssets` was component state on the Library tab, which is exactly why the flow
 * could not be shared: a tab switch unmounts the component and the prepared bytes go with it.
 * Now that the Sources tab can prepare a title, the outputs MUST outlive whichever tab
 * produced them — the Library is where they are selected and installed. So the outputs (and
 * the in-flight/error state that describes them) are a store-backed singleton, the same shape
 * `installProgress` uses for the same reason.
 *
 * What deliberately did NOT move: the file prompt (`promptFor`). It is short-lived and
 * pre-flight, each view renders its own `FilePromptModal` at its own root, and a singleton
 * would let two mounted tabs render the same modal twice. `needsPrompt()` below is the only
 * shared part of that decision.
 */
import { scoped } from "../storageScope.js";
import { locale } from "../i18n/locale.svelte.js";
import { convertHomebrewTitle } from "./homebrewConvert.js";
import { blobCache } from "./blobCache.js";
import { rawCorePayload } from "./rawCore.js";
import { ConverterError } from "./converter.js";
import { fetchTargetArtifacts } from "./installArtifacts.js";
import { fetchVerified } from "./client.js";
import { artifactDir, assetPrefix, converterOutputDir, useForTool } from "./placement.js";
import {
  convertCached,
  forgetConvertedIndex,
  forgetConvertedRepo,
  restoreConverted,
  type ConvertedCacheDeps,
} from "./convertedCache.js";
import { onBlobCacheCleared, type BlobClearScope } from "./blobCache.js";
import { onSourceRemoved } from "./sourceRemoval.js";
import { SourceError, type Target } from "./types.js";
import { prepareText } from "./errorText.js";
import type { ConverterInput } from "./converterTypes.js";
import type { OfferedFile } from "./inputGate.js";
import type { HomebrewTitle } from "./homebrewTitles.svelte.js";
import { auditLog, type AuditSeverity } from "../auditLog.svelte.js";
import { literal, msg, type LogEntry } from "../logEntry.js";

/** Where the explicit removals live. Small: a list of `<repo>#<inputId>` strings. */
const REMOVED_KEY = scoped("gnw.unsupplied.v1");

/** Separates a title key from a filename in a notice key. NUL occurs in neither. */
const NOTICE_SEP = "\u0000";

/** One shipped game to fetch: where it goes, where it comes from, and what proves it. */
export interface ShippedGameFetch {
  /** The placement key -- `<system folder>/<filename>`. */
  key: string;
  /** Absolute, already resolved against the manifest. */
  url: string;
  sha256: string;
}

class PrepareState {
  /**
   * Prepared device files, keyed `homebrew/<filename>` — the key shape `planFlashImage()`
   * expects, kept exactly as the Library tab wrote it.
   *
   * A `Map` inside `$state` is NOT deeply reactive in Svelte 5, so every mutation below is
   * followed by a reassignment. That is load-bearing: the Library's `selSig` derives from
   * `assets.keys()` and its FrogFS preview rebuilds off it.
   */
  assets = $state(new Map<string, Uint8Array>());

  /** Keys of the titles currently being prepared. Reassigned for the same reason as `assets`. */
  extracting = $state(new Set<string>());

  /**
   * The INPUT FILENAMES currently being converted, per title key — `runPerFile` granularity.
   *
   * `extracting` alone is per TITLE, and a core with several games is one title: pressing
   * Prepare on `DOOM.WAD` flipped `doom2.wad`'s row to "extracting…" too, because both rows
   * ask the same title whether it is busy. The conversion itself was always correctly scoped
   * to the one file; it was the ANSWER to "is this row busy" that was not. This is that answer.
   */
  extractingFiles = $state(new Map<string, Set<string>>());

  /** Is this specific input file mid-conversion? Falls back to the title for a whole-title run. */
  isExtractingFile(titleKey: string, filename: string): boolean {
    const per = this.extractingFiles.get(titleKey);
    // No per-file record means the run was not scoped to a file (the Configure page's
    // prepare-all, or a title with no converter): the whole title is busy, so every row is.
    if (per === undefined) return this.extracting.has(titleKey);
    return per.has(filename);
  }

  /**
   * The byte length of a prepared output sitting in `assets`, or undefined.
   *
   * `system` is the row's console folder and matches the asset key's directory exactly:
   * `placement.ts`'s `assetPrefix()` turns `roms/doom` into `doom`, and `run()` keys the
   * converted file `doom/The Ultimate Doom.whd`. Keyed rather than suffix-matched (unlike
   * `get()`) so two cores publishing the same output filename cannot answer for each other.
   */
  preparedSize(system: string, filename: string): number | undefined {
    return this.assets.get(`${system}/${filename}`)?.length;
  }

  /**
   * Every byte this title has actually prepared, or `undefined` when it has prepared nothing.
   *
   * WHY THIS EXISTS AND `deviceFiles` DOES NOT ANSWER IT. A title's size used to be summed by
   * walking `HomebrewTitle.deviceFiles`, which is `artifacts[]` plus the outputs that declare a
   * `filename` (`homebrewTitles.svelte.ts`). A DERIVED output declares only an extension and is
   * named per input file, so it can never appear in that list — and OpenLara, whose install is
   * one 136.62 KB binary plus N converted `.PKD` levels, reported 136.62 KB after preparing.
   * Doom has the same shape. The bytes were never missing; the list was the wrong place to look.
   *
   * `produced` is the provenance `run()`/`restore()` record precisely because a placement key
   * (`doom/The Ultimate Doom.whd`) says nothing about which title wrote it and two titles share
   * a directory. Summing it is exact: these are the bytes an install writes for this title.
   *
   * Reactive through `assets`, which is read first and is reassigned on every mutation;
   * `produced` is kept in lockstep inside the same synchronous block, so the read below cannot
   * see a stale list.
   */
  preparedBytesFor(titleKey: string): number | undefined {
    const assets = this.assets;
    const keys = this.produced.get(titleKey);
    if (keys === undefined || keys.length === 0) return undefined;
    let total = 0;
    for (const key of keys) total += assets.get(key)?.length ?? 0;
    return total;
  }

  /**
   * The placement keys one title wrote, as provenance recorded them.
   *
   * `sources/selectedAssets.ts` needs this to answer "is this converted output still wanted",
   * which a placement key cannot answer for itself: two titles share a directory, so
   * `homebrew/OpenLara/level1.PKD` says nothing about who produced it. Same reason
   * `preparedBytesFor` sums this rather than a declared-name list.
   */
  producedKeys(titleKey: string): readonly string[] {
    return this.produced.get(titleKey) ?? [];
  }

  /**
   * Which cache category backs one asset key, or `undefined` when nothing was recorded.
   *
   * The install filter keeps every `artifact` and gates only `converted` bytes on the
   * selection -- see `selectedAssets.ts` for why that asymmetry is the safe cut.
   */
  assetSourceOf(key: string): "artifact" | "converted" | undefined {
    return this.assetSource.get(key);
  }

  /**
   * The CONVERTER's own outputs for this title, as filenames with real byte counts.
   *
   * For the Configure page's "What gets installed", which lists a source's shipped files from
   * the manifest and its converted files from the run. A derived output has no name until it
   * has run, so this is the only place those rows can come from; `assetSource` is what
   * separates them from the artifacts sitting in the same `produced` list.
   *
   * Reads `assets` first, for the reactivity reason `preparedBytesFor` documents.
   */
  preparedOutputsFor(titleKey: string): { filename: string; bytes: number }[] {
    const assets = this.assets;
    const out: { filename: string; bytes: number }[] = [];
    for (const key of this.produced.get(titleKey) ?? []) {
      if (this.assetSource.get(key) !== "converted") continue;
      const bytes = assets.get(key)?.length;
      if (bytes === undefined) continue;
      out.push({ filename: key.slice(key.lastIndexOf("/") + 1), bytes });
    }
    return out;
  }

  /**
   * WHY THESE ARE TWO MAPS AND NOT ONE `error` STRING.
   *
   * They were one store-wide `error` slot holding either a failure OR the run's notices, and
   * both halves of that were wrong. The owner saw
   * `Error: cropped 11 widescreen lumps to 320w: HELP1(560x200) ...` under EVERY homebrew app:
   *
   *   - a converter's `warnings[]` are a successful run's only voice (gwrg-dist-spec; see
   *     `homebrewConvert.ts`), and dressing one as `Error:` teaches the user to ignore the
   *     real ones — so a notice is now its own thing, in its own colour, under its own prefix;
   *   - one slot for the whole store meant Doom's crop note rendered under apps that had never
   *     run a converter — so both are keyed by the RUN that produced them.
   *
   * Values are already localised. `noticeKey()` explains the key.
   */
  failures = $state(new Map<string, string>());

  /** Notices from a run that SUCCEEDED — unrecognised-but-used files, and module warnings. */
  notices = $state(new Map<string, string[]>());

  /**
   * Which converter inputs the user has actually supplied, keyed `<repo>#<inputId>`.
   *
   * The Sources tab's "Additional files" rows are per-SOURCE (inputs deduplicated across the
   * source's tools), so they cannot ask a per-title question like "does this title have
   * extracted assets". This records the gate's own verdict — the file was offered for this
   * input id and accepted — which is precisely what that row claims.
   *
   * The VALUE is the set of filenames accepted for that input, not a bare presence flag, and
   * that is the whole point: an `allowMultiple` input (doom's 32 `.wad` slots, openlara's 32
   * `.PHD` levels, zelda3's language patches) held one file and thirty-two identically while
   * this was a `Set<string>` of keys, so the Configure row could not tell the user which it
   * had. Filenames rather than a count because `run()` may be called again for the same input
   * and a count would double on a re-pick; a name is the thing that is actually distinct.
   *
   * An EMPTY set is meaningful: `restore()` learns from the converted cache which inputs a
   * title consumed but not which files went in, so it records the key with no names. The row
   * then says "held" without inventing a number.
   */
  supplied = $state(new Map<string, Set<string>>());

  /**
   * Which `variants[]` entry each held file matched, keyed `<repo>#<inputId>\0<filename>`.
   *
   * A PARALLEL map rather than a wider value on `supplied`, following `assetSource`: the value
   * type there has already been widened once and every fixture that assigns it had to be
   * rewritten, for a fact that only one surface reads.
   *
   * This is what lets a row lead with the variant's name ("German") and keep the filename
   * subordinate. Absence is a real answer, not a gap: a `strict: false` input accepts files no
   * variant describes, and those rows have nothing to lead with but their filename.
   */
  variantOfFile = $state(new Map<string, string>());

  /** Whether `restore()` has already run this session. Not reactive: nothing renders it. */
  private restored = false;

  /**
   * True when `filename` has been prepared, wherever it landed.
   *
   * The keys are no longer all `homebrew/<file>`: a CORE's prepared files are keyed by their
   * own destination (`cores/doom.bin`, `doom/The Ultimate Doom.whd` — see `run()`), because a
   * core's binary and its converted games do not live where a homebrew's do. Callers ask about
   * a filename, so the homebrew key is tried first (unchanged, and the common case) and any
   * other directory second.
   */
  has(filename: string): boolean {
    return this.get(filename) !== undefined;
  }

  get(filename: string): Uint8Array | undefined {
    const direct = this.assets.get(`homebrew/${filename}`);
    if (direct !== undefined) return direct;
    const suffix = `/${filename}`;
    for (const [key, data] of this.assets) if (key.endsWith(suffix)) return data;
    return undefined;
  }

  isExtracting(key: string): boolean {
    return this.extracting.has(key);
  }

  /**
   * What a failure or a notice is filed under.
   *
   * A `runPerFile` core prepares ONE game at a time, so a scoped run files per file and Doom's
   * crop note cannot reach `doom2`'s row. A whole-title run — zelda3's single pass over base +
   * languages, or an artifacts-only homebrew — has no one file to blame, so it files under the
   * title and every row of that title reads it. `\0` because it cannot occur in a filename,
   * the same reason `libraryScan.ts` separates a duplicate's id with it.
   */
  private static noticeKey(titleKey: string, filename: string | null): string {
    return filename === null ? titleKey : `${titleKey}${NOTICE_SEP}${filename}`;
  }

  /**
   * The keys one run writes: one per offered file when the run is scoped, else the title.
   * `run()` clears exactly these before starting, so a retry drops the previous attempt's
   * verdict without touching a sibling's.
   */
  /**
   * How a log entry names what it is about, in the words the user would use.
   *
   * A scoped `runPerFile` run is about ONE file, and the filename is exactly what the Library
   * row shows — so `doom.wad` in the log lines up with `doom` on screen. A whole-title run
   * (zelda3's single pass, an artifacts-only homebrew) is about the title, so it takes the
   * title's own display name. Runtime text either way; never translated.
   */
  private static verdictSubject(
    title: HomebrewTitle,
    offered: readonly OfferedFile[],
  ): string {
    return offered.length === 1 ? offered[0].filename : title.displayName;
  }

  private static runKeys(titleKey: string, offered: readonly OfferedFile[]): string[] {
    if (offered.length === 0) return [PrepareState.noticeKey(titleKey, null)];
    return [...new Set(offered.map((f) => PrepareState.noticeKey(titleKey, f.filename)))];
  }

  /**
   * The failure to show on a row: its own file's, else its title's. A row asks with the
   * filename it was converted FROM (`gameRows.ts` keeps the input's identity), which is what
   * `run()` was given.
   */
  failureFor(titleKey: string, filename: string | null = null): string | undefined {
    if (filename !== null) {
      const own = this.failures.get(PrepareState.noticeKey(titleKey, filename));
      if (own !== undefined) return own;
    }
    return this.failures.get(titleKey);
  }

  /** The notices to show on a row, same lookup as `failureFor`. Empty when there are none. */
  noticesFor(titleKey: string, filename: string | null = null): string[] {
    if (filename !== null) {
      const own = this.notices.get(PrepareState.noticeKey(titleKey, filename));
      if (own !== undefined) return own;
    }
    return this.notices.get(titleKey) ?? [];
  }

  // REMOVED: `noticesForTitle` / `failuresForTitle`, the per-SOURCE roll-ups.
  //
  // They existed for the Sources Configure panel, which no longer reports on a run at all: a
  // failure rings the bell and lands in the activity log, and a notice about a run that
  // SUCCEEDED is the class the owner struck from the Library rows. Both had zero production
  // callers once that landed. `failures`/`notices` themselves stay — the log reads them and
  // `forgetSource` clears them; only the whole-title views are gone.
  //
  // Guarded in `test/validate.mjs` §25h, because "put a summary line back on the panel" is a
  // reasonable-looking change that would quietly reintroduce what was deliberately removed.

  hasSupplied(repo: string, inputId: string): boolean {
    return this.supplied.has(`${repo}#${inputId}`);
  }

  /**
   * How many distinct files the user supplied for one input. ZERO is not "none": a key present
   * with an empty set is a restored session, where the cache knows the input was consumed but
   * not by what. Callers that need "is it held at all" ask `hasSupplied`/`isSatisfied`.
   */
  suppliedCount(repo: string, inputId: string): number {
    return this.supplied.get(`${repo}#${inputId}`)?.size ?? 0;
  }

  /**
   * WHICH files the user supplied for one input, in insertion order.
   *
   * The Configure page draws one row per name with its own removal, so the names are the thing
   * it needs — a count could not say which file a `x` was about. Insertion order because that is
   * the order they were picked in; nothing sorts them, so the list does not reshuffle under the
   * user when a second file arrives.
   */
  suppliedNames(repo: string, inputId: string): string[] {
    return [...(this.supplied.get(`${repo}#${inputId}`) ?? [])];
  }

  /**
   * Files found for an input in the user's OWN registered folders (`sources/inputDiscovery.ts`),
   * keyed the same `<repo>#<inputId>` way as `supplied`.
   *
   * The owner's complaint was that a `doom/*.wad` he had already given the app read access to
   * still had to be handed over through the picker. Discovery answers that; this is where the
   * answer lives, because it has to outlive the tab that computed it exactly as `assets` does.
   *
   * NOT the same fact as `supplied`: `supplied` is "the user chose this and a run consumed it",
   * discovery is "this is sitting in a folder you registered". They are unioned by
   * `isSatisfied()` for the ROW, and `run()` falls back to discovery only when the caller
   * offered nothing — it never overrides a file the user picked by hand.
   */
  discovered = $state(new Map<string, OfferedFile[]>());

  /**
   * Names discovery accepted under `strict: false` without matching a variant, per input key.
   * spec/03 requires these to reach the user, so they are carried beside the files and passed
   * into `run()`'s notices rather than being dropped on the way in.
   */
  discoveredUnrecognised = $state(new Map<string, string[]>());

  /**
   * Record (or, with an empty list, CLEAR) what discovery found for one input.
   *
   * Replace-in-full is the whole re-scan story: a WAD added to the folder later shows up on the
   * next pass, and one removed stops satisfying on that same pass, because the caller always
   * writes the complete current answer rather than merging into the old one.
   */
  setDiscovered(repo: string, inputId: string, files: OfferedFile[], unrecognised: string[] = []): void {
    const key = `${repo}#${inputId}`;
    // An explicit removal outranks discovery: the user took this file out, and a folder they
    // registered still holding it is not a reason to hand it back to them (`removed`).
    this.loadRemoved();
    if (this.removed.has(key) && files.length > 0) return;
    // …and the same, one file at a time. A per-FILE removal has to survive the next discovery
    // pass exactly as a whole-input one does, or the `x` on a discovered row would read as a
    // no-op the moment the folder is re-scanned. Filtering here rather than refusing the whole
    // write keeps the input's OTHER discovered files, which is the difference the owner asked
    // for ("each should be its own row with its own remove button").
    files = files.filter((f) => !this.removed.has(PrepareState.fileKey(key, f.filename)));
    const had = this.discovered.get(key);
    if (files.length === 0) {
      if (had === undefined) return;
      this.discovered.delete(key);
      this.discoveredUnrecognised.delete(key);
    } else {
      this.discovered.set(key, files);
      this.discoveredUnrecognised.set(key, unrecognised);
    }
    // A `Map` inside `$state` is not deeply reactive — same reassignment rule as `assets`.
    this.discovered = new Map(this.discovered);
    this.discoveredUnrecognised = new Map(this.discoveredUnrecognised);
  }

  /** What discovery found for one input, or an empty list. */
  discoveredFor(repo: string, inputId: string): OfferedFile[] {
    return this.discovered.get(`${repo}#${inputId}`) ?? [];
  }

  /**
   * Which variant one held file matched, if any. Checks both stores because a row's files come
   * from whichever one answered the input (`heldFileList` — supplied SUPERSEDES discovered,
   * they are never merged), and a discovered file carries its match on the file itself.
   */
  variantFor(repo: string, inputId: string, filename: string): string | undefined {
    const key = `${repo}#${inputId}`;
    const supplied = this.variantOfFile.get(PrepareState.fileKey(key, filename));
    if (supplied !== undefined) return supplied;
    return this.discovered.get(key)?.find((f) => f.filename === filename)?.variantId;
  }

  /**
   * Inputs the user has explicitly REMOVED, keyed `<repo>#<inputId>` like `supplied`.
   *
   * This is the memory that makes "Remove" mean something. Without it the row would come back
   * satisfied on the very next discovery pass (`sources/inputDiscovery.ts` re-answers from the
   * user's registered folders every time the signature moves), and the user would be told the
   * file they just took out is still there — the removal would read as a no-op.
   *
   * THE RULE: an explicit removal outranks discovery until the user answers the input again.
   * `setDiscovered()` refuses to write a removed key, so a re-scan cannot resurrect it; `run()`
   * clears the removal for every input the user actually offered, so picking a file is the way
   * back in (the picker is never hidden — `fileRows.ts`'s `rowOffersPicker`).
   *
   * Persisted, because `restore()` reads a localStorage pointer written by an earlier session:
   * a removal that lived only in memory would be undone by the next reload, which is the same
   * bug one pass later.
   */
  removed = $state(new Set<string>());

  private removedLoaded = false;

  /**
   * Which asset keys each prepared title contributed.
   *
   * Provenance, recorded rather than re-derived: `run()` merges artifacts and converter outputs
   * into one flat `assets` map whose keys are placement-derived and SHARED (two Doom titles
   * both write into `doom/`), so "which keys came from this title" cannot be recovered from the
   * map afterwards without risking another title's converted game. Not reactive: nothing
   * renders it.
   */
  private produced = new Map<string, string[]>();

  /**
   * Which cache category backs each asset key: `artifact` for a target's own binaries,
   * `converted` for a converter's output.
   *
   * Recorded, not derived, for the same reason `produced` is. A key is a device path
   * (`roms/doom/The Ultimate Doom.whd`) and nothing about it says where its bytes came from,
   * yet `forgetCleared()` has to answer exactly that when one category is emptied and the
   * others are not. Not reactive: nothing renders it.
   */
  private assetSource = new Map<string, "artifact" | "converted">();

  /**
   * The relocation facts of the MAPPED artifacts, keyed exactly like `assetSource` -- the same
   * device path, so a caller that already has an asset key can ask about it without carrying a
   * second identity for the same file.
   *
   * A side channel rather than a field on the bytes because `assets` is a plain
   * `Map<key, Uint8Array>` shared with every install path, and only a FLASH install has anything
   * to do about `mapped`. See `docs/MAPPED_ARTIFACTS.md` and `@gnw/fs-builders`' `mappedReloc.ts`.
   * Not reactive: nothing renders it.
   */
  private mappedArtifacts = new Map<string, { relocBase?: number }>();

  /** The relocation facts for one asset key, or `undefined` when it is not a mapped artifact. */
  mappedArtifactOf(key: string): { relocBase?: number } | undefined {
    return this.mappedArtifacts.get(key);
  }

  /** Every mapped artifact currently held, keyed like `assetSource`. For the flash installer. */
  mappedArtifactMap(): ReadonlyMap<string, { relocBase?: number }> {
    return this.mappedArtifacts;
  }

  private loadRemoved(): void {
    if (this.removedLoaded) return;
    this.removedLoaded = true;
    try {
      const raw = globalThis.localStorage?.getItem(REMOVED_KEY);
      const doc: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(doc)) {
        for (const k of doc) if (typeof k === "string") this.removed.add(k);
        this.removed = new Set(this.removed);
      }
    } catch {
      /* a removal we cannot read is one the user re-makes; never an error they see */
    }
  }

  private persistRemoved(): void {
    try {
      globalThis.localStorage?.setItem(REMOVED_KEY, JSON.stringify([...this.removed]));
    } catch {
      /* private mode / quota: the removal still holds for this session */
    }
  }

  /**
   * How ONE removed file is named inside `removed`, beside the whole-input keys.
   *
   * `NOTICE_SEP` for the reason `noticeKey` uses it: it cannot occur in a filename, so a
   * composite key can never collide with an input key. It is written as the ESCAPE, never as
   * the raw byte — a literal NUL in source makes `grep` classify the file as binary and skip
   * it silently, which has now happened twice in this repo.
   *
   * Both shapes live in one set on purpose. A whole-input removal is still needed for the
   * restored-session case, where the cache knows the input was consumed but not by which files,
   * so there is no name to remove; and the persisted v1 payload contains only that shape, so
   * old data keeps meaning what it meant with no migration.
   */
  private static fileKey(inputKey: string, filename: string): string {
    return `${inputKey}${NOTICE_SEP}${filename}`;
  }

  /** Has the user explicitly removed this input's file? */
  isRemoved(repo: string, inputId: string): boolean {
    this.loadRemoved();
    return this.removed.has(`${repo}#${inputId}`);
  }

  /** Has the user explicitly removed THIS file, or the whole input it belongs to? */
  isFileRemoved(repo: string, inputId: string, filename: string): boolean {
    this.loadRemoved();
    const key = `${repo}#${inputId}`;
    return this.removed.has(key) || this.removed.has(PrepareState.fileKey(key, filename));
  }

  /**
   * TAKE ONE FILE BACK OUT, leaving the input's other files alone.
   *
   * `unsupply()` empties an input; this is the per-row action the Configure page draws beside
   * each held file. The owner: "each should be its own row with its own remove button ffs."
   *
   * Steps 1 and 3 of `unsupply()`'s contract apply per file — the name leaves `supplied` (or
   * `discovered`, whichever list the row was drawn from) and the removal is remembered so
   * neither the next discovery pass nor the next reload puts it back. When the last name goes
   * the key goes with it, rather than being left as an empty set: an empty set means "held,
   * names unknown" (a restored session), and leaving one behind would make an emptied input
   * still claim to be satisfied.
   *
   * Step 2 — dropping what was DERIVED from it — is delegated to `unsupply()` on that last
   * file, and is deliberately all-or-nothing rather than per file. `produced` is keyed by
   * TITLE, not by the input file a `runPerFile` run consumed, so there is no bookkeeping here
   * that could attribute one `.whd` to one `.wad`. Dropping the title's whole contribution
   * (which re-preparing restores in one press) is the same conservative rule `unsupply` already
   * documents; guessing would leave installed bytes nothing on screen accounts for.
   */
  unsupplyFile(
    repo: string,
    inputId: string,
    filename: string,
    titles: readonly HomebrewTitle[] = [],
  ): void {
    this.loadRemoved();
    const key = `${repo}#${inputId}`;
    const names = this.supplied.get(key);
    const discovered = this.discovered.get(key);
    const lastSupplied = names !== undefined && names.size <= 1 && names.has(filename);
    const lastDiscovered =
      names === undefined && discovered !== undefined && discovered.length <= 1 &&
      discovered.some((f) => f.filename === filename);
    if (lastSupplied || lastDiscovered) {
      // Nothing of this input is left, so the input itself is now unanswered: fall through to
      // the whole-input path, which also takes the derived outputs with it.
      this.unsupply(repo, inputId, titles);
      return;
    }

    this.removed.add(PrepareState.fileKey(key, filename));
    this.removed = new Set(this.removed);
    this.persistRemoved();

    if (names !== undefined && names.delete(filename)) this.supplied = new Map(this.supplied);
    // The attribution goes with the name. Left behind, a later file reusing that name would
    // inherit a label describing bytes nobody is holding any more.
    if (this.variantOfFile.delete(PrepareState.fileKey(key, filename))) {
      this.variantOfFile = new Map(this.variantOfFile);
    }
    if (discovered !== undefined) {
      const kept = discovered.filter((f) => f.filename !== filename);
      if (kept.length !== discovered.length) {
        this.discovered.set(key, kept);
        this.discovered = new Map(this.discovered);
      }
    }
  }

  /**
   * TAKE A SUPPLIED (or discovered) FILE BACK OUT — the inverse of `run()`'s supply half.
   *
   * Three things happen together, and they have to:
   *
   *   1. the input stops being satisfied (`supplied` AND `discovered` both drop it — a row can
   *      be satisfied either way and removing only one leaves the row still claiming a file);
   *   2. everything DERIVED from it goes. A converter output was produced FROM this input; with
   *      the input gone it can neither be reproduced nor verified, so keeping it would leave an
   *      install carrying bytes nothing on screen accounts for. The whole title's contribution
   *      goes, artifacts included: a title holding half its file set still looks prepared to the
   *      Library, and re-fetching the artifacts is one cheap press of prepare;
   *   3. the removal is REMEMBERED (see `removed`), so neither the next discovery pass nor the
   *      next reload puts it back.
   *
   * `titles` is the set to look for derived outputs in — the caller's already-filtered list
   * (the source's titles). A caller with none passes none and only step 1 and 3 apply.
   */
  unsupply(repo: string, inputId: string, titles: readonly HomebrewTitle[] = []): void {
    this.loadRemoved();
    const key = `${repo}#${inputId}`;
    this.removed.add(key);
    this.removed = new Set(this.removed);
    this.persistRemoved();

    this.supplied.delete(key);
    this.supplied = new Map(this.supplied);
    // Every attribution under this input goes with it, whichever file it named.
    const prefix = `${key}${NOTICE_SEP}`;
    for (const k of [...this.variantOfFile.keys()]) {
      if (k.startsWith(prefix)) this.variantOfFile.delete(k);
    }
    this.variantOfFile = new Map(this.variantOfFile);
    this.discovered.delete(key);
    this.discoveredUnrecognised.delete(key);
    this.discovered = new Map(this.discovered);
    this.discoveredUnrecognised = new Map(this.discoveredUnrecognised);

    let dropped = false;
    for (const title of titles) {
      if (title.repo !== repo) continue;
      if (!(title.tool?.inputs ?? []).some((i) => i.id === inputId)) continue;
      for (const assetKey of this.produced.get(title.key) ?? []) {
        this.assets.delete(assetKey);
        this.assetSource.delete(assetKey);
        this.mappedArtifacts.delete(assetKey);
        dropped = true;
      }
      this.produced.delete(title.key);
    }
    if (dropped) this.assets = new Map(this.assets);
  }

  /** Every verdict filed for a title, whether against the title or one of its files. */
  private dropVerdicts(titleKey: string): boolean {
    const prefix = `${titleKey}${NOTICE_SEP}`;
    const mine = (key: string): boolean => key === titleKey || key.startsWith(prefix);
    let changed = false;
    for (const key of [...this.notices.keys()]) if (mine(key) && this.notices.delete(key)) changed = true;
    for (const key of [...this.failures.keys()]) if (mine(key) && this.failures.delete(key)) changed = true;
    return changed;
  }

  /**
   * The cache just lost bytes this store is still holding a copy of.
   *
   * The user emptied a category, and the in-memory copy in `assets` would otherwise go on
   * satisfying `preparedSize()` — so the Library would keep reading "prepared" against a store
   * holding nothing, until a reload silently flipped it back. Clearing is a deliberate action
   * with an obvious meaning, so it is honoured: what the cache held, this store lets go of.
   *
   * ONLY the categories that actually back a prepared file. `artifact` is a target's own
   * binaries and `converted` is its converter's output; emptying `cover`, `firmware`,
   * `converter`, `offline` or `other` cannot unprepare anything and does nothing here.
   *
   * ALL-OR-NOTHING PER TITLE, the same rule `restoreConverted` and `unsupply` already keep: a
   * title holding half its file set renders as prepared and installs incomplete, so a title
   * that lost any file loses the rest with it. That is why the category is recorded per key
   * (`assetSource`) rather than assumed — clearing only `artifact` must not drop a title whose
   * files are all converted output.
   *
   * NOT TOUCHED: `removed` (an explicit removal is the user's decision, persisted, and no part
   * of any cache), `supplied` and `discovered` (the user still has the input files; the row
   * simply offers Prepare again and re-converts without asking for them). A row whose output is
   * a real file on the user's disk is unaffected too, because `gameRows` only asks
   * `preparedSize()` when the scan found nothing.
   */
  forgetCleared(scope: BlobClearScope): void {
    const hit = new Set<"artifact" | "converted">();
    if (scope === "all" || scope === "artifact") hit.add("artifact");
    if (scope === "all" || scope === "converted") hit.add("converted");
    if (hit.size === 0) return;

    // An asset with no recorded category predates this bookkeeping or arrived by a path that
    // does not set it; treat it as converted, the category that cannot be re-fetched, so a
    // clear errs towards making the user press Prepare rather than towards a phantom.
    const backedByCleared = (key: string): boolean => hit.has(this.assetSource.get(key) ?? "converted");

    const doomed = new Set<string>();
    for (const [titleKey, keys] of this.produced) {
      if (keys.some(backedByCleared)) doomed.add(titleKey);
    }

    let droppedAssets = false;
    let droppedVerdicts = false;
    for (const titleKey of doomed) {
      for (const key of this.produced.get(titleKey) ?? []) {
        if (this.assets.delete(key)) droppedAssets = true;
        this.assetSource.delete(key);
        this.mappedArtifacts.delete(key);
      }
      this.produced.delete(titleKey);
      // The verdict described the preparation that produced those bytes. With the row back to
      // offering Prepare, a "prepared with notes" line underneath it would contradict it.
      if (this.dropVerdicts(titleKey)) droppedVerdicts = true;
    }

    // Anything of a cleared category that no title claims. `produced` is provenance, not a
    // guarantee of coverage, and a byte the user cannot see is a byte they cannot reclaim.
    for (const [key, category] of [...this.assetSource]) {
      if (!hit.has(category)) continue;
      if (this.assets.delete(key)) droppedAssets = true;
      this.assetSource.delete(key);
      this.mappedArtifacts.delete(key);
    }

    if (droppedAssets) this.assets = new Map(this.assets);
    if (droppedVerdicts) {
      this.notices = new Map(this.notices);
      this.failures = new Map(this.failures);
    }

    // The pointers name bytes that are gone. See `forgetConvertedIndex`.
    if (hit.has("converted")) forgetConvertedIndex();
  }

  /**
   * A SOURCE IS GONE. Let go of everything it was the reason for.
   *
   * The owner: "I added and removed a few homebrew several times and the Library page didn't
   * remove them correctly and show the majority of the data still being there." `remove()`
   * dropped the row and its bundle bytes and nothing else heard, so a removed source's prepared
   * files stayed in `assets` with their provenance intact -- and the Library, which sums bytes
   * by provenance, went on reporting them. Each add/remove cycle orphaned another set.
   *
   * Everything this store keys is namespaced by repo already: a title key is `repo#targetId`
   * and an input key is `repo#inputId`, so one prefix identifies the lot. That matters because
   * by the time this runs the ROW IS ALREADY GONE -- `homebrew.titles` derives from
   * `sources.rows`, so asking which titles belonged to the source would come back empty.
   * Provenance recorded at `run()` time is what makes this answerable at all.
   *
   * ALL-OR-NOTHING PER TITLE, as everywhere else here: `produced` names every key a title
   * wrote, artifacts included, and half a file set renders as prepared and installs incomplete.
   *
   * `removed` GOES TOO, and that is the one judgement worth stating. An explicit per-input
   * removal outranks discovery and survives a re-scan and a reload -- but it is scoped to a
   * source, and this one no longer exists. Keeping it would mean re-adding the source came back
   * with an input already marked removed: a half-restored state, which is exactly the shape of
   * the bug being fixed. `unsupply()` is unchanged and still means what it always did.
   *
   * THE BLOBS ARE LEFT ALONE, deliberately. The cache is content-addressed: a hash may be
   * referenced by another source's title -- two forks shipping one binary is enough -- and
   * there is no refcount, so deleting on removal could silently unprepare a source the user
   * still has. Unreferenced bytes stay reclaimable through the Cache pane, which is a surface
   * built for exactly that and which the bundle zips (keyed per repo, never shared) did not
   * have. If quota ever justifies reclaiming them, refcounting is the prerequisite.
   */
  forgetSource(repo: string): void {
    const prefix = `${repo}#`;
    this.loadRemoved();

    let droppedAssets = false;
    let droppedVerdicts = false;
    for (const titleKey of [...this.produced.keys()]) {
      if (!titleKey.startsWith(prefix)) continue;
      for (const key of this.produced.get(titleKey) ?? []) {
        if (this.assets.delete(key)) droppedAssets = true;
        this.assetSource.delete(key);
        this.mappedArtifacts.delete(key);
      }
      this.produced.delete(titleKey);
      // The verdict described a preparation of a source that is gone; there is no row left for
      // it to sit under.
      if (this.dropVerdicts(titleKey)) droppedVerdicts = true;
    }

    let droppedInputs = false;
    for (const key of [...this.supplied.keys()]) {
      if (key.startsWith(prefix) && this.supplied.delete(key)) droppedInputs = true;
    }
    let droppedDiscovery = false;
    for (const key of [...this.discovered.keys()]) {
      if (key.startsWith(prefix) && this.discovered.delete(key)) droppedDiscovery = true;
    }
    for (const key of [...this.discoveredUnrecognised.keys()]) {
      if (key.startsWith(prefix) && this.discoveredUnrecognised.delete(key)) droppedDiscovery = true;
    }
    let droppedRemovals = false;
    for (const key of [...this.removed]) {
      if (key.startsWith(prefix) && this.removed.delete(key)) droppedRemovals = true;
    }

    // A run still in flight for a source the user just deleted leaves the title reading
    // "extracting..." forever, because the `finally` that clears it looks the title up by a key
    // nothing renders any more.
    let droppedBusy = false;
    for (const titleKey of [...this.extracting]) {
      if (titleKey.startsWith(prefix) && this.extracting.delete(titleKey)) droppedBusy = true;
    }
    for (const titleKey of [...this.extractingFiles.keys()]) {
      if (titleKey.startsWith(prefix) && this.extractingFiles.delete(titleKey)) droppedBusy = true;
    }

    if (droppedAssets) this.assets = new Map(this.assets);
    if (droppedVerdicts) {
      this.notices = new Map(this.notices);
      this.failures = new Map(this.failures);
    }
    if (droppedInputs) this.supplied = new Map(this.supplied);
    if (droppedDiscovery) {
      this.discovered = new Map(this.discovered);
      this.discoveredUnrecognised = new Map(this.discoveredUnrecognised);
    }
    if (droppedRemovals) {
      this.removed = new Set(this.removed);
      this.persistRemoved();
    }
    if (droppedBusy) {
      this.extracting = new Set(this.extracting);
      this.extractingFiles = new Map(this.extractingFiles);
    }

    // The persisted pointer outlives the session, so a re-add would otherwise restore
    // yesterday's bytes into a freshly added source. See `forgetConvertedRepo`.
    forgetConvertedRepo(repo);
  }

  /**
   * Is this input answered at all — by a file the user picked, or by one already in their
   * folders? This is what the "Additional files" row reads: from the user's side the two are
   * the same statement ("you do not have to go and find this"), and the row's approved copy
   * ("Found ✓") says exactly that much and no more.
   */
  isSatisfied(repo: string, inputId: string): boolean {
    return this.hasSupplied(repo, inputId) || this.discoveredFor(repo, inputId).length > 0;
  }

  /**
   * The files a title's tool should run on when the caller offered none: everything discovery
   * found for that tool's inputs, plus the unrecognised names those carried.
   *
   * Deliberately only consulted for an EMPTY offer (see `run()`): a user who opened the picker
   * has answered the question, and a discovered file must never displace their answer.
   */
  private discoveredForTitle(title: HomebrewTitle): { files: OfferedFile[]; unrecognised: string[] } {
    const files: OfferedFile[] = [];
    const unrecognised: string[] = [];
    for (const input of title.tool?.inputs ?? []) {
      const key = `${title.repo}#${input.id}`;
      files.push(...(this.discovered.get(key) ?? []));
      unrecognised.push(...(this.discoveredUnrecognised.get(key) ?? []));
    }
    return { files, unrecognised };
  }

  /**
   * True when the caller must open `FilePromptModal` before `run()`.
   *
   * `promptsForInput`, not `!selfContained`: a tool whose inputs are all OPTIONAL needs no
   * file to run, but the prompt is the only place those files can be supplied, so it must
   * still open. A title with no tool has nothing to ask about and goes straight to step 1.
   */
  needsPrompt(title: HomebrewTitle): boolean {
    if (!title.promptsForInput) return false;
    // Suppressed ONLY when every declared input is CLOSED — answered, and unable to take
    // another file. Opening the picker to ask for a file we are already holding is what the
    // owner objected to; never opening it at all is what he objected to next, and the two are
    // reconciled by `closedByDiscovery` rather than by "has at least one file".
    //
    // AUTO-PREPARE IS STILL OFF: this decides only whether a QUESTION is asked, never whether
    // a conversion starts. The user presses prepare.
    return !(title.tool?.inputs ?? []).every((i) => this.closedByDiscovery(title.repo, i));
  }

  /**
   * Has discovery answered this input so completely that there is nothing left to ask?
   *
   * "It found a file" is NOT the same as "it is full", and conflating them is what made an
   * `allowMultiple` input unaskable: zelda3 declares `language` as optional + allowMultiple
   * with eleven published variants, so discovering the French ROM would have suppressed the
   * prompt and left no way to add the German one from the Library at all. A slot that can
   * still take another file is still a question worth asking.
   *
   *  - nothing found                     -> open (the input is unanswered)
   *  - OPTIONAL and repeatable, found    -> open until `maxCount`; "optional" means the extra
   *                                         files are the user's call, and discovery cannot
   *                                         make it for them. An unbounded slot never closes.
   *  - anything else, found              -> closed. A REQUIRED slot is answered once it has
   *                                         what it requires — Doom's `base` is required +
   *                                         allowMultiple, and re-asking there is exactly the
   *                                         noise the owner objected to. A single-file slot is
   *                                         answered by its one file; replacing it stays
   *                                         possible from the "Additional files" row, whose
   *                                         picker is unconditional (`rowOffersPicker`).
   */
  private closedByDiscovery(repo: string, input: ConverterInput): boolean {
    const found = this.discoveredFor(repo, input.id).length;
    if (found === 0) return false;
    if (input.required || !input.allowMultiple) return true;
    return input.maxCount !== undefined && found >= input.maxCount;
  }

  /**
   * Put back what a previous visit converted, from `convertedCache.ts`.
   *
   * Called from a view once the title list exists — lazily, never from `run()`, which must not
   * get slower on the common path. Idempotent and fire-and-forget: it is safe to call on every
   * mount, it never overwrites a title already in `assets` (a live conversion always wins over
   * a restored one), and a failure is indistinguishable from "nothing was cached".
   */
  async restore(titles: HomebrewTitle[], deps?: ConvertedCacheDeps): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    this.loadRemoved();
    let recovered: Awaited<ReturnType<typeof restoreConverted>> = [];
    try {
      recovered = await restoreConverted(titles, deps);
    } catch {
      return;
    }
    if (recovered.length === 0) return;
    const byKey = new Map(titles.map((t) => [t.key, t]));
    for (const t of recovered) {
      // The cache stores bare device FILENAMES; where they belong is a property of the TITLE
      // (`sources/placement.ts`), so it is re-derived here rather than persisted — a manifest
      // that moved its output between releases must not be restored to yesterday's directory.
      // An artifact filename is placed as an artifact, everything else as converted output.
      // A title whose input the user REMOVED is not restored at all — the pointer on disk was
      // written before the removal, and putting its converted output back would resurrect
      // exactly the bytes `unsupply()` dropped, one reload later.
      if (t.inputs.some((id) => this.removed.has(`${t.repo}#${id}`))) continue;
      const title = byKey.get(t.key);
      let artKey = "homebrew";
      let outKey = "homebrew";
      const artifactNames = new Set<string>();
      const mappedByName = new Map<string, { relocBase?: number }>();
      if (title) {
        try {
          artKey = assetPrefix(artifactDir(title.target));
          outKey = title.tool
            ? assetPrefix(converterOutputDir(title.target, useForTool(title.target, title.tool.id)))
            : artKey;
        } catch {
          continue; // a malformed placement is not restorable; the title is simply unprepared
        }
        for (const a of title.target.artifacts) artifactNames.add(a.filename);
        // THE MAPPED FACTS ARE PART OF RESTORING, not an extra. `run()` and
        // `prepareCoreArtifacts` both record `assets` + `assetSource` + `produced` +
        // `mappedArtifacts` in one block; this path recorded the first three and dropped the
        // fourth, and the damage was silent and total. A restored core still has every byte
        // and a populated `produced`, so `ensureCoresPrepared`'s "already prepared" test skips
        // the fetch that would have recorded them -- and with no `relocBase` the packer stops
        // treating `gba.xip` as addressable memory, files it in LittleFS with the rest of
        // `cores/`, and relocates nothing. The install looks entirely normal and the core
        // cannot run. It worked in the session that prepared it and broke on the next reload.
        //
        // Re-derived from the LIVE manifest, exactly like `artifactNames` beside it, never
        // persisted: a republished artifact that changed its sentinel must be read at today's
        // value, not last week's.
        for (const a of title.target.artifacts) {
          if (a.mapped !== true) continue;
          mappedByName.set(a.filename, a.relocBase === undefined ? {} : { relocBase: a.relocBase });
        }
      }
      const mine: string[] = [];
      for (const [fname, data] of t.files) {
        const isArtifact = artifactNames.has(fname);
        const key = `${isArtifact ? artKey : outKey}/${fname}`;
        if (!this.assets.has(key)) this.assets.set(key, data);
        this.assetSource.set(key, isArtifact ? "artifact" : "converted");
        const m = mappedByName.get(fname);
        if (m && isArtifact) this.mappedArtifacts.set(key, m);
        mine.push(key);
      }
      this.produced.set(t.key, mine);
      // The cache records WHICH inputs a title consumed, never which files went in, so the key
      // is recorded with no names rather than a fabricated count of one.
      for (const id of t.inputs) {
        const key = `${t.repo}#${id}`;
        if (!this.supplied.has(key)) this.supplied.set(key, new Set());
      }
    }
    this.assets = new Map(this.assets);
    this.supplied = new Map(this.supplied);
  }

  /**
   * Steps 1+2 with the input already settled. `offered` is the gate's `accepted` (empty for a
   * self-contained title); `unrecognised` is the gate's own list of files it let through under
   * `strict: false`, which MUST reach the user — see the notices below.
   *
   * Never throws: the Library called this as `void runPrepare(...)`, so a rejection would be
   * an unhandled one. It returns whether the title is now prepared, which is what the Library
   * uses to drive its OWN selection state — selection is a Library policy and stays there; a
   * prepare driven from the Sources tab must not silently select anything.
   */
  /**
   * Fetch a CORE's artifacts, with no converter involved.
   *
   * `run()` is reached through a `HomebrewTitle`, and `homebrewTitles.svelte.ts` deliberately
   * drops a core that declares no tool ("it has nothing to prepare"). That is right for the
   * Sources UI and wrong for an install: most cores have no converter at all, and their engine
   * binary is exactly what a selected ROM needs. tgb-dual is the case that surfaced it -- a GBC
   * ROM installed with no core, because the only core in `titles` was Doom, which has a WAD
   * converter and therefore an entry.
   *
   * So this is the artifact half of `run()` against a manifest target directly: same keys, same
   * `assetSource`, same `mappedArtifacts` (which is what carries `relocBase` to the packer), and
   * the same `produced` record that `coreGate` reads to decide whether a core is still wanted.
   */
  /**
   * Fetch the GAMES a core ships with itself (`systems[].games[]`, spec/07-cores.md).
   *
   * The sibling of `prepareCoreArtifacts`, and the difference is only the destination: an
   * artifact lands beside the core binary, a shipped game lands in `roms/<system id>/` -- the
   * folder the launcher browses, never `biosDir`. `assetPrefix` turns `roms/doom` into `doom`,
   * which is the same key space a converted `.whd` occupies, and that is deliberate: Doom's
   * shipped entry takes the same filename its `variants[]` table gives that dump, so a user who
   * converts the WAD themselves overwrites the shipped copy rather than getting two rows.
   *
   * Recorded as `artifact` because that is its provenance -- the project published it, the user
   * supplied nothing. `selectedAssets.ts` gates it on its Library row anyway, since a shipped
   * game is a ROM by behaviour and a row the user cleared must not install.
   *
   * Already-held bytes are left alone, so re-running costs no fetch and cannot clobber a copy
   * the user converted themselves.
   */
  async prepareShippedGames(games: readonly ShippedGameFetch[]): Promise<boolean> {
    if (games.length === 0) return false;
    const written: string[] = [];
    for (const g of games) {
      if (this.assets.has(g.key)) continue;
      const bytes = await fetchVerified(g.url, g.sha256);
      this.assets.set(g.key, bytes);
      this.assetSource.set(g.key, "artifact");
      written.push(g.key);
    }
    if (written.length === 0) return false;
    // `assets` is `$state` and a Map mutated in place notifies nobody -- the same reassignment
    // every other writer in this file makes for the same reason.
    this.assets = new Map(this.assets);
    return true;
  }

  async prepareCoreArtifacts(key: string, target: Target): Promise<boolean> {
    if ((target.artifacts?.length ?? 0) === 0) return false;
    const artKey = assetPrefix(artifactDir(target));
    const mappedByName = new Map<string, { relocBase?: number }>();
    for (const a of target.artifacts ?? []) {
      if (a.mapped !== true) continue;
      mappedByName.set(a.filename, a.relocBase === undefined ? {} : { relocBase: a.relocBase });
    }
    const written: string[] = [];
    let fetched: Map<string, Uint8Array>;
    if (key.startsWith("raw/")) {
      fetched = new Map();
      for (const a of target.artifacts ?? []) {
        // Older persisted raw rows reconstructed metadata without a hash. The repo key is
        // the container SHA-256, so use it as the cache key in that case.
        const hash = a.sha256 || key.slice("raw/".length).split("#", 1)[0];
        const data = rawCorePayload(hash) ?? await blobCache().get(hash);
        if (data) fetched.set(a.filename, data);
      }
      if (fetched.size !== (target.artifacts ?? []).length) fetched = await fetchTargetArtifacts(target);
    } else fetched = await fetchTargetArtifacts(target);
    for (const [fname, data] of fetched) {
      const k = `${artKey}/${fname}`;
      this.assets.set(k, data);
      this.assetSource.set(k, "artifact");
      const m = mappedByName.get(fname);
      if (m) this.mappedArtifacts.set(k, m);
      written.push(k);
    }
    if (written.length === 0) return false;
    const already = this.produced.get(key) ?? [];
    this.produced.set(key, [...new Set([...already, ...written])]);
    // `assets` is `$state`, and a Map mutated in place does not notify. Every other writer in
    // this file reassigns for the same reason.
    this.assets = new Map(this.assets);
    return true;
  }

  async run(
    title: HomebrewTitle,
    offered: OfferedFile[],
    unrecognised: string[] = [],
  ): Promise<boolean> {
    // An empty offer falls back to what discovery found — never the other way round; a file
    // the user picked is their answer and is used as given.
    let unrecognisedAll = unrecognised;
    if (offered.length === 0 && title.tool !== undefined) {
      const auto = this.discoveredForTitle(title);
      offered = auto.files;
      if (auto.files.length > 0) unrecognisedAll = [...unrecognised, ...auto.unrecognised];
    }
    const canConvert = title.tool !== undefined && offered.length > 0;
    if (!canConvert && title.target.artifacts.length === 0) return false;

    this.extracting.add(title.key);
    this.extracting = new Set(this.extracting);
    // Which FILES this run covers, so a sibling row of the same title does not read as busy.
    // Recorded only for a scoped run: an empty offer is a whole-title run and every row of it
    // genuinely is busy, which `isExtractingFile` reports by falling back to `extracting`.
    if (offered.length > 0) {
      const busy = new Set(this.extractingFiles.get(title.key) ?? []);
      for (const f of offered) busy.add(f.filename);
      this.extractingFiles.set(title.key, busy);
      this.extractingFiles = new Map(this.extractingFiles);
    }
    // Clear only THIS run's verdict. A sibling row's note survives, which is the whole point:
    // preparing `doom2.wad` must not wipe what the module said about `DOOM.WAD`.
    const verdictKeys = PrepareState.runKeys(title.key, offered);
    for (const k of verdictKeys) {
      this.failures.delete(k);
      this.notices.delete(k);
    }
    this.failures = new Map(this.failures);
    this.notices = new Map(this.notices);
    try {
      // WHERE THIS TITLE'S FILES GO. `sources/placement.ts` decides, per target kind: a
      // homebrew's artifacts and converted output share one directory (`homebrew/`, which
      // `userDest()` expands to whatever the firmware calls it); a core's binary goes to
      // `cores/` and its converted output is a GAME in `roms/<system id>/`. The keys below are
      // exactly what `planFlashImage()`'s `userDest()` reads, so a converted Doom WAD lands in
      // `roms/doom/` beside a ROM the user already had — which is the whole point of the
      // placement rule and the reason these keys are no longer hardcoded to `homebrew/`.
      const artKey = assetPrefix(artifactDir(title.target));
      const files = new Map<string, Uint8Array>();

      // Artifacts first: they are the cheap, deterministic half, and a title whose engine
      // cannot be fetched is not installable however well its converter runs.
      // `fetchTargetArtifacts` returns bytes only, so the manifest entry -- the only thing that
      // knows an artifact is `mapped` -- is looked up here, where `title.target` is still in hand.
      const mappedByName = new Map<string, { relocBase?: number }>();
      for (const a of title.target.artifacts ?? []) {
        if (a.mapped !== true) continue;
        mappedByName.set(a.filename, a.relocBase === undefined ? {} : { relocBase: a.relocBase });
      }
      for (const [fname, data] of await fetchTargetArtifacts(title.target)) {
        const key = `${artKey}/${fname}`;
        files.set(key, data);
        this.assetSource.set(key, "artifact");
        const m = mappedByName.get(fname);
        if (m) this.mappedArtifacts.set(key, m);
      }

      const notices: string[] = [];
      // The SAME notices as data, for the global audit log (`auditLog.svelte.ts`). Two shapes of
      // the same facts on purpose: the row's short status reads `notices` to know THAT there is
      // something to say, and the log renders these at display time so the user reads them in
      // their language and `Copy` writes English. Built here, where the key and its params are
      // still in hand — recovering them from the rendered string later is impossible.
      const noticeEntries: { severity: AuditSeverity; entry: LogEntry }[] = [];
      if (canConvert) {
        // The host already bounds the run with its own timeout, so there is no race here.
        // `offered` whole, inputId included: the gate's verdict for a file is only correct
        // against the input the user actually supplied it for. Stripping the id here (and
        // letting the converter re-derive one from the extension) is what refused every
        // zelda3 translated ROM — two inputs share `.sfc`, so both landed on `base`.
        // Through the converted-output cache: an identical (title, tool version, input files)
        // triple already on disk skips the run entirely. See `convertedCache.ts` for how the
        // pointer is keyed and why a stale hit cannot happen.
        const res = await convertCached(title, offered, () => convertHomebrewTitle(title, offered));
        const outKey = assetPrefix(
          converterOutputDir(title.target, useForTool(title.target, title.tool!.id)),
        );
        for (const [fname, data] of res.files) {
          const key = `${outKey}/${fname}`;
          files.set(key, data);
          this.assetSource.set(key, "converted");
        }
        // Requirements, not extras: a warning is the only voice the module has, and a file
        // accepted under `strict: false` MUST be reported as unrecognised. The prompt's gate
        // and the run's own gate both name those files; union them so neither pass can drop one.
        const notRecognised = new Set([...unrecognisedAll, ...res.unrecognised]);
        notices.push(
          ...[...notRecognised].map((f) => locale.t.roms.selectGames.convertUnrecognised(f)),
          ...res.warnings,
        );
        // TWO SHAPES, TWO SEVERITIES. They looked alike while the log had one non-error level
        // and are not alike at all:
        //   - an unrecognised file used under `strict: false` is a WARNING about the RESULT —
        //     the gate could not identify it, used it anyway, and the output was named from the
        //     filename rather than a declared variant, so nothing verified it is the file the
        //     user believes. It is the line that explains a game that later misbehaves.
        //   - a module's own warning is INFO about WHAT IT DID. `cropped 11 widescreen lumps`
        //     is a transformation performed, not a doubt about the outcome; the owner called
        //     this one "essentially an info message from the doom wad converter".
        // Neither notifies — see `auditLog.notifications`, which is errors only.
        noticeEntries.push(
          ...[...notRecognised].map(
            (f) => ({ severity: "warning", entry: msg((t) => t.roms.selectGames.convertUnrecognised, f) }) as const,
          ),
          // A module's warning is its own runtime text — never translated, in any locale.
          ...res.warnings.map((w) => ({ severity: "info", entry: literal(w) }) as const),
        );
      }

      for (const [key, data] of files) this.assets.set(key, data);
      this.assets = new Map(this.assets);
      // ACCUMULATE, never replace. With `runPerFile` the user prepares one row at a time, so
      // this runs once per game; replacing would leave `produced` naming only the last one and
      // `unsupply()` would then orphan every earlier game's bytes in `assets` — present in the
      // install, accounted for by nothing on screen.
      const already = this.produced.get(title.key) ?? [];
      this.produced.set(title.key, [...new Set([...already, ...files.keys()])]);
      this.loadRemoved();
      // ACCUMULATE by filename, for `produced`'s reason directly above: with `runPerFile` this
      // runs once per game, so replacing would leave the row claiming only the last file.
      for (const f of offered) {
        const key = `${title.repo}#${f.inputId}`;
        const names = this.supplied.get(key) ?? new Set<string>();
        names.add(f.filename);
        this.supplied.set(key, names);
        // Attribution rides along with the name it belongs to. Overwrite rather than keep the
        // first: re-picking the same name means new bytes, so an older match no longer describes
        // the file the row is holding.
        const fk = PrepareState.fileKey(key, f.filename);
        if (f.variantId !== undefined) this.variantOfFile.set(fk, f.variantId);
        else this.variantOfFile.delete(fk);
      }
      this.supplied = new Map(this.supplied);
      this.variantOfFile = new Map(this.variantOfFile);
      // Answering the input again is the way back from a removal — otherwise the file the user
      // has just picked would still be refused by `setDiscovered()` for the rest of the session.
      let unremoved = false;
      for (const f of offered) {
        const key = `${title.repo}#${f.inputId}`;
        // BOTH shapes: the input may have been emptied wholesale, or just this one file taken
        // out. Clearing only the input key would leave a per-file removal standing, and the
        // very file the user has just re-picked would be filtered straight back out of the
        // next discovery pass.
        if (this.removed.delete(key)) unremoved = true;
        if (this.removed.delete(PrepareState.fileKey(key, f.filename))) unremoved = true;
      }
      if (unremoved) {
        this.removed = new Set(this.removed);
        this.persistRemoved();
      }
      // A NOTICE IS NOT A FAILURE. The run succeeded — the row it belongs to is installable,
      // and these lines are what the module and the gate said while doing it. Filed under the
      // run's own keys so a sibling row shows nothing.
      if (notices.length > 0) {
        for (const k of verdictKeys) this.notices.set(k, notices);
        this.notices = new Map(this.notices);
        // …and into the one place a user can read the whole of it. The row keeps only a short
        // status; the DETAIL — an eleven-item lump inventory, or the name of every file the
        // gate used under `strict: false` — lives here. Nothing is dropped by shortening the
        // row, which is the point: spec/03 requires an unrecognised-but-used file to reach the
        // user, and it still does.
        const subject = PrepareState.verdictSubject(title, offered);
        for (const n of noticeEntries) auditLog.add(n.severity, "converter", n.entry, subject);
      }
      return true;
    } catch (err: unknown) {
      // THE USER GETS A SENTENCE, THE LOG GETS THE CODE. These two deliberately diverge.
      //
      // This line used to be `convertFailed(err.code)` plus the raw `detail` in parentheses,
      // which is what put `Couldn't prepare: malformed` in front of the owner in German: an
      // identifier where a sentence belongs, and untrusted thrower text after it. Every other
      // surface moved to `prepareText` (sources/errorText.ts); this one is the store, and was
      // the last of them.
      //
      // `prepareText` groups all 38 codes by what the user can DO about it, and takes no
      // `detail` — an unexpected error (neither SourceError nor ConverterError) has no code at
      // all, so it maps through the same `default` arm to "the conversion did not finish",
      // which is the only honest thing to say about it.
      const text = prepareText(
        locale.t.sources,
        err instanceof SourceError || err instanceof ConverterError ? err.code : undefined,
      );
      // Same keying as a notice: one game failing to convert says nothing about its sibling.
      for (const k of verdictKeys) this.failures.set(k, text);
      this.failures = new Map(this.failures);
      // The failure, in full, in the log. The row says only that it did not work; the REASON —
      // and the untrusted detail the thrower attached — is a click away rather than inline.
      const code =
        err instanceof SourceError || err instanceof ConverterError
          ? err.detail
            ? `${err.code} (${err.detail})`
            : err.code
          : err instanceof Error
            ? err.message
            : String(err);
      auditLog.add(
        "error",
        "converter",
        msg((t) => t.roms.selectGames.convertFailed, code),
        PrepareState.verdictSubject(title, offered),
      );
      return false;
    } finally {
      // Drop only THIS run's files: a concurrent run on a sibling row still owns its own, and
      // the TITLE stays busy while any of them do — clearing it unconditionally would let the
      // first row to finish declare the whole core idle underneath the second.
      const busy = this.extractingFiles.get(title.key);
      if (busy) {
        for (const f of offered) busy.delete(f.filename);
        if (busy.size === 0) this.extractingFiles.delete(title.key);
        this.extractingFiles = new Map(this.extractingFiles);
      }
      if ((this.extractingFiles.get(title.key)?.size ?? 0) === 0) {
        this.extracting.delete(title.key);
        this.extracting = new Set(this.extracting);
      }
    }
  }
}

export const prepareState = new PrepareState();

// The store that owns the bytes announces when they are gone; this is the only thing that
// listens. `ui/CachePane.svelte` still knows nothing but its own totals, and the Library reads
// `assets` exactly as it did before.
onBlobCacheCleared((scope) => prepareState.forgetCleared(scope));

// And the same shape for a source going away: `sources.remove()` announces, this listens, and
// the store still knows nothing about what anyone else was keeping on its behalf.
onSourceRemoved((repo) => prepareState.forgetSource(repo));
