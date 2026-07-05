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
import { roms } from "./roms.svelte.js";
import { nativeFolderPickerSupported } from "./romScan.js";
import { device } from "./device.svelte.js";
import { consoleLabel } from "./engine/consoles.js";
import { HOMEBREW_TITLES } from "./engine/homebrew.js";

const CONSOLE_WHITELISTS: Record<string, Set<string>> = {
  nes: new Set([".nes", ".fds", ".nsf"]),
  snes: new Set([".sfc", ".smc"]),
  gb: new Set([".gb", ".gbc"]),
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

export function parseRomPath(path: string): { system: string, name: string } | null {
  const parts = path.split("/");
  const filename = parts.pop();
  if (!filename || isDsStore(path)) return null;

  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null; // No extension
  const ext = filename.slice(dot).toLowerCase();

  // The top-level directory must be the console shortname (e.g. 'nes/mario.nes' or 'nes/hacks/mario.nes')
  if (parts.length === 0) return null;
  const topDir = parts[0].toLowerCase();
  const governingConsole = CONSOLE_WHITELISTS[topDir] ? topDir : null;

  if (!governingConsole) return null;

  const whitelist = CONSOLE_WHITELISTS[governingConsole];
  if (!whitelist.has(ext)) return null;

  let system = governingConsole;
  
  // Special overriding rules based on file extension
  if (ext === ".gbc") system = "gbc";
  if (ext === ".gb") system = "gb";

  return { system, name: filename };
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
}

export interface SystemGroup {
  system: string;
  label: string;
  count: number;
}

// Systems that aren't user-selectable emulated games: bios assets, and homebrew (native apps whose
// on-device files are GENERATED — engine .bin + restool assets — so they don't map to folder ROMs
// and must NOT be flagged as removable "on device only" games; see engine/homebrew.ts).
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

// Confirmed on real hardware (both flash and SD): despite there being a dedicated cheats/
// directory convention in older assumptions, the firmware actually expects cheat files
// DIRECTLY NEXT TO the ROM — same directory, same base name, cheat extension. So a cheat
// file's path looks identical in structure to a game's (e.g. "nes/Super Mario Bros. 3.ggcodes"
// sits right next to "nes/Super Mario Bros. 3.nes") and can only be told apart by extension.
const CHEAT_EXTENSIONS = new Set(["ggcodes", "pceplus", "mcf"]);

/** Classify a userRoms-map path (e.g. "nes/mario.nes", "bios/msx.rom",
 *  "covers/homebrew/Celeste.img") by its top-level directory (cheat files are the one
 *  exception — recognized by extension, since they live next to the ROM, not under a
 *  separate directory). Does NOT special-case "<console>_bios"-style per-console bios
 *  folders — that's a single caller's concern (see the endsWith("_bios") check next to
 *  this function's one call site that needs it). */
export function classifyContentPath(path: string): ClassifiedContentPath {
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

class RomSelectionStore {
  /** Explicit user choices by game key; a key absent here follows the default (installed). */
  private overrides = new SvelteMap<string, boolean>();

  /** Per-key user toggles for Homebrew titles. If no override exists, the title is selected if it is on the device (or if it's 'celeste'). */
  private homebrewOverrides = new SvelteMap<string, boolean>();

  /** Set of unrecognized homebrew filenames the user chose to remove. */
  readonly deletedUnknownHomebrew = new SvelteSet<string>();

  isHomebrewSelected(key: string): boolean {
    const o = this.homebrewOverrides.get(key);
    if (o !== undefined) return o;

    const hb = HOMEBREW_TITLES.find((t) => t.key === key);
    if (!hb) return false;
    const deviceHomebrew = device.installedGames.filter((g) => g.system === "homebrew").map((g) => g.name);
    return hb.deviceFiles.every((f) => deviceHomebrew.includes(f));
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

  get selectedHomebrewKeys(): Set<string> {
    const keys = new Set<string>();
    for (const hb of HOMEBREW_TITLES) {
      if (this.isHomebrewSelected(hb.key)) keys.add(hb.key);
    }
    return keys;
  }

  /** Folder ROMs ∪ device-installed games (excludes `bios/` assets — not games). */
  readonly games: Game[] = $derived.by(() => {
    const byKey = new Map<string, Game>();
    const folder = roms.scan?.userRoms;
    if (folder) {
      for (const [path, data] of folder) {
        const topSys = path.slice(0, path.indexOf("/"));
        if (classifyContentPath(path).category !== "game" || topSys.endsWith("_bios")) continue;

        const parsed = parseRomPath(path);
        if (!parsed) continue;

        byKey.set(path, { key: path, system: parsed.system, name: parsed.name, size: data.length, inFolder: true, installed: false });
      }
    }
    
    for (const g of device.installedGames) {
      if (isNonGameSystem(g.system)) continue; // homebrew/bios preserved separately, not games
      const path = `${g.system}/${g.name}`;
      const parsed = parseRomPath(path);
      if (!parsed) continue; // consistency with the folder side
      
      const key = path;
      const existing = byKey.get(key);
      if (existing) existing.installed = true;
      else byKey.set(key, { key, system: parsed.system, name: parsed.name, size: g.size, inFolder: false, installed: true });
    }
    return [...byKey.values()].sort((a, b) => {
      const normalize = (k: string) => k.toLowerCase().replace(/(^|\/)the\s+/g, "$1");
      const aNorm = normalize(a.key);
      const bNorm = normalize(b.key);
      return aNorm < bNorm ? -1 : aNorm > bNorm ? 1 : 0;
    });
  });

  /** Systems present (folder or device), with display labels + game counts. */
  readonly systems: SystemGroup[] = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const g of this.games) counts.set(g.system, (counts.get(g.system) ?? 0) + 1);
    return [...counts]
      .map(([system, count]) => ({ system, label: consoleLabel(system), count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

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

  /** Check every in-folder game not yet on the device. */
  selectAllMissing(): void {
    for (const g of this.games) if (g.inFolder && !g.installed) this.overrides.set(g.key, true);
  }

  /** Select/deselect a whole console. */
  setSystem(system: string, on: boolean): void {
    for (const g of this.games) if (g.system === system) this.overrides.set(g.key, on);
  }

  /** userRoms map for the build: selected in-folder games + ALL user-supplied `bios/` assets. */
  selectedFolderRoms(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    const folder = roms.scan?.userRoms;
    if (!folder) return out;
    const sel = this.selectedKeys;
    for (const [path, data] of folder) {
      const cat = classifyContentPath(path).category;
      // Always include bios assets; include selected games. Homebrew folder sources (e.g.
      // zelda3.sfc) are NOT packed raw — they need restool (deferred) — and on-device homebrew is
      // preserved separately by the install (readGameData).
      if (cat === "bios" || cat === "cheat" || cat === "cover" || sel.has(path)) out.set(path, data);
    }
    return out;
  }
}

export const romSelection = new RomSelectionStore();
