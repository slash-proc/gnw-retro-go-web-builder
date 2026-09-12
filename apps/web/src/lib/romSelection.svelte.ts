/**
 * ROM selection model — the unified game list (folder ∪ device) + which games are
 * selected for install. Shared between the "Select games" table and the Install ROMs
 * flow so both read the same selection.
 *
 * Default selection = the games currently INSTALLED on the device (pre-selected, so a
 * plain re-install keeps what's there). User toggles are stored as per-key overrides:
 * they persist across re-scans (stale keys for absent games are simply ignored), and a
 * key with no override follows the installed default — which stays reactive to rescans.
 */
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { shouldSkipRomsFile, isDsStore } from "@gnw/fs-builders";
import { library } from "./library.svelte.js";
import { nativeFolderPickerSupported, type LibraryFile } from "./romScan.js";
import { device } from "./device.svelte.js";
import { consoleLabel } from "./engine/consoles.js";
import { homebrew } from "./sources/homebrewTitles.svelte.js";
import { basePath } from "./sources/libraryScan.js";
import { coreRegistry } from "./sources/coreRegistry.svelte.js";
import {
  classifyForRegistry,
  consoleGroups,
  registryIsAuthoritative,
  type CoreRegistry,
  type FileRole,
} from "./sources/coreRegistry.js";
import { planNames, firstCollisionError, type NameCollision, type PlannedName } from "./sources/outputNames.js";
import { buildGameRows, selectionKeyFor, type GameRow } from "./sources/gameRows.js";
import { prepareState } from "./sources/prepareState.svelte.js";
import { variantHints } from "./sources/discoveryWire.svelte.js";
import { type ConverterError } from "./sources/converterTypes.js";

/**
 * LEGACY FALLBACK ONLY — not the source of truth any more.
 *
 * This table used to BE the gate: `<dir>/<file>` was a game only if `<dir>` appeared here and
 * the extension was in its set. Nothing consulted the user's Sources, so a `gbc/` folder
 * produced a Game Boy Color console whether or not a GBC core was enabled, and a core the
 * table had never heard of (Doom) could not produce a console at all.
 *
 * `sources/coreRegistry.ts` is the source of truth now. This survives for exactly two cases,
 * both of which the registry genuinely cannot answer:
 *
 *   1. NO active core is registered — nothing has resolved yet, or the user has none. We
 *      cannot tell those apart from "the user disabled everything", so the library keeps
 *      behaving as it did rather than going blank.
 *   2. A system that is on the DEVICE but not in Sources. `device.installedGames` can hold
 *      `gbc/` games for a core the user has since disabled; they still need a name and must
 *      still be listed as removable.
 *
 * Do not add a console here. Add a source.
 */
const CONSOLE_WHITELISTS: Record<string, Set<string>> = {
  nes: new Set([".nes", ".fds", ".nsf"]),
  snes: new Set([".sfc", ".smc"]),
  gb: new Set([".gb", ".gbc"]),
  // `.agb` alongside `.gba` because both spellings are in the wild for the same dump.
  gba: new Set([".gba", ".agb"]),
  gbc: new Set([".gb", ".gbc"]),
  sms: new Set([".sms"]),
  gg: new Set([".gg"]),
  md: new Set([".md", ".gen", ".smd", ".bin"]),
  pce: new Set([".pce"]),
  sg: new Set([".sg"]),
  gw: new Set([".gw"]),
  col: new Set([".col", ".rom"]),
  wsv: new Set([".wsv", ".sv", ".bin"]),
  msx: new Set([".msx", ".rom", ".dsk", ".mx1", ".mx2", ".cdk", ".cas"]),
  a2600: new Set([".a26", ".bin"]),
  a7800: new Set([".a78", ".bin"]),
  amstrad: new Set([".dsk", ".cdk", ".cdt", ".sna"]),
  videopac: new Set([".bin"]),
  tama: new Set([".b", ".bin"]),
  mini: new Set([".min"]),
  pico8: new Set([".p8", ".png"])
};

/** What `parseRomPath` decided a file is. `role` is what step 5's Prepare action hangs off. */
export interface ParsedRom {
  system: string;
  name: string;
  /**
   * "installable" — goes to the device as it is.
   * "ingestable"  — belongs to this console but must be converted first (Doom's `.wad`); it is
   *                 a real Library ROM and is NEVER copied to the card.
   * Legacy-table matches are always "installable": that table only ever listed device formats.
   */
  role: FileRole;
}

