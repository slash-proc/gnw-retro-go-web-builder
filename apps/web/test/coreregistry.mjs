#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/sources/coreRegistry.ts` — WHICH CONSOLES THE LIBRARY SHOWS.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/coreregistry.mjs'
 *
 * The rule this pins, in the owner's own words:
 *
 *   "Source exists for core informing the web-builder what extensions, folder names, etc are
 *    used for a core -> a scan of the rom folder(s) comes back informing the UI which consoles
 *    have valid ROM files and they get displayed."
 *
 * Which means the two failures that prompted it must both be impossible:
 *   - a Game Boy Color button appearing while its source is DISABLED, because a `gbc/` folder
 *     exists on disk (the old code derived consoles from folder names alone);
 *   - Doom being unable to produce a console at all, because it was not in a hardcoded table.
 *
 * Driven from the shape DOOM v0.2.0 actually publishes — `kind: "emulator"` (the spec has since
 * renamed it to `"core"`, both are accepted), one system `doom` with `.whd`, and a `doom-whd`
 * tool whose input takes `.wad`. A `.wad` is a real Library ROM under the Doom core but is
 * NEVER installable: only the `.whd` the converter produces reaches the card.
 */
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// `@gnw/*` must resolve to THIS worktree's packages, never the main clone's dist/ (CLAUDE.md).
import { gnwResolveFor } from "./gnwResolve.mjs";

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function deepEq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg}: expected ${B}, got ${A}`);
}
function ok(v, msg) { if (!v) throw new Error(msg); }

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-coreregistry-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/coreRegistry.ts")],
  outfile: join(out, "coreRegistry.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const {
  buildCoreRegistry, registryIsAuthoritative, classifyForRegistry, consoleGroups,
  dedicatedFolderPlacement, looseFileFolder, placementToken, isLibrarySource, isCoreKind, isKnownConsoleDir,
} = await import(pathToFileURL(join(out, "coreRegistry.js")).href);

await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/gameRows.ts")],
  outfile: join(out, "gameRows.js"),
  bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning",
});
const { buildGameRows, outputNameFor, stripExtension, selectionKeyFor } =
  await import(pathToFileURL(join(out, "gameRows.js")).href);

// --- Fixtures: the real DOOM v0.2.0 shape ------------------------------------------------------

/** DOOM's manifest, trimmed to the fields the registry reads. Values are the published ones. */
function doomManifest(kind = "emulator") {
  return {
    schemaVersion: 1,
    project: "doom",
    title: "Doom",
    tools: [{
      id: "doom-whd",
      binary: { file: "doom_whd.wasm", url: "doom_whd.wasm", bytes: 678369, sha256: "1e92a41a" },
      inputs: [{
        id: "base", required: true, allowMultiple: true, runPerFile: true, maxCount: 32,
        extensions: [".wad"], strict: false,
      }],
      outputs: [{ id: "whd", extension: ".whd", maxBytes: 25165824 }],
    }],
    targets: [{
      id: "gnw-retro-go",
      platform: "game-and-watch",
      kind,
      requiresAbi: { version: 2, minSize: 832 },
      artifacts: [{ filename: "doom.bin", bytes: 319068, sha256: "0e25", url: "doom.bin" }],
      // No `system` key on the use: the target has ONE system, so it is implied.
      uses: [{ tool: "doom-whd", outputs: ["whd"], required: true }],
      systems: [{
        id: "doom", longName: "Doom", shortName: "Doom",
        extensions: [".whd"], browse: "file", compression: false,
      }],
    }],
  };
}

/** A core with no converter — the shape 19 of the 21 live projects publish. */
function gbcManifest() {
  return {
    schemaVersion: 1, project: "tgb", title: "TGB Dual", tools: [],
    targets: [{
      id: "gnw-retro-go", platform: "game-and-watch", kind: "core",
      requiresAbi: { version: 2, minSize: 832 }, artifacts: [],
      systems: [
        { id: "gb", longName: "Game Boy", shortName: "Game Boy", extensions: [".gb"], browse: "file", compression: false },
        { id: "gbc", longName: "Game Boy Color", shortName: "Game Boy Color", extensions: [".gbc"], browse: "file", compression: false },
      ],
    }],
  };
}

const row = (repo, manifest, active = true) => ({ repo, active, manifest });

// --- 1. Dual-kind acceptance -------------------------------------------------------------------

await check("kind: both the spec's `core` and the published `emulator` are cores", async () => {
  ok(isCoreKind("core"), "the spec's current name");
  ok(isCoreKind("emulator"), "what DOOM v0.2.0 actually publishes — accepted during the rename");
  ok(!isCoreKind("homebrew"), "homebrew is not a core");
  ok(!isCoreKind(undefined), "a row with no card yet has no kind");
});

await check("kind: a `core` manifest registers, exactly like an `emulator` one", async () => {
  const asEmulator = buildCoreRegistry([row("slash-proc/doom", doomManifest("emulator"))]);
  const asCore = buildCoreRegistry([row("slash-proc/doom", doomManifest("core"))]);
  eq(asEmulator.systems.length, 1, "the published spelling registers");
  eq(asCore.systems.length, 1, "the spec's spelling registers");
  deepEq(asCore.systems[0].installable, asEmulator.systems[0].installable, "same either way");
});

// --- 2. The registry itself --------------------------------------------------------------------

await check("registry: a core's system carries folder, names, extensions and browse", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  const s = reg.systems[0];
  eq(s.id, "doom", "system id");
  eq(s.folder, "doom", "folder = `folder ?? id`, lowercased");
  eq(s.shortName, "Doom", "the console button's label comes from the manifest");
  deepEq(s.installable, [".whd"], "installable = systems[].extensions");
  eq(s.browse, "file", "browse mode");
  eq(s.targetKey, "slash-proc/doom#gnw-retro-go", "keyed like usedBy / HomebrewTitle.key");
});

await check("registry: `.wad` is INGESTABLE — declared by the tool, not by the system", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  deepEq(reg.systems[0].ingestable, [".wad"], "uses[] -> tools[].inputs[].extensions");
  ok(!reg.systems[0].installable.includes(".wad"), "a WAD is never installable");
});

await check("registry: a core with NO converter has no ingestable extensions", async () => {
  const reg = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);
  eq(reg.systems.length, 2, "both of the core's systems register");
  deepEq(reg.systems.map((s) => s.ingestable), [[], []], "nothing to convert");
});

await check("registry: an INACTIVE source contributes nothing but still counts as owned", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest(), false)]);
  eq(reg.systems.length, 0, "deactivating a source removes its systems");
  ok(reg.hasCoreSources, "the user still HAS a core source — they just switched it off");
  ok(registryIsAuthoritative(reg),
     "so the legacy tables must NOT answer again: turning a core off cannot add buttons");
});

await check("registry: a homebrew source is not a core", async () => {
  const hb = gbcManifest();
  hb.targets[0].kind = "homebrew";
  eq(buildCoreRegistry([row("slash-proc/celeste", hb)]).systems.length, 0, "homebrew declares no console");
});

await check("registry: the persisted card seeds it before any manifest resolves", async () => {
  const reg = buildCoreRegistry([{
    repo: "slash-proc/doom",
    active: true,
    card: {
      kind: "emulator",
      systems: [{ id: "doom", longName: "Doom", shortName: "Doom", extensions: [".whd"], ingestable: [".wad"] }],
    },
  }]);
  eq(reg.systems.length, 1, "the console row is right on the first frame");
  deepEq(reg.systems[0].ingestable, [".wad"], "the card carries the converter inputs too");
});

// --- 3. THE OWNER'S COMPLAINT: a disabled source must lose its button ---------------------------

await check("BUTTONS: an active core's declared system produces a button", async () => {
  const reg = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);
  const games = [{ system: "gbc" }, { system: "gbc" }];
  const groups = consoleGroups(games, reg, () => "FALLBACK");
  deepEq(groups, [{ system: "gbc", label: "Game Boy Color", count: 2 }], "named by the manifest");
});

await check("BUTTONS: deactivating the source removes the button — files still on disk", async () => {
  const games = [{ system: "gbc" }, { system: "gbc" }];
  const off = buildCoreRegistry([row("slash-proc/tgb", gbcManifest(), false)]);
  // The scan is unchanged; only the source was disabled. `parseRomPath` is what drops the
  // files (see `registryIsAuthoritative`), so with a live registry these games never reach
  // `consoleGroups` at all — but even if one did, it must not be named as a console the user
  // turned off.
  ok(!off.byFolder.has("gbc"), "no active core declares gbc any more");
  const stillActive = buildCoreRegistry([
    row("slash-proc/tgb", gbcManifest(), false),
    row("slash-proc/doom", doomManifest()),
  ]);
  ok(registryIsAuthoritative(stillActive), "another core is active, so the registry decides");
  eq(classifyForRegistry(stillActive, "gbc", ".gbc"), null,
     "a gbc file belongs to no registered console, so it is not a game");
  eq(consoleGroups([], stillActive, () => "FALLBACK").length, 0, "and there is no button");
});

await check("BUTTONS: a registered console with NO files gets no button", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  ok(reg.byFolder.has("doom"), "the core is registered");
  eq(consoleGroups([], reg, () => "FALLBACK").length, 0, "declared but empty is not a console");
});

await check("BUTTONS: an unregistered system gets NO button, even holding games", async () => {
  // This is the owner's complaint. `gbc` reaches `consoleGroups` because a game for it is on
  // the DEVICE (parseDeviceGamePath is ungated on purpose). It must not become a button.
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  const groups = consoleGroups([{ system: "doom" }, { system: "gbc" }], reg, (s) => `fallback:${s}`);
  deepEq(groups.map((g) => g.system), ["doom"], "only the console an active core declares");
  eq(groups[0].label, "Doom", "named by its core, not the legacy table");
});

await check("BUTTONS: with NO core source at all the fallback still names everything", async () => {
  // First run: nothing added yet, so the legacy behaviour survives and the library is not blank.
  const empty = buildCoreRegistry([]);
  ok(!registryIsAuthoritative(empty), "no cores exist, so the registry does not get to decide");
  const groups = consoleGroups([{ system: "gbc" }], empty, (s) => `fallback:${s}`);
  deepEq(groups, [{ system: "gbc", label: "fallback:gbc", count: 1 }], "the pre-registry view");
});

await check("BUTTONS: disabling your LAST core does not resurrect every legacy console", async () => {
  // The regression that produced the owner's Game Boy Color button. With only `systems.length`
  // deciding, switching a core OFF emptied the registry, handed the folder back to the legacy
  // table, and MORE buttons appeared than before.
  const off = buildCoreRegistry([row("slash-proc/tgb", gbcManifest(), false)]);
  eq(off.systems.length, 0, "nothing active is registered");
  ok(off.hasCoreSources, "but the user demonstrably has a core source");
  ok(registryIsAuthoritative(off), "so the registry still decides — the user turned it off");
  eq(consoleGroups([{ system: "gbc" }, { system: "nes" }], off, (s) => `fallback:${s}`).length, 0,
     "and no console the user disabled comes back");
});

// --- 4. Classification: installable vs ingestable ----------------------------------------------

await check("classify: `.whd` installable, `.wad` ingestable, `.txt` neither", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  eq(classifyForRegistry(reg, "doom", ".whd").role, "installable", "the converter's output ships");
  eq(classifyForRegistry(reg, "doom", ".wad").role, "ingestable", "the WAD is a ROM but never ships");
  eq(classifyForRegistry(reg, "doom", ".txt").role, "unknown", "an undeclared extension is not a game");
  eq(classifyForRegistry(reg, "nes", ".nes"), null, "an unregistered folder is not a console at all");
});

await check("classify: the folder match is case-folded (FAT cannot tell DOOM from doom)", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  eq(classifyForRegistry(reg, "DOOM", ".WAD").role, "ingestable", "either spelling, either case");
});

// --- 5. Both folder layouts --------------------------------------------------------------------

await check("layout: a folder dedicated to a single-system core files its loose ROMs there", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  const p = dedicatedFolderPlacement(reg, ["slash-proc/doom#gnw-retro-go"]);
  eq(p.fallback, "doom", "the owner's dedicated doom folder, whose contents ARE the WADs");
  eq(looseFileFolder(p, "DOOM.WAD"), "doom", "every loose file goes there");
  eq(looseFileFolder(p, "cover.png"), "doom",
     "INCLUDING one no system claims -- one system means there is nothing to decide per file");
});

await check("layout: a general 'Any' folder gets NO placement — its subfolders say the console", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  eq(dedicatedFolderPlacement(reg, []), null, "empty usedBy means Any; roms/doom/ already says it");
});

await check("layout: a target the registry cannot resolve is not placed", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  eq(dedicatedFolderPlacement(reg, ["slash-proc/nothing#x"]), null, "a target that owns no system");
});

// --- 5b. A folder marked for BIOS --------------------------------------------------------------
//
// The owner: "A directory source should also have BIOS in its 'Used for' list - if any is
// selected, that means BIOS in that directory should automatically be recognized." The marking
// is self-executing rather than a label: the folder is scanned, and its loose files are placed
// under `bios/`, which is the folder key `biosState` already recognises as a candidate.

await check("a folder marked for BIOS is scanned at all", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  // `bios` names no target, so every ownership test answers false for it. Without an explicit
  // rule the folder would be excluded from the library scan entirely, and a folder nobody scans
  // can never offer a BIOS candidate -- the marking would be decoration.
  eq(isLibrarySource(reg, ["bios"]), true, "marked for BIOS, therefore scanned");
});

await check("a folder marked for BIOS places its loose files under bios/", async () => {
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  const p = dedicatedFolderPlacement(reg, ["bios"]);
  eq(p.fallback, "bios", "which is the key biosState recognises as a candidate");
  eq(looseFileFolder(p, "disksys.rom"), "bios", "a BIOS file the user dropped in the root");
  eq(looseFileFolder(p, "gba_bios.bin"), "bios", "whatever its extension: the folder said so");
});

await check("a console wins the loose files when a folder is marked for BOTH", async () => {
  // Guessing per file would need a rule nothing states, and a ROM misfiled into bios/ is worse
  // than a BIOS the user keeps one folder deeper, where it still resolves.
  const reg = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
  const p = dedicatedFolderPlacement(reg, ["bios", "slash-proc/doom#gnw-retro-go"]);
  eq(p.fallback, "doom", "the console it was dedicated to, not bios");
});

// --- 5a. Several systems in one folder ---------------------------------------------------------
//
// The owner registered `~/Emulation/Roms/Gameboy/` for gb AND gbc and its games vanished: one
// prefix cannot answer a folder holding both `.gb` and `.gbc`. Several systems place PER FILE.

await check("layout: a folder dedicated to TWO systems places each file by its extension", async () => {
  const reg = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);
  const K = "slash-proc/tgb#gnw-retro-go";
  const p = dedicatedFolderPlacement(reg, [`${K}@gb`, `${K}@gbc`]);
  eq(p.fallback, undefined, "there is no one answer for the whole folder, and none is invented");
  eq(looseFileFolder(p, "Tetris.gb"), "gb", "the console that claims .gb");
  eq(looseFileFolder(p, "Oracle of Ages.gbc"), "gbc", "and the one that claims .gbc");
  eq(looseFileFolder(p, "TETRIS.GB"), "gb", "the extension match is case-folded, like the card");
  eq(looseFileFolder(p, "notes.txt"), null, "an extension no system claims is left alone");
  eq(looseFileFolder(p, "README"), null, "and so is a name with no extension at all");
});

await check("layout: several systems across two different CORES place by extension too", async () => {
  const reg = buildCoreRegistry([
    row("slash-proc/doom", doomManifest()),
    row("slash-proc/tgb", gbcManifest()),
  ]);
  const p = dedicatedFolderPlacement(reg, ["slash-proc/doom#gnw-retro-go", "slash-proc/tgb#gnw-retro-go"]);
  eq(looseFileFolder(p, "DOOM.WAD"), "doom", "the WAD is ingestable under Doom, and still belongs to it");
  eq(looseFileFolder(p, "Tetris.gb"), "gb", "while the Game Boy ROM goes to its own console");
});

await check("layout: an extension TWO of the folder's systems claim is refused, never guessed", async () => {
  // Placing it under whichever sorted first would file ROMs under the wrong console silently
  // and permanently. Unplaced is visibly missing; misplaced is invisibly wrong.
  const clash = {
    schemaVersion: 1, project: "multi", title: "Multi", tools: [],
    targets: [{
      id: "gnw-retro-go", platform: "game-and-watch", kind: "core",
      requiresAbi: { version: 2, minSize: 832 }, artifacts: [],
      systems: [
        { id: "pce", longName: "PC Engine", shortName: "PCE", extensions: [".pce", ".bin"], browse: "file", compression: false },
        { id: "md", longName: "Mega Drive", shortName: "MD", extensions: [".md", ".bin"], browse: "file", compression: false },
      ],
    }],
  };
  const reg = buildCoreRegistry([row("slash-proc/multi", clash)]);
  const K = "slash-proc/multi#gnw-retro-go";
  const p = dedicatedFolderPlacement(reg, [`${K}@pce`, `${K}@md`]);
  eq(looseFileFolder(p, "game.bin"), null, "both claim .bin, so neither gets it");
  eq(looseFileFolder(p, "game.pce"), "pce", "the unambiguous ones still place");
  eq(looseFileFolder(p, "game.md"), "md", "both of them");
});

// --- 5b. System-scoped association keys --------------------------------------------------------
//
// The "Used by" picker lists one entry per SYSTEM, so a key may name one (`...@gbc`). The older
// shape (`owner/repo#targetId`) is PERSISTED USER DATA and means the whole target; if it stopped
// matching, the user's folders would come un-associated with no error anywhere.

