/**
 * Types for the Retro-Go SD **firmware distribution** format
 * (`docs/FIRMWARE_DIST.md` in game-and-watch-retro-go-sd, schemaVersion 1).
 *
 * This is a SIBLING of the GWRG distribution spec that `src/lib/sources/` speaks, not a
 * `kind` inside it: a firmware release is flashed to an internal-flash address and *defines*
 * the filesystem everything else lands in, so `artifacts[]`/`uses[]`/`requiresAbi` have
 * nothing to say about it. Cores and homebrew stay on the GWRG side; only `projects.json`
 * bridges the two, and it hands over a `versionsUrl` to be followed by the GWRG client.
 *
 * Everything parsed here is untrusted third-party text. Render it, never interpolate it into
 * a path — the parser enforces that at the boundary so nothing downstream has to remember.
 */

/** The only schemaVersion this client implements. Refuse anything else (doc, "Discovery"). */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** `versions.json`/`manifest.json` both carry `project: "retro-go-sd"`. */
export const FIRMWARE_PROJECT_ID = "retro-go-sd";

/** The one URL a tool hard-codes (doc, "Discovery"). */
export const FIRMWARE_VERSIONS_URL =
  "https://slash-proc.github.io/game-and-watch-retro-go-sd/dist/versions.json";

export type FirmwareDistErrorKind =
  | "network"
  | "not-found"
  | "malformed"
  | "unsupported-schema";

/**
 * One error type for the whole client, mirroring `sources/types.ts`'s `SourceError`: a caller
 * switches on `kind` for the message it shows and uses `detail` only as diagnostic text.
 * `detail` may echo untrusted manifest content, so it is never a path and never a URL a
 * caller should fetch.
 */
export class FirmwareDistError extends Error {
  readonly kind: FirmwareDistErrorKind;
  readonly detail: string;
  constructor(kind: FirmwareDistErrorKind, detail = "") {
    super(detail ? `${kind}: ${detail}` : kind);
    this.name = "FirmwareDistError";
    this.kind = kind;
    this.detail = detail;
  }
}

/** `{version, size}` — the firmware ABI a release offers. `size` moves between releases. */
export interface ProvidesAbi {
  version: number;
  size: number;
}

/** An entry in `versions.json`'s `versions[]`. Newest first; there is no `latest`. */
export interface FirmwareVersionEntry {
  tag: string;
  /** Verbatim relative reference as published. Use `manifestUrl` to fetch. */
  manifest: string;
  /** `manifest` resolved against the `versions.json` URL. */
  manifestUrl: string;
  publishedAt: string;
  prerelease: boolean;
  /**
   * Duplicated from the manifest so a picker can filter/warn BEFORE fetching a manifest.
   * The manifest wins on disagreement (doc, "`versions.json`").
   */
  gitTag: string;
  providesAbi: ProvidesAbi;
  coreMetaVersion: number;
}

export interface FirmwareVersionsFile {
  schemaVersion: number;
  project: string;
  title: string;
  repo: string;
  releasesUrl: string;
  retained: number;
  /** Newest first, as published. */
  versions: FirmwareVersionEntry[];
  /** The URL this file was read from; every `manifestUrl` was resolved against it. */
  url: string;
}

/**
 * A standalone file published BESIDE the manifest — `bundle`, `debug`, top-level `projects`.
 * `url` is already resolved against the manifest URL; fetch it.
 */
export interface RemoteAsset {
  bytes: number;
  sha256: string;
  url: string;
}

/**
 * A file stored INSIDE that build's `bundle` zip. `path` is a zip entry name, never a URL and
 * never a device path.
 */
export interface BundleMember {
  bytes: number;
  sha256: string;
  path: string;
}

/**
 * The intflash image under the name the on-device updater looks for. SD builds only; the
 * schema rejects it on flash builds. `filename` is the one load-bearing filename in the
 * format. `path` normally points at the SAME zip entry as `image.path` (same bytes, stored
 * once) — read `path`, do not assume either case.
 */

