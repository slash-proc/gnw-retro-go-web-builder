/**
 * The file prompt, and the optional inputs it is the only way to supply.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/optionalinputs.mjs'
 *
 * The owner, twice, about the same modal:
 *
 *   "we need to bring back the modal window whenever a processor can handle optional files.
 *    And also the configure page needs to be fixed so that can be configured there after the
 *    fact."
 *
 * and, earlier, the objection that produced the behaviour being corrected here — that opening
 * a picker to ask for a file the app is already holding is noise. Both are right, and the rule
 * that satisfies both is not "has discovery found anything" but "can this input still take
 * another file". `prepareState.needsPrompt` used to ask the first question:
 *
 *     return !inputs.every((i) => this.discoveredFor(repo, i.id).length > 0);
 *
 * zelda3 declares `language` as optional + `allowMultiple` with eleven published variants, so
 * discovering the French ROM answered that `every(...)` and suppressed the prompt — leaving no
 * way to add the German one from the Library at all. One file is not eleven.
 *
 * The fixtures derive `selfContained`/`promptsForInput` from the REAL `inputNeed`, never by
 * hand: `needsPrompt` is a short function over those flags, so a fixture that simply declared
 * the flag it wanted would prove nothing about the rule it is meant to pin.
 *
 * `prepareState` is compiled here with `converter.ts` and `types.ts` in ONE splitting build for
 * the reason `sources/test/validate.mjs` documents: a second build would hand the module a
 * private copy of the error classes and every `instanceof` would silently take the fallback.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = new URL(".", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "gwrg-optional-"));
const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// --- Build -------------------------------------------------------------------------------------

const { gnwResolve } = await import("./gnwResolve.mjs");

// Only what reaches OUT of the process is faked — the converter (worker + WASM), the artifact
// fetch (network) and the locale table (a runes module of app strings). The rule under test,
// its bookkeeping and its error mapping all stay real.
const fake = {
  "homebrewConvert.js":
    "export async function convertHomebrewTitle(t, f) { return globalThis.__optFakes.convert(t, f); }",
  "installArtifacts.js":
    "export async function fetchTargetArtifacts(t) { return globalThis.__optFakes.artifacts(t); }",
  "locale.svelte.js":
    "export const locale = { t: { roms: { selectGames: {" +
    " convertFailed: (c) => `CF|${c}`, convertUnrecognised: (f) => `UR|${f}` } } } };",
};

const src = join(here, "../src/lib/sources");
await esbuild.build({
  entryPoints: [
    join(src, "prepareState.svelte.ts"),
    join(src, "converter.ts"),
    join(src, "types.ts"),
    // In THIS build, not the pure one: `parseToolInputs` throws `SourceError` from `types.ts`,
    // and a second build would hand it a private copy of that class.
    join(src, "inputGate.ts"),
  ],
  outdir: join(out, "prep"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [
    // `prepareState` -> `placement.ts` -> `engine/devicePaths.ts` -> `@gnw/fs-builders`. Keep
    // that package external and pointed at THIS checkout's dist, or esbuild tries to bundle the
    // littlefs WASM shim and the build dies with `Could not resolve "module"`.
    gnwResolve(join(here, ".")),
    {
      name: "optional-fakes",
      setup(build) {
        build.onResolve({ filter: /(homebrewConvert|installArtifacts|locale\.svelte)\.js$/ }, (a) => ({
          path: a.path.slice(a.path.lastIndexOf("/") + 1),
          namespace: "opt-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "opt-fake" }, (a) => ({
          contents: fake[a.path],
          loader: "js",
        }));
      },
    },
  ],
});

// `inputNeed` and the row rules are pure — a plain second build, no fakes needed.
await esbuild.build({
  entryPoints: [join(src, "inputPrompt.ts"), join(src, "fileRows.ts")],
  outdir: join(out, "pure"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolve(join(here, "."))],
});

const { prepareState } = await import(pathToFileURL(join(out, "prep", "prepareState.svelte.js")).href);
const { parseToolInputs } = await import(pathToFileURL(join(out, "prep", "inputGate.js")).href);
const { inputNeed, optionalTailStartsOpen } = await import(
  pathToFileURL(join(out, "pure", "inputPrompt.js")).href
);
const { rowOffersPicker, converterRowState, heldFileList, drawnFiles } = await import(
  pathToFileURL(join(out, "pure", "fileRows.js")).href
);
const { readFileSync } = await import("node:fs");

// --- Fixtures ----------------------------------------------------------------------------------

globalThis.__optFakes = {
  convert: async () => ({ files: new Map(), unrecognised: [], warnings: [] }),
  artifacts: async () => new Map(),
};

/** An input, defaulting to the shape that is easiest to get wrong: optional and repeatable. */
function input({ id = "base", required = false, allowMultiple = false, maxCount, extensions = [".sfc"] } = {}) {
  return {
    id,
    required,
    allowMultiple,
    ...(maxCount === undefined ? {} : { maxCount }),
    extensions,
    maxBytes: 1 << 20,
    variants: [],
    strict: false,
  };
}

