/**
 * Firmware artifact source — the consumer side of the web-flasher pipeline.
 *
 * THE CUTOVER. This module used to speak the POC format: one `web-artifacts.zip` release asset
 * per GitHub release, discovered through the GitHub Releases API and downloaded through a CORS
 * proxy worker. That format is gone. Discovery is now `dist/versions.json` on GitHub Pages
 * (`FIRMWARE_VERSIONS_URL`), and a release publishes a `manifest.json` plus one bundle zip per
 * build — `flash-bank1`, `flash-bank2`, `sd-bank1`, `sd-bank2`. The contract is
 * `docs/FIRMWARE_DIST.md` in game-and-watch-retro-go-sd; the client for it is
 * `src/lib/firmwareDist/`, and everything below is a thin ADAPTER onto it.
 *
 * The adapter exists so the four consumers (`engine/flashInstall.ts`, `views/Wizard.svelte`,
 * `advanced/RomSection.svelte`, `views/RomManagementTab.svelte`) keep the surface they already
 * use: `listVersions()`, `fetchBundle(tag, onProgress?)`, and a bundle exposing
 * `blobs {1,2,sd_1,sd_2}` / `contentFor(bank, sdCard)` / `manifest`. What changed underneath:
 *
 *   - The four blobs come from FOUR separate bundle zips, not one. `fetchBundle` fetches every
 *     build the release publishes, because `blobs` is read synchronously by its callers.
 *   - Every zip has a PUBLISHED `bundle.sha256`, and every file inside it has its own. Bytes go
 *     through `firmwareDist/extract.ts`, which refuses a bundle before opening it if its hash is
 *     wrong, and refuses any member whose hash is wrong after unzipping.
 *   - Because a real hash exists BEFORE the download, the blob cache is keyed by it directly.
 *     The old `gnw.bundleHash.v1` `tag -> hash` pointer index is DELETED — it existed only
 *     because the POC zip published no hash, and its own header said not to copy the pattern
 *     anywhere a real hash is available. This is that place.
 *   - No CORS proxy. Pages sends `access-control-allow-origin: *`. The POC-era worker constant
 *     and its Cloudflare worker directory under `infra/` are both DELETED;
 *     `test/firmwarecutover.mjs` statically asserts neither name comes back anywhere in the repo.
 *
 * `contentFor()` still THROWS rather than falling back to another build's tree. Language blobs
 * are per-build and `rg_i18n.c` truncates a mismatched blob instead of rejecting it, so a
 * fallback would be silently wrong menu text on the device rather than a visible failure.
 *
 * Not in this module, on purpose (later steps): `paths`-driven install locations, superblock
 * patching against `firmware.superblock`, and the `/data/INSTALL` marker.
 */
import { blobCache, type BlobCache } from "./sources/blobCache.js";
import {
  extractBundle,
  findBuild,
  findVersion,
  FIRMWARE_VERSIONS_URL,
  type ExtractRefusal,
  type FetchLike,
  type FirmwareBuild,
  type FirmwareManifest as DistManifest,
  type FirmwareVersionEntry,
  type FirmwareVersionsFile,
} from "./firmwareDist/index.js";
import { manifestOnce, versionsOnce, forgetVersions } from "./firmwareDist/memo.js";

/** Repo that publishes the firmware distribution (the owner's fork for now). */
export const ARTIFACT_REPO = "slash-proc/game-and-watch-retro-go-sd";

// FOUR content trees, one per (SD_CARD, INTFLASH_BANK) pair — never one shared tree.
// Every core/homebrew .bin is objcopy'd out of whichever ELF was built, so it carries
// that build's absolute addresses on BOTH axes:
//   SD_CARD - overlay entry points land at different RAM addresses between SD_CARD=0
//     and SD_CARD=1 builds (confirmed on hardware: NES/PCE/MSX, likely more).
//   INTFLASH_BANK - cores call back into firmware through absolute pointers that are
//     bank-specific. Bank2-built cores hold 0x0810cdcd (odroid_system_init @ bank2);
//     pair them with a bank1 blob and the first callback jumps into bank 2 — silently
//     odd if a stale image sits there, instant hardfault at PC=0x0810cdcc once bank 2
//     is erased. Shipped in v1.4.1-43-gff74121c and diagnosed on hardware.
// In the distribution format that separation is structural: each build ships its own bundle
// with its own `content[]`, so there is nothing left to mix up — but contentFor() still
// refuses rather than substituting, because the language blobs have the same property.
type ContentKey = "bank1" | "bank2" | "sd_bank1" | "sd_bank2";

