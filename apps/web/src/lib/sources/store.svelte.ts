/**
 * The Sources store: which content sources the user has added, whether each is active, and
 * the last thing we learned about each from its Pages mirror.
 *
 * PERSISTENCE: `gnw:sources.v1` in localStorage (via persist.ts's loadSel/saveSel), holding
 * one record per source — the normalised `owner/repo`, the active flag, and a small summary
 * card so the list renders instantly on a later visit before any network call returns. NOT
 * localCrypt.ts: that is for values which should not sit around in plaintext, and a public
 * repo URL is not one of those. An imported bundle's ZIP does not fit in localStorage and
 * lives in IndexedDB instead — see `bundleStore.ts`, and `restore()` below for how a row gets
 * its payloads back.
 *
 * This phase ends at "the app knows about a source and whether it is active". Nothing here
 * downloads an artifact, runs a converter, or touches hardware.
 */
import { loadSel, saveSel } from "../persist.js";
import { curatedProjects } from "../firmwareDist/curated.js";
import type { CuratedProject } from "../firmwareDist/types.js";
import { resolveSource, resolveVersion, normaliseRepoRef, versionsUrlFor } from "./client.js";
import { importBundle, type BundleImport } from "./bundle.js";
import { forgetBundle, keepBundle, restoreBundle } from "./bundleStore.js";
import { announceSourceRemoved } from "./sourceRemoval.js";
import { AutoDownloader, autoDownloader, shouldAutoDownload } from "./autoDownload.js";
import { buildCoreRegistry, isCoreKind } from "./coreRegistry.js";
import { manifestNeedsUserFiles } from "./needsUserFiles.js";
import {
  SourceError,
  type Manifest,
  type ResolvedSource,
  type SourceErrorCode,
  type SourceKind,
  type VersionOption,
} from "./types.js";

const STORAGE_KEY = "sources.v1";

/**
 * Repos the user has REMOVED, so the curated import does not put them back.
 *
 * A second key, deliberately. Without it `remove()` is undone on the next visit for anything
 * the firmware's curated list names — the store would re-add it, and "remove" would mean
 * "until you reload". The alternative, a tombstone row inside `sources.v1`, changes the shape
 * of a persisted array that already has migration coverage, to carry a fact that is not a
 * source. It holds nothing but `owner/repo` strings the user already chose to see.
 *
 * Every removal is recorded, not only a curated one: a repo the user removed should not come
 * back if a later firmware release happens to add it to the list. Adding it again by hand
 * clears the entry.
 */
const DISMISSED_KEY = "sources.dismissed.v1";

/**
 * How many `versions[]` entries a card keeps. A project's own retention is usually a handful,
 * but `versions.json` is third-party text and localStorage is a shared, limited budget, so the
 * list this app persists is bounded here rather than by whatever a repo publishes. Newest
 * first, so a cut only ever loses the oldest — and the ones it loses are the ones a mirror is
 * most likely to have dropped already.
 */
const MAX_VERSION_OPTIONS = 20;

/** The flattened, persistable summary of one resolved source. All strings are untrusted. */
export interface SourceCard {
  title: string;
  kind: SourceKind;
  tag: string;
  publishedAt: string;
  prerelease: boolean;
  needsUserFiles: boolean;
  abiVersion: number;
  /** `requiresAbi.minSize` — the smallest `sizeof(gw_firmware_abi_t)` this build can load
   *  against. Optional because cards persisted before the device-ABI check existed do not
   *  have it; a missing value is read as 0 (no size floor), never as a failure. */
  abiMinSize?: number;
  /**
   * Core only: one entry per launcher tab. This is what lets the Library's console row be
   * right on the FIRST frame — `coreRegistry.ts` falls back to it until the manifest resolves.
   *
   * `folder`, `browse` and `ingestable` are optional because cards persisted before the core
   * registry existed do not carry them; a missing value falls back the same way a missing
   * manifest does (`folder ?? id`, `browse ?? "file"`, no ingestable extensions).
   */
  systems: {
    id: string;
    longName: string;
    shortName: string;
    extensions: string[];
    folder?: string;
    browse?: string;
    /** Converter-input extensions for this system — `.wad` for Doom. */
    ingestable?: string[];
  }[];
  /** Union of every system's extensions, lowercased, for the "N ROMs matched" meta line. */
  extensions: string[];
  releasesUrl: string;
  docs?: string;
  /**
   * The version list behind the detail view's picker, newest first — PERSISTED, on purpose.
   *
   * The card exists so the list renders instantly before any network call returns; a picker
   * that showed nothing until a round-trip finished would be strictly worse than one that
   * offers the versions we already know about. Nothing is ACTED on from here: choosing an
   * entry re-fetches `versions.json` and that version's manifest through the same guards the
   * newest-version path runs (`client.ts`'s `resolveVersion`), so a stale or tampered entry
   * can only ever name a tag, never smuggle a URL.
   *
   * Absent on a bundle row (there is no mirror to offer other versions from) and on cards
   * written before the picker existed; both simply render the resolved version and no control.
   */
  versions?: VersionOption[];
}

