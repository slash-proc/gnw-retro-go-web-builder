/**
 * Parsers for the firmware distribution format (`docs/FIRMWARE_DIST.md`, schemaVersion 1).
 *
 * Pure functions over already-decoded JSON: no fetch, no device, no DOM. `client.ts` adds the
 * network; the tests drive these directly against the real published example files.
 *
 * The rules that matter here, in the doc's own words:
 *   - "Refuse a version you do not implement" — an unknown `schemaVersion` throws, it is not
 *     best-effort parsed.
 *   - "Everything else is reached by resolving a relative URL against the file that named it"
 *     — `manifest` resolves against the versions.json URL, every `url` against the manifest's.
 *   - `url` / `path` / `install` are three different things (see types.ts). We resolve only
 *     `url`, and we refuse a `url` that is not a plain filename beside the manifest, exactly
 *     as `sources/client.ts` does: the sha256 proves the bytes match the claim, never that the
 *     claim was benign.
 *   - `path`/`install` are zip entries and device paths. They are validated against the
 *     schema's `zipPath` shape (relative, no `..` segment, no backslash) and otherwise passed
 *     through untouched. Nothing in this module joins them onto a path.
 */
import {
  FIRMWARE_PROJECT_ID,
  FirmwareDistError,
  SUPPORTED_SCHEMA_VERSION,
  type BundleMember,
  type ContentEntry,
  type CuratedProject,
  type CuratedProjectsFile,
  type FirmwareBank,
  type FirmwareBuild,
  type FirmwareManifest,
  type FirmwareStorage,
  type FirmwareVersionEntry,
  type FirmwareVersionsFile,
  type ProvidesAbi,
  type RemoteAsset,
} from "./types.js";

// --- primitives -------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, where: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new FirmwareDistError("malformed", `${where}: expected a non-empty string`);
  }
  return v;
}

function int(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new FirmwareDistError("malformed", `${where}: expected an integer`);
  }
  return v;
}

function bool(v: unknown, where: string): boolean {
  if (typeof v !== "boolean") {
    throw new FirmwareDistError("malformed", `${where}: expected a boolean`);
  }
  return v;
}

function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new FirmwareDistError("malformed", `${where}: expected an array`);
  return v;
}

function obj(v: unknown, where: string): Record<string, unknown> {
  if (!isObj(v)) throw new FirmwareDistError("malformed", `${where}: expected an object`);
  return v;
}

const SHA256 = /^[0-9a-f]{64}$/;
/** schema `$defs/filename` — a plain name published beside the manifest. No separators. */
const FILENAME = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]*[A-Za-z0-9._-])?$/;
/** schema `$defs/zipPath` — a relative entry name; the `..` guard is spelled out below too. */
const ZIP_PATH = /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/;
/** schema `$defs/paths` value — absolute from the storage root. */
const STORAGE_PATH = /^\/[A-Za-z0-9._/-]*$/;
const LANGUAGE = /^[a-z]{2}_[a-z]{2}$/;
const ABI_OFFSET = /^0x[0-9a-fA-F]+$/;
const HTTPS_URL = /^https:\/\/[^\s]+$/;

function sha256(v: unknown, where: string): string {
  const s = str(v, where);
  if (!SHA256.test(s)) {
    throw new FirmwareDistError("malformed", `${where}: not a lowercase hex sha256`);
  }
  return s;
}

/**
 * A zip entry name / device install path. Refused rather than sanitised when it could escape:
 * absolute, a `..` segment, a backslash, or anything outside the schema's character set. A
 * silently rewritten path is worse than a refused manifest.
 */
function zipPath(v: unknown, where: string): string {
  const s = str(v, where);
  if (!ZIP_PATH.test(s) || s.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new FirmwareDistError("malformed", `${where}: not a safe relative path`);
  }
  return s;
}

/**
 * Resolve a manifest-declared `url` against the file that named it. The value must be a plain
 * filename first: a `url` of `../../elsewhere.zip` would aim a verified download somewhere the
 * publisher never declared, and no legitimate manifest needs it.
 */
function resolveUrl(v: unknown, base: string, where: string): string {
  const s = str(v, where);
  if (!FILENAME.test(s)) {
    throw new FirmwareDistError("malformed", `${where}: not a plain filename beside the manifest`);
  }
  return new URL(s, base).toString();
}

function checkSchemaVersion(doc: Record<string, unknown>, where: string): number {
  const v = doc.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new FirmwareDistError("malformed", `${where}: schemaVersion is not an integer`);
  }
  if (v !== SUPPORTED_SCHEMA_VERSION) {
    throw new FirmwareDistError("unsupported-schema", String(v));
  }
  return v;
}

function providesAbi(v: unknown, where: string): ProvidesAbi {
  const o = obj(v, where);
  return { version: int(o.version, `${where}.version`), size: int(o.size, `${where}.size`) };
}

