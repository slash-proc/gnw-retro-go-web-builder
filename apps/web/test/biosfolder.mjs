#!/usr/bin/env node
/**
 * A directory marked `Used for: BIOS` actually fills a core's BIOS slot.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/biosfolder.mjs'
 *
 * THE REPORT. The owner marked `~/Nerd/git/RetroLibre/roms/bios/` as a BIOS directory, with
 * `syscard3.pce` sitting directly in it, and PCE-GO still reported its System Card as missing.
 *
 * The marking is meant to be self-executing: a BIOS-marked folder is a library source
 * (`isLibrarySource`), its loose root files are placed under `bios/`
 * (`dedicatedFolderPlacement` -> `applyPlacement`), and `biosState` recognises a candidate by
 * that key shape (`isBiosFolderKey`) and matches it to a slot by basename (`matchCandidates`).
 * Four links, each of which reads correctly on its own -- which is exactly why this test walks
 * the WHOLE chain with the real functions instead of checking any one of them.
 *
 * The fixture is the owner's real case: the real PCE-GO manifest shape (system `pcecd`,
 * `biosDir: "pce"`, filenames `syscard3.pce` / `syscard3.bin`, `required`, `strict`), a folder
 * marked for BIOS and nothing else, and the file at the folder root.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
const ok = (v, msg) => { if (!v) throw new Error(msg); };
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-biosfolder-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
const build = async (entry, name) => {
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/sources/", entry)],
    outfile: join(out, name),
    bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning",
  });
  return import(pathToFileURL(join(out, name)).href);
};

const reg = await build("coreRegistry.ts", "coreRegistry.js");
const scan = await build("libraryScan.ts", "libraryScan.js");
const bios = await build("bios.ts", "bios.js");

// --- The owner's fixture ------------------------------------------------------------------

/** PCE-GO as it really ships: gwrg-ng/pce-go-retro-go-sd/gwrg.json, read 2026-09-12. */
const PCE_GO = {
  repo: "gwrg-ng/pce-go-retro-go-sd",
  active: true,
  manifest: {
    schemaVersion: 1,
    project: "pce-go",
    title: "PCE-GO",
    source: { repo: "gwrg-ng/pce-go-retro-go-sd", commit: "0", ref: "main" },
    tools: [],
    targets: [{
      id: "gnw-retro-go",
      kind: "core",
      label: "Game & Watch (Retro-Go SD)",
      artifacts: [],
      systems: [
        { id: "pce", longName: "PC Engine", shortName: "PCE", extensions: [".pce"], compression: false },
        {
          id: "pcecd",
          longName: "PC Engine CD",
          shortName: "PCE CD",
          biosDir: "pce",
          extensions: [[".cue", ".bin"]],
          compression: false,
          bios: [{
            id: "syscard3",
            filename: ["syscard3.pce", "syscard3.bin"],
            required: true,
            sha1: "79F5FF55DD10187C7FD7B8DAAB0B3FFBD1F56A2C",
            strict: true,
            label: { en: "System Card 3" },
          }],
        },
      ],
    }],
  },
};

const BIOS_KEY = "bios";
/** The folder the owner added: marked for BIOS and nothing else. */
const biosFolder = { id: "f-bios", handle: {}, status: "ready", usedBy: [BIOS_KEY] };
/** What a walk of that folder yields: the file sits at the ROOT, as he said it does. */
const walked = new Map([["syscard3.pce", new Uint8Array(8)]]);

const registry = reg.buildCoreRegistry([PCE_GO]);

// --- The chain, link by link, then end to end ---------------------------------------------

await check("the folder is scanned at all", () => {
  ok(reg.isLibrarySource(registry, biosFolder.usedBy),
    "a BIOS-marked folder must be a library source, or it is never walked and the marking is decoration");
});

await check("its loose files are placed under bios/", () => {
  const placement = reg.dedicatedFolderPlacement(registry, biosFolder.usedBy);
  ok(placement, "a BIOS-marked folder must have a placement, or its root files keep bare names");
  eq(placement.fallback, "bios", "the placement must file loose BIOS files under bios/");
});

await check("romFolderSources carries that placement to the scan", () => {
  const [src] = scan.romFolderSources([biosFolder], registry);
  ok(src, "the BIOS folder must survive romFolderSources");
  ok(src.placement, "romFolderSources must pass the placement through, or applyPlacement is a no-op");
  eq(src.placement.fallback, "bios", "and it must be the bios placement");
});