/** Flags from the REAL rule, never hand-set — see the header. */
function flags(inputs) {
  const need = inputNeed(inputs);
  return { selfContained: need !== "required", promptsForInput: need !== "none" };
}

function title({ inputs = [], repo = "o/r", hasTool = inputs.length > 0 } = {}) {
  const f = flags(inputs);
  return {
    key: `${repo}#t`,
    repo,
    targetId: "t",
    label: "T",
    displayName: "T",
    deviceFiles: [],
    sourceExtensions: [],
    selfContained: f.selfContained,
    promptsForInput: f.promptsForInput,
    ...(hasTool ? { tool: { id: "conv", inputs, outputs: [], limits: {}, processor: {} } } : {}),
    target: { id: "t", artifacts: [] },
  };
}

const file = (filename, inputId) => ({ inputId, filename, bytes: new Uint8Array([1]) });

/** Put discovery's answer in place for one input, the way `inputDiscovery` would. */
function discover(repo, inputId, filenames) {
  prepareState.setDiscovered(repo, inputId, filenames.map((f) => file(f, inputId)), []);
}

function reset() {
  prepareState.discovered = new Map();
  prepareState.discoveredUnrecognised = new Map();
  prepareState.supplied = new Map();
  prepareState.removed = new Set();
  prepareState.variantOfFile = new Map();
}

// --- 1. The prompt opens for a tool that can take optional files --------------------------------

check("a tool whose inputs are ALL OPTIONAL still raises the prompt", () => {
  reset();
  const t = title({ inputs: [input({ id: "extra" })] });
  eq(t.selfContained, true, "all-optional really does run without the file");
  eq(t.promptsForInput, true, "and still has something to ask for");
  eq(prepareState.needsPrompt(t), true, "so the prompt must open — !selfContained would not");
});

check("a tool with NO inputs raises nothing and goes straight to artifacts", () => {
  reset();
  const t = title({ inputs: [], hasTool: true });
  eq(t.promptsForInput, false, "nothing declared, nothing to ask");
  eq(prepareState.needsPrompt(t), false, "straight to fetching artifacts");
});

check("a title with no tool at all raises nothing", () => {
  reset();
  eq(prepareState.needsPrompt(title({ inputs: [], hasTool: false })), false, "artifacts only");
});

// --- 2. Discovery closes an input only when it can take no more ---------------------------------

check("a single-file input discovery answered is closed — the picker is not re-opened for it", () => {
  reset();
  const t = title({ inputs: [input({ id: "base", required: true })] });
  discover("o/r", "base", ["zelda3.sfc"]);
  eq(prepareState.needsPrompt(t), false, "asking for a file we are holding is the noise the owner objected to");
});

// The same case, reached the way the app reaches it: from the RAW manifest zelda3 v0.3.0
// actually publishes. Its inputs carry the pre-`4eb5a86` `repeatable`, so `parseToolInputs`
// used to throw and none of the rule below was reachable at all — the Configure page showed
// "could not be read" and the Library raised no prompt. Pins that the shim and the rule meet.
check("THE ZELDA3 CASE, from the manifest AS PUBLISHED: the prompt is reachable at all", () => {
  reset();
  const parsed = parseToolInputs({
    inputs: [
      { id: "base", required: true, repeatable: false, extensions: [".sfc", ".smc"], maxBytes: 4194304 },
      { id: "language", required: false, repeatable: true, extensions: [".sfc", ".smc"], maxBytes: 4194304 },
    ],
  });
  eq(parsed[1].allowMultiple, true, "the old key still says the slot is repeatable");

  const t = title({ inputs: parsed });
  ok(t.promptsForInput, "the tool has something to ask for");
  discover("o/r", "base", ["zelda3.sfc"]);
  discover("o/r", "language", ["Legend of Zelda, The - A Link to the Past (France).sfc"]);
  eq(
    prepareState.needsPrompt(t),
    true,
    "French found, German not — on the manifest as published, which used to refuse outright",
  );
});