/**
 * Which console a scanned file belongs to, if any — registry first, legacy table second.
 *
 * `reg` is injected so a node suite can drive the real rule with a plain object; the callers in
 * this module pass the live `coreRegistry.current`.
 */
/**
 * True when pressing a row's action button will ADD that row's bytes to the install set, so the
 * press has to be checked against the remaining space first.
 *
 * The action labels name the PENDING OUTCOME, not the current state: a row already selected reads
 * `install` (that is what will happen), and pressing it DESELECTS. So only `not installed` adds.
 *
 * Gating `install` on a space check double-counted the row: `currentEstSize` already includes
 * every selected title, so asking "does adding this fit?" on the deselect press summed the same
 * bytes twice, raised the space alert, and returned before the toggle ever ran. The button then
 * looked stuck, and the alert made it look like the app was trying to add the title again.
 * Freeing space can never need permission.
 */
export function pressAddsBytes(label: string): boolean {
  return label === "not installed";
}

export function parseRomPath(key: string, reg: CoreRegistry = coreRegistry.current): ParsedRom | null {
  // `key` may be a LIBRARY KEY, not a path: a second folder holding a different file under the
  // same name is kept under `<path>\0<id>` (see sources/libraryScan.ts). The id is internal, so
  // everything below — the extension, the console directory, the displayed `name` — is derived
  // from the real path. `basePath` is a no-op for every ordinary key.
  const path = basePath(key);
  const parts = path.split("/");
  const filename = parts.pop();
  if (!filename || isDsStore(path)) return null;

  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null; // No extension
  const ext = filename.slice(dot).toLowerCase();

  // The top-level directory must be the console shortname (e.g. 'nes/mario.nes' or 'nes/hacks/mario.nes')
  if (parts.length === 0) return null;
  const topDir = parts[0].toLowerCase();

  // THE REGISTRY FIRST. An active core that declares this folder decides both whether the file
  // counts and what it is; `role` is how a `.wad` becomes a Library ROM without ever becoming
  // something the installer may copy.
  const hit = classifyForRegistry(reg, topDir, ext);
  if (hit) {
    return hit.role === "unknown" ? null : { system: hit.system.folder, name: filename, role: hit.role };
  }

  // Registered cores exist and none of them claims this folder: it is not a console. This is
  // the line that makes disabling a source remove its button while the files stay on disk.
  // Only when NOTHING is registered does the legacy table still answer — see its comment.
  if (registryIsAuthoritative(reg)) return null;

  const governingConsole = CONSOLE_WHITELISTS[topDir] ? topDir : null;

  if (!governingConsole) return null;

  const whitelist = CONSOLE_WHITELISTS[governingConsole];
  if (!whitelist.has(ext)) return null;

  let system = governingConsole;
  
  // Special overriding rules based on file extension
  if (ext === ".gbc") system = "gbc";
  if (ext === ".gb") system = "gb";

  return { system, name: filename, role: "installable" };
}

/**
 * The same parse for a game the DEVICE reports, which is deliberately NOT gated on the
 * registry.
 *
 * A card can hold `gbc/` games put there by a core the user has since disabled. They are on
 * the device, so they are real, they must stay listed, and they must stay removable — hiding
 * them would mean the user could no longer get rid of them. Sources decide what may be ADDED;
 * the device decides what is already THERE.
 */
export function parseDeviceGamePath(path: string): ParsedRom | null {
  const parts = basePath(path).split("/");
  const filename = parts.pop();
  if (!filename || parts.length === 0 || isDsStore(path)) return null;
  if (filename.lastIndexOf(".") < 0) return null;
  return { system: parts[0].toLowerCase(), name: filename, role: "installable" };
}

export interface Game {
  /** "<system>/<name>" — also the folder userRoms key for in-folder games. */
  key: string;
  system: string;
  name: string;
  /** Raw bytes (folder size if in-folder, else the on-device size). */
  size: number;
  inFolder: boolean;
  installed: boolean;
  /**
   * "installable" — ready for the device. "ingestable" — a converter's input (a Doom `.wad`):
   * a real Library file that is NEVER copied to the card. `sources/gameRows.ts` collapses an
   * ingestable and the output it becomes into ONE row.
   */
  role: FileRole;
}

