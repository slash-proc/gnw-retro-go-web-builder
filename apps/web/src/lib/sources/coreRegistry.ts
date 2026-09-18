/**
 * THE CORE REGISTRY — what the Library is allowed to know about consoles.
 *
 * WHAT THIS REPLACES, AND WHY. Three hardcoded tables used to decide, between them, which
 * consoles exist and which files count as games:
 *
 *   1. `romScan.ts`'s `CONSOLE_DIRS`      — which folder names made a picked directory "valid".
 *   2. `romSelection.svelte.ts`'s `CONSOLE_WHITELISTS` — the real gate: a `<dir>/<file>` was a
 *      game only if `<dir>` was in the table AND the extension was in that entry's set.
 *   3. `engine/consoles.ts`'s `LABELS`    — the display name.
 *
 * None of them consulted the user's Sources. So a Game Boy Color button appeared because a
 * `gbc/` folder existed on disk, whether or not the user had a GBC core enabled — and a core
 * the tables had never heard of (Doom) could not produce a console at all, however conformant
 * its manifest was. The owner's requirement is the opposite and is the rule implemented here:
 *
 *   a source declares what a core is (folder, names, extensions, browse mode)
 *     -> a scan of the ROM folder(s) says which of those actually have files
 *       -> those, and only those, are the consoles the Library shows.
 *
 * AUTHORITATIVE WHEN NON-EMPTY. When at least one active core is registered, this registry is
 * the ONLY source of truth: a folder no active core declares yields no games and no button,
 * which is exactly what makes disabling a source remove its console. The legacy tables survive
 * only as a fallback for the empty case (see `registryIsAuthoritative`) so a user who has not
 * yet added any core still sees the library they had before, and as labels for systems that
 * are on the DEVICE but not in Sources (a card can hold games for a core the user later
 * disabled — it still needs a name).
 *
 * PURE AND SVELTE-FREE, so `test/libraryscan.mjs` can drive it with plain objects. The
 * reactive singleton lives in `coreRegistry.svelte.ts`.
 */
import type { Manifest, SystemEntry, Target } from "./types.js";
import { isBiosUsedBy, isCoreKind, systemOf, targetOf } from "./types.js";

// `isCoreKind` moved to `types.ts` — the leaf module that declares `SourceKind` and imports
// nothing. The manifest parser, placement, BIOS and several views all have to ask, and making
// them depend on this registry to do it was how `client.ts` came to be missed. Re-exported so
// existing importers keep working.
export { isCoreKind };

/** One console the Library may show, as some active core declares it. */
export interface RegisteredSystem {
  /** `owner/repo#targetId` — the same key shape `usedBy` and `HomebrewTitle.key` use. */
  targetKey: string;
  repo: string;
  /** The system's own id (`systems[].id`). */
  id: string;
  /**
   * The `roms/<folder>/` directory this system's files live in — `systems[].folder ?? id`,
   * lowercased, because a scan key's directory is matched case-insensitively (FAT).
   */
  folder: string;
  longName: string;
  shortName: string;
  /**
   * Extensions that are INSTALLABLE as they are: `systems[].extensions`, lowercased and
   * dot-prefixed. A group's first entry is the file the launcher lists; the rest travel with
   * it (spec/07), so only the first is a thing the user picks.
   */
  installable: string[];
  /**
   * Extensions that BELONG to this system but cannot go to the device as they are — they are
   * a converter's input (`uses[] -> tools[].inputs[].extensions`). Doom's `.wad` is the case
   * this exists for: a real Library ROM under the Doom core, but only the `.whd` the converter
   * produces is ever copied to the card.
   *
   * Step 5 builds the per-file Prepare action on top of this; step 3 only needs to know the
   * file counts towards its console existing.
   */
  ingestable: string[];
  /**
   * The extension the converter's output carries, when this system has one — `outputs[].extension`,
   * or the extension of `outputs[].filename` for an output that declares a fixed name instead.
   *
   * This is how an ingestable file's OUTPUT NAME is known before any conversion runs: a `.wad`
   * that matched a variant takes that variant's declared `filename`, and one that matched none
   * derives `<stem><outputExtension>` (spec/03). Step 5 pairs the two on that name, which is why
   * the pairing costs no hash of its own — the output is found by name, not by digest.
   */
  outputExtension?: string;
  browse: "file" | "directory";
  compression: boolean;
  /**
   * Lowercased filenames this system's BIOS slots accept (`systems[].bios[].filename`).
   *
   * Carried on the registry so `dedicatedFolderPlacement` can recognise a BIOS by NAME without
   * reaching into `bios.ts`, which pulls in the converter and hash machinery and would drag all
   * of it into this module's pure bundle. Empty for a card-only row, which carries no BIOS data.
   */
  biosFilenames: string[];
  /**
   * Games this system's PROJECT ships with itself (`systems[].games[]`, spec/07-cores.md).
   *
   * Carried here so the Library can offer them as ordinary ROM rows without reaching into the
   * manifest again. A shipped game installs to `roms/<system id>/<filename>` -- the folder the
   * launcher browses -- so its Library key is `<folder>/<filename>`, the same key space a
   * converted output lands in. Doom relies on that: its shareware entry deliberately takes the
   * SAME filename its `variants[]` table gives the same dump, so a user who converts that WAD
   * themselves overwrites the shipped copy instead of ending up with two.
   *
   * Empty for a card-only row, which carries no manifest data.
   */
  shippedGames: ShippedGame[];
}

