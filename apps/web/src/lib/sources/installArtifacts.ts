/**
 * Fetch a homebrew target's own `artifacts[]` — the engine `.bin` and anything shipped
 * beside it — so the install path can use the SOURCE's files instead of whatever copy the
 * firmware bundle happens to carry.
 *
 * This is the other half of "prepare". `homebrewConvert.ts` produces the files a converter
 * DERIVES from the user's ROM; this produces the files the publisher SHIPS. A title needs
 * both to be installable, and a self-contained title (no tool at all) needs only this one —
 * which is exactly why the caller cannot keep treating "prepare" as "run the converter".
 *
 * Trust rules, same as everywhere else in `sources/`:
 *   - a mirror is not a trust boundary: every byte is checked against the manifest's sha256
 *     (`fetchVerified`), and the length is checked against the manifest's `bytes` too;
 *   - the list comes from a third-party repo, so it is fetched with a bounded concurrency —
 *     never an unbounded `Promise.all` over an arbitrary array. There is no total-size
 *     ceiling: what an install has to fit in is a property of the DEVICE, not a constant
 *     (see the note in `fetchTargetArtifacts`);
 *   - failures leave as a `SourceError` code, never a raw fetch/DOM message.
 */
import { fetchVerified } from "./client.js";
import { blobCache, type BlobCache } from "./blobCache.js";
import { SourceError, type Artifact, type Target } from "./types.js";

/** How many artifact fetches are in flight at once. Small on purpose: the list is untrusted. */
const CONCURRENCY = 3;

/** Mirrors `ConverterProgress`'s role — enough for a caller to show which file it is on. */
export interface ArtifactProgress {
  /** Artifacts finished so far. */
  done: number;
  /** Artifacts in this target. */
  total: number;
  /** The filename just finished, as the manifest names it. Untrusted text. */
  filename: string;
}

export interface ArtifactFetchOptions {
  onProgress?: (p: ArtifactProgress) => void;
  signal?: AbortSignal;
  /**
   * Injected seams, for tests only. Production passes neither.
   *
   * `fetch` is the verified network path; `cache` is the content-addressed blob store. Both
   * default to the real thing, so every existing caller is unaffected.
   */
  fetch?: (url: string, sha256: string) => Promise<Uint8Array>;
  cache?: BlobCache;
}

function abortIf(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SourceError("aborted");
}

/**
 * Fetch every artifact of `target`, verified, into `filename -> bytes`.
 *
 * Throws `SourceError`; the caller maps `code` to copy and shows `detail` (untrusted: a
 * filename or a byte count) as a clearly-secondary line.
 */
export async function fetchTargetArtifacts(
  target: Target,
  opts?: ArtifactFetchOptions,
): Promise<Map<string, Uint8Array>> {
  const list: Artifact[] = target.artifacts ?? [];
  const out = new Map<string, Uint8Array>();
  if (list.length === 0) return out;

  // There is deliberately NO total-size ceiling here. An earlier version carried a 64 MiB one;
  // it was invented, not derived, and it was wrong in every direction. What actually bounds an
  // install is the device: in flash mode the FrogFS gap between the image and LittleFS, read
  // off the live device (`RomManagementTab`'s `validateFit`/`fitsGap`); in SD mode the card,
  // plus the extflash ROM cache for any single item. None of those is a constant this module
  // could know, and real homebrew is large — a Quake port is ~40 MB before CD audio — so any
  // fixed number here is a future false refusal of a legitimate title. The manifest's declared
  // sizes are still validated as numbers, because the fit maths downstream trusts them.
  for (const a of list) {
    if (!Number.isFinite(a.bytes) || a.bytes < 0) throw new SourceError("malformed", a.filename);
  }

  const fetchOne = opts?.fetch ?? fetchVerified;
  const cache = opts?.cache ?? blobCache();

  let done = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      const a = list[i];
      abortIf(opts?.signal);

      // CACHE FIRST, then the network. The manifest's `sha256` IS the cache key, so a lookup
      // needs nothing the caller did not already have — and a hit is self-verifying, because
      // `BlobCache.get` re-hashes the stored bytes against that key and reports a mismatch as a
      // miss. A miss is the normal answer (eviction is routine), so the network path below is
      // untouched and remains the only source of truth.
      const key = a.sha256.toLowerCase();
      let bytes = await cache.get(key).catch(() => null);
      if (!bytes) {
        // `fetchVerified` throws SourceError("malformed", url) on a hash mismatch. The hash is
        // never optional here — a manifest without one would have failed to parse.
        bytes = await fetchOne(a.url, a.sha256);
        // A cache write must never fail an install: a full disk is not a reason to refuse a
        // download that already succeeded. `put` answers false rather than throwing, but the
        // catch covers a backend that breaks its own contract.
        await cache.put(key, bytes, "artifact").catch(() => false);
      }

      if (bytes.length !== a.bytes) {
        // A hash match with a length mismatch cannot really happen, but the manifest's own
        // number is what the fit maths downstream trusts, so a disagreement is a refusal
        // rather than something to paper over.
        throw new SourceError("artifact-size-mismatch", `${a.filename}: ${bytes.length}`);
      }
      out.set(a.filename, bytes);
      done++;
      opts?.onProgress?.({ done, total: list.length, filename: a.filename });
    }
  }

  // Bounded fan-out. The first rejection wins and the remaining workers stop at their next
  // loop turn; nothing here retries, because a bad hash is not a transient condition.
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => worker()));
  return out;
}
