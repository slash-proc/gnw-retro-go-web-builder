// Types for the GWRG distribution spec (gwrg-dist-spec, schemaVersion 1).
//
// These mirror `schema/versions.schema.json` and `schema/manifest.schema.json`. Only the
// fields this app actually reads are modelled; the spec is a DRAFT and still moving, so
// unknown keys are simply ignored rather than typed (we never round-trip a manifest back
// out, so we do not need to preserve them).
//
// EVERY string in here arrives from a third-party repo over the network. Treat it as
// untrusted text: render it with textContent semantics (Svelte's `{...}` interpolation does
// exactly that), never as markup, and never as a path.

// WHAT A CORE IS, since this file declares the type that decides it:
//
// A core is a program that teaches the device to run a CATEGORY of content. It declares one
// or more `systems[]` — a `roms/<folder>/` directory, the extensions that count, the names to
// show, how the launcher browses them — and installing it gives the device a console it did
// not have. Homebrew is a program that IS the content: no systems, no folder, no console, one
// entry in the launcher.
//
// They are separate first-class kinds, not degrees of the same thing. A core is not a fancy
// homebrew app, and homebrew is not an empty core. They install to different directories
// (`placement.ts`) and only a core may create a console.
//
// An emulator is one KIND of core — the kind that imitates hardware. DOOM is also a core: it
// declares `doom/` and `.wad`, and emulates nothing. "Core" is the general word, which is why
// the spec renamed the field and why nothing in this app calls a core an emulator.
//
// Full prose, including how a declaration becomes a Library button: docs/ARCHITECTURE.md,
// "Cores and homebrew — what a core actually is".

/** The one schemaVersion this client implements. Anything else is refused, not guessed at. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * `"core"` is the spec's current name; `"emulator"` is what published manifests still carry
 * (DOOM v0.2.0 is live with the old value). Both are in the union so a `core` manifest parses
 * rather than being refused — but NOTHING should compare against these strings directly:
 * `isCoreKind()` just below is the single place that decides, and it is where the
 * `"emulator"` arm gets deleted once every project has republished.
 */
export type SourceKind = "homebrew" | "emulator" | "core";

/**
 * TRANSITIONAL — the ONE place that decides whether a kind means "core".
 *
 * gwrg-dist-spec commit `d6c24b0` ("Call a core a core") renamed `kind: "emulator"` to
 * `kind: "core"`: a core is the general thing, an emulator is a core that emulates something,
 * and Doom is a core that emulates nothing. The schema's enum is now `["homebrew", "core"]`
 * only — but published manifests still carry the old value (DOOM v0.2.0 is live as
 * `"emulator"` right now), so both are accepted until every project has republished.
 *
 * It lives HERE, in the leaf module that declares `SourceKind` and imports nothing, rather
 * than beside the registry: the manifest parser, placement, BIOS and several views all have
 * to ask, and none of them should have to depend on the console registry to do it. Comparing
 * against the literal instead is how sixteen of seventeen published cores came to be refused
 * with "the project published a file this tool could not read" — the fix that introduced this
 * predicate did not reach `client.ts`.
 *
 * When every project this app resolves has republished, drop `"emulator"` here and NOWHERE
 * else: every other reader asks this function.
 */
export function isCoreKind(kind: unknown): kind is "core" | "emulator" {
  return kind === "core" || kind === "emulator";
}

export interface RequiresAbi {
  version: number;
  minSize: number;
}

/** One entry of `versions.json`'s `versions[]`. Newest first; `versions[0]` is the latest. */
export interface VersionEntry {
  tag: string;
  /** Relative to versions.json. Resolved by the client into `manifestUrl`. */
  manifest: string;
  publishedAt: string;
  prerelease: boolean;
  kind: SourceKind;
  requiresAbi: RequiresAbi;
  needsUserFiles: boolean;
  bundle?: string;
}

/**
 * The trimmed shape of one `versions[]` entry that the detail view's version picker needs:
 * enough to LABEL a version (`tag`, `publishedAt`, `prerelease`) and enough to ADDRESS it
 * (`manifest`, relative to versions.json). Deliberately not the whole `VersionEntry`.
 *
 * This is the only part of the index that is PERSISTED (store.svelte.ts's `SourceCard`), so it
 * is kept as small as it can be: `kind`, `requiresAbi` and `needsUserFiles` are claims about a
 * build that must be re-read from that version's own manifest before anything acts on them, and
 * persisting them would only invite a consumer to act on a stale, un-refetched copy.
 */
