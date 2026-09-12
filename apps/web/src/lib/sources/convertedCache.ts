/**
 * Persistence for CONVERTED OUTPUT — the fourth `blobCache()` call site, and the only one
 * whose bytes cannot be re-fetched from anywhere.
 *
 * `prepareState.assets` is an in-memory `Map`. Its header explains why it is store-backed
 * rather than component-local (a tab switch must not destroy it) — but a RELOAD still does,
 * and every conversion is then re-run over a ROM the user must supply again. This module is
 * what makes a reload cheap.
 *
 * ## The pointer, and its trade-off
 *
 * `blobCache` is CONTENT-addressed: you must already know the sha256 of what you want. That is
 * exactly what makes the other three categories self-invalidating — a new release has different
 * bytes, therefore a different key, therefore a miss, with no version field to forget to bump.
 * A converted file has no such key available in advance: the content IS the thing being looked
 * for, and it is looked up by NAME (`assets` is keyed `homebrew/<filename>`).
 *
 * So this needs a name -> hash pointer, the same shape and for the same reason as
 * `artifacts.ts`'s `gnw.bundleHash.v1` firmware-bundle pointer. The trade-off is identical and
 * stated here as it is there: the pointer is a small JSON object in localStorage, it is NOT
 * self-invalidating, and correctness therefore rests on what the pointer is KEYED by rather
 * than on the content hash. Get that key wrong and a stale hit is possible; get it right and
 * the pointer is only ever an optimisation. The bytes themselves stay content-addressed — a
 * pointer to bytes that have rotted still misses, because `BlobCache.get()` re-hashes.
 *
 * ## What identifies a conversion
 *
 * A converted file is valid for exactly one (title, tool version, input files) triple, so the
 * SIGNATURE is the sha256 of a canonical line-per-fact record of all three:
 *
 *   - `title=<title.key>`             — `owner/repo#targetId`, so two sources publishing the
 *                                       same target id are never confused;
 *   - `tool=<tool.binary.sha256>`     — the converter module's OWN content hash, already
 *                                       verified by `converter.ts`. A republished tool is
 *                                       different bytes, hence a different signature. This is
 *                                       the "source publishes a new version" case;
 *   - `in=<inputId>:<sha256(bytes)>`  — one sorted line per accepted input, bound to the input
 *                                       id the user answered for (never re-derived from an
 *                                       extension — see `homebrewConvert.ts`). This is the
 *                                       "user supplies a different ROM" case, and binding the
 *                                       id means swapping two same-extension files between
 *                                       slots also changes the signature.
 *
 * Anything that could change the output changes the signature, so a hit on the signature is a
 * hit on a conversion that WOULD have produced these bytes. Nothing else is consulted.
 *
 * ## What `runPerFile` changed here: nothing, deliberately
 *
 * A `runPerFile` tool runs once per file and ACCUMULATES its outputs (`homebrewConvert.ts`), so
 * an entry now indexes the result of N runs rather than one. That does not move the entry's
 * meaning: the signature already covers `in=<inputId>:<sha256>` for EVERY accepted input, and
 * `convertHomebrewTitle` is a pure function of exactly that set — so a hit is still a hit on a
 * conversion that would have produced these bytes, whether it took one run or eight. The
 * granularity is the BATCH, not the run, and every field it is keyed on is a property of the
 * batch.
 *
 * The trade-off, stated rather than discovered later: adding a twenty-first WAD to a shelf of
 * twenty changes the signature and re-runs all twenty-one conversions, because the entry is
 * all-or-nothing. Per-FILE reuse would be a different cache — keyed on (tool, one input file),
 * with an entry per produced file — and it would have to reconcile with `restoreConverted`'s
 * deliberately all-or-nothing per-title restore (a half-restored title renders as prepared and
 * installs incomplete). That is a real cache design, not a tweak to this one, and it buys
 * seconds on a path the user takes rarely; it is not done here. If a shelf of ROMs ever becomes
 * the common case, this is the paragraph to come back to.
 *
 * ## Restoring on load
 *
 * A reload has no input bytes, so the signature cannot be recomputed there. `restoreConverted`
 * therefore re-checks the half it still can — the title still exists and its tool binary hash
 * is unchanged — and takes the inputs on trust.
 *
 * ONE ENTRY PER TITLE, FILES ACCUMULATED. The entry used to be replaced wholesale by each run,
 * which was right when a run meant "the title's whole batch". `runPerFile` broke that: the
 * Library prepares ONE game per press, so a replacing write made preparing the second game
 * drop the pointer to the first. `assets` merges in memory, so nothing looked wrong until a
 * reload — after which the first game was quietly unprepared again. So a write now merges its
 * `files` into whatever the title already had, provided the TOOL HASH still matches (a
 * republished converter starts fresh rather than mixing its output with the old build's).
 *
 * The cost of merging, stated rather than discovered later: the stored `sig` describes only
 * the LAST run's offered set, so pressing Prepare again on a game other than the most recent
 * one misses and re-converts. A miss is invisible and always safe — it is the behaviour
 * without this module at all — and the reload path, which is what the cache exists for, is
 * exact. Per-file `sig` reuse is the "different cache" described above, not a tweak to this one.
 *
 * Restore is all-or-nothing per title: a title whose artifacts or converted outputs are not all
 * present is skipped entirely, because a half-restored title would render as prepared and then
 * install incomplete. The artifact half is not stored here at all — it is looked up from the
 * LIVE manifest's `sha256` values, so a source that republished its engine simply misses.
 *
 * A MISS IS INVISIBLE. Eviction is normal. On a miss the title looks unprepared and the user
 * re-runs the conversion exactly as they do today; no error is ever surfaced from this module,
 * and a cache write that fails never fails a conversion.
 */