// --- versions.json ------------------------------------------------------------------------

/**
 * Parse `versions.json` and resolve each entry's `manifest` against `versionsUrl`.
 *
 * Order is preserved exactly as published — the doc guarantees newest first (`versions[0]`),
 * and re-sorting on `publishedAt` would quietly disagree with the publisher on a re-tag. Use
 * `newestVersion()` rather than indexing by hand.
 */
export function parseVersions(doc: unknown, versionsUrl: string): FirmwareVersionsFile {
  const o = obj(doc, "versions.json");
  const schemaVersion = checkSchemaVersion(o, "versions.json");
  const project = str(o.project, "versions.json.project");
  if (project !== FIRMWARE_PROJECT_ID) {
    throw new FirmwareDistError("malformed", `versions.json.project: ${project}`);
  }
  const raw = arr(o.versions, "versions.json.versions");
  if (raw.length === 0) {
    throw new FirmwareDistError("malformed", "versions.json.versions: empty");
  }
  const versions: FirmwareVersionEntry[] = raw.map((entry, i) => {
    const w = `versions[${i}]`;
    const e = obj(entry, w);
    const manifest = str(e.manifest, `${w}.manifest`);
    // Relative by contract (schema pattern `^[^/][^:]*$`): not absolute, not a scheme.
    if (manifest.startsWith("/") || manifest.includes(":")) {
      throw new FirmwareDistError("malformed", `${w}.manifest: not a relative reference`);
    }
    return {
      tag: str(e.tag, `${w}.tag`),
      manifest,
      manifestUrl: new URL(manifest, versionsUrl).toString(),
      publishedAt: str(e.publishedAt, `${w}.publishedAt`),
      prerelease: bool(e.prerelease, `${w}.prerelease`),
      gitTag: str(e.gitTag, `${w}.gitTag`),
      providesAbi: providesAbi(e.providesAbi, `${w}.providesAbi`),
      coreMetaVersion: int(e.coreMetaVersion, `${w}.coreMetaVersion`),
    };
  });
  return {
    schemaVersion,
    project,
    title: str(o.title, "versions.json.title"),
    repo: str(o.repo, "versions.json.repo"),
    releasesUrl: str(o.releasesUrl, "versions.json.releasesUrl"),
    retained: int(o.retained, "versions.json.retained"),
    versions,
    url: versionsUrl,
  };
}

/** The newest release. `versions[0]`; there is no `latest` (doc, "Discovery"). */
export function newestVersion(file: FirmwareVersionsFile): FirmwareVersionEntry {
  return file.versions[0];
}

/** Look a release up by its tag. Returns undefined rather than falling back to the newest. */
export function findVersion(
  file: FirmwareVersionsFile,
  tag: string,
): FirmwareVersionEntry | undefined {
  return file.versions.find((v) => v.tag === tag);
}

// --- manifest.json ------------------------------------------------------------------------

function asset(v: unknown, base: string, where: string): RemoteAsset {
  const o = obj(v, where);
  return {
    bytes: int(o.bytes, `${where}.bytes`),
    sha256: sha256(o.sha256, `${where}.sha256`),
    url: resolveUrl(o.url, base, `${where}.url`),
  };
}

function member(v: unknown, where: string): BundleMember {
  const o = obj(v, where);
  return {
    bytes: int(o.bytes, `${where}.bytes`),
    sha256: sha256(o.sha256, `${where}.sha256`),
    path: zipPath(o.path, `${where}.path`),
  };
}

function contentOf(v: unknown, where: string): ContentEntry {
  const o = obj(v, where);
  const entry: ContentEntry = {
    path: zipPath(o.path, `${where}.path`),
    install: zipPath(o.install, `${where}.install`),
    bytes: int(o.bytes, `${where}.bytes`),
    sha256: sha256(o.sha256, `${where}.sha256`),
  };
  if (o.language !== undefined) {
    const lang = str(o.language, `${where}.language`);
    if (!LANGUAGE.test(lang)) {
      throw new FirmwareDistError("malformed", `${where}.language: ${lang}`);
    }
    entry.language = lang;
  }
  return entry;
}