await check("layout: a multi-system core IS answerable when the key names the system", async () => {
  const reg = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);
  eq(dedicatedFolderPlacement(reg, ["slash-proc/tgb#gnw-retro-go@gbc"]).fallback, "gbc",
     "a folder marked Game Boy Color files its loose ROMs there");
  eq(dedicatedFolderPlacement(reg, ["slash-proc/tgb#gnw-retro-go@gb"]).fallback, "gb",
     "and the other one there");
  // ARMED: naming ONE system is a fallback (everything in the folder), naming both is not.
  eq(dedicatedFolderPlacement(reg, ["slash-proc/tgb#gnw-retro-go@gb", "slash-proc/tgb#gnw-retro-go@gbc"]).fallback,
     undefined, "so this is the system half doing the work, not some looser match");
});

await check("migration: a PERSISTED bare target key on a multi-system core places per extension", async () => {
  // It means every system that target declares, which is now an answerable question. Deliberate:
  // it is the same folder holding the same files, and the alternative is leaving those users
  // with the empty library this whole change exists to fix.
  const reg = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);
  const p = dedicatedFolderPlacement(reg, ["slash-proc/tgb#gnw-retro-go"]);
  eq(looseFileFolder(p, "Tetris.gb"), "gb", "the old key still means both systems, and both place");
  eq(looseFileFolder(p, "Zelda.gbc"), "gbc", "the other one too");
});

