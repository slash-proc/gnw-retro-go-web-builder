/**
 * Offline-bundle import (gwrg-dist-spec spec/06-bundle.md).
 *
 * WHY THIS EXISTS: GitHub release assets are not CORS-readable, which is the whole reason
 * `dist/` on Pages is a mirror (spec/01-distribution.md, "The problem"). A bundle is the other
 * half of that answer — the archival form of a release, so a homebrew outlives the repository
 * that published it. When the mirror is gone, or the user simply has no network, the zip is the
 * only way in.
 *
 * WHAT A BUNDLE IS: `dist/<tag>/` zipped, with nothing added and nothing rewritten. Every `url`
 * in a manifest is a plain relative filename, so the SAME resolution works against zip entries
 * as against a URL — the spec's own framing: "a tool needs one new resolver, not a second
 * format". This file is that resolver and nothing more. It reuses `client.ts`'s parsers
 * verbatim; there is deliberately no second copy of the schema rules here.
 *
 * TRUST. A local file is NOT a trust boundary, and this is the single most important thing
 * about this module:
 *
 *   - Zip entry names are attacker-controlled. `..`, a leading `/` and a backslash are refused
 *     before anything is read, per spec/06's "Reading one" step 1. That check is independent of
 *     the manifest's own `isPlainFilename` guard, because the two names come from different
 *     places and either one alone can point outside the archive.
 *   - `schemaVersion` is gated exactly as a fetched document is: `parseVersions`/`parseManifest`
 *     refuse anything this client does not implement rather than guessing.
 *   - Every file the manifest NAMES is verified — length against `bytes`, digest against
 *     `sha256` — at import, before the source is kept (spec/06 step 5). Symbols and tool
 *     binaries included: verifying and installing are not the same step, and a crash report is
 *     worth as much from an archived release as from a live one.
 *   - Entries the manifest does not name are ignored. They are never extracted and never
 *     installed.
 *
 * PROVENANCE. A bundle proves its own integrity and nothing else: whoever edited a payload
 * could edit the manifest's `sha256` to match. So the hash checks here catch corruption and
 * tampering-in-transit, not a hostile publisher, and an imported source is LABELLED UNVERIFIED
 * in the UI (spec/06, "Provenance"). Comparing against the project's live manifest to upgrade
 * that label is a network operation and is deliberately not done here.
 *
 * HOW THE REST OF THE APP SEES IT: `importBundle` returns a plain `ResolvedSource` — the exact
 * shape a two-fetch network resolve produces. Each verified payload is published as a
 * `blob:` URL and substituted for the artifact's `url`, so `installArtifacts.ts` fetches and
 * re-verifies it through `fetchVerified` with no idea it never touched the network. That keeps
 * the install path single, and keeps "a mirror is not a trust boundary" true of bundles too:
 * the bytes are hashed again on the way out, not trusted because we hashed them once.
 */
import JSZip from "jszip";
import { parseManifest, parseVersions, sha256Hex } from "./client.js";
import { isPlainFilename } from "./converterRun.js";
import { manifestNeedsUserFiles } from "./needsUserFiles.js";
import { normaliseRepoRef } from "./client.js";
import {
  SourceError,
  type Artifact,
  type Manifest,
  type ResolvedSource,
  type Target,
  type VersionEntry,
  type VersionsFile,
} from "./types.js";

/**
 * The base every zip-internal path is resolved against. It is never fetched — `parseManifest`
 * needs an absolute base to run `new URL(url, base)`, and this gives it one that cannot
 * accidentally name a real host. `.invalid` is reserved by RFC 2606 precisely for this.
 */
const SYNTHETIC_BASE = "https://bundle.invalid/";

/** How a verified payload becomes something `fetch()` can read. Injected so tests can stub it. */
export type PublishFn = (bytes: Uint8Array, filename: string) => string;

const publishAsBlobUrl: PublishFn = (bytes) =>
  URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]));

export interface BundleImport {
  /** Indistinguishable in shape from what `resolveSource()` returns. */
  resolved: ResolvedSource;
  /**
   * Release every published payload URL. The store calls this when the row is removed or
   * replaced by a re-import; without it a bundle's bytes stay pinned in memory for the life of
   * the tab. Idempotent.
   */
  release(): void;
}

