/**
 * ONE fetch per discovery document per session.
 *
 * Two independent walks of `docs/FIRMWARE_DIST.md`'s discovery chain exist in this app:
 * `curated.ts` (versions.json -> newest entry -> manifest -> projects.json, for the curated
 * source list) and `artifacts.ts` (`listVersions()` for the pickers, then `fetchBundle()`'s
 * own manifest read at install time). Before this module they each fetched versions.json and
 * manifest.json on their own, so a session that opened the Sources tab and then flashed
 * fetched the same two documents twice or more.
 *
 * WHAT IS MEMOISED, AND WHAT DELIBERATELY IS NOT
 *
 *  - Only the DEFAULT-network path. A caller that injects `fetchImpl` is a test or a mirror
 *    driving a scenario of its own; sharing one memo across two different injected fetches
 *    would make one check's fixture serve another's. Injected fetches therefore go straight
 *    through, and every existing suite's behaviour is bit-for-bit what it was.
 *  - Rejections are NOT cached. The entry is dropped before the rejection propagates, so a
 *    retry after an offline blip really retries. The error object itself is untouched:
 *    failures surface exactly as they did (same `FirmwareDistError`, same `kind`).
 *  - Nothing is persisted. This is session state, not storage — a reload re-fetches, which is
 *    also the only "refresh" the app has (no caller asks for a forced re-read of the version
 *    list; every `listVersions()` call site passes no argument).
 *
 * The resolved objects are SHARED between callers, so treat them as read-only — they are
 * `parse.ts` output and nothing in the app mutates them.
 */
import { fetchManifest, fetchVersions, type FetchLike } from "./client.js";
import type { FirmwareManifest, FirmwareVersionEntry, FirmwareVersionsFile } from "./types.js";

const versionsMemo = new Map<string, Promise<FirmwareVersionsFile>>();
const manifestMemo = new Map<string, Promise<FirmwareManifest>>();

/** Memoise `p` under `key` in `memo`, dropping the entry if it rejects. */
function remember<T>(memo: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit) return hit;
  const p = run().catch((e: unknown) => {
    memo.delete(key);
    throw e;
  });
  memo.set(key, p);
  return p;
}

/** `fetchVersions`, once per URL per session on the default network path. */
export function versionsOnce(url: string, fetchImpl?: FetchLike): Promise<FirmwareVersionsFile> {
  if (fetchImpl) return fetchVersions(url, fetchImpl);
  return remember(versionsMemo, url, () => fetchVersions(url));
}

/** `fetchManifest`, once per manifest URL per session on the default network path. */
export function manifestOnce(
  entry: FirmwareVersionEntry,
  fetchImpl?: FetchLike,
): Promise<FirmwareManifest> {
  if (fetchImpl) return fetchManifest(entry, fetchImpl);
  return remember(manifestMemo, entry.manifestUrl, () => fetchManifest(entry));
}

/**
 * Forget the remembered `versions.json` so the next call refetches.
 *
 * The memo is per session, which is right for a document that changes rarely: without it every
 * consumer would refetch the same index. But a release published WHILE the app is open is then
 * invisible until a reload, and there is no way to tell from the UI whether the list is current.
 * The version picker's refresh control drops this entry and asks again.
 *
 * Manifests are left alone deliberately. They are keyed by URL and a new release brings a new
 * URL, so nothing stale is reachable through them; dropping them would only re-download
 * manifests the session already has.
 */
export function forgetVersions(url?: string): void {
  if (url === undefined) versionsMemo.clear();
  else versionsMemo.delete(url);
}

/** Test seam: drop everything remembered. */
export function resetFirmwareMemo(): void {
  versionsMemo.clear();
  manifestMemo.clear();
}