check("THE ZELDA3 CASE: an allowMultiple input is NOT closed by one discovered file", () => {
  reset();
  // zelda3's real shape once it republishes with `allowMultiple`: base required + single,
  // language optional + repeatable with eleven published variants.
  const t = title({
    inputs: [input({ id: "base", required: true }), input({ id: "language", allowMultiple: true })],
  });
  discover("o/r", "base", ["zelda3.sfc"]);
  discover("o/r", "language", ["zelda3_fr.sfc"]);
  eq(
    prepareState.needsPrompt(t),
    true,
    "French found, German not — the prompt is the only way to add it, so it must still open",
  );
});

check("an allowMultiple input IS closed once it reaches maxCount", () => {
  reset();
  const t = title({ inputs: [input({ id: "language", allowMultiple: true, maxCount: 2 })] });
  discover("o/r", "language", ["fr.sfc", "de.sfc"]);
  eq(prepareState.needsPrompt(t), false, "the slot is full; there is nothing further to offer");
});

check("a REQUIRED repeatable input IS closed once discovery answers it", () => {
  reset();
  // The boundary, and the half that is easy to lose while fixing the other: Doom's `base` is
  // required + allowMultiple + maxCount 32. Discovery finding its WADs genuinely answers the
  // question, and re-asking there is the noise the owner objected to first. Only an OPTIONAL
  // repeatable slot stays open, because only there is "more files" the user's call.
  const t = title({ inputs: [input({ id: "base", required: true, allowMultiple: true, maxCount: 32 })] });
  discover("o/r", "base", ["DOOM.WAD"]);
  eq(prepareState.needsPrompt(t), false, "required and answered — do not ask for a file we hold");
});

check("an unbounded allowMultiple input never closes", () => {
  reset();
  // Optional (`required` defaults false) + repeatable + no ceiling.
  const t = title({ inputs: [input({ id: "language", allowMultiple: true })] });
  discover("o/r", "language", ["a.sfc", "b.sfc", "c.sfc", "d.sfc"]);
  eq(prepareState.needsPrompt(t), true, "no maxCount means another file is always possible");
});

check("one closed input does not close its open sibling", () => {
  reset();
  const t = title({
    inputs: [input({ id: "base", required: true }), input({ id: "language", allowMultiple: true })],
  });
  discover("o/r", "base", ["zelda3.sfc"]);
  eq(prepareState.needsPrompt(t), true, "language has nothing at all — every() must not be fooled by base");
});

// --- 3. A core and a homebrew take the same path ------------------------------------------------

check("a CORE and a HOMEBREW answer needsPrompt identically", () => {
  // The recurring bug of this whole effort has been a core diverging from a homebrew. The rule
  // reads no kind at all, and this is what pins that: same inputs, same discovery, same answer.
  const shape = () => [input({ id: "base", required: true }), input({ id: "language", allowMultiple: true })];
  reset();
  const hb = title({ inputs: shape(), repo: "o/hb" });
  discover("o/hb", "base", ["a.sfc"]);
  discover("o/hb", "language", ["fr.sfc"]);
  const hbAnswer = prepareState.needsPrompt(hb);

  reset();
  const core = title({ inputs: shape(), repo: "o/core" });
  discover("o/core", "base", ["a.sfc"]);
  discover("o/core", "language", ["fr.sfc"]);
  const coreAnswer = prepareState.needsPrompt(core);

  eq(hbAnswer, true, "homebrew: the repeatable slot is still open");
  eq(coreAnswer, hbAnswer, "and a core answers the same — no kind is consulted");
});

// --- 4. Configure after the fact ----------------------------------------------------------------

check("an optional input NEVER supplied still renders a row, and that row offers a picker", () => {
  reset();
  // The Configure page builds one row per DECLARED input (`AdditionalFiles.svelte`'s loop over
  // `converterInputs`), so an untouched optional input is `add` — and `rowOffersPicker` is
  // unconditional, which is what makes supplying it later possible at all.
  const state = converterRowState(prepareState.isSatisfied("o/r", "language"));
  eq(state, "add", "never supplied, never discovered");
  eq(rowOffersPicker(state), true, "and the picker is still drawn — otherwise it could never be filled");
});