export interface SystemGroup {
  system: string;
  label: string;
  count: number;
}

// Systems that aren't user-selectable emulated games: bios assets, and homebrew (native apps whose
// on-device files are GENERATED — engine .bin + converter assets — so they don't map to folder ROMs
// and must NOT be flagged as removable "on device only" games; see
// sources/homebrewTitles.svelte.ts).
const NON_GAME_SYSTEMS = new Set(["bios", "homebrew", "cheats", "covers"]);

export function isNonGameSystem(system: string): boolean {
  return NON_GAME_SYSTEMS.has(system);
}

export type ContentCategory = "game" | "bios" | "cheat" | "cover" | "homebrew";

export interface ClassifiedContentPath {
  category: ContentCategory;
  /** Only set for category "cover": true if this is the device-ready .img format
   *  (vs. a raw source PNG/JPG kept only for local UI display — see convertCoversInMap). */
  isDeviceCover?: boolean;
  /** Only set for category "cover" paths under covers/homebrew/: the homebrew title's
   *  displayName this cover belongs to (matches HomebrewTitle.displayName). */
  homebrewCoverName?: string;
}

// Cheat files live under their own cheats/<system>/ tree (the firmware joins the ROM path,
// minus its "/roms" prefix, onto ODROID_BASE_PATH_CHEATS = "/cheats"). They are still
// classified by EXTENSION rather than by prefix, because this runs over user-supplied folders
// too, where a cheat file may sit next to its ROM — that is a fine thing to accept as INPUT;
// cheatFilePath() is what decides where it lands on the device.
const CHEAT_EXTENSIONS = new Set(["ggcodes", "pceplus", "mcf"]);

/** Classify a userRoms-map path (e.g. "nes/mario.nes", "bios/msx.rom",
 *  "covers/homebrew/Celeste.img") by its top-level directory (cheat files are the one
 *  exception — recognized by extension, so they classify wherever the user keeps them). Does NOT special-case "<console>_bios"-style per-console bios
 *  folders — that's a single caller's concern (see the endsWith("_bios") check next to
 *  this function's one call site that needs it). */
export function classifyContentPath(key: string): ClassifiedContentPath {
  // Library keys again (see parseRomPath): classify the real path, never the internal id.
  const path = basePath(key);
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (CHEAT_EXTENSIONS.has(ext)) return { category: "cheat" };
  const topSys = path.slice(0, path.indexOf("/"));
  switch (topSys) {
    case "bios":
      return { category: "bios" };
    case "homebrew":
      return { category: "homebrew" };
    case "covers":
      return {
        category: "cover",
        isDeviceCover: path.endsWith(".img"),
        homebrewCoverName: path.startsWith("covers/homebrew/")
          ? path.slice("covers/homebrew/".length, path.lastIndexOf("."))
          : undefined,
      };
    default:
      return { category: "game" };
  }
}

/**
 * The title a path belongs to, as `<folder>/<stem>` lowercased — `covers/nes/Mario.png` and
 * `nes/Mario.nes` both yield `nes/mario`, which is what lets a cover be matched to its game
 * without either side knowing the other's extension. A `covers/` prefix is stripped first, so
 * the art and the thing it depicts land on the same string. FAT cannot tell `Mario` from
 * `MARIO` (gwrg-dist-spec 930517c), so neither does this.
 */
export function coverOwnerOf(key: string): string {
  const path = basePath(key);
  const rest = path.startsWith("covers/") ? path.slice("covers/".length) : path;
  const cut = rest.lastIndexOf(".");
  return (cut > rest.lastIndexOf("/") ? rest.slice(0, cut) : rest).toLowerCase();
}

class RomSelectionStore {
  /** Explicit user choices by game key; a key absent here follows the default (installed). */
  private overrides = new SvelteMap<string, boolean>();

  /**
   * Per-key user toggles for Homebrew titles. With no override, a title is selected iff it is
   * COMPLETE on the device — every one of its device files present. (This used to also
   * hardcode "celeste" as always-on; being self-contained is now a manifest-derived property
   * of a title, not a name this app knows.)
   */
  private homebrewOverrides = new SvelteMap<string, boolean>();

  /** Set of unrecognized homebrew filenames the user chose to remove. */
  readonly deletedUnknownHomebrew = new SvelteSet<string>();