export type SourceStatus = "idle" | "loading" | "ok" | "error";

/**
 * Where a source came from. This is a PERSISTED distinction, not a cosmetic one, and it exists
 * for two reasons that both bite if it is missing:
 *
 *   1. A bundle has no mirror to refresh from. `refresh()` would fetch `versions.json` off
 *      GitHub Pages — which for an archived project 404s, and for a live one would silently
 *      REPLACE the user's imported copy with the current release. Neither is what importing a
 *      zip asked for. So a bundle row never refreshes.
 *   2. spec/06-bundle.md, "Provenance": a bundle proves its own integrity and nothing else —
 *      whoever edited a payload could edit the manifest's hash to match. The spec is explicit:
 *      "Label an imported bundle as unverified. Do not present it as equivalent to a fetched
 *      release." A row that could not say where it came from could not carry that label.
 */
export type SourceOrigin = "url" | "bundle";

interface Persisted {
  repo: string;
  active: boolean;
  /** True when this row was discovered from the firmware's curated project list. */
  curated?: boolean;
  card?: SourceCard;
  /** Absent in rows written before bundles existed; those are all network-resolved. */
  origin?: SourceOrigin;
  /**
   * The version the user PINNED with the detail view's picker, when it is not the newest.
   *
   * Persisted, because it is a choice and not a view state: a pin that evaporated on reload
   * would silently put the source back on the newest release without saying so. `refresh()`
   * honours it instead of taking `versions[0]`, which is what makes the picker change what
   * actually installs rather than only what the detail view displays.
   *
   * Absent means "track the newest", which is what every row did before this existed.
   */
  pinnedTag?: string;
}

export interface SourceRow extends Persisted {
  status: SourceStatus;
  errorCode?: SourceErrorCode;
  errorDetail?: string;
  /**
   * The full manifest from the last successful resolve. IN MEMORY ONLY — deliberately not in
   * `Persisted`, so it never reaches localStorage: it is large, it is third-party text, and a
   * stale copy of it would be worse than no copy (the card exists precisely so the list can
   * render before the network answers; a manifest is only safe to act on when it is fresh).
   *
   * This is what replaced the hand-maintained homebrew table: `tools[]` and `targets[]` here
   * are the only description of what a title needs and what it installs.
   */
  manifest?: Manifest;
  /**
   * Bundle rows only: revokes the blob URLs holding this import's verified payloads. In memory
   * like `manifest`, and for the same reason — a blob URL exists only for this tab's lifetime.
   * The ZIP behind it does outlive the tab (`bundleStore.ts`), but it comes back as new URLs
   * from a fresh, fully re-verified import, never as these.
   */
  releaseBundle?: () => void;
}

/** Flatten a resolve into the small card the list renders and localStorage keeps. */
function toCard(r: ResolvedSource, origin: SourceOrigin): SourceCard {
  // A source's target for this device family. The spec allows several targets (one per
  // platform); we read the Game & Watch one and fall back to the first, rather than
  // pretending a multi-platform manifest is an error.
  const target =
    r.manifest.targets.find((t) => t.platform === "game-and-watch") ?? r.manifest.targets[0];
  // Converter-input extensions, per system, so a card alone can seed the core registry (see
  // SourceCard.systems). Built from the same manifest the registry reads, so the two cannot
  // disagree about what a core ingests.
  const registered = buildCoreRegistry([
    { repo: r.repo, active: true, manifest: r.manifest },
  ]).systems;
  const ingestOf = new Map(registered.map((s) => [s.id, s.ingestable]));

  const systems = (target.systems ?? []).map((s) => ({
    id: s.id,
    longName: s.longName,
    shortName: s.shortName,
    // A group's FIRST entry is the file the launcher lists and the user picks; the rest
    // travel with it (spec/07). For a "which ROMs match" hint only the first is meaningful.
    extensions: s.extensions.map((e) => (Array.isArray(e) ? e[0] : e)),
    ...((s as { folder?: string }).folder ? { folder: (s as { folder?: string }).folder } : {}),
    browse: s.browse,
    ...((ingestOf.get(s.id) ?? []).length > 0 ? { ingestable: ingestOf.get(s.id) } : {}),
  }));
  const extensions = [...new Set(systems.flatMap((s) => s.extensions.map((e) => e.toLowerCase())))];
  return {
    title: r.manifest.title,
    kind: r.entry.kind,
    tag: r.entry.tag,
    publishedAt: r.entry.publishedAt,
    prerelease: r.entry.prerelease,
    // DERIVED FROM THE MANIFEST, NOT COPIED FROM THE INDEX. spec/02-versions.md:92-93 says
    // of the index's duplicated fields: "They must agree with the manifest; the manifest
    // wins." `r.manifest` is right here, so there is no reason to trust the copy -- and a
    // publisher who updates a manifest without regenerating `versions.json` is exactly the
    // case the spec wrote that sentence for.
    needsUserFiles: manifestNeedsUserFiles(r.manifest),
    abiVersion: target.requiresAbi.version,
    abiMinSize: target.requiresAbi.minSize,
    systems,
    extensions,
    releasesUrl: r.index.releasesUrl,
    ...(r.manifest.docs ? { docs: r.manifest.docs } : {}),
    // Bundle rows get NO version list. A bundle is one release's directory (spec/06); the
    // other entries its embedded versions.json happens to name have no payloads in the zip,
    // and reaching for them would mean a network fetch — the one thing importing an offline
    // bundle asked not to do. Omitting the data (rather than hiding a control) is what keeps
    // the picker from ever appearing there by accident.
    ...(origin === "url"
      ? {
          versions: r.index.versions.slice(0, MAX_VERSION_OPTIONS).map((v) => ({
            tag: v.tag,
            manifest: v.manifest,
            publishedAt: v.publishedAt,
            prerelease: v.prerelease,
          })),
        }
      : {}),
  };
}

