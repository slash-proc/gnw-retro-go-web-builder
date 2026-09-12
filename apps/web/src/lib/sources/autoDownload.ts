/**
 * Auto-download: warm the blob cache with a source's own artifacts, before the user asks.
 *
 * WHAT THIS IS. The owner's instruction was "if homebrew/emulators are less than 5MB, then we
 * go ahead and start downloading them", narrowed on a follow-up to downloading ONLY — the
 * converter never runs from here, `prepareState.ts` is not touched, and no WASM work is
 * triggered. All this module does is put bytes the user is likely to need into
 * `blobCache.ts` early, so the moment they do ask, `installArtifacts.ts` finds them there.
 *
 * WHAT IT IS NOT. It is not a UI feature. Nothing here writes to a row, sets a status, or
 * produces a string — there is no approved artboard for "downloading in the background" and no
 * i18n key for one, and inventing either would be inventing UI. A user who never looks sees
 * exactly today's Sources rail; a user who clicks install on a warmed row sees the download
 * step go by fast. That is the entire visible surface, on purpose.
 *
 * WHICH ROWS (the scale decision). Only rows the user has ACTIVATED, and only network-resolved
 * ones. The firmware release's curated list now lands ~22 rows in the rail on first load
 * (`store.svelte.ts`'s `importCurated`), all INACTIVE — the app listed them, the user did not
 * ask for them. Downloading for those would mean tens of megabytes of third-party fetches on
 * a first visit for content nobody selected, which is the opposite of what a curated list
 * being inactive means. `active` is the one existing signal that the user wants this source,
 * it already gates the install path, and it costs no new state. A bundle row is skipped too:
 * its bytes are already local, and its artifact URLs are this tab's blob URLs.
 *
 * WHICH SIZE. The manifest's DECLARED `artifacts[].bytes`, summed, before any request goes
 * out. It is the only honest number: fetching to discover a size would have already spent the
 * bandwidth the threshold exists to protect. It is also the same number the fit maths trusts
 * downstream, and `fetchTargetArtifacts` refuses a payload whose real length disagrees with
 * it — so a manifest that lies about being small still cannot make a large file land silently.
 *
 * FAILURE IS SILENT, ALWAYS. Nobody asked for this download, so nobody should have to dismiss
 * its failure. Every error is swallowed and the row is left byte-for-byte as it would have
 * been; the manual download path is untouched and still reports its own failures normally.
 */
import { fetchTargetArtifacts } from "./installArtifacts.js";
import { blobCache } from "./blobCache.js";
import type { Manifest, Target } from "./types.js";

/**
 * The owner's threshold: a source whose declared artifacts total less than this is fetched
 * ahead of time. 5 MB, named here and nowhere else — a size compared against the manifest's
 * summed `artifacts[].bytes`, never against anything measured by downloading.
 */
export const AUTO_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * How many sources download at once. Two, deliberately small: this is background work nobody
 * asked for, competing with whatever the user IS doing (resolving rows, a firmware fetch, a
 * device flash) for the same connection. `fetchTargetArtifacts` applies its own per-artifact
 * bound underneath, so the real ceiling is this times that.
 */
export const AUTO_DOWNLOAD_CONCURRENCY = 2;

/** The seams. Production passes nothing; tests pass fakes and never touch a network. */
export interface AutoDownloadDeps {
  fetchArtifacts: typeof fetchTargetArtifacts;
  /** Only `has()` is used: the question is "already held?", and it must not read content. */
  has: (sha256: string) => Promise<boolean>;
}

function defaultDeps(): AutoDownloadDeps {
  const cache = blobCache();
  return { fetchArtifacts: fetchTargetArtifacts, has: (h) => cache.has(h) };
}

/**
 * The target this device family installs — the same pick `store.svelte.ts`'s `toCard()` makes,
 * so the size judged here is the size of what would actually be installed.
 */
export function autoDownloadTarget(manifest: Manifest): Target | null {
  const targets = manifest.targets ?? [];
  return targets.find((t) => t.platform === "game-and-watch") ?? targets[0] ?? null;
}

/**
 * The declared total, or null when the manifest does not state one honestly (a missing,
 * negative or non-finite `bytes`). Null means "do not auto-download": an unknown size is not
 * a small size.
 */
export function declaredBytes(target: Target): number | null {
  const list = target.artifacts ?? [];
  if (list.length === 0) return null;
  let total = 0;
  for (const a of list) {
    if (!Number.isFinite(a.bytes) || a.bytes < 0) return null;
    total += a.bytes;
  }
  return total;
}

/** Whether this manifest is small enough to fetch unasked. Pure; no I/O. */
export function isAutoDownloadable(manifest: Manifest): boolean {
  const target = autoDownloadTarget(manifest);
  if (!target) return false;
  const bytes = declaredBytes(target);
  return bytes !== null && bytes < AUTO_DOWNLOAD_MAX_BYTES;
}

