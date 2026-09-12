#!/usr/bin/env node
/**
 * "Must the user go and find a file before this works?" -- ONE derivation, three call sites.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/needsuserfiles.mjs'
 *
 * TWO FIELDS ARE NAMED `required`. spec/02-versions.md states the distinction and the
 * consequence of getting it wrong: `uses[].required` is "false if the install works without
 * it", `inputs[].required` is whether the tool can run at all, and "read the wrong one and
 * every such project warns about files it is about to install itself".
 *
 * Doom is the shape that broke the tie. It ships the shareware episode and converts the WADs a
 * user owns, so its converter still cannot run without a WAD while its install needs nothing.
 * The client read `inputs[].required` alone, so Doom came out `selfContained: false` and
 * demanded a file before it would install a game it carries in the bundle.
 *
 * THE WAD PATH IS PART OF THE CONTRACT, NOT A SIDE EFFECT. A user who owns Doom II still
 * supplies the WAD and it still converts, so `promptsForInput` must stay TRUE for exactly the
 * release whose `selfContained` just became true. The two are asserted together, on one title,
 * for that reason: a mutation that "fixes" one by suppressing the other fails here.
 *
 * ANTI-VACUITY. Every fixture is asserted to actually contain the thing it is about (a tool
 * with a required input, a BIOS with a url) before its verdict is checked, so a typo that
 * empties a fixture cannot pass by producing `false` for the wrong reason.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gnwResolve } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const out = mkdtempSync(join(tmpdir(), "gnw-needsuf-"));
// The REPO ROOT's node_modules, not `apps/web`'s: jszip is hoisted there, and the bundle it
// reaches stays external.
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");

const bundle = async (entry, name) => {
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/sources/", entry)],
    outfile: join(out, name),
    bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning",
    // `homebrewTitles` reaches `bundle.ts` transitively, whose one runtime dependency is jszip
    // -- a CJS package the "neutral" platform cannot resolve and which nothing here calls.
    external: ["@gnw/*", "jszip"],
    plugins: [gnwResolve(here)],
    define: { $state: "__rune", $derived: "__rune" },
    banner: { js: "const __rune = Object.assign((v) => v, { by: () => [] });" },
  });
  return import(pathToFileURL(join(out, name)).href);
};

const derive = await bundle("needsUserFiles.ts", "needsUserFiles.js");
const { manifestNeedsUserFiles, targetNeedsToolInput, targetNeedsBios } = derive;
const { titlesFor } = await bundle("homebrewTitles.svelte.ts", "homebrewTitles.js");

// --- Doom's published shape --------------------------------------------------------------------
// The release being tagged: a core binary, a WAD -> WHD converter whose input it cannot run
// without, and the shareware episode shipped beside them. `uses[].required` is the false.

const WAD_TOOL = {
  id: "doom-whd",
  processor: { type: "wasm", version: 1 },
  title: { en: "WAD to WHD" },
  binary: { file: "doom_whd.wasm", url: "doom_whd.wasm", bytes: 678369, sha256: "c".repeat(64) },
  limits: { maxMemoryPages: 512, maxOutputBytes: 25165824 },
  inputs: [{
    id: "base", required: true, allowMultiple: true, runPerFile: true,
    maxCount: 32, extensions: [".wad"], maxBytes: 33554432, strict: false,
  }],
  outputs: [{ id: "whd", extension: ".whd", maxBytes: 25165824 }],
};

const SHAREWARE = {
  id: "shareware",
  filename: "Doom - Shareware.whd",
  url: "Doom - Shareware.whd",
  bytes: 4196020,
  sha256: "b".repeat(64),
  label: { en: "Doom (shareware episode)" },
};

function doomManifest({ usesRequired = false, toolInputRequired = true, games = [SHAREWARE] } = {}) {
  const tool = structuredClone(WAD_TOOL);
  tool.inputs[0].required = toolInputRequired;
  return {
    schemaVersion: 1,
    project: "doom",
    title: "Doom",
    originalSystem: "dos",
    originalName: "DOOM",
    source: { repo: "slash-proc/doom-retro-go-sd", commit: "a".repeat(40), ref: "v0.2.1" },
    tools: [tool],
    targets: [{
      id: "gnw-retro-go", platform: "game-and-watch", kind: "core",
      label: "Game & Watch (Retro-Go SD)",
      requiresAbi: { version: 2, minSize: 832 },
      artifacts: [{ filename: "doom.bin", bytes: 319068, sha256: "d".repeat(64), url: "doom.bin" }],
      uses: [{ tool: "doom-whd", outputs: ["whd"], required: usesRequired }],
      systems: [{
        id: "doom", longName: "Doom", shortName: "Doom",
        extensions: [".whd"], browse: "file", compression: false,
        ...(games ? { games } : {}),
      }],
    }],
  };
}

const doomTitle = (m) => {
  const list = titlesFor("slash-proc/doom-retro-go-sd", m);
  ok(list.length === 1, `expected exactly one title, got ${list.length}`);
  return list[0];
};

// --- 1. The tool half --------------------------------------------------------------------------

await check("Doom as published needs nothing from the user", async () => {
  const m = doomManifest();
  // Anti-vacuity: the fixture really does carry the tool whose input is required, so a `false`
  // below can only come from `uses[].required`, never from an empty tools list.
  eq(m.tools[0].inputs[0].required, true, "fixture: the converter cannot run without a WAD");
  eq(m.targets[0].uses[0].required, false, "fixture: the install does not require the converter");
  eq(manifestNeedsUserFiles(m), false, "a tool the install does not require asks for nothing");
});

await check("the same release with a REQUIRED converter needs a file", async () => {
  eq(manifestNeedsUserFiles(doomManifest({ usesRequired: true })), true,
    "a required tool with a required input is the tool half of the rule");
});

await check("a required tool whose inputs are all optional needs nothing", async () => {
  // This is the half `bundle.ts` used to miss entirely: it read `uses[].required` and never
  // looked the tool up, so a required converter that asks for nothing counted as a demand.
  const m = doomManifest({ usesRequired: true, toolInputRequired: false });
  eq(m.targets[0].uses[0].required, true, "fixture: the tool IS required");
  eq(manifestNeedsUserFiles(m), false, "but it never asks for anything");
});

await check("a use naming a tool that does not exist needs nothing", async () => {
  const m = doomManifest({ usesRequired: true });
  m.targets[0].uses[0].tool = "no-such-tool";
  eq(manifestNeedsUserFiles(m), false, "there is no required input anywhere to find");
});

await check("a plain core with no tools at all needs nothing from the tool half", async () => {
  const m = doomManifest();
  m.tools = [];
  m.targets[0].uses = [];
  eq(targetNeedsToolInput(m.targets[0], []), false, "no uses, no demand");
});

// --- 2. The BIOS half --------------------------------------------------------------------------

const nesTarget = (bios) => ({
  id: "gnw-retro-go", platform: "game-and-watch", kind: "core", label: "Game & Watch",
  requiresAbi: { version: 1, minSize: 0 },
  artifacts: [{ filename: "fceumm.bin", url: "fceumm.bin", bytes: 1, sha256: "e".repeat(64) }],
  systems: [{ id: "nes", longName: "Nintendo", shortName: "NES", extensions: [".nes"], bios: [bios] }],
});

await check("a required BIOS the project does not ship is a demand", async () => {
  const t = nesTarget({ id: "disksys", filename: "disksys.rom", required: true });
  ok(t.systems[0].bios[0].url === undefined, "fixture: nothing to fetch");
  eq(targetNeedsBios(t), true, "PC Engine CD must not advertise false and then refuse to start");
});

await check("a required BIOS the project SHIPS is not a demand", async () => {
  const t = nesTarget({ id: "disksys", filename: "disksys.rom", required: true, url: "disksys.rom" });
  ok(typeof t.systems[0].bios[0].url === "string", "fixture: the project ships it");
  eq(targetNeedsBios(t), false,
    "otherwise every MSX install would warn about files it was about to install itself");
});

await check("a conditionally required BIOS counts, shipped or not", async () => {
  const unshipped = nesTarget({ id: "disksys", filename: "disksys.rom", requiredFor: [".fds"] });
  eq(targetNeedsBios(unshipped), true,
    "the flag cannot know which games somebody intends to play (spec/02-versions.md:78)");
  const shipped = nesTarget({ id: "disksys", filename: "disksys.rom", requiredFor: [".fds"], url: "d.rom" });
  eq(targetNeedsBios(shipped), false, "but a file in the bundle is still not one to go and find");
});

await check("an empty requiredFor list is not a demand", async () => {
  eq(targetNeedsBios(nesTarget({ id: "d", filename: "d.rom", requiredFor: [] })), false,
    "`(b.requiredFor ?? []).length > 0` -- an empty list names no condition");
});

await check("the two halves are an OR, not a replacement", async () => {
  const m = doomManifest();
  m.targets[0].systems[0].bios = [{ id: "x", filename: "x.rom", required: true }];
  eq(manifestNeedsUserFiles(m), true, "a needed BIOS demands a file even when no tool does");
});

// --- 3. What the user actually sees ------------------------------------------------------------

await check("Doom installs on its own AND still offers the converter", async () => {
  const t = doomTitle(doomManifest());
  eq(t.selfContained, true, "Doom ships a playable game; it must not demand a WAD to install");
  eq(t.promptsForInput, true,
    "THE WAD PATH. A user who owns Doom II still supplies the WAD and it still converts");
  ok(t.tool !== undefined, "the converter is still attached to the title");
  eq(t.sourceExtensions, [".wad"], "and the picker still knows what to ask for");
  eq(t.derivedOutputs, 1, "one .whd per WAD, name derived from the file converted");
});

await check("the same core with a REQUIRED converter is not self-contained", async () => {
  // The pre-Doom shape, and the control for the test above: nothing about `promptsForInput`
  // moved, so a mutation that hardcodes `selfContained: true` fails this one.
  const t = doomTitle(doomManifest({ usesRequired: true }));
  eq(t.selfContained, false, "a required converter with a required input is a demand");
  eq(t.promptsForInput, true, "and it still prompts");
});

await check("reading inputs[].required instead would break Doom", async () => {
  // The mutation this suite exists to catch, stated as data rather than as a spelling: the two
  // fields disagree here, and the title follows `uses[].required`.
  const m = doomManifest();
  const inputsSay = m.tools[0].inputs.some((i) => i.required);
  const usesSay = m.targets[0].uses[0].required;
  ok(inputsSay !== usesSay, "fixture: the two `required` fields must disagree, or this proves nothing");
  eq(doomTitle(m).selfContained, !usesSay, "selfContained follows uses[].required");
});

await check("a core whose converter asks for nothing does not prompt", async () => {
  const m = doomManifest({ toolInputRequired: false });
  const t = doomTitle(m);
  eq(t.promptsForInput, true, "an OPTIONAL input still prompts: skipping it leaves no way to supply the file");
  eq(t.selfContained, true, "and an optional input is not a demand either");

  // A title with NO converter asks for nothing. It has to be a HOMEBREW to exist at all: a core
  // with no runnable tool has nothing to prepare, so `titlesFor` drops it (and a tool declaring
  // no inputs is not runnable, which is why this is not written as `tools[0].inputs = []`).
  const plain = doomManifest();
  plain.tools = [];
  plain.targets[0].kind = "homebrew";
  plain.targets[0].uses = [];
  const bare = doomTitle(plain);
  eq(bare.promptsForInput, false, "no converter, nothing to ask for");
  eq(bare.selfContained, true, "and nothing to demand");
});

// --- 4. One project, one answer ----------------------------------------------------------------

await check("the store derives from the manifest rather than trusting the index", async () => {
  // spec/02-versions.md:92-93 -- "They must agree with the manifest; the manifest wins." A
  // publisher who updates a manifest without regenerating versions.json used to win here.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(join(here, "../src/lib/sources/store.svelte.ts"), "utf8"));
  ok(/needsUserFiles:\s*manifestNeedsUserFiles\(r\.manifest\)/.test(src),
    "store.svelte.ts must derive needsUserFiles, not copy r.entry.needsUserFiles");
  ok(!/needsUserFiles:\s*r\.entry\.needsUserFiles/.test(src), "the index copy must be gone");
});

await check("the bundle synthesiser uses the same function, over the whole manifest", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(join(here, "../src/lib/sources/bundle.ts"), "utf8"));
  ok(/needsUserFiles:\s*manifestNeedsUserFiles\(manifest\)/.test(src),
    "bundle.ts must share the derivation rather than hand-rolling one");
  ok(!/function needsUserFilesOf/.test(src), "the local copy that drifted must be gone");
});

if (failures.length > 0) {
  console.error(`needsuserfiles: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
if (passed === 0) { console.error("needsuserfiles: no checks ran"); process.exit(1); }
console.log(`needsuserfiles: ${passed} checks passed`);