await check("signature: the token is minimal and sorted", async () => {
  const reg = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);
  const K = "slash-proc/tgb#gnw-retro-go";
  // A single-system folder spells exactly what the bare prefix used to, so every folder whose
  // layout did NOT change keeps its signature and does not rescan on upgrade.
  eq(placementToken(dedicatedFolderPlacement(reg, [`${K}@gb`])), "gb", "the prefix it always had");
  eq(placementToken(null), "", "and an unplaced folder is still empty");
  // Sorted, so a registry resolving its systems in the other order is not read as a change.
  eq(placementToken(dedicatedFolderPlacement(reg, [`${K}@gb`, `${K}@gbc`])),
     placementToken(dedicatedFolderPlacement(reg, [`${K}@gbc`, `${K}@gb`])),
     "the same two systems in either order are the same placement");
  ok(placementToken(dedicatedFolderPlacement(reg, [`${K}@gb`, `${K}@gbc`])) !==
     placementToken(dedicatedFolderPlacement(reg, [`${K}@gb`])),
     "but adding a system IS a change, and must rescan");
});

await check("layout: a system key naming a system the core does not declare answers nothing", async () => {
  const reg = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);
  eq(dedicatedFolderPlacement(reg, ["slash-proc/tgb#gnw-retro-go@sms"]), null, "no such system");
});

await check("migration: a PERSISTED old-shape key keeps the folder in the library", async () => {
  const reg = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);
  ok(isLibrarySource(reg, ["slash-proc/tgb#gnw-retro-go"]),
     "a row written before systems were listed must not silently stop being scanned");
  ok(isLibrarySource(reg, ["slash-proc/tgb#gnw-retro-go@gbc"]), "and a system-scoped one is in too");
  ok(!isLibrarySource(reg, ["slash-proc/gone#gnw-retro-go"]),
     "ARMED: an unknown target is still out, so the two above are not passing on a blanket true");
  ok(!isLibrarySource(reg, ["slash-proc/tgb#gnw-retro-go@nope"]), "nor is an undeclared system");
});

// --- 5c. The other reader of an association key -------------------------------------------------
//
// `foldersToSearch` decides which folders a converter INPUT may be satisfied from. An input
// belongs to a TARGET, so a folder narrowed to one system of a core must still be searched --
// otherwise picking "Game Boy Color" in the menu would quietly stop that folder feeding the core
// it belongs to, with no error and no way to tell from the UI.
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/inputDiscovery.ts")],
  outfile: join(out, "inputDiscovery.js"),
  bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning",
});
const { foldersToSearch } = await import(pathToFileURL(join(out, "inputDiscovery.js")).href);