/**
 * The row-level gate, separate from the size gate so it can be stated (and tested) on its own.
 *
 * Three conditions, each load-bearing:
 *   - `active`: the scale decision. A curated row arrives inactive and there are ~22 of them;
 *     activating one is the only signal that the user wants this source's bytes.
 *   - `origin !== "bundle"`: a bundle's payloads are already local and its artifact URLs are
 *     this tab's blob URLs — there is nothing to pre-fetch and nowhere to fetch it from.
 *   - a resolved `manifest`: without one there is no declared size, and an unknown size never
 *     qualifies.
 */
export function shouldAutoDownload(row: {
  active: boolean;
  origin?: string;
  manifest?: Manifest;
}): boolean {
  return row.active === true && row.origin !== "bundle" && !!row.manifest;
}

/** Counters, for tests and for a future "what did the app do while I was away" view. */
export interface AutoDownloadStats {
  /** Requests that passed the size gate and entered the queue. */
  queued: number;
  /** Runs that found every artifact already cached and issued no request at all. */
  cached: number;
  /** Runs that actually fetched. */
  fetched: number;
  /** Runs that failed or were cancelled. Silent by design; counted only here. */
  failed: number;
  /** The highest number of sources that were downloading simultaneously. */
  peakConcurrency: number;
}

/**
 * A bounded, cancellable, fire-and-forget queue of per-source artifact downloads.
 *
 * Nothing here is awaited by the UI: `request()` returns immediately and the work runs on
 * microtasks behind the browser's own fetch scheduling, so the Sources rail stays responsive
 * whatever the network is doing. `idle()` exists for tests, not for the app.
 */
export class AutoDownloader {
  private deps: AutoDownloadDeps | null;
  private queue: { repo: string; target: Target }[] = [];
  private running = new Map<string, AbortController>();
  private waiters: (() => void)[] = [];

  stats: AutoDownloadStats = { queued: 0, cached: 0, fetched: 0, failed: 0, peakConcurrency: 0 };

  constructor(deps: AutoDownloadDeps | null = null) {
    this.deps = deps;
  }

  /**
   * Ask for one source's artifacts, if they are small enough. Returns whether it was queued,
   * so a caller can be tested; the app ignores the answer.
   *
   * Idempotent per repo: a second request while one is queued or running is dropped rather
   * than starting a duplicate fetch of the same bytes.
   */
  request(repo: string, manifest: Manifest): boolean {
    if (this.running.has(repo) || this.queue.some((q) => q.repo === repo)) return false;
    const target = autoDownloadTarget(manifest);
    if (!target) return false;
    const bytes = declaredBytes(target);
    if (bytes === null || bytes >= AUTO_DOWNLOAD_MAX_BYTES) return false;
    this.queue.push({ repo, target });
    this.stats.queued++;
    this.pump();
    return true;
  }

  /** Stop one source's download, queued or in flight. Absent is success. */
  cancel(repo: string): void {
    this.queue = this.queue.filter((q) => q.repo !== repo);
    this.running.get(repo)?.abort();
    this.settle();
  }

  /** Stop everything (a store reset, a page teardown). */
  cancelAll(): void {
    this.queue = [];
    for (const c of this.running.values()) c.abort();
    this.settle();
  }

  /** Sources downloading right now. */
  get inFlight(): number {
    return this.running.size;
  }

  /** Resolves when the queue has drained. For tests; the app never awaits this. */
  idle(): Promise<void> {
    if (this.queue.length === 0 && this.running.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private settle(): void {
    if (this.queue.length || this.running.size) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  private pump(): void {
    while (this.running.size < AUTO_DOWNLOAD_CONCURRENCY && this.queue.length) {
      const job = this.queue.shift();
      if (!job) return;
      const controller = new AbortController();
      this.running.set(job.repo, controller);
      if (this.running.size > this.stats.peakConcurrency) {
        this.stats.peakConcurrency = this.running.size;
      }
      void this.run(job.target, controller.signal).finally(() => {
        this.running.delete(job.repo);
        this.pump();
        this.settle();
      });
    }
  }

  private async run(target: Target, signal: AbortSignal): Promise<void> {
    const deps = (this.deps ??= defaultDeps());
    try {
      // ALREADY HELD? `blobCache.ts` is content-addressed on exactly the manifest's sha256, so
      // this needs nothing we did not already have, and a full hit means no request is issued
      // at all — not a request that happens to be served warm. There is no second cache here
      // and no parallel bookkeeping: the store on disk is the only record.
      const list = target.artifacts ?? [];
      let allHeld = true;
      for (const a of list) {
        if (signal.aborted) return;
        if (!(await deps.has(a.sha256.toLowerCase()))) {
          allHeld = false;
          break;
        }
      }
      if (allHeld) {
        this.stats.cached++;
        return;
      }
      if (signal.aborted) return;
      // `fetchTargetArtifacts` verifies every byte against the manifest hash and writes it to
      // the same cache under the same key. The bytes it returns are dropped on the floor here:
      // warming the cache IS the whole product of this call.
      await deps.fetchArtifacts(target, { signal });
      this.stats.fetched++;
    } catch {
      // Silent, always. See the header: nobody asked for this.
      this.stats.failed++;
    }
  }
}

/** The app-wide queue. Constructing it touches nothing. */
export const autoDownloader = new AutoDownloader();