/**
 * Everything else that lands on the device. Three distinct fields, and mixing them up is the
 * easiest mistake to make (doc, "`path` vs `install` vs `url`"):
 *   - `path`    — the entry inside the bundle zip to read the bytes out of
 *   - `install` — where the bytes go on the device, relative to the storage root
 * They are currently always equal, and are still separate fields because they answer separate
 * questions. An installer MUST use `install` to decide where a file lands.
 */
export interface ContentEntry {
  path: string;
  install: string;
  bytes: number;
  sha256: string;
  /** Present on `lang/*.bin` only. Language blobs are per-build; never share them. */
  language?: string;
}

export type FirmwareStorage = "sd" | "flash";
export type FirmwareBank = 1 | 2;

export interface FirmwareBuild {
  /** `<storage>-bank<n>`. Stable, and how a tool names a build. */
  id: string;
  storage: FirmwareStorage;
  /** Intflash link address: 1 = 0x08000000, 2 = 0x08100000 (dual boot). Not a runtime patch. */
  bank: FirmwareBank;
  /** Compiled-in features. For UI only — nothing about installation depends on them. */
  capabilities: string[];
  /** Compile-time; a host building a filesystem image must match it. */
  littlefsBlockSize: number;
  /** The literal make command line. Provenance — do not parse it. */
  buildFlags: string;
  bundle: RemoteAsset;
  /** Optional debug artifact; release manifests may omit it. */
  debug?: RemoteAsset;
  image: BundleMember;
  content: ContentEntry[];
}

export interface SuperblockRef {
  magic: string;
  version: number;
  structSize: number;
}

export interface InstallFileRef {
  path: string;
  magic: string;
  version: number;
}

export interface FirmwareInfo {
  /** The version string baked into the image, verbatim. Provenance only — nothing gates on it. */
  gitTag: string;
  /** ADVISORY. Read the real values out of the image at `abiOffset` (doc, "Compatibility"). */
  providesAbi: ProvidesAbi;
  /** Hex string as published, e.g. `"0x400"`. */
  abiOffset: string;
  /** `abiOffset` parsed to a number, for the two LE uint32 read out of the image. */
  abiOffsetBytes: number;
  coreMetaVersion: number;
  /** Assert against the located superblock before patching it. */
  superblock: SuperblockRef;
  installFile: InstallFileRef;
}

export interface FirmwareSource {
  repo: string;
  commit: string;
  ref: string;
}

export interface FirmwareManifest {
  schemaVersion: number;
  project: string;
  title: string;
  /** Absolute https URL for a human. NEVER fetched by an installer. */
  docs?: string;
  source: FirmwareSource;
  firmware: FirmwareInfo;
  /**
   * Install directories keyed by role, absolute from the storage root. Open on purpose: a
   * later firmware may name a role this one does not, so ignore roles you do not use rather
   * than refusing the manifest.
   */
  paths: Record<string, string>;
  /** Every UI language the release offers, sorted. `en_us` is in rodata and has no blob. */
  languages: string[];
  builds: FirmwareBuild[];
  /** Bank-specific complete SD updater archives. Required by the current manifest contract. */
  updates: { bank1: RemoteAsset; bank2: RemoteAsset };
  builtAt: string;
  /** The curated core/homebrew list, published beside this manifest. */
  projects?: RemoteAsset;
  /** The URL this manifest was read from; every `url` was resolved against it. */
  url: string;
}

export type CuratedProjectKind = "core" | "homebrew";

/**
 * An entry in `projects.json`. `versionsUrl` is followed using the GWRG spec's rules, NOT
 * this format's — from there on it is a spec-conformant project.
 */
export interface CuratedProject {
  project: string;
  title: string;
  kind: CuratedProjectKind;
  versionsUrl: string;
}

export interface CuratedProjectsFile {
  schemaVersion: number;
  projects: CuratedProject[];
}