await check("discovery: a folder narrowed to one SYSTEM is still searched for its target", async () => {
  const f = (id, usedBy) => ({ id, status: "ready", handle: {}, usedBy });
  const folders = [
    f("shared", []),
    f("gbc", ["slash-proc/tgb#gnw-retro-go@gbc"]),
    f("legacy", ["slash-proc/tgb#gnw-retro-go"]),
    f("other", ["slash-proc/doom#gnw-retro-go"]),
  ];
  deepEq(foldersToSearch(folders, ["slash-proc/tgb#gnw-retro-go"]).map((x) => x.id),
    ["shared", "gbc", "legacy"], "shared, the system-scoped one, and the persisted old one");
  // ARMED: narrowing still narrows, so the three above are not passing on a match-everything.
  deepEq(foldersToSearch(folders, []).map((x) => x.id), ["shared"], "no target context: Any only");
});

// --- 6. Conflicts ------------------------------------------------------------------------------

await check("registry: two cores claiming one folder — first wins, no silent merge", async () => {
  const other = gbcManifest();
  other.targets[0].systems = [
    { id: "doom", longName: "Not Doom", shortName: "Not Doom", extensions: [".xyz"], browse: "file", compression: false },
  ];
  const reg = buildCoreRegistry([
    row("slash-proc/doom", doomManifest()),
    row("slash-proc/impostor", other),
  ]);
  eq(reg.systems.length, 1, "one console, not two");
  eq(reg.byFolder.get("doom").shortName, "Doom", "the first declaration holds");
  eq(classifyForRegistry(reg, "doom", ".xyz").role, "unknown", "the loser's extensions are NOT merged in");
});

// --- 7. THE REAL GATE: romSelection's parseRomPath ---------------------------------------------
// `coreRegistry.ts` only states the rule; `parseRomPath` is what APPLIES it to a scanned file,
// and it is the function that used to consult a hardcoded table and nothing else. Compiled here
// with its store imports faked (same technique as `sources/test/validate.mjs`'s biosState pass),
// so the real function runs against a real registry with no browser.

await esbuild.build({
  entryPoints: [join(here, "../src/lib/romSelection.svelte.ts")],
  outfile: join(out, "romSelection.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune", $derived: "__rune" },
  banner: { js: "const __rune = Object.assign((v) => v, { by: () => [] });" },
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url), {
    name: "romselection-fakes",
    setup(build) {
      const fakes = {
        "device.svelte.js": "export const device = { installedGames: [], targetMedia: 'flash' };",
        "library.svelte.js": "export const library = { scan: null };",
        "homebrewTitles.svelte.js": "export const homebrew = { titles: [], deviceFiles: new Set() };",
        "romScan.js": "export const nativeFolderPickerSupported = () => true;",
        // The reactive singleton: the tests pass a registry explicitly, so this is only here to
        // satisfy the import. A default of EMPTY also proves the explicit argument is the one
        // being read — if `parseRomPath` ignored its parameter, every registry check would fail.
        "coreRegistry.svelte.js": "export const coreRegistry = { current: { systems: [], byFolder: new Map() } };",
      };
      build.onResolve(
        { filter: /(device\.svelte|library\.svelte|homebrewTitles\.svelte|coreRegistry\.svelte|romScan)\.js$/ },
        (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "rs-fake" }),
      );
      build.onLoad({ filter: /.*/, namespace: "rs-fake" }, (a) => ({
        contents: fakes[a.path],
        loader: "js",
      }));
    },
  }],
});
const { parseRomPath, parseDeviceGamePath, pressAddsBytes } = await import(
  pathToFileURL(join(out, "romSelection.js")).href
);

const doomRegistry = buildCoreRegistry([row("slash-proc/doom", doomManifest())]);
const gbcRegistry = buildCoreRegistry([row("slash-proc/tgb", gbcManifest())]);

await check("parseRomPath: a Doom WAD IS a library ROM, marked ingestable", async () => {
  const r = parseRomPath("doom/DOOM.WAD", doomRegistry);
  ok(r, "the WAD is recognised — it was invisible before, because no table listed `doom`");
  eq(r.system, "doom", "filed under its core's folder");
  eq(r.name, "DOOM.WAD", "display name");
  eq(r.role, "ingestable", "it must be converted; the installer may never copy it");
});

await check("parseRomPath: the converter's own output is installable", async () => {
  eq(parseRomPath("doom/The Ultimate Doom.whd", doomRegistry).role, "installable",
     "only the .whd reaches the card");
});

await check("parseRomPath: THE GBC BUG — a disabled core's files stop being games", async () => {
  // Identical input, two registries. This is the owner's report reduced to one assertion:
  // "Gameboy Color is being displayed despite me having it disabled as a source."
  eq(parseRomPath("gbc/zelda.gbc", gbcRegistry).system, "gbc", "enabled: it is a game");
  eq(parseRomPath("gbc/zelda.gbc", doomRegistry), null,
     "disabled (another core active): the file is still on disk and is NOT a game");
});

await check("parseRomPath: an undeclared extension in a declared folder is not a game", async () => {
  eq(parseRomPath("doom/readme.txt", doomRegistry), null, "the core declares neither .txt role");
});

await check("parseRomPath: with NO core registered the legacy table still answers", async () => {
  // Nothing has resolved yet — we cannot tell that from "the user disabled everything", so the
  // library keeps working rather than going blank.
  const empty = { systems: [], byFolder: new Map() };
  const r = parseRomPath("nes/mario.nes", empty);
  ok(r, "the pre-registry behaviour survives for the empty case");
  eq(r.role, "installable", "the legacy table only ever listed device formats");
  eq(parseRomPath("doom/DOOM.WAD", empty), null, "but it never knew about Doom");
});

await check("parseRomPath: a device game outlives its core being disabled", async () => {
  // Sources decide what may be ADDED; the device decides what is already THERE. A game on the
  // card must stay listed and removable even with no core declaring its console.
  eq(parseRomPath("gbc/zelda.gbc", doomRegistry), null, "the folder copy is gated");
  const onCard = parseDeviceGamePath("gbc/zelda.gbc");
  ok(onCard, "the installed copy is not");
  eq(onCard.system, "gbc", "so it can still be listed and deleted");
});

await check("BUTTONS: a device game of an inactive core keeps no button but stays a game", async () => {
  // The owner's rule and the stranded-game rule together: no button, still selectable in "All".
  const reg = buildCoreRegistry([
    row("slash-proc/tgb", gbcManifest(), false),
    row("slash-proc/doom", doomManifest()),
  ]);
  eq(consoleGroups([{ system: "gbc" }], reg, (s) => `fallback:${s}`).length, 0, "no button");
  const onCard = parseDeviceGamePath("gbc/zelda.gbc");
  ok(onCard, "the installed copy is still a game");
  eq(onCard.system, "gbc", "so it lists under All and can still be removed");
});


// --- 6. ONE ROW PER GAME: the .wad and the .whd it becomes are one entry ------------------------

/** The registry Doom produces, and the two lookups `buildGameRows` needs from it. */
const doomReg = buildCoreRegistry([row("slash-proc/doom", doomManifest("core"))]);
const outExtFor = (system) => doomReg.byFolder.get(system.toLowerCase())?.outputExtension;
const noHints = () => undefined;
/** DOOM.WAD matched the published variant, so the output name is DECLARED, not derived. */
const ultimateHint = (key) =>
  key === "doom/DOOM.WAD" ? { variantFilename: "The Ultimate Doom.whd" } : undefined;