/** The four (storage, bank) pairs, in the order they appear on `FirmwareBundle.blobs`. */
const COMBOS: { key: ContentKey; storage: "flash" | "sd"; bank: 1 | 2 }[] = [
  { key: "bank1", storage: "flash", bank: 1 },
  { key: "bank2", storage: "flash", bank: 2 },
  { key: "sd_bank1", storage: "sd", bank: 1 },
  { key: "sd_bank2", storage: "sd", bank: 2 },
];

const contentKey = (bank: 1 | 2, sdCard: boolean): ContentKey =>
  (sdCard ? `sd_bank${bank}` : `bank${bank}`) as ContentKey;

/**
 * A release, in the shape the version pickers already render.
 *
 * Honest mapping onto a `versions.json` entry, field by field:
 *   - `tag`, `prerelease`, `publishedAt` are the entry's own.
 *   - `gitTag` is the entry's own `gitTag` — the version string baked into the image, verbatim.
 *     It is the ONLY field that byte-compares against what the device reports
 *     (`device.banks[].retroGoVersion`), which is why it is surfaced under its real name and not
 *     left to be dug back out of `name`. Compare it with `firmwareDist/compare.ts`, never by
 *     parsing it. `docs/FIRMWARE_DIST.md` is explicit that it must not become a compatibility
 *     check — that is `providesAbi`'s job.
 *   - `name` is that same `gitTag`. The format publishes no separate release title, and this is
 *     the closest true equivalent.
 *   - `sha` is the `-g<hex>` describe suffix of that same `gitTag` when it has one, and ""
 *     otherwise. The index publishes no commit sha of its own (the manifest does, but reading
 *     it would cost one fetch per release just to fill a field no consumer reads).
 */
export interface FirmwareVersion {
  tag: string;
  /** The image's baked version string, verbatim from the index. The comparison field. */
  gitTag: string;
  name: string;
  sha: string;
  prerelease: boolean;
  publishedAt: string;
}

/**
 * The legacy manifest summary the UI consumes. Derived from the real
 * `firmwareDist` manifest, which is carried through untouched on `dist` for the later steps
 * (`paths`, `firmware.superblock`, `installFile`) that need the real thing.
 *
 * `cores` is `[]` and that is not a bug: the POC bundle shipped cores inside itself,
 * and the distribution format does not — cores and homebrew are GWRG projects now, listed in
 * `projects.json` and fetched by `src/lib/sources/`. There is no honest count of "cores in this
 * bundle" to report, because there are none.
 */
export interface FirmwareManifest {
  /** The release tag. */
  id: string;
  /** `source.ref` — the git ref the release was built from. */
  ref: string;
  /** `source.commit` — the full commit sha. */
  sha: string;
  /** Per-build blob summary, keyed exactly like `FirmwareBundle.blobs`. */
  blobs: Record<
    string,
    { file: string; intflashAddr: string; bytes: number; content?: string; cores?: string[] }
  >;
  /** Union of every published build's compiled-in capabilities. UI only. */
  capabilities: string[];
  /** Always empty — see the note above. */
  cores: string[];
  /** Whether the images carry the patchable layout superblock. */
  superblock: boolean;
  builtAt: string;
  /** The real manifest, verbatim. */
  dist: DistManifest;
  [k: string]: unknown;
}

export interface FirmwareBundle {
  /** intflash blobs by bank — both carry the GWLB layout superblock.
   * 1 = overwrite stock (0x08000000); 2 = keep stock for dual-boot (0x08100000). */
  blobs: { 1: Uint8Array; 2: Uint8Array; sd_1?: Uint8Array; sd_2?: Uint8Array };
  /** Content trees keyed exactly like `blobs`, each valid ONLY for its own blob. Keys are the
   *  entries' `install` paths (e.g. "fonts/cp1252_serif.bin"). Prefer contentFor(). */
  content: Partial<Record<ContentKey, Map<string, Uint8Array>>>;
  /** The content built alongside the blob for `bank` in the given mode. Throws rather
   *  than falling back to another build's tree — a wrong pairing is not a degraded
   *  install, it's a hardfault on the first core callback (and silently truncated menu
   *  text from a mismatched language blob). */
  contentFor(bank: 1 | 2, sdCard: boolean): Map<string, Uint8Array>;
  manifest: FirmwareManifest;
}

/** Injected seams, for tests only. Production passes nothing. */
export interface BundleFetchDeps {
  /** Fetch one bundle zip. Defaults to the global `fetch`. */
  fetchZip?: (url: string) => Promise<Response>;
  /** Fetch `versions.json` / `manifest.json`. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  cache?: BlobCache;
  /** Override the hard-coded Pages entry point (a fork, or a local mirror). */
  versionsUrl?: string;
}

const describeSha = (gitTag: string): string => gitTag.match(/-g([0-9a-f]+)/)?.[1] ?? "";

