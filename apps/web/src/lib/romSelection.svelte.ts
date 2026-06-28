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
import { SvelteMap } from "svelte/reactivity";
import { shouldSkipRomsFile, isDsStore } from "@gnw/fs-builders";
import { roms } from "./roms.svelte.js";
import { device } from "./device.svelte.js";
import { consoleLabel } from "./engine/consoles.js";

// Non-ROM files that sneak into roms/<system>/ folders. We can't skip these by the retro-go
// extension rule: `.md` is the Mega Drive ROM extension, so a README.md collides — skip it by
// NAME instead. `.xml` (e.g. msxromdb.xml), `.txt`, etc. are never ROM extensions.
const NON_ROM_NAMES = new Set([
  "readme.md",
  "readme.txt",
  "readme",
  "license",
  "license.txt",
  "changelog.md",
]);
const NON_ROM_EXTS = new Set([
  ".xml",
  ".txt",
  ".nfo",
  ".htm",
  ".html",
  ".json",
  ".ini",
  ".url",
  ".db",
  ".log",
  ".csv",
]);

/** Only real ROM files belong in the games table — drop cover art (.png/.jpg/…), .DS_Store,
 *  README.md (the .md/Mega-Drive collision), ROM databases (msxromdb.xml), and other non-ROM
 *  files. Uses retro-go's own skip-by-extension rule (keeps PICO-8 .png carts) plus a name/ext
 *  blocklist for the cases that rule can't catch. `path` is roms-relative ("<system>/<file>").
 *  (Per-title homebrew whitelisting — "the files each homebrew looks for" — is part of the
 *  deferred homebrew/restool module; see memory romgr-install-architecture.) */
function isRomFile(romsRelPath: string): boolean {
  if (shouldSkipRomsFile("roms/" + romsRelPath) || isDsStore(romsRelPath)) return false;
  const base = romsRelPath.slice(romsRelPath.lastIndexOf("/") + 1).toLowerCase();
  if (NON_ROM_NAMES.has(base)) return false;
  const dot = base.lastIndexOf(".");
  if (dot > 0 && NON_ROM_EXTS.has(base.slice(dot))) return false;
  return true;
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
const NON_GAME_SYSTEMS = new Set(["bios", "homebrew"]);

class RomSelectionStore {
  /** Explicit user choices by game key; a key absent here follows the default (installed). */
  private overrides = new SvelteMap<string, boolean>();

  /** The set of Homebrew titles (by their HOMEBREW_TITLES key) selected for install.
   *  Initializes with "celeste" (default) plus anything currently on the device. */
  readonly selectedHomebrew = new SvelteMap<string, boolean>();

  // Initialize selectedHomebrew when device connects/scans
  initHomebrew(deviceHomebrewNames: string[], allHomebrewKeys: string[]) {
    if (this.selectedHomebrew.size > 0) return; // already init
    for (const key of allHomebrewKeys) {
      if (key === "celeste") this.selectedHomebrew.set(key, true);
      else this.selectedHomebrew.set(key, false);
    }
    // We will sync with device later if needed, or rely on caller to set
  }

  isHomebrewSelected(key: string): boolean {
    return this.selectedHomebrew.get(key) === true;
  }

  toggleHomebrew(key: string): void {
    this.selectedHomebrew.set(key, !this.selectedHomebrew.get(key));
  }

  get selectedHomebrewKeys(): Set<string> {
    return new Set([...this.selectedHomebrew.entries()].filter(([, v]) => v).map(([k]) => k));
  }

  /** Folder ROMs ∪ device-installed games (excludes `bios/` assets — not games). */
  readonly games: Game[] = $derived.by(() => {
    const byKey = new Map<string, Game>();
    const folder = roms.scan?.userRoms;
    if (folder) {
      for (const [path, data] of folder) {
        const slash = path.indexOf("/");
        if (slash < 0) continue;
        const system = path.slice(0, slash);
        if (NON_GAME_SYSTEMS.has(system)) continue;
        if (!isRomFile(path)) continue; // skip cover art / non-ROM files
        const name = path.slice(slash + 1);
        byKey.set(path, { key: path, system, name, size: data.length, inFolder: true, installed: false });
      }
    }
    for (const g of device.installedGames) {
      if (NON_GAME_SYSTEMS.has(g.system)) continue; // homebrew/bios preserved separately, not games
      if (!isRomFile(`${g.system}/${g.name}`)) continue; // consistency with the folder side
      const key = `${g.system}/${g.name}`;
      const existing = byKey.get(key);
      if (existing) existing.installed = true;
      else byKey.set(key, { key, system: g.system, name: g.name, size: g.size, inFolder: false, installed: true });
    }
    return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
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
      const system = path.split("/")[0];
      // Always include bios assets; include selected games. Homebrew folder sources (e.g.
      // zelda3.sfc) are NOT packed raw — they need restool (deferred) — and on-device homebrew is
      // preserved separately by the install (readGameData).
      if (system === "bios" || sel.has(path)) out.set(path, data);
    }
    return out;
  }
}

export const romSelection = new RomSelectionStore();