check("supplying an optional input later satisfies it, and the picker stays for a replacement", () => {
  reset();
  // `supplied` maps `<repo>#<inputId>` to the FILENAMES the run recorded — the same write
  // `run()` makes. The names are what let the Configure row state a count.
  prepareState.supplied = new Map([["o/r#language", new Set(["zelda3_fr.sfc"])]]);
  eq(prepareState.isSatisfied("o/r", "language"), true, "supplied after the fact");
  const state = converterRowState(true);
  eq(state, "found", "the row reads satisfied");
  eq(rowOffersPicker(state), true, "and can still be chosen again — the wrong dump must be replaceable");
});

check("a file supplied after the fact is what the next prepare runs on", () => {
  reset();
  const t = title({ inputs: [input({ id: "language", allowMultiple: true })] });
  prepareState.supplied = new Map([["o/r#language", new Set(["zelda3_fr.sfc"])]]);
  eq(prepareState.hasSupplied("o/r", "language"), true, "held for the run");
  // A supplied answer closes the question the prompt exists to ask: the user has answered it.
  eq(prepareState.needsPrompt(t), true, "discovery found nothing, so the prompt still offers the rest");
});


// --- 5. Multiple files on one input: the Configure row states how many ---------------------------
//
// The owner: "currently cores and homebrew just accept one file. they should match the zelda3
// example of allowing multiple files to be added dynamically depending on the manifest."
//
// The picker was never the broken half: `FilePromptModal` already sets `multiple` from
// `allowMultiple`, draws an add-another `+`, and caps at `slotsLeft`. What could not be said was
// on the CONFIGURE row, because `prepareState.supplied` was a `Set` of `<repo>#<inputId>` keys —
// a presence flag with no cardinality — so one `.wad` and thirty-two were the same row.
//
// These drive `run()` (the real write) rather than asserting on `slotsLeft`, which is already
// correct and would prove nothing about this page.

/** Drive the real `run()` for one title and report what `supplied` ended up holding. */
async function supply(t, filenames, inputId = "base") {
  await prepareState.run(t, filenames.map((f) => file(f, inputId)), []);
  return prepareState.suppliedCount(t.repo, inputId);
}

const doomTitle = title({
  inputs: [input({ id: "base", required: true, allowMultiple: true, maxCount: 32, extensions: [".wad"] })],
});
reset();
const doomHeld = await supply(doomTitle, [
  "doom.wad",
  "doom2.wad",
  "tnt.wad",
  "plutonia.wad",
]);

check("doom's shape: four .wad files on one allowMultiple input are all recorded", () => {
  eq(doomHeld, 4, "run() recorded every file, not just the last");
  const rows = heldFileList(prepareState.suppliedNames("o/r", "base"), []);
  eq(rows.length, 4, "the row draws FOUR rows, one per file");
  eq(
    rows.map((r) => r.filename).join(","),
    "doom.wad,doom2.wad,tnt.wad,plutonia.wad",
    "each by its own name, in the order they were picked",
  );
});

check("removing ONE of doom's wads leaves the other three", () => {
  prepareState.unsupplyFile("o/r", "base", "tnt.wad", []);
  const rows = heldFileList(prepareState.suppliedNames("o/r", "base"), []);
  eq(
    rows.map((r) => r.filename).join(","),
    "doom.wad,doom2.wad,plutonia.wad",
    "only the named file left; the whole-input Remove this replaced took all four",
  );
  eq(prepareState.isSatisfied("o/r", "base"), true, "and the input is still answered");
});

check("a per-file removal survives the next discovery pass", () => {
  // The memory that makes the `x` mean something: `setDiscovered` re-answers from the user's
  // registered folders whenever the signature moves, so without a per-FILE record the removed
  // file would be handed straight back and the removal would read as a no-op.
  eq(prepareState.isFileRemoved("o/r", "base", "tnt.wad"), true, "the removal is remembered");
  prepareState.setDiscovered("o/r", "base", [
    file("tnt.wad", "base"),
    file("sigil.wad", "base"),
  ]);
  const names = prepareState.discoveredFor("o/r", "base").map((f) => f.filename);
  eq(names.join(","), "sigil.wad", "the removed one is filtered out, the new one is not");
});

// Awaited OUT here: `check` is synchronous, so a promise returned from its body would resolve
// after the report and any failure inside it would never be counted.
const removedBefore = prepareState.isFileRemoved("o/r", "base", "tnt.wad");
await supply(doomTitle, ["tnt.wad"]);
const removedAfter = prepareState.isFileRemoved("o/r", "base", "tnt.wad");

check("re-picking a removed file is the way back in", () => {
  eq(removedBefore, true, "removed to begin with");
  eq(removedAfter, false, "answering the input again clears the per-file record");
});