import { scoped } from "../storageScope.js";
import { blobCache, blobKey, type BlobCache } from "./blobCache.js";
import type { HomebrewConversion } from "./homebrewConvert.js";
import type { OfferedFile } from "./inputGate.js";
import type { HomebrewTitle } from "./homebrewTitles.svelte.js";

/** One title's last conversion. Text only: this is an index INTO the blob cache, not bytes. */
export interface ConvertedEntry {
  /** The signature described in the header. A `run()` only reuses an entry that matches it. */
  sig: string;
  /** `tool.binary.sha256` on its own, so a reload can re-check it without the input bytes. */
  tool: string;
  /** The source repo, so `prepareState.supplied` can be restored with it. */
  repo: string;
  /** The input ids the user supplied, for that same `supplied` set. */
  inputs: string[];
  /** Output filename -> sha256 of its bytes in the blob cache. */
  files: Record<string, string>;
  /** The run's own notices, kept so a cache hit reproduces the whole `HomebrewConversion`. */
  warnings: string[];
  unrecognised: string[];
}

/** Injected for tests, exactly as `artifacts.ts`'s `BundleHashIndex` is. */
export interface ConvertedIndex {
  get(titleKey: string): ConvertedEntry | null;
  set(titleKey: string, entry: ConvertedEntry): void;
  entries(): [string, ConvertedEntry][];
}

const INDEX_KEY = scoped("gnw.convertedHash.v1");

function isEntry(v: unknown): v is ConvertedEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.sig === "string" &&
    typeof e.tool === "string" &&
    typeof e.repo === "string" &&
    Array.isArray(e.inputs) &&
    !!e.files &&
    typeof e.files === "object" &&
    Array.isArray(e.warnings) &&
    Array.isArray(e.unrecognised)
  );
}

/** The real index. One small JSON object in localStorage; every method swallows its failures. */
export function localConvertedIndex(): ConvertedIndex {
  const read = (): Record<string, ConvertedEntry> => {
    try {
      const raw = globalThis.localStorage?.getItem(INDEX_KEY);
      const doc: unknown = raw ? JSON.parse(raw) : null;
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
      const out: Record<string, ConvertedEntry> = {};
      for (const [k, v] of Object.entries(doc as Record<string, unknown>)) if (isEntry(v)) out[k] = v;
      return out;
    } catch {
      return {};
    }
  };
  return {
    get(titleKey) {
      return read()[titleKey] ?? null;
    },
    set(titleKey, entry) {
      try {
        const doc = read();
        doc[titleKey] = entry;
        globalThis.localStorage?.setItem(INDEX_KEY, JSON.stringify(doc));
      } catch {
        /* the pointer is an optimisation; losing it costs one re-conversion */
      }
    },
    entries() {
      return Object.entries(read());
    },
  };
}

