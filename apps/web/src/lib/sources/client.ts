/**
 * GWRG distribution-spec client (spec/01-distribution.md, spec/02-versions.md,
 * spec/03-manifest.md, spec/05-host.md — schemaVersion 1).
 *
 * Two fetches get a user to a working list:
 *   1. GET https://{owner}.github.io/{repo}/dist/versions.json
 *   2. GET that file's versions[0].manifest, resolved against the versions.json URL
 * and every `url` in the manifest is then resolved against the manifest's own URL.
 *
 * Deliberately small. The spec is a DRAFT and moves faster than its implementations, so this
 * file validates only the shape it actually reads and refuses anything it does not implement
 * rather than guessing (spec/05-host.md, "Reject unknown versions").
 *
 * NOTHING here writes to a device. This is read-and-describe only.
 */
import {
  SUPPORTED_SCHEMA_VERSION,
  SourceError,
  isCoreKind,
  type Manifest,
  type ResolvedSource,
  type SystemEntry,
  type GameEntry,
  type Target,
  type VersionEntry,
  type VersionsFile,
} from "./types.js";
import { isPlainFilename } from "./converterRun.js";
import { isSubpath } from "./subpath.js";

// --- Repo reference normalisation ------------------------------------------------------

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Normalise a pasted reference to `owner/repo`. Accepts the forms a user actually pastes:
 * `owner/repo`, `https://github.com/owner/repo(.git)(/tree/main…)`, and the Pages mirror
 * `https://owner.github.io/repo/…`. Returns null when it is none of them — we never guess a
 * repo out of an arbitrary string.
 */
