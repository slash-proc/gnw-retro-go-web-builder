/**
 * The curated core/homebrew list, read from the CURRENT NEWEST firmware release.
 *
 * `client.ts` already knows how to walk versions.json -> newest entry -> manifest ->
 * `projects.json`; this module is the one place the app does that walk *for the curated list*,
 * and it memoises the result for the session.
 *
 * WHY A MEMO AND NOT A STORAGE KEY: the list is per-release and stable, but everything it is
 * used for lands in the Sources store's OWN persisted rows (`gnw:sources.v1`) the moment an
 * entry resolves. Persisting the raw list as well would be a second copy of the same fact,
 * stale on the next release, and would buy exactly nothing on a later visit — the rows render
 * from their cards before any network call returns. So: one fetch per tab, nothing new on disk.
 *
 * The entries' `versionsUrl` values are handed to the GWRG client (`src/lib/sources/`); this
 * module never fetches one.
 */
import { fetchProjects, type FetchLike } from "./client.js";
import { manifestOnce, versionsOnce } from "./memo.js";
import { FIRMWARE_VERSIONS_URL, FirmwareDistError, type CuratedProject } from "./types.js";

let inflight: Promise<CuratedProject[] | null> | null = null;

/**
 * The newest release's curated list, or `null` when that release does not publish one.
 *
 * `null` is NOT an error and must not be rendered as one: `projects` is optional in the
 * manifest, and a release without it simply contributes no sources.
 *
 * A failure anywhere in the walk (offline, 404, malformed) propagates — the single caller
 * (`sources/store.svelte.ts`) treats it the same as `null`, because a curated list we could
 * not read and a release that publishes none look identical to a user.
 */
export async function loadCuratedProjects(options: {
  versionsUrl?: string;
  fetchImpl?: FetchLike;
} = {}): Promise<CuratedProject[] | null> {
  // Steps 1-3 of the discovery walk, through `memo.ts` so `artifacts.ts`'s own walk of the
  // same two documents shares this session's single fetch of each. (`fetchNewestRelease` did
  // this inline and unmemoised; nothing here needs its `tag` branch — the curated list is
  // always the newest release's.)
  const versions = await versionsOnce(options.versionsUrl ?? FIRMWARE_VERSIONS_URL, options.fetchImpl);
  const entry = versions.versions[0];
  if (!entry) throw new FirmwareDistError("not-found", "no published firmware release");
  const manifest = await manifestOnce(entry, options.fetchImpl);
  const file = await fetchProjects(manifest, options.fetchImpl);
  return file ? file.projects : null;
}

/** Session-memoised `loadCuratedProjects()`. A rejection is not cached, so a retry can work. */
export function curatedProjects(): Promise<CuratedProject[] | null> {
  if (!inflight) {
    inflight = loadCuratedProjects().catch((e: unknown) => {
      inflight = null;
      throw e;
    });
  }
  return inflight;
}

/** Test seam: drop the memo. */
export function resetCuratedProjects(): void {
  inflight = null;
}