function buildOf(v: unknown, base: string, i: number): FirmwareBuild {
  const w = `builds[${i}]`;
  const o = obj(v, w);
  const storage = str(o.storage, `${w}.storage`);
  if (storage !== "sd" && storage !== "flash") {
    throw new FirmwareDistError("malformed", `${w}.storage: ${storage}`);
  }
  const bank = int(o.bank, `${w}.bank`);
  if (bank !== 1 && bank !== 2) {
    throw new FirmwareDistError("malformed", `${w}.bank: ${bank}`);
  }
  const id = str(o.id, `${w}.id`);
  if (id !== `${storage}-bank${bank}`) {
    throw new FirmwareDistError("malformed", `${w}.id: ${id} disagrees with storage/bank`);
  }
  const entries = arr(o.content, `${w}.content`).map((c, j) =>
    contentOf(c, `${w}.content[${j}]`),
  );
  if (entries.length === 0) {
    throw new FirmwareDistError("malformed", `${w}.content: empty`);
  }
  // "no two files installing to the same path" (validate_release_json.py). A collision means
  // one of the two silently never lands; refuse rather than pick.
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.install)) {
      throw new FirmwareDistError("malformed", `${w}.content: duplicate install ${e.install}`);
    }
    seen.add(e.install);
  }
  const image = member(o.image, `${w}.image`);
  const result: FirmwareBuild = {
    id,
    storage: storage as FirmwareStorage,
    bank: bank as FirmwareBank,
    capabilities: arr(o.capabilities, `${w}.capabilities`).map((c, j) =>
      str(c, `${w}.capabilities[${j}]`),
    ),
    littlefsBlockSize: int(o.littlefsBlockSize, `${w}.littlefsBlockSize`),
    buildFlags: str(o.buildFlags, `${w}.buildFlags`),
    bundle: asset(o.bundle, base, `${w}.bundle`),
    ...(o.debug === undefined ? {} : { debug: asset(o.debug, base, `${w}.debug`) }),
    image,
    content: entries,
  };
  return result;
}

/**
 * Parse `manifest.json` and resolve every `url` in it against `manifestUrl`.
 *
 * `path` and `install` are deliberately NOT resolved — they are a zip entry and a device path,
 * not URLs. See types.ts.
 */
export function parseManifest(doc: unknown, manifestUrl: string): FirmwareManifest {
  const o = obj(doc, "manifest.json");
  const schemaVersion = checkSchemaVersion(o, "manifest.json");
  const project = str(o.project, "manifest.json.project");
  if (project !== FIRMWARE_PROJECT_ID) {
    throw new FirmwareDistError("malformed", `manifest.json.project: ${project}`);
  }

  const src = obj(o.source, "manifest.json.source");
  const fw = obj(o.firmware, "manifest.json.firmware");
  const sb = obj(fw.superblock, "firmware.superblock");
  const inst = obj(fw.installFile, "firmware.installFile");
  const abiOffset = str(fw.abiOffset, "firmware.abiOffset");
  if (!ABI_OFFSET.test(abiOffset)) {
    throw new FirmwareDistError("malformed", `firmware.abiOffset: ${abiOffset}`);
  }

  const rawPaths = obj(o.paths, "manifest.json.paths");
  const paths: Record<string, string> = {};
  for (const [role, value] of Object.entries(rawPaths)) {
    // Open on purpose — a later firmware may name a role this one does not, so an unknown key
    // is kept, not refused. The VALUE still has to be an absolute storage path: a `..` in one
    // would escape the storage root.
    const p = str(value, `paths.${role}`);
    if (!STORAGE_PATH.test(p) || p.split("/").includes("..")) {
      throw new FirmwareDistError("malformed", `paths.${role}: not an absolute storage path`);
    }
    paths[role] = p;
  }

  const languages = arr(o.languages, "manifest.json.languages").map((l, i) => {
    const s = str(l, `languages[${i}]`);
    if (!LANGUAGE.test(s)) throw new FirmwareDistError("malformed", `languages[${i}]: ${s}`);
    return s;
  });
  if (languages.length === 0) {
    throw new FirmwareDistError("malformed", "manifest.json.languages: empty");
  }

  const builds = arr(o.builds, "manifest.json.builds").map((b, i) =>
    buildOf(b, manifestUrl, i),
  );
  const updates = obj(o.updates, "manifest.json.updates");
  const bank1 = asset(updates.bank1, manifestUrl, "updates.bank1");
  const bank2 = asset(updates.bank2, manifestUrl, "updates.bank2");
  if (builds.length === 0) {
    throw new FirmwareDistError("malformed", "manifest.json.builds: empty");
  }
  const ids = new Set<string>();
  for (const b of builds) {
    if (ids.has(b.id)) throw new FirmwareDistError("malformed", `builds: duplicate id ${b.id}`);
    ids.add(b.id);
  }
  // Every language a build ships must be declared. (The converse is NOT an error: `en_us` is
  // baked into the firmware's rodata and has no blob in any build's content[].)
  const declared = new Set(languages);
  for (const b of builds) {
    for (const e of b.content) {
      if (e.language && !declared.has(e.language)) {
        throw new FirmwareDistError(
          "malformed",
          `${b.id} ships ${e.language} but languages[] omits it`,
        );
      }
    }
  }

  const manifest: FirmwareManifest = {
    schemaVersion,
    project,
    title: str(o.title, "manifest.json.title"),
    source: {
      repo: str(src.repo, "source.repo"),
      commit: str(src.commit, "source.commit"),
      ref: str(src.ref, "source.ref"),
    },
    firmware: {
      gitTag: str(fw.gitTag, "firmware.gitTag"),
      providesAbi: providesAbi(fw.providesAbi, "firmware.providesAbi"),
      abiOffset,
      abiOffsetBytes: Number.parseInt(abiOffset, 16),
      coreMetaVersion: int(fw.coreMetaVersion, "firmware.coreMetaVersion"),
      superblock: {
        magic: str(sb.magic, "firmware.superblock.magic"),
        version: int(sb.version, "firmware.superblock.version"),
        structSize: int(sb.structSize, "firmware.superblock.structSize"),
      },
      installFile: {
        path: zipPath(inst.path, "firmware.installFile.path"),
        magic: str(inst.magic, "firmware.installFile.magic"),
        version: int(inst.version, "firmware.installFile.version"),
      },
    },
    paths,
    languages,
    builds,
    updates: { bank1, bank2 },
    builtAt: str(o.builtAt, "manifest.json.builtAt"),
    url: manifestUrl,
  };
  // Optional, and for a human only — never fetched by an installer, so an unusable value is
  // dropped rather than refused.
  if (typeof o.docs === "string" && HTTPS_URL.test(o.docs)) manifest.docs = o.docs;
  if (o.projects !== undefined) {
    manifest.projects = asset(o.projects, manifestUrl, "manifest.json.projects");
  }
  return manifest;
}