  isHomebrewSelected(key: string): boolean {
    const o = this.homebrewOverrides.get(key);
    if (o !== undefined) return o;

    const hb = homebrew.find(key);
    if (!hb) return false;
    const deviceHomebrew = device.installedGames.filter((g) => g.system === "homebrew").map((g) => g.name);
    return homebrew.isComplete(hb, deviceHomebrew);
  }

  toggleHomebrew(key: string, force?: boolean): void {
    if (force !== undefined) {
      this.homebrewOverrides.set(key, force);
    } else {
      this.homebrewOverrides.set(key, !this.isHomebrewSelected(key));
    }
  }

  removeUnknownHomebrew(filename: string): void {
    this.deletedUnknownHomebrew.add(filename);
  }

  /**
   * The selected HOMEBREW titles. A core is excluded, and that exclusion is the fix for a bug
   * the owner hit twice.
   *
   * `homebrew.titles` is "targets with something to prepare", so it holds cores too
   * (`HomebrewTitle.isCore`). But a core's content is not a title: its games are real ROMs
   * under its own console, collapsed into GAME ROWS by `sources/gameRows.ts`, and
   * `RomManagementTab` filters cores out of the Homebrew group for exactly that reason. So a
   * core has no selectable homebrew row, and nothing the user can click writes
   * `homebrewOverrides` for one.
   *
   * `runPrepare()` did write one -- it force-selects a title after a successful run -- and with
   * a core in this set two things followed, both unreachable afterwards:
   *
   *   1. `hbAdditionsBytes` added `getHomebrewSize(coreKey)`, which is `preparedBytesFor` --
   *      the WHOLE prepared run. Preparing Doom put every `.whd` byte into the net change at
   *      once (the owner saw +21.98 MB) and no row toggle could move it, because a row toggle
   *      writes `overrides`, not `homebrewOverrides`. Clearing the cache was the only way out,
   *      which is precisely the workaround he reported.
   *   2. `selectedAssets.ts` treats a selected title as wanting every key it `produced`, so a
   *      core's converted outputs shipped whatever the rows said -- the same hole that fix
   *      closed for rows, still open one level up.
   *
   * SHIPPING IS UNAFFECTED, which is what makes this the safe cut. The packer prunes on this
   * set only under the homebrew prefix (`fs-builders/src/flashImage.ts`, step 2.5), and a
   * core's binaries are placed under `paths.cores` (`sources/placement.ts`), so this set never
   * governed them. Its engine binary is an `artifact`, which `selectedPreparedAssets` keeps
   * unconditionally, and the bundle's own cores are governed by `installAllCores`.
   */
  get selectedHomebrewKeys(): Set<string> {
    const keys = new Set<string>();
    for (const hb of homebrew.titles) {
      if (hb.isCore) continue;
      if (this.isHomebrewSelected(hb.key)) keys.add(hb.key);
    }
    return keys;
  }