export interface VersionOption {
  tag: string;
  manifest: string;
  publishedAt: string;
  prerelease: boolean;
}

export interface VersionsFile {
  schemaVersion: number;
  project: string;
  title: string;
  repo: string;
  releasesUrl: string;
  retained?: number;
  versions: VersionEntry[];
}

export interface Artifact {
  filename: string;
  bytes: number;
  sha256: string;
  /** A plain filename in the manifest; resolved to an absolute URL by the client. */
  url: string;
  /**
   * `true` if this file must live at a real address rather than in a filesystem: memory the
   * device executes or indexes in place, for which a copy inside a filesystem is no use.
   *
   * Only a FLASH install has anything to do about it -- on SD the core caches the file into
   * QSPI itself at load time and patches it on the way in. See `mappedReloc.ts`.
   */
  mapped?: boolean;
  /**
   * The sentinel address the blob was linked at. Only meaningful with `mapped`, and optional
   * even then: a file can need to be addressable without needing relocation.
   */
  relocBase?: number;
}

/** A core's system = one launcher tab. `extensions[]` entries may be groups. */
export interface SystemEntry {
  id: string;
  longName: string;
  shortName: string;
  extensions: (string | string[])[];
  browse: "file" | "directory";
  compression: boolean;
  cheatExt?: string;
  /**
   * The directory under `/bios` this system's BIOS files install into, when it is not the
   * system's own `id` (spec/07-cores.md). Only a couple of systems diverge — PC Engine CD
   * (`bios/pce`), ColecoVision (`bios/coleco`) — so a consumer reads `biosDir ?? id`.
   *
   * Untrusted third-party text like every other string here, and one that BECOMES A PATH
   * SEGMENT, so the parser keeps it only when it is a single plain segment and drops it
   * otherwise (client.ts's `parseSystems`) — the fallback to `id` is always safe.
   */
  biosDir?: string;
  bios?: BiosEntry[];
  /**
   * Games the PROJECT ships, published beside the manifest (spec/07-cores.md, "A project may
   * ship a game itself"). Doom's shareware episode is the case: redistributable since 1993, so
   * a Doom core that ships it is one a user can install and play owning nothing.
   *
   * The ROM-folder counterpart of `bios[]`, and the difference that matters is the DESTINATION:
   * a shipped game installs to `roms/<system id>/`, the folder the launcher browses, never to
   * `biosDir` (spec/05-host.md). A game is a game; only BIOS files answer to that key.
   *
   * Unlike `bios[]` there is no unpublished form -- `url`, `bytes` and `sha256` are required,
   * because an entry without them would describe a game the user already has, and a game the
   * user already has needs no manifest entry. `parseGames` drops an entry that does not carry
   * them rather than refusing the manifest, the same defensive shape `biosDir` uses.
   *
   * It CAN make `needsUserFiles` false, but never by itself -- only through `uses[].required`.
   * Shipping a game is what lets a project honestly declare that its converter is optional,
   * and `uses[].required: false` is the declaration the derivation reads. spec/02-versions.md
   * reversed an earlier note here (spec `c47614b` -> `ab693aa`) for exactly Doom's shape.
   */
  games?: GameEntry[];
}

/**
 * One game a project publishes with itself.
 *
 * Every field except `description` is required by the schema, and this parser enforces the ones
 * an install depends on: without `url`, `bytes` and `sha256` there is nothing to fetch and
 * nothing to check it against.
 */
export interface GameEntry {
  id: string;
  /** The name it takes in `roms/<system id>/`. A plain filename, never a path. */
  filename: string;
  /** Relative to the manifest, like every other published file. */
  url: string;
  bytes: number;
  sha256: string;
  label: Record<string, string>;
  description?: Record<string, string>;
}

export interface BiosEntry {
  id: string;
  filename: string | string[];
  /**
   * Present when the PROJECT SHIPS this file, published beside the manifest like any other
   * named file (spec/07-cores.md, "A project may ship a game itself" settles the same rule for
   * BIOS). It is the difference between a file the user must go and find and one the install
   * fetches for them, which is why `needsUserFiles` counts only a required BIOS with NO url:
   * "otherwise every MSX install would warn about files it was about to install itself".
   *
   * Nothing reads the bytes through this field yet -- `bios.ts` resolves a slot from the
   * device and the user's folders -- but the derivation cannot be spec-correct without it.
   */
  url?: string;
  required?: boolean;
  requiredFor?: string[];
  bytes?: number;
  sha1?: string;
  strict?: boolean;
  label: Record<string, string>;
  description?: Record<string, string>;
}