/** One published game, resolved against the system that owns it. */
export interface ShippedGame {
  /** `systems[].games[].id`, unique within the system. */
  id: string;
  /** The name it takes in `roms/<system id>/`. */
  filename: string;
  /** Relative to the manifest, resolved when it is fetched. */
  url: string;
  bytes: number;
  sha256: string;
  label: Record<string, string>;
}

export interface CoreRegistry {
  systems: RegisteredSystem[];
  /** Folder key (lowercased) -> the system that owns it. First declaration wins. */
  byFolder: Map<string, RegisteredSystem>;
  /**
   * Whether the user has ANY core source at all, active or not.
   *
   * This is what separates "nothing has resolved yet" (a first run — fall back to the legacy
   * tables so the library is not blank) from "the user deliberately turned everything off"
   * (respect that and show nothing). Without it, disabling your LAST core resurrected every
   * console the old hardcoded table knew — so switching a core off made MORE buttons appear.
   */
  hasCoreSources: boolean;
  /**
   * Every folder key ANY core source declares, whether it is active or not.
   *
   * `byFolder` answers "which console does the Library show", and that must follow activation.
   * This answers a different question — "is this directory a console directory at all" — and
   * that must NOT, because it is structural. A ROM folder holding only `gb/` and `gbc/` was
   * rejected at pick time with "Invalid folder selected" whenever tgb-dual happened to be
   * switched off, and since the folder was then never registered, switching the core ON
   * afterwards could not rescue it: there was nothing to rescan. See `isKnownConsoleDir`.
   */
  declaredFolders: Set<string>;
}

/**
 * The slice of a `SourceRow` this module reads. Structural, so `sources.rows` satisfies it
 * without this module importing the store (which would make it un-testable offline).
 */
export interface RegistrySourceRow {
  repo: string;
  active: boolean;
  card?: {
    kind: string;
    systems?: {
      id: string;
      longName: string;
      shortName: string;
      extensions: string[];
      folder?: string;
      browse?: string;
      ingestable?: string[];
    }[];
  };
  /** In-memory only, absent until the source resolves. Authoritative when present. */
  manifest?: Manifest;
}

/** No cores owned at all — the first-run shape. Exported so callers cannot drift a literal. */
export const EMPTY_REGISTRY: CoreRegistry = Object.freeze({
  systems: [],
  byFolder: new Map(),
  hasCoreSources: false,
  declaredFolders: new Set<string>(),
}) as CoreRegistry;
const EMPTY = EMPTY_REGISTRY;

/**
 * Lowercased BIOS filenames a system declares. Untrusted third-party text used only as a
 * lookup key, never as a path: `biosDestKey` still decides where an accepted file is written.
 */
function normaliseBiosFilenames(sys: SystemEntry): string[] {
  const out = new Set<string>();
  for (const entry of sys.bios ?? []) {
    const raw = (entry as { filename?: unknown }).filename;
    for (const f of Array.isArray(raw) ? raw : [raw]) {
      if (typeof f === "string" && f !== "") out.add(f.toLowerCase());
    }
  }
  return [...out];
}

/**
 * The system's shipped games, de-duplicated by the filename they claim.
 *
 * Two entries claiming one name would be one file on the card, and this is not the place that
 * decides which wins -- the first declaration keeps the name, the same rule `push` uses for a
 * folder two cores both declare. `client.ts`'s `parseGames` has already dropped anything
 * unfetchable, so everything here has a url, a size and a digest.
 */