  /** Folder ROMs ∪ device-installed games (excludes `bios/` assets — not games). */
  readonly games: Game[] = $derived.by(() => {
    const byKey = new Map<string, Game>();
    const folder = library.scan?.userRoms;
    if (folder) {
      for (const [path, data] of folder) {
        const topSys = path.slice(0, path.indexOf("/"));
        if (classifyContentPath(path).category !== "game" || topSys.endsWith("_bios")) continue;

        const parsed = parseRomPath(path);
        if (!parsed) continue;

        byKey.set(path, { key: path, system: parsed.system, name: parsed.name, size: data.length, inFolder: true, installed: false, role: parsed.role });
      }
    }
    
    // GAMES THE PROJECT SHIPS (spec/07-cores.md, "A project may ship a game itself"). Doom's
    // shareware episode is the case: redistributable, published beside the manifest, and
    // playable with nothing supplied by the user. It is an ORDINARY ROM ROW -- `installable`,
    // no converter, no prepare step, no file prompt -- because that is what it already is. The
    // only thing separating it from a ROM in the user's folder is that its bytes are fetched
    // rather than read off disk, and `gameRows.ts` already says a row with no input is keyed
    // and named by its installable file.
    //
    // ADDED BEFORE the device pass and only when the key is free, so the user's OWN copy always
    // wins: a converted `.whd` sitting in the folder keeps its `inFolder` entry, and the device
    // pass below still marks the row installed. Doom leans on this deliberately -- its shipped
    // entry takes the SAME filename its `variants[]` table gives that dump, so converting the
    // shareware WAD yourself overwrites the shipped copy instead of producing a second row.
    for (const sys of coreRegistry.current.systems) {
      for (const game of sys.shippedGames) {
        const key = `${sys.folder}/${game.filename}`;
        if (byKey.has(key)) continue;
        byKey.set(key, {
          key,
          system: sys.folder,
          name: game.filename,
          // The manifest's declared size. Every other row's size is the real byte count, and
          // this is the only number available before the fetch -- the spec requires it exactly
          // so a host can weigh an install without downloading first.
          size: game.bytes,
          inFolder: false,
          installed: false,
          role: "installable",
        });
      }
    }

    for (const g of device.installedGames) {
      if (isNonGameSystem(g.system)) continue; // homebrew/bios preserved separately, not games
      const path = `${g.system}/${g.name}`;
      // NOT `parseRomPath`: a game already on the card stays listed and removable even when no
      // active source declares its console. See `parseDeviceGamePath`.
      const parsed = parseDeviceGamePath(path);
      if (!parsed) continue; // consistency with the folder side
      
      const key = path;
      const existing = byKey.get(key);
      if (existing) existing.installed = true;
      else byKey.set(key, { key, system: parsed.system, name: parsed.name, size: g.size, inFolder: false, installed: true, role: parsed.role });
    }
    return [...byKey.values()].sort((a, b) => {
      const normalize = (k: string) => k.toLowerCase().replace(/(^|\/)the\s+/g, "$1");
      const aNorm = normalize(a.key);
      const bNorm = normalize(b.key);
      return aNorm < bNorm ? -1 : aNorm > bNorm ? 1 : 0;
    });
  });

  /**
   * ONE ENTRY PER GAME. A Doom `.wad` and the `.whd` it becomes are one row, before and after
   * the conversion — see `sources/gameRows.ts` for the pairing rule and why it costs no hash.
   * Everything the Library renders reads this; `games` stays the flat per-FILE list underneath.
   */
  readonly rows: GameRow[] = $derived.by(() =>
    buildGameRows(
      this.games,
      (system) => coreRegistry.current.byFolder.get(system.toLowerCase())?.outputExtension,
      (key) => variantHints.get(key),
      // The prepared half. A converted output never lands in the user's folder, so the scan
      // cannot see it and a row asking only the scan stayed on Prepare forever. Reading
      // `assets.size` first keeps this `$derived` subscribed to the map it depends on — the
      // same rune trap `prepareState.assets` is reassigned for.
      (system, outputName) =>
        prepareState.assets.size > 0 ? prepareState.preparedSize(system, outputName) : undefined,
    ),
  );

  /**
   * The console buttons: an ACTIVE core declares the system AND the scan found files for it.
   * See `consoleGroups` — deriving from files alone is the bug this replaces.
   *
   * Counted over ROWS, not files: a prepared Doom game is a `.wad` AND a `.whd` on disk, and
   * counting files would show `Doom 2` for one game the moment the user pressed Prepare.
   */
  readonly systems: SystemGroup[] = $derived(
    consoleGroups(this.rows, coreRegistry.current, consoleLabel),
  );

  /**
   * Whether the user has made ANY explicit choice about the game selection this session.
   *
   * `selectedKeys` cannot answer this: it is empty both for a user who unticked every row and
   * for a user who has touched nothing on a device with no games, and those two states mean
   * opposite things to anything acting on a deselection. `overrides` separates them, because
   * it is written by `toggle`, `selectAllMissing` and `setSystem` and by nothing else -- it is
   * never restored from storage and never populated by a scan, so a non-empty map is a user
   * action and an empty one is the absence of one.
   *
   * An override that merely restates the default (ticking an installed game off and back on)
   * still counts as touched. That is deliberate: it keeps the reading conservative, so the
   * only state this newly protects is the one where the user genuinely did nothing.
   *
   * Read by `sources/coreGate.ts` through `views/RomManagementTab.svelte`; see that module's
   * `selectionUntouched` for the rule it guards.
   */
  readonly selectionTouched: boolean = $derived(this.overrides.size > 0);