export interface ImportBundleOptions {
  /** Override how verified bytes are made fetchable. Tests pass a stub; the app does not. */
  publish?: PublishFn;
}

// --- Zip entry names --------------------------------------------------------------------

/**
 * spec/06-bundle.md, "Reading one", step 1: "Reject entry names containing `..`, a leading `/`,
 * or a backslash. Zip paths are attacker-controlled."
 *
 * Refusing the WHOLE ARCHIVE rather than skipping the offending entry is deliberate and matches
 * how `client.ts` treats a manifest it cannot fully accept: a zip carrying a traversal path is
 * not a bundle with one bad file in it, it is a bundle that was built to escape. Silently
 * dropping the entry would hand the user a partially-honoured archive and no reason to doubt it.
 */
function checkEntryName(name: string): void {
  if (name.length === 0) throw new SourceError("bundle-invalid", name);
  if (name.startsWith("/")) throw new SourceError("bundle-invalid", name);
  if (name.includes("\\")) throw new SourceError("bundle-invalid", name);
  if (name.includes("..")) throw new SourceError("bundle-invalid", name);
  // A drive letter or a UNC path is neither of the three the spec lists, but it is the same
  // class of thing and no legitimate zip written by the release job contains one.
  if (/^[A-Za-z]:/.test(name)) throw new SourceError("bundle-invalid", name);
  // Control characters, including the NUL a path-truncation trick relies on.
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new SourceError("bundle-invalid", name);
}

/**
 * Read the RAW entry names straight out of the zip's central directory.
 *
 * This exists because JSZip NORMALISES paths as it loads them: an entry stored as
 * `../../etc/passwd` comes back from `zip.forEach` as `etc/passwd`, and one stored as
 * `/etc/passwd` loses its leading slash. That is a sensible default for a general-purpose
 * library and completely wrong for us — spec/06's step 1 is a check on what the archive
 * CLAIMS, and a normaliser makes the claim unobservable. A zip built to escape would import
 * as a clean one, its traversal quietly rewritten into something plausible.
 *
 * So the names are read here, before JSZip sees them, from the same central directory
 * `lib/unzip.ts` reads. Only the names: the decompression itself stays with JSZip, which
 * handles the format's corners (data descriptors, zip64, the compression methods) properly.
 * Every surviving name is a plain safe path, which is precisely the set JSZip leaves alone,
 * so the two views agree on everything that gets past this point.
 */
function rawEntryNames(data: Uint8Array): string[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("bundle-invalid");

  const count = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (cd + 46 > data.length || dv.getUint32(cd, true) !== 0x02014b50) {
      throw new SourceError("bundle-invalid");
    }
    const nameLen = dv.getUint16(cd + 28, true);
    const extraLen = dv.getUint16(cd + 30, true);
    const commentLen = dv.getUint16(cd + 32, true);
    names.push(dec.decode(data.subarray(cd + 46, cd + 46 + nameLen)));
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Read the zip into `path -> bytes`, refusing the archive if any entry name is unsafe. */
async function readEntries(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  // The guard runs on the stored names, not on JSZip's normalised view of them. A directory
  // entry's trailing "/" is stripped first: it is a separator, not a path component, and
  // `checkEntryName` would otherwise have to know about directories.
  for (const name of rawEntryNames(data)) {
    checkEntryName(name.endsWith("/") ? name.slice(0, -1) : name);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data.slice().buffer as ArrayBuffer);
  } catch {
    // Not a zip, truncated, or a compression method JSZip will not do. All the same to a user.
    throw new SourceError("bundle-invalid");
  }
  const out = new Map<string, Uint8Array>();
  const files: [string, JSZip.JSZipObject][] = [];
  zip.forEach((path, entry) => {
    if (!entry.dir) files.push([path, entry]);
  });
  // Sequential, not Promise.all: the entry list is attacker-controlled and inflating an
  // arbitrary number of members at once is the one place a bundle could cost more memory than
  // its own size. There is no size ceiling here for the same reason `installArtifacts.ts`
  // has none — real homebrew is large and any fixed number is a future false refusal.
  for (const [path, entry] of files) {
    try {
      out.set(path, await entry.async("uint8array"));
    } catch {
      throw new SourceError("bundle-invalid", path);
    }
  }
  if (out.size === 0) throw new SourceError("bundle-invalid");
  return out;
}