const zelda3Base = title({
  inputs: [input({ id: "base", required: true, allowMultiple: false, extensions: [".sfc"] })],
});
reset();
const singleHeld = await supply(zelda3Base, ["zelda3.sfc"]);

check("zelda3's base: a single-file input draws its one file the same way", () => {
  eq(singleHeld, 1, "exactly one file");
  const rows = heldFileList(prepareState.suppliedNames("o/r", "base"), []);
  eq(rows.length, 1, "one row");
  eq(rows[0].filename, "zelda3.sfc", "named, not counted — the shape is the same at one file");
});

// openlara declares the same `allowMultiple` + `maxCount: 32` as doom but a different variant
// shape (21 labelled levels, no per-variant output `filename`). The row rule must not be tuned
// to doom's shape, so the same drive is repeated with openlara's extension and count.
const openlaraTitle = title({
  inputs: [input({ id: "level", required: true, allowMultiple: true, maxCount: 32, extensions: [".PHD"] })],
});
reset();
const olHeld = await supply(openlaraTitle, ["LEVEL1.PHD", "LEVEL2.PHD", "GYM.PHD"], "level");

check("openlara's shape: a differently-shaped multiple input lists the same way", () => {
  eq(olHeld, 3, "three levels held");
  const rows = heldFileList(prepareState.suppliedNames("o/r", "level"), []);
  eq(
    rows.map((r) => r.filename).join(","),
    "LEVEL1.PHD,LEVEL2.PHD,GYM.PHD",
    "three rows by name — the rule is not tuned to doom's shape",
  );
});

check("re-supplying the same file does not inflate the count", () => {
  eq(prepareState.suppliedCount("o/r", "level"), 3, "still three after the run above");
});

check("supplied SUPERSEDES discovered rather than being merged with it", () => {
  // `run()` falls back to discovery only when the caller offered nothing, so the same file
  // being both discovered and picked must not appear twice — which would also offer two
  // different removals for one file on disk.
  const both = heldFileList(["a.wad"], ["a.wad", "b.wad"]);
  eq(both.map((r) => r.filename).join(","), "a.wad", "a supplied list wins outright");
  eq(both[0].discovered, false, "and its row knows it was picked, not found");
  const found = heldFileList([], ["a.wad", "b.wad"]);
  eq(found.map((r) => r.filename).join(","), "a.wad,b.wad", "discovery answers when nothing was supplied");
  eq(found[0].discovered, true, "and those rows know they were found");
});

check("a discovered file is drawn by NAME, not as a bare Found", () => {
  // The owner's Base ROM row: auto-found in his folder, so it said `Found` and could not be
  // removed individually. Discovery's names are as real as a pick's.
  reset();
  prepareState.setDiscovered("o/r", "base", [file("zelda3.sfc", "base")]);
  const rows = heldFileList(
    prepareState.suppliedNames("o/r", "base"),
    prepareState.discoveredFor("o/r", "base").map((f) => f.filename),
  );
  eq(rows.length, 1, "one row for the discovered file");
  eq(rows[0].filename, "zelda3.sfc", "by its name");
  eq(rows[0].discovered, true, "marked as found rather than picked");
});

check("a restored session is held with no count, and invents none", () => {
  reset();
  // What `restore()` writes: the converted cache knows WHICH input was consumed, never by what.
  prepareState.supplied = new Map([["o/r#base", new Set()]]);
  eq(prepareState.hasSupplied("o/r", "base"), true, "the input is still held");
  eq(prepareState.suppliedCount("o/r", "base"), 0, "but the file names are not recoverable");
  eq(
    heldFileList(prepareState.suppliedNames("o/r", "base"), []).length,
    0,
    "so the row lists nothing and keeps the plain Found — an invented name is worse than none",
  );
});