function normaliseShippedGames(sys: SystemEntry): ShippedGame[] {
  const seen = new Set<string>();
  const out: ShippedGame[] = [];
  for (const g of sys.games ?? []) {
    const folded = g.filename.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push({ id: g.id, filename: g.filename, url: g.url, bytes: g.bytes, sha256: g.sha256, label: g.label });
  }
  return out;
}

/** Lowercase, dot-prefixed, de-duplicated. Untrusted third-party text; never a path. */
function normaliseExtensions(raw: readonly (string | string[])[] | undefined): string[] {
  const out = new Set<string>();
  for (const e of raw ?? []) {
    // A group's FIRST entry is the file the launcher lists; the rest travel with it.
    const first = Array.isArray(e) ? e[0] : e;
    if (typeof first !== "string" || first === "") continue;
    out.add(first.startsWith(".") ? first.toLowerCase() : `.${first.toLowerCase()}`);
  }
  return [...out];
}

/** What a target's converter contributes to one system: what it eats, and what it emits. */
interface SystemConversion {
  ingestable: string[];
  outputExtension?: string;
}

/**
 * The extension a tool's chosen outputs carry. An output declares `filename` XOR `extension`
 * (spec/04); a fixed filename still tells us the extension, which is all the pairing needs.
 * `use.outputs` names which of the tool's outputs this target consumes, so an unrelated output
 * of a multi-output tool does not decide the name.
 */
function outputExtensionOf(tool: { outputs?: unknown }, wanted: readonly string[] | undefined): string | undefined {
  const outputs = Array.isArray(tool.outputs) ? (tool.outputs as { id?: unknown; extension?: unknown; filename?: unknown }[]) : [];
  const want = wanted && wanted.length > 0 ? new Set(wanted) : undefined;
  for (const o of outputs) {
    if (want && (typeof o.id !== "string" || !want.has(o.id))) continue;
    if (typeof o.extension === "string" && o.extension !== "") {
      return normaliseExtensions([o.extension])[0];
    }
    if (typeof o.filename === "string") {
      const dot = o.filename.lastIndexOf(".");
      if (dot > 0) return o.filename.slice(dot).toLowerCase();
    }
  }
  return undefined;
}

/** A target's `systems[]` and its ingestable extensions, per system. */
function ingestableBySystem(manifest: Manifest, target: Target): Map<string, SystemConversion> {
  const out = new Map<string, SystemConversion>();
  const systems = target.systems ?? [];
  for (const use of target.uses ?? []) {
    const tool = manifest.tools?.find((t) => t.id === use.tool);
    if (!tool) continue;
    const exts: string[] = [];
    for (const input of tool.inputs ?? []) {
      const i = input as { extensions?: unknown };
      if (!Array.isArray(i.extensions)) continue;
      exts.push(...normaliseExtensions(i.extensions as string[]));
    }
    if (exts.length === 0) continue;
    // `use.system` says which system a converted output belongs to and is required only when
    // the target declares more than one (spec; `placement.ts` is the other reader). With a
    // single system it is implied, which is Doom's shape.
    const id = use.system ?? (systems.length === 1 ? systems[0]?.id : undefined);
    if (!id) continue;
    const prev = out.get(id);
    out.set(id, {
      ingestable: [...new Set([...(prev?.ingestable ?? []), ...exts])],
      // First `use` to declare one wins, matching `push`'s first-declaration-wins rule.
      outputExtension: prev?.outputExtension ?? outputExtensionOf(tool, use.outputs),
    });
  }
  return out;
}

function systemFolder(id: string, folder: string | undefined): string {
  const f = typeof folder === "string" && folder !== "" ? folder : id;
  return f.toLowerCase();
}

/**
 * Build the registry from the user's source rows.
 *
 * A row contributes only when it is ACTIVE and its kind is a core. The live manifest is
 * preferred because only it carries `browse`, `compression` and the tool inputs; the persisted
 * card is the fallback so the console row is populated on first paint, before any network call
 * has returned.
 */