await check("THE CHAIN: a root-level syscard3.pce becomes a bios/ key", () => {
  const [src] = scan.romFolderSources([biosFolder], registry);
  const placed = scan.applyPlacement(walked, src.placement);
  eq([...placed.keys()], ["bios/syscard3.pce"],
    "the file the owner put in his BIOS folder must come out under bios/");
});

await check("THE CHAIN: that key is recognised as a BIOS candidate", () => {
  const [src] = scan.romFolderSources([biosFolder], registry);
  const placed = scan.applyPlacement(walked, src.placement);
  const keys = [...placed.keys()].filter((k) => bios.isBiosFolderKey(k));
  eq(keys, ["bios/syscard3.pce"], "biosState only offers a candidate for a key it recognises");
});

await check("THE CHAIN: PCE-GO's System Card slot is filled", () => {
  const [src] = scan.romFolderSources([biosFolder], registry);
  const placed = scan.applyPlacement(walked, src.placement);
  const pool = [...placed]
    .filter(([k]) => bios.isBiosFolderKey(k))
    .map(([k, b]) => ({ where: "folder", path: k, bytes: b, size: b.length }));

  const needs = bios.collectBiosNeeds([{ repo: PCE_GO.repo, manifest: PCE_GO.manifest }], []);
  const slot = needs.find((n) => n.id === "syscard3");
  ok(slot, "PCE-GO must declare a syscard3 slot; without one nothing can fill it");
  eq(slot.biosDir, "pce", "the System Card lives in /bios/pce/, per the manifest's own comment");

  const found = bios.matchCandidates(slot, pool);
  eq(found.map((c) => c.path), ["bios/syscard3.pce"],
    "the file in the marked folder must fill the slot");
});

// --- THE ACTUAL BUG: marked for BIOS *and* a console ---------------------------------------
//
// This is what the owner had. He added BIOS to the `Used for` of directories that were already
// serving consoles, so `placedSystems` was non-empty and the BIOS branch never fired. The
// console took every loose file and `syscard3.pce` was filed `pce/syscard3.pce`, which
// `isBiosFolderKey` rejects. The file was in the folder he marked and the slot stayed empty.

const PCE_SYS = "gwrg-ng/pce-go-retro-go-sd#gnw-retro-go@pce";
const PCE_TARGET = "gwrg-ng/pce-go-retro-go-sd#gnw-retro-go";

const chain = (usedBy) => {
  const [src] = scan.romFolderSources([{ id: "f", handle: {}, status: "ready", usedBy }], registry);
  const placed = scan.applyPlacement(walked, src && src.placement);
  return [...placed.keys()];
};

await check("BIOS + one console still files the System Card as a BIOS", () => {
  eq(chain([BIOS_KEY, PCE_SYS]), ["bios/syscard3.pce"],
    "a folder marked for BIOS and a console must still place a declared BIOS name under bios/");
});

await check("BIOS + a whole target still files it", () => {
  eq(chain([BIOS_KEY, PCE_TARGET]), ["bios/syscard3.pce"],
    "the multi-system byExtension split must not swallow a declared BIOS name");
});

await check("the console still gets everything it actually claims", () => {
  // The fix takes the declared NAMES and nothing else. A real PC Engine ROM shares the
  // extension and must stay a game, or this traded one misfiling for another.
  const [src] = scan.romFolderSources(
    [{ id: "f", handle: {}, status: "ready", usedBy: [BIOS_KEY, PCE_SYS] }], registry);
  const rom = new Map([["Bonk's Adventure.pce", new Uint8Array(4)]]);
  eq([...scan.applyPlacement(rom, src.placement).keys()], ["pce/Bonk's Adventure.pce"],
    "a game sharing the BIOS extension belongs to the console");
});

await check("the name match is case-insensitive", () => {
  const [src] = scan.romFolderSources(
    [{ id: "f", handle: {}, status: "ready", usedBy: [BIOS_KEY, PCE_SYS] }], registry);
  const shouty = new Map([["SYSCARD3.PCE", new Uint8Array(8)]]);
  eq([...scan.applyPlacement(shouty, src.placement).keys()], ["bios/SYSCARD3.PCE"],
    "the card is FAT and the declaration is not a spelling test");
});