/**
 * The `owner/repo` a curated entry names, or null when its `versionsUrl` is not a GWRG Pages
 * mirror we can map to one.
 *
 * `parseProjects()` has already checked the URL's SHAPE (https, ends in `/versions.json`).
 * This is the stronger check: the URL must be exactly the canonical mirror path for the repo
 * it appears to name (`versionsUrlFor`), so a lookalike — a deeper path, another host, a
 * different `dist/` root — is refused rather than silently collapsed onto a repo it is not.
 * Nothing downstream ever fetches the entry's URL; it fetches the one derived from the repo.
 */
export function curatedRepoFor(project: CuratedProject): string | null {
  const repo = normaliseRepoRef(project.versionsUrl);
  if (!repo) return null;
  return versionsUrlFor(repo) === project.versionsUrl ? repo : null;
}

/** Injected seams for `importCurated()`. Production passes nothing. */
export interface CuratedDeps {
  /** The newest release's curated list, or null when it publishes none. */
  load: () => Promise<CuratedProject[] | null>;
  /** Resolve one project through the GWRG client. */
  resolve: (repo: string) => Promise<ResolvedSource>;
}

const defaultCuratedDeps: CuratedDeps = { load: curatedProjects, resolve: resolveSource };

/**
 * A curated entry whose own `versionsUrl` walk failed.
 *
 * It is deliberately NOT a row (see `importCurated`): a row with no card parks in the Homebrew
 * rail whatever it actually is, and an offline first visit would draw ~22 junk rows. It is a
 * quiet section-scoped note instead, which is possible because `projects.json` carries `kind`
 * and `title` (`firmwareDist/types.ts`, `CuratedProject`) and both are read BEFORE the
 * per-entry walk that fails — so the rail and the name are known without the file we could not
 * fetch. No cause is recorded: offline / 404 / malformed are indistinguishable here.
 */
export interface CuratedFailure {
  repo: string;
  /** `CuratedProject.title` — a runtime value, never translated. */
  title: string;
  /** The rail the note belongs under, mapped from `CuratedProject.kind`. */
  kind: SourceKind;
}

/** The two remote rail panes. `byKind` returns exactly these keys. */
export type RemoteKind = "core" | "homebrew";

/**
 * How many sources re-resolve at once when a whole pane is updated.
 *
 * Three, not two: unlike `autoDownload`'s background blob fetches (`AUTO_DOWNLOAD_CONCURRENCY`,
 * deliberately 2 because nobody asked for them), this is work the user just asked for and is
 * watching, and each job is two small JSON documents rather than a multi-megabyte artifact.
 * Three keeps a ~22-row curated pane from stampeding the connection while still finishing
 * promptly. It is a ceiling, not a target: a pane with one row makes one request.
 */
export const UPDATE_ALL_CONCURRENCY = 3;

class SourcesStore {
  rows = $state<SourceRow[]>([]);
  /** Repo of the selected row, or null. Selection is view state and is not persisted. */
  selected = $state<string | null>(null);
  /** In-flight add: the repo being resolved, so the Add form can show progress. */
  adding = $state(false);
  /**
   * The rail pane whose sources are being re-resolved right now, or null. One field rather
   * than a boolean because the two remote panes update independently — Cores running must
   * not disable Homebrew's control.
   */
  updating = $state<RemoteKind | null>(null);
  addError = $state<{ code: SourceErrorCode; detail?: string } | null>(null);