check("restore() records the key with NO names, rather than fabricating one", () => {
  // The behavioural half of the check above. Driving the real `restore()` needs a BlobCache and
  // a ConvertedIndex, which this suite does not build (`convertedcache.mjs` owns those fakes), so
  // this pins the write SHAPE in source with comments stripped. A count invented here would make
  // every restored multi-file row claim a number the cache never held.
  const store = readFileSync(join(here, "../src/lib/sources/prepareState.svelte.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  ok(
    store.includes("this.supplied.set(key, new Set());"),
    "restore() writes an EMPTY name set — the cache knows the input, never the files",
  );
});

check("the Configure row is WIRED to the rule, not merely accompanied by it", () => {
  // The trap this pins: `heldFileCount`/`rowStatesCount` can be perfectly correct while
  // `AdditionalFiles.svelte` still renders a bare `found`. Comments are stripped first so the
  // note explaining the wiring cannot vouch for it.
  const src = readFileSync(join(here, "../src/lib/ui/AdditionalFiles.svelte"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  ok(/heldFileList\(/.test(src), "the row's held files come from the shared rule");
  ok(/prepareState\.suppliedNames\(/.test(src), "and its supplied half is the real name list");

  // ONE ROW PER FILE. Both the `{#each}` AND the `{#if}` guarding it, each verbatim — this
  // check did NOT bite on `{#if false && row.held.length > 0}` when it matched the `{#each}`
  // alone: the loop stays in the source while the branch draws nothing, which is precisely how
  // the count version shipped looking correct.
  const guard = src.indexOf("{#if row.held.length > 0}");
  ok(guard > 0, "the file list is guarded by the held list ALONE, nothing anded onto it");
  const eachFile = src.indexOf("{#each row.held as file (file.filename)}");
  ok(eachFile > guard, "and inside it, one drawn row per held file, keyed by its own filename");

  // …each with its OWN remove, carrying that file's name. `removeConverterFile(row.inputId)`
  // is the whole-input drop this replaced; it must not be what the per-file control calls.
  ok(
    /onclick=\{\(\) => removeOneFile\(inputId, file\.filename\)\}/.test(src),
    "each file's control removes THAT file, not the whole input",
  );
  ok(
    !/removeConverterFile\(row\.inputId/.test(src),
    "and the row-level whole-input Remove is gone from the converter branch",
  );

  // …and the HANDLER must honour the filename it is handed. Matching the call site alone is what
  // let a revert to whole-input removal pass 28/28: the markup still reads
  // `removeOneFile(inputId, file.filename)` while the body drops every file for the input. Read
  // the function's own text, comments stripped so this note cannot vouch for it.
  {
    const body = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const fn = body.slice(body.indexOf("function removeOneFile"));
    const end = fn.indexOf("\n  }");
    ok(end > 0, "removeOneFile's body was located");
    const decl = fn.slice(0, end);
    ok(
      /unsupplyFile\([^)]*filename/.test(decl),
      "removeOneFile passes the filename to unsupplyFile, not the whole input to unsupply",
    );
    ok(
      !/\bunsupply\(/.test(decl),
      "removeOneFile does not drop the whole input",
    );
  }

  // NO LABEL VARIES BY PLURALITY. The chip is one string; whether more can be added is
  // `row.canAdd`, drawn as the control being present or absent.
  ok(!/chooseFiles/.test(src), "the pluralised picker label is gone");
  ok(
    /row\.converter && row\.canAdd && rowOffersPicker\(row\.state\)/.test(src),
    "the picker's presence is what says another file can be added",
  );
  ok(!/addedCount/.test(src), "and the count is gone from the row entirely");
});

check("the picker is withheld exactly when the slot is full", () => {
  // `canAdd` is `slotsLeft(...) > 0`, the modal's own rule reused rather than restated. A
  // second rule here is how two surfaces drift into disagreeing about one manifest fact.
  const src = readFileSync(join(here, "../src/lib/ui/AdditionalFiles.svelte"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  ok(/canAdd:\s*slotsLeft\(input, held\.length\) > 0/.test(src), "from slotsLeft, over the held list");
});

check("the prompt opens PRE-POPULATED with what discovery already found", () => {
  // The owner: "pre-populate but with multiple optional files, prompt the user still in case
  // that's not everything." `needsPrompt`/`closedByDiscovery` already decide THAT it opens;
  // this is what it shows when it does. Without it the dialog opened blank over files the app
  // was holding, so the user could not see them and would re-pick the same ones.
  const modal = readFileSync(join(here, "../src/lib/ui/FilePromptModal.svelte"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  ok(/slots = \(prefill \?\? \[\]\)/.test(modal), "the reset effect seeds from `prefill`, not `[]`");
  ok(/declared\.has\(f\.inputId\)/.test(modal), "and only for inputs this prompt declares");
  const lib = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  ok(/prefill=\{/.test(lib), "and the LIBRARY passes it — the page the owner named");
  ok(/discoveredFor\(promptFor\?\.repo/.test(lib), "from discovery, for the title being prepared");
});

// --- 6. A held file leads with its VARIANT'S NAME where that name identifies it ----------------
//
// The owner: "You've only used the filename... I'd rather the filename be small and secondary to
// the label the file has if it has one. If the same label can be applied to multiple files, then
// we only show the filename because there's no other way to differentiate what we're seeing
// (OpenLara is like that)."

check("a file attributed to a variant leads with that variant's label", () => {
  const [row] = drawnFiles([{ filename: "zelda3_de.sfc", discovered: false, label: "German" }]);
  eq(row.lead, "German", "the label leads");
  eq(row.filename, "zelda3_de.sfc", "and the filename is still carried, subordinate to it");
});

check("a file no variant attributed leads with its filename ALONE", () => {
  // Real state, not a gap: a `strict: false` input accepts files no variant describes.
  const [row] = drawnFiles([{ filename: "mystery.sfc", discovered: true }]);
  eq(row.lead, undefined, "nothing to lead with but the name on disk");
});

check("a label covering SEVERAL held files falls back to the filename for each", () => {
  // OpenLara: every level file matches one `Level data` variant, so leading with it would print
  // one name over several different files and say nothing about which is which.
  const rows = drawnFiles([
    { filename: "CUT1.PKD", discovered: true, label: "Level data" },
    { filename: "LEVEL1.PHD", discovered: true, label: "Level data" },
  ]);
  eq(rows.filter((r) => r.lead === undefined).length, 2, "neither leads with the shared label");
});

check("only the COLLIDING files fall back, not the whole list", () => {
  const rows = drawnFiles([
    { filename: "a.pkd", discovered: true, label: "Level data" },
    { filename: "b.phd", discovered: true, label: "Level data" },
    { filename: "de.sfc", discovered: false, label: "German" },
  ]);
  eq(rows.map((r) => r.lead ?? "-").join(","), "-,-,German", "the unambiguous one keeps its name");
});

// `check` is synchronous, so the real `run()` is driven here, the way `supply()` above is.
reset();
const variantTitle = title({
  inputs: [input({ id: "base", allowMultiple: true, maxCount: 4, extensions: [".sfc"] })],
});
await prepareState.run(
  variantTitle,
  [
    { inputId: "base", filename: "de.sfc", bytes: new Uint8Array([1]), variantId: "v-de" },
    { inputId: "base", filename: "plain.sfc", bytes: new Uint8Array([2]) },
  ],
  [],
);

check("run() REMEMBERS which variant matched each supplied file", () => {
  eq(prepareState.variantFor("o/r", "base", "de.sfc"), "v-de", "the matched variant survives the run");
  eq(prepareState.variantFor("o/r", "base", "plain.sfc"), undefined, "and an unmatched file gains none");
});

check("a DISCOVERED file names its variant too — a found row leads like a picked one", () => {
  reset();
  prepareState.setDiscovered("o/r", "base", [
    { inputId: "base", filename: "de.sfc", bytes: new Uint8Array([1]), variantId: "v-de" },
  ]);
  eq(prepareState.variantFor("o/r", "base", "de.sfc"), "v-de", "read back off the discovered list");
  const wire = readFileSync(join(here, "../src/lib/sources/discoveryWire.svelte.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  ok(
    /const id = r\.found\[i\]\?\.variantId;/.test(wire) &&
      /return id === undefined \? f : \{ \.\.\.f, variantId: id \};/.test(wire),
    "and discovery actually attaches it, rather than dropping it on the floor",
  );
  ok(
    /prepareState\.setDiscovered\(repo, r\.inputId, files, r\.unrecognised\);/.test(wire),
    "and the ATTACHED list is what is recorded, not the untouched one",
  );
});

check("the Configure row is WIRED to lead with the label, not merely able to", () => {
  // A check on this file has failed to bite twice before by matching a call site while the
  // branch or the body it depended on was reverted. Both the branch condition AND the two
  // function bodies are matched verbatim here, comments stripped.
  const src = readFileSync(join(here, "../src/lib/ui/AdditionalFiles.svelte"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  // The BRANCH: leading with the label is a different element, not a different wording.
  const lead = src.indexOf("{#if file.lead}");
  ok(lead > 0, "the row branches on `file.lead` — the rule's answer, not on `label` directly");
  const hlead = src.indexOf('<span class="hlead">{file.lead}</span>');
  ok(hlead > lead, "and draws the label as the leading element");
  ok(
    src.indexOf('<span class="hname hsub">{file.filename}</span>') > hlead,
    "with the filename subordinate BESIDE it, not replaced by it",
  );
  const alone = src.indexOf('{:else}');
  ok(alone > hlead && src.indexOf('<span class="hname">{file.filename}</span>') > alone,
    "and the unattributed case draws the filename alone");

  // The RULE is applied, not bypassed: `heldFileList` alone would leave every `lead` unset.
  ok(/drawnFiles\(\s*heldFileList\(/.test(src), "the held list goes through `drawnFiles`");

  // The LABEL RESOLUTION body — where the localised label actually comes from.
  ok(
    /const id = prepareState\.variantFor\(source\.repo \?\? "", input\.id, filename\);/.test(src),
    "the label is looked up by the variant the gate matched for THAT file",
  );
  ok(
    /return v\?\.label === undefined \? undefined : pickText\(v\.label, lang\);/.test(src),
    "and resolved to the reader's locale, absent where the variant declares none",
  );

  // The PAIRING body: the gate cannot hand back copies (`inputDiscovery` tests `accepted`
  // membership by identity), so this is the only place a picked file gains its variant.
  ok(
    /for \(const v of r\.gate\.verdicts\) \{\s*if \(v\.variantId !== undefined\) byFile\.set\(`\$\{v\.inputId\}\\u0000\$\{v\.filename\}`, v\.variantId\);/.test(src),
    "verdicts are indexed by inputId+filename",
  );
  ok(
    /return id === undefined \? f : \{ \.\.\.f, variantId: id \};/.test(src),
    "and each offered file carries the id it was paired with",
  );
  ok(/withVariants\(r\)/.test(src), "with the prompt's submission actually going through it");
});

// --- The optional disclosure's starting state ---------------------------------------------------
//
// The owner, on the GBA BIOS prompt: "since the bios is optional, it starts hidden and I have to
// expand the optional section in order to actually be able to press the button to add the file.
// Since it's the only optional button, it doesn't need to be hidden and that counts even moreso
// since there are no mandatory files in the modal."
//
// The rule that satisfies it is REQUIRED being empty, not the optional count -- see
// `optionalTailStartsOpen`. These pin the decision, which is pure; whether the chevron then
// renders rotated is not something node can see.

check("THE GBA BIOS CASE: one optional input, nothing required, opens actionable", () => {
  eq(optionalTailStartsOpen([input({ id: "bios", required: false })]), true,
     "a prompt whose only input is optional must not hide it");
});

check("nothing required opens the tail however MANY optional inputs there are", () => {
  // The owner's "only optional button" is a consequence of the empty-required case, not a
  // second condition: hiding eight leaves exactly as little to do as hiding one.
  const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => input({ id, required: false }));
  eq(optionalTailStartsOpen(many), true, "eight optional inputs and nothing required still opens");
});

check("a REQUIRED input keeps the tail closed, which is what the disclosure is for", () => {
  eq(
    optionalTailStartsOpen([input({ id: "rom", required: true }), input({ id: "bios", required: false })]),
    false,
    "with something that must be supplied, the optional ones stay folded away",
  );
});

check("one required among many optional still keeps it closed", () => {
  const inputs = [input({ id: "rom", required: true }), ...["a", "b", "c"].map((id) => input({ id }))];
  eq(optionalTailStartsOpen(inputs), false, "any required input at all is enough to fold the tail");
});

check("no optional inputs means nothing to open", () => {
  // `splitPrompt` renders no tail at all in this case, so "starts open" would be a claim about
  // something that is not drawn.
  eq(optionalTailStartsOpen([input({ id: "rom", required: true })]), false, "no tail, nothing open");
  eq(optionalTailStartsOpen([]), false, "and an empty prompt opens nothing either");
});

check("the modal is WIRED to the rule, not merely accompanied by it", () => {
  // The trap: `optionalTailStartsOpen` can be perfectly correct while the modal still resets
  // `tailOpen = false` on open, which is exactly the shape that shipped. Comments are stripped
  // first so the note explaining the wiring cannot vouch for it.
  const src = readFileSync(join(here, "../src/lib/ui/FilePromptModal.svelte"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  ok(/optionalTailStartsOpen\(inputs\)/.test(src),
     "the reset asks the rule rather than hardcoding a state");
  ok(!/tailOpen = false/.test(src),
     "and the flat `tailOpen = false` reset is gone, or the rule never gets a say");
  // The error path must still force it open: an error can name an input inside the tail.
  ok(/if \(formError\) tailOpen = true/.test(src),
     "an error still opens the tail so it cannot name something the user cannot see");
});

// --- Report -------------------------------------------------------------------------------------

rmSync(out, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`optional inputs + configure-after-the-fact: ${passed} checks passed`);