const wad = (name, size = 12996515) =>
  ({ key: `doom/${name}`, system: "doom", name, size, inFolder: true, installed: false, role: "ingestable" });
const whd = (name, size = 10320896, installed = false) =>
  ({ key: `doom/${name}`, system: "doom", name, size, inFolder: true, installed, role: "installable" });

await check("registry: a core's converter output extension reaches the system", async () => {
  eq(outExtFor("doom"), ".whd", "outputs[].extension, for deriving an unmatched WAD's output name");
});

await check("rows: a WAD alone is ONE row, unprepared, with nothing to install", async () => {
  const rows = buildGameRows([wad("DOOM.WAD")], outExtFor, ultimateHint);
  eq(rows.length, 1, "one row for one game");
  eq(rows[0].needsPrepare, true, "it must be converted before anything can be installed");
  eq(rows[0].installed, false, "and it is certainly not on the device");
  eq(rows[0].outputKey, undefined, "there is no installable file behind it yet");
  eq(rows[0].inputKey, "doom/DOOM.WAD", "the row is backed by the input");
});

await check("rows: the WAD and its matching WHD collapse into ONE prepared row", async () => {
  const rows = buildGameRows(
    [wad("DOOM.WAD"), whd("The Ultimate Doom.whd")],
    outExtFor,
    ultimateHint,
  );
  eq(rows.length, 1, "two files, ONE game — not two rows");
  eq(rows[0].needsPrepare, false, "the output exists, so it is prepared");
  eq(rows[0].key, "doom/DOOM.WAD", "identity stays the INPUT's, so the row does not move");
  eq(rows[0].outputKey, "doom/The Ultimate Doom.whd", "and it knows what it produced");
  eq(rows[0].size, 10320896, "its weight is the OUTPUT — that is what gets copied");
});

await check("rows: pairing is case-folded, because the card cannot tell DOOM.whd from Doom.whd", async () => {
  const rows = buildGameRows(
    [wad("DOOM.WAD"), whd("THE ULTIMATE DOOM.WHD")],
    outExtFor,
    ultimateHint,
  );
  eq(rows.length, 1, "gwrg-dist-spec 930517c: one file to FAT, so one row here");
  eq(rows[0].needsPrepare, false, "and it counts as prepared");
});

await check("rows: an unmatched WAD derives its output name from its own stem", async () => {
  eq(outputNameFor("freedoom2.wad", undefined, ".whd"), "freedoom2.whd", "strict:false, spec/03");
  const rows = buildGameRows([wad("freedoom2.wad"), whd("freedoom2.whd")], outExtFor, noHints);
  eq(rows.length, 1, "still one game");
  eq(rows[0].needsPrepare, false, "paired on the derived name");
});

await check("rows: NAMES — list is extensionless, carousel adds the published title", async () => {
  const matched = buildGameRows([wad("DOOM.WAD")], outExtFor, ultimateHint)[0];
  eq(matched.listName, "DOOM", "the list shows the original filename, extension stripped");
  eq(matched.prettyName, "The Ultimate Doom", "the carousel headline is the PUBLISHED name");
  eq(matched.originFilename, "DOOM.WAD", "with the full original filename underneath it");

  const derived = buildGameRows([wad("freedoom2.wad")], outExtFor, noHints)[0];
  eq(derived.prettyName, "freedoom2", "no variant matched, so both surfaces read the same");
  eq(derived.listName, "freedoom2", "rather than inventing a title nobody published");
});

await check("rows: preparing does NOT rename the row", async () => {
  const before = buildGameRows([wad("DOOM.WAD")], outExtFor, ultimateHint)[0];
  const after = buildGameRows(
    [wad("DOOM.WAD"), whd("The Ultimate Doom.whd")], outExtFor, ultimateHint,
  )[0];
  eq(after.key, before.key, "same identity, so the selection does not move");
  eq(after.listName, before.listName, "the list still names the file the user put there");
  eq(after.originFilename, "DOOM.WAD", "and the provenance line stays provenance");
});

await check("rows: a stem containing a dot keeps all of it", async () => {
  eq(stripExtension("Sonic 3.5.md"), "Sonic 3.5", "only the LAST extension goes");
  eq(stripExtension("README"), "README", "a dotless name is left alone");
});

await check("rows: an ordinary ROM is one row and needs no preparing", async () => {
  const rows = buildGameRows(
    [{ key: "gbc/zelda.gbc", system: "gbc", name: "zelda.gbc", size: 512, inFolder: true, installed: true, role: "installable" }],
    outExtFor, noHints,
  );
  eq(rows.length, 1, "unchanged behaviour for every non-converting console");
  eq(rows[0].needsPrepare, false, "nothing to convert");
  eq(rows[0].installed, true, "and its installed state is its own");
});

await check("rows: a WHD whose WAD was deleted is still a game", async () => {
  const rows = buildGameRows([whd("The Ultimate Doom.whd", 10320896, true)], outExtFor, noHints);
  eq(rows.length, 1, "it is on the card, so it must stay listed and removable");
  eq(rows[0].needsPrepare, false, "and installable — it is already the device format");
});

await check("rows: pairing costs NO hash of its own", async () => {
  // The cost rule lives in `sources/inputDiscovery.ts` (extension -> published bytes -> hash),
  // and is asserted there — a library with no candidate files hashes nothing. This module must
  // not add to that budget: an output is found by NAME, because a matched variant publishes the
  // filename and an unmatched one derives it. The proof is structural — `buildGameRows` is not
  // given any way to hash — so a regression to "hash to find the pair" cannot compile.
  eq(buildGameRows.length, 3, "entries, outputExtensionFor, hintFor — and no hash dependency");
  const rows = buildGameRows(
    [wad("DOOM.WAD"), whd("The Ultimate Doom.whd")],
    outExtFor,
    ultimateHint,
  );
  eq(rows.length, 1, "paired on the declared filename alone");
});

// --- 7. PREPARED IS NOT THE SAME QUESTION AS SCANNED -------------------------------------------
//
// THE OWNER'S BUG. A converted `.whd` never lands in the user's folder — we cannot write there —
// so it lives in `prepareState.assets`. A row that asks only the SCAN whether its output exists
// finds nothing and re-renders as unprepared, which is why Prepare "flinched and came back" and
// Install was never reachable however many times the conversion succeeded.

/** Stands in for `prepareState.preparedSize`: the app's asset store, keyed `<system>/<file>`. */
const store = (entries) => {
  const m = new Map(entries);
  return (system, outputName) => m.get(`${system}/${outputName}`);
};

await check("rows: an output held ONLY as a prepared asset makes the row prepared", async () => {
  const rows = buildGameRows(
    [wad("DOOM.WAD")], outExtFor, ultimateHint,
    store([["doom/The Ultimate Doom.whd", 10320896]]),
  );
  eq(rows.length, 1, "still one game");
  eq(
    rows[0].needsPrepare,
    false,
    "THE FLINCH: converted bytes the scan cannot see still mean prepared, so Install is reachable",
  );
  eq(rows[0].size, 10320896, "and the budget uses the OUTPUT's weight, from the store");
  eq(rows[0].key, "doom/DOOM.WAD", "identity is still the input's — preparing renames nothing");
});