  /**
   * Curated entries that could not be resolved this session, in list order.
   *
   * Read by the Sources view as one note per rail. Never a row, never a count in the rail —
   * a failed entry is not a source you have.
   */
  curatedFailures = $state<CuratedFailure[]>([]);

  /**
   * Background artifact pre-fetch (`autoDownload.ts`). A field rather than a direct import so
   * offline suites can swap in a fake; production leaves the app-wide queue in place.
   *
   * It is only ever asked for ACTIVE, network-resolved rows. Curated rows are active by default,
   * so they participate in the same warm-up once their manifests resolve.
   */
  downloader: AutoDownloader = autoDownloader;

  private loaded = false;
  /** See DISMISSED_KEY. Read with the rows, written by `remove()` and `undismiss()`. */
  private dismissed = new Set<string>();

  /**
   * Read localStorage once, then refresh every source in the background — and bring in the
   * firmware release's curated list.
   *
   * `autoCurate` is a test seam (offline suites drive `importCurated()` with injected deps
   * instead); production calls this with no argument.
   */
  load(autoCurate = true): void {
    if (this.loaded) return;
    this.loaded = true;
    this.dismissed = new Set(
      loadSel<string[]>(DISMISSED_KEY, []).filter((r) => typeof r === "string"),
    );
    const stored = loadSel<Persisted[]>(STORAGE_KEY, []);
    this.rows = stored
      .filter((s): s is Persisted => !!s && typeof s.repo === "string")
      .map((s) => ({
        repo: s.repo,
        active: s.active === true,
        ...(s.curated === true ? { curated: true } : {}),
        card: s.card,
        origin: s.origin === "bundle" ? ("bundle" as const) : ("url" as const),
        ...(typeof s.pinnedTag === "string" ? { pinnedTag: s.pinnedTag } : {}),
        // A restored bundle row has its card but not yet its manifest: the manifest is
        // in-memory only (see `SourceRow.manifest`), and the payloads it named lived in blob
        // URLs that died with the tab. Both are rebuilt below by re-importing the kept zip —
        // "loading" until that answers, and honestly back to "idle" (the UI's "re-import to
        // install") if nothing was kept or the bytes no longer verify.
        status: s.card ? (s.origin === "bundle" ? "loading" : "ok") : "idle",
      }));
    for (const row of this.rows) {
      if (row.origin === "bundle") void this.restore(row.repo);
      else void this.refresh(row.repo);
    }
    // The curated list rides on the SAME startup pass as the stored rows, so the rail fills in
    // from one place. It is deliberately not awaited: a slow or unreachable firmware mirror
    // must not delay the sources the user already has.
    if (autoCurate) void this.importCurated();
  }

  /**
   * Bring in the curated core/homebrew list the CURRENT NEWEST firmware release publishes, as
   * ordinary remote-source rows.
   *
   * This adds rows. It downloads no artifact and prepares nothing. Curated rows are enabled by
   * default because the firmware's published project list is the app's default core catalog;
   * users can still deactivate individual rows from Sources.
   *
   * Degradation, in the order it matters:
   *   - the release publishes no `projects` (or the walk fails): nothing is added, and the rail
   *     is byte-for-byte what it shows today. Absence is not an error (client.ts).
   *   - an entry the user already has, from any origin: SKIPPED, theirs untouched. One row.
   *   - an entry the user has removed before: skipped (see DISMISSED_KEY).
   *   - one entry failing to resolve: caught per entry, so the other entries still land. It
   *     contributes no row, and is recorded in `curatedFailures` instead — one quiet note
   *     under its own rail (SourcesCuratedUnreadable.dc.html), retryable in place.
   */
  async importCurated(deps: CuratedDeps = defaultCuratedDeps): Promise<void> {
    let list: CuratedProject[] | null;
    try {
      list = await deps.load();
    } catch {
      // Unreadable and un-published look the same to a user: no curated sources, no error.
      // (The DISCOVERY walk failing is a different thing from one entry failing: there is no
      // list, so there are no titles and no rails to file a note under.)
      return;
    }
    if (!list) return;
    const wanted: CuratedFailure[] = [];
    for (const project of list) {
      const repo = curatedRepoFor(project);
      if (!repo) continue;
      if (this.dismissed.has(repo)) continue;
      // A dedupe skip is NOT a failure: the user already has this source, so there is nothing
      // missing to tell them about.
      const existing = this.get(repo);
      if (existing) {
        // Rows created by the old curated importer were persisted inactive. Their folder
        // associations are still valid, so migrate those rows to the new default once. A
        // deliberately deactivated row keeps its choice after this marker is written.
        if (existing.curated !== true && existing.active === false) {
          existing.active = true;
          existing.curated = true;
          this.persist();
        }
        continue;
      }
      if (wanted.some((w) => w.repo === repo)) continue;
      wanted.push({ repo, title: project.title, kind: project.kind === "core" ? "core" : "homebrew" });
    }
    await Promise.all(wanted.map((want) => this.resolveCurated(want, deps)));
  }