/** One `versions.json` entry in the picker's shape. */
function toVersion(entry: FirmwareVersionEntry): FirmwareVersion {
  return {
    tag: entry.tag,
    gitTag: entry.gitTag,
    name: entry.gitTag,
    sha: describeSha(entry.gitTag),
    prerelease: entry.prerelease,
    publishedAt: entry.publishedAt,
  };
}

/**
 * List installable firmware versions, newest first.
 *
 * The order is the index's own — `versions.json` publishes newest-first and there is no
 * `latest` pointer, so `versions[0]` (which every caller uses) is the newest release. Nothing
 * is re-sorted here; inventing an order over a published one is how the POC path ended up
 * sorting by release id.
 */
/**
 * Re-read `versions.json` from the network, ignoring what this session already learned.
 *
 * `listVersions` is memoised per session (see `firmwareDist/memo.ts`), so a release published
 * while the app is open cannot appear. This is the only caller that wants to pay for a refetch.
 */
export async function refreshVersions(deps?: BundleFetchDeps): Promise<FirmwareVersion[]> {
  forgetVersions(deps?.versionsUrl ?? FIRMWARE_VERSIONS_URL);
  return listVersions(deps);
}

export async function listVersions(deps?: BundleFetchDeps): Promise<FirmwareVersion[]> {
  const file = await loadVersions(deps);
  return file.versions.map(toVersion);
}

/**
 * versions.json, through `firmwareDist/memo.ts` — one fetch per session, shared with
 * `curated.ts`'s walk of the same document. An injected `fetchImpl` (tests, a mirror) bypasses
 * the memo entirely, and a failure is not cached, so nothing about the error path moves.
 */
function loadVersions(deps?: BundleFetchDeps): Promise<FirmwareVersionsFile> {
  return versionsOnce(deps?.versionsUrl ?? FIRMWARE_VERSIONS_URL, deps?.fetchImpl);
}

/** Byte counter for a bundle download. `total` is 0 when the server sent no Content-Length. */
export type BundleProgressFn = (done: number, total: number) => void;

/**
 * Read a fetch Response body into one Uint8Array, reporting bytes as they arrive.
 *
 * Exported for `test/downloadprogress.mjs`. MUST return exactly the bytes
 * `res.arrayBuffer()` would have: the streamed path is only taken when the body is
 * readable AND a positive Content-Length was sent; anything else (no `body`, no
 * getReader, absent/zero/unparseable Content-Length) falls back to `arrayBuffer()`
 * rather than reporting a percent against an unknown denominator.
 *
 * Content-Length is a *hint*, not a contract — with `Content-Encoding` in play the body
 * can be longer than advertised, so the reported `done` is clamped to `total` and the
 * final call is pinned to `total`. That keeps the counter monotonic and bounded; the
 * returned bytes are never clamped.
 */
export async function readBodyWithProgress(
  res: Response,
  onProgress: BundleProgressFn | undefined,
): Promise<Uint8Array> {
  const lenHeader = res.headers?.get?.("Content-Length");
  const total = lenHeader === null || lenHeader === undefined ? 0 : Number(lenHeader);
  const body = res.body;
  if (!onProgress || !body || typeof body.getReader !== "function" || !Number.isFinite(total) || total <= 0) {
    return new Uint8Array(await res.arrayBuffer());
  }
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let done = 0;
  onProgress(0, total);
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    const chunk = r.value as Uint8Array;
    parts.push(chunk);
    done += chunk.length;
    onProgress(Math.min(done, total), total);
  }
  const out = new Uint8Array(done);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  onProgress(total, total);
  return out;
}

/**
 * The raw bytes of one build's bundle zip, from the cache when possible.
 *
 * Keyed by the PUBLISHED `bundle.sha256`, so the lookup happens before any network call —
 * `BlobCache.get` re-hashes what it holds against that key, so a hit is bytes that provably
 * match what the manifest declares. A miss, an eviction or bit rot all fall through to the
 * download; a `put` the browser refuses (full disk, private mode) costs a future download and
 * nothing else.
 */
async function bundleBytes(
  build: FirmwareBuild,
  cache: BlobCache,
  doFetch: (url: string) => Promise<Response>,
  onProgress: BundleProgressFn | undefined,
): Promise<Uint8Array> {
  const cached = await cache.get(build.bundle.sha256).catch(() => null);
  if (cached) return cached;
  const res = await doFetch(build.bundle.url);
  if (!res.ok) throw new Error(`artifact fetch ${res.status} for ${build.id}`);
  const buf = await readBodyWithProgress(res, onProgress);
  try {
    await cache.put(build.bundle.sha256, buf, "firmware");
  } catch {
    /* an uncacheable bundle is still a perfectly good bundle */
  }
  return buf;
}