export function normaliseRepoRef(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let owner: string | undefined;
  let repo: string | undefined;

  if (raw.includes("://") || raw.startsWith("git@")) {
    let url: URL;
    try {
      url = new URL(raw.startsWith("git@") ? raw.replace(/^git@([^:]+):/, "https://$1/") : raw);
    } catch {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const pagesHost = /^([A-Za-z0-9-]+)\.github\.io$/.exec(url.hostname);
    if (pagesHost) {
      // Mirror URL: the owner is in the host, the repo is the first path segment.
      owner = pagesHost[1];
      repo = parts[0];
    } else if (url.hostname === "github.com" || url.hostname === "www.github.com") {
      owner = parts[0];
      repo = parts[1];
    } else {
      return null;
    }
  } else {
    const parts = raw.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    [owner, repo] = parts;
  }

  if (!owner || !repo) return null;
  repo = repo.replace(/\.git$/, "");
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  return `${owner}/${repo}`;
}

/** The one path a tool hard-codes (spec/01-distribution.md, "Layout"). */
export function versionsUrlFor(repo: string): string {
  const [owner, name] = repo.split("/");
  return `https://${owner}.github.io/${name}/dist/versions.json`;
}

function pagesRootFor(repo: string): string {
  const [owner, name] = repo.split("/");
  return `https://${owner}.github.io/${name}/`;
}

// --- Hashing (spec/05-host.md: "Verify artifacts too") ---------------------------------

/** Lowercase hex sha256 of some bytes. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf =
    bytes instanceof Uint8Array
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : bytes;
  const digest = await crypto.subtle.digest("SHA-256", buf as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetch a manifest-named file and verify it against the published sha256 before returning it.
 * A mirror is not a trust boundary (spec/05-host.md): on a mismatch we refuse rather than
 * preferring either side. Nothing in this phase installs; this is the helper the install path
 * will use, and the only fetch-a-payload entry point that exists.
 */
export async function fetchVerified(url: string, sha256: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new SourceError("network", `${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = await sha256Hex(bytes);
  if (got !== sha256.toLowerCase()) throw new SourceError("malformed", url);
  return bytes;
}

// --- Fetch + validate -------------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch {
    // A DNS failure, an offline tab, or a CORS refusal all land here indistinguishably.
    throw new SourceError("network", url);
  }
  if (res.status === 404) throw new SourceError("no-versions", url);
  if (!res.ok) throw new SourceError("network", `${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceError("malformed", url);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Refuse a schemaVersion we do not implement instead of guessing at it. A single integer
 * covers versions.json, manifest.json and the processor ABI, because they change together.
 */
function checkSchemaVersion(doc: Record<string, unknown>): void {
  const v = doc.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new SourceError("malformed");
  if (v !== SUPPORTED_SCHEMA_VERSION) throw new SourceError("unsupported-schema", String(v));
}

function requireAbi(v: unknown): { version: number; minSize: number } {
  if (!isObj(v) || typeof v.version !== "number" || typeof v.minSize !== "number") {
    throw new SourceError("malformed");
  }
  return { version: v.version, minSize: v.minSize };
}

/**
 * Exported for the offline-bundle path (bundle.ts), which reads the SAME `versions.json` out of
 * a zip. A local file is not a trust boundary, so it gets this parser rather than a lenient
 * copy of it — one set of schema rules, one place to change them.
 */
export function parseVersions(doc: unknown): VersionsFile {
  if (!isObj(doc)) throw new SourceError("malformed");
  checkSchemaVersion(doc);
  const { project, title, repo, releasesUrl, versions, retained } = doc;
  if (
    typeof project !== "string" ||
    typeof title !== "string" ||
    typeof repo !== "string" ||
    typeof releasesUrl !== "string" ||
    !Array.isArray(versions)
  ) {
    throw new SourceError("malformed");
  }
  const entries: VersionEntry[] = versions.map((raw) => {
    if (!isObj(raw)) throw new SourceError("malformed");
    const { tag, manifest, publishedAt, prerelease, kind, needsUserFiles, bundle } = raw;
    if (
      typeof tag !== "string" ||
      typeof manifest !== "string" ||
      typeof publishedAt !== "string" ||
      typeof prerelease !== "boolean" ||
      typeof needsUserFiles !== "boolean" ||
      (kind !== "homebrew" && !isCoreKind(kind))
    ) {
      throw new SourceError("malformed");
    }
    return {
      tag,
      manifest,
      publishedAt,
      prerelease,
      kind,
      needsUserFiles,
      requiresAbi: requireAbi(raw.requiresAbi),
      ...(typeof bundle === "string" ? { bundle } : {}),
    };
  });
  if (entries.length === 0) throw new SourceError("malformed");
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    project,
    title,
    repo,
    releasesUrl,
    versions: entries,
    ...(typeof retained === "number" ? { retained } : {}),
  };
}

/**
 * Resolve every relative `url` in the manifest against the manifest's own URL, and REFUSE any
 * artifact whose `filename` is not a plain filename.
 *
 * The filename check is the security-relevant half. `filename` is a name on the card
 * (spec/03-manifest.md: "No path separators. Spaces allowed"), and downstream it becomes a
 * FrogFS tree key — `installArtifacts` keys its result map by it, `RomManagementTab` stores it
 * as `homebrew/<filename>`, and `flashImage`'s `userDest()` turns that into a path. A manifest
 * declaring `"../bios/x.bin"` would therefore aim a file outside `roms/homebrew/`, and the
 * sha256 proves only that the bytes match what the manifest claimed — not that the claim was
 * benign. So it is checked HERE, at the parse boundary, once, and nothing downstream has to
 * remember. `isPlainFilename` (converterRun.ts) is the same rule the converter ABI already
 * applies to module-produced output names: no separators, no `..`, no control characters, no
 * leading/trailing space, not `.` or `..`, non-empty, bounded length.
 *
 * We REFUSE rather than sanitise. A silently renamed file is worse than a refused manifest,
 * and refusing what it does not implement is what the rest of this parser already does.
 *
 * `url` gets the same check. The spec types it as a filename too ("a plain filename, resolved
 * beside this manifest" — `schema/manifest.schema.json` gives `url` the same `$defs/filename`
 * as `filename`), so a `url` of `../../other/thing` escaping the manifest's own directory is
 * equally outside the spec. It is a fetch URL and not a filesystem path, so the risk is lower,
 * but it is still a mirror pointing a verified download somewhere the publisher did not
 * declare, and there is no legitimate manifest that needs it.
 */
function resolveArtifacts(list: unknown, base: string) {
  if (!Array.isArray(list)) throw new SourceError("malformed");
  return list.map((raw) => {
    if (
      !isObj(raw) ||
      typeof raw.filename !== "string" ||
      typeof raw.bytes !== "number" ||
      typeof raw.sha256 !== "string" ||
      typeof raw.url !== "string"
    ) {
      throw new SourceError("malformed");
    }
    if (!isPlainFilename(raw.filename)) throw new SourceError("malformed", raw.filename);
    if (!isPlainFilename(raw.url)) throw new SourceError("malformed", raw.url);
    // `mapped` / `relocBase` (gwrg-dist-spec `2b34aef`). Both optional, and both are refused
    // rather than coerced when present and wrong: a `relocBase` that is not a whole
    // non-negative 32-bit number is not a base this repo can scan a window against, and
    // guessing one produces a blob full of addresses that cannot exist.
    if (raw.mapped !== undefined && typeof raw.mapped !== "boolean") {
      throw new SourceError("malformed", raw.filename);
    }
    if (raw.relocBase !== undefined) {
      if (
        typeof raw.relocBase !== "number" ||
        !Number.isInteger(raw.relocBase) ||
        raw.relocBase < 0 ||
        raw.relocBase > 0xffffffff
      ) {
        throw new SourceError("malformed", raw.filename);
      }
      // The spec ties it to `mapped`: "Only with `mapped`". A `relocBase` on a file nobody
      // will place addressably is a publishing mistake, and silently ignoring it would hide it.
      if (raw.mapped !== true) throw new SourceError("malformed", raw.filename);
    }
    return {
      filename: raw.filename,
      bytes: raw.bytes,
      sha256: raw.sha256,
      url: new URL(raw.url, base).toString(),
      ...(raw.mapped === true ? { mapped: true as const } : {}),
      ...(typeof raw.relocBase === "number" ? { relocBase: raw.relocBase } : {}),
    };
  });
}

/**
 * The schema's `originalSystem` pattern (schema/manifest.schema.json). Same identifiers as
 * `systems[].id` but a wider value space — a homebrew may come from a console no core
 * emulates — so it is checked against this pattern and NEVER against our known-systems list.
 *
 * The pattern is also why Task-1's path concern does not apply to this particular field: a
 * value matching it cannot contain a separator, a dot, a control character or a space, so even
 * where it is used to build a lookup directory it can only ever be one plain segment.
 */
const ORIGINAL_SYSTEM = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The games a project ships with itself (spec/07-cores.md, "A project may ship a game itself").
 *
 * DROPS a malformed entry rather than refusing the manifest, the same defensive shape `biosDir`
 * and `docs` use: one bad game entry should not cost the user the whole core. What it will not
 * do is keep an entry it could not install -- `url`, `bytes` and `sha256` are what make a
 * shipped game fetchable and checkable, and the spec requires all three precisely because an
 * entry without them describes a game the user already has.
 *
 * `filename` and `url` BECOME A PATH SEGMENT and a fetch target, so both go through
 * `isPlainFilename` (no separator, no `.`/`..`, no control characters, non-empty) exactly as
 * artifact filenames do. A game named `../doom.bin` must not be able to reach a core directory.
 */
function parseGames(raw: unknown, manifestUrl: string): GameEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: GameEntry[] = [];
  for (const g of raw) {
    if (
      !isObj(g) ||
      typeof g.id !== "string" ||
      typeof g.filename !== "string" ||
      typeof g.url !== "string" ||
      typeof g.sha256 !== "string" ||
      typeof g.bytes !== "number" ||
      !Number.isInteger(g.bytes) ||
      g.bytes < 1 ||
      !isPlainFilename(g.filename) ||
      !isPlainFilename(g.url) ||
      !isObj(g.label)
    ) {
      continue;
    }
    out.push({
      id: g.id,
      filename: g.filename,
      // Resolved against the manifest exactly as an artifact's is (`resolveArtifacts`): the
      // manifest publishes a filename, the fetcher needs an absolute URL.
      url: new URL(g.url, manifestUrl).toString(),
      bytes: g.bytes,
      sha256: g.sha256,
      label: g.label as Record<string, string>,
      ...(isObj(g.description) ? { description: g.description as Record<string, string> } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function parseSystems(list: unknown, manifestUrl: string): SystemEntry[] {
  // `"systems": {"type":"array","minItems":1}` and spec/07-cores.md:54 — required for a core.
  // An empty array is "no systems", which is the same useless outcome as the missing key.
  if (!Array.isArray(list) || list.length === 0) throw new SourceError("malformed");
  return list.map((raw) => {
    if (
      !isObj(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.longName !== "string" ||
      typeof raw.shortName !== "string" ||
      !Array.isArray(raw.extensions)
    ) {
      throw new SourceError("malformed");
    }
    const games = parseGames(raw.games, manifestUrl);
    return {
      id: raw.id,
      longName: raw.longName,
      shortName: raw.shortName,
      // An entry is an extension or a group of two or more (spec/07: [".cue", ".bin"]).
      extensions: raw.extensions as (string | string[])[],
      browse: raw.browse === "directory" ? "directory" : "file",
      compression: raw.compression === true,
      ...(typeof raw.cheatExt === "string" ? { cheatExt: raw.cheatExt } : {}),
      // Optional, and DROPPED rather than refused when it does not validate — the defensive
      // shape `docs` and `originalSystem` already use. It is a path segment under `/bios`, so
      // it goes through the same `isPlainFilename` rule the artifact filenames do (no
      // separator, no `.`/`..`, no control characters, non-empty). A dropped value simply
      // falls back to the system's `id`, which is always safe.
      ...(typeof raw.biosDir === "string" && isPlainFilename(raw.biosDir)
        ? { biosDir: raw.biosDir }
        : {}),
      ...(Array.isArray(raw.bios) ? { bios: raw.bios as SystemEntry["bios"] } : {}),
      ...(games ? { games } : {}),

    } satisfies SystemEntry;
  });
}

/** Exported for the validation script (test/validate.mjs); the app goes through resolveSource. */
export function parseManifest(doc: unknown, manifestUrl: string): Manifest {
  if (!isObj(doc)) throw new SourceError("malformed");
  checkSchemaVersion(doc);
  const { project, title, docs, originalSystem, originalName, storage, source, tools, targets } = doc;
  if (
    typeof project !== "string" ||
    typeof title !== "string" ||
    !isObj(source) ||
    !Array.isArray(tools) ||
    !Array.isArray(targets)
  ) {
    throw new SourceError("malformed");
  }
  const parsedTargets: Target[] = targets.map((raw) => {
    if (
      !isObj(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.platform !== "string" ||
      typeof raw.label !== "string" ||
      (raw.kind !== "homebrew" && !isCoreKind(raw.kind))
    ) {
      throw new SourceError("malformed");
    }
    return {
      id: raw.id,
      platform: raw.platform,
      label: raw.label,
      kind: raw.kind,
      requiresAbi: requireAbi(raw.requiresAbi),
      artifacts: resolveArtifacts(raw.artifacts, manifestUrl),
      ...(Array.isArray(raw.uses) ? { uses: raw.uses as Manifest["targets"][0]["uses"] } : {}),
      ...(raw.symbols !== undefined
        ? { symbols: resolveArtifacts(raw.symbols, manifestUrl) }
        : {}),
      // spec/03: "dataDir is homebrew-only. A core's converted output is a game and goes to
      // roms/<system id>/, which its own systems[] already determines." Declaring both would
      // give two answers for one file, so a core's dataDir is DROPPED rather than refused —
      // the publisher's own checker (site/check.js) is where that authoring mistake is caught,
      // and refusing here would make the whole source unusable over a field we can ignore.
      ...(raw.kind === "homebrew" && isSubpath(raw.dataDir) ? { dataDir: raw.dataDir } : {}),
      // `systems[]` is required for a core and forbidden for "homebrew" (spec/07-cores.md:54).
      // MUST ask `isCoreKind`, not compare: a `kind: "core"` manifest that took the homebrew
      // branch here would parse "successfully" with NO systems at all — no folder, no
      // extensions, no console button — which is far worse than a loud refusal.
      ...(isCoreKind(raw.kind) ? { systems: parseSystems(raw.systems, manifestUrl) } : {}),
    };
  });
  if (parsedTargets.length === 0) throw new SourceError("malformed");
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    project,
    title,
    ...(typeof docs === "string" && docs.startsWith("https://") ? { docs } : {}),
    // Optional, and dropped rather than refused when it does not match — the same defensive
    // shape `docs` uses. A manifest is not malformed for carrying a value we will not use.
    ...(typeof originalSystem === "string" && ORIGINAL_SYSTEM.test(originalSystem)
      ? { originalSystem }
      : {}),
    // The work's own TITLE, used AS GIVEN for the cover lookup, so it is FREE TEXT: a title
    // carries spaces, punctuation and case, and `ORIGINAL_SYSTEM`'s pattern would reject every
    // real one ("The Legend of Zelda - A Link to the Past"). Trimmed and length-capped rather
    // than pattern-checked, and never used to build a path -- it is a query parameter only.
    ...(typeof originalName === "string" && originalName.trim() && originalName.length <= 200
      ? { originalName: originalName.trim() }
      : {}),
    // Optional and dropped-rather-than-refused, exactly like `docs`/`originalSystem`. Only
    // the two enum members the schema allows survive; an empty result is dropped entirely so
    // a consumer can tell "not stated" from "stated as nothing".
    ...(Array.isArray(storage) &&
    storage.filter((v): v is "sd" | "flash" => v === "sd" || v === "flash").length > 0
      ? {
          storage: [...new Set(storage.filter((v): v is "sd" | "flash" => v === "sd" || v === "flash"))],
        }
      : {}),
    source: source as Manifest["source"],
    // Tools are carried through untouched: this phase never instantiates a processor, and
    // the host rules for doing so (verify imports, re-derive the ABI, run in a Worker) are
    // deliberately not implemented here.
    tools: tools.map((t) => {
      const tool = t as Manifest["tools"][0];
      return { ...tool, binary: { ...tool.binary, url: new URL(tool.binary.url, manifestUrl).toString() } };
    }),
    targets: parsedTargets,
  };
}

/**
 * The whole resolve: normalise, fetch versions.json, take versions[0], fetch its manifest.
 *
 * A repo with no Pages mirror and a repo whose Pages site simply lacks `dist/` both answer
 * 404, so on a 404 we probe the Pages site root once to tell them apart — a "no-pages" error
 * when the site itself is missing, "no-versions" when it is there but has not adopted the
 * spec. Purely for the error message; nothing else depends on the distinction.
 */
async function fetchIndex(repo: string): Promise<{ versionsUrl: string; index: VersionsFile }> {
  const versionsUrl = versionsUrlFor(repo);
  let indexDoc: unknown;
  try {
    indexDoc = await fetchJson(versionsUrl);
  } catch (e) {
    if (e instanceof SourceError && e.code === "no-versions") {
      let sitePresent = false;
      try {
        sitePresent = (await fetch(pagesRootFor(repo), { redirect: "follow" })).ok;
      } catch {
        sitePresent = false;
      }
      throw new SourceError(sitePresent ? "no-versions" : "no-pages", repo);
    }
    throw e;
  }
  return { versionsUrl, index: parseVersions(indexDoc) };
}

/** Fetch and validate the manifest one `versions[]` entry names. */
async function resolveEntry(
  repo: string,
  versionsUrl: string,
  index: VersionsFile,
  entry: VersionEntry,
): Promise<ResolvedSource> {
  const manifestUrl = new URL(entry.manifest, versionsUrl).toString();
  const manifest = parseManifest(await fetchJson(manifestUrl), manifestUrl);
  return { repo, versionsUrl, index, entry, manifestUrl, manifest };
}

export async function resolveSource(input: string): Promise<ResolvedSource> {
  const repo = normaliseRepoRef(input);
  if (!repo) throw new SourceError("bad-url");
  const { versionsUrl, index } = await fetchIndex(repo);
  // Newest first; there is no `latest` file.
  return resolveEntry(repo, versionsUrl, index, index.versions[0]);
}

/**
 * Resolve ONE named version instead of the newest — what the detail view's version picker
 * asks for.
 *
 * It re-fetches `versions.json` rather than taking the entry's `manifest` path from whatever
 * the picker was rendering. Two reasons, and both matter:
 *
 *   1. That path is untrusted third-party text that came out of localStorage, and it is fed to
 *      `new URL(path, versionsUrl)`. Addressing an entry the LIVE index still publishes means
 *      the URL we build is one the project itself vouches for right now, not one a stale (or
 *      tampered) persisted card claimed on some previous visit.
 *   2. Retention (`versions.json`'s `retained`) drops old releases. A tag the card still lists
 *      may simply be gone, and the honest answer to "install that one" is then a refusal, not
 *      a fetch of whatever happens to sit at the remembered path.
 *
 * Everything after the entry is picked is the SAME code the newest-version path runs —
 * `parseVersions` for the index, `resolveEntry`/`parseManifest` for the manifest — so the
 * schemaVersion gate, the `isPlainFilename` guard on every artifact `filename` and `url`, the
 * `originalSystem` pattern and the `SourceError` codes all hold identically. There is
 * deliberately no "we already trust this repo" shortcut: a source is trusted per document, and
 * an older manifest is a document we have never read.
 */
export async function resolveVersion(input: string, tag: string): Promise<ResolvedSource> {
  const repo = normaliseRepoRef(input);
  if (!repo) throw new SourceError("bad-url");
  const { versionsUrl, index } = await fetchIndex(repo);
  const entry = index.versions.find((v) => v.tag === tag);
  // The index parsed and simply does not publish this tag (retention, or a card written
  // before the project rewrote its history). `no-versions` with the tag as its detail; the
  // store treats it as "fall back to newest" rather than showing it to the user.
  if (!entry) throw new SourceError("no-versions", tag);
  return resolveEntry(repo, versionsUrl, index, entry);
}