  /**
   * Re-resolve just the failed entries of ONE rail.
   *
   * Scope matters: this retries the per-entry `versionsUrl` walks that failed, NOT the curated
   * discovery walk (`curated.ts`'s memoised `curatedProjects()`) — the list is already in hand,
   * which is exactly why the notes have titles at all. `curated.ts` does not cache a rejection,
   * so a session that never got a list retries the whole walk on the next `importCurated()`.
   */
  async retryCurated(kind: SourceKind, deps: CuratedDeps = defaultCuratedDeps): Promise<void> {
    const pending = this.curatedFailures.filter((f) => f.kind === kind);
    await Promise.all(
      pending.map((want) => {
        // The user may have added or removed it by hand since it failed; either way it is no
        // longer something we are missing.
        if (this.get(want.repo) || this.dismissed.has(want.repo)) {
          this.clearCuratedFailure(want.repo);
          return Promise.resolve();
        }
        return this.resolveCurated(want, deps);
      }),
    );
  }

  /**
   * Failed curated entries grouped by the rail their note belongs under. Two rails, not one
   * per `SourceKind` — see `byKind`, and `isCoreKind` for why the test is not a comparison.
   */
  get curatedFailuresByKind(): { core: CuratedFailure[]; homebrew: CuratedFailure[] } {
    return {
      core: this.curatedFailures.filter((f) => isCoreKind(f.kind)),
      homebrew: this.curatedFailures.filter((f) => !isCoreKind(f.kind)),
    };
  }

  /**
   * Resolve one curated entry into a row, or record it as a failure. A success also clears any
   * standing note for it, so a retry that works removes the line it was listed on.
   */
  private async resolveCurated(want: CuratedFailure, deps: CuratedDeps): Promise<void> {
    let resolved: ResolvedSource;
    try {
      resolved = await deps.resolve(want.repo);
    } catch {
      if (!this.curatedFailures.some((f) => f.repo === want.repo)) {
        this.curatedFailures = [...this.curatedFailures, want];
      }
      return;
    }
    this.clearCuratedFailure(want.repo);
    // Re-check under the same guards: the user may have added or removed this repo by hand
    // while we were on the network, and their row is the one that wins.
    if (this.get(want.repo) || this.dismissed.has(want.repo)) return;
    this.rows = [
      ...this.rows,
      {
        repo: want.repo,
        active: true,
        curated: true,
        card: toCard(resolved, "url"),
        manifest: resolved.manifest,
        origin: "url",
        status: "ok",
      },
    ];
    this.persist();
    this.maybeAutoDownload(want.repo);
  }

  private clearCuratedFailure(repo: string): void {
    if (!this.curatedFailures.some((f) => f.repo === repo)) return;
    this.curatedFailures = this.curatedFailures.filter((f) => f.repo !== repo);
  }

  /**
   * Bring one bundle row's payloads back from `bundleStore.ts` by re-importing the kept zip.
   *
   * This is a full re-import — entry-name guards, schema gating, and the length and sha256 of
   * every file the manifest names — producing fresh blob URLs that `installArtifacts.ts` will
   * hash once more when it installs them. Nothing is trusted because it was verified on a
   * previous visit.
   *
   * Every failure lands in the same place: no manifest, status "idle", and the row asks for
   * the zip again. A row must never claim to be installable when its bytes are gone.
   */
  private async restore(repo: string): Promise<void> {
    let imported: BundleImport | undefined;
    try {
      imported = (await restoreBundle(repo)) ?? undefined;
    } catch {
      /* `restoreBundle` swallows its own failures; this is belt and braces. */
    }
    const row = this.get(repo);
    if (!row) {
      // Removed while we were reading. Do not leak the URLs we just published for it.
      imported?.release();
      return;
    }
    if (row.manifest) {
      // The user imported a zip for this row by hand before the restore came back. Theirs is
      // the newer intent; drop what we just published rather than overwriting it.
      imported?.release();
      return;
    }
    if (!imported) {
      row.status = "idle";
      return;
    }
    row.releaseBundle?.();
    row.card = toCard(imported.resolved, "bundle");
    row.manifest = imported.resolved.manifest;
    row.releaseBundle = imported.release;
    row.status = "ok";
    this.persist();
  }