await check("rows: with neither a scanned output nor a prepared one, the row still needs prepare", async () => {
  const rows = buildGameRows([wad("DOOM.WAD")], outExtFor, ultimateHint, store([]));
  eq(rows[0].needsPrepare, true, "an empty store is not an answer");
});

await check("rows: a scanned output wins over the store, and never doubles the row", async () => {
  const rows = buildGameRows(
    [wad("DOOM.WAD"), whd("The Ultimate Doom.whd")], outExtFor, ultimateHint,
    store([["doom/The Ultimate Doom.whd", 999]]),
  );
  eq(rows.length, 1, "one game, however many places its output is known from");
  eq(rows[0].size, 10320896, "the real file's size, not the store's");
  eq(rows[0].outputKey, "doom/The Ultimate Doom.whd", "and the row points at the file on disk");
});

await check("rows: the prepared lookup is per SYSTEM, so two cores cannot answer for each other", async () => {
  const rows = buildGameRows(
    [wad("DOOM.WAD")], outExtFor, ultimateHint,
    // The same output filename, prepared under a DIFFERENT console.
    store([["other/The Ultimate Doom.whd", 10320896]]),
  );
  eq(rows[0].needsPrepare, true, "another core's prepared file is not this row's output");
});

await check("BUTTONS: a prepared game counts ONCE, not once per file", async () => {
  const rows = buildGameRows(
    [wad("DOOM.WAD"), whd("The Ultimate Doom.whd")], outExtFor, ultimateHint,
  );
  const groups = consoleGroups(rows, doomReg, (s) => `fallback:${s}`);
  eq(groups.length, 1, "one console");
  eq(groups[0].count, 1, "ONE game — counting files would read `Doom 2` after preparing");
  eq(groups[0].label, "Doom", "named by the manifest");
});

// --- ACTIVATION: a source switched on must reach the Library -----------------------------------
//
// The owner's report: "I just activated tgbdual but it didn't recognize that on the Library
// page." Driven from the shape tgb-dual v0.1.1 actually publishes — `kind: "core"`, TWO systems
// (`gb` and `gbc`), no converter.

/** tgb-dual's real published shape, trimmed to what the registry reads. */
function tgbManifest() {
  return {
    schemaVersion: 1, project: "tgb", title: "TGB Dual", tools: [],
    targets: [{
      id: "gnw-retro-go", platform: "game-and-watch", kind: "core",
      requiresAbi: { version: 2, minSize: 832 }, artifacts: [],
      systems: [
        { id: "gb", longName: "Game Boy", shortName: "GB", extensions: [".gb"], browse: "file", compression: false },
        { id: "gbc", longName: "Game Boy Color", shortName: "GBC", extensions: [".gbc"], browse: "file", compression: false },
      ],
    }],
  };
}

const gbGames = [{ system: "gb" }, { system: "gbc" }, { system: "doom" }];

await check("ACTIVATION: switching a core on gives it its consoles and its ROMs", async () => {
  const off = buildCoreRegistry([
    row("slash-proc/doom-retro-go-sd", doomManifest("core")),
    row("slash-proc/tgb-dual-retro-go-sd", tgbManifest(), false),
  ]);
  eq(classifyForRegistry(off, "gb", ".gb"), null, "inactive: a .gb is not a game");
  deepEq(consoleGroups(gbGames, off, (s) => `fb:${s}`).map((g) => g.system), ["doom"],
    "inactive: no Game Boy buttons");

  const on = buildCoreRegistry([
    row("slash-proc/doom-retro-go-sd", doomManifest("core")),
    row("slash-proc/tgb-dual-retro-go-sd", tgbManifest()),
  ]);
  eq(classifyForRegistry(on, "gb", ".gb")?.role, "installable", "active: the .gb IS a game");
  eq(classifyForRegistry(on, "gbc", ".gbc")?.role, "installable", "active: and the .gbc, its own system");
  deepEq(consoleGroups(gbGames, on, (s) => `fb:${s}`).map((g) => g.label).sort(),
    ["Doom", "GB", "GBC"], "active: BOTH declared systems get a button, named by the manifest");
});

await check("ACTIVATION: a row activated before its manifest resolves still registers", async () => {
  // The persisted card carries `systems`, so the console is right on the first frame.
  const card = {
    repo: "slash-proc/tgb-dual-retro-go-sd", active: true,
    card: { kind: "core", systems: [
      { id: "gb", longName: "Game Boy", shortName: "GB", extensions: [".gb"] },
      { id: "gbc", longName: "Game Boy Color", shortName: "GBC", extensions: [".gbc"] },
    ] },
  };
  const reg = buildCoreRegistry([card]);
  eq(classifyForRegistry(reg, "gb", ".gb")?.role, "installable", "the card alone answers");
  eq(reg.byFolder.get("gbc")?.shortName, "GBC", "and names it");
});

await check("ACTIVATION: a source declaring no systems changes nothing", async () => {
  const before = buildCoreRegistry([row("slash-proc/doom-retro-go-sd", doomManifest("core"))]);
  const hb = {
    schemaVersion: 1, project: "ccleste", title: "ccleste", tools: [],
    targets: [{ id: "gnw-retro-go", platform: "game-and-watch", kind: "homebrew", artifacts: [] }],
  };
  const after = buildCoreRegistry([
    row("slash-proc/doom-retro-go-sd", doomManifest("core")),
    row("slash-proc/ccleste-retro-go-sd", hb),
  ]);
  deepEq([...after.byFolder.keys()], [...before.byFolder.keys()], "a homebrew adds no console");
});

// --- ROOT DETECTION: structural, not a question about what is switched on ----------------------
//
// THE BUG BEHIND THE OWNER'S REPORT. `getValidRoot` asked `byFolder` (ACTIVE cores only), so a
// ROM folder holding just `gb/` and `gbc/` was refused at pick time — "Invalid folder selected"
// — whenever tgb-dual was off. The folder was then never registered, so switching the core ON
// afterwards had nothing to rescan: the Library could never recognise it.

await check("ROOT: a console directory is one whether or not its core is switched on", async () => {
  const off = buildCoreRegistry([
    row("slash-proc/doom-retro-go-sd", doomManifest("core")),
    row("slash-proc/tgb-dual-retro-go-sd", tgbManifest(), false),
  ]);
  ok(isKnownConsoleDir("gb", off), "gb/ is a console directory with tgb-dual INACTIVE");
  ok(isKnownConsoleDir("gbc", off), "and gbc/");
  ok(isKnownConsoleDir("doom", off), "as is the active core's own");
  ok(!isKnownConsoleDir("screenshots", off), "but not an arbitrary directory");
});

await check("ROOT: the BUTTON rule still follows activation — the two questions differ", async () => {
  const off = buildCoreRegistry([
    row("slash-proc/doom-retro-go-sd", doomManifest("core")),
    row("slash-proc/tgb-dual-retro-go-sd", tgbManifest(), false),
  ]);
  ok(isKnownConsoleDir("gb", off), "the folder is still recognised as a console directory");
  deepEq(consoleGroups(gbGames, off, (s) => `fb:${s}`).map((g) => g.system), ["doom"],
    "yet an inactive core shows NO button — this is what makes deactivating work");
  eq(classifyForRegistry(off, "gb", ".gb"), null, "and its files are not games");
});