export function buildCoreRegistry(rows: readonly RegistrySourceRow[]): CoreRegistry {
  const systems: RegisteredSystem[] = [];
  const byFolder = new Map<string, RegisteredSystem>();

  const push = (s: RegisteredSystem): void => {
    // First declaration of a folder wins. Two cores claiming `nes/` is a publisher conflict,
    // not something to merge silently into one console with both extension sets.
    if (byFolder.has(s.folder)) return;
    byFolder.set(s.folder, s);
    systems.push(s);
  };

  let hasCoreSources = false;
  // Collected from every row, active or not — see `CoreRegistry.declaredFolders`.
  const declaredFolders = new Set<string>();

  for (const row of rows) {
    // Counted BEFORE the active check: a deactivated core still proves the user has cores, and
    // that is what stops the legacy fallback from resurrecting the console they just turned off.
    if (isCoreKind(row.manifest?.targets?.find((t) => t.platform === "game-and-watch")?.kind
                   ?? row.manifest?.targets?.[0]?.kind
                   ?? row.card?.kind)) {
      hasCoreSources = true;
      // Same pass, same reason: a folder this core declares is a console directory whether or
      // not the user currently has it switched on.
      const t =
        row.manifest?.targets?.find((x) => x.platform === "game-and-watch") ??
        row.manifest?.targets?.[0];
      for (const sys of (t?.systems ?? []) as SystemEntry[]) {
        if (typeof sys?.id === "string" && sys.id !== "") {
          declaredFolders.add(systemFolder(sys.id, (sys as { folder?: string }).folder));
        }
      }
      for (const sys of row.card?.systems ?? []) {
        if (typeof sys?.id === "string" && sys.id !== "") {
          declaredFolders.add(systemFolder(sys.id, sys.folder));
        }
      }
    }

    if (!row.active) continue;

    const manifest = row.manifest;
    if (manifest) {
      const target =
        manifest.targets.find((t) => t.platform === "game-and-watch") ?? manifest.targets[0];
      if (!target || !isCoreKind(target.kind)) continue;
      const ingest = ingestableBySystem(manifest, target);
      for (const sys of (target.systems ?? []) as SystemEntry[]) {
        if (typeof sys?.id !== "string" || sys.id === "") continue;
        push({
          targetKey: `${row.repo}#${target.id}`,
          repo: row.repo,
          id: sys.id,
          folder: systemFolder(sys.id, (sys as { folder?: string }).folder),
          longName: sys.longName || sys.id,
          shortName: sys.shortName || sys.longName || sys.id,
          installable: normaliseExtensions(sys.extensions),
          ingestable: ingest.get(sys.id)?.ingestable ?? [],
          ...(ingest.get(sys.id)?.outputExtension ? { outputExtension: ingest.get(sys.id)!.outputExtension } : {}),
          browse: sys.browse === "directory" ? "directory" : "file",
          compression: sys.compression === true,
          biosFilenames: normaliseBiosFilenames(sys),
          shippedGames: normaliseShippedGames(sys),
        });
      }
      continue;
    }

    // No manifest yet: the persisted card names the systems, so the buttons are right on the
    // first frame. It carries no tool inputs, so an ingestable-only console stays absent until
    // the resolve lands — better than guessing an extension the publisher did not state.
    const card = row.card;
    if (!card || !isCoreKind(card.kind)) continue;
    for (const sys of card.systems ?? []) {
      if (typeof sys?.id !== "string" || sys.id === "") continue;
      push({
        targetKey: `${row.repo}#`,
        repo: row.repo,
        id: sys.id,
        folder: systemFolder(sys.id, sys.folder),
        longName: sys.longName || sys.id,
        shortName: sys.shortName || sys.longName || sys.id,
        installable: normaliseExtensions(sys.extensions),
        ingestable: normaliseExtensions(sys.ingestable),
        browse: sys.browse === "directory" ? "directory" : "file",
        compression: false,
        // The persisted card carries no BIOS data; the slots appear when the manifest resolves.
        biosFilenames: [],
        shippedGames: [],
      });
    }
  }

  if (systems.length === 0 && !hasCoreSources && declaredFolders.size === 0) return EMPTY;
  return { systems, byFolder, hasCoreSources, declaredFolders };
}

/**
 * Folder names that mark a directory as a retro-go card/ROM root when nothing has resolved yet.
 * Mirrors `romScan.ts`'s legacy list; it lives here so `isKnownConsoleDir` is one pure rule a
 * node suite can drive. Do not add to it — add a source.
 */
export const LEGACY_CONSOLE_DIRS: ReadonlySet<string> = new Set([
  "nes", "snes", "gb", "gbc", "gba", "sms", "gg", "md", "pce", "sg", "gw",
  "a2600", "a7800", "amstrad", "col", "msx", "tama", "videopac", "wsv",
]);