await check("the second declared spelling is honoured too", () => {
  const [src] = scan.romFolderSources(
    [{ id: "f", handle: {}, status: "ready", usedBy: [BIOS_KEY, PCE_SYS] }], registry);
  const alt = new Map([["syscard3.bin", new Uint8Array(8)]]);
  eq([...scan.applyPlacement(alt, src.placement).keys()], ["bios/syscard3.bin"],
    "PCE-GO declares syscard3.bin as well, and a slot accepts either");
});

await check("a console-only folder is untouched by any of this", () => {
  eq(chain([PCE_SYS]), ["pce/syscard3.pce"],
    "without the BIOS marking nothing changes, so the marking is still what does the work");
});

await check("the rescan signature moves when the BIOS names appear", () => {
  // ONE handle, shared. `romFolderSignature` mixes in a per-object handle token, so building
  // two folders with two fresh `{}` handles makes the signatures differ whatever the placement
  // does -- the check would pass against the unfixed code and prove nothing. That trap has
  // caught this repo before.
  const handle = {};
  const folder = (usedBy) => ({ id: "f", handle, status: "ready", usedBy });
  const plain = scan.romFolderSignature([folder([PCE_SYS])], registry);
  const withBios = scan.romFolderSignature([folder([BIOS_KEY, PCE_SYS])], registry);
  ok(plain !== withBios,
    "marking a folder for BIOS changes where its files land, so it must trigger a rescan");
});

// --- Where he picked, and when ------------------------------------------------------------
//
// The file arrives shaped differently depending on which folder was registered, and both shapes
// have to work. Registering `.../roms/` yields `bios/syscard3.pce` already (and `scanRomDirectory`
// strips a leading `roms/`, so registering the repo root yields the same); registering
// `.../roms/bios/` yields a bare `syscard3.pce` that only the placement can file.

await check("registered at roms/: an already-prefixed file is left alone", () => {
  const [src] = scan.romFolderSources(
    [{ id: "f", handle: {}, status: "ready", usedBy: [BIOS_KEY, PCE_SYS] }], registry);
  const nested = new Map([["bios/syscard3.pce", new Uint8Array(8)]]);
  eq([...scan.applyPlacement(nested, src.placement).keys()], ["bios/syscard3.pce"],
    "a file already under bios/ must not be moved again into bios/bios/");
});

await check("registered at roms/bios/: a bare file is placed", () => {
  const [src] = scan.romFolderSources(
    [{ id: "f", handle: {}, status: "ready", usedBy: [BIOS_KEY, PCE_SYS] }], registry);
  eq([...scan.applyPlacement(walked, src.placement).keys()], ["bios/syscard3.pce"],
    "the bare name is the case the placement exists for");
});

await check("TIMING: the signature moves when the core resolves, so a stale scan is redone", () => {
  // The placement is decided at SCAN time. A library scanned before the source resolved was
  // placed against a registry that knew no BIOS names; when the manifest lands the answer
  // changes, and the only thing that makes the library notice is the signature moving.
  const handle = {};
  const folder = [{ id: "f", handle, status: "ready", usedBy: [BIOS_KEY, PCE_SYS] }];
  const cold = scan.romFolderSignature(folder, reg.EMPTY_REGISTRY);
  const warm = scan.romFolderSignature(folder, registry);
  // NOTE what this does and does not pin. Here cold and warm differ in their FALLBACK too
  // (an unresolved registry owns no system, so everything loose goes to bios/), so this check
  // still passes with the token's `byFilename` suffix removed. The suffix is pinned by the
  // signature check above, where both sides resolve to `pce` and only the names differ.
  ok(cold !== warm,
    "a registry that has resolved its BIOS names must not share a signature with one that has not");
});

// --- Anti-vacuity: the fixture must be able to fail ---------------------------------------

await check("ARMED: an unmarked folder does NOT place its files under bios/", () => {
  const plain = { id: "f-plain", handle: {}, status: "ready", usedBy: [] };
  const [src] = scan.romFolderSources([plain], registry);
  const placed = scan.applyPlacement(walked, src && src.placement);
  eq([...placed.keys()], ["syscard3.pce"],
    "without the marking the file keeps its bare name, which is what makes the marking the cause");
});

await check("ARMED: a bare name is not a BIOS candidate", () => {
  ok(!bios.isBiosFolderKey("syscard3.pce"),
    "if a bare name counted, the placement would not be what makes this work and the test proves nothing");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`bios folder: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