/** `<storage>-bank<n>` — the build id for an axis pair (doc, "Choosing a build"). */
export function buildId(storage: FirmwareStorage, bank: FirmwareBank): string {
  return `${storage}-bank${bank}`;
}

/**
 * The build for a storage/bank pair, or undefined. Refuse rather than guess when the device's
 * detected storage matches no published build (doc, "Choosing a build") — hence undefined and
 * not a fallback.
 */
export function findBuild(
  manifest: FirmwareManifest,
  storage: FirmwareStorage,
  bank: FirmwareBank,
): FirmwareBuild | undefined {
  return manifest.builds.find((b) => b.storage === storage && b.bank === bank);
}

/** The languages this build actually ships a blob for — sorted, deduped. */
export function buildLanguages(build: FirmwareBuild): string[] {
  const set = new Set<string>();
  for (const e of build.content) if (e.language) set.add(e.language);
  return [...set].sort();
}

/**
 * Languages the manifest declares that no build ships a blob for. `en_us` is baked into the
 * firmware's rodata, so this is normally exactly `["en_us"]` — it is a real language the UI
 * must offer, not a manifest error.
 */
export function languagesWithoutBlob(manifest: FirmwareManifest): string[] {
  const shipped = new Set<string>();
  for (const b of manifest.builds) for (const l of buildLanguages(b)) shipped.add(l);
  return manifest.languages.filter((l) => !shipped.has(l));
}

/**
 * The `content[]` an installer writes for a chosen language subset: everything without a
 * `language` key (fonts, the boot logo) plus the `lang/` blobs for the wanted languages.
 * Only ever a build's OWN content — blobs differ per build and `rg_i18n.c` truncates a
 * mismatched one silently instead of rejecting it.
 */
export function contentForLanguages(
  build: FirmwareBuild,
  languages: Iterable<string>,
): ContentEntry[] {
  const want = new Set(languages);
  return build.content.filter((e) => !e.language || want.has(e.language));
}

// --- projects.json ------------------------------------------------------------------------

/**
 * Parse the curated list. `versionsUrl` is an absolute https URL into ANOTHER project's GWRG
 * site; it is validated for shape only and handed to the GWRG client, never to this one.
 */
export function parseProjects(doc: unknown): CuratedProjectsFile {
  const o = obj(doc, "projects.json");
  const schemaVersion = checkSchemaVersion(o, "projects.json");
  const projects: CuratedProject[] = arr(o.projects, "projects.json.projects").map((p, i) => {
    const w = `projects[${i}]`;
    const e = obj(p, w);
    const kind = str(e.kind, `${w}.kind`);
    if (kind !== "core" && kind !== "homebrew") {
      throw new FirmwareDistError("malformed", `${w}.kind: ${kind}`);
    }
    const versionsUrl = str(e.versionsUrl, `${w}.versionsUrl`);
    if (!/^https:\/\/[^\s]+\/versions\.json$/.test(versionsUrl)) {
      throw new FirmwareDistError("malformed", `${w}.versionsUrl: not an https versions.json`);
    }
    return {
      project: str(e.project, `${w}.project`),
      title: str(e.title, `${w}.title`),
      kind,
      versionsUrl,
    };
  });
  return { schemaVersion, projects };
}