await check("ROOT: once the registry is authoritative, a legacy name nobody declares is not a console", async () => {
  const reg = buildCoreRegistry([
    row("slash-proc/doom-retro-go-sd", doomManifest("core")),
    row("slash-proc/tgb-dual-retro-go-sd", tgbManifest(), false),
  ]);
  ok(registryIsAuthoritative(reg), "the user has core sources");
  ok(!isKnownConsoleDir("nes", reg),
    "no source declares nes/, so the legacy table must NOT answer — that fallback is only for a first run");
  ok(isKnownConsoleDir("gb", reg), "while a declared folder still is one, active or not");
});

await check("ROOT: with no core sources at all the legacy names still answer", async () => {
  const none = buildCoreRegistry([]);
  ok(!registryIsAuthoritative(none), "nothing has resolved yet");
  ok(isKnownConsoleDir("nes", none), "a first run still recognises a card");
  ok(!isKnownConsoleDir("doom", none), "but knows nothing the legacy table never listed");
});

// ---------------------------------------------------------------------------------------
// STEP 6 — the two rules that were stated but not pinned.
//
// Both are SOURCE assertions, because the thing they guard is not reachable from a node
// suite. That is a deliberate, documented shape in this repo (see `firmwarecutover.mjs`'s
// static checks and `formatsize.mjs`'s unit scan), not a workaround: a guard that reads the
// source is honest about what it proves, where a unit test that cannot see the code at all
// would prove nothing while looking green.

await check("AFFORDANCE: an unprepared row is gated on `needsPrepare` ALONE", async () => {
  // THE OWNER'S RULE: "an unprepared file is never install-selectable" — and not by being
  // filtered out of the selection afterwards. The install control must not EXIST on such a
  // row. That branch lives inside `getActionState` in `views/RomManagementTab.svelte`, a
  // component function no node suite can call, so this reads the source.
  //
  // Why the condition is asserted EXACTLY: narrowing it to a conjunction
  // (`g.needsPrepare && g.installed`) drops an unprepared WAD through to the install/uninstall
  // branch, which is precisely the bug. That regression type-checks, and before this check the
  // ENTIRE gate — every suite plus svelte-check — passed with it in place.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/views/RomManagementTab.svelte"),
    "utf8",
  );
  const guard = src.match(/\}\s*else if \(([^)]*)\) \{\s*\n\s*\/\/ AN INGESTABLE ROW/);
  ok(guard !== null, "the ingestable branch is still there and still commented as such");
  eq(guard[1].trim(), "g.needsPrepare", "gated on needsPrepare alone — no conjunction");

  // And nothing inside that branch may offer an install control. Slice from the guard to the
  // `} else {` that opens the ordinary-ROM branch, and read every label it can return.
  const from = src.indexOf(guard[0]);
  const to = src.indexOf("} else {", from);
  ok(to > from, "the ingestable branch is followed by the ordinary-ROM branch");
  const labels = [...src.slice(from, to).matchAll(/label: "([^"]+)"/g)].map((m) => m[1]).sort();
  deepEq(labels, ["extracting...", "prepare"], "prepare or extracting — never an install control");
});

await check("COST: `gameRows.ts` has no way to hash, by source and not by arity", async () => {
  // The existing arity check (`buildGameRows.length === 3`) asserts the signature but does NOT
  // guard what it claims: `Function.length` stops counting at the first defaulted parameter,
  // and `preparedSizeFor` already has a default. A `hashFor` added after it leaves the arity at
  // 3, so that check passes while a hash dependency sits in the signature — verified.
  //
  // The real property is that this module cannot hash at all: pairing is a NAME lookup, because
  // a matched variant publishes the output filename and an unmatched one derives it. The cost
  // rule itself lives in `inputDiscovery.ts` and is asserted numerically in `libraryscan.mjs`
  // (600 files, zero hashes); this only pins that `gameRows` adds nothing to that budget.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/sources/gameRows.ts"),
    "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const hits = [...code.matchAll(/\b(sha1|sha256|digest|subtle|crypto|hashFor|blobKey)\b/gi)]
    .map((m) => m[1]);
  deepEq(hits, [], "no hashing identifier survives in the code — pairing is by name");
});

// --- 10. THE INSTALL TOGGLE: a press that FREES space is never gated -----------------------------
// The owner: "When I go to click on the 'install' button of OpenLara, it looks like it's trying to
// add it again instead of setting it to not install. That was working..."
//
// The action labels name the PENDING OUTCOME. A selected row reads `install` and pressing it
// DESELECTS. Both chip handlers ran the space check for `install` as well as `not installed`, and
// `currentEstSize` already includes every selected title -- so the deselect press summed the same
// bytes twice, tripped `validateFit`, raised the space alert and returned BEFORE the toggle.

await check("toggle: only a press that ADDS bytes is checked against the space budget", async () => {
  eq(pressAddsBytes("not installed"), true, "pressing `not installed` adds the row, so it is checked");
  eq(pressAddsBytes("install"), false,
     "pressing `install` DESELECTS -- freeing space cannot need permission, and checking it here counted the row twice");
});

await check("toggle: no other label is treated as an addition", async () => {
  for (const label of ["installed", "uninstall", "prepare", "extracting...", "missing rom"]) {
    eq(pressAddsBytes(label), false, `\`${label}\` does not add bytes`);
  }
});

await check("toggle: neither chip handler gates the budget on `install`", async () => {
  // `getActionState` and the handlers live in a .svelte component, so the BEHAVIOUR is out of
  // reach here (runes are stubbed and there is no DOM). This pins that both call sites go through
  // the predicate above rather than re-spelling the condition, which is how the bug returns.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/views/RomManagementTab.svelte"),
    "utf8",
  );
  const code = src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const gates = [...code.matchAll(/if \(([^)]*state\.label[^)]*)\) \{\s*\n\s*const extraBytes/g)]
    .map((m) => m[1].trim());
  deepEq(gates, [], "no space check is gated on a raw `state.label` comparison");
  eq((code.match(/if \(pressAddsBytes\(state\.label\)\) \{/g) ?? []).length, 2,
     "both chip handlers -- the row and the carousel info box -- ask pressAddsBytes");
});

// --- 8. SELECTION ACTS ON THE FILE THE CARD GETS, not on the converter's input -----------------
// The owner: an installed Doom row drew yellow "uninstall" untouched, Sync Library stayed
// disabled, and the `.whd` was never removed. One cause: a paired row's identity is its INPUT
// (so the row does not rename itself on Prepare) while `installed` and the file on the card are
// its OUTPUT -- and selection was read from, and written to, the row's own key. The WAD is never
// installed, so the row read as unselected; toggling it moved an override for a file nothing
// copies while the WHD stayed selected by its installed default, so `removals` saw nothing.
//
// Driven through the REAL store with its two data sources faked from `globalThis`, so the rules
// under test are `selectedKeys`, `additions`, `removals` and `rows` themselves rather than a
// restatement of them here.