  /** Keys currently selected for install (override, else the installed default). */
  readonly selectedKeys: Set<string> = $derived.by(() => {
    const out = new Set<string>();
    for (const g of this.games) {
      const o = this.overrides.get(g.key);
      if (o !== undefined ? o : g.installed) out.add(g.key);
    }
    return out;
  });

  /** Selected games not currently installed (will be added). */
  readonly additions: Game[] = $derived.by(() =>
    this.games.filter((g) => !g.installed && this.selectedKeys.has(g.key)),
  );
  /** Installed games no longer selected (will be dropped). */
  readonly removals: Game[] = $derived.by(() =>
    this.games.filter((g) => g.installed && !this.selectedKeys.has(g.key)),
  );
  readonly additionsBytes: number = $derived(this.additions.reduce((n, g) => n + g.size, 0));
  readonly removalsBytes: number = $derived(this.removals.reduce((n, g) => n + g.size, 0));

  /** Selected games installed on the device but absent from the folder — the install must
   *  re-read these from the device (readGameData) to preserve them. */
  readonly retainedFromDevice: Game[] = $derived.by(() =>
    this.games.filter((g) => g.installed && !g.inFolder && this.selectedKeys.has(g.key)),
  );

  isSelected(key: string): boolean {
    return this.selectedKeys.has(key);
  }

  toggle(key: string): void {
    this.overrides.set(key, !this.selectedKeys.has(key));
  }

  /**
   * The same two, for a ROW rather than a file.
   *
   * A row is one game over up to two files, and the one selection acts on is the OUTPUT -- see
   * `selectionKeyFor`. Every caller that holds a row must go through these: reading `row.key`
   * asks the converter's INPUT whether it is installed, which it never is, so an installed Doom
   * row read as unselected and toggling it moved a key nothing installs.
   */
  isRowSelected(row: Pick<GameRow, "key"> & { outputKey?: string }): boolean {
    return this.selectedKeys.has(selectionKeyFor(row));
  }

  toggleRow(row: Pick<GameRow, "key"> & { outputKey?: string }): void {
    this.toggle(selectionKeyFor(row));
  }

  /** Check every in-folder game not yet on the device. */
  selectAllMissing(): void {
    for (const g of this.games) if (g.inFolder && !g.installed) this.overrides.set(g.key, true);
  }

  /** Select/deselect a whole console. */
  setSystem(system: string, on: boolean): void {
    for (const g of this.games) if (g.system === system) this.overrides.set(g.key, on);
  }

  /**
   * The selection as a list of names the install intends to write, ready for `planNames`.
   *
   * The keys are LIBRARY keys (a doubled path carries an internal id — see
   * sources/libraryScan.ts); what the card sees is `basePath` of each, split into the directory
   * it lands in and the name it lands under. Every one is `derived`: these are all the user's
   * own files, so no publisher rank applies and the first offered keeps the name.
   */
  private plannedInstallNames(): { planned: PlannedName[]; bytes: Map<string, LibraryFile> } {
    const planned: PlannedName[] = [];
    const bytes = new Map<string, LibraryFile>();
    const folder = library.scan?.userRoms;
    if (!folder) return { planned, bytes };
    const sel = this.selectedKeys;
    // A converter's INPUT is never copied. `Game.role` has said so since gameRows.ts collapsed
    // an ingestable and its output into one row ("a real Library file that is NEVER copied to
    // the card"), but nothing enforced it: a row's identity is the INPUT's key, so selecting a
    // Doom game selected `doom/doom.wad`, and it shipped beside the `.whd` it becomes. On the
    // owner's card that was `doom.wad` + `doom2.wad`, ~27 MB, next to their own outputs.
    // Both install flows share this map, so Flash was packing them into FrogFS too.
    const ingestable = new Set(this.games.filter((g) => g.role === "ingestable").map((g) => g.key));
    const covered = this.coveredTitles();
    for (const [key, data] of folder) {
      if (ingestable.has(key)) continue;
      const cat = classifyContentPath(key).category;
      // Always include bios assets (the medium's own policy is applied downstream, in
      // biosState.filterInstall); include selected games. Homebrew folder sources (e.g.
      // a .sfc) are NOT packed raw — they go through the manifest's own converter (see
      // sources/homebrewConvert.ts) — and on-device homebrew is
      // preserved separately by the install (readGameData).
      //
      // A COVER FOLLOWS ITS TITLE. It used to ride in unconditionally, like a BIOS, and that is
      // wrong for the same reason shipping an undeclared BIOS is: art for a game that is not in
      // the image has nothing to be the art of. The owner's net-change breakdown caught it as
      // 154 cover files / 774,265 bytes entering an install with `selectedRoms: 0`.
      if (cat === "cover" && !covered.has(coverOwnerOf(key))) continue;
      // FONTS ARE NOT IN THIS LIST AND MUST NOT BE. The same net-change breakdown that caught
      // the covers showed `{category:"fonts", afterBytes:847872, afterFiles:25}` arriving with
      // nothing selected, which looks like the identical bug and is not: fonts reach the image
      // only from the firmware bundle (`planFlashImage` seeds its tree from `defaultContent`
      // unconditionally, upstream's DEFAULT_DIRS = bios/covers/fonts/roms), and a firmware that
      // cannot draw is no use. A `fonts/` key from a FOLDER classifies as "game" and needs the
      // selection like any other, which is what keeps that true. See test/coverscope.mjs.
      //
      // `cheat` is still unconditional here and has exactly the shape `cover` had before it was
      // gated -- a cheat file for a game that is not in the image has nothing to cheat at. It is
      // left alone deliberately: cheats are device-truth (see the cheats rework), so whether an
      // orphan cheat is waste or a deliberate carry-over is a question for that system, not a
      // line to change in passing.
      if (!(cat === "bios" || cat === "cheat" || cat === "cover" || sel.has(key))) continue;
      const path = basePath(key);
      const cut = path.lastIndexOf("/");
      planned.push({
        dir: cut < 0 ? "" : path.slice(0, cut),
        name: cut < 0 ? path : path.slice(cut + 1),
        origin: "derived",
        from: key,
      });
      bytes.set(key, data);
    }
    return { planned, bytes };
  }