/**
 * Is `name` a console directory — i.e. does its presence make a folder a card/ROM root?
 *
 * DELIBERATELY NOT `byFolder`. Whether a directory is a console directory is structural: it is
 * a fact about the folder, not about which sources the user currently has switched on. Asking
 * `byFolder` (active cores only) meant a ROM folder holding just `gb/` and `gbc/` was refused at
 * pick time with "Invalid folder selected" while tgb-dual was off — and because the folder was
 * never registered, switching the core on afterwards had nothing to rescan.
 *
 * The button rule is unchanged and still follows activation: `consoleGroups` filters on
 * `byFolder`, so a deactivated core still shows no console.
 */
export function isKnownConsoleDir(name: string, reg: CoreRegistry): boolean {
  const lower = name.toLowerCase();
  if (reg.byFolder.has(lower) || reg.declaredFolders.has(lower)) return true;
  // Accept human-readable system names as folder aliases (for example `Game Boy Color`
  // alongside the canonical `gbc` folder). Matching is case-insensitive and remains limited
  // to names declared by a source.
  if ([...reg.byFolder.values()].some((sys) =>
    (sys.longName || "").toLowerCase() === lower || (sys.shortName || "").toLowerCase() === lower
  )) return true;
  if ([...reg.declaredFolders].some((folder) => folder === lower)) return true;
  // Only before anything has resolved: we cannot yet tell "the user has no cores" from "the
  // sources have not loaded", and a card that stopped being recognised mid-load is worse.
  return registryIsAuthoritative(reg) ? false : LEGACY_CONSOLE_DIRS.has(lower);
}

/**
 * Whether the registry gets to decide on its own.
 *
 * True once the user has ANY core source — active or not. An unregistered folder is then not a
 * console, which is what makes deactivating a source remove its button while its files stay on
 * disk.
 *
 * `hasCoreSources` is the half that was missing. Keying only on `systems.length > 0` meant
 * disabling your LAST core flipped the registry back to non-authoritative and handed every
 * folder to the legacy table — so turning a core OFF made its button, and every other legacy
 * console's, come back. Only a user with no core sources whatsoever gets the fallback, which is
 * the genuine "nothing has resolved yet" case a first run needs.
 */
export function registryIsAuthoritative(reg: CoreRegistry): boolean {
  return reg.systems.length > 0 || reg.hasCoreSources;
}

/** How a scanned file relates to the console whose folder it sits in. */
export type FileRole = "installable" | "ingestable" | "unknown";

/**
 * Classify one scan key (`<folder>/<file>`, or a deeper path under it) against the registry.
 * Returns `null` when no active core declares that folder at all.
 */
export function classifyForRegistry(
  reg: CoreRegistry,
  folder: string,
  extension: string,
): { system: RegisteredSystem; role: FileRole } | null {
  const lower = folder.toLowerCase();
  const sys = reg.byFolder.get(lower) ?? [...reg.byFolder.values()].find((candidate) =>
    (candidate.longName || "").toLowerCase() === lower || (candidate.shortName || "").toLowerCase() === lower
  );
  if (!sys) return null;
  const ext = extension.toLowerCase();
  if (sys.installable.includes(ext)) return { system: sys, role: "installable" };
  if (sys.ingestable.includes(ext)) return { system: sys, role: "ingestable" };
  return { system: sys, role: "unknown" };
}

/** One console button: the folder key, what to call it, and how many games are in it. */
export interface ConsoleGroup {
  system: string;
  label: string;
  count: number;
}

/**
 * THE CONSOLE BUTTONS. An active core declares the system AND the scan found files for it.
 *
 * Both halves, and neither alone. Counting files alone is the bug this replaces — a `gbc/`
 * folder produced a Game Boy Color button whether or not a GBC core was enabled. Listing the
 * registry alone would show every console the user has a core for, including empty ones.
 *
 * THIS FUNCTION FILTERS. It used to only NAME the systems it was handed, on the assumption
 * that `games` had already been gated by `parseRomPath` — which is true of folder ROMs and
 * false of the other feed: `device.installedGames` reaches `games` through the deliberately
 * ungated `parseDeviceGamePath`, so a card holding `gbc/` games manufactured a Game Boy Color
 * button no matter what Sources said. Naming without filtering was half the rule.
 *
 * A game whose console has no active core still belongs in `games` — it is on the card and must
 * stay listed and removable under the "All" filter — it just gets no button of its own.
 *
 * `labelFallback` answers for a system the registry does not carry, which now only happens
 * while the registry is not authoritative (see `registryIsAuthoritative`).
 */