export interface Target {
  id: string;
  platform: string;
  label: string;
  kind: SourceKind;
  requiresAbi: RequiresAbi;
  artifacts: Artifact[];
  /**
   * The tools this target runs, and which of their outputs it takes. `system` says which
   * system a converted output belongs to and is REQUIRED only when the target declares more
   * than one — see `placement.ts`, which is the only reader and validates it there (this
   * array is cast through the manifest parser unchecked, and `system` becomes a path segment).
   */
  uses?: { tool: string; outputs: string[]; required: boolean; system?: string }[];
  symbols?: Artifact[];
  systems?: SystemEntry[];
  /**
   * The folder under the install directory a HOMEBREW reads its data from, from the manifest's
   * `dataDir` (gwrg-dist-spec `61d3726`). OpenLara opens `/homebrews/openlara/TITLE.PKD`; the
   * folder name is compiled into its binary, so nothing can derive it and the manifest states
   * it. The binary itself is placed as always -- `dataDir` moves the DATA, never the executable.
   *
   * Absent for a core: a core's converted output is a game and goes to `roms/<system id>/`,
   * which `systems[]` already decides. `parseManifest` drops it rather than refusing.
   *
   * Consumed by `sources/placement.ts`'s `converterOutputDir`, which appends it to the
   * homebrew directory. `artifactDir` deliberately does NOT — the binary stays where the
   * launcher looks for it.
   */
  dataDir?: string;
}

export interface Tool {
  id: string;
  processor: { type: string; version: number };
  title: Record<string, string>;
  binary: { file: string; url: string; bytes: number; sha256: string };
  limits: { maxMemoryPages: number; maxOutputBytes: number };
  inputs: unknown[];
  /** `filename` XOR `extension` — see `ConverterOutputSpec`; narrowed by `parseToolOutputs`. */
  outputs: { id: string; filename?: string; extension?: string; maxBytes: number }[];
}

export interface Manifest {
  schemaVersion: number;
  project: string;
  title: string;
  docs?: string;
  /**
   * The console this work originated on ("snes", "pico8") — spec/03-manifest.md, "Provenance
   * and cover art". Homebrew only, and OPTIONAL: an original Game & Watch work omits it.
   * Untrusted third-party text like everything else here, but the client only keeps it when it
   * matches the schema's `^[a-z0-9][a-z0-9-]*$`. NOT validated against our known systems — the
   * value space is deliberately wider than `systems[].id` (a homebrew may come from a console
   * no core emulates).
   */
  originalSystem?: string;
  /**
   * The original work's own TITLE, for looking it up in that platform's art library --
   * spec/03-manifest.md, alongside `originalSystem`. OPTIONAL, and the pair is what makes it
   * useful: `originalSystem` says which library, this says which entry in it.
   *
   * It exists because a project's name is not the work's name. ScreenScraper has no "ccleste"
   * and no "zelda3"; it has "Celeste Classic" and "The Legend of Zelda - A Link to the Past".
   *
   * USED AS GIVEN. The owner: "they're optional so if they're added, it's intentional." A
   * publisher who sets this has made a statement about what the work IS, so it is not
   * sanity-checked against ScreenScraper, not traded for a better-scoring hit on another
   * system, and not quietly replaced by the project name when it misses. Free text, unlike
   * `originalSystem`: a title carries spaces, punctuation and case.
   */
  originalName?: string;
  /**
   * Where this project may be installed — `schema/manifest.schema.json`'s `storage`, an array
   * of "sd" / "flash". OPTIONAL in the schema, so `undefined` means "the publisher did not
   * say", which is NOT the same as "neither": the UI shows no Valid Targets row at all rather
   * than inventing a default.
   */
  storage?: ("sd" | "flash")[];
  source: { repo: string; commit: string; ref: string };
  tools: Tool[];
  targets: Target[];
}

/** What a successful two-fetch resolve produces: the index, the newest entry, its manifest. */
export interface ResolvedSource {
  /** `owner/repo`, normalised. */
  repo: string;
  versionsUrl: string;
  index: VersionsFile;
  entry: VersionEntry;
  manifestUrl: string;
  manifest: Manifest;
}