await esbuild.build({
  entryPoints: [join(here, "../src/lib/romSelection.svelte.ts")],
  outfile: join(out, "romSelectionLive.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune", $derived: "__rune" },
  // `$derived.by(fn)` has to stay LAZY here, which the usual identity stub cannot do: these
  // rules are the subject, and a value computed once at construction would freeze `rows` and
  // `removals` at their empty starting state, so every toggle below would assert on a snapshot
  // taken before it. The proxy recomputes on each property access, which is what a rune does.
  banner: {
    js: [
      "const __reeval = (f) => new Proxy({}, {",
      "  get(_, p) { const v = f(); const r = v[p]; return typeof r === 'function' ? r.bind(v) : r; },",
      "  has(_, p) { return p in Object(f()); },",
      "  ownKeys() { return Reflect.ownKeys(Object(f())); },",
      "  getOwnPropertyDescriptor(_, p) { return { configurable: true, enumerable: true, value: Object(f())[p] }; },",
      "});",
      "const __rune = Object.assign((v) => v, { by: __reeval });",
    ].join("\n"),
  },
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url), {
    name: "romselection-live-fakes",
    setup(build) {
      const fakes = {
        "device.svelte.js": "export const device = { get installedGames(){ return globalThis.__dev; }, targetMedia: 'flash' };",
        "library.svelte.js": "export const library = { get scan(){ return globalThis.__scan; } };",
        "homebrewTitles.svelte.js": "export const homebrew = { titles: [], deviceFiles: new Set() };",
        "romScan.js": "export const nativeFolderPickerSupported = () => true;",
        "coreRegistry.svelte.js": "export const coreRegistry = { get current(){ return globalThis.__reg; } };",
        "discoveryWire.svelte.js": "export const variantHints = { get(k){ return globalThis.__hints(k); } };",
        "prepareState.svelte.js": "export const prepareState = { assets: new Map(), preparedSize: () => undefined };",
      };
      build.onResolve(
        { filter: /(device\.svelte|library\.svelte|homebrewTitles\.svelte|coreRegistry\.svelte|discoveryWire\.svelte|prepareState\.svelte|romScan)\.js$/ },
        (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "rsl-fake" }),
      );
      build.onLoad({ filter: /.*/, namespace: "rsl-fake" }, (a) => ({ contents: fakes[a.path], loader: "js" }));
    },
  }],
});

globalThis.__reg = doomReg;
globalThis.__hints = (k) => ultimateHint(k);
globalThis.__scan = null;
globalThis.__dev = [];

/**
 * The owner's device, and a FRESH store for each scenario.
 *
 * The store keeps its overrides for the life of the module and exposes no reset -- correct for
 * an app, useless for a suite where one scenario's toggle would leak into the next. A
 * cache-busting import gives each scenario its own instance rather than adding production API
 * that exists only for tests.
 */
let liveSeq = 0;
async function doomOnCard() {
  globalThis.__scan = {
    userRoms: new Map([
      ["doom/DOOM.WAD", new Uint8Array(8)],
      ["gbc/zelda.gbc", new Uint8Array(4)],
    ]),
  };
  globalThis.__dev = [
    { system: "doom", name: "The Ultimate Doom.whd", size: 10320896 },
    { system: "gbc", name: "zelda.gbc", size: 4 },
  ];
  const url = `${pathToFileURL(join(out, "romSelectionLive.js")).href}?n=${++liveSeq}`;
  return (await import(url)).romSelection;
}

await check("selection: the row's key is the INPUT, its selection key is the OUTPUT", async () => {
  eq(selectionKeyFor({ key: "doom/DOOM.WAD", outputKey: "doom/The Ultimate Doom.whd" }),
     "doom/The Ultimate Doom.whd", "the file the card gets");
  eq(selectionKeyFor({ key: "gbc/zelda.gbc" }), "gbc/zelda.gbc", "an ordinary ROM is its own file");
  // The converted-in-store case: no file entry exists for the output, so the input is the only
  // handle there is, and `selectedAssets` reaches the output through `outputName` instead.
  eq(selectionKeyFor({ key: "doom/freedoom2.wad" }), "doom/freedoom2.wad", "unpaired stays the input");
});

await check("1. an installed Doom row reads as SELECTED, so it offers Installed and not Uninstall", async () => {
  const sel = await doomOnCard();
  const row = sel.rows.find((r) => r.system === "doom");
  ok(row, "the Doom row exists");
  eq(row.key, "doom/DOOM.WAD", "identity is still the input, as gameRows requires");
  eq(row.installed, true, "and it IS on the card");
  eq(sel.isRowSelected(row), true,
     "an installed row starts selected; reading row.key asked the WAD and got false");
});

await check("2. toggling it off produces a removal for the file that is actually on the card", async () => {
  const sel = await doomOnCard();
  const row = sel.rows.find((r) => r.system === "doom");
  sel.toggleRow(row);
  eq(sel.isRowSelected(row), false, "the row is now deselected");
  const removals = sel.removals.map((g) => g.key);
  deepEq(removals, ["doom/The Ultimate Doom.whd"],
         "the WHD is removed -- the WAD is not a file the card ever had");
});

await check("3. that removal is a CHANGE, which is what makes Sync Library clickable", async () => {
  const sel = await doomOnCard();
  // `flashSyncHasChanges` is additions + removals + dirty + cheats; this is the half the row owns.
  eq(sel.removals.length + sel.additions.length, 0,
     "untouched, there is nothing to do -- the button is correctly disabled");
  sel.toggleRow(sel.rows.find((r) => r.system === "doom"));
  ok(sel.removals.length > 0, "after the toggle there is a change to install");
});

await check("4. deselecting an unrelated game does not drag Doom's output with it", async () => {
  const sel = await doomOnCard();
  const zelda = sel.rows.find((r) => r.system === "gbc");
  sel.toggleRow(zelda);
  const removals = sel.removals.map((g) => g.key);
  deepEq(removals, ["gbc/zelda.gbc"], "only the game the user deselected");
  const doomRow = sel.rows.find((r) => r.system === "doom");
  eq(sel.isRowSelected(doomRow), true, "Doom stays selected, so its WHD is retained");
});

await check("selection: the WAD is never selected, so it can never be counted as an addition", async () => {
  const sel = await doomOnCard();
  const doomRow = sel.rows.find((r) => r.system === "doom");
  sel.toggleRow(doomRow); // off
  sel.toggleRow(doomRow); // and on again
  eq(sel.isSelected("doom/DOOM.WAD"), false,
     "a converter input is never copied (plannedInstallNames skips it); selecting it would only inflate the size");
  eq(sel.isSelected("doom/The Ultimate Doom.whd"), true, "the output is what is selected");
});

await check("the Library's row controls go through the ROW api, not the file api", async () => {
  // The store rule above is only half of it: the component holds ROWS, so a call site that
  // reverts to `romSelection.toggle(g.key)` restores the whole defect while every check above
  // still passes. Source-level, because the control lives in a Svelte handler behind a device.
  const tab = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
  const state = tab.slice(tab.indexOf("function getActionState"), tab.indexOf("// --- Lazy preview"));
  const bare = [...state.matchAll(/romSelection\.(?:isSelected|toggle)\(g\.key\)/g)];
  eq(bare.length, 0,
     `getActionState still asks the file api for a row: ${bare.map((m) => m[0]).join(", ")}`);
  ok(/romSelection\.isRowSelected\(g\)/.test(state), "it reads the row's selection");
  ok(/romSelection\.toggleRow\(g\)/.test(state), "and writes it");
  // ANTI-VACUITY: the pattern must actually match the shape it is looking for, or "0 found"
  // would be true of any file at all.
  ok(/romSelection\.(?:isSelected|toggle)\(g\.key\)/.test("romSelection.toggle(g.key)"),
     "the bare-call pattern does not match a bare call, so finding none proves nothing");
});

console.log(`\ncoreregistry: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