/**
 * Drop every pointer. Called when the `converted` blobs are cleared, because at that moment
 * every `files` hash in every entry names bytes that are gone.
 *
 * Not merely tidiness. `convertCached` MERGES a new run's files into whatever the title already
 * had, so an entry left behind after a clear carries dead pointers forward: preparing one game
 * again would write an entry naming both the new output and the vanished one, and
 * `restoreConverted` is all-or-nothing per title, so the next reload would skip the title
 * entirely and unprepare the game that had just been prepared. Pruning here keeps the
 * merge honest.
 *
 * Swallows its failures like every other write in this module: a pointer that cannot be
 * removed costs one wasted lookup and a re-conversion, never a wrong result, because
 * `BlobCache.get()` re-hashes and a pointer to bytes that are gone simply misses.
 */
export function forgetConvertedIndex(): void {
  try {
    globalThis.localStorage?.removeItem(INDEX_KEY);
  } catch {
    /* the pointer is an optimisation; a stale one still cannot produce a wrong hit */
  }
}

/**
 * Drop one source's pointers, leaving every other source's alone.
 *
 * `forgetConvertedIndex()` is right for a cache clear, where every hash in every entry names
 * bytes that are gone. It is wrong for removing a source: that would forget the pointers of
 * sources the user still has, costing them a re-conversion each for something they did not do.
 *
 * Entries are keyed by `HomebrewTitle.key`, which is `owner/repo#targetId`, so a source's are
 * exactly those under its own prefix. `ConvertedEntry.repo` carries the same fact and is
 * asserted to agree in the suite; the prefix is used here because it is how every other map
 * this removal touches identifies a source.
 *
 * Why this is not merely tidiness: `restoreConverted` is driven by the title list, so a removed
 * source's stale entry is inert while it stays removed -- but the moment the user RE-ADDS that
 * source its titles are back, the stale pointer matches again, and the next reload restores
 * yesterday's bytes into a freshly added source. That is the half-restored re-add.
 */
export function forgetConvertedRepo(repo: string): void {
  const prefix = `${repo}#`;
  try {
    const raw = globalThis.localStorage?.getItem(INDEX_KEY);
    const doc: unknown = raw ? JSON.parse(raw) : null;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return;
    const kept: Record<string, unknown> = {};
    let dropped = false;
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      if (k.startsWith(prefix)) dropped = true;
      else kept[k] = v;
    }
    if (!dropped) return;
    globalThis.localStorage?.setItem(INDEX_KEY, JSON.stringify(kept));
  } catch {
    /* as above: a pointer that cannot be pruned costs a lookup, never a wrong result */
  }
}

export interface ConvertedCacheDeps {
  cache?: BlobCache;
  index?: ConvertedIndex;
}

/**
 * The signature for this exact (title, tool version, input files) triple, or null when the
 * title has no tool (nothing is converted, so nothing is cached).
 */
export async function conversionSignature(
  title: HomebrewTitle,
  offered: OfferedFile[],
): Promise<string | null> {
  const tool = title.tool;
  if (!tool) return null;
  const lines = [`conv.v1`, `title=${title.key}`, `tool=${tool.binary.sha256}`];
  const ins: string[] = [];
  for (const f of offered) ins.push(`in=${f.inputId}:${await blobKey(f.bytes)}`);
  ins.sort();
  const text = [...lines, ...ins].join("\n");
  return blobKey(new TextEncoder().encode(text));
}

/**
 * Run `exec` — unless this exact conversion is already on disk, in which case serve it and
 * never call `exec` at all.
 *
 * Every cache interaction is best-effort: a broken index, an evicted blob, a refused write and
 * an unavailable OPFS all degrade to "just convert", which is the behaviour without this module.
 */