/** Why a resolve failed. The UI maps each to its own i18n string; never a raw fetch message. */
export type SourceErrorCode =
  | "bad-url"
  | "no-pages"
  | "no-versions"
  | "malformed"
  | "unsupported-schema"
  | "network"
  // --- the install path (installArtifacts.ts) ---
  | "artifact-size-mismatch" // the bytes that arrived disagree with the manifest's `bytes`
  | "aborted" // the caller's AbortSignal fired mid-fetch
  // --- the offline-bundle import path (bundle.ts) ---
  // Not a readable zip, or one whose entry names are not safe to resolve (spec/06's step 1:
  // `..`, a leading `/`, a backslash). Deliberately ONE code for both: to a user "this zip is
  // not a bundle this tool will read" is the whole story, and splitting it would only invite
  // the UI to explain an attack back to whoever mounted it.
  | "bundle-invalid"
  // The manifest names a file the zip does not contain. A bundle is supposed to be the WHOLE
  // directory, so this is an error rather than something to skip (spec/06, step 4).
  | "bundle-missing-file"
  | "raw-core-invalid"
  // The project this bundle describes is already in the list as a network-resolved source.
  | "bundle-conflict";

export class SourceError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    /** Untrusted detail (a URL, a schemaVersion). Rendered as text beside the mapped copy. */
    readonly detail?: string,
  ) {
    super(code);
    this.name = "SourceError";
  }
}

// --- Association keys ------------------------------------------------------------------------
//
// A folder's `usedBy` (`localFolders.svelte.ts`) names what that folder is for. Two shapes are
// live at once, on purpose:
//
//   `owner/repo#targetId`             the TARGET key. Also `HomebrewTitle.key` and
//                                     `RegisteredSystem.targetKey`. Means "this target", and for
//                                     a core that means every system it declares.
//   `owner/repo#targetId@systemId`    one SYSTEM of that target.
//
// The second exists because the "Used by" picker lists one entry per system: a core can serve
// several consoles that are genuinely different answers (a folder of PC Engine CD images is not
// a folder of HuCards), and with one key per target the two entries shared a checkbox.
//
// THE FIRST SHAPE IS PERSISTED USER DATA and predates the second. Every row written before this
// carries it, so it must keep working rather than be migrated away behind the user's back:
// `targetOf()` is what every "does this folder serve X" test goes through, and it reads a bare
// target key as the whole target. Dropping those would un-associate the user's folders with no
// visible error at all -- the library would just quietly stop filing their ROMs.
//
// `@` is therefore RESERVED in a target id. Nothing in the spec uses one and no published
// manifest has one; the split takes the first `@` after the `#` so that a system id containing
// one cannot move the boundary.

/**
 * The one association key that names no target at all: "this folder holds BIOS".
 *
 * A THIRD SHAPE, deliberately not `owner/repo#...`. A BIOS is not a core's to own: the same
 * `disksys.rom` satisfies whichever NES core the user has added today, and several cores can
 * declare a slot the one file fills. Keying it to a target would make the user re-answer the
 * question every time they swapped cores, and would silently stop recognising the file when the
 * core that "owned" it was removed.
 *
 * It cannot collide with a target key: `#` is mandatory in those and absent here, so
 * `targetOf("bios")` is `"bios"`, which matches no registered target, and every existing
 * "does this folder serve X" test answers false for it without being taught about it.
 */
export const BIOS_USED_BY_KEY = "bios";

/** True for the BIOS association key. One place, so the literal is not spread around. */
export function isBiosUsedBy(key: string): boolean {
  return key === BIOS_USED_BY_KEY;
}

/** `owner/repo#targetId@systemId` — one system of one target. */
export function systemKey(repo: string, targetId: string, systemId: string): string {
  return `${repo}#${targetId}@${systemId}`;
}

function sepIndex(key: string): number {
  const hash = key.indexOf("#");
  return hash < 0 ? -1 : key.indexOf("@", hash + 1);
}

/** The target half of an association key. A bare target key is returned unchanged. */
export function targetOf(key: string): string {
  const at = sepIndex(key);
  return at < 0 ? key : key.slice(0, at);
}

/** The system half, or `undefined` for a bare target key (which means "every system"). */
export function systemOf(key: string): string | undefined {
  const at = sepIndex(key);
  return at < 0 ? undefined : key.slice(at + 1);
}