  /** Forget a removal, so a curated entry for this repo can come back. */
  private undismiss(repo: string): void {
    if (!this.dismissed.delete(repo)) return;
    saveSel(DISMISSED_KEY, [...this.dismissed]);
  }

  private persist(): void {
    saveSel(
      STORAGE_KEY,
      this.rows.map(({ repo, active, curated, card, origin, pinnedTag }) => ({
        repo,
        active,
        ...(curated === true ? { curated: true } : {}),
        card,
        origin,
        pinnedTag,
      })),
    );
  }

  /**
   * Offer one row to the auto-downloader. Fire-and-forget and deliberately unconditional about
   * its own outcome: the queue applies the size threshold and the dedupe, and a row that does
   * not qualify simply is not queued. Nothing about the row changes either way.
   */
  private maybeAutoDownload(repo: string): void {
    const row = this.get(repo);
    if (!row || !shouldAutoDownload(row) || !row.manifest) return;
    this.downloader.request(repo, row.manifest);
  }

  get(repo: string): SourceRow | undefined {
    return this.rows.find((r) => r.repo === repo);
  }

  /**
   * The two rail sections. Deliberately NOT `Record<SourceKind, …>`: `SourceKind` now carries
   * both spellings of the same thing (`"core"` and `"emulator"`), and the rails are two
   * groups, not one per kind.
   *
   * `isCoreKind` rather than a literal comparison — a manifest published with the spec's new
   * `kind: "core"` used to fall through to the homebrew column, which is exactly the "Doom
   * shows up under Homebrew" class of bug.
   */
  get byKind(): { core: SourceRow[]; homebrew: SourceRow[] } {
    // A source with no card yet has no kind. Park it under homebrew so it is visible while
    // it resolves rather than vanishing from both columns.
    return {
      core: this.rows.filter((r) => isCoreKind(r.card?.kind)),
      homebrew: this.rows.filter((r) => !isCoreKind(r.card?.kind)),
    };
  }

  /**
   * The one place a network-resolved source becomes a row: card, manifest, origin, active
   * flag, selection and persistence. `add()` and `addResolved()` both end here, so the two
   * entry points cannot drift into producing different rows — the only thing they do
   * differently is where the `ResolvedSource` came from.
   */
  private keepResolved(repo: string, resolved: ResolvedSource): void {
    this.undismiss(repo);
    this.rows = [
      ...this.rows,
      {
        repo,
        active: true,
        card: toCard(resolved, "url"),
        manifest: resolved.manifest,
        origin: "url",
        status: "ok",
      },
    ];
    this.selected = repo;
    this.persist();
    // A hand-added row starts active, which is the user saying they want this source.
    this.maybeAutoDownload(repo);
  }

  /**
   * Keep a source the caller has ALREADY resolved (the add form's "Look up" step).
   *
   * Same guards as `add()` — the ref is re-normalised here rather than trusted, the dedupe
   * still runs, and the row is built by the same `keepResolved()` — so this is not a second,
   * laxer door into the store; it only skips the redundant second network resolve. That
   * matters for more than traffic: the "Found" panel and the stored row are now guaranteed to
   * describe the SAME resolve, where re-resolving could store version N+1 under a summary of
   * version N if a release landed between the two.
   *
   * Not used for bundles: those carry bytes to verify and go through `importBundleFile()`.
   */
  addResolved(resolved: ResolvedSource): boolean {
    this.addError = null;
    const repo = normaliseRepoRef(resolved.repo);
    if (!repo) {
      this.addError = { code: "bad-url" };
      return false;
    }
    if (this.get(repo)) {
      this.selected = repo;
      return true;
    }
    this.keepResolved(repo, resolved);
    return true;
  }

  /** Add a source from a pasted URL or `owner/repo`. Resolves it before keeping it. */
  async add(input: string): Promise<boolean> {
    this.addError = null;
    const repo = normaliseRepoRef(input);
    if (!repo) {
      this.addError = { code: "bad-url" };
      return false;
    }
    if (this.get(repo)) {
      this.selected = repo;
      return true;
    }
    this.adding = true;
    try {
      this.keepResolved(repo, await resolveSource(repo));
      return true;
    } catch (e) {
      const err = e instanceof SourceError ? e : new SourceError("network");
      this.addError = { code: err.code, detail: err.detail };
      return false;
    } finally {
      this.adding = false;
    }
  }