// --- Path resolution inside the zip -------------------------------------------------------

/** One safe path segment: no separators, no `..`, no `.`, no control characters. */
function safeSegment(seg: string): boolean {
  if (seg === "" || seg === "." || seg === "..") return false;
  return !/[/\\\u0000-\u001f\u007f]/.test(seg);
}

/**
 * Resolve a relative path found INSIDE a bundle document (a `versions.json` entry's `manifest`,
 * which the spec allows to be `v0.1.3/manifest.json`) against the directory that named it.
 *
 * This is a second, independent guard on top of `checkEntryName`: that one proves the archive
 * contains no escaping entry, this one proves the DOCUMENT cannot point at one either. A
 * `manifest` of `../../etc/x` never reaches a lookup.
 */
function resolveInZip(dir: string, rel: string): string {
  const parts = rel.split("/");
  if (!parts.every(safeSegment)) throw new SourceError("bundle-invalid", rel);
  return dir + parts.join("/");
}

/** `"v1/manifest.json"` -> `"v1/"`; a root document -> `""`. */
function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/**
 * Recover the zip entry a resolved artifact URL refers to.
 *
 * `parseManifest` has already turned each `url` into `new URL(url, base)` — and, crucially, has
 * already refused any `url` that was not a plain filename. So the last path segment of the
 * result IS the original `url`, and looking it up beside the manifest is exactly spec/06 step 4:
 * "resolve each `url` to a zip entry in the same directory as its manifest".
 *
 * The `isPlainFilename` re-check is not redundant paranoia in one case: `tools[].binary.url` is
 * carried through `parseManifest` resolved but UNGUARDED (the manifest parser guards artifacts
 * and symbols, not tool binaries). Applying it here means every path this module turns into a
 * lookup has passed the same rule, whichever field it came from.
 */
function entryNameOf(resolvedUrl: string): string {
  let name: string;
  try {
    name = decodeURIComponent(new URL(resolvedUrl).pathname.split("/").pop() ?? "");
  } catch {
    throw new SourceError("malformed", resolvedUrl);
  }
  if (!isPlainFilename(name)) throw new SourceError("malformed", name);
  return name;
}

// --- Verification -------------------------------------------------------------------------

/** Everything published for one import, so a `release()` can revoke the lot. */
class Published {
  private urls: string[] = [];
  private revoked = false;

  constructor(private readonly publish: PublishFn) {}

  add(bytes: Uint8Array, filename: string): string {
    const url = this.publish(bytes, filename);
    this.urls.push(url);
    return url;
  }

  release(): void {
    if (this.revoked) return;
    this.revoked = true;
    for (const url of this.urls) {
      // Only revoke what we created. A stubbed publisher hands back something that is not a
      // blob URL, and `revokeObjectURL` on it is a documented no-op, but guard anyway so a
      // test environment without the API does not throw here.
      try {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      } catch {
        /* nothing to undo */
      }
    }
    this.urls = [];
  }
}

/**
 * Verify one manifest-named file against its declared length and digest, then publish it.
 *
 * The order matters: length first, because it is free and a mismatch there says something more
 * specific than "the hash was wrong". A file the manifest names and the zip lacks is an error
 * (spec/06 step 4), not something to skip — the bundle is supposed to be the whole directory.
 */
async function verifyAndPublish(
  a: Artifact,
  dir: string,
  entries: Map<string, Uint8Array>,
  pub: Published,
): Promise<Artifact> {
  const name = entryNameOf(a.url);
  const bytes = entries.get(dir + name);
  if (!bytes) throw new SourceError("bundle-missing-file", name);

  if (!Number.isFinite(a.bytes) || a.bytes < 0) throw new SourceError("malformed", a.filename);
  if (bytes.length !== a.bytes) {
    throw new SourceError("artifact-size-mismatch", `${a.filename}: ${bytes.length}`);
  }
  // Same refusal `fetchVerified` raises on a bad digest, so the UI needs no second string.
  if ((await sha256Hex(bytes)) !== a.sha256.toLowerCase()) {
    throw new SourceError("malformed", a.filename);
  }
  return { ...a, url: pub.add(bytes, a.filename) };
}