export async function convertCached(
  title: HomebrewTitle,
  offered: OfferedFile[],
  exec: () => Promise<HomebrewConversion>,
  deps?: ConvertedCacheDeps,
): Promise<HomebrewConversion> {
  const cache = deps?.cache ?? blobCache();
  const index = deps?.index ?? localConvertedIndex();

  let sig: string | null = null;
  try {
    sig = await conversionSignature(title, offered);
  } catch {
    sig = null;
  }

  if (sig) {
    try {
      const hit = index.get(title.key);
      if (hit && hit.sig === sig) {
        const files = new Map<string, Uint8Array>();
        let complete = true;
        for (const [fname, hash] of Object.entries(hit.files)) {
          const bytes = await cache.get(hash);
          // One missing output makes the whole set unusable; fall through and re-convert.
          if (!bytes) {
            complete = false;
            break;
          }
          files.set(fname, bytes);
        }
        if (complete && files.size > 0) {
          return { files, warnings: [...hit.warnings], unrecognised: [...hit.unrecognised] };
        }
      }
    } catch {
      /* a miss, like any other */
    }
  }

  const res = await exec();

  if (sig) {
    try {
      const files: Record<string, string> = {};
      let stored = true;
      for (const [fname, bytes] of res.files) {
        const hash = await blobKey(bytes);
        // Store-then-point, in that order: a pointer to an entry that was never written would
        // cost a wasted lookup on every future run.
        if (!(await cache.put(hash, bytes, "converted"))) {
          stored = false;
          break;
        }
        files[fname] = hash;
      }
      if (stored && Object.keys(files).length > 0) {
        // MERGE with what this title already had, do not replace it.
        //
        // `runPerFile` made the entry's granularity wrong: the user prepares one game at a
        // time, so each run offers ONE file, and a replacing write meant preparing `doom2.wad`
        // dropped the pointer to `The Ultimate Doom.whd`. In memory both survived (`assets`
        // merges), so the bug was invisible until a reload — after which the first game was
        // silently unprepared again.
        //
        // Only merge across the SAME tool build: a republished converter must not have its new
        // output sit beside stale files from the old one. A different tool hash starts fresh,
        // which is the same "different bytes, different result" rule the signature encodes.
        const prev = index.get(title.key);
        const toolHash = title.tool?.binary.sha256 ?? "";
        const carry = prev && prev.tool === toolHash ? prev : undefined;
        index.set(title.key, {
          sig,
          tool: toolHash,
          repo: title.repo,
          inputs: [...new Set([...(carry?.inputs ?? []), ...offered.map((f) => f.inputId)])],
          files: { ...(carry?.files ?? {}), ...files },
          warnings: [...res.warnings],
          unrecognised: [...res.unrecognised],
        });
      }
    } catch {
      /* an uncacheable conversion is still a perfectly good conversion */
    }
  }

  return res;
}

/** One title's complete prepared file set, recovered from disk. */
export interface RestoredTitle {
  key: string;
  repo: string;
  inputs: string[];
  /** Device filename -> bytes, artifacts first then converted outputs, as `run()` merges them. */
  files: Map<string, Uint8Array>;
}

/**
 * Everything that can be put back after a reload. Never throws and never reports a failure: a
 * title it cannot fully recover is simply absent from the result, i.e. unprepared.
 */
export async function restoreConverted(
  titles: HomebrewTitle[],
  deps?: ConvertedCacheDeps,
): Promise<RestoredTitle[]> {
  const cache = deps?.cache ?? blobCache();
  const index = deps?.index ?? localConvertedIndex();
  const out: RestoredTitle[] = [];
  let held: [string, ConvertedEntry][] = [];
  try {
    held = index.entries();
  } catch {
    return out;
  }
  const byKey = new Map(held);
  for (const title of titles) {
    const entry = byKey.get(title.key);
    if (!entry) continue;
    // The half a reload can still check: this is the "source published a new tool" case.
    if (!title.tool || title.tool.binary.sha256 !== entry.tool) continue;
    try {
      const files = new Map<string, Uint8Array>();
      let complete = true;
      // Artifacts come from the LIVE manifest's hashes, never from the pointer, so a
      // republished engine misses instead of restoring the old one.
      for (const a of title.target.artifacts) {
        const bytes = await cache.get(a.sha256);
        if (!bytes) {
          complete = false;
          break;
        }
        files.set(a.filename, bytes);
      }
      if (!complete) continue;
      for (const [fname, hash] of Object.entries(entry.files)) {
        const bytes = await cache.get(hash);
        if (!bytes) {
          complete = false;
          break;
        }
        files.set(fname, bytes);
      }
      if (!complete || files.size === 0) continue;
      out.push({ key: title.key, repo: entry.repo, inputs: [...entry.inputs], files });
    } catch {
      /* this title is simply not restorable */
    }
  }
  return out;
}