  /**
   * Import an offline bundle zip (spec/06-bundle.md). Produces exactly what `add()` produces —
   * same row, same card, same manifest shape — so nothing downstream branches on where a
   * source came from. Only `origin` records the difference, and only so the row can be
   * labelled unverified and kept off the refresh path.
   */
  async importBundleFile(data: Uint8Array): Promise<boolean> {
    this.addError = null;
    this.adding = true;
    let imported: BundleImport | undefined;
    try {
      imported = await importBundle(data);
      const { resolved } = imported;
      const existing = this.get(resolved.repo);

      // COLLISION. A network-resolved row was verified against the project's own mirror; a
      // bundle was not (see `SourceOrigin`). Silently overwriting the stronger record with the
      // weaker one — from a file whose provenance is whatever the user was handed — is a
      // downgrade the user never asked for, so it is refused and named. Re-importing over an
      // EXISTING bundle row is the opposite case: that is how a bundle-only project is
      // updated, and there is no stronger record to lose, so it replaces in place.
      if (existing && existing.origin !== "bundle") {
        imported.release();
        this.addError = { code: "bundle-conflict", detail: resolved.repo };
        return false;
      }
      existing?.releaseBundle?.();

      const row: SourceRow = {
        repo: resolved.repo,
        // A replacement keeps whatever the user had chosen; a new import starts active, as
        // `add()` does.
        active: existing ? existing.active : true,
        card: toCard(resolved, "bundle"),
        manifest: resolved.manifest,
        origin: "bundle",
        status: "ok",
        releaseBundle: imported.release,
      };
      this.rows = existing
        ? this.rows.map((r) => (r.repo === resolved.repo ? row : r))
        : [...this.rows, row];
      this.selected = resolved.repo;
      this.undismiss(resolved.repo);
      this.persist();
      // Keep the zip so a reload does not have to ask for it again. Deliberately not fatal and
      // deliberately not surfaced: the import is live in this tab whether or not it stuck, and
      // a store that refused it (private browsing, quota) simply means the next visit behaves
      // the way every visit did before this existed.
      await keepBundle(resolved.repo, data);
      return true;
    } catch (e) {
      imported?.release();
      const err = e instanceof SourceError ? e : new SourceError("bundle-invalid");
      this.addError = { code: err.code, detail: err.detail };
      return false;
    } finally {
      this.adding = false;
    }
  }

  /** Re-fetch one source's versions.json + newest manifest, updating its card in place. */
  async refresh(repo: string): Promise<void> {
    const row = this.get(repo);
    if (!row) return;
    // A bundle has no mirror behind it. Refreshing would either 404 or quietly swap the
    // imported copy for the live release; the way to update one is to import a newer zip.
    if (row.origin === "bundle") return;
    row.status = "loading";
    row.errorCode = undefined;
    try {
      const resolved = await this.resolvePinned(row);
      row.card = toCard(resolved, "url");
      row.manifest = resolved.manifest;
      row.status = "ok";
      this.persist();
      // Startup refreshes every stored row, so this is where an already-active source from a
      // previous visit gets its bytes warmed — bounded by the downloader's own concurrency.
      this.maybeAutoDownload(repo);
    } catch (e) {
      const err = e instanceof SourceError ? e : new SourceError("network");
      row.status = "error";
      row.errorCode = err.code;
      row.errorDetail = err.detail;
    }
  }