/** A refusal from `extract.ts` as a thrown Error, naming what failed and where. */
function refusalError(refusal: ExtractRefusal): Error {
  const member = "member" in refusal ? refusal.member : undefined;
  const where = member ? ` (${member.role} "${member.path}")` : "";
  return new Error(`firmware bundle "${refusal.buildId}" refused: ${refusal.reason}${where}`);
}

/**
 * Fetch a release's four build bundles and present them as one `FirmwareBundle`.
 *
 * Every bundle the release publishes is fetched, because `blobs` is read synchronously by its
 * callers (`bundle.blobs[1].length` in `Wizard.svelte`, `bundle.blobs.sd_2` in
 * `RomManagementTab.svelte`). `flash-bank1` and `flash-bank2` are required — a release without
 * them cannot satisfy the non-optional `blobs[1]`/`blobs[2]`; the SD pair is optional exactly as
 * `sd_1`/`sd_2` always were.
 *
 * `onProgress` counts bytes across ALL the bundles against the total the manifest publishes, so
 * the denominator is known before the first byte arrives rather than being a per-response
 * Content-Length guess.
 */
export async function fetchBundle(
  tag: string,
  onProgress?: BundleProgressFn,
  deps?: BundleFetchDeps,
): Promise<FirmwareBundle> {
  const cache = deps?.cache ?? blobCache();
  const doFetch = deps?.fetchZip ?? ((u: string) => fetch(u));

  const versions = await loadVersions(deps);
  const entry = findVersion(versions, tag);
  if (!entry) throw new Error(`no published firmware release tagged "${tag}"`);
  // Memoised on the default path (same document `curated.ts` already walked for this release).
  const manifest = await manifestOnce(entry, deps?.fetchImpl);

  const builds = new Map<ContentKey, FirmwareBuild>();
  for (const c of COMBOS) {
    const b = findBuild(manifest, c.storage, c.bank);
    if (b) builds.set(c.key, b);
  }
  if (!builds.has("bank1") || !builds.has("bank2")) {
    throw new Error(`"${tag}" does not publish both internal-flash bank builds — pick another build.`);
  }

  const total = [...builds.values()].reduce((s, b) => s + b.bundle.bytes, 0);
  let base = 0;
  // The denominator is known before the first byte moves, so the counter starts at a real 0%
  // rather than at nothing.
  onProgress?.(0, total);

  const blobs: FirmwareBundle["blobs"] = { 1: new Uint8Array(), 2: new Uint8Array() };
  const content: Partial<Record<ContentKey, Map<string, Uint8Array>>> = {};
  const blobSummary: FirmwareManifest["blobs"] = {};
  const capabilities = new Set<string>();

  for (const [key, build] of builds) {
    const buf = await bundleBytes(build, cache, doFetch, onProgress && ((d) => onProgress(base + d, total)));
    base += build.bundle.bytes;
    // Pin this bundle's share, whether it streamed, arrived in one piece with no
    // Content-Length, or came from the cache without touching the network at all.
    onProgress?.(base, total);
    const got = await extractBundle(build, buf);
    if (!got.ok) throw refusalError(got);

    if (key === "bank1") blobs[1] = got.image.bytes;
    else if (key === "bank2") blobs[2] = got.image.bytes;
    else if (key === "sd_bank1") blobs.sd_1 = got.image.bytes;
    else blobs.sd_2 = got.image.bytes;

    const tree = new Map<string, Uint8Array>();
    // `install` (where it lands on the device), never `path` (where it sat in the zip) — the
    // consumers treat these keys as device-relative paths.
    for (const f of got.content) tree.set(f.install ?? f.path, f.bytes);
    content[key] = tree;

    for (const c of build.capabilities) capabilities.add(c);
    blobSummary[key] = {
      file: build.image.path,
      intflashAddr: build.bank === 1 ? "0x08000000" : "0x08100000",
      bytes: build.image.bytes,
    };
  }

  const contentFor = (bank: 1 | 2, sdCard: boolean): Map<string, Uint8Array> => {
    const key = contentKey(bank, sdCard);
    const tree = content[key];
    if (tree?.size) return tree;
    throw new Error(
      `"${tag}" publishes no ${sdCard ? "SD-card" : "internal-flash"} build for bank ${bank}. ` +
        `Content is per-build (cores carry bank-specific firmware pointers, and a language blob ` +
        `from the wrong build is truncated rather than rejected on the device) — pick another build.`,
    );
  };

  return {
    blobs,
    content,
    contentFor,
    manifest: {
      id: entry.tag,
      ref: manifest.source.ref,
      sha: manifest.source.commit,
      blobs: blobSummary,
      capabilities: [...capabilities].sort(),
      cores: [],
      superblock: true,
      builtAt: manifest.builtAt,
      dist: manifest,
    },
  };
}