  /**
   * The titles a cover may belong to, as `<folder>/<stem>` lowercased.
   *
   * Emulated games come from `selectedKeys`, which already counts a game sitting on the device
   * as selected unless the user turned it off — so a cover is kept for a console whose games
   * are being PRESERVED, not only for one being added. Homebrew covers live under
   * `covers/homebrew/<displayName>`, so a selected title contributes `homebrew/<displayName>`
   * and the same `<folder>/<stem>` comparison covers both without a second code path.
   */
  private coveredTitles(): Set<string> {
    const out = new Set<string>();
    for (const key of this.selectedKeys) out.add(coverOwnerOf(basePath(key)));
    for (const key of this.selectedHomebrewKeys) {
      const hb = homebrew.find(key);
      if (hb) out.add(`homebrew/${hb.displayName.toLowerCase()}`);
    }
    return out;
  }

  /**
   * userRoms map for the build: selected in-folder games + ALL user-supplied `bios/` assets,
   * keyed by the path each file actually lands under (the internal duplicate id is dropped here
   * and never reaches the packer).
   *
   * Only the entries `planNames` ACCEPTS are here. Two selected files that are one file on a
   * FAT/exFAT card cannot both be written, and this map is not where that is decided quietly —
   * `installNameError()` is the refusal, and the install flows check it before they start.
   */
  selectedFolderRoms(): Map<string, LibraryFile> {
    const { planned, bytes } = this.plannedInstallNames();
    const plan = planNames(planned);
    const out = new Map<string, LibraryFile>();
    for (const p of plan.accepted) {
      const key = p.from!;
      const data = bytes.get(key);
      if (data) out.set(basePath(key), data);
    }
    return out;
  }

  /**
   * Two selected files that would be one file on the card. Non-empty means DO NOT INSTALL.
   *
   * This is the honest end of "same name, different content": both entries are in the library
   * and both are listed, but a directory still holds one file per name. Nothing here picks a
   * winner, renames around it, or asks the user to choose — it refuses, with the same
   * `name-collision` code and the same wording every other name this app writes is refused with.
   */
  get installNameCollisions(): NameCollision[] {
    return planNames(this.plannedInstallNames().planned).collisions;
  }

  /** The throwing shape of `installNameCollisions`, for the install flows. */
  installNameError(): ConverterError | undefined {
    return firstCollisionError(planNames(this.plannedInstallNames().planned));
  }
}

export const romSelection = new RomSelectionStore();