export function consoleGroups(
  games: readonly { system: string }[],
  reg: CoreRegistry,
  labelFallback: (system: string) => string,
): ConsoleGroup[] {
  const authoritative = registryIsAuthoritative(reg);
  const counts = new Map<string, number>();
  for (const g of games) counts.set(g.system, (counts.get(g.system) ?? 0) + 1);
  return [...counts]
    .filter(([system]) => !authoritative || reg.byFolder.has(system.toLowerCase()))
    .map(([system, count]) => ({
      system,
      label: reg.byFolder.get(system.toLowerCase())?.shortName || labelFallback(system),
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Is a directory with these associations part of the LIBRARY, i.e. walked whole by the ROM scan?
 *
 * A directory has no declared role any more (`localFolders.svelte.ts`), so this replaces the
 * `kind: "roms"` filter that used to answer it. Two cases are in:
 *
 *   - SHARED (`usedBy` empty, "Any"). The user's general folder. This is the widening the merge
 *     is for: one shared folder now feeds cores and homebrew titles alike, instead of "Any"
 *     silently meaning "any target of whichever list I was added from".
 *   - DEDICATED TO A CORE SYSTEM. A folder registered for a core still holds ROMs and still
 *     belongs in the library, which is the rule `romFolderSources` already stated for narrowed
 *     ROM folders and which must survive the merge.
 *
 * Out: a directory dedicated ONLY to homebrew targets. Not taxonomy - COST. `romScan.ts`'s
 * `walk()` reads EVERY file it meets into memory as bytes, so a Tomb Raider install registered
 * this way would be read whole for a library that would then discard all of it as unrecognised
 * extensions. Those folders are served on demand instead, extension-filtered and with sizes from
 * metadata, by `discoveryWire.ts`'s `foldersToSearch`. That module's header records the same
 * reasoning from the other side.
 *
 * UNKNOWN TARGETS ARE OUT, not in. Before the registry resolves, a dedicated folder cannot be
 * placed; excluding it costs a moment of a shorter library, while including it costs reading a
 * game install into RAM. The exclusion is self-correcting: `romFolderSignature` is derived from
 * this function's own output, so a resolving registry changes the signature and triggers a
 * rescan.
 */
export function isLibrarySource(reg: CoreRegistry, usedBy: readonly string[]): boolean {
  if (usedBy.length === 0) return true;
  // A FOLDER MARKED FOR BIOS IS IN, whatever else it is marked for. The cost rule above is about
  // reading a game install into RAM for nothing; a BIOS folder is the opposite case, a handful of
  // small files the user has explicitly said are wanted. It also has to be in for the marking to
  // mean anything: `biosState` finds candidates in the folder scan, so a folder that is never
  // scanned can never offer one.
  if (usedBy.some(isBiosUsedBy)) return true;
  return usedBy.some((key) => ownedSystems(reg, key).length > 0);
}

/**
 * The registered systems one association key names.
 *
 * A system-scoped key (`...@gbc`) names exactly that system; a bare target key names EVERY
 * system of that target, which is what a row persisted before the picker listed systems means
 * and must keep meaning. See `types.ts` for the two shapes.
 */
function ownedSystems(reg: CoreRegistry, key: string): RegisteredSystem[] {
  const target = targetOf(key);
  const system = systemOf(key);
  return reg.systems.filter(
    (s) => s.targetKey === target && (system === undefined || s.id === system),
  );
}

/**
 * WHERE A DEDICATED SOURCE FOLDER'S LOOSE FILES BELONG.
 *
 * The owner registers folders two ways and both must work: a general ROM folder holding
 * `doom/DOOM.WAD`, and a folder registered FOR a core whose contents are the ROMs themselves,
 * with no console directory inside it. `usedBy` is what tells them apart.
 *
 * ONE SYSTEM IS A FOLDER; SEVERAL SYSTEMS ARE A MAP. This is the shape the bug was: he
 * registered `Gameboy/` for gb AND gbc and saw nothing, because a folder holding both `.gb` and
 * `.gbc` files has no single answer and the old code returned none at all rather than one per
 * file. A single string cannot place that folder. So:
 *
 *   - Exactly one system: `fallback`, and EVERY loose file takes it, whatever its extension.
 *     That is the older single-system rule kept verbatim, and it is why a cover or a `.txt` in
 *     a Doom folder still lands beside its WADs.
 *   - Several systems: `byExtension`, and each file takes the console that CLAIMS its
 *     extension. A file whose extension no system claims stays where it is.
 *
 * AN EXTENSION TWO OF THEM CLAIM IS REFUSED, NOT GUESSED. If gb and gbc both declared `.bin`,
 * placing it under whichever sorted first would file ROMs under the wrong console silently and
 * permanently. It is dropped from the map instead, so those files stay unplaced and visibly
 * missing rather than invisibly wrong. Two systems that claim the same extension AND resolve to
 * the same folder are not a conflict -- the destination is not in doubt.
 *
 * A BARE TARGET KEY (persisted before the picker listed systems) means every system that target
 * declares, so it now takes the same per-extension answer. That is a deliberate change: it is
 * the same folder holding the same files, and the alternative is leaving those users with the
 * empty library this function exists to fix. Their signature moves once and they rescan once.
 *
 * "Any" (empty `usedBy`) and an unresolved target still get NOTHING: a general folder's own
 * subdirectories already say the console, and an unknown target cannot be placed at all.
 */
export interface LooseFilePlacement {
  /**
   * Every loose file goes here. Set ONLY when the folder resolves to exactly one system, where
   * there is nothing to decide per file.
   */
  fallback?: string;
  /**
   * Lowercased dot-extension -> the console folder that claims it. Set when the folder serves
   * SEVERAL systems. Mutually exclusive with `fallback`: a fallback would swallow every
   * extension and make this dead weight.
   */
  byExtension?: Readonly<Record<string, string>>;
  /**
   * Lowercased FILENAME -> the folder that claims it. Beats both rules above, because it is the
   * only one resting on a published fact rather than on inference: a core declares the exact
   * names its BIOS slots accept, so a loose `syscard3.pce` is a System Card by declaration, not
   * by guess.
   *
   * Set when a folder is marked for BIOS. It is what makes that marking survive the folder ALSO
   * being marked for a console: without it the console took every loose file, and a BIOS dropped
   * beside the ROMs was filed as a ROM and never offered to the slot that asked for it.
   */
  byFilename?: Readonly<Record<string, string>>;
}

/** Every distinct system these association keys name, deduped across keys. */
function placedSystems(reg: CoreRegistry, usedBy: readonly string[]): RegisteredSystem[] {
  const seen = new Set<string>();
  const out: RegisteredSystem[] = [];
  for (const key of usedBy) {
    for (const sys of ownedSystems(reg, key)) {
      const id = `${sys.targetKey}@${sys.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(sys);
    }
  }
  return out;
}

export function dedicatedFolderPlacement(
  reg: CoreRegistry,
  usedBy: readonly string[],
): LooseFilePlacement | null {
  // Both "Any" (no keys at all) and a target the registry cannot resolve land here owning no
  // system, and neither can be placed: a general folder's own subdirectories already say the
  // console, and an unknown target has no console to say.
  const systems = placedSystems(reg, usedBy);

  // MARKED FOR BIOS: every filename an active core declares for a BIOS slot is placed under
  // `bios/`. That is what makes the marking self-executing rather than a label -- `biosState`
  // recognises a candidate by the folder key `bios/…` (`isBiosFolderKey`), so placing them there
  // is the whole mechanism, with nothing in the BIOS code needing to know this option exists.
  //
  // BY NAME, AND THAT IS THE FIX. This used to fire only when the folder was marked for BIOS and
  // NOTHING ELSE, on the reasoning that a console should win its own loose files and that
  // deciding per file "would need a rule nothing states". There IS such a rule and the manifest
  // states it: PCE-GO declares `filename: ["syscard3.pce", "syscard3.bin"]`. So the owner marked
  // directories that already served consoles as also serving BIOS, dropped `syscard3.pce` in
  // one, and the console took it: it was filed `pce/syscard3.pce`, which `isBiosFolderKey`
  // rejects, so PCE-GO went on reporting its System Card missing with the file sitting right
  // there. The name is a published fact, not an inference, and a loose file called exactly what
  // a slot asks for is that BIOS.
  //
  // Everything the folder's consoles claim is still theirs; only these exact names are taken.
  const biosNames = usedBy.some(isBiosUsedBy) ? declaredBiosFilenames(reg) : {};
  const hasBiosNames = Object.keys(biosNames).length > 0;

  // Marked for BIOS and nothing else: there is no console to claim the rest, so everything loose
  // in it is a BIOS file, including one whose name no core happens to declare.
  if (systems.length === 0 && usedBy.some(isBiosUsedBy)) return { fallback: "bios" };

  if (systems.length === 0) return null;
  if (systems.length === 1) {
    return hasBiosNames
      ? { fallback: systems[0]!.folder, byFilename: biosNames }
      : { fallback: systems[0]!.folder };
  }

  // Both sets are files that BELONG to the system on disk: what ships as it is, and what a
  // converter eats (Doom's `.wad` is a real library ROM under the Doom core). `outputExtension`
  // is deliberately not here -- it names what a conversion PRODUCES, and placing a file the
  // user has not got is not a layout fact.
  const byExtension: Record<string, string> = {};
  const conflicted = new Set<string>();
  for (const sys of systems) {
    for (const ext of [...sys.installable, ...sys.ingestable]) {
      const claimed = byExtension[ext];
      if (claimed !== undefined && claimed !== sys.folder) {
        conflicted.add(ext);
        continue;
      }
      byExtension[ext] = sys.folder;
    }
  }
  for (const ext of conflicted) delete byExtension[ext];
  if (Object.keys(byExtension).length === 0) return hasBiosNames ? { byFilename: biosNames } : null;
  return hasBiosNames ? { byExtension, byFilename: biosNames } : { byExtension };
}

/**
 * Every BIOS filename the registry's systems declare, mapped to `bios/`.
 *
 * Across ALL registered systems rather than only the folder's own: a user keeps one BIOS
 * directory for everything, and the slot that wants `syscard3.pce` belongs to PC Engine CD
 * whether or not the folder was also marked for PC Engine.
 */
function declaredBiosFilenames(reg: CoreRegistry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sys of reg.systems) {
    for (const name of sys.biosFilenames) out[name] = "bios";
  }
  return out;
}

/**
 * The console folder one loose file takes, or null for "leave it where it is".
 *
 * The extension is read from the map key, which for a zipped ROM is already the INNER file name
 * (`romScan.ts` keys `Aladdin.zip` under the `.gb` it holds). So this needs no zip knowledge:
 * reading the archive name instead would see `.zip`, claim nothing, and lose the owner's entire
 * 375-archive library.
 */
export function looseFileFolder(placement: LooseFilePlacement, name: string): string | null {
  // FIRST, and deliberately: an exact declared name outranks both the single-console fallback
  // and the per-extension split. `syscard3.pce` carries a PC Engine extension and is not a game.
  const named = placement.byFilename?.[name.toLowerCase()];
  if (named) return named;
  if (placement.fallback) return placement.fallback;
  const dot = name.lastIndexOf(".");
  // `dot <= 0` is "no extension" and also a leading-dot name, which has none either.
  if (dot <= 0) return null;
  return placement.byExtension?.[name.slice(dot).toLowerCase()] ?? null;
}

/**
 * A placement as a string, for `romFolderSignature`.
 *
 * MINIMAL AND SORTED, both load-bearing. Sorted so a registry that resolves its systems in a
 * different order does not read as a change and rescan the library for nothing. Minimal so the
 * single-system case still serializes to the bare folder name it always did -- every existing
 * dedicated folder keeps the signature it has, and only the multi-system folders this fix
 * actually changes get their one rescan.
 */
export function placementToken(placement: LooseFilePlacement | undefined): string {
  if (!placement) return "";
  // `byFilename` is part of the token, not decoration: it changes when a core is activated or
  // its manifest resolves, and that genuinely changes where a loose file lands. Left out, a
  // library scanned before the core resolved would keep its stale placement until something
  // else happened to move the signature.
  const named = Object.entries(placement.byFilename ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, folder]) => `${name}>${folder}`)
    .join(",");
  const suffix = named ? `|${named}` : "";
  // MINIMAL WHEN THERE IS NOTHING NAMED, so every folder whose layout did not change keeps the
  // signature it had and does not rescan on upgrade.
  if (placement.fallback) return `${placement.fallback}${suffix}`;
  return Object.entries(placement.byExtension ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ext, folder]) => `${ext}>${folder}`)
    .join(",") + suffix;
}
