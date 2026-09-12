/**
 * The network half of the firmware-distribution client (`docs/FIRMWARE_DIST.md`).
 *
 * Discovery, in the doc's order:
 *   1. GET `dist/versions.json` — the ONLY URL a tool hard-codes.
 *   2. Pick a version. The newest is `versions[0]`; there is no `latest`.
 *   3. GET that entry's `manifest`, resolved against the versions.json URL.
 *   4. Resolve every `url` in the manifest against the manifest's URL.
 *
 * GitHub Pages is the mirror, because a release asset redirects to a host that sends no CORS
 * header. There is no CORS proxy in this design — that was the POC format's answer, not this
 * one's.
 *
 * `fetchImpl` is injected (defaulting to the global `fetch`) so tests and any future offline
 * path drive these without a network, matching how the rest of `apps/web` injects its I/O.
 */
import { parseManifest, parseProjects, parseVersions } from "./parse.js";
import {
  FIRMWARE_VERSIONS_URL,
  FirmwareDistError,
  type CuratedProjectsFile,
  type FirmwareManifest,
  type FirmwareVersionEntry,
  type FirmwareVersionsFile,
} from "./types.js";

/** The subset of `fetch` this client uses. */
export type FetchLike = (url: string) => Promise<Response>;

const defaultFetch: FetchLike = (url) => fetch(url, { redirect: "follow" });

/**
 * GET a URL and JSON-decode it. Every failure becomes a `FirmwareDistError` with a `kind` a
 * caller can branch on — a truncated body is `malformed`, not a raw `SyntaxError` escaping to
 * the UI.
 */
export async function fetchJson(url: string, fetchImpl: FetchLike = defaultFetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    // Offline, DNS failure and a CORS refusal all land here indistinguishably.
    throw new FirmwareDistError("network", url);
  }
  if (res.status === 404) throw new FirmwareDistError("not-found", url);
  if (!res.ok) throw new FirmwareDistError("network", `${res.status} ${url}`);
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new FirmwareDistError("network", url);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new FirmwareDistError("malformed", `${url}: not valid JSON (${why})`);
  }
}

/** Step 1. Defaults to the hard-coded Pages URL; override it for a fork or a local mirror. */
export async function fetchVersions(
  url: string = FIRMWARE_VERSIONS_URL,
  fetchImpl: FetchLike = defaultFetch,
): Promise<FirmwareVersionsFile> {
  return parseVersions(await fetchJson(url, fetchImpl), url);
}

/** Step 3. `entry.manifestUrl` was already resolved against the versions.json URL. */
export async function fetchManifest(
  entry: FirmwareVersionEntry,
  fetchImpl: FetchLike = defaultFetch,
): Promise<FirmwareManifest> {
  return parseManifest(await fetchJson(entry.manifestUrl, fetchImpl), entry.manifestUrl);
}

/**
 * The curated core/homebrew list, if this release publishes one. Returns null when the
 * manifest has no `projects` — it is optional, and its absence is not an error.
 *
 * The entries' `versionsUrl` values belong to the GWRG spec's client (`src/lib/sources/`),
 * not to this one.
 */
export async function fetchProjects(
  manifest: FirmwareManifest,
  fetchImpl: FetchLike = defaultFetch,
): Promise<CuratedProjectsFile | null> {
  if (!manifest.projects) return null;
  return parseProjects(await fetchJson(manifest.projects.url, fetchImpl));
}

/**
 * Steps 1-3 in one call: fetch the index, take the newest release (or the named `tag`), and
 * fetch its manifest. Refuses an unknown tag rather than silently falling back to the newest.
 */
export async function fetchNewestRelease(
  options: {
    versionsUrl?: string;
    tag?: string;
    fetchImpl?: FetchLike;
  } = {},
): Promise<{ versions: FirmwareVersionsFile; entry: FirmwareVersionEntry; manifest: FirmwareManifest }> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const versions = await fetchVersions(options.versionsUrl ?? FIRMWARE_VERSIONS_URL, fetchImpl);
  const entry = options.tag
    ? versions.versions.find((v) => v.tag === options.tag)
    : versions.versions[0];
  if (!entry) throw new FirmwareDistError("not-found", `no release tagged ${options.tag}`);
  const manifest = await fetchManifest(entry, fetchImpl);
  return { versions, entry, manifest };
}