  /**
   * Re-fetch every source in one remote rail pane — the pane's Update all.
   *
   * WHAT "LATEST" MEANS HERE. This drives `refresh()`, so each row re-fetches its
   * `versions.json` and the manifest for the version it is ON. That is deliberate and is the
   * whole reason this is not a "move everything to newest" button: a row the user PINNED with
   * the detail picker stays pinned (`resolvePinned`), while its `versions[]` is refreshed — so
   * a new release shows up in the picker as an option without silently replacing the build the
   * user chose. An unpinned row tracks the newest and therefore does move, which is what
   * tracking the newest already meant.
   *
   * Bundle rows are skipped by `refresh()` itself (no mirror to refresh from) and so never
   * report loading, updated or errored here.
   *
   * One row failing does not stop the others: `refresh()` catches its own errors onto
   * `row.status`/`row.errorCode`, which the list already renders per row. There is deliberately
   * no summary error — the rows are the report.
   */
  async updateAll(kind: RemoteKind, refresher?: (repo: string) => Promise<void>): Promise<void> {
    // Not re-entrant per pane. Without this a second click would double every request and
    // race two writes onto the same rows.
    if (this.updating === kind) return;
    const run = refresher ?? ((repo: string) => this.refresh(repo));
    // Snapshot the repos up front: `refresh` mutates rows, and a curated import landing
    // mid-run must not extend or shorten the batch under us.
    const queue = this.byKind[kind]
      .filter((r) => r.origin !== "bundle")
      .map((r) => r.repo);
    if (queue.length === 0) return;
    this.updating = kind;
    try {
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++;
          if (i >= queue.length) return;
          // `refresh()` catches its own failures onto the row, so in production nothing
          // throws here. Catch anyway: this loop's contract is that one bad row cannot take
          // out the batch, and a guarantee that depends on someone else's try/block is not
          // a guarantee. Swallowed, not reported — the row already carries its own error.
          try {
            await run(queue[i]);
          } catch {
            /* the row's own status is the report */
          }
        }
      };
      const width = Math.min(UPDATE_ALL_CONCURRENCY, queue.length);
      await Promise.all(Array.from({ length: width }, worker));
    } finally {
      this.updating = null;
    }
  }

  /**
   * Resolve the version this row is pinned to, or the newest when it is not pinned.
   *
   * A pin whose tag the mirror no longer publishes is not an error the user should ever see:
   * retention drops old releases, and the honest outcome is "that build is gone, here is the
   * current one". So `no-versions`-with-a-tag (the only thing `resolveVersion` throws for a
   * missing entry) drops the pin and falls back. Every OTHER failure — network, malformed,
   * unsupported schema — propagates untouched, exactly as before.
   */
  private async resolvePinned(row: SourceRow): Promise<ResolvedSource> {
    if (!row.pinnedTag) return resolveSource(row.repo);
    try {
      return await resolveVersion(row.repo, row.pinnedTag);
    } catch (e) {
      if (e instanceof SourceError && e.code === "no-versions" && e.detail === row.pinnedTag) {
        row.pinnedTag = undefined;
        return resolveSource(row.repo);
      }
      throw e;
    }
  }

  /**
   * Switch one source to a named version (the detail view's picker).
   *
   * This changes what INSTALLS, not just what the detail view says: `row.manifest` and
   * `row.card` are the only description the install path has of a source (installArtifacts,
   * prepareState, the Library table all read them), so replacing them here is the whole
   * mechanism. It takes effect immediately for anything that reads the row, and the pin below
   * is what makes it survive the next `refresh()` instead of snapping back to newest.
   *
   * Choosing the version that IS the newest clears the pin rather than freezing the row on
   * today's tag — "latest" is a subscription, and a user picking the top entry is asking for
   * that, not for a permanent lock on its current number.
   *
   * Bundle rows are refused outright: they have no mirror (see `SourceOrigin`).
   */
  async selectVersion(repo: string, tag: string): Promise<void> {
    const row = this.get(repo);
    if (!row || row.origin === "bundle") return;
    if (row.card?.tag === tag && !row.errorCode) return;
    row.status = "loading";
    row.errorCode = undefined;
    row.errorDetail = undefined;
    try {
      const resolved = await resolveVersion(repo, tag);
      row.pinnedTag = resolved.index.versions[0]?.tag === tag ? undefined : tag;
      row.card = toCard(resolved, "url");
      row.manifest = resolved.manifest;
      row.status = "ok";
      this.persist();
      // A different version is different bytes, so whatever was warming is now the wrong
      // payload: stop it before asking for the new one.
      this.downloader.cancel(repo);
      this.maybeAutoDownload(repo);
    } catch (e) {
      const err = e instanceof SourceError ? e : new SourceError("network");
      row.status = "error";
      row.errorCode = err.code;
      row.errorDetail = err.detail;
    }
  }

  setActive(repo: string, active: boolean): void {
    const row = this.get(repo);
    if (!row) return;
    row.active = active;
    this.persist();
    // Activating IS the signal to pre-fetch; deactivating withdraws it, and a download the
    // user has just opted out of should stop rather than finish out of politeness.
    if (active) this.maybeAutoDownload(repo);
    else this.downloader.cancel(repo);
  }

  remove(repo: string): void {
    const row = this.get(repo);
    row?.releaseBundle?.();
    this.downloader.cancel(repo);
    // Removing a source removes its bytes. Leaving a multi-megabyte zip behind for a row the
    // user deleted is both a quota leak and a thing they would reasonably say they had removed.
    if (row?.origin === "bundle") void forgetBundle(repo);
    this.rows = this.rows.filter((r) => r.repo !== repo);
    if (this.selected === repo) this.selected = null;
    // Removing is a decision, and the curated import runs on every visit. Without this the
    // next reload would put a curated row straight back (see DISMISSED_KEY).
    this.dismissed.add(repo);
    saveSel(DISMISSED_KEY, [...this.dismissed]);
    this.persist();
    // Others were keeping things on this source's behalf -- `prepareState` alone holds its
    // prepared bytes, their provenance, its verdicts and a persisted converted pointer. Left
    // behind they kept the Library showing a removed source's games. Announced rather than
    // reached into, so this store goes on knowing nothing about them (see `sourceRemoval.ts`).
    // Last, so a listener always observes the row already gone.
    announceSourceRemoved(repo);
  }
}

export { SourcesStore };

export const sources = new SourcesStore();