/**
 * Walk everything the manifest names, verify it, and swap each `url` for a fetchable one.
 *
 * "Everything it names" is the whole point of the archival format: artifacts, the debug
 * SYMBOLS (never installed, but a crash report needs the exact ELF), and each tool's `.wasm`.
 * Install-set selection happens later and elsewhere; this step is verification.
 */
async function relink(
  manifest: Manifest,
  dir: string,
  entries: Map<string, Uint8Array>,
  pub: Published,
): Promise<Manifest> {
  const targets = [];
  for (const t of manifest.targets) {
    const artifacts = [];
    for (const a of t.artifacts) artifacts.push(await verifyAndPublish(a, dir, entries, pub));
    let symbols: Artifact[] | undefined;
    if (t.symbols) {
      symbols = [];
      for (const s of t.symbols) symbols.push(await verifyAndPublish(s, dir, entries, pub));
    }
    targets.push({ ...t, artifacts, ...(symbols ? { symbols } : {}) });
  }

  const tools = [];
  for (const tool of manifest.tools) {
    const b = tool.binary;
    if (!b || typeof b.url !== "string" || typeof b.sha256 !== "string") {
      throw new SourceError("malformed");
    }
    const verified = await verifyAndPublish(
      { filename: typeof b.file === "string" ? b.file : "tool.wasm", bytes: b.bytes, sha256: b.sha256, url: b.url },
      dir,
      entries,
      pub,
    );
    tools.push({ ...tool, binary: { ...b, url: verified.url } });
  }

  return { ...manifest, targets, tools };
}

// --- The lone-manifest fallback -----------------------------------------------------------

/**
 * spec/06: "A tool reads `versions.json` when present and falls back to a lone `manifest.json`
 * at the root." A single-tag bundle IS just `dist/<tag>/` zipped, so it carries no
 * `versions.json` — that file lives at the mirror's `dist/` root, one level above the tag
 * directory, and is not part of what was zipped.
 *
 * So the entry has to be synthesised. The fields that exist in the manifest are read from it;
 * the ones that only ever existed in `versions.json` are given the honest empty/false value
 * rather than an invented one. Two are worth naming:
 *
 *   - `publishedAt` is left empty. There is no publication date inside a manifest, and the
 *     zip's own mtimes are the archivist's, not the project's.
 *   - `needsUserFiles` is derived, and it has TWO sources, not one. spec/02-versions.md:70
 *     defines it as "any tool declares a required input, OR any system declares a required
 *     BIOS". This used to read the tool half only, so fceumm, pce-go and SMSPlusGX — which
 *     need no converter at all and need `nes/disksys`, `pcecd/syscard3` and `col/coleco`
 *     respectively — imported from a bundle as `needsUserFiles: false` while the SAME project
 *     resolved over HTTP came back `true` from the publisher's own `versions.json`
 *     (`client.ts`'s `parseVersions`). One project, two answers, depending only on how it
 *     reached the app. It is a derivation, not a copy, and it is conservative in the direction
 *     that matters: a title wrongly marked as needing a file prompts for one, it does not
 *     silently install something incomplete.
 */
/*
 * The derivation now lives in `needsUserFiles.ts`, shared with `store.svelte.ts` so a project
 * cannot get two answers depending on how it reached the app -- the exact failure the comment
 * above describes. Three of its rules used to be wrong here, and each one mattered:
 *
 *   - A required TOOL only counts when that tool has a required INPUT. This file read
 *     `uses[].required` alone and never looked the tool up, so a target requiring a converter
 *     that asks for nothing was marked as needing user files.
 *   - A required BIOS the project SHIPS (`bios[].url`) does not count. Nothing asks the user
 *     for a file the bundle already contains.
 *   - `requiredFor` DOES count, reversing the note that used to stand here. The flag warns
 *     that files may be needed; it cannot know which games somebody intends to play, and the
 *     publisher's own checker counts it. Disagreeing meant importing a project as `false` that
 *     resolved over HTTP as `true` -- one project, two answers, again.
 */

function synthesiseEntry(manifest: Manifest): VersionEntry {
  const target =
    manifest.targets.find((t) => t.platform === "game-and-watch") ?? manifest.targets[0];
  const ref = manifest.source?.ref;
  return {
    // `ref` is untrusted display text like every other manifest string; it is rendered with
    // `{...}` interpolation and never used as a path, so a loose shape check is enough.
    tag: typeof ref === "string" && ref.length <= 64 ? ref : "",
    manifest: "manifest.json",
    publishedAt: "",
    prerelease: false,
    kind: target.kind,
    requiresAbi: target.requiresAbi,
    // Over the WHOLE manifest, not just the target picked above: the index carries one flag
    // per release, and the checker derives it from every target the manifest declares.
    needsUserFiles: manifestNeedsUserFiles(manifest),
  };
}

/** The same shape `parseVersions` would have produced, for a bundle that carries no index. */
function synthesiseIndex(manifest: Manifest, entry: VersionEntry, repo: string): VersionsFile {
  return {
    schemaVersion: 1,
    project: manifest.project,
    title: manifest.title,
    repo,
    // No `versions.json` means no `releasesUrl`. Empty, not guessed from `source.repo`: a
    // link we constructed is not a link the project published.
    releasesUrl: "",
    versions: [entry],
  };
}

// --- The import ---------------------------------------------------------------------------

/**
 * Import an offline bundle, producing exactly what a network resolve produces.
 *
 * Throws `SourceError`; the caller maps `code` to copy and never surfaces a raw exception.
 * On any failure nothing is left published — the partial work is released on the way out, so a
 * rejected zip cannot leak the bytes it did manage to verify.
 */
export async function importBundle(
  data: Uint8Array,
  opts?: ImportBundleOptions,
): Promise<BundleImport> {
  const pub = new Published(opts?.publish ?? publishAsBlobUrl);
  try {
    const entries = await readEntries(data);

    const decode = (bytes: Uint8Array, path: string): unknown => {
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        throw new SourceError("malformed", path);
      }
    };

    // spec/06 step 2: versions.json when present, else a lone manifest.json at the root.
    const indexBytes = entries.get("versions.json");
    let index: VersionsFile;
    let entry: VersionEntry;
    let manifestPath: string;

    if (indexBytes) {
      // `parseVersions` gates schemaVersion and refuses an entry it cannot read — the same
      // parser the fetched path uses, not a bundle-flavoured copy of it.
      index = parseVersions(decode(indexBytes, "versions.json"));
      entry = index.versions[0]; // Newest first; there is no `latest`, in a zip or on a mirror.
      manifestPath = resolveInZip("", entry.manifest);
    } else {
      const root = entries.get("manifest.json");
      if (!root) throw new SourceError("bundle-invalid");
      manifestPath = "manifest.json";
      index = null as unknown as VersionsFile; // filled in below, once the manifest is parsed
      entry = null as unknown as VersionEntry;
    }

    const manifestBytes = entries.get(manifestPath);
    if (!manifestBytes) throw new SourceError("bundle-missing-file", manifestPath);

    const dir = dirOf(manifestPath);
    const manifestUrl = SYNTHETIC_BASE + manifestPath;
    // `parseManifest` is what enforces `isPlainFilename` on every artifact `filename` and
    // `url`. A zip entry named `../../x` was already refused above; this is the other half —
    // a manifest that NAMES such a path, which is the attack that guard exists for.
    const parsed = parseManifest(decode(manifestBytes, manifestPath), manifestUrl);

    // The row key. Untrusted either way, so it goes through the same normaliser a pasted URL
    // does; a bundle that cannot name a well-formed `owner/repo` is refused rather than filed
    // under whatever string it supplied.
    const repoRaw = indexBytes ? index.repo : parsed.source?.repo;
    const repo = normaliseRepoRef(typeof repoRaw === "string" ? repoRaw : "");
    if (!repo) throw new SourceError("bad-url", typeof repoRaw === "string" ? repoRaw : undefined);

    if (!indexBytes) {
      entry = synthesiseEntry(parsed);
      index = synthesiseIndex(parsed, entry, repo);
    }

    const manifest = await relink(parsed, dir, entries, pub);

    return {
      resolved: {
        repo,
        versionsUrl: SYNTHETIC_BASE + (indexBytes ? "versions.json" : manifestPath),
        index,
        entry,
        manifestUrl,
        manifest,
      },
      release: () => pub.release(),
    };
  } catch (e) {
    pub.release();
    throw e instanceof SourceError ? e : new SourceError("bundle-invalid");
  }
}
