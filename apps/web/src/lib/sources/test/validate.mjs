/**
 * Validation for the WASM converter host (gwrg-dist-spec spec/04-processor.md, spec/05-host.md).
 *
 *   docker compose exec dev node apps/web/src/lib/sources/test/validate.mjs
 *
 * Plain node, no test framework — the repo's convention. The oracle for the hashing half is
 * node's own `crypto`; the oracle for the WASM half is V8, which is asked to instantiate the
 * same fixtures the verifier judged and must agree about them.
 *
 * The three things this exists to prove, in the task's own words:
 *
 *   - a module importing anything is refused                      -> "imports"
 *   - an oversized output claim is refused                        -> "output ceiling"
 *   - a detached-buffer-after-grow bug would be caught            -> "detach"
 *
 * The last one is the interesting one, and it is proved twice: once by showing the fixture
 * really does detach the host's buffer on `alloc`, and once by running a deliberately-naive
 * host beside the real one and watching only the naive one fail. A test that merely asserted
 * "the real host works" would pass just as happily against a host with the bug, if the
 * fixture never grew.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// The fixture's `outputName` is, since spec/04's amendment, the `id` of an `outputs[]`
// entry rather than a filename — the ABI string is unchanged, its meaning moved. Imported
// under its true name so no check below reads as if a module could name a file.
import {
  buildConverter,
  FIXTURE_OUTPUT_NAME as FIXTURE_OUTPUT_ID,
  FIXTURE_STAGE_NAME,
  FIXTURE_WARNING,
} from "./fixture.mjs";

// --- Tiny harness ----------------------------------------------------------------------------

let passed = 0;
const failures = [];

/**
 * Checks run ONE AT A TIME, in registration order.
 *
 * This is not a stylistic choice, it is a correctness requirement. Several helpers below
 * (`withMirror` and the three other fake-network helpers) stage their scenario by REPLACING the
 * global `fetch`, then restoring the previous value when their body settles. That is only sound
 * while exactly one such body is in flight. An earlier version of this harness called `fn()`
 * immediately and merely collected the promise, so every async check was started before any of
 * them had finished: all four helpers installed their fake over each other, and whichever one
 * happened to be installed when a check finally reached its `fetch` served every check at once.
 *
 * That produced *inverted* results rather than obvious noise — the "tampered bytes are refused"
 * check was quietly served the GOOD bytes by a neighbour's mirror and therefore passed its
 * download and failed its assertion, while the happy path was served a neighbour's empty mirror
 * and reported a network refusal. The trigger was innocuous: `installArtifacts.ts` gained a
 * cache lookup, which added one `await` before its `fetch`, and that was enough to move the
 * fetch out of the synchronous window that had been hiding the race.
 *
 * So: await each check before starting the next. Do not "optimise" this back into a
 * `Promise.all` — the suite's fake network is a process-global, and concurrency over a global
 * does not test what the check names say it tests.
 */
let queue = Promise.resolve();
function check(name, fn) {
  const record = (e) => void failures.push(`${name}: ${e && e.message ? e.message : e}`);
  queue = queue.then(async () => {
    try {
      await fn();
      passed++;
    } catch (e) {
      record(e);
    }
  });
}

/** Every registered check, settled. */
function allChecks() {
  return queue;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function bytesEq(a, b, msg) {
  assert(a.length === b.length, `${msg}: length ${a.length} != ${b.length}`);
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `${msg}: byte ${i}`);
}

/** Run `fn` and require it to throw a ConverterError with exactly this code. */
async function refuses(code, fn) {
  let threw;
  try {
    await fn();
  } catch (e) {
    threw = e;
  }
  assert(threw, `expected a refusal with code "${code}", got success`);
  eq(threw.code, code, `wrong refusal (detail: ${threw.detail ?? threw.message})`);
  return threw;
}

// --- Build the TypeScript under test ----------------------------------------------------------
//
// The host is TypeScript inside a Vite app, and node 20 does not strip types. esbuild is
// already in the tree (Vite's own), so the script compiles the modules it needs into a temp
// directory and imports the result. Nothing is installed and nothing is written to the repo.

const here = new URL(".", import.meta.url).pathname;
// Same reason as the esbuild plugin: a bare `import("@gnw/fs-builders")` goes through node's
// resolver, which in a worktree lands in the MAIN clone.
const gnwImportFs = async () => {
  const { gnwImport } = await import("../../../../test/gnwResolve.mjs");
  return gnwImport(new URL("../../../../test/x.mjs", import.meta.url).href, "fs-builders");
};
const out = mkdtempSync(join(tmpdir(), "gwrg-converter-"));
// The compiled modules live outside the workspace, so node's resolver would never find the
// externals they import. One link, into the temp directory, fixes that without writing
// anything to the repo.
symlinkSync(join(here, "../../../../../../node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
// `placement.ts` -> `engine/devicePaths.ts` -> `@gnw/fs-builders`. Keep it external and
// pointed at THIS checkout's `dist/` (see `apps/web/test/gnwResolve.mjs`); a worktree's
// node_modules symlink would otherwise run the MAIN clone's build.
const { gnwResolve } = await import("../../../../test/gnwResolve.mjs");
await esbuild.build({
  plugins: [gnwResolve(join(here, "../../../../test"))],
  entryPoints: [
    join(here, "../converter.ts"),
    join(here, "../converterRun.ts"),
    join(here, "../wasmVerify.ts"),
    join(here, "../inputGate.ts"),
    join(here, "../inputPrompt.ts"),
    join(here, "../inputDiscovery.ts"),
    join(here, "../installArtifacts.ts"),
    join(here, "../blobCache.ts"),
    join(here, "../client.ts"),
    join(here, "../bundle.ts"),
    join(here, "../bundleStore.ts"),
    join(here, "../metaLine.ts"),
    join(here, "../metaFacts.ts"),
    join(here, "../fileRows.ts"),
    join(here, "../installRows.ts"),
    join(here, "../errorText.ts"),
    join(here, "../summaryRows.ts"),
    join(here, "../homebrewConvert.ts"),
    join(here, "../outputNames.ts"),
    join(here, "../placement.ts"),
  ],
  outdir: out,
  bundle: true,
  splitting: true, // one shared instance of each module across the four entry points
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // bundle.ts's one runtime dependency stays EXTERNAL. jszip is a CJS package that reaches
  // for node's own `buffer`/`stream`/`util` through readable-stream, so bundling it into a
  // `platform: neutral` build cannot work and switching the whole build to `platform: node`
  // to accommodate it would weaken what the other entry points are compiled as. Node resolves
  // it at import time instead — see the node_modules link below.
  external: ["jszip", "module"],
  logLevel: "warning",
});

const load = (name) => import(pathToFileURL(join(out, name)).href);
const { verifyConverterModule, parseWasm } = await load("wasmVerify.js");
const { runConverterModule, isPlainFilename } = await load("converterRun.js");
const { gateInputs, checkProcessor, parseToolInputs, parseToolOutputs, parseToolLimits, sha1Hex } =
  await load("inputGate.js");
const { runConverter, prepareTool, gateAndRun } = await load("converter.js");
const { fetchTargetArtifacts } = await load("installArtifacts.js");
const { BlobCache, nullBlobBackend } = await load("blobCache.js");
const { parseManifest, parseVersions } = await load("client.js");
const { pickText, acceptAttr, oversize, promptOrder, slotsLeft, inputNeed, splitPrompt, acceptsFolder } =
  await load("inputPrompt.js");
const {
  discoverInput,
  discoverInputs,
  extensionCandidates,
  sizePlausible,
  capacityOf,
  foldersToSearch,
  libraryCandidates,
  folderCandidates,
  declaredExtensions,
} = await load("inputDiscovery.js");
const { importBundle } = await load("bundle.js");
const { systemsSegment, metaSegments } = await load("metaLine.js");
const { errorMessageKind, errorText, prepareMessageKind, prepareText } = await load("errorText.js");
const { SUMMARY_ROW_ORDER, summaryRowKeys, composeSummaryRows, biosSummaryDecision } =
  await load("summaryRows.js");
const { resolveOutputName, convertHomebrewTitle, planRuns } = await load("homebrewConvert.js");
const { converterOutputDir, artifactDir, assetPrefix, normalizeDir, useForTool, homebrewDir, coresDir, outputSubdir, HOMEBREW_KEY_PREFIX } =
  await load("placement.js");
// The manifest-declared install locations placement now reads. `resolveInstallPaths` is the
// one place a manifest path becomes an internal key, so the fixtures below are built with it
// rather than by hand — a renamed role has to survive the REAL normalizer.
const { resolveInstallPaths, DEFAULT_INSTALL_PATHS } = await gnwImportFs();
const { planNames, foldName, foldDir, describeCollision, firstCollisionError } = await load("outputNames.js");

// --- Shared fixtures ---------------------------------------------------------------------------

const LIMITS = { maxMemoryPages: 64, maxOutputBytes: 1024 * 1024 };
// The id the module emits and the filename on the card are deliberately DIFFERENT strings
// here, so a host that still matched on `filename` fails every run below instead of
// passing by coincidence.
const OUTPUT_SPECS = [{ id: FIXTURE_OUTPUT_ID, filename: "assets.dat", maxBytes: 1024 * 1024 }];
const PAYLOAD = new Uint8Array(1024).map((_, i) => (i * 7 + 11) & 0xff);
const RUN_INPUT = [{ inputId: "base", filename: "rom.sfc", bytes: PAYLOAD }];

const runBaseline = (wasm, extra = {}) =>
  runConverterModule({ wasm, inputs: RUN_INPUT, limits: LIMITS, outputs: OUTPUT_SPECS, ...extra });

// ============================================================================================
// 1. The verifier, on bytes, before anything is instantiated
// ============================================================================================

check("verify: the baseline module passes", () => {
  const v = verifyConverterModule(buildConverter(), LIMITS);
  eq(v.memory.maxPages, 4, "declared maximum");
  eq(v.info.imports.length, 0, "imports");
});

check("verify: parseWasm finds every ABI export", () => {
  const info = parseWasm(buildConverter());
  const names = new Set(info.exports.map((e) => e.name));
  for (const n of ["abi_version", "alloc", "run_begin", "run_step", "output_len", "memory"]) {
    assert(names.has(n), `missing ${n}`);
  }
});

// >>> PROOF 1: a module importing anything is refused. <<<
check("imports: ONE import is one too many", async () => {
  const wasm = buildConverter({ withImport: true });
  // The import is really there, and it is really a valid module — V8 will happily instantiate
  // it when handed the import it asks for, so the refusal is the verifier's doing and not an
  // accident of a malformed binary.
  eq(parseWasm(wasm).imports.length, 1, "fixture should declare one import");
  await WebAssembly.instantiate(await WebAssembly.compile(wasm), { env: { now: () => 0 } });

  const e = await refuses("imports-forbidden", () => verifyConverterModule(wasm, LIMITS));
  assert(e.detail.includes("env.now"), `detail should name the import, got ${e.detail}`);
});

check("imports: refused at the driver too, before instantiating", () =>
  refuses("imports-forbidden", () => runBaseline(buildConverter({ withImport: true }))));

check("imports: instantiating with NO import object is what the engine enforces", async () => {
  // The other half of the requirement. The baseline takes no imports, so this succeeds; a
  // module that needed one would fail HERE even if the verifier above had a bug.
  const m = await WebAssembly.compile(buildConverter());
  const inst = await WebAssembly.instantiate(m);
  assert(typeof inst.exports.run_step === "function", "run_step");
  await refuses("imports-forbidden", () => verifyConverterModule(buildConverter({ withImport: true }), LIMITS));
});

check("verify: unbounded memory is refused", () =>
  refuses("unbounded-memory", () => verifyConverterModule(buildConverter({ memMax: null }), LIMITS)));

check("verify: a declared maximum over limits.maxMemoryPages is refused", () =>
  refuses("memory-too-large", () =>
    verifyConverterModule(buildConverter({ memMax: 4096 }), { ...LIMITS, maxMemoryPages: 64 }),
  ));

check("verify: a maximum exactly at the limit is allowed", () => {
  verifyConverterModule(buildConverter({ memMax: 64 }), { ...LIMITS, maxMemoryPages: 64 });
});

check("verify: a missing ABI export is refused", async () => {
  const e = await refuses("missing-export", () =>
    verifyConverterModule(buildConverter({ omitExport: "alloc" }), LIMITS),
  );
  eq(e.detail, "alloc", "should name the missing export");
});

check("verify: an extra exported function is refused", async () => {
  const e = await refuses("extra-export", () => verifyConverterModule(buildConverter({ extraExport: true }), LIMITS));
  eq(e.detail, "surprise", "should name the extra export");
});

check("verify: a wrong signature is refused even though the name is right", () =>
  refuses("bad-export", () => verifyConverterModule(buildConverter({ badSignature: "alloc" }), LIMITS)));

check("verify: `memory` exported as a global is refused", () =>
  refuses("bad-export", () => verifyConverterModule(buildConverter({ memoryNotAMemory: true }), LIMITS)));

check("verify: each magic byte is checked individually", async () => {
  // Mutation audit: flipping any `||` in the four-byte magic test to `&&` (so that one wrong
  // byte no longer refuses) left the suite green — the only junk fixture had ALL four bytes
  // wrong, which a broken chain still rejects. One corruption at a time is what pins it.
  for (let i = 0; i < 4; i++) {
    const bad = buildConverter();
    bad[i] ^= 0xff;
    await refuses("bad-binary", () => verifyConverterModule(bad, LIMITS));
  }
  // Armed: the untouched fixture these were derived from verifies.
  verifyConverterModule(buildConverter(), LIMITS);
});

check("verify: a non-positive or fractional limits.maxMemoryPages is refused", async () => {
  // The manifest is untrusted input here too; a 0 or NaN ceiling must not read as "unlimited".
  for (const bad of [0, -1, 1.5, Number.NaN, "64"]) {
    await refuses("memory-too-large", () =>
      verifyConverterModule(buildConverter({ memMax: 64 }), { ...LIMITS, maxMemoryPages: bad }),
    );
  }
  // Armed: the same module against a legal ceiling passes.
  verifyConverterModule(buildConverter({ memMax: 64 }), { ...LIMITS, maxMemoryPages: 64 });
});

check("verify: junk is refused as bad-binary, not as a crash", async () => {
  await refuses("bad-binary", () => verifyConverterModule(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), LIMITS));
  await refuses("bad-binary", () => verifyConverterModule(new Uint8Array(0), LIMITS));
  await refuses("bad-binary", () => verifyConverterModule(buildConverter().subarray(0, 40), LIMITS));
  // A real module with a plausible header but a corrupt section length.
  const trunc = buildConverter();
  trunc[9] = 0xff;
  await refuses("bad-binary", () => verifyConverterModule(trunc, LIMITS));
});

// ============================================================================================
// 2. The stepped run
// ============================================================================================

check("run: the baseline converts, steps, warns", async () => {
  const seen = [];
  const r = await runBaseline(buildConverter(), { onProgress: (p) => seen.push(p) });

  eq(r.outputs.length, 1, "one output");
  eq(r.outputs[0].name, FIXTURE_OUTPUT_ID, "the string the module emitted");
  eq(r.outputs[0].outputId, FIXTURE_OUTPUT_ID, "matched against outputs[] BY ID");
  bytesEq(r.outputs[0].bytes, PAYLOAD, "echoed payload");

  // The STEPPED path is the one that ran: two "more work" steps then a "done".
  eq(r.steps, 3, "run_step calls");
  eq(seen.length, 2, "progress callbacks");
  eq(seen[0].count, 2, "stage_count");
  eq(seen[0].stage, FIXTURE_STAGE_NAME, "stage name read out of module memory");
  eq(seen[1].index, 2, "stage_index advanced");

  // Warnings are text the module chose, split on newlines.
  eq(r.warnings.length, 1, "one warning");
  eq(r.warnings[0], FIXTURE_WARNING, "warning text");
});

check("run: a foreign abi_version is refused, not guessed at", async () => {
  const e = await refuses("unsupported-abi", () => runBaseline(buildConverter({ abiVersion: 2 })));
  eq(e.detail, "2", "should report the version it saw");
  await refuses("unsupported-abi", () => runBaseline(buildConverter({ abiVersion: 0 })));
});

check("run: a non-zero run_begin surfaces the module's own message", async () => {
  const e = await refuses("module-error", () => runBaseline(buildConverter({ beginError: 7 })));
  assert(e.detail.startsWith("7: "), `should carry the code, got ${e.detail}`);
  assert(e.detail.includes("fixture failed on purpose"), `should carry the message, got ${e.detail}`);
});

check("run: a non-zero run_step surfaces the module's own message", async () => {
  const e = await refuses("module-error", () => runBaseline(buildConverter({ stepError: 9 })));
  assert(e.detail.startsWith("9: "), `got ${e.detail}`);
});

check("run: a module that never finishes is stopped by the step ceiling", async () => {
  const e = await refuses("no-progress", () => runBaseline(buildConverter({ neverFinish: true }), { maxSteps: 50 }));
  eq(e.detail, "50 steps", "should report where it gave up");
});

// ============================================================================================
// 3. Untrusted lengths and names
// ============================================================================================

// >>> PROOF 2: an oversized output claim is refused. <<<
check("output ceiling: a 2 GB claim is refused before a byte is copied", async () => {
  // The module's memory is at most 4 pages = 256 KiB. It claims 2 GB. A host that believed
  // the claim would try to allocate 2 GB, or read wildly out of bounds, before finding out.
  const e = await refuses("output-too-large", () => runBaseline(buildConverter({ outputLen: 0x7ffffff0 })));
  assert(e.detail.includes("2147483632"), `should report the claim, got ${e.detail}`);
});

check("output ceiling: limits.maxOutputBytes is enforced", () =>
  refuses("output-too-large", () =>
    runConverterModule({
      wasm: buildConverter({ outputLen: 4096 }),
      inputs: RUN_INPUT,
      limits: { ...LIMITS, maxOutputBytes: 100 },
      outputs: OUTPUT_SPECS,
    }),
  ));

check("output ceiling: the output's OWN maxBytes is enforced, even under a looser tool limit", () =>
  refuses("output-too-large", () =>
    runConverterModule({
      wasm: buildConverter({ outputLen: 4096 }),
      inputs: RUN_INPUT,
      limits: LIMITS, // 1 MiB, comfortably above 4096
      outputs: [{ id: FIXTURE_OUTPUT_ID, filename: "assets.dat", maxBytes: 100 }],
    }),
  ));

check("bounds: ptr + len is checked against the live buffer", () =>
  refuses("out-of-bounds", () => runBaseline(buildConverter({ outputPtr: 0x7f000000, outputLen: 16 }))));

check("names: a path is not a plain string, even as an id", async () => {
  for (const bad of ["a/b.dat", "..\\out.dat", "sub/out.dat"]) {
    await refuses("output-name", () =>
      runConverterModule({
        wasm: buildConverter({ outputName: bad }),
        inputs: RUN_INPUT,
        limits: LIMITS,
        outputs: [{ id: bad, filename: "assets.dat", maxBytes: 1 << 20 }], // even if the manifest declared it
      }),
    );
  }
});

check("names: the strict pattern, directly", () => {
  for (const good of [
    "out.dat",
    "Super Mario World.bin",
    "a.b.c",
    // TRANSITIONAL EXPECTATION CORRECTED, gwrg-dist-spec `fb4c8be`. `x..y` was in the refused
    // list below, from a `.includes("..")` belt-and-braces rule. The spec now says outright
    // that "a separator still cannot appear, which is the only exclusion that was ever about
    // safety" -- and with both separators excluded from the character class, `..` can never be
    // a path segment. Refusing it mid-name only rejected legal card names.
    "x..y",
  ]) {
    assert(isPlainFilename(good), good);
  }
  for (const bad of [
    "",
    ".",
    "..",
    "a/b",
    "a\\b",
    "a\x00b",
    "a\x1fb",
    "a\x7fb",
    " leading.dat",
    "trailing.dat ",
    // `fb4c8be` additions: what FAT and exFAT themselves refuse, plus a leading or trailing dot.
    'a"b.dat',
    "a*b.dat",
    "a:b.dat",
    "a<b.dat",
    "a>b.dat",
    "a?b.dat",
    "a|b.dat",
    ".leading.dat",
    "trailing.dat.",
    "x".repeat(201),
    "x".repeat(256),
  ]) {
    assert(!isPlainFilename(bad), `should have refused ${JSON.stringify(bad)}`);
  }
});

check("names: a well-formed id the manifest never declared is refused", () =>
  refuses("unknown-output", () => runBaseline(buildConverter({ outputName: "other" }))));

// TRANSITIONAL, and a deliberate reversal of the rule this check used to assert. spec/04's
// amendment (`4eb5a86`) changed the emitted string from a FILENAME to an `id`; modules built
// before it still emit the filename, and `smw-retro-go-sd` v0.4.1 is one — conformant in its
// manifest, shipping a `smw_restool.wasm` that emits `"smw_assets.dat"` where the manifest
// declares `outputs[0].id === "assets"`. Refusing it produced `Couldn't prepare: unknown-output`
// on a conversion that otherwise succeeded, so `outputSpecFor` accepts the declared filename as
// a fallback. See its comment for the sunset and for why the fallback cannot re-route a
// conformant module. If the project rebuilds its module to emit the id, delete that fallback
// and this check goes back to `refuses("unknown-output", ...)`.
check("names: a pre-4eb5a86 module emitting the declared FILENAME still resolves", async () => {
  const r = await runBaseline(buildConverter({ outputName: "assets.dat" }));
  eq(r.outputs[0].name, "assets.dat", "the string the module actually emitted is reported as-is");
  eq(r.outputs[0].outputId, FIXTURE_OUTPUT_ID, "but it resolves to the declared output's ID");
});

// The fallback must never re-route a module that got it right. The two outputs below are
// crossed on purpose — one output's `filename` IS the other's `id` — because that is the only
// arrangement in which precedence is observable at all: with the fixture's own specs the two
// lookups can never both hit, so an order-swapped resolver would pass either way.
check("names: the id WINS over another output's filename", async () => {
  const r = await runConverterModule({
    wasm: buildConverter({ outputName: FIXTURE_OUTPUT_ID }),
    inputs: RUN_INPUT,
    limits: LIMITS,
    outputs: [
      { id: "decoy", filename: FIXTURE_OUTPUT_ID, maxBytes: 1024 * 1024 },
      { id: FIXTURE_OUTPUT_ID, filename: "assets.dat", maxBytes: 1024 * 1024 },
    ],
  });
  eq(r.outputs[0].outputId, FIXTURE_OUTPUT_ID, "resolved by ID, not by the decoy's filename");
});

// A derived output has no declared name, so nothing about it can be emitted as one.
check("names: a DERIVED output cannot be addressed by name — it has none", () =>
  refuses("unknown-output", () =>
    runConverterModule({
      wasm: buildConverter({ outputName: "assets.dat" }),
      inputs: RUN_INPUT,
      limits: LIMITS,
      outputs: [{ id: FIXTURE_OUTPUT_ID, extension: ".dat", maxBytes: 1024 * 1024 }],
    })));

// Two outputs sharing a filename cannot be told apart, and guessing would write one output's
// bytes under the other's name.
check("names: an AMBIGUOUS filename is refused rather than guessed", () =>
  refuses("unknown-output", () =>
    runConverterModule({
      wasm: buildConverter({ outputName: "assets.dat" }),
      inputs: RUN_INPUT,
      limits: LIMITS,
      outputs: [
        { id: "a", filename: "assets.dat", maxBytes: 1024 * 1024 },
        { id: "b", filename: "assets.dat", maxBytes: 1024 * 1024 },
      ],
    })));

check("names: two outputs with the same id would silently overwrite, so they are refused", () =>
  refuses("unknown-output", () => runBaseline(buildConverter({ outputCount: 2 }))));

check("names: an implausible output_count is refused before any name is read", () =>
  refuses("output-too-large", () => runBaseline(buildConverter({ outputCount: 100000 }))));

// ============================================================================================
// 4. Memory growth
// ============================================================================================

// >>> PROOF 3: a detached-buffer-after-grow bug would be caught. <<<
check("detach: the fixture really does detach the host's buffer on alloc", async () => {
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(buildConverter()));
  const before = new Uint8Array(inst.exports.memory.buffer);
  eq(before.byteLength, 65536, "one page before alloc");

  const ptr = inst.exports.alloc(1024);
  // alloc grows, so `before` is now a view onto a detached ArrayBuffer.
  eq(before.byteLength, 0, "the pre-alloc view must be detached");
  assert(inst.exports.memory.buffer.byteLength > 65536, "memory should have grown");
  // And the pointer it handed back is in the region that only exists after the growth.
  assert(ptr >= 65536, `bump pointer should land past page 0, got ${ptr}`);
});

check("detach: a host that caches memory.buffer produces the WRONG answer on this fixture", async () => {
  // The naive host — the bug spec/05 says is the easiest one to write. It captures the view
  // once, exactly as the spec's own snippet reads if you hoist one line out of the loop.
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(buildConverter()));
  const cached = new Uint8Array(inst.exports.memory.buffer); // <- the bug
  let naiveFailed = false;
  try {
    inst.exports.input_clear();
    const ptr = inst.exports.alloc(PAYLOAD.length);
    cached.set(PAYLOAD, ptr); // throws: `cached` is detached and ptr is past its end
    inst.exports.input_add(ptr, PAYLOAD.length);
    inst.exports.run_begin(0);
    while (inst.exports.run_step() === 1);
    const got = new Uint8Array(inst.exports.memory.buffer, inst.exports.output_ptr(0), PAYLOAD.length);
    naiveFailed = !got.every((b, i) => b === PAYLOAD[i]);
  } catch {
    naiveFailed = true;
  }
  assert(naiveFailed, "the naive host should NOT have survived this fixture");

  // The real host, same fixture, correct bytes. This pair is the whole point: the assertion
  // above proves the fixture is capable of catching the bug, and the one below proves the
  // host under test does not have it.
  const r = await runBaseline(buildConverter());
  bytesEq(r.outputs[0].bytes, PAYLOAD, "the real host re-reads memory.buffer and gets it right");
});

check("detach: several inputs, several growths", async () => {
  const a = new Uint8Array(2000).fill(0xa5);
  const b = new Uint8Array(3000).fill(0x5a);
  const r = await runConverterModule({
    wasm: buildConverter({ memMax: 16 }),
    // The fixture echoes the LAST input it was given, so the second one is what comes back —
    // which only holds if every alloc/set pair re-derived its view.
    inputs: [
      { inputId: "base", filename: "a.bin", bytes: a },
      { inputId: "base", filename: "b.bin", bytes: b },
    ],
    limits: LIMITS,
    outputs: OUTPUT_SPECS,
  });
  bytesEq(r.outputs[0].bytes, b, "second input echoed intact after a second growth");
});

// ============================================================================================
// 5. The input gate: `strict`, `variants[]`, `maxBytes`
// ============================================================================================

/** Oracle: node's own SHA-1, not the implementation under test. */
const sha1Oracle = (bytes) => createHash("sha1").update(bytes).digest("hex");

const ROM = new Uint8Array(512).map((_, i) => (i * 31) & 0xff);
const ROM_SHA1 = sha1Oracle(ROM);
const OTHER = new Uint8Array(512).fill(0x42);

check("gate: sha1Hex agrees with node's crypto", async () => {
  eq(await sha1Hex(ROM), ROM_SHA1, "sha1 of the fixture ROM");
  eq(await sha1Hex(new Uint8Array(0)), sha1Oracle(new Uint8Array(0)), "sha1 of nothing");
  // A subarray must hash its own window, not the whole backing buffer.
  const big = new Uint8Array(1024);
  big.set(ROM, 256);
  eq(await sha1Hex(big.subarray(256, 768)), ROM_SHA1, "sha1 of a subarray view");
});

const strictSpec = [
  {
    id: "base",
    required: true,
    allowMultiple: false,
    extensions: [".sfc"],
    maxBytes: 1024,
    variants: [{ id: "us", sha1: ROM_SHA1.toUpperCase(), bytes: 512 }],
    strict: true,
  },
];
const looseSpec = [{ ...strictSpec[0], strict: false }];

check("gate: a recognised file is accepted and named", async () => {
  const g = await gateInputs(strictSpec, [{ inputId: "base", filename: "rom.sfc", bytes: ROM }]);
  eq(g.errors.length, 0, "no errors");
  eq(g.accepted.length, 1, "accepted");
  eq(g.verdicts[0].recognised, true, "recognised");
  eq(g.verdicts[0].variantId, "us", "variant id");
  eq(g.unrecognised.length, 0, "nothing to warn about");
});

check("gate: strict (the default) refuses a file matching no variant, BEFORE any run", async () => {
  const g = await gateInputs(strictSpec, [{ inputId: "base", filename: "hack.sfc", bytes: OTHER }]);
  eq(g.accepted.length, 0, "must not be handed to the module");
  eq(g.errors[0].code, "input-unrecognised", "refusal code");
  eq(g.verdicts[0].sha1, sha1Oracle(OTHER), "the hash it computed is reported");
});

check("gate: an absent `strict` key IS strict", async () => {
  const parsed = parseToolInputs({
    inputs: [{ id: "base", required: true, allowMultiple: false, extensions: [], maxBytes: 1024 }],
  });
  eq(parsed[0].strict, true, "default");
  const explicit = parseToolInputs({
    inputs: [{ id: "base", required: true, allowMultiple: false, extensions: [], maxBytes: 1024, strict: false }],
  });
  eq(explicit[0].strict, false, "explicit false");
});

// TRANSITIONAL: the pre-`4eb5a86` key. gwrg-dist-spec renamed an input's `repeatable` to
// `allowMultiple`, and zelda3 v0.3.0 is live with the OLD key — published hours before the
// commit landed. Refusing it made its whole tool unparseable: the Configure page showed
// "could not be read" and the Library raised no file prompt. `allowMultipleOf` accepts the old
// name, and ONLY the name: the type discipline is unchanged. See its comment for the deletion.
check("gate: the pre-rename `repeatable` still parses, and `allowMultiple` wins over it", () => {
  // zelda3 v0.3.0 exactly as published: both inputs carry `repeatable`, neither `allowMultiple`.
  const asPublished = parseToolInputs({
    inputs: [
      { id: "base", required: true, repeatable: false, extensions: [".sfc", ".smc"], maxBytes: 4194304 },
      { id: "language", required: false, repeatable: true, extensions: [".sfc", ".smc"], maxBytes: 4194304 },
    ],
  });
  eq(asPublished[0].allowMultiple, false, "the old key answers for `base`");
  eq(asPublished[1].allowMultiple, true, "and for `language` — the slot that takes eleven");

  // The new key is authoritative wherever it appears. A manifest carrying both is mid-migration
  // and means what it says NOW, not what it used to say.
  const [both] = parseToolInputs({
    inputs: [
      { id: "x", required: true, allowMultiple: true, repeatable: false, extensions: [], maxBytes: 1024 },
    ],
  });
  eq(both.allowMultiple, true, "`allowMultiple` wins when both are present");

  // Widening the accepted NAMES by one must not widen the accepted TYPES.
  for (const bad of [{ repeatable: "yes" }, { repeatable: 1 }, { repeatable: null }, {}]) {
    let threw = false;
    try {
      parseToolInputs({ inputs: [{ id: "x", required: true, ...bad, extensions: [], maxBytes: 1024 }] });
    } catch { threw = true; }
    assert(threw, `neither key usable (${JSON.stringify(bad)}) is still malformed`);
  }
});

// spec/03's input multiplicity: `allowMultiple` (the old `repeatable`) says the slot takes
// more than one file, `runPerFile` says each is converted separately, `maxCount` bounds it.
// The last two are PARSED AND CARRIED here; enforcing them is a later step. Parsing them but
// dropping them would silently lose the manifest's intent, so pin the carry.
check("gate: allowMultiple parses, and runPerFile/maxCount are carried", () => {
  const [one] = parseToolInputs({
    inputs: [{ id: "base", required: true, allowMultiple: false, extensions: [], maxBytes: 1024 }],
  });
  eq(one.allowMultiple, false, "a single-file slot");
  eq(one.runPerFile, undefined, "absent stays absent, not false");
  eq(one.maxCount, undefined, "absent stays absent");

  // zelda3's shape: many files, ONE run.
  const [many] = parseToolInputs({
    inputs: [{ id: "language", required: false, allowMultiple: true, extensions: [], maxBytes: 1024 }],
  });
  eq(many.allowMultiple, true, "the slot takes more than one file");
  eq(many.runPerFile, undefined, "one run over all of them");

  // doom's shape: one run and one output per WAD, bounded.
  const [perFile] = parseToolInputs({
    inputs: [
      { id: "wad", required: true, allowMultiple: true, runPerFile: true, maxCount: 8, extensions: [".wad"], maxBytes: 1024 },
    ],
  });
  eq(perFile.allowMultiple, true, "allowMultiple");
  eq(perFile.runPerFile, true, "runPerFile is carried through");
  eq(perFile.maxCount, 8, "maxCount is carried through");
});

check("gate: a malformed runPerFile/maxCount is dropped, never carried as junk", () => {
  const mk = (extra) =>
    parseToolInputs({
      inputs: [{ id: "wad", required: true, allowMultiple: true, extensions: [], maxBytes: 1024, ...extra }],
    })[0];
  eq(mk({ runPerFile: false }).runPerFile, undefined, "an explicit false is the same as absent");
  eq(mk({ runPerFile: "yes" }).runPerFile, undefined, "a non-boolean is not carried");
  eq(mk({ maxCount: 0 }).maxCount, undefined, "the schema's minimum is 1");
  eq(mk({ maxCount: 2.5 }).maxCount, undefined, "a fractional count is not a count");
  eq(mk({ maxCount: "8" }).maxCount, undefined, "a string is not a count");
});

check("gate: strict:false accepts the stranger AND reports it", async () => {
  const g = await gateInputs(looseSpec, [{ inputId: "base", filename: "hack.sfc", bytes: OTHER }]);
  eq(g.errors.length, 0, "not an error");
  eq(g.accepted.length, 1, "accepted");
  eq(g.unrecognised.length, 1, "must be reported to the user");
  eq(g.unrecognised[0].filename, "hack.sfc", "which file");
});

check("gate: maxBytes is enforced in the same pass", async () => {
  const g = await gateInputs(strictSpec, [
    { inputId: "base", filename: "huge.sfc", bytes: new Uint8Array(2048) },
  ]);
  eq(g.accepted.length, 0, "refused");
  eq(g.errors[0].code, "input-too-large", "refusal code");
  eq(g.verdicts[0].sha1, "", "an oversized file is not even hashed");
});

check("gate: a variant's declared byte count must agree too", async () => {
  const spec = [{ ...strictSpec[0], variants: [{ id: "us", sha1: ROM_SHA1, bytes: 999 }] }];
  const g = await gateInputs(spec, [{ inputId: "base", filename: "rom.sfc", bytes: ROM }]);
  eq(g.errors[0].code, "input-unrecognised", "hash matched but the size did not");
});

check("gate: a required input with no file is refused", async () => {
  const g = await gateInputs(strictSpec, []);
  eq(g.errors[0].code, "input-missing", "refusal code");
});

check("gate: a non-allowMultiple input given two files is refused", async () => {
  const g = await gateInputs(looseSpec, [
    { inputId: "base", filename: "a.sfc", bytes: ROM },
    { inputId: "base", filename: "b.sfc", bytes: OTHER },
  ]);
  assert(
    g.errors.some((e) => e.code === "input-not-multiple"),
    "refusal code",
  );
});

// --- Manifest narrowing: EVERY required field, one at a time --------------------------------
//
// A mutation audit found that ~30 individual terms of inputGate.ts's manifest validation were
// unpinned: flipping any single `||` in those long rejection chains to `&&` (so that ONE bad
// field no longer refuses the manifest) left all 271 checks green, because no fixture ever
// supplied a manifest with exactly one bad field. This is the code that narrows an UNTRUSTED
// third-party converter manifest before the WASM module is run, so each term is a real gate.
// Table-driven so a new schema field costs one line, not a new check.

/** A manifest fragment that must be accepted, plus the single-field corruptions that must not be. */
const mustRefuse = (label, parse, good, breakages) => {
  check(`manifest: ${label} accepts a well-formed entry`, () => {
    parse(good());
  });
  check(`manifest: ${label} refuses each required field individually`, () => {
    for (const [why, mutate] of breakages) {
      const t = good();
      mutate(t);
      let threw;
      try {
        parse(t);
      } catch (e) {
        threw = e;
      }
      assert(threw, `${label}: ${why} must be refused, got success`);
      eq(threw.code, "malformed", `${label}: ${why} must be "malformed"`);
    }
  });
};

const goodInput = () => ({
  inputs: [{ id: "base", required: true, allowMultiple: false, extensions: ["sfc"], maxBytes: 1024 }],
});
mustRefuse("parseToolInputs", parseToolInputs, goodInput, [
  ["inputs is not an array", (t) => (t.inputs = {})],
  ["an entry is not an object", (t) => (t.inputs[0] = "x")],
  ["an entry is an ARRAY (isObj must exclude arrays)", (t) => (t.inputs[0] = [])],
  ["an entry is null", (t) => (t.inputs[0] = null)],
  ["id is not a string", (t) => (t.inputs[0].id = 1)],
  ["required is not a boolean", (t) => (t.inputs[0].required = "yes")],
  ["allowMultiple is not a boolean", (t) => (t.inputs[0].allowMultiple = 0)],
  ["maxBytes is not a number", (t) => (t.inputs[0].maxBytes = "1024")],
  ["maxBytes is fractional", (t) => (t.inputs[0].maxBytes = 10.5)],
  ["maxBytes is zero", (t) => (t.inputs[0].maxBytes = 0)],
  ["maxBytes is negative", (t) => (t.inputs[0].maxBytes = -1)],
  ["extensions is not an array", (t) => (t.inputs[0].extensions = "sfc")],
  ["variants is not an array", (t) => (t.inputs[0].variants = {})],
  ["a variant is not an object", (t) => (t.inputs[0].variants = ["x"])],
  ["a variant has no id", (t) => (t.inputs[0].variants = [{ sha1: "a".repeat(40) }])],
  ["a variant has no sha1", (t) => (t.inputs[0].variants = [{ id: "us" }])],
  ["a variant sha1 is not 40 hex", (t) => (t.inputs[0].variants = [{ id: "us", sha1: "abc" }])],
  ["a variant sha1 has a non-hex char", (t) => (t.inputs[0].variants = [{ id: "us", sha1: "g".repeat(40) }])],
]);

const goodOutput = () => ({ outputs: [{ id: "rom", filename: "out.bin", maxBytes: 4096 }] });
mustRefuse("parseToolOutputs", parseToolOutputs, goodOutput, [
  ["outputs is not an array", (t) => (t.outputs = {})],
  ["outputs is EMPTY (a converter that produces nothing)", (t) => (t.outputs = [])],
  ["an entry is not an object", (t) => (t.outputs[0] = 7)],
  ["an entry is an array", (t) => (t.outputs[0] = [])],
  ["id is not a string", (t) => (t.outputs[0].id = null)],
  ["filename is not a string", (t) => (t.outputs[0].filename = 5)],
  // `filename` XOR `extension` (schema `oneOf`). The schema says it; a host that assumed the
  // publisher had run the checker would be trusting the party it is validating.
  ["BOTH filename and extension", (t) => (t.outputs[0].extension = ".whd")],
  ["NEITHER filename nor extension", (t) => delete t.outputs[0].filename],
  ["extension is not a string", (t) => ((t.outputs[0].extension = 5), delete t.outputs[0].filename)],
  ["extension has no leading dot", (t) => ((t.outputs[0].extension = "whd"), delete t.outputs[0].filename)],
  ["extension carries a separator", (t) => ((t.outputs[0].extension = "./whd"), delete t.outputs[0].filename)],
  ["extension is two extensions", (t) => ((t.outputs[0].extension = ".tar.gz"), delete t.outputs[0].filename)],
  ["extension is a bare dot", (t) => ((t.outputs[0].extension = "."), delete t.outputs[0].filename)],
  ["filename is a path", (t) => (t.outputs[0].filename = "sub/out.bin")],
  ["filename climbs", (t) => (t.outputs[0].filename = "../out.bin")],
  ["maxBytes is not a number", (t) => (t.outputs[0].maxBytes = "4096")],
  ["maxBytes is fractional", (t) => (t.outputs[0].maxBytes = 1.5)],
  ["maxBytes is zero", (t) => (t.outputs[0].maxBytes = 0)],
  ["maxBytes is negative", (t) => (t.outputs[0].maxBytes = -4096)],
]);

const goodLimits = () => ({ limits: { maxMemoryPages: 256, maxOutputBytes: 65536 } });
mustRefuse("parseToolLimits", parseToolLimits, goodLimits, [
  ["limits is missing", (t) => delete t.limits],
  ["limits is not an object", (t) => (t.limits = 5)],
  ["limits is an array", (t) => (t.limits = [])],
  ["maxMemoryPages is not a number", (t) => (t.limits.maxMemoryPages = "256")],
  ["maxMemoryPages is fractional", (t) => (t.limits.maxMemoryPages = 1.5)],
  ["maxMemoryPages is zero", (t) => (t.limits.maxMemoryPages = 0)],
  ["maxMemoryPages is negative", (t) => (t.limits.maxMemoryPages = -1)],
  ["maxOutputBytes is not a number", (t) => (t.limits.maxOutputBytes = null)],
  ["maxOutputBytes is fractional", (t) => (t.limits.maxOutputBytes = 2.5)],
  ["maxOutputBytes is zero", (t) => (t.limits.maxOutputBytes = 0)],
  ["maxOutputBytes is negative", (t) => (t.limits.maxOutputBytes = -65536)],
]);

check("manifest: parseToolInputs keeps only the string extensions", () => {
  const t = goodInput();
  t.inputs[0].extensions = ["sfc", 5, null, "smc"];
  const [got] = parseToolInputs(t);
  eq(got.extensions.join(","), "sfc,smc", "non-string extensions must be dropped, not kept");
});

check("manifest: an optional `bytes` is kept only when it is a number", () => {
  const t = goodInput();
  t.inputs[0].variants = [
    { id: "a", sha1: "a".repeat(40), bytes: 12 },
    { id: "b", sha1: "b".repeat(40), bytes: "12" },
  ];
  const [got] = parseToolInputs(t);
  eq(got.variants[0].bytes, 12, "a numeric bytes is carried through");
  eq("bytes" in got.variants[1], false, "a non-numeric bytes must be dropped, not carried");
});

const goodTool = () => ({
  id: "t",
  title: { en: "T" },
  processor: { type: "wasm", version: 1 },
  binary: { url: "https://x/y.wasm", bytes: 100, sha256: "a".repeat(64) },
  ...goodLimits(),
  ...goodInput(),
  ...goodOutput(),
});
mustRefuse("prepareTool's binary descriptor", prepareTool, goodTool, [
  ["binary is missing", (t) => delete t.binary],
  ["binary is not an object", (t) => (t.binary = "x")],
  ["url is not a string", (t) => (t.binary.url = 1)],
  ["bytes is not a number", (t) => (t.binary.bytes = "100")],
  ["sha256 is not a string", (t) => (t.binary.sha256 = null)],
]);

// --- A tool either runs per file or runs once (gwrg-dist-spec `44b0bf3`) --------------------
//
// A `runPerFile` input means one run per file supplied. An output with a fixed `filename` is
// written on each of those runs under the same name, so the second file converted collides
// with the first: the manifest is a collision with ITSELF, before the user supplies anything.
//
// The refusal is the MIXED shape, and the boundary matters in both directions. A per-file tool
// whose outputs are all derived is Doom, live today. A per-file tool whose outputs are ALL
// fixed is a WARN upstream, not an error ("only the last survives"), so refusing it here would
// break a manifest whose publisher was told it was publishable. Only the two together fail --
// that is OpenLara's shape, a .PKD per level beside a single TITLE.SCR, and the spec's remedy
// is two tools that may share one binary.
const perFileTool = (mutate) => {
  const t = goodTool();
  t.inputs[0].allowMultiple = true;
  t.inputs[0].runPerFile = true;
  t.outputs = [{ id: "pkd", extension: ".pkd", maxBytes: 4096 }];
  mutate?.(t);
  return t;
};

check("run shape: a per-file tool that also writes a fixed name is refused", () => {
  refusesMalformed(
    () => prepareTool(perFileTool((t) => t.outputs.push({ id: "title", filename: "TITLE.SCR", maxBytes: 4096 }))),
    "runPerFile + a derived output + a fixed filename",
  );
});

check("run shape: the refusal names the output a maintainer has to go and fix", () => {
  let threw;
  try {
    prepareTool(perFileTool((t) => t.outputs.push({ id: "title", filename: "TITLE.SCR", maxBytes: 4096 })));
  } catch (e) {
    threw = e;
  }
  assert(threw, "must be refused");
  // The user's line comes from `prepareText` via the `unreadable` group; the DETAIL is the
  // maintainer's half and reaches the activity log. It has to say which output.
  assert(String(threw.detail).includes("TITLE.SCR"), `detail must name the fixed output, got ${threw.detail}`);
  assert(String(threw.detail).includes("title"), `detail must name the output id, got ${threw.detail}`);
});

check("run shape: Doom's shape (per-file, every output derived) is still accepted", () => {
  const got = prepareTool(perFileTool());
  eq(got.inputs[0].runPerFile, true, "the per-file flag survives the check");
  eq(got.outputs[0].extension, ".pkd", "a derived output is untouched");
});

check("run shape: a per-file tool whose outputs are ALL fixed is a WARN upstream, not refused", () => {
  // No derived output, so `44b0bf3`'s error does not apply. Promoting the spec's WARN to an
  // error here would refuse a manifest the checker passed.
  const got = prepareTool(perFileTool((t) => (t.outputs = [{ id: "rom", filename: "out.bin", maxBytes: 4096 }])));
  eq(got.outputs[0].filename, "out.bin", "accepted, not refused");
});

check("run shape: a one-run tool may name every output it writes", () => {
  const got = prepareTool(goodTool());
  eq(got.outputs[0].filename, "out.bin", "no runPerFile input, so a fixed name is the norm");
});

check("run shape: the live Doom and OpenLara manifests both survive it", () => {
  // The two published per-file tools. Neither may regress into a refusal.
  for (const [who, outs] of [
    ["doom-whd", [{ id: "whd", extension: ".whd", maxBytes: 25165824 }]],
    ["openlara-levels", [{ id: "pkd", extension: ".PKD", maxBytes: 4096 }]],
  ]) {
    const t = perFileTool((x) => {
      x.id = who;
      x.outputs = outs;
    });
    prepareTool(t);
  }
});

// --- The two older cross-field rules in the same block of the spec's checker ---------------
//
// Both are ERRORs upstream, both were unenforced here, and the second is load-bearing:
// `homebrewConvert.ts` picks the per-file input with `find`, so a tool with SEVERAL of them
// silently converted the first rather than the one the publisher meant.
//
// Rule 2's boundary is "exactly one", which fails in BOTH directions. Zero per-file inputs
// beside a derived output is as broken as two: a name derived from the file being iterated has
// no file to derive from. It is gated on a derived output existing, which is what keeps the
// all-fixed WARN shape (rule 3's boundary, above) accepted.

check("run shape: runPerFile without allowMultiple is refused", () => {
  refusesMalformed(
    () => prepareTool(perFileTool((t) => (t.inputs[0].allowMultiple = false))),
    "a single-file slot has nothing to iterate",
  );
});

check("run shape: the runPerFile refusal names the input a maintainer has to go and fix", () => {
  let threw;
  try {
    prepareTool(perFileTool((t) => ((t.inputs[0].allowMultiple = false), (t.inputs[0].id = "level"))));
  } catch (e) {
    threw = e;
  }
  assert(threw, "must be refused");
  assert(String(threw.detail).includes("level"), `detail must name the input, got ${threw.detail}`);
});

check("run shape: runPerFile is judged on the RESOLVED flag, so the repeatable shim still passes", () => {
  // A pre-`4eb5a86` manifest spells `allowMultiple` as `repeatable`. `parseToolInputs` resolves
  // it, so this rule must read the parsed input and not the raw key -- otherwise enforcing the
  // rule would break exactly the old manifests `allowMultipleOf` exists to keep working.
  const got = prepareTool(
    perFileTool((t) => {
      delete t.inputs[0].allowMultiple;
      t.inputs[0].repeatable = true;
    }),
  );
  eq(got.inputs[0].allowMultiple, true, "the old spelling resolves and is accepted");
  eq(got.inputs[0].runPerFile, true, "and the tool still runs per file");
});

check("run shape: a derived output with TWO per-file inputs is refused", () => {
  // The shape `homebrewConvert.ts`'s `find` cannot resolve: it would convert `base` and never
  // `extra`, with no diagnostic anywhere.
  refusesMalformed(
    () =>
      prepareTool(
        perFileTool((t) =>
          t.inputs.push({
            id: "extra",
            required: false,
            allowMultiple: true,
            runPerFile: true,
            extensions: ["bin"],
            maxBytes: 1024,
          }),
        ),
      ),
    "a derived name cannot come from two different iterated inputs",
  );
});

check("run shape: a derived output with NO per-file input is refused", () => {
  // The other direction of the same rule, and the one a paraphrase ("more than one") misses.
  refusesMalformed(
    () => prepareTool(perFileTool((t) => delete t.inputs[0].runPerFile)),
    "a derived name with nothing to derive it from",
  );
});

check("run shape: the derived-name refusal reports both counts", () => {
  let threw;
  try {
    prepareTool(perFileTool((t) => delete t.inputs[0].runPerFile));
  } catch (e) {
    threw = e;
  }
  assert(threw, "must be refused");
  const d = String(threw.detail);
  assert(/1 derived output/.test(d), `detail must count the derived outputs, got ${d}`);
  assert(/0 runPerFile input/.test(d), `detail must count the per-file inputs, got ${d}`);
});

check("run shape: several per-file inputs are fine when NO output is derived", () => {
  // Rule 2 is gated on a derived output. Dropping that gate would refuse this, which upstream
  // only WARNs about -- the same over-broadening rule 3's boundary already guards against.
  const got = prepareTool(
    perFileTool((t) => {
      t.outputs = [{ id: "rom", filename: "out.bin", maxBytes: 4096 }];
      t.inputs.push({
        id: "extra",
        required: false,
        allowMultiple: true,
        runPerFile: true,
        extensions: ["bin"],
        maxBytes: 1024,
      });
    }),
  );
  eq(got.inputs.length, 2, "accepted, not refused");
});

// --- `maxCount` without `allowMultiple` (the fourth ERROR in the same block) ---------------
//
// "caps a count it cannot have": a slot that takes one file has no count to cap.
//
// This rule reads the RAW key where rule 1 reads the parsed flag, and the asymmetry is the
// whole point of the pair below. `parseToolInputs` keeps `maxCount` only when it is an integer
// >= 1 and drops it silently otherwise, so reading parsed would answer "no cap" for a manifest
// that visibly states one. `allowMultiple` is still read RESOLVED, because `repeatable` means
// the same thing and rule 1's reason applies unchanged.
//
// The two readings cannot disagree on any manifest the SPEC evaluates this rule on:
// `manifest.schema.json` types `maxCount` as `{integer, minimum 1}` and `check.js` returns at
// the schema step, so a `maxCount: "3"` never reaches its cross-field loop. They differ only on
// manifests the schema already refuses, which we have no schema validator to refuse ourselves.

check("run shape: maxCount without allowMultiple is refused", () => {
  refusesMalformed(
    () =>
      prepareTool(
        perFileTool((t) => {
          delete t.inputs[0].runPerFile; // isolate: rule 1 would otherwise fire first
          t.outputs = [{ id: "rom", filename: "out.bin", maxBytes: 4096 }];
          t.inputs[0].allowMultiple = false;
          t.inputs[0].maxCount = 3;
        }),
      ),
    "a one-file slot cannot cap a count",
  );
});

check("run shape: the maxCount refusal names the input a maintainer has to go and fix", () => {
  let threw;
  try {
    prepareTool(
      perFileTool((t) => {
        delete t.inputs[0].runPerFile;
        t.outputs = [{ id: "rom", filename: "out.bin", maxBytes: 4096 }];
        t.inputs[0].allowMultiple = false;
        t.inputs[0].maxCount = 3;
        t.inputs[0].id = "level";
      }),
    );
  } catch (e) {
    threw = e;
  }
  assert(threw, "must be refused");
  assert(String(threw.detail).includes("level"), `detail must name the input, got ${threw.detail}`);
  assert(
    String(threw.detail).includes("maxCount"),
    `detail must say which rule fired, got ${threw.detail}`,
  );
});

check("run shape: maxCount is judged on the RAW key, so a dropped one is still refused", () => {
  // `maxCount: "3"` is a cap `parseToolInputs` discards. Reading the parsed value would accept
  // this and then enforce no cap at all -- doing something other than what the manifest says,
  // silently, which is the failure these refusals exist to prevent.
  for (const bad of ["3", 0, 2.5, -1, null]) {
    refusesMalformed(
      () =>
        prepareTool(
          perFileTool((t) => {
            delete t.inputs[0].runPerFile;
            t.outputs = [{ id: "rom", filename: "out.bin", maxBytes: 4096 }];
            t.inputs[0].allowMultiple = false;
            t.inputs[0].maxCount = bad;
          }),
        ),
      `maxCount ${JSON.stringify(bad)} is written, so it is a cap we cannot honour`,
    );
  }
});

check("run shape: allowMultiple is still RESOLVED, so maxCount beside `repeatable` passes", () => {
  // The shim's whole job. A pre-`4eb5a86` manifest capping a repeatable slot is well-formed.
  const got = prepareTool(
    perFileTool((t) => {
      delete t.inputs[0].allowMultiple;
      t.inputs[0].repeatable = true;
      t.inputs[0].maxCount = 8;
    }),
  );
  eq(got.inputs[0].maxCount, 8, "the cap survives");
  eq(got.inputs[0].allowMultiple, true, "resolved through the old spelling");
});

check("run shape: a slot with allowMultiple and no maxCount is untouched", () => {
  const got = prepareTool(
    perFileTool((t) => {
      delete t.inputs[0].maxCount;
    }),
  );
  eq(got.inputs[0].maxCount, undefined, "no cap declared, none invented");
});

check("run shape: all three live per-file tools survive both new rules", () => {
  // doom-whd, openlara-levels and video-gwv, as published: one input, allowMultiple with a
  // maxCount beside it, runPerFile, and a single derived output. None may regress.
  for (const [who, ext, maxCount] of [
    ["doom-whd", ".whd", 32],
    ["openlara-levels", ".PKD", 32],
    ["video-gwv", ".gwv", 16],
  ]) {
    const t = perFileTool((x) => {
      x.id = who;
      x.inputs[0].maxCount = maxCount;
      x.outputs = [{ id: "out", extension: ext, maxBytes: 25165824 }];
    });
    const got = prepareTool(t);
    eq(got.outputs[0].extension, ext, `${who} keeps its derived extension`);
    eq(got.inputs[0].maxCount, maxCount, `${who} keeps its cap`);
  }
});

check("manifest: checkProcessor refuses a malformed processor block", () => {
  for (const [why, p] of [
    ["missing", undefined],
    ["not an object", 5],
    ["an array", []],
    ["type is not a string", { type: 1, version: 1 }],
    ["version is not a number", { type: "wasm", version: "1" }],
  ]) {
    let threw;
    try {
      checkProcessor({ processor: p });
    } catch (e) {
      threw = e;
    }
    assert(threw, `${why} must be refused`);
    eq(threw.code, "malformed", `${why} must be "malformed"`);
  }
});

// ============================================================================================
// 6. Version gates
// ============================================================================================

check("versions: processor wasm/1 is accepted, anything else refused", async () => {
  checkProcessor({ processor: { type: "wasm", version: 1 } });
  await refuses("unsupported-processor", () => checkProcessor({ processor: { type: "wasm", version: 2 } }));
  await refuses("unsupported-processor", () => checkProcessor({ processor: { type: "js", version: 1 } }));
});

// ============================================================================================
// 7. The Worker wrapper: timeout and termination
// ============================================================================================
//
// node has no DOM Worker, so `runConverter` is exercised through its `spawnWorker` injection
// point with a stand-in that runs the driver inline. What is under test here is not the
// driver (sections 1-6 did that) but the wrapper's contract: it must always terminate, and it
// must reject on a timeout rather than hanging.

function fakeWorker({ respond = true, delayMs = 0 } = {}) {
  const w = {
    terminated: false,
    onmessage: null,
    onerror: null,
    terminate() {
      this.terminated = true;
    },
    postMessage(req) {
      if (!respond) return; // never answers: the timeout must save us
      setTimeout(() => {
        runConverterModule({ ...req, onProgress: () => {} }).then(
          (r) => this.onmessage?.({ data: { type: "done", ...r } }),
          (e) => this.onmessage?.({ data: { type: "error", code: e.code ?? "worker-failed", detail: e.detail } }),
        );
      }, delayMs);
    },
  };
  return w;
}

const TOOL = { id: "t", limits: LIMITS, outputs: OUTPUT_SPECS };

check("worker: a successful run resolves and the Worker is terminated", async () => {
  const w = fakeWorker();
  const r = await runConverter({
    tool: TOOL,
    wasm: buildConverter(),
    inputs: RUN_INPUT,
    spawnWorker: () => w,
  });
  bytesEq(r.outputs[0].bytes, PAYLOAD, "payload");
  assert(w.terminated, "the Worker must be terminated on success — it still holds its memory");
});

check("worker: a refusal inside the Worker crosses back as its code", async () => {
  const w = fakeWorker();
  await refuses("imports-forbidden", () =>
    runConverter({ tool: TOOL, wasm: buildConverter({ withImport: true }), inputs: RUN_INPUT, spawnWorker: () => w }),
  );
  assert(w.terminated, "terminated on failure too");
});

check("worker: a run that never answers hits the timeout and is terminated", async () => {
  const w = fakeWorker({ respond: false });
  const e = await refuses("timeout", () =>
    runConverter({ tool: TOOL, wasm: buildConverter(), inputs: RUN_INPUT, spawnWorker: () => w, timeoutMs: 40 }),
  );
  eq(e.detail, "40ms", "should report the ceiling it hit");
  assert(w.terminated, "terminating the Worker is the ONLY cancellation the ABI admits");
});

check("worker: an abort terminates it", async () => {
  const w = fakeWorker({ delayMs: 500 });
  const ac = new AbortController();
  const p = refuses("timeout", () =>
    runConverter({ tool: TOOL, wasm: buildConverter(), inputs: RUN_INPUT, spawnWorker: () => w, signal: ac.signal }),
  );
  ac.abort();
  await p;
  assert(w.terminated, "terminated on abort");
});

// ============================================================================================
// 5. The install path: fetching a target's own artifacts
// ============================================================================================
//
// `fetchTargetArtifacts` is the half of "prepare" that fetches what the publisher SHIPS. The
// oracle is node's own `crypto` (via the sha256 the module recomputes) plus a fake `fetch`
// standing in for the mirror — the point of every check here is that a mirror handing back the
// wrong bytes, or a manifest describing them wrongly, is refused rather than installed.

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A fake mirror: url -> bytes. Installed as the global `fetch` for the duration of one call. */
function withMirror(files, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const bytes = files.get(String(url));
    if (!bytes) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  return Promise.resolve(fn()).finally(() => void (globalThis.fetch = real));
}

/** One artifact + the mirror entry that serves it, optionally lying about one field. */
function artifactFor(name, bytes, over = {}) {
  const url = `https://example.invalid/${name}`;
  return { artifact: { filename: name, bytes: bytes.length, sha256: sha256(bytes), url, ...over }, url, bytes };
}

check("artifacts: the happy path returns every file, keyed by its manifest filename", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  const b = artifactFor("assets.bin", new Uint8Array(64).fill(9));
  const seen = [];
  const out = await withMirror(new Map([[a.url, a.bytes], [b.url, b.bytes]]), () =>
    fetchTargetArtifacts({ artifacts: [a.artifact, b.artifact] }, { onProgress: (p) => seen.push(p) }),
  );
  eq(out.size, 2, "file count");
  bytesEq(out.get("engine.bin"), PAYLOAD, "engine.bin");
  eq(seen.length, 2, "progress is reported once per artifact");
  eq(seen[seen.length - 1].total, 2, "progress carries the total");
});

check("artifacts: an empty artifacts[] is an empty map, not a fetch", async () => {
  const out = await fetchTargetArtifacts({ artifacts: [] });
  eq(out.size, 0, "empty");
});

// >>> A mirror is not a trust boundary. <<<
check("artifacts: bytes that do not match the manifest's sha256 are refused", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  const tampered = PAYLOAD.slice();
  tampered[0] ^= 0xff;
  await withMirror(new Map([[a.url, tampered]]), () =>
    refuses("malformed", () => fetchTargetArtifacts({ artifacts: [a.artifact] })),
  );
});

check("artifacts: a length disagreeing with the manifest's `bytes` is refused", async () => {
  // The hash still matches the bytes served; only the manifest's own claim is wrong. The fit
  // maths downstream trusts that number, so the disagreement is a refusal.
  const a = artifactFor("engine.bin", PAYLOAD, { bytes: PAYLOAD.length + 1 });
  const e = await withMirror(new Map([[a.url, PAYLOAD]]), () =>
    refuses("artifact-size-mismatch", () => fetchTargetArtifacts({ artifacts: [a.artifact] })),
  );
  assert(e.detail.includes("engine.bin"), `detail should name the file, got ${e.detail}`);
});

check("artifacts: a non-numeric declared size is malformed, not NaN arithmetic", () =>
  refuses("malformed", () =>
    fetchTargetArtifacts({ artifacts: [artifactFor("x.bin", PAYLOAD, { bytes: NaN }).artifact] }),
  ));

check("artifacts: an already-aborted signal refuses without fetching", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  const ac = new AbortController();
  ac.abort();
  await withMirror(new Map([[a.url, a.bytes]]), () =>
    refuses("aborted", () => fetchTargetArtifacts({ artifacts: [a.artifact] }, { signal: ac.signal })),
  );
});

check("artifacts: a 404 from the mirror is a network refusal, never a raw message", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  await withMirror(new Map(), () =>
    refuses("network", () => fetchTargetArtifacts({ artifacts: [a.artifact] })),
  );
});

// --- The cache is not a trust boundary either -------------------------------------------------
//
// `fetchTargetArtifacts` looks in the content-addressed blob cache before it goes to the
// network. That lookup is only safe because `BlobCache.get` RE-HASHES the stored bytes against
// the key it was asked for and reports a mismatch as a miss. If that re-hash were ever dropped —
// or if this module were changed to read the backend directly, or to trust `has()` — then
// anything able to write the origin's OPFS would be able to substitute the bytes of an install,
// and the manifest's sha256 would never be consulted at all. The mirror checks above would not
// notice: they only ever exercise the network path.
//
// So the property is stated here directly, with a real `BlobCache` over a fake backend that is
// holding bytes which do NOT hash to the name they are filed under. Delete the re-hash in
// `BlobCache.get` and the last of these three fails loudly: the tampered bytes come back as a
// successful install.

/** A `BlobCacheBackend` over a plain Map. `files` is the on-disk state, name -> bytes. */
function fakeBackend(files) {
  return {
    available: true,
    async list() {
      return [...files.keys()];
    },
    async stat(name) {
      return files.has(name) ? files.get(name).length : null;
    },
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, bytes) {
      files.set(name, bytes.slice());
      return true;
    },
    async remove(name) {
      files.delete(name);
    },
  };
}

const nullQuota = {
  async estimate() {
    return null;
  },
  async persisted() {
    return false;
  },
  async persist() {
    return false;
  },
};

/** A cache whose backing store starts as `files` (an artifact is filed as `artifact.<hash>`). */
function cacheOver(files) {
  return { cache: new BlobCache({ backend: fakeBackend(files), quota: nullQuota }), files };
}

check("artifacts: a cache HIT is served, and the network is not touched at all", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  const { cache } = cacheOver(new Map([[`artifact.${a.artifact.sha256}`, PAYLOAD]]));
  // The mirror is EMPTY: any network access at all would 404 and refuse. Reaching the bytes
  // therefore proves they came from the cache.
  const out = await withMirror(new Map(), () =>
    fetchTargetArtifacts({ artifacts: [a.artifact] }, { cache }),
  );
  bytesEq(out.get("engine.bin"), PAYLOAD, "served from the cache");
});

check("artifacts: a cache MISS still goes to the network, and stores what it got", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  const { cache, files } = cacheOver(new Map());
  const out = await withMirror(new Map([[a.url, PAYLOAD]]), () =>
    fetchTargetArtifacts({ artifacts: [a.artifact] }, { cache }),
  );
  bytesEq(out.get("engine.bin"), PAYLOAD, "fetched");
  assert(files.has(`artifact.${a.artifact.sha256}`), "the download was cached for next time");
});

check("artifacts: a cache entry whose bytes do not hash to its key is dropped, not served", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  const tampered = PAYLOAD.slice();
  tampered[0] ^= 0xff;
  const name = `artifact.${a.artifact.sha256}`;
  // Filed under the RIGHT name, holding the WRONG bytes — exactly what an attacker with write
  // access to the origin's OPFS, or a half-written file, leaves behind.
  const { cache, files } = cacheOver(new Map([[name, tampered]]));
  const out = await withMirror(new Map([[a.url, PAYLOAD]]), () =>
    fetchTargetArtifacts({ artifacts: [a.artifact] }, { cache }),
  );
  bytesEq(out.get("engine.bin"), PAYLOAD, "the honest bytes, from the network");
  assert(files.get(name) !== tampered, "the poisoned entry was not left on disk to be re-served");
});

// >>> The cache is not a trust boundary. <<<
check("artifacts: poisoned cache bytes are refused outright when the network cannot cover", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  const tampered = PAYLOAD.slice();
  tampered[0] ^= 0xff;
  const { cache } = cacheOver(new Map([[`artifact.${a.artifact.sha256}`, tampered]]));
  // Nothing to fall back to. A cache that skipped its re-hash would hand these bytes straight
  // to the installer and this would be a SUCCESS.
  await withMirror(new Map(), () =>
    refuses("network", () => fetchTargetArtifacts({ artifacts: [a.artifact] }, { cache })),
  );
});

check("artifacts: with no cache backend at all the network path is unchanged", async () => {
  const a = artifactFor("engine.bin", PAYLOAD);
  const cache = new BlobCache({ backend: nullBlobBackend, quota: nullQuota });
  const out = await withMirror(new Map([[a.url, PAYLOAD]]), () =>
    fetchTargetArtifacts({ artifacts: [a.artifact] }, { cache }),
  );
  bytesEq(out.get("engine.bin"), PAYLOAD, "uncached, still correct");
});

// ============================================================================================
// 6. parseManifest: filenames are never paths, and `originalSystem` follows the schema
// ============================================================================================
//
// `filename` reaches a FrogFS tree key (installArtifacts -> RomManagementTab -> flashImage's
// userDest), so a manifest declaring "../bios/x.bin" could aim a file outside roms/homebrew/.
// The sha256 does not help: it proves the bytes match the claim, not that the claim is benign.
// The check therefore lives at the parse boundary, and these prove it is really there.

const MANIFEST_URL = "https://o.github.io/r/dist/v1/manifest.json";

/** A minimal schemaVersion-1 manifest with one homebrew target carrying `artifacts[0]`. */
function manifestDoc(over = {}, artifact = {}) {
  return {
    schemaVersion: 1,
    project: "demo",
    title: "Demo",
    source: { repo: "o/r", commit: "abcdef0", ref: "v1" },
    tools: [],
    targets: [
      {
        id: "gnw",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind: "homebrew",
        requiresAbi: { version: 1, minSize: 0 },
        artifacts: [
          {
            filename: "engine.bin",
            url: "engine.bin",
            bytes: 16,
            sha256: "0".repeat(64),
            ...artifact,
          },
        ],
      },
    ],
    ...over,
  };
}

const parse = (over, artifact) => parseManifest(manifestDoc(over, artifact), MANIFEST_URL);

// Mutation audit: the same one-bad-field gap inputGate.ts had also covered parseManifest's
// top-level and per-target narrowing — flipping any single `||` in either chain left every
// check green, because no fixture ever produced a manifest with exactly one bad field.
mustRefuse("parseManifest top level", (d) => parseManifest(d, MANIFEST_URL), manifestDoc, [
  ["the document is not an object", (t) => Object.keys(t).forEach((k) => delete t[k]) || Object.assign(t, { 0: 1 })],
  ["project is not a string", (t) => (t.project = 1)],
  ["title is not a string", (t) => (t.title = null)],
  ["source is not an object", (t) => (t.source = "someone/x")],
  ["source is an array", (t) => (t.source = [])],
  ["tools is not an array", (t) => (t.tools = {})],
  ["targets is not an array", (t) => (t.targets = null)],
  ["a target is not an object", (t) => (t.targets[0] = "gnw")],
  ["a target is an array", (t) => (t.targets[0] = [])],
  ["a target id is not a string", (t) => (t.targets[0].id = 1)],
  ["a target platform is not a string", (t) => (t.targets[0].platform = null)],
  ["a target label is not a string", (t) => (t.targets[0].label = 7)],
  ["a target kind is neither homebrew nor emulator", (t) => (t.targets[0].kind = "firmware")],
  ["a target kind is missing", (t) => delete t.targets[0].kind],
]);

check("manifest: a plain filename with a space is accepted", () => {
  const m = parse({}, { filename: "Zelda 3.bin" });
  eq(m.targets[0].artifacts[0].filename, "Zelda 3.bin", "filename");
  eq(m.targets[0].artifacts[0].url, "https://o.github.io/r/dist/v1/engine.bin", "resolved url");
});

for (const [why, name] of [
  ["traversal", "../bios/boot.bin"],
  ["a bare parent", ".."],
  ["a bare dot", "."],
  ["absolute", "/etc/passwd"],
  ["a backslash", "..\\windows\\evil.bin"],
  ["empty", ""],
  ["a control character", "evil\u0000.bin"],
  ["a nested subdirectory", "sub/dir.bin"],
]) {
  check(`manifest: an artifact filename with ${why} is refused`, () =>
    refuses("malformed", () => parse({}, { filename: name })));
  // `url` is a plain filename in the spec too, so it gets the same guard.
  check(`manifest: an artifact url with ${why} is refused`, () =>
    refuses("malformed", () => parse({}, { url: name })));
}

check("manifest: originalSystem is kept when it matches the schema pattern", () => {
  eq(parse({ originalSystem: "snes" }).originalSystem, "snes", "kept");
  eq(parse({ originalSystem: "pico8" }).originalSystem, "pico8", "kept");
});

check("manifest: a malformed originalSystem is dropped, not thrown", () => {
  // Dropped rather than refused — the same defensive shape `docs` uses. Nothing may ever use
  // it as a path segment, which the pattern guarantees on its own.
  for (const bad of ["SNES", "sne/s", "../snes", "-snes", "snes ", ""]) {
    eq(parse({ originalSystem: bad }).originalSystem, undefined, `dropped: ${JSON.stringify(bad)}`);
  }
});

check("manifest: originalName is FREE TEXT, not a schema-pattern identifier", () => {
  // The pair is the point: `originalSystem` says which art library, `originalName` says which
  // entry in it. A project's name is not the work's name -- ScreenScraper has no "ccleste" and
  // no "zelda3". So this field must accept what a real title looks like, which the
  // `originalSystem` pattern would reject outright: spaces, capitals, punctuation.
  eq(parse({ originalName: "Celeste Classic" }).originalName, "Celeste Classic", "spaces and capitals");
  eq(parse({ originalName: "The Legend of Zelda - A Link to the Past" }).originalName,
    "The Legend of Zelda - A Link to the Past", "a real ScreenScraper title");
  eq(parse({ originalName: "Dr. Mario" }).originalName, "Dr. Mario", "a dot is part of the title");
  eq(parse({ originalName: "  Celeste Classic  " }).originalName, "Celeste Classic", "trimmed");
});

check("manifest: a useless originalName is dropped, not thrown", () => {
  // Dropped-rather-than-refused, the shape `docs` and `originalSystem` already use: a manifest
  // is not malformed for carrying a value we will not use.
  for (const bad of [1, null, true, [], {}, "", "   "]) {
    eq(parse({ originalName: bad }).originalName, undefined, `dropped: ${JSON.stringify(bad)}`);
  }
  eq(parse({ originalName: "x".repeat(201) }).originalName, undefined, "an absurd length is dropped");
  eq(parse({ originalName: "x".repeat(200) }).originalName, "x".repeat(200), "the cap itself is kept");
});

check("manifest: an absent originalName simply is not there", () => {
  eq("originalName" in parse({}), false, "absent");
});

check("manifest: an absent originalSystem simply is not there", () => {
  eq("originalSystem" in parse({}), false, "absent");
});


// =====================================================================================// N. The file prompt's presentation helpers (inputPrompt.ts, ui/FilePromptModal.svelte)
//
// The prompt renders manifest-supplied text and hands the bytes to the gate above. These are
// the only decisions it makes on its own, so they are the only ones worth a check: which
// language string is shown, what reaches the picker's `accept` attribute, and whether an
// over-sized file is refused from `File.size` BEFORE it is ever read.
// ============================================================================================

check("prompt: pickText prefers the exact locale, then the base language", () => {
  const m = { en: "Base ROM", "pt-BR": "ROM base", de: "Basis-ROM" };
  eq(pickText(m, "de"), "Basis-ROM", "exact");
  eq(pickText(m, "pt-BR"), "ROM base", "exact regional");
  eq(pickText(m, "pt"), "ROM base", "base language finds the regional key");
  eq(pickText(m, "de-AT"), "Basis-ROM", "regional locale falls back to base key");
});

check("prompt: pickText falls back to English, then to anything, then to undefined", () => {
  eq(pickText({ en: "Base ROM", de: "x" }, "ko"), "Base ROM", "english fallback");
  eq(pickText({ ja: "ベース" }, "ko"), "ベース", "last-resort: some text beats none");
  eq(pickText(undefined, "en"), undefined, "absent map");
  eq(pickText({}, "en"), undefined, "empty map");
  eq(pickText({ en: "   " }, "en"), undefined, "blank is not text");
});

check("prompt: acceptAttr normalises extensions to a dotted, deduplicated list", () => {
  eq(acceptAttr(["sfc", ".SMC", "sfc", ".sfc"]), ".sfc,.smc", "normalised + deduped");
  eq(acceptAttr([]), "", "no hint is a valid state");
});

// The manifest is third-party, and `accept` is the one manifest value that reaches an HTML
// attribute. Anything that is not a plain extension token is dropped, not escaped.
check("prompt: acceptAttr drops anything that is not a plain extension token", () => {
  for (const bad of ["*", "*/*", "../etc/passwd", "a b", "sfc,smc", "", ".", "x".repeat(17), "s/c"]) {
    eq(acceptAttr([bad]), "", `dropped: ${JSON.stringify(bad)}`);
  }
  eq(acceptAttr(["*", "sfc"]), ".sfc", "a bad entry does not poison a good one");
});

// >>> The size preflight is the SAME ceiling as the gate's, one step earlier. <<<
check("prompt: oversize agrees with the gate at and around the boundary", async () => {
  const spec = {
    id: "base",
    required: true,
    allowMultiple: false,
    extensions: ["sfc"],
    maxBytes: 8,
    variants: [],
    strict: false,
  };
  eq(oversize(spec, 8), false, "exactly maxBytes is fine");
  eq(oversize(spec, 9), true, "one over is not");

  // And the gate reaches the same verdict for the same sizes, so the preflight can only ever
  // save a read — never change an answer.
  const gate = async (n) =>
    (await gateInputs([spec], [{ inputId: "base", filename: "r.sfc", bytes: new Uint8Array(n) }]))
      .verdicts[0];
  eq((await gate(8)).error, undefined, "gate accepts 8");
  eq((await gate(9)).error?.code, "input-too-large", "gate refuses 9");
});

check("prompt: promptOrder puts required inputs first and is stable otherwise", () => {
  const mk = (id, required) => ({ id, required, allowMultiple: false, extensions: [], maxBytes: 1, variants: [], strict: true });
  const ordered = promptOrder([mk("opt1", false), mk("req1", true), mk("opt2", false), mk("req2", true)]);
  eq(ordered.map((i) => i.id).join(","), "req1,req2,opt1,opt2", "required first, order kept");
});

check("prompt: slotsLeft mirrors the gate's allowMultiple rule", async () => {
  eq(slotsLeft({ allowMultiple: false }, 0), 1, "one slot when not allowMultiple");
  eq(slotsLeft({ allowMultiple: false }, 1), 0, "and no more once filled");
  eq(slotsLeft({ allowMultiple: true }, 5), Infinity, "allowMultiple is unbounded");

  // The reason it must not offer a second: the gate refuses the whole set if it gets one.
  const spec = { id: "base", required: true, allowMultiple: false, extensions: [], maxBytes: 99, variants: [], strict: false };
  const two = await gateInputs(spec ? [spec] : [], [
    { inputId: "base", filename: "a", bytes: new Uint8Array(1) },
    { inputId: "base", filename: "b", bytes: new Uint8Array(2) },
  ]);
  eq(two.errors.some((e) => e.code === "input-not-multiple"), true, "gate refuses two");
});

// The requirement the modal exists to honour: a strict:false file that matches no variant is
// ACCEPTED and REPORTED. The component reads exactly this field to render its warning.
check("prompt: a strict:false miss is reported in `unrecognised`, not silently accepted", async () => {
  const spec = { id: "base", required: true, allowMultiple: false, extensions: [], maxBytes: 99, variants: [{ id: "usa", sha1: "0".repeat(40) }], strict: false };
  const r = await gateInputs([spec], [{ inputId: "base", filename: "hack.sfc", bytes: new Uint8Array(4) }]);
  eq(r.errors.length, 0, "accepted");
  eq(r.accepted.length, 1, "usable");
  eq(r.unrecognised.length, 1, "and surfaced");
  eq(r.unrecognised[0].filename, "hack.sfc", "with the name to show");
});
// ============================================================================================
// 7. Offline bundles (gwrg-dist-spec spec/06-bundle.md)
//
// A bundle is `dist/<tag>/` zipped, and the point of this section is that importing one is NOT
// a softer path than fetching one. The zip is a file the user was handed; it is not a trust
// boundary. So the checks below are all of the form "the same refusal the network path makes",
// plus the one refusal only a zip can earn: an entry name built to escape the archive.
//
// The zips are hand-written (stored, no zip64) for the same reason `fixture.mjs` hand-writes
// its wasm: the interesting cases are the ones a well-behaved writer will not produce. JSZip
// normalises some paths on its way in, so a fixture that went through a zip LIBRARY could not
// carry `../../etc/x` as an entry name at all — and that is exactly the case under test.
// ============================================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Write a stored-method zip from `[name, bytes]` pairs, names written verbatim. */
function makeZip(entries) {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;

  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

  for (const [name, data] of entries) {
    const n = [...enc.encode(name)];
    const crc = crc32(data);
    const lh = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(n.length), ...u16(0),
      ...n, ...data,
    ];
    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(n.length), ...u16(0),
      ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...n,
    ]);
    local.push(lh);
    offset += lh.length;
  }

  const cd = central.flat();
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(cd.length), ...u32(offset), ...u16(0),
  ];
  return new Uint8Array([...local.flat(), ...cd, ...eocd]);
}

const jsonBytes = (obj) => new TextEncoder().encode(JSON.stringify(obj));
const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Payloads distinguishable from each other, so a mis-resolved url is a failed assertion. */
const ENGINE = new Uint8Array(64).map((_, i) => (i * 3 + 1) & 0xff);
const SYMS = new Uint8Array(32).map((_, i) => (i * 5 + 2) & 0xff);

function bundleManifest(over = {}, artifactOver = {}) {
  return {
    schemaVersion: 1,
    project: "minesweeper",
    title: "Minesweeper",
    source: { repo: "someone/minesweeper", commit: "abcdef0", ref: "v0.1.3" },
    tools: [],
    targets: [
      {
        id: "gnw",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind: "homebrew",
        requiresAbi: { version: 1, minSize: 0 },
        artifacts: [
          {
            filename: "minesweeper.bin",
            url: "minesweeper.bin",
            bytes: ENGINE.length,
            sha256: sha256Of(ENGINE),
            ...artifactOver,
          },
        ],
        symbols: [
          {
            filename: "minesweeper.elf",
            url: "minesweeper.elf",
            bytes: SYMS.length,
            sha256: sha256Of(SYMS),
          },
        ],
      },
    ],
    ...over,
  };
}

function versionsDoc(over = {}) {
  return {
    schemaVersion: 1,
    project: "minesweeper",
    title: "Minesweeper",
    repo: "someone/minesweeper",
    releasesUrl: "https://github.com/someone/minesweeper/releases",
    versions: [
      {
        tag: "v0.1.3",
        manifest: "v0.1.3/manifest.json",
        publishedAt: "2026-01-02T00:00:00Z",
        prerelease: false,
        kind: "homebrew",
        requiresAbi: { version: 1, minSize: 0 },
        needsUserFiles: false,
      },
    ],
    ...over,
  };
}

/** A single-tag bundle: `dist/<tag>/` zipped, so a lone manifest.json at the root. */
const singleTag = (manifest = bundleManifest(), extra = []) =>
  makeZip([
    ["manifest.json", jsonBytes(manifest)],
    ["minesweeper.bin", ENGINE],
    ["minesweeper.elf", SYMS],
    ...extra,
  ]);

/** The archivist's whole-history form: versions.json at the root, one directory per tag. */
const multiVersion = (versions = versionsDoc(), manifest = bundleManifest()) =>
  makeZip([
    ["versions.json", jsonBytes(versions)],
    ["v0.1.3/manifest.json", jsonBytes(manifest)],
    ["v0.1.3/minesweeper.bin", ENGINE],
    ["v0.1.3/minesweeper.elf", SYMS],
  ]);

/** Publishes a recognisable fake instead of a blob URL — node has no `URL.createObjectURL`. */
function stubPublisher() {
  const seen = [];
  const publish = (bytes, filename) => {
    seen.push({ filename, bytes });
    return `stub:${filename}#${seen.length}`;
  };
  return { publish, seen };
}

const importZip = (zip, pub = stubPublisher()) => importBundle(zip, { publish: pub.publish });

check("bundle: a single-tag bundle imports as a resolved source", async () => {
  const pub = stubPublisher();
  const { resolved } = await importZip(singleTag(), pub);
  eq(resolved.repo, "someone/minesweeper", "repo, normalised from source.repo");
  eq(resolved.manifest.title, "Minesweeper", "title");
  // No versions.json in a single-tag bundle: `dist/versions.json` lives one level ABOVE the
  // tag directory that was zipped, so the entry is synthesised from the manifest.
  eq(resolved.entry.tag, "v0.1.3", "tag synthesised from source.ref");
  eq(resolved.entry.kind, "homebrew", "kind from the target");
  eq(resolved.entry.needsUserFiles, false, "no required tool -> no user file");
  eq(resolved.index.releasesUrl, "", "no releasesUrl is empty, never invented");
  eq(resolved.manifest.targets[0].artifacts[0].url, "stub:minesweeper.bin#1", "artifact relinked");
  // Symbols are verified and kept, never installed (spec/06). Verified means published too.
  eq(resolved.manifest.targets[0].symbols[0].url, "stub:minesweeper.elf#2", "symbols relinked");
  eq(pub.seen.length, 2, "exactly the two files the manifest names");
  bytesEq(pub.seen[0].bytes, ENGINE, "the published artifact is the zip's bytes");
});

check("bundle: a versions.json manifest path may not escape the archive", async () => {
  // resolveInZip's safeSegment() is a SECOND, independent guard on top of the entry-name
  // check: the archive may be clean while the DOCUMENT points outside it. A mutation audit
  // found the segment test unpinned — flipping its `||` chain to `&&` left the suite green
  // because every fixture's `manifest` path was well-formed.
  for (const [why, path] of [
    ["traversal", "../../etc/manifest.json"],
    ["a bare parent segment", "../manifest.json"],
    ["a bare dot segment", "./manifest.json"],
    ["an empty segment", "v0.1.3//manifest.json"],
    ["a backslash segment", "..\\manifest.json"],
    ["a control character", "v0.1.3/man\u0000ifest.json"],
  ]) {
    const doc = versionsDoc();
    doc.versions[0].manifest = path;
    await refuses("bundle-invalid", () => importZip(multiVersion(doc)));
  }
  // Armed: the same bundle with the well-formed path imports.
  const ok = await importZip(multiVersion());
  eq(ok.resolved.entry.tag, "v0.1.3", "the untouched twin still resolves");
});

check("bundle: a multi-version bundle reads versions.json and resolves inside the tag dir", async () => {
  const pub = stubPublisher();
  const { resolved } = await importZip(multiVersion(), pub);
  eq(resolved.entry.tag, "v0.1.3", "versions[0]");
  eq(resolved.entry.publishedAt, "2026-01-02T00:00:00Z", "real date, not synthesised");
  eq(resolved.index.releasesUrl, "https://github.com/someone/minesweeper/releases", "releasesUrl");
  // The whole point of step 4: a `url` of "minesweeper.bin" resolves to the entry beside its
  // OWN manifest, `v0.1.3/minesweeper.bin`, not to the zip root.
  bytesEq(pub.seen[0].bytes, ENGINE, "resolved against the manifest's directory");
});

check("bundle: entries the manifest does not name are ignored, not installed", async () => {
  const pub = stubPublisher();
  const extra = new Uint8Array([1, 2, 3]);
  await importZip(singleTag(bundleManifest(), [["README.md", extra]]), pub);
  eq(pub.seen.length, 2, "the unnamed entry was never published");
});

check("bundle: release() revokes once and is idempotent", async () => {
  const imported = await importZip(singleTag());
  imported.release();
  imported.release(); // must not throw
});

// --- spec/06 step 1: zip paths are attacker-controlled ---------------------------------------

for (const [why, name] of [
  ["traversal", "../../etc/passwd"],
  ["a traversal segment", "v0.1.3/../../x.bin"],
  ["a leading slash", "/etc/passwd"],
  ["a backslash", "windows\\evil.bin"],
  ["a drive letter", "C:/evil.bin"],
]) {
  check(`bundle: an entry name with ${why} refuses the whole archive`, () =>
    refuses("bundle-invalid", () =>
      importZip(makeZip([["manifest.json", jsonBytes(bundleManifest())], [name, ENGINE]])),
    ));
}

check("bundle: a file that is not a zip is refused", () =>
  refuses("bundle-invalid", () => importZip(new Uint8Array(64).fill(0x41))));

check("bundle: a zip with neither versions.json nor manifest.json is refused", () =>
  refuses("bundle-invalid", () => importZip(makeZip([["notes.txt", ENGINE]]))));

check("bundle: a versions.json whose manifest path escapes the zip is refused", () =>
  refuses("bundle-invalid", () =>
    importZip(multiVersion(versionsDoc({
      versions: [{ ...versionsDoc().versions[0], manifest: "../../elsewhere/manifest.json" }],
    }))),
  ));

// --- The manifest's own guards still apply, exactly as they do to a fetched one --------------

check("bundle: a manifest naming a traversal artifact url is refused", () =>
  // The zip is clean; the MANIFEST is the attacker. This is the case `isPlainFilename` in
  // `resolveArtifacts` exists for, and it has to fire on the local path too.
  refuses("malformed", () =>
    importZip(singleTag(bundleManifest({}, { url: "../../boot.bin" })))));

check("bundle: a manifest naming a traversal artifact filename is refused", () =>
  refuses("malformed", () =>
    importZip(singleTag(bundleManifest({}, { filename: "../bios/boot.bin" })))));

check("bundle: an unsupported schemaVersion is refused, not guessed at", () =>
  refuses("unsupported-schema", () => importZip(singleTag(bundleManifest({ schemaVersion: 2 })))));

check("bundle: an unsupported schemaVersion in versions.json is refused", () =>
  refuses("unsupported-schema", () => importZip(multiVersion(versionsDoc({ schemaVersion: 99 })))));

check("bundle: a manifest that is not JSON is refused", () =>
  refuses("malformed", () =>
    importZip(makeZip([["manifest.json", new TextEncoder().encode("{ not json")]]))));

check("bundle: a bundle whose repo is not owner/repo is refused", () =>
  refuses("bad-url", () =>
    importZip(singleTag(bundleManifest({ source: { repo: "not a repo", commit: "0", ref: "v1" } })))));

// --- spec/06 step 5: check every file's bytes and sha256 before using it ----------------------

check("bundle: a file the manifest names but the zip lacks is an error", () =>
  refuses("bundle-missing-file", () =>
    importZip(makeZip([
      ["manifest.json", jsonBytes(bundleManifest())],
      ["minesweeper.elf", SYMS],
    ]))));

check("bundle: a payload whose sha256 disagrees with the manifest is refused", () =>
  // Same code the network path raises from `fetchVerified` — a local file gets no dispensation.
  refuses("malformed", () =>
    importZip(singleTag(bundleManifest({}, { sha256: "a".repeat(64) })))));

check("bundle: a payload whose length disagrees with the manifest is refused", () =>
  refuses("artifact-size-mismatch", () =>
    importZip(singleTag(bundleManifest({}, { bytes: ENGINE.length + 1 })))));

check("bundle: a rejected import leaves nothing published", async () => {
  const pub = stubPublisher();
  // The artifact verifies and is published; the SYMBOLS then fail. The partial work must be
  // released, or a refused zip would leak the bytes it did manage to verify.
  const m = bundleManifest();
  m.targets[0].symbols[0].sha256 = "b".repeat(64);
  await refuses("malformed", () => importZip(singleTag(m), pub));
  eq(pub.seen.length, 1, "one file was published before the failure");
});

// ============================================================================================
// 9. BIOS discovery and status (bios.ts; gwrg-dist-spec spec/07-cores.md, "BIOS")
// ============================================================================================
//
// `bios.ts` is pure and imports only `inputGate.ts` and `types.ts`, so it compiles in the same
// way the entry points above do. It is built separately rather than added to that list so this
// section stays self-contained at the end of the file.
//
// What these prove:
//   - `requiredFor` is resolved against the user's ACTUAL games, not blanket-applied.
//   - `strict` + a wrong hash BLOCKS, and the same bytes with `strict: false` do not.
//   - matching is by filename and ignores the directory (which is not knowable — see the
//     module header and docs/proposals/bios-placement.md).

await esbuild.build({
  entryPoints: [join(here, "../bios.ts")],
  outdir: out,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  external: ["module"],
  target: "es2022",
  logLevel: "warning",
});
const { biosDestKey, collectBiosNeeds, resolveBiosStatus, matchCandidates, outstanding, sortForDisplay, extensionOf } =
  await load("bios.js");

/** The GBA BIOS as `gba-retro-go-sd/gwrg.json` actually declares it, hash and all. */
const GBA_BIOS = {
  id: "gba-bios",
  filename: "gba_bios.bin",
  required: false,
  bytes: 16384,
  sha1: "300C20DF6731A33952DED8C436F7F186D25D3492",
  strict: true,
  label: { en: "Game Boy Advance BIOS" },
};

/** `disksys.rom` — spec/07's own worked case for `requiredFor`. */
const DISKSYS = {
  id: "disksys",
  filename: "disksys.rom",
  requiredFor: [".fds"],
  label: { en: "Famicom Disk System BIOS" },
};

const COLECO = {
  id: "coleco",
  filename: "coleco.bin",
  required: true,
  bytes: 8192,
  label: { en: "ColecoVision BIOS" },
};

const system = (id, bios, extensions = [".nes", ".fds"]) => ({
  id,
  longName: id.toUpperCase(),
  shortName: id,
  extensions,
  browse: "file",
  compression: false,
  bios,
});

const emuSource = (repo, systems) => ({
  repo,
  manifest: {
    schemaVersion: 1,
    project: repo.split("/")[1],
    title: repo.split("/")[1],
    source: { repo, commit: "…", ref: "v0" },
    tools: [],
    targets: [
      {
        id: "gnw-retro-go",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind: "emulator",
        requiresAbi: { version: 2, minSize: 1 },
        artifacts: [],
        systems,
      },
    ],
  },
});

check("bios: extensionOf lowercases and keeps the dot; a dotless name has none", () => {
  eq(extensionOf("Mario.FDS"), ".fds", "extension");
  eq(extensionOf("README"), "", "no extension");
  eq(extensionOf(".gitignore"), "", "a leading dot is not an extension");
});

check("bios: `required: true` is required regardless of what the user owns", () => {
  const needs = collectBiosNeeds([emuSource("a/col", [system("col", [COLECO], [".col"])])], []);
  eq(needs.length, 1, "one slot");
  eq(needs[0].need, "required", "need");
  eq(needs[0].systemName, "COL", "longName carried through, untranslated");
});

check("bios: `requiredFor` is idle when nothing the user has needs it", () => {
  // Cartridges only. spec/07: saying "required" here would over-state it for everyone who
  // only has cartridges.
  const games = [{ system: "nes", name: "Super Mario Bros.nes" }];
  const needs = collectBiosNeeds([emuSource("a/nes", [system("nes", [DISKSYS])])], games);
  eq(needs[0].need, "conditional-idle", "need");
});

check("bios: `requiredFor` bites once a matching game appears", () => {
  const games = [
    { system: "nes", name: "Super Mario Bros.nes" },
    { system: "nes", name: "Zelda.FDS" }, // upper case on purpose
  ];
  const needs = collectBiosNeeds([emuSource("a/nes", [system("nes", [DISKSYS])])], games);
  eq(needs[0].need, "conditional-hit", "need");
});

check("bios: a matching extension in a DIFFERENT system does not trigger it", () => {
  const games = [{ system: "fds", name: "Zelda.fds" }];
  const needs = collectBiosNeeds([emuSource("a/nes", [system("nes", [DISKSYS])])], games);
  eq(needs[0].need, "conditional-idle", "need");
});

check("bios: `required: false` is optional, and a homebrew target contributes nothing", () => {
  const emu = emuSource("a/gba", [system("gba", [GBA_BIOS], [".gba"])]);
  eq(collectBiosNeeds([emu], [])[0].need, "optional", "need");
  const hb = emuSource("a/hb", [system("x", [COLECO])]);
  hb.manifest.targets[0].kind = "homebrew";
  eq(collectBiosNeeds([hb], []).length, 0, "a homebrew target declares no systems to read");
});

check("bios: a slot with neither `required` nor `requiredFor` understates, never invents", () => {
  const bad = { id: "x", filename: "x.rom", label: { en: "X" } };
  eq(collectBiosNeeds([emuSource("a/x", [system("x", [bad])])], [])[0].need, "optional", "need");
});

check("bios: `filename` as a list is ONE slot that accepts several names", () => {
  const syscard = {
    id: "syscard3",
    filename: ["syscard3.pce", "syscard3.bin"],
    required: true,
    label: { en: "System Card 3" },
  };
  const needs = collectBiosNeeds([emuSource("a/pce", [system("pcecd", [syscard], [".cue"])])], []);
  eq(needs.length, 1, "one slot, not two");
  eq(needs[0].filenames.join(","), "syscard3.pce,syscard3.bin", "both names");
  // Either name fills it.
  eq(matchCandidates(needs[0], [{ where: "folder", path: "bios/pce/syscard3.bin", size: 1 }]).length, 1, "second name matches");
});

check("bios: matching is by filename and ignores the directory", async () => {
  // ColecoVision is why: its ROMs live in roms/col/ and its BIOS in /bios/coleco/, so no
  // directory a host could derive would be right. See docs/proposals/bios-placement.md.
  const needs = collectBiosNeeds([emuSource("a/col", [system("col", [COLECO], [".col"])])], []);
  const pool = [
    { where: "folder", path: "col_bios/COLECO.BIN", bytes: new Uint8Array(8192), size: 8192 },
  ];
  const [st] = await resolveBiosStatus(needs, pool);
  eq(st.present, true, "found despite the wrong-looking directory and the case difference");
  eq(st.verified, "unchecked", "no sha1 published, so nothing to verify against");
  eq(st.blocked, false, "not blocked");
});

check("bios: the declared size is enforced even with no hash published", async () => {
  const needs = collectBiosNeeds([emuSource("a/col", [system("col", [COLECO], [".col"])])], []);
  const truncated = [
    { where: "folder", path: "bios/coleco/coleco.bin", bytes: new Uint8Array(4096), size: 4096 },
  ];
  const [st] = await resolveBiosStatus(needs, truncated);
  eq(st.present, true, "the file is there");
  eq(st.verified, "mismatch", "…and it is the wrong size");
  eq(st.blocked, true, "so it is refused — a truncated Coleco BIOS boots into garbage silently");
});

check("bios: a strict hash mismatch blocks; the same bytes with strict:false do not", async () => {
  const wrong = new Uint8Array(16384).fill(1);
  const strictNeeds = collectBiosNeeds([emuSource("a/gba", [system("gba", [GBA_BIOS], [".gba"])])], []);
  const pool = [{ where: "folder", path: "bios/gba/gba_bios.bin", bytes: wrong, size: wrong.length }];
  const [strictSt] = await resolveBiosStatus(strictNeeds, pool);
  eq(strictSt.verified, "mismatch", "hash disagreed");
  eq(strictSt.blocked, true, "strict refuses it");
  eq(strictSt.sha1.length, 40, "the computed hash is reported so the user can look it up");

  const lax = collectBiosNeeds(
    [emuSource("a/gba", [system("gba", [{ ...GBA_BIOS, strict: false }], [".gba"])])],
    [],
  );
  const [laxSt] = await resolveBiosStatus(lax, pool);
  eq(laxSt.verified, "mismatch", "still reported as a mismatch");
  eq(laxSt.blocked, false, "…but accepted, and SAID to be unrecognised");
});

check("bios: the device side is reported present but unchecked (no bytes to hash)", async () => {
  const needs = collectBiosNeeds([emuSource("a/gba", [system("gba", [GBA_BIOS], [".gba"])])], []);
  const [st] = await resolveBiosStatus(needs, [
    { where: "device", path: "bios/gba/gba_bios.bin", size: 16384 },
  ]);
  eq(st.present, true, "present");
  eq(st.verified, "unchecked", "a FrogFS listing is metadata only");
  eq(st.found[0].where, "device", "where");
});

check("bios: `outstanding` is what the user must act on, and nothing else", async () => {
  const needs = collectBiosNeeds(
    [
      emuSource("a/col", [system("col", [COLECO], [".col"])]), // required, missing
      emuSource("a/gba", [system("gba", [GBA_BIOS], [".gba"])]), // optional, missing
      emuSource("a/nes", [system("nes", [DISKSYS])]), // conditional, idle
    ],
    [],
  );
  const all = await resolveBiosStatus(needs, []);
  const out = outstanding(all);
  eq(out.length, 1, "only the required-and-missing one");
  eq(out[0].id, "coleco", "which one");
  // A present, verified file is not outstanding.
  const good = await resolveBiosStatus(needs, [
    { where: "device", path: "bios/coleco/coleco.bin", size: 8192 },
  ]);
  eq(outstanding(good).length, 0, "nothing left once it is there");
});

check("bios: display order puts blocked first, then required-and-missing", async () => {
  const wrong = new Uint8Array(16384).fill(1);
  const needs = collectBiosNeeds(
    [
      emuSource("a/gba", [system("gba", [GBA_BIOS], [".gba"])]),
      emuSource("a/col", [system("col", [COLECO], [".col"])]),
    ],
    [],
  );
  const all = await resolveBiosStatus(needs, [
    { where: "folder", path: "bios/gba/gba_bios.bin", bytes: wrong, size: wrong.length },
  ]);
  const order = sortForDisplay(all).map((s) => s.id);
  eq(order.join(","), "gba-bios,coleco", "blocked before required-and-missing");
});

check("bios: keys stay unique across sources declaring the same slot id", async () => {
  const needs = collectBiosNeeds(
    [
      emuSource("a/one", [system("nes", [DISKSYS])]),
      emuSource("b/two", [system("nes", [DISKSYS])]),
    ],
    [],
  );
  const all = await resolveBiosStatus(needs, []);
  eq(new Set(all.map((s) => s.key)).size, 2, "two distinct keys");
});


// ============================================================================================
// 10. Two gaps that were latent rather than live (2026-09-07)
// ============================================================================================

// --- 10a. A converter whose inputs are ALL OPTIONAL --------------------------------------------
//
// The old classification was `selfContained = no REQUIRED input`, and the caller only opened
// the file prompt for a title that was NOT self-contained — so an all-optional tool skipped
// the prompt and its inputs could never be supplied. `inputNeed` separates the two questions;
// these pin both answers, including the one that must NOT change: no tool ⇒ nothing to ask.

const inputSpec = (id, required) => ({
  id,
  required,
  allowMultiple: false,
  extensions: [".bin"],
  maxBytes: 1024,
  variants: [],
  strict: true,
});

check("inputNeed: no inputs at all asks for nothing", () => {
  eq(inputNeed([]), "none", "empty inputs");
});

check("inputNeed: an all-optional tool still has something to prompt for", () => {
  eq(inputNeed([inputSpec("a", false), inputSpec("b", false)]), "optional", "all optional");
});

check("inputNeed: one required input makes the whole tool required", () => {
  eq(inputNeed([inputSpec("a", false), inputSpec("b", true)]), "required", "mixed");
});

// The two derived flags exactly as `homebrewTitles.svelte.ts` computes them. That file is a
// runes module and cannot run under node, so the rule it applies is asserted here on the same
// helper it calls.
const flags = (inputs) => {
  const need = inputNeed(inputs);
  return { selfContained: need !== "required", promptsForInput: need !== "none" };
};

check("optional-only titles are self-contained AND prompt (the gap)", () => {
  const f = flags([inputSpec("a", false)]);
  eq(f.selfContained, true, "runs without the file");
  eq(f.promptsForInput, true, "but can still be offered it");
});

check("a title with no tool prompts for nothing (must not regress)", () => {
  const f = flags([]);
  eq(f.selfContained, true, "self-contained");
  eq(f.promptsForInput, false, "straight to fetching artifacts");
});

check("a required input still prompts and is not self-contained", () => {
  const f = flags([inputSpec("a", true)]);
  eq(f.selfContained, false, "needs the file");
  eq(f.promptsForInput, true, "prompts");
});

// --- 10b. BIOS already on the SD card ----------------------------------------------------------
//
// In SD mode the device's content is not in FrogFS at all, so a BIOS on the card used to read
// as missing. `scanSdBios` walks the card's `bios/` subtree — and only that subtree: reusing
// the ROM scan would read every ROM on the card to find a handful of small files.

await esbuild.build({
  entryPoints: [join(here, "../sdBios.ts")],
  outdir: out,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  external: ["module"],
  target: "es2022",
  logLevel: "warning",
});
const { scanSdBios } = await load("sdBios.js");

/** A fake File System Access directory tree. Values are bytes (file) or objects (directory). */
function fakeDir(name, tree) {
  return {
    kind: "directory",
    name,
    async *entries() {
      for (const [key, value] of Object.entries(tree)) {
        if (value instanceof Uint8Array) {
          yield [key, {
            kind: "file",
            name: key,
            getFile: async () => ({
              size: value.length,
              arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.length),
            }),
          }];
        } else {
          yield [key, fakeDir(key, value)];
        }
      }
    },
  };
}

const COLECO_BYTES = new Uint8Array(8192).fill(0x42);

check("sd: a card with no bios/ directory yields no candidates", async () => {
  const found = await scanSdBios(fakeDir("sd", { roms: { col: { "a.col": new Uint8Array(4) } } }));
  eq(found.length, 0, "nothing found");
});

check("sd: bios/ is walked, with bytes, and roms/ is not", async () => {
  const found = await scanSdBios(
    fakeDir("sd", {
      roms: { col: { "a.col": new Uint8Array(4096) } },
      bios: { "logo.bin": new Uint8Array(64), coleco: { "coleco.bin": COLECO_BYTES } },
    }),
  );
  const paths = found.map((c) => c.path).sort();
  eq(paths.join(","), "bios/coleco/coleco.bin,bios/logo.bin", "the bios subtree only");
  const coleco = found.find((c) => c.path === "bios/coleco/coleco.bin");
  eq(coleco.where, "device", "the card IS the device side in SD mode");
  eq(coleco.size, 8192, "size");
  bytesEq(coleco.bytes, COLECO_BYTES, "bytes read for hashing");
});

check("sd: hidden entries are skipped and an oversized file is reported unread", async () => {
  const found = await scanSdBios(
    fakeDir("sd", {
      bios: { ".DS_Store": new Uint8Array(8), "huge.bin": new Uint8Array(1024 * 1024 + 1) },
    }),
  );
  eq(found.length, 1, "only the real file");
  eq(found[0].path, "bios/huge.bin", "path");
  eq(found[0].bytes, undefined, "not read into memory");
  eq(found[0].size, 1024 * 1024 + 1, "size still reported");
});

// The point of all of the above: a card BIOS resolves as present + verified, where the
// Flash-mode FrogFS listing (metadata only) can only ever say "unchecked".
check("sd: a card BIOS satisfies a slot and is hashed", async () => {
  const sha1 = createHash("sha1").update(COLECO_BYTES).digest("hex").toUpperCase();
  const entry = { id: "coleco", filename: "coleco.bin", required: true, bytes: 8192, sha1, strict: true };
  const needs = collectBiosNeeds([emuSource("a/col", [system("col", [entry], [".col"])])], []);
  const candidates = await scanSdBios(fakeDir("sd", { bios: { coleco: { "coleco.bin": COLECO_BYTES } } }));
  const all = await resolveBiosStatus(needs, candidates);
  eq(all[0].present, true, "present");
  eq(all[0].verified, "ok", "hashed against the declared sha1");
  eq(outstanding(all).length, 0, "nothing left to do");
});


// --- The optional-file tail (FilePromptModal) -------------------------------------------------
//
// The rule the owner set: every optional input is in the collapsible tail, or there is no tail.
// Never a partial one. `splitPrompt` is where that is decided, so it is what is pinned here.

check("prompt: splitPrompt puts every optional input in the tail and no required one", () => {
  const mk = (id, required) => ({ id, required });
  const { required, optional } = splitPrompt([
    mk("a", false), mk("b", true), mk("c", false), mk("d", true), mk("e", false),
  ]);
  eq(required.map((i) => i.id).join(","), "b,d", "required stay visible, in manifest order");
  eq(optional.map((i) => i.id).join(","), "a,c,e", "ALL optional ones, in manifest order");
  eq(required.length + optional.length, 5, "every input lands in exactly one group");
});

check("prompt: no optional inputs means no tail at all", () => {
  eq(splitPrompt([{ id: "a", required: true }]).optional.length, 0, "nothing to disclose");
  eq(splitPrompt([]).optional.length, 0, "and an empty prompt has no tail either");
  eq(splitPrompt([]).required.length, 0, "nor anything visible");
});

check("prompt: one optional input still gets the tail, not a special case", () => {
  const s = splitPrompt([{ id: "a", required: true }, { id: "b", required: false }]);
  eq(s.optional.length, 1, "a single optional input is disclosed like any other");
  eq(s.required.length, 1, "the required one is unaffected");
});

// --- BIOS placement (biosDestKey) --------------------------------------------------------------
// Where an accepted file is STORED, which is the whole difference between reporting a BIOS as
// missing and installing one. The keys asserted here are folder-scan keys: `flashImage.ts`'s
// `userDest` passes a `bios/` key through unchanged, and the SD path copies it verbatim.

const destNeed = (systemId, entry, biosDir) => ({
  systemId,
  biosDir: biosDir ?? systemId,
  filenames: Array.isArray(entry.filename) ? entry.filename : [entry.filename],
  entry,
});

check("bios: a known system's file goes to its firmware directory", () => {
  eq(
    biosDestKey(destNeed("nes", { id: "d", filename: "disksys.rom" }), "disksys.rom"),
    "bios/nes/disksys.rom",
    "nes",
  );
});

// The single case that refuses every derivation from `id`/`dirname`: ROMs in `roms/col`, BIOS
// in `/bios/coleco` (main_smsplusgx.c:127).
check("bios: colecovision uses coleco/, not its col dirname", () => {
  eq(
    biosDestKey(destNeed("col", { id: "c", filename: "coleco.bin" }, "coleco"), "coleco.bin"),
    "bios/coleco/coleco.bin",
    "col -> coleco",
  );
});

check("bios: a system we have never seen still gets its own id as the directory", () => {
  eq(
    biosDestKey(destNeed("lynx", { id: "l", filename: "lynxboot.img" }), "lynxboot.img"),
    "bios/lynx/lynxboot.img",
    "id default, no table consulted",
  );
});

// The cores open exact literals on a case-sensitive filesystem, so the manifest's spelling wins.
check("bios: the declared filename's case wins over the user's", () => {
  eq(
    biosDestKey(destNeed("msx", { id: "m", filename: ["MSX2PEXT.rom"] }), "msx2pext.ROM"),
    "bios/msx/MSX2PEXT.rom",
    "canonical spelling",
  );
});

check("bios: a user filename never escapes the bios directory", () => {
  eq(
    biosDestKey(destNeed("lynx", { id: "l", filename: "x.img" }), "../../roms/nes/evil.nes"),
    "bios/lynx/evil.nes",
    "path stripped",
  );
  eq(
    biosDestKey(destNeed("lynx", { id: "l", filename: "x.img" }), "...img"),
    "bios/lynx/img",
    "leading dots stripped",
  );
});

// ============================================================================================
// 10. BIOS install policy: SD vs Flash (bios.ts)  [BEGIN — self-contained, appended section]
// ============================================================================================
//
// The two media deliberately disagree about which declared BIOS an install writes:
//
//   - SD  — write it for any ACTIVE emulator source, games or not. A card is open: the user
//           drops ROMs onto it outside this app, and a missing BIOS means those silently fail.
//   - Flash — the content set is closed and the gap is scarce, so a BIOS for a system with no
//           games is dead weight. This is the general form of the `bios/msx` omission
//           `packages/fs-builders/src/flashImage.ts` already applies ("omit when no MSX games
//           present"); the two agree, so the builder's own drop stays a no-op rather than a
//           second opinion.
//
// Everything below builds its own fixtures so this block can be moved or merged as one piece.

const {
  installsBios: policyInstalls,
  biosOmittedFilenames: policyOmitted,
  biosAllowedFilenames: policyAllowed,
  applyBiosPolicy: policyApply,
  isBiosFolderKey: policyIsBiosKey,
  collectBiosNeeds: policyCollect,
} = await load("bios.js");

const POL_MSX = { id: "msx-bios", filename: "MSX.rom", required: true, label: { en: "MSX BIOS" } };
const POL_DISKSYS = { id: "disksys", filename: "disksys.rom", requiredFor: [".fds"], label: { en: "FDS" } };

const polSystem = (id, bios, extensions) => ({
  id,
  longName: id.toUpperCase(),
  shortName: id,
  extensions,
  browse: "file",
  compression: false,
  bios,
});

const polSource = (repo, systems) => ({
  repo,
  manifest: {
    schemaVersion: 1,
    project: "p",
    title: "p",
    source: { repo, commit: "…", ref: "v0" },
    tools: [],
    targets: [
      {
        id: "gnw-retro-go",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind: "emulator",
        requiresAbi: { version: 2, minSize: 1 },
        artifacts: [],
        systems,
      },
    ],
  },
});

/** Both systems declared by one active source; `games` decides what is present. */
const polNeeds = (games) =>
  policyCollect(
    [
      polSource("o/emu", [
        polSystem("msx", [POL_MSX], [".rom"]),
        polSystem("nes", [POL_DISKSYS], [".nes", ".fds"]),
      ]),
    ],
    games,
  );

check("bios policy: SD writes an active source's BIOS with no games at all", () => {
  const needs = polNeeds([]);
  eq(needs.length, 2, "both slots collected");
  eq(policyOmitted(needs, [], "sd").size, 0, "SD omits nothing");
  for (const n of needs) assert(policyInstalls(n.need, "sd", false), `${n.id} installs on SD`);
});

check("bios policy: Flash omits a BIOS whose system has no games", () => {
  const needs = polNeeds([]);
  const omit = policyOmitted(needs, [], "flash");
  assert(omit.has("msx.rom"), "MSX BIOS omitted — no MSX games");
  assert(omit.has("disksys.rom"), "disksys omitted — no NES games");
});

check("bios policy: Flash keeps a required BIOS once its system has a game", () => {
  const games = [{ system: "msx", name: "aleste.rom" }];
  const needs = polNeeds(games);
  const omit = policyOmitted(needs, games, "flash");
  assert(!omit.has("msx.rom"), "MSX BIOS kept");
  assert(omit.has("disksys.rom"), "disksys still omitted — no NES games");
});

// `requiredFor` is narrower than a system: cartridges present, disk images not.
check("bios policy: Flash omits a conditional-idle BIOS even when the system has games", () => {
  const games = [{ system: "nes", name: "mario.nes" }];
  const needs = polNeeds(games);
  eq(needs.find((n) => n.id === "disksys").need, "conditional-idle", "idle");
  assert(policyOmitted(needs, games, "flash").has("disksys.rom"), "omitted for cartridges");
  const fds = [{ system: "nes", name: "zelda.fds" }];
  const hit = polNeeds(fds);
  eq(hit.find((n) => n.id === "disksys").need, "conditional-hit", "hit");
  assert(!policyOmitted(hit, fds, "flash").has("disksys.rom"), "kept for disk images");
});

// The SD rule is the whole point of the split, restated against the same fixture.
check("bios policy: the same library yields different sets on SD and Flash", () => {
  const games = [{ system: "nes", name: "mario.nes" }];
  const needs = polNeeds(games);
  eq(policyOmitted(needs, games, "sd").size, 0, "SD: nothing omitted");
  eq(policyOmitted(needs, games, "flash").size, 2, "Flash: msx + disksys omitted");
});

// Two sources can want the same file; one of them wanting it is enough.
check("bios policy: a filename kept by one slot is not omitted for another's sake", () => {
  const games = [{ system: "msx", name: "aleste.rom" }];
  const needs = policyCollect(
    [
      polSource("o/a", [polSystem("msx", [POL_MSX], [".rom"])]),
      polSource("o/b", [polSystem("msx2", [POL_MSX], [".rom"])]),
    ],
    games,
  );
  eq(needs.length, 2, "both sources declared it");
  eq(policyOmitted(needs, games, "flash").size, 0, "kept");
});

check("bios policy: applyBiosPolicy drops only matching BIOS keys, both folder shapes", () => {
  const rom = new Uint8Array([1]);
  const map = new Map([
    ["bios/msx/MSX.rom", rom],
    ["msx_bios/MSX.rom", rom],
    ["bios/nes/disksys.rom", rom],
    ["nes/mario.nes", rom],
    ["covers/nes/mario.png", rom],
  ]);
  const out = policyApply(map, new Set(["msx.rom"]));
  assert(!out.has("bios/msx/MSX.rom"), "bios/ shape dropped");
  assert(!out.has("msx_bios/MSX.rom"), "<sys>_bios/ shape dropped");
  assert(out.has("bios/nes/disksys.rom"), "unrelated BIOS kept");
  assert(out.has("nes/mario.nes"), "games untouched");
  assert(out.has("covers/nes/mario.png"), "covers untouched");
  eq(map.size, 5, "the input map is not mutated");
});

check("bios policy: an empty omission set returns the map itself (SD costs no copy)", () => {
  const map = new Map([["bios/msx/MSX.rom", new Uint8Array([1])]]);
  assert(policyApply(map, new Set()) === map, "same reference");
});

// THE REVERSAL. This check used to assert the opposite ("an undeclared BIOS file is never
// omitted"), on the reasoning that dropping a file no manifest mentioned would be a guess. A
// general RetroArch-style bios/ collection is what that reasoning did not survive.
check("bios policy: an undeclared BIOS file is never installed", () => {
  const needs = polNeeds([{ system: "msx", name: "aleste.rom" }]);
  const allow = policyAllowed(needs);
  const map = new Map([["bios/logo.bin", new Uint8Array([1])]]);
  assert(!policyApply(map, new Set(), allow).has("bios/logo.bin"), "dropped");
});

check("bios policy: biosAllowedFilenames names every declared filename and nothing else", () => {
  const allow = policyAllowed(polNeeds([]));
  eq(allow.size, 2, "two slots declared");
  assert(allow.has("msx.rom") && allow.has("disksys.rom"), "both, lowercased");
  assert(!allow.has("scph5501.bin"), "nothing undeclared");
  eq(policyAllowed([]).size, 0, "no declared slot allows nothing");
});

// ---------------------------------------------------------------------------------------------
// The owner's own folder. A RetroArch-style bios/ collection pointed at a Game & Watch: the
// install projected 42 files / 19,521,849 bytes with `selectedRoms: 0`. The rule he stated is
// that a BIOS is brought in by a core that needs it, and nothing else brings one in.
// ---------------------------------------------------------------------------------------------

const RETROARCH_BIOS = [
  "bios/111_Bios_System.txt",
  "bios/BS-X.bin",
  "bios/PSXONPSP660.bin",
  "bios/STBIOS.bin",
  "bios/Sony - PlayStation 2 (PCSX2).7z",
  "bios/areplay.bin",
  "bios/bios.gg",
  "bios/bios.sms",
  "bios/bios7.bin",
  "bios/bios9.bin",
  "bios/bios_CD_E.bin",
  "bios/bios_CD_J.bin",
  "bios/dsi_firmware.bin",
  "bios/lynxboot.img",
  "bios/msxromdb.xml",
  "bios/pcfx.rom",
  "bios/README.md",
  "bios/saturn_bios.bin",
  "bios/scph101.bin",
  "bios/scph5501.bin",
  "bios/syscard1.pce",
  "bios/syscard2.pce",
  // The two the device can actually use, mixed in with the rest.
  "bios/MSX.rom",
  "bios/nes/disksys.rom",
];

const retroarchFolder = () => new Map(RETROARCH_BIOS.map((k) => [k, new Uint8Array([1])]));

const filterFor = (games) => {
  const needs = polNeeds(games);
  return policyApply(retroarchFolder(), policyOmitted(needs, games, "flash"), policyAllowed(needs));
};

check("bios policy: a general BIOS collection contributes nothing with nothing installing", () => {
  const out = filterFor([]);
  eq(out.size, 0, "no core is installing, so no BIOS rides in");
});

check("bios policy: a general BIOS collection contributes only the core's own file", () => {
  const out = filterFor([{ system: "msx", name: "aleste.rom" }]);
  eq([...out.keys()].join(), "bios/MSX.rom", "MSX BIOS only");
  for (const k of ["bios/scph5501.bin", "bios/saturn_bios.bin", "bios/README.md",
                   "bios/Sony - PlayStation 2 (PCSX2).7z", "bios/syscard2.pce"]) {
    assert(!out.has(k), `${k} never reaches the device`);
  }
});

// The slot is declared AND its core is installing: a BIOS the device genuinely needs still ships.
check("bios policy: a declared slot still installs once its games are in the image", () => {
  const out = filterFor([{ system: "nes", name: "zelda.fds" }]);
  assert(out.has("bios/nes/disksys.rom"), "disksys ships for disk images");
  assert(!out.has("bios/MSX.rom"), "MSX BIOS does not, no MSX games");
});

check("bios policy: isBiosFolderKey matches both shapes and nothing else", () => {
  assert(policyIsBiosKey("bios/logo.bin"), "bios/");
  assert(policyIsBiosKey("msx_bios/MSX.rom"), "<sys>_bios/");
  assert(!policyIsBiosKey("nes/mario.nes"), "a game");
  assert(!policyIsBiosKey("bios"), "a bare name is not a key");
});

// [END — BIOS install policy section]

// ============================================================================================
// 11. systems[].biosDir (client.ts parse + bios.ts resolution)  [BEGIN — self-contained]
// ============================================================================================
//
// The spec's optional `biosDir` names the directory under `/bios`; omitted means the system's
// `id`. Only two systems in the fleet diverge (col -> coleco, pcecd -> pce), which is exactly
// why the field exists and why a host-side table did not.

const { biosDestKey: bdKey, collectBiosNeeds: bdCollect } = await load("bios.js");

const bdEntry = { id: "b", filename: "bios.bin", required: true, label: { en: "BIOS" } };

const bdSystem = (id, biosDir) => ({
  id,
  longName: id.toUpperCase(),
  shortName: id,
  extensions: [".bin"],
  browse: "file",
  compression: false,
  ...(biosDir === undefined ? {} : { biosDir }),
  bios: [bdEntry],
});

const bdSource = (systems) => ({
  repo: "a/b",
  manifest: {
    schemaVersion: 1,
    project: "b",
    title: "b",
    source: { repo: "a/b", commit: "…", ref: "v0" },
    tools: [],
    targets: [
      {
        id: "t",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind: "emulator",
        requiresAbi: { version: 2, minSize: 1 },
        artifacts: [],
        systems,
      },
    ],
  },
});

check("biosDir: omitted means the system's id", () => {
  const need = bdCollect([bdSource([bdSystem("nes")])], [])[0];
  eq(need.biosDir, "nes", "resolved directory");
  eq(bdKey(need, "bios.bin"), "bios/nes/bios.bin", "dest key");
});

check("biosDir: an explicit value wins over the id", () => {
  const need = bdCollect([bdSource([bdSystem("gba", "gbabios")])], [])[0];
  eq(need.biosDir, "gbabios", "resolved directory");
  eq(bdKey(need, "bios.bin"), "bios/gbabios/bios.bin", "dest key");
});

// The two real divergences in the whole fleet, and the reason the field exists at all.
check("biosDir: colecovision col -> bios/coleco", () => {
  const need = bdCollect([bdSource([bdSystem("col", "coleco")])], [])[0];
  eq(bdKey(need, "coleco.bin"), "bios/coleco/coleco.bin", "col -> coleco");
});

check("biosDir: pc engine cd pcecd -> bios/pce", () => {
  const need = bdCollect([bdSource([bdSystem("pcecd", "pce")])], [])[0];
  eq(bdKey(need, "syscard3.pce"), "bios/pce/syscard3.pce", "pcecd -> pce");
});

check("biosDir: a hostile value reaching biosDestKey directly is refused, not honoured", () => {
  eq(
    bdKey({ biosDir: "../../roms/nes", filenames: ["bios.bin"] }, "bios.bin"),
    "bios/bios.bin",
    "rejected -> /bios root, no traversal",
  );
});

// [END — biosDir section]

// ============================================================================================
// 12. biosDir at the PARSE boundary + bundle persistence  [BEGIN — self-contained]
// ============================================================================================
//
// Two unrelated things, kept together only because they are appended as one block.
//
// 12a proves `client.ts`'s guard on `systems[].biosDir`. Section 11 above proves what a
// biosDir RESOLVES to; this proves what is allowed to become one in the first place. The rule
// is `isPlainFilename` — the same rule every other path-shaped manifest string goes through —
// and the interesting half is what it does NOT reject: a mid-name space is legal, because
// nothing about a space escapes a directory and refusing it would be a guess about taste
// rather than a guard.
//
// 12b proves `bundleStore.ts`: an imported bundle's zip is kept so a reload can re-import it
// instead of asking the user for the file again. The property that matters is that restoring
// is not a shortcut — it is `importBundle()` in full, so every length and digest is checked
// again, and the payloads it hands back are hashed AGAIN by `installArtifacts.ts` when they
// are installed. A local store is not a trust boundary.

const { restoreBundle, keepBundle, forgetBundle } = await load("bundleStore.js");

// --- 12a. systems[].biosDir, as parsed ---------------------------------------------------------

const MISSING = Symbol("omitted");

/** Parse a manifest whose one system carries `biosDir`, and report what survived. */
function parsedBiosDir(biosDir) {
  const m = bundleManifest();
  m.targets[0].kind = "emulator";
  m.targets[0].systems = [
    {
      id: "nes",
      longName: "Nintendo Entertainment System",
      shortName: "NES",
      extensions: [".nes"],
      browse: "file",
      compression: false,
      ...(biosDir === MISSING ? {} : { biosDir }),
    },
  ];
  const parsed = parseManifest(m, "https://x.invalid/v1/manifest.json");
  return parsed.targets[0].systems[0].biosDir;
}

// The two real divergences in the fleet: these must survive parsing, or section 11's
// resolution has nothing to resolve.
check('biosDir parse: "pce" is kept', () => eq(parsedBiosDir("pce"), "pce", "pce"));
check('biosDir parse: "coleco" is kept', () => eq(parsedBiosDir("coleco"), "coleco", "coleco"));

// NOT a rejection. `isPlainFilename` bans separators and traversal, not spaces — a name with a
// space in the middle cannot point anywhere but where it says, and dropping it would silently
// send that system's BIOS to the `/bios` root (section 11's hostile-value check shows what
// "dropped" costs).
check("biosDir parse: a mid-name space is legal and kept", () =>
  eq(parsedBiosDir("a b"), "a b", "a b"));

for (const [why, value] of [
  ["omitted entirely", MISSING],
  ["a traversal", "../etc"],
  ["a separator", "a/b"],
  ["a bare dot", "."],
  ["a bare double dot", ".."],
  ["a backslash", "a\\b"],
  ["empty", ""],
  ["padded with spaces", " pce "],
  ["carrying a control character", "pce\u0001"],
  ["not a string", 42],
]) {
  check(`biosDir parse: ${why} yields undefined`, () => eq(parsedBiosDir(value), undefined, why));
}

// --- 12b. Bundle payloads across a reload ------------------------------------------------------

/** An in-memory `BundleBlobStore`. `fail` makes every operation behave like a refused store. */
function fakeBlobStore({ fail = false, failPut = false } = {}) {
  const map = new Map();
  return {
    map,
    get: async (repo) => (fail ? null : (map.get(repo) ?? null)),
    put: async (repo, zip) => {
      if (fail || failPut) return false;
      map.set(repo, zip.slice());
      return true;
    },
    delete: async (repo) => void map.delete(repo),
  };
}

/** Index of `needle` inside `hay`, or -1. Used to tamper with a payload where it lies. */
function findBytes(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

check("persist: a kept zip restores as a fully re-imported, installable source", async () => {
  const store = fakeBlobStore();
  eq(await keepBundle("someone/minesweeper", singleTag(), store), true, "kept");

  // The reload. Nothing from the first import is carried over — this is the zip alone.
  const pub = stubPublisher();
  const restored = await restoreBundle("someone/minesweeper", { store, publish: pub.publish });
  assert(restored, "a kept bundle must come back");
  eq(restored.resolved.repo, "someone/minesweeper", "repo");
  eq(restored.resolved.entry.tag, "v0.1.3", "tag");
  // Installable means: the artifact carries a URL that resolves to bytes, published fresh.
  eq(restored.resolved.manifest.targets[0].artifacts[0].url, "stub:minesweeper.bin#1", "relinked");
  eq(pub.seen.length, 2, "both named files re-published");
  bytesEq(pub.seen[0].bytes, ENGINE, "the restored payload is the original bytes");
});

check("persist: restoring RE-VERIFIES; it does not trust what it stored", async () => {
  const store = fakeBlobStore();
  // A zip that imported cleanly, then had a payload altered where it lay. Whatever could do
  // that could also have set a "verified" flag beside it, which is exactly why there is none.
  await keepBundle("someone/minesweeper", singleTag(), store);
  const stored = store.map.get("someone/minesweeper");
  const at = findBytes(stored, ENGINE);
  assert(at >= 0, "sanity: the payload is stored uncompressed and findable");
  const tampered = stored.slice();
  tampered[at + 5] ^= 0xff;
  store.map.set("someone/minesweeper", tampered);

  const pub = stubPublisher();
  eq(await restoreBundle("someone/minesweeper", { store, publish: pub.publish }), null, "refused");
  eq(pub.seen.length, 0, "nothing published from bytes that failed verification");
  // And the bad bytes are dropped rather than re-failing on every future visit.
  eq(store.map.has("someone/minesweeper"), false, "a zip that will never verify is not kept");
});

check("persist: nothing stored degrades to re-import, it does not invent a source", async () => {
  eq(await restoreBundle("someone/minesweeper", { store: fakeBlobStore() }), null, "no zip -> null");
});

check("persist: an unavailable store degrades the same way", async () => {
  // Private browsing / storage disabled: `get` answers null rather than throwing, and a put
  // reports that it did not stick, so the caller knows a reload will ask for the file.
  const dead = fakeBlobStore({ fail: true });
  eq(await keepBundle("someone/minesweeper", singleTag(), dead), false, "put refused");
  eq(await restoreBundle("someone/minesweeper", { store: dead }), null, "get -> null");
});

check("persist: a quota refusal on put is reported, not thrown", async () => {
  const full = fakeBlobStore({ failPut: true });
  eq(await keepBundle("someone/minesweeper", singleTag(), full), false, "refused");
  eq(await restoreBundle("someone/minesweeper", { store: full }), null, "and nothing to restore");
});

check("persist: removing a source clears its stored payloads", async () => {
  const store = fakeBlobStore();
  await keepBundle("someone/minesweeper", singleTag(), store);
  eq(store.map.size, 1, "stored");
  await forgetBundle("someone/minesweeper", store);
  eq(store.map.size, 0, "gone");
  eq(await restoreBundle("someone/minesweeper", { store }), null, "and it does not come back");
});

check("persist: the real IndexedDB backend degrades in an environment without one", async () => {
  // Node has no `indexedDB`. That is the same shape as a browser with storage disabled, and
  // the default backend must answer with the degraded behaviour rather than throwing into the
  // Sources list's render.
  eq(await keepBundle("someone/minesweeper", singleTag()), false, "put");
  eq(await restoreBundle("someone/minesweeper"), null, "restore");
  await forgetBundle("someone/minesweeper"); // must not throw
});

// --- 12c. The store's own persist() -> load() round-trip ---------------------------------------
//
// `store.svelte.ts` is a runes file, so it is compiled here with `$state` defined away to the
// identity function: the rune's reactivity is Svelte's business and is not what this asserts.
// What it asserts is the persistence contract — that a card survives a write and a read, that
// a card written by an OLDER build (which carried `artifactCount`, since removed) still loads
// instead of choking on the extra key, and that a bundle row whose bytes cannot be recovered
// lands in the degraded state rather than claiming to be installable.

globalThis.localStorage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
})();

const SEED_SYSTEMS = [{ id: "ws", longName: "WonderSwan", shortName: "WS", extensions: [".ws"] }];
const seedCard = (over = {}) => ({
  title: "Minesweeper",
  kind: "homebrew",
  tag: "v0.1.3",
  publishedAt: "2026-01-02T00:00:00Z",
  prerelease: false,
  needsUserFiles: false,
  abiVersion: 1,
  systems: [],
  extensions: [],
  releasesUrl: "",
  ...over,
});

localStorage.setItem(
  "gnw:sources.v1",
  JSON.stringify([
    {
      repo: "a/emu",
      active: true,
      origin: "url",
      card: seedCard({ kind: "emulator", systems: SEED_SYSTEMS, extensions: [".ws"] }),
    },
    // Exactly what a build before this change wrote: the same card plus `artifactCount`.
    { repo: "a/old", active: false, origin: "url", card: { ...seedCard(), artifactCount: 3 } },
    { repo: "a/bundle", active: true, origin: "bundle", card: seedCard() },
  ]),
);

await esbuild.build({
  entryPoints: [join(here, "../store.svelte.ts")],
  outfile: join(out, "sourcesStore.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["jszip", "module"],
  // The runes, defined away: `$state(x)` becomes `x` and the store's assignments are plain.
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
});
const { sources: sourcesStore } = await load("sourcesStore.js");

sourcesStore.load();
/**
 * The bundle row's status AT THE INSTANT `load()` returned, captured here rather than read
 * inside the check below. The property under test is "a bundle row says `loading` straight
 * away, it does not sit at `idle` telling the user to re-import while the restore is still
 * running" — that is a statement about this exact moment, and the very next check proves the
 * same row has moved on to `idle` once the restore settles. Reading it later would be reading
 * the other check's subject. (It used to work by accident: checks were invoked at registration,
 * so this one ran synchronously on the line after `load()`.)
 */
const bundleStatusAtLoad = sourcesStore.get("a/bundle").status;
/** Resolves once the background bundle restore kicked off by `load()` has settled. */
const settled = new Promise((r) => setTimeout(r, 20));

check("store: load() reads persisted cards, extra legacy keys and all", () => {
  eq(sourcesStore.rows.length, 3, "every persisted row");

  const emu = sourcesStore.get("a/emu");
  eq(emu.card.systems.length, 1, "systems[] survived the round-trip");
  eq(emu.card.systems[0].longName, "WonderSwan", "and kept its contents");
  // A url row renders from its card at once and refreshes behind that — never "idle", which
  // is the state that means "nothing to show yet".
  assert(emu.status !== "idle", "a url row with a card renders immediately");

  // A card written by an older build. The extra key is ignored, not fatal.
  const old = sourcesStore.get("a/old");
  eq(old.card.title, "Minesweeper", "an older card still loads");
  eq(old.active, false, "and keeps its flag");

  // A bundle row does not sit there telling the user to re-import while we are still proving
  // they do not have to.
  eq(bundleStatusAtLoad, "loading", "restoring in the background");
});

check("store: a bundle row whose bytes cannot be recovered degrades to re-import", async () => {
  // Node has no IndexedDB, which is the same shape as a browser with storage disabled.
  await settled;
  const row = sourcesStore.get("a/bundle");
  eq(row.status, "idle", "no store -> the UI asks for the zip again");
  eq(row.manifest, undefined, "and the row never claims to be installable");
});

check("store: persist() -> load() round-trips a card, systems[] and all", async () => {
  await settled;
  sourcesStore.setActive("a/emu", false); // any mutation; persist() is private
  const written = JSON.parse(localStorage.getItem("gnw:sources.v1"));
  const emu = written.find((r) => r.repo === "a/emu");
  eq(emu.active, false, "the change");
  eq(emu.card.systems.length, 1, "systems[] survived persist()");
  eq(emu.card.systems[0].shortName, "WS", "and its contents");
  eq(emu.card.systems[0].extensions[0], ".ws", "down to the extensions");
  // The legacy `artifactCount` rides along on a card we never re-resolved, and that is the
  // point: the parse tolerates keys it does not know rather than discarding a card over one.
  // A refresh or a re-import replaces the card wholesale and the key goes with it.
  eq(written.find((r) => r.repo === "a/old").card.title, "Minesweeper", "an old card is kept, not dropped");
});

check("store: remove() drops the row and its persisted record", async () => {
  await settled;
  sourcesStore.remove("a/bundle");
  assert(!sourcesStore.get("a/bundle"), "row gone");
  const written = JSON.parse(localStorage.getItem("gnw:sources.v1"));
  assert(!written.some((r) => r.repo === "a/bundle"), "record gone");
});

// [END — biosDir parse + bundle persistence section]

// --- Device firmware ABI table ------------------------------------------------------------

// The header the parser reads is `uint32_t version; uint32_t size;` at bank_base + 0x400 and
// NOTHING ELSE — gw_firmware_abi.h has no magic number. So the thing worth proving here is not
// that a good table parses (it trivially does) but that the plausibility checks actually refuse
// the shapes a fixed offset in a NON-ABI bank hands you: stock OFW code, erased flash, and a
// header whose words happen to be in range but whose pointer slots are not real code.
await esbuild.build({
  entryPoints: [join(here, "../../engine/firmwareAbi.ts")],
  outfile: join(out, "firmwareAbi.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["module"],
  target: "es2022",
  logLevel: "warning",
});
const { parseFirmwareAbi, abiSatisfies, FIRMWARE_ABI_OFFSET } = await load("firmwareAbi.js");

/** A bank image with an ABI table at 0x400. `ptrs` overrides the probed pointer slots. */
function abiImage({ version = 1, size = 1024, ptrs = [0x08001235, 0x08001299, 0x080012ad, 0x080012f1], fill = 0 } = {}) {
  const img = new Uint8Array(64 * 1024).fill(fill);
  const dv = new DataView(img.buffer);
  dv.setUint32(FIRMWARE_ABI_OFFSET, version, true);
  dv.setUint32(FIRMWARE_ABI_OFFSET + 4, size, true);
  ptrs.forEach((p, i) => dv.setUint32(FIRMWARE_ABI_OFFSET + 8 + i * 4, p >>> 0, true));
  return img;
}

check("abi: a well-formed table parses to version + size", () => {
  const abi = parseFirmwareAbi(abiImage({ version: 1, size: 1348 }));
  assert(abi, "parsed");
  eq(abi.version, 1, "version");
  eq(abi.size, 1348, "size");
});

check("abi: the table sits at 0x400, not at the bank base", () => {
  eq(FIRMWARE_ABI_OFFSET, 0x400, "GW_FIRMWARE_ABI_OFFSET");
});

check("abi: erased flash is unknown, not an ABI", () => {
  eq(parseFirmwareAbi(new Uint8Array(64 * 1024).fill(0xff)), null, "0xFF everywhere");
});

check("abi: a zeroed bank is unknown", () => {
  eq(parseFirmwareAbi(new Uint8Array(64 * 1024)), null, "version 0 refused");
});

check("abi: in-range header words are not enough — the pointers must be Thumb code", () => {
  // Exactly the false positive that would produce a WRONG compatibility claim on stock OFW.
  eq(parseFirmwareAbi(abiImage({ ptrs: [0x08001235, 0x08001299, 0x20001000, 0x080012f1] })), null,
     "a RAM address in a code slot");
  eq(parseFirmwareAbi(abiImage({ ptrs: [0x08001234, 0x08001299, 0x080012ad, 0x080012f1] })), null,
     "an even (non-Thumb) address");
  eq(parseFirmwareAbi(abiImage({ ptrs: [0x09001235, 0x08001299, 0x080012ad, 0x080012f1] })), null,
     "outside internal flash");
});

check("abi: an implausible size is refused", () => {
  eq(parseFirmwareAbi(abiImage({ size: 1023 })), null, "not word-aligned");
  eq(parseFirmwareAbi(abiImage({ size: 4 })), null, "smaller than its own header");
  eq(parseFirmwareAbi(abiImage({ size: 1 << 20 })), null, "absurdly large");
});

check("abi: an out-of-range VERSION is refused even when everything else is valid", () => {
  // Mutation audit: the version bound survived, because the only fixtures with a bad version
  // (the erased and zeroed banks) also had garbage POINTERS, so the pointer probe rejected
  // them first. These keep every other field well-formed so only the version bound can refuse.
  eq(parseFirmwareAbi(abiImage({ version: 0 })), null, "version 0 with valid pointers");
  eq(parseFirmwareAbi(abiImage({ version: 256 })), null, "version 256 (past the plausible ceiling)");
  eq(parseFirmwareAbi(abiImage({ version: 0xffffffff })), null, "an all-ones version word");
  // Armed: the same image with a legal version parses.
  assert(parseFirmwareAbi(abiImage({ version: 255 })), "version 255 is still plausible");
  assert(parseFirmwareAbi(abiImage({ version: 1 })), "version 1 parses");
});

check("abi: the SIZE ceiling refuses a table that would still fit the image", () => {
  // `size: 1 << 20` in the check above is refused by the "runs past the image" guard, not by
  // the ceiling — with a big enough image the ceiling is the only thing left to refuse it.
  const big = new Uint8Array(1 << 21);
  big.set(abiImage({ size: (16 << 10) + 4 }), 0);
  eq(parseFirmwareAbi(big), null, "a size past MAX_PLAUSIBLE_SIZE, inside a large image");
  const ok = new Uint8Array(1 << 21);
  ok.set(abiImage({ size: 16 << 10 }), 0);
  assert(parseFirmwareAbi(ok), "exactly the ceiling is still accepted");
});

check("abi: a table claiming to run past the end of the image is refused", () => {
  const img = abiImage({ size: 4096 }).slice(0, FIRMWARE_ABI_OFFSET + 2048);
  eq(parseFirmwareAbi(img), null, "size overruns the bank bytes we read");
});

check("abi: an image too short to hold the header is refused", () => {
  eq(parseFirmwareAbi(new Uint8Array(0x400)), null, "truncated at the offset");
});

check("abi: compatibility is append-only — newer firmware still loads older plugins", () => {
  const abi = { version: 2, size: 2048 };
  assert(abiSatisfies(abi, { version: 1, minSize: 1024 }), "older plugin on newer firmware");
  assert(abiSatisfies(abi, { version: 2, minSize: 2048 }), "exact match");
  assert(!abiSatisfies(abi, { version: 3, minSize: 0 }), "plugin wants a newer ABI version");
  assert(!abiSatisfies(abi, { version: 2, minSize: 4096 }), "plugin wants a bigger table");
  assert(abiSatisfies(abi, { version: 1, minSize: 0 }), "no size floor");
});

// [END — device firmware ABI section]

// ============================================================================================
// 12. Invariants two live UI triggers now rest on (bios.ts)  [BEGIN — self-contained]
// ============================================================================================
//
// Two prompts were built on top of this module: one fires when a ROM is selected for a system
// whose BIOS slot is unmet, and one is a safety net at install time. Both interrupt the user,
// so the cost of these invariants drifting is asymmetric and concrete — either the app nags for
// a file it will never install, or it stays silent about one the install genuinely needs.
// Nothing below duplicates sections 9/10: those cover discovery/verification and the omission
// set; these cover the exact promises the two prompts make.

const {
  collectBiosNeeds: gateCollect,
  resolveBiosStatus: gateResolve,
  outstanding: gateOutstanding,
  installsBios: gateInstalls,
} = await load("bios.js");

const gateSystem = (id, bios, extensions) => ({
  id,
  longName: id.toUpperCase(),
  shortName: id,
  extensions,
  browse: "file",
  compression: false,
  bios,
});

const gateSource = (repo, systems, title = repo) => ({
  repo,
  manifest: {
    schemaVersion: 1,
    project: "p",
    title,
    source: { repo, commit: "…", ref: "v0" },
    tools: [],
    targets: [
      {
        id: "gnw-retro-go",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind: "emulator",
        requiresAbi: { version: 2, minSize: 1 },
        artifacts: [],
        systems,
      },
    ],
  },
});

const GATE_REQ = { id: "req", filename: "req.bin", required: true, label: { en: "Required" } };
/** Strict + a published hash, so this OPTIONAL slot can be made `blocked` — the state that
 *  would leak into the prompt if `outstanding` ever widened past its two needs. */
const GATE_OPT = {
  id: "opt",
  filename: "opt.bin",
  required: false,
  strict: true,
  sha1: "0000000000000000000000000000000000000000",
  label: { en: "Optional" },
};
const GATE_COND = { id: "cond", filename: "cond.rom", requiredFor: [".fds"], label: { en: "Conditional" } };

// The install gate's whole "required only" promise is this one filter. If an optional or an
// idle conditional slot ever came back out of it, the app would stop an install — or open a
// modal mid-selection — over a file nobody's games need and no install would write.
check("bios gate: outstanding() never returns an optional or conditional-idle slot", async () => {
  const needs = gateCollect(
    [gateSource("o/emu", [gateSystem("nes", [GATE_REQ, GATE_OPT, GATE_COND], [".nes", ".fds"])])],
    [{ system: "nes", name: "mario.nes" }], // cartridges only ⇒ the conditional stays idle
  );
  eq(needs.map((n) => n.need).join(","), "required,optional,conditional-idle", "the three needs");

  // Nothing supplied: only the hard requirement is outstanding.
  const missing = await gateResolve(needs, []);
  eq(gateOutstanding(missing).map((s) => s.id).join(","), "req", "missing: required only");

  // The optional slot present but REFUSED by `strict` — `blocked` is true, and it still must
  // not surface: a file the core runs without is not worth interrupting anyone over.
  const wrong = new Uint8Array(16).fill(0xff);
  const blocked = await gateResolve(needs, [
    { where: "folder", path: "bios/nes/opt.bin", bytes: wrong, size: wrong.length },
    { where: "device", path: "bios/nes/req.bin", size: 8 },
  ]);
  eq(blocked.find((s) => s.id === "opt").blocked, true, "the optional slot really is blocked");
  eq(gateOutstanding(blocked).length, 0, "and outstanding stays empty");

  // Same treatment once the conditional BITES: then it is legitimately outstanding.
  const hit = gateCollect(
    [gateSource("o/emu", [gateSystem("nes", [GATE_REQ, GATE_OPT, GATE_COND], [".nes", ".fds"])])],
    [{ system: "nes", name: "zelda.fds" }],
  );
  const hitAll = await gateResolve(hit, [{ where: "device", path: "bios/nes/req.bin", size: 8 }]);
  eq(gateOutstanding(hitAll).map((s) => s.id).join(","), "cond", "a conditional-hit does surface");
});

// The owner's SD/Flash asymmetry, stated directly rather than through the omission set (which
// is what section 10 exercises). On a card the user drops ROMs outside this app, so an active
// source's BIOS goes on regardless; on Flash the content set is closed and the gap is scarce,
// so a slot no game asks for is dead weight. Both triggers inherit this verbatim.
check("bios gate: installsBios — SD always writes; Flash needs games and skips idle", () => {
  for (const need of ["required", "conditional-hit", "conditional-idle", "optional"])
    for (const hasGames of [true, false])
      assert(gateInstalls(need, "sd", hasGames), `sd/${need}/${hasGames} installs`);

  // The specific pair the triggers depend on: an idle conditional is skipped on Flash even
  // when the system DOES have games, because `requiredFor` is narrower than a system.
  eq(gateInstalls("conditional-idle", "flash", true), false, "flash skips conditional-idle");
  eq(gateInstalls("required", "flash", true), true, "flash writes a required slot with games");
  eq(gateInstalls("required", "flash", false), false, "flash skips a system with no games");
  eq(gateInstalls("conditional-hit", "flash", true), true, "flash writes a conditional-hit");
  eq(gateInstalls("optional", "flash", true), true, "flash writes an optional slot with games");
});

// The prompt groups rows on `repo` + `systemId`. Two sources both publishing, say, a `pce` core
// is a normal state of the fleet, and collapsing them would either hide one source's slot or
// let one source's satisfied file mark the other's as met.
check("bios gate: two sources declaring the SAME systemId stay two separate slots", async () => {
  const a = { id: "pce-bios", filename: "syscard3.pce", required: true, label: { en: "A" } };
  const b = { id: "pce-bios", filename: "syscard3.pce", required: true, label: { en: "B" } };
  const needs = gateCollect(
    [
      gateSource("one/pce", [gateSystem("pcecd", [a], [".cue"])], "Core One"),
      gateSource("two/pce", [gateSystem("pcecd", [b], [".cue"])], "Core Two"),
    ],
    [],
  );
  eq(needs.length, 2, "two slots, not one");
  eq(new Set(needs.map((n) => `${n.repo}/${n.systemId}`)).size, 2, "the group key separates them");
  eq(needs.map((n) => n.sourceTitle).join(","), "Core One,Core Two", "each keeps its own source");

  const all = await gateResolve(needs, []);
  eq(new Set(all.map((s) => s.key)).size, 2, "distinct status keys");
  eq(gateOutstanding(all).length, 2, "neither masks the other while both are unmet");
});

// `biosState`'s `outstanding` is `outstanding(installable)`, not `outstanding(all)` — the order
// matters and cannot be checked from here (it is `$derived`), so the composition is pinned in
// its pure form: on Flash the gate must never ask for a file this install has already decided
// to leave out, or the user is handed a modal that changes nothing.
check("bios gate: Flash never prompts for a slot the same install would not write", async () => {
  const games = [{ system: "nes", name: "mario.nes" }]; // NES games only — no MSX game anywhere
  const needs = gateCollect(
    [
      gateSource("o/emu", [
        gateSystem("msx", [{ id: "msx", filename: "MSX.rom", required: true, label: { en: "MSX" } }], [".rom"]),
        gateSystem("nes", [GATE_REQ], [".nes"]),
      ]),
    ],
    games,
  );
  const all = await gateResolve(needs, []);
  eq(gateOutstanding(all).length, 2, "both are unmet in the abstract");

  const has = new Set(games.map((g) => g.system));
  const flash = all.filter((s) => gateInstalls(s.need, "flash", has.has(s.systemId)));
  eq(gateOutstanding(flash).map((s) => s.id).join(","), "req", "Flash asks only for what it writes");

  const sd = all.filter((s) => gateInstalls(s.need, "sd", has.has(s.systemId)));
  eq(gateOutstanding(sd).length, 2, "SD asks for both — the card's ROMs are not ours to know");
});

// [END — BIOS UI-trigger invariants section]

// ============================================================================================
// 14. Invariants the UI leans on that nothing else pinned  [BEGIN — self-contained]
// ============================================================================================
//
// Four gaps named by the agents that wrote the code depending on them. Each is an UNGUARDED
// invariant: the code is correct today, and nothing in this file would notice if it stopped
// being. See the per-check comments for what breaks.

// --- 14a. sortForDisplay is a TOTAL order ------------------------------------------------------
//
// Section 9 already pins the RANK order (blocked first, then required-and-missing). What it
// does not pin is the tie-break, which now matters much more than it did: `sortForDisplay`
// drives the Library list's VISIBLE ROW ORDER (one row per installable slot), not just the
// pick of a single item. Two slots can differ only by `systemId` — one source declaring the
// same BIOS id under two systems, which is ordinary — and then rank AND `systemName` are equal
// and only `key` separates them. `key` is `repo/systemId/id`, so it does separate them; if it
// ever stopped being part of the sort, `Array.prototype.sort` would be free to return either
// order and rows would reshuffle whenever unrelated state re-derived the list.
check("bios: sortForDisplay is a total order for slots differing only by systemId", async () => {
  // Same repo, same slot id, same displayed system name — only `systemId` differs.
  const twin = (id) => ({ ...system(id, [COLECO], [".col"]), longName: "Twin" });
  const needs = collectBiosNeeds([emuSource("a/col", [twin("colA"), twin("colB")])], []);
  eq(needs.length, 2, "two slots, not collapsed");
  eq(new Set(needs.map((n) => n.systemName)).size, 1, "the tie-break really is exercised");

  const all = await resolveBiosStatus(needs, []);
  const forward = sortForDisplay(all).map((s) => s.key);
  const reversed = sortForDisplay([...all].reverse()).map((s) => s.key);
  eq(reversed.join("|"), forward.join("|"), "input order must not change output order");
  eq(forward.join("|"), "a/col/colA/coleco|a/col/colB/coleco", "and it is the key order");
});

// --- 14b. A conditional-idle slot is not Flash-installable, games or no games ------------------
//
// Section 13 pins `installsBios("conditional-idle", "flash", true)` because that is the
// surprising half. Both halves are now load-bearing for VISIBILITY, not just for writing: the
// Library rows' medium filter is `installsBios(...)`, so a false positive here would render a
// Flash row offering a file the same install has already decided never to write.
check("bios: installsBios refuses conditional-idle on Flash with or without games", () => {
  // `gateInstalls` is section 13's alias for the same exported `installsBios`.
  for (const hasGames of [true, false])
    eq(gateInstalls("conditional-idle", "flash", hasGames), false, `flash/idle/${hasGames}`);
  // The contrast, so this cannot pass by `installsBios` simply always being false on Flash.
  eq(gateInstalls("conditional-hit", "flash", true), true, "a conditional that BIT is written");
});

// --- 14c. The Sources row meta line names systems, never counts --------------------------------
//
// The composition rule now lives in the importable, rune-free `sources/metaLine.ts`, so these
// checks run the REAL functions `views/Sources.svelte` calls — not a re-expression of the rule.
// (They used to pin a local mirror, which had drifted: it joined with plain spaces where the
// real separator is NBSP-MIDDOT-NBSP, so a genuine change to rendered output would not have
// been caught.) The rule is the owner's: this real estate names WHAT THE SOURCE GIVES YOU and
// never a count of titles. A regression puts "12 titles" back where the system names belong.

check("sources: an emulator row's first segment is systems · extensions, with no counts", () => {
  const seg = systemsSegment({
    kind: "emulator",
    systems: [{ longName: "WonderSwan" }, { longName: "WS Color" }],
    extensions: [".ws", ".wsc"],
  });
  // Spelled with explicit \u00a0 escapes: the separator is NON-BREAKING on purpose, so the
  // divider can never be the place the line wraps. A plain-space version renders differently
  // and must not pass here.
  eq(seg, "WonderSwan, WS Color\u00a0\u00b7\u00a0.ws .wsc", "the artboard's own line");
  assert(!/\d+\s/.test(seg), "no count of anything");
  // No extensions declared: the divider is dropped rather than left dangling.
  eq(
    systemsSegment({ kind: "emulator", systems: [{ longName: "WonderSwan" }], extensions: [] }),
    "WonderSwan",
    "no trailing divider",
  );
});

check("sources: a homebrew row contributes no systems segment at all", () => {
  // Exactly `undefined`, not merely falsy: `""` would be pushed as a segment and render a
  // stray divider with nothing on either side. `eq` is ===, so "" would fail here.
  // The homebrew card carries systems and extensions ON PURPOSE. An empty-systems fixture here
  // would be vacuous: the `systems.length === 0` guard alone would satisfy it, and dropping the
  // `kind !== "emulator"` half of the guard would leave this check green.
  eq(
    systemsSegment({ kind: "homebrew", systems: [{ longName: "WonderSwan" }], extensions: [".ws"] }),
    undefined,
    "homebrew, even with systems to name",
  );
  eq(systemsSegment(undefined), undefined, "no card at all");
  // An emulator card that has not resolved its systems yet is the same shape, not an empty
  // segment.
  eq(systemsSegment({ kind: "emulator", systems: [], extensions: [".ws"] }), undefined, "unresolved emulator");
});

// --- 14c'. metaSegments drops empties and pins the ORDER ---------------------------------------
//
// The component renders `segments.join(divider)`, so an empty element is not invisible — it is
// a divider with nothing beside it. And the order is meaning: what the source gives you, then
// the note about the row, then the short facts.
check("sources: metaSegments emits no empty leading segment for a homebrew row", () => {
  const line = metaSegments(
    { kind: "homebrew", systems: [{ longName: "WonderSwan" }], extensions: [".ws"] },
    undefined,
    ["4 ROMs matched"],
  );
  eq(line.length, 1, "one segment, not a leading empty one");
  eq(line[0], "4 ROMs matched", "and it is the fact");
});

check("sources: metaSegments orders systems, then the origin note, then the facts", () => {
  const card = { kind: "emulator", systems: [{ longName: "WonderSwan" }], extensions: [".ws"] };
  const line = metaSegments(card, "note", ["fact"]);
  eq(line.length, 3, "three segments");
  eq(line[0], "WonderSwan\u00a0\u00b7\u00a0.ws", "systems first");
  eq(line[1], "note", "then the origin note");
  eq(line[2], "fact", "then the facts");
});

check("sources: a row with nothing to say yields no segments at all", () => {
  // The component renders the meta div only when this is non-empty; a one-empty-string array
  // would render an empty line.
  eq(
    metaSegments({ kind: "homebrew", systems: [{ longName: "WonderSwan" }], extensions: [".ws"] }, undefined, []).length,
    0,
    "no segments",
  );
});

// --- 14d. persist() -> load() really READS BACK systems[] --------------------------------------
//
// Above, one check reads a hand-seeded record and another inspects what `persist()` WROTE. The
// join between them — write, then read that write back through `load()` — was never closed, and
// it is the path every reload takes: the Sources list renders from the persisted card before
// any fetch returns, so a card that survives the write but not the read makes every row blank
// on reload while the network is still in flight.
check("store: a persisted card survives being read back by load(), extensions and all", async () => {
  await settled;
  sourcesStore.setActive("a/emu", true); // any mutation; persist() is private
  sourcesStore.load(); // exactly what a reload does: re-read localStorage into the store

  const emu = sourcesStore.get("a/emu");
  assert(emu, "the row came back");
  eq(emu.active, true, "the mutation round-tripped");
  eq(emu.card.kind, "emulator", "kind");
  eq(emu.card.systems.length, 1, "systems[] came back");
  eq(emu.card.systems[0].id, "ws", "and its id");
  eq(emu.card.systems[0].longName, "WonderSwan", "and its long name");
  eq(emu.card.systems[0].extensions.join(" "), ".ws", "down to the per-system extensions");
  // A card present at load time renders at once — "idle" is the state that means nothing to show.
  assert(emu.status !== "idle", "and the row still renders immediately");
});

// [END — UI-leaned-on invariants section]

// --- 15. The Worker request must survive a REAL structuredClone ---------------------------------
//
// P0, reported from the field: "Failed to execute 'postMessage' on 'Worker': #<Object> could
// not be cloned." Preparing smw or zelda3 died before the converter ever started.
//
// The cause was serialisation, not conversion. `RomManagementTab.svelte` holds the chosen title
// in `let promptFor = $state<HomebrewTitle | null>(null)`, and Svelte 5's `$state` proxies plain
// objects and arrays DEEPLY (`svelte/src/internal/client/proxy.js` — anything whose prototype is
// not `Object.prototype`/`Array.prototype`, a `Uint8Array` included, is handed back untouched).
// So `tool.limits` and `tool.outputs`, which `runConverter` used to pass into the message by
// reference, arrived as Proxy exotic objects — and StructuredSerializeInternal throws
// `DataCloneError` for anything with a `[[ProxyHandler]]` slot.
//
// The oracle is node's own `structuredClone`, which is the same algorithm `postMessage` runs.
// A "is this a proxy?" assertion would prove nothing about cloneability; this actually clones.

/** A deep proxy with Svelte's own proxyability rule, so the fixture lies about nothing. */
function statelike(value) {
  if (typeof value !== "object" || value === null) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype) return value; // Uint8Array &c.
  return new Proxy(value, {
    get: (t, k, r) => statelike(Reflect.get(t, k, r)),
  });
}

const CLONE_TOOL = statelike({
  id: "smw",
  title: { en: "Super Mario World" },
  binary: { url: "https://example.invalid/smw.wasm", bytes: 4, sha256: "00".repeat(32) },
  limits: { maxMemoryPages: 4096, maxOutputBytes: 32 * 1024 * 1024 },
  inputs: [{ id: "base", required: true, allowMultiple: false, extensions: [".sfc"], maxBytes: 1 << 22, variants: [], strict: true }],
  outputs: [{ id: "assets", filename: "smw_assets.bin", maxBytes: 32 * 1024 * 1024 }],
});

/** A Worker stand-in that serialises exactly the way the real one does. */
function cloningWorker(seen) {
  const w = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(req) {
      seen.push(structuredClone(req)); // the real algorithm, not a stand-in for it
      queueMicrotask(() =>
        w.onmessage?.({ data: { type: "done", outputs: [], warnings: [], durationMs: 1, steps: 1 } }),
      );
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

// 15a. The fixture has teeth: the proxied fields really are unclonable on their own.
check("clone: a $state-like proxy is genuinely refused by structuredClone", () => {
  let threw = false;
  try {
    structuredClone({ limits: CLONE_TOOL.limits, outputs: CLONE_TOOL.outputs });
  } catch (e) {
    threw = true;
    assert(/clone/i.test(String(e && e.message)), `a DataCloneError, got ${e}`);
  }
  assert(threw, "cloning the proxied limits/outputs must fail — otherwise 15b proves nothing");
  // ...and the bytes beside them do not, which is why they are never copied.
  structuredClone({ bytes: new Uint8Array([1, 2, 3]) });
});

// 15b. The whole production path, with the tool exactly as the Library tab holds it.
check("clone: runConverter's Worker message survives structuredClone with a proxied tool", async () => {
  const seen = [];
  const worker = cloningWorker(seen);
  const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
  const bytes = new Uint8Array(64).map((_, i) => i & 0xff);
  const res = await runConverter({
    tool: CLONE_TOOL,
    wasm,
    inputs: [{ inputId: "base", filename: "smw.sfc", bytes }],
    spawnWorker: () => worker,
  });
  eq(res.steps, 1, "the run completed rather than dying at postMessage");
  eq(seen.length, 1, "exactly one message was posted");

  // The unwrap must preserve the values, not just make them clonable.
  const req = seen[0];
  eq(req.limits.maxMemoryPages, 4096, "maxMemoryPages");
  eq(req.limits.maxOutputBytes, 32 * 1024 * 1024, "maxOutputBytes");
  eq(req.outputs.length, 1, "one output spec");
  eq(req.outputs[0].id, "assets", "output id");
  eq(req.outputs[0].filename, "smw_assets.bin", "output filename");
  eq(req.outputs[0].maxBytes, 32 * 1024 * 1024, "output maxBytes");
  eq(req.flags, 0, "flags default to 0");
  eq(req.inputs[0].inputId, "base", "input id");
  eq(req.inputs[0].filename, "smw.sfc", "input filename");
  bytesEq(req.inputs[0].bytes, bytes, "input bytes");
  bytesEq(req.wasm, wasm, "wasm bytes");
});

// 15c. The caller keeps its buffers. Transferring would have been the other way to make the
// message cheap, and it would be wrong: `prepareState` and the file prompt still hold these
// bytes after a run, and a retry re-posts the same ones.
check("clone: posting does not detach the caller's wasm or input buffers", async () => {
  const worker = cloningWorker([]);
  const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
  const bytes = new Uint8Array(64).map((_, i) => i & 0xff);
  await runConverter({
    tool: CLONE_TOOL,
    wasm,
    inputs: [{ inputId: "base", filename: "smw.sfc", bytes }],
    spawnWorker: () => worker,
  });
  eq(wasm.byteLength, 4, "wasm still readable by the caller");
  eq(bytes.byteLength, 64, "input bytes still readable by the caller");
});

// ============================================================================================
// 16. The shared prepare flow (`sources/prepareState.svelte.ts`)
// ============================================================================================
//
// `runPrepare` used to be component state on the Library tab; it is now a store-backed
// singleton so the Sources tab can drive the same flow. Four hard-won behaviours came with it
// and none of them was guarded, so they are pinned here.
//
// The module is compiled with `converter.ts` and `types.ts` in ONE splitting build, so the
// `ConverterError`/`SourceError` classes the checks construct are the very classes the
// module's `instanceof` sees — a second build would give it a private copy and every error
// would silently take the fallback branch.
//
// Only the three modules that reach OUT of the process are faked: the artifact fetch (network),
// the converter (a worker + WASM) and the locale table (a runes module full of app strings).
// Everything the checks are about — the order of the two halves, which map wins a clash, the
// error mapping, `extracting`/`supplied` bookkeeping — stays real. The fakes are runtime hooks
// on `globalThis.__prepFakes`, so each check installs its own behaviour.

const prepFake = {
  "homebrewConvert.js":
    "export async function convertHomebrewTitle(t, f) { return globalThis.__prepFakes.convert(t, f); }",
  "installArtifacts.js":
    "export async function fetchTargetArtifacts(t) { return globalThis.__prepFakes.artifacts(t); }",
  // Deliberately NOT the real strings: these checks are about which branch runs and what is
  // appended to it, not about copy. A recognisable prefix makes a wrong branch obvious.
  // `sources` carries the four `errPrepare*` groups `prepareText` maps to. They are keyed by
  // GROUP, not by code, which is the whole point of the change: a check that expects a code to
  // reach the user has to name a group here, and no group name is a code.
  "locale.svelte.js":
    "export const locale = { t: { roms: { selectGames: {" +
    " convertFailed: (c) => `CF|${c}`, convertUnrecognised: (f) => `UR|${f}` } }, sources: {" +
    " errPrepareUnreadable: 'PT|unreadable', errPrepareInput: 'PT|input'," +
    " errPrepareCollision: 'PT|collision', errPrepareInterrupted: 'PT|interrupted' } } };",
};

await esbuild.build({
  // `auditLog` is an entry point so the checks can read the LOG side of the split: the user
  // gets a mapped sentence, the log keeps the literal code. Only reading both proves it.
  entryPoints: [
    join(here, "../prepareState.svelte.ts"),
    join(here, "../converter.ts"),
    join(here, "../types.ts"),
    join(here, "../../auditLog.svelte.ts"),
  ],
  outdir: join(out, "prep"),
  // Pinned so adding an entry point outside `sources/` (auditLog) cannot silently re-root the
  // output tree and break the imports below.
  outbase: join(here, "../.."),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["module"],
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [
    // `prepareState` reaches `sources/placement.ts` -> `engine/devicePaths.ts` ->
    // `@gnw/fs-builders` now that a prepared file is keyed by WHERE it installs rather than by
    // a hardcoded `homebrew/` prefix. Keep that package external and pointed at THIS
    // checkout's `dist/`, exactly as the first build in this file does — without the plugin
    // esbuild tries to bundle the package's littlefs WASM shim and the whole suite dies with
    // `Could not resolve "module"`.
    gnwResolve(join(here, "../../../../test")),
    {
      name: "prepare-fakes",
      setup(build) {
        build.onResolve({ filter: /(homebrewConvert|installArtifacts|locale\.svelte)\.js$/ }, (a) => ({
          path: a.path.slice(a.path.lastIndexOf("/") + 1),
          namespace: "prep-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "prep-fake" }, (a) => ({
          contents: prepFake[a.path],
          loader: "js",
        }));
      },
    },
  ],
});
const { prepareState } = await import(pathToFileURL(join(out, "prep", "sources", "prepareState.svelte.js")).href);
const { ConverterError: PrepConverterError } = await import(
  pathToFileURL(join(out, "prep", "sources", "converter.js")).href
);
const { SourceError: PrepSourceError } = await import(pathToFileURL(join(out, "prep", "sources", "types.js")).href);
const { auditLog: prepAuditLog } = await import(
  pathToFileURL(join(out, "prep", "auditLog.svelte.js")).href
);

/** The `${reason}` a failure handed to `convertFailed` in the log, or undefined if it logged
 *  nothing. Reads the entry as DATA (`logEntry.ts` defers rendering), so this asserts the code
 *  that was recorded and not a rendering of it. */
function lastLoggedCode() {
  const last = prepAuditLog.entries.at(-1);
  if (!last || last.message.kind !== "keyed") return undefined;
  return last.message.params[0];
}

/**
 * A `HomebrewTitle` whose two derived flags come from `inputNeed` via the same `flags()` helper
 * section 10 uses — NOT hand-set. `needsPrompt` is a one-liner over `promptsForInput`, so a
 * fixture that simply declared the flag it wanted would prove nothing about the rule.
 */
function prepTitle({ inputs = [], artifacts = [], hasTool = inputs.length > 0, repo = "o/r" } = {}) {
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
    target: { id: "t", artifacts },
  };
}

const ART = { name: "engine.bin" };
const offer = (filename, inputId = "base") => ({ inputId, filename, bytes: new Uint8Array([9]) });
const conversion = (files = [], unrecognised = [], warnings = []) => ({
  files: new Map(files),
  unrecognised,
  warnings,
});

/**
 * `prepareState` is a singleton and `check()` starts every async body immediately, so without
 * this the checks below would interleave on one shared store. Each prepare check runs after the
 * previous one has settled, against a freshly-cleared store and a fake that refuses by default
 * (so an unexpected call is a failure, not a silent success).
 */
let prepChain = Promise.resolve();
function pcheck(name, fn) {
  check(name, () => {
    const p = prepChain.then(() => {
      prepareState.assets = new Map();
      prepareState.extracting = new Set();
      prepareState.extractingFiles = new Map();
      prepareState.supplied = new Map();
      prepareState.failures = new Map();
      prepareState.notices = new Map();
      globalThis.__prepFakes = {
        artifacts: () => {
          throw new Error("fetchTargetArtifacts called unexpectedly");
        },
        convert: () => {
          throw new Error("convertHomebrewTitle called unexpectedly");
        },
      };
      return fn();
    });
    prepChain = p.catch(() => {});
    return p;
  });
}

// 16a. THE REGRESSION. A title with no converter used to run nothing at all, so the engine
// `.bin` its publisher ships was never fetched and the title was uninstallable. The guard that
// caused it was `canConvert`-only; the module's guard must also let an artifacts-only title in.
pcheck("prepare: a self-contained title still fetches its artifacts", async () => {
  const t = prepTitle({ hasTool: false, artifacts: [ART] });
  let converted = false;
  globalThis.__prepFakes.artifacts = async () => new Map([["engine.bin", new Uint8Array([1, 2])]]);
  globalThis.__prepFakes.convert = async () => void (converted = true);

  eq(await prepareState.run(t, []), true, "the title is prepared");
  assert(prepareState.has("engine.bin"), "keyed homebrew/<filename>, the shape planFlashImage wants");
  bytesEq(prepareState.get("engine.bin"), new Uint8Array([1, 2]), "the publisher's bytes");
  eq(converted, false, "and no converter ran — there is none");
  eq(prepareState.noticesFor(t.key).length, 0, "a clean run says nothing");
  eq(prepareState.failureFor(t.key), undefined, "and nothing failed");
});

// 16b. The other side of that guard: nothing to fetch AND nothing to convert is a no-op, not an
// empty "prepared" claim. It must not clear a previous run's error either — it never ran.
pcheck("prepare: no tool and no artifacts does nothing at all", async () => {
  prepareState.notices = new Map([["o/r#t", ["previous"]]]);
  const t = prepTitle({ hasTool: false, artifacts: [] });
  eq(await prepareState.run(t, []), false, "not prepared");
  eq(prepareState.assets.size, 0, "no assets invented");
  eq(prepareState.noticesFor("o/r#t")[0], "previous", "and the state was not touched");
});

// 16c. `strict: false` means "accept it AND say it was not recognised". The prompt's gate and
// the run's own gate each report their own list; the module unions them so neither pass can
// drop a file — and so a file both passes saw is not reported twice at the user.
pcheck("prepare: unrecognised files are unioned across both gate passes, once each", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () => conversion([["out.bin", new Uint8Array([7])]], ["b.bin"]);

  eq(await prepareState.run(t, [offer("a.bin")], ["a.bin"]), true, "an accepted file still prepares");
  const msg = prepareState.noticesFor(t.key, "a.bin").join("\n");
  assert(msg.includes("UR|a.bin"), "the caller's list reaches the user");
  assert(msg.includes("UR|b.bin"), "and so does the converter's");
  eq(msg.split("UR|a.bin").length - 1, 1, "the file both passes saw is reported exactly once");
});

// 16d. Error mapping, in TWO directions that deliberately diverge. The user's row gets one of
// four sentences chosen by what they can DO about the failure (`prepareText`), with no code and
// no untrusted `detail` in it; the activity log gets the literal code and, when present, the
// detail in parentheses. A raw `ConverterErrorCode` in front of the user is the bug this
// replaced ("Couldn't prepare: malformed"), so every check here asserts both ends.
// All three must RESOLVE — the Library calls this as `void`, so a rejection here is unhandled.
pcheck("prepare: a SourceError reads as a sentence, and logs the code plus the detail", async () => {
  const t = prepTitle({ hasTool: false, artifacts: [ART] });
  globalThis.__prepFakes.artifacts = async () => {
    throw new PrepSourceError("malformed", "x");
  };
  eq(await prepareState.run(t, []), false, "not prepared");
  eq(prepareState.failureFor(t.key), "PT|unreadable", "the user reads the group, not the code");
  eq(lastLoggedCode(), "malformed (x)", "the log keeps code + detail");
  eq(prepareState.assets.size, 0, "a failed fetch leaves nothing half-installed");
});

pcheck("prepare: a ConverterError with no detail logs no empty parenthetical", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () => {
    throw new PrepConverterError("unsupported-processor");
  };
  eq(await prepareState.run(t, [offer("a.bin")]), false, "not prepared");
  eq(prepareState.failureFor(t.key, "a.bin"), "PT|unreadable", "the publisher's binary, not the user's file");
  eq(lastLoggedCode(), "unsupported-processor", "no empty ( ) tacked on in the log");
});

pcheck("prepare: an unexpected Error still reads as a sentence, and logs its message", async () => {
  const t = prepTitle({ hasTool: false, artifacts: [ART] });
  globalThis.__prepFakes.artifacts = async () => {
    throw new Error("boom");
  };
  eq(await prepareState.run(t, []), false, "not prepared");
  // An unexpected throw carries no code at all, so `prepareText` is handed `undefined` and its
  // `default` arm answers "the run did not finish" — the only honest thing to say. The thrower's
  // own words are untrusted and stay in the log.
  eq(prepareState.failureFor(t.key), "PT|interrupted", "no code, so: it did not finish");
  eq(lastLoggedCode(), "boom", "the raw message, in the log");
});

// 16e. Order matters and is not cosmetic: artifacts are applied FIRST so the title's own
// converter output overrides a shipped file of the same name, exactly as `planFlashImage()`
// lets a source's `.bin` override the bundled one. Reversing the two would silently install
// the publisher's placeholder over the user's converted ROM.
pcheck("prepare: artifacts land first and the converter wins a filename clash", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [ART] });
  globalThis.__prepFakes.artifacts = async () =>
    new Map([["engine.bin", new Uint8Array([1])], ["shared.bin", new Uint8Array([1])]]);
  globalThis.__prepFakes.convert = async () =>
    conversion([["shared.bin", new Uint8Array([2])], ["rom.bin", new Uint8Array([3])]]);

  eq(await prepareState.run(t, [offer("a.bin")]), true, "prepared");
  eq(prepareState.assets.size, 3, "both halves landed");
  bytesEq(prepareState.get("engine.bin"), new Uint8Array([1]), "an artifact-only file survives");
  bytesEq(prepareState.get("rom.bin"), new Uint8Array([3]), "a converter-only file survives");
  bytesEq(prepareState.get("shared.bin"), new Uint8Array([2]), "the converter wins the clash");
});

// 16f. `extracting` drives a per-row spinner. A key left behind after a throw is a row that
// spins forever, which is why the delete is in a `finally`.
pcheck("prepare: `extracting` holds the key during the run and is empty after it", async () => {
  const t = prepTitle({ hasTool: false, artifacts: [ART] });
  let during = null;
  globalThis.__prepFakes.artifacts = async () => {
    during = prepareState.isExtracting(t.key);
    return new Map([["engine.bin", new Uint8Array([1])]]);
  };
  await prepareState.run(t, []);
  eq(during, true, "the row spins while the work is in flight");
  eq(prepareState.extracting.size, 0, "and stops afterwards");

  globalThis.__prepFakes.artifacts = async () => {
    throw new Error("boom");
  };
  await prepareState.run(t, []);
  eq(prepareState.extracting.size, 0, "a failure clears it too — no forever-spinner");
});

// 16g. The Sources tab's "Additional files" row renders off `supplied`: it claims the gate
// ACCEPTED a file for that input id. Recording it before the run succeeded would make the row
// claim a file was taken when the prepare in fact blew up.
pcheck("prepare: `supplied` records the gate's verdict only on a run that succeeded", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [], repo: "o/r" });
  eq(prepareState.hasSupplied("o/r", "base"), false, "nothing supplied yet");

  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () => conversion([["rom.bin", new Uint8Array([1])]]);
  eq(await prepareState.run(t, [offer("a.bin")]), true, "prepared");
  eq(prepareState.hasSupplied("o/r", "base"), true, "keyed <repo>#<inputId>");
  eq(prepareState.hasSupplied("other/x", "base"), false, "and namespaced by repo");

  prepareState.supplied = new Map();
  globalThis.__prepFakes.convert = async () => {
    throw new PrepConverterError("worker-failed");
  };
  eq(await prepareState.run(t, [offer("a.bin")]), false, "the run blew up");
  eq(prepareState.hasSupplied("o/r", "base"), false, "so the row must not claim the file was accepted");
});

// 16h. `needsPrompt` is `promptsForInput`, NOT `!selfContained`. An all-optional tool runs
// without a file and is therefore self-contained, yet the prompt is the only place those files
// can be offered — skipping it is the bug that actually shipped. The flags here are computed by
// `flags()`/`inputNeed`, so this is the real rule, not a restated fixture.
pcheck("prepare: needsPrompt mirrors promptsForInput, including the optional-only case", () => {
  eq(prepareState.needsPrompt(prepTitle({ hasTool: false })), false, "no tool asks nothing");
  eq(prepareState.needsPrompt(prepTitle({ inputs: [inputSpec("a", true)] })), true, "a required input prompts");
  const optional = prepTitle({ inputs: [inputSpec("a", false)] });
  eq(optional.selfContained, true, "all-optional really is self-contained");
  eq(prepareState.needsPrompt(optional), true, "and must STILL prompt — !selfContained would not");
});

// ============================================================================================
// 16. The Sources row FACT-PRECEDENCE rule (metaFacts.ts)  [BEGIN — self-contained]
// ============================================================================================
//
// Section 14c pins how a row's meta line is COMPOSED. This pins which facts go into it, which
// is a different rule and was, until `metaFacts.ts` was extracted out of `views/Sources.svelte`,
// unguardable — it lived as an inline chain inside a Svelte `$derived`, unreachable from node.
//
// The one that matters is rule 3: a build the connected device explicitly CANNOT load says so
// INSTEAD OF counting ROMs. A row reading "needs newer firmware · 4 ROMs matched" invites the
// user to install something that will not run. So the ABI note REPLACES the count branch — it
// does not merely precede it.
//
// Anti-vacuity note for whoever edits these: every fixture below deliberately carries inputs
// that WOULD produce the fact it is asserting the absence of. A rule-3 fixture with
// `romsMatched: null` would be vacuous — no count would render even with the rule deleted.
// The same trap was caught in 14c's own draft (an empty-`systems` homebrew fixture). Each
// mutation named in the per-check comments was run against a throwaway copy of the source and
// confirmed to turn the check red.

const { metaFacts } = await load("metaFacts.js");

/**
 * A NEUTRAL baseline: a resolved, compatible emulator card with nothing else to say. Note it
 * is not fact-free (no folder picked yields a zero ROM count) — that is on purpose, so a check
 * asserting "no facts at all" cannot pass by the baseline being silent anyway.
 */
const factInput = (over = {}) => ({
  loading: false,
  error: false,
  hasCard: true,
  isCore: true,
  abiCompatible: true,
  romsMatched: null,
  hasRomFolder: false,
  needsUserFiles: false,
  prerelease: false,
  ...over,
});

/** The fact kinds, in order — what the component would actually render. */
const kinds = (over) => metaFacts(factInput(over)).map((f) => f.kind);

// --- 16a. The exclusive terminators ------------------------------------------------------------
//
// `loading` and `error` each return the row's ONLY fact, and loading wins the tie. A row still
// resolving must not simultaneously claim a ROM count or a prerelease badge from stale inputs.
check("facts: loading is exclusive and beats error and every additive fact", () => {
  // Every other rule is armed: error, an ABI refusal, a real ROM count, and both additives.
  // If loading merely came first in a non-terminating chain, this would be five facts long;
  // if error won the tie it would be ["error"].
  const out = metaFacts(
    factInput({
      loading: true,
      error: true,
      abiCompatible: false,
      romsMatched: 4,
      hasRomFolder: true,
      needsUserFiles: true,
      prerelease: true,
    }),
  );
  eq(out.length, 1, "exactly one fact");
  eq(out[0].kind, "loading", "and it is loading, not error");
});

check("facts: error is exclusive too, additive facts and all", () => {
  // `needsUserFiles`/`prerelease` are ARMED here on purpose: they are appended unconditionally
  // further down the real function, so an early-return that was not really an early return
  // would show up as length 3.
  const out = metaFacts(
    factInput({ error: true, romsMatched: 4, hasRomFolder: true, needsUserFiles: true, prerelease: true }),
  );
  eq(out.length, 1, "exactly one fact");
  eq(out[0].kind, "error", "and it is error");
});

// --- 16b. No resolved card, nothing to say -----------------------------------------------------
check("facts: an unresolved card states nothing, however much is known about it", () => {
  // Three facts are armed. `hasCard: false` is the ONLY thing suppressing them, so dropping
  // that guard turns this from [] into ["roms-matched","needs-user-files","prerelease"].
  eq(
    kinds({ hasCard: false, romsMatched: 4, hasRomFolder: true, needsUserFiles: true, prerelease: true }).length,
    0,
    "no facts at all",
  );
});

// --- 16c. THE LOAD-BEARING ONE: the ABI note REPLACES the ROM count ----------------------------
//
// This is why the module exists. A source the device cannot load must not also advertise how
// many ROMs it matched, as though it were installable.
check("facts: needs-newer-firmware REPLACES the ROM count, never sits beside it", () => {
  // `romsMatched: 4` on an emulator with a picked folder is exactly the input that renders
  // "4 ROMs matched" — check 16e proves that on identical inputs. So if the ABI branch were an
  // `if` instead of an `else if`, this row would be two facts long and the token search below
  // would find `roms-matched`. Nothing here is satisfied by the fixture alone.
  const out = metaFacts(factInput({ abiCompatible: false, isCore: true, romsMatched: 4, hasRomFolder: true }));
  eq(out.length, 1, "exactly one fact");
  eq(out[0].kind, "needs-newer-firmware", "and it is the firmware note");
  assert(
    !out.some((f) => f.kind === "roms-matched"),
    "a row needing newer firmware must not also advertise a ROM count",
  );
});

// --- 16d. Unknown compatibility makes NO claim -------------------------------------------------
//
// `abiCompatible` is three-valued. Only an explicit `false` suppresses the count; `null` —
// nothing connected, or no ABI table to read — must behave exactly like `true`. Collapsing the
// tri-state to a boolean (`!abiCompatible`) would silence the count for every disconnected
// user, which is the common case.
check("facts: an unknown ABI counts ROMs exactly as a compatible one does", () => {
  const same = { isCore: true, romsMatched: 4, hasRomFolder: true };
  for (const abiCompatible of [null, true]) {
    const out = metaFacts(factInput({ ...same, abiCompatible }));
    eq(out.length, 1, `one fact for abiCompatible=${abiCompatible}`);
    eq(out[0].kind, "roms-matched", `a count for abiCompatible=${abiCompatible}`);
    eq(out[0].count, 4, `the real count for abiCompatible=${abiCompatible}`);
  }
  // The contrast, so this cannot pass by the count simply always rendering.
  eq(kinds({ ...same, abiCompatible: false })[0], "needs-newer-firmware", "and false still suppresses it");
});

// --- 16e. The ROM-count table, all five rows ---------------------------------------------------
//
// `null` is "not scanned", and it means two different things depending on whether a folder was
// ever picked: with no folder the row asks for one, with a folder it reports an empty result.
// 0 and null-with-a-folder deliberately collapse to the same fact; 1 is its own token because
// "1 ROMs matched" is not a sentence.
check("facts: the ROM-count table maps every row to its own fact", () => {
  const base = { isCore: true, abiCompatible: true };
  eq(kinds({ ...base, romsMatched: null, hasRomFolder: false })[0], "no-roms", "null, no folder reports zero");
  eq(kinds({ ...base, romsMatched: null, hasRomFolder: true })[0], "no-roms", "null, folder picked");
  eq(kinds({ ...base, romsMatched: 0, hasRomFolder: true })[0], "no-roms", "zero matches");
  eq(kinds({ ...base, romsMatched: 1, hasRomFolder: true })[0], "one-rom-matched", "exactly one");
  const many = metaFacts(factInput({ ...base, romsMatched: 7, hasRomFolder: true }));
  eq(many[0].kind, "roms-matched", "more than one");
  // The count travels WITH the token — a plural fact that dropped its payload would still
  // match the kind check above and render "ROMs matched" with no number.
  eq(many[0].count, 7, "and it carries the real count");
});

// --- 16f. Only emulators count ROMs, but additives still reach a homebrew row ------------------
check("facts: a non-emulator card skips the count branch yet still states its additives", () => {
  // `romsMatched: 4` + a picked folder are armed: dropping the `isCore` guard would append
  // `roms-matched` and make this two facts long. A homebrew row has no ROM folder semantics.
  const out = metaFacts(
    factInput({ isCore: false, abiCompatible: true, romsMatched: 4, hasRomFolder: true, needsUserFiles: true }),
  );
  eq(out.length, 1, "exactly one fact");
  eq(out[0].kind, "needs-user-files", "and it is the additive, reached with nothing before it");
});

// --- 16g. The additives are ADDITIVE, and in that order -----------------------------------------
//
// They append to whatever rule 3 chose rather than replacing it — including to the firmware
// note. And the order is fixed: what you must do about the device, then what you must supply,
// then the maturity caveat.
check("facts: needs-user-files and prerelease append after the firmware note, in that order", () => {
  eq(
    kinds({ abiCompatible: false, needsUserFiles: true, prerelease: true, romsMatched: 4, hasRomFolder: true }).join(
      "|",
    ),
    "needs-newer-firmware|needs-user-files|prerelease",
    "all three, in order",
  );
  // Each additive is independently optional — so the order check above cannot be passing
  // because the two are emitted as one inseparable pair.
  eq(kinds({ abiCompatible: false, needsUserFiles: true }).join("|"), "needs-newer-firmware|needs-user-files");
  eq(kinds({ abiCompatible: false, prerelease: true }).join("|"), "needs-newer-firmware|prerelease");
});


// ============================================================================================
// 17. The "Additional files" ROW-COMPOSITION rule (fileRows.ts)  [BEGIN — self-contained]
// ============================================================================================
//
// What a source's Additional-files section says about each file the source cannot ship. Until
// `fileRows.ts` was extracted out of `ui/AdditionalFiles.svelte`, this was an inline chain in a
// Svelte `$derived` and unreachable from node.
//
// The three states are three DIFFERENT claims to the user:
//   add   — "supply this file"
//   found — "a file is there"; nothing is claimed about its bytes
//   ok    — "the published hash matched"
// Confusing them nags for a file already present, or advertises a verification never done. The
// converter half can only ever reach two of them: a manifest publishes no hash for a tool
// input, so `ok` is unsayable there.
//
// Anti-vacuity note for whoever edits these: every negative assertion below is armed with the
// input that would produce the thing it denies — the never-`ok` fixture is `supplied`, i.e.
// exactly the case that would go `ok` if the two-state rule were dropped; the medium-policy
// fixture's dropped slot is in `sorted` AND matches the repo, so only the intersection
// excludes it. Each mutation named in the per-check comments was run against a throwaway copy
// of `fileRows.ts` and confirmed to turn the named check red.

const { biosRowState, converterRowState, biosRequired, selectBiosNeeds, dedupeInputsById } =
  await load("fileRows.js");

/** A BIOS slot as the rule sees it: present, unblocked, hash matched. */
const slot = (over = {}) => ({ present: true, blocked: false, verified: "ok", ...over });

// --- 17a. The BIOS three-state table, every row -------------------------------------------------
//
// All five reachable combinations, so no row can be right by accident. `verified: "ok"` is
// carried on the absent and blocked rows on purpose: they are the arming for 17b.
check("files: the BIOS state table maps every case to its own claim", () => {
  eq(biosRowState(slot()), "ok", "present, unblocked, hash matched");
  eq(biosRowState(slot({ verified: "unchecked" })), "found", "present, nothing to check against");
  eq(biosRowState(slot({ verified: "mismatch" })), "found", "present, tolerated non-strict mismatch");
  eq(biosRowState(slot({ present: false })), "add", "nothing on disk");
  eq(biosRowState(slot({ blocked: true })), "add", "on disk but the strict hash refused it");
});

// --- 17b. `blocked` really is checked, and it outranks a matching hash ---------------------------
//
// A blocked file IS present, so the `!present` half of the guard does not cover it. Deleting
// `|| b.blocked` leaves this fixture "ok" — it carries `verified: "ok"` precisely so the
// weaker mutation (blocked falling through to `found`) fails here too.
check("files: a blocked file asks for a replacement rather than claiming the hash it has", () => {
  eq(biosRowState({ present: true, blocked: true, verified: "ok" }), "add", "blocked wins over verified");
  // And the guard is not simply ignoring `verified`: the same slot unblocked does claim it.
  eq(biosRowState({ present: true, blocked: false, verified: "ok" }), "ok", "control");
});

// --- 17c. add and found are not interchangeable -------------------------------------------------
//
// Swapping the two return values in either function is caught here: each direction is asserted
// with a fixture that would take the other branch.
check("files: add and found are distinct claims in both halves of the section", () => {
  eq(biosRowState(slot({ present: false })), "add", "bios: missing is not 'found'");
  eq(biosRowState(slot({ verified: "unchecked" })), "found", "bios: present is not 'add'");
  eq(converterRowState(false), "add", "converter: nothing supplied is not 'found'");
  eq(converterRowState(true), "found", "converter: a supplied file is not 'add'");
});

// --- 17d. A converter input is NEVER "ok" -------------------------------------------------------
//
// The arming that matters: `supplied: true` is the ONLY input the converter rule has, and it is
// exactly the case a hash-aware rule would call `ok`. If `converterRowState` ever returned "ok"
// for it — the mutation — this dies. Asserted over the whole input domain, not one value, so
// no hidden third argument can smuggle a hash claim in.
check("files: no converter input can ever claim a hash matched", () => {
  for (const supplied of [true, false]) {
    const state = converterRowState(supplied);
    assert(state !== "ok", `converter input with supplied=${supplied} claimed a verified hash`);
    assert(state === "found" || state === "add", `unexpected converter state ${state}`);
  }
  // Proof the domain above is not vacuous: the BIOS rule, handed the analogous "it is there
  // and it checked out" slot, DOES say ok. So "never ok" is a property of this rule, not of
  // the assertion being unreachable.
  eq(biosRowState(slot()), "ok", "the BIOS half can say ok, so the denial above has teeth");
});

// --- 17e. Which slots are needed: installable ∩ sorted, this repo, sorted's order ----------------
//
// The medium policy lives in `biosState.installable` and is NOT restated by the rule. So the
// dropped slot below is deliberately in `sorted` and deliberately matches the repo: only the
// intersection excludes it. Deleting `keep.has(b)` admits it; deleting the repo test admits
// the other source's slot.
check("files: BIOS rows are the installable set, this source only, in display order", () => {
  const a = { key: "a", repo: "me/emu" };
  const b = { key: "b", repo: "me/emu" }; // in sorted, right repo, NOT installable
  const c = { key: "c", repo: "me/emu" };
  const other = { key: "x", repo: "someone/else" }; // installable, but another source's
  const sorted = [c, b, a, other];
  const rows = selectBiosNeeds(sorted, [a, c, other], "me/emu");
  eq(rows.map((r) => r.key).join(","), "c,a", "order is sorted's, membership is installable's");
  // No repo selected ⇒ nothing, even though the installable set is non-empty.
  eq(selectBiosNeeds(sorted, [a, c], undefined).length, 0, "no source, no rows");
});

// --- 17f. Membership is by identity, not by key -------------------------------------------------
//
// Both arrays are views of the same objects. A key-based `.has()` would re-admit a slot the
// medium policy dropped whenever two distinct objects share a key — which is exactly what a
// refresh mid-render produces.
check("files: a dropped slot is not re-admitted by an equal-keyed twin", () => {
  const kept = { key: "a", repo: "me/emu" };
  const dropped = { key: "a", repo: "me/emu" }; // same key, different object, not installable
  eq(selectBiosNeeds([dropped], [kept], "me/emu").length, 0, "a twin of an installable slot is still dropped");
  eq(selectBiosNeeds([kept], [kept], "me/emu").length, 1, "control: the real object is kept");
});

// --- 17g. Converter inputs are deduplicated by id, first occurrence winning ----------------------
//
// Two tools of one source routinely declare the same base ROM. Listing it twice asks the user
// for one file two times. Dropping the `seen` guard yields four rows here; keeping the LAST
// occurrence instead of the first swaps the label the row shows.
check("files: converter inputs are deduplicated across tools, first occurrence winning", () => {
  const rows = dedupeInputsById([
    [
      { id: "base", label: "first" },
      { id: "patch", label: "p" },
    ],
    [
      { id: "base", label: "second" },
      { id: "extra", label: "e" },
    ],
  ]);
  eq(rows.map((r) => r.id).join(","), "base,patch,extra", "one row per id, in declaration order");
  eq(rows[0].label, "first", "the first occurrence is the one kept");
  // Armed: the duplicate really is a duplicate the naive concatenation would emit.
  eq(rows.length, 3, "four declared inputs, three distinct ids");
});

// --- 17h. Dedup does not swallow a tool, and an empty run is empty -------------------------------
check("files: dedup preserves every distinct input and tolerates a skipped tool", () => {
  // A tool that failed to prepare contributes an absent list, not an empty section — the
  // caller drops it, so the rule must simply not see it.
  eq(dedupeInputsById([[{ id: "a" }], [{ id: "b" }]]).length, 2, "two tools, two inputs");
  eq(dedupeInputsById([]).length, 0, "no tools, no inputs");
  eq(dedupeInputsById([[], [{ id: "a" }]]).length, 1, "an empty tool list is skipped, not fatal");
});

// --- 17i. How badly a file is needed -------------------------------------------------------------
//
// Shared by both halves. `conditional-hit` is a conditional slot whose trigger extension was
// actually matched in the picked folder — it is as required as `required`. Plain `conditional`
// is not: its trigger was not hit, so demanding it would nag for a file no game needs.
check("files: required covers conditional-hit but not an untriggered conditional", () => {
  eq(biosRequired("required"), true, "required");
  eq(biosRequired("conditional-hit"), true, "a conditional whose trigger was hit");
  eq(biosRequired("conditional"), false, "a conditional that was not hit");
  eq(biosRequired("optional"), false, "optional");
});

// --- 18. errorText.ts: the source error-code -> message mapping ---------------------------------
//
// Two independent renderers (AddSource.svelte, Sources.svelte's meta line) share this so the
// two never drift. `errorMessageKind()` is the RULE (which codes share a message);
// `errorText()` is the LOOKUP against a caller-supplied strings table. Both get guarded here.
//
// Keep in sync: SourceErrorCode in ../types.ts currently has exactly these 12 members. If a
// code is added or removed there without updating this list, ALL_CODES.length below fails —
// that's the point: a new code with no message assigned must be caught, not silently absorbed
// by the `network` fallback.
const ALL_CODES = [
  "bad-url",
  "no-pages",
  "no-versions",
  "malformed",
  "unsupported-schema",
  "network",
  "artifact-size-mismatch",
  "aborted",
  "bundle-invalid",
  "bundle-missing-file",
  "bundle-conflict",
  "raw-core-invalid",
  // `undefined` is also a legal input (a SourceError-less row) — included via UNDEF below.
];
const IDENTITY_CODES = [
  "bad-url",
  "no-pages",
  "no-versions",
  "malformed",
  "unsupported-schema",
  "bundle-invalid",
  "bundle-missing-file",
  "bundle-conflict",
];
const KIND_SET = new Set([
  "bad-url",
  "no-pages",
  "no-versions",
  "malformed",
  "unsupported-schema",
  "bundle-invalid",
  "bundle-missing-file",
  "bundle-conflict",
  "network",
]);

check("errorText: types.ts still declares exactly 12 SourceErrorCode members", () => {
  eq(ALL_CODES.length, 12, "ALL_CODES must be kept in sync with SourceErrorCode in ../types.ts");
});

// 18a. Identity arm: each of these codes must map to ITSELF as a kind. This is what stops
// someone quietly re-pointing one of these codes at another code's copy — armed by mutation
// test 1 below (re-point one identity code at "network").
check("errorText: each identity code maps to its own kind", () => {
  for (const code of IDENTITY_CODES) {
    eq(errorMessageKind(code), code, `${code} must map to itself`);
  }
});

// 18b. The deliberate collapses. `aborted` and `undefined` matter most: neither has its own
// `case` in errorMessageKind's switch, they only fall into `default`. A future `case` added
// above `default` (e.g. for a hypothetical new code) could silently steal one of them if this
// isn't pinned — armed by mutation test 2 (give `aborted` its own arm returning something else).
check("errorText: the deliberate collapses", () => {
  eq(errorMessageKind("artifact-size-mismatch"), "malformed", "size mismatch reads as malformed");
  eq(errorMessageKind("network"), "network", "network stays network");
  eq(errorMessageKind("aborted"), "network", "aborted falls through the default arm to network");
  eq(errorMessageKind(undefined), "network", "an undefined code falls through the default arm to network");
});

// 18c. Totality: every code maps to a real ErrorMessageKind member, and errorText never
// returns undefined/empty for any of them (a strings table where every value is a truthy,
// recognisable marker makes a wrong or missing branch visible instead of silently absorbed).
check("errorText: every code maps to a known kind and produces non-empty text", () => {
  const markerTable = {
    errBadUrl: "M:bad-url",
    errNoPages: "M:no-pages",
    errNoVersions: "M:no-versions",
    errMalformed: "M:malformed",
    errUnsupportedSchema: (v) => `M:unsupported-schema:${v}`,
    errBundleInvalid: "M:bundle-invalid",
    errBundleMissingFile: "M:bundle-missing-file",
    errBundleConflict: "M:bundle-conflict",
    errNetwork: "M:network",
  };
  for (const code of [...ALL_CODES, undefined]) {
    const kind = errorMessageKind(code);
    assert(KIND_SET.has(kind), `${String(code)} produced an unknown kind ${String(kind)}`);
    const text = errorText(markerTable, code, "1.9");
    assert(typeof text === "string" && text.length > 0, `${String(code)} produced empty/undefined text`);
  }
});

// 18d. `detail` fallback and scoping. Armed by mutation test 3 (make `detail` interpolate for
// a code that should ignore it) — using an IDENTITY strings function for unsupported-schema
// means the returned value directly reveals whether errorText's own `detail ?? "?"` fallback
// ran, rather than a table-side default masking it.
check("errorText: detail falls back to '?' for unsupported-schema, and is ignored elsewhere", () => {
  const t = {
    errBadUrl: "M:bad-url",
    errNoPages: "M:no-pages",
    errNoVersions: "M:no-versions",
    errMalformed: "M:malformed",
    errUnsupportedSchema: (v) => v, // identity: the return value IS whatever detail arrived
    errBundleInvalid: "M:bundle-invalid",
    errBundleMissingFile: "M:bundle-missing-file",
    errBundleConflict: "M:bundle-conflict",
    errNetwork: "M:network",
  };
  eq(errorText(t, "unsupported-schema", undefined), "?", "no detail falls back to '?'");
  eq(errorText(t, "unsupported-schema", "1.9"), "1.9", "a real detail passes through");

  // Armed: for every OTHER code, calling with two different detail strings must give the
  // SAME text — if any of these codes started interpolating detail, this diverges.
  const others = ALL_CODES.filter((c) => c !== "unsupported-schema");
  for (const code of others) {
    const withA = errorText(t, code, "detail-a");
    const withB = errorText(t, code, "detail-b-totally-different");
    eq(withA, withB, `${code} must ignore detail`);
  }
});

// 18e. One string per kind: an identity-proxy table (each field returns its own field-name
// marker) driven across every code must collapse to exactly the 9 ErrorMessageKind values —
// no more, no fewer. Armed by mutation test 1/2 together: a broken collapse would produce a
// 10th distinct string, or a lost one would produce only 8.
check("errorText: exactly 9 distinct messages across all codes", () => {
  const t = {
    errBadUrl: "errBadUrl",
    errNoPages: "errNoPages",
    errNoVersions: "errNoVersions",
    errMalformed: "errMalformed",
    errUnsupportedSchema: () => "errUnsupportedSchema",
    errBundleInvalid: "errBundleInvalid",
    errBundleMissingFile: "errBundleMissingFile",
    errBundleConflict: "errBundleConflict",
    errNetwork: "errNetwork",
  };
  const distinct = new Set([...ALL_CODES, undefined].map((c) => errorText(t, c, undefined)));
  eq(distinct.size, 9, `expected 9 distinct messages, got ${[...distinct].sort().join(",")}`);
});


// ============================================================================================
// 19. The Library review-and-install summary's row composition (sources/summaryRows.ts)
// ============================================================================================
//
// This decides which rows the drawer shows before a DESTRUCTIVE write, and in what order.
// The rules, in the owner's terms: the LibrarySummary artboard's order, Emulators
// unconditional ("Emulators are not a given anymore — Flash and SD use cases are now the same
// essentially"), BIOS only when a source declares one, Total last, and Flash and SD never
// diverging.
//
// Anti-vacuity note: NOTHING below is asserted against a fixture that carries its own
// precondition. The row payloads are bare marker strings equal to their key name, so the
// composed output is directly readable as an order; every "absent" assertion is armed by
// first showing the same input with one field flipped DOES produce the row.

/** Marker rows: each row's payload is its own key, so output === expected key order. */
const MARKERS = {
  games: "games",
  homebrew: "homebrew",
  cores: "cores",
  bios: "bios",
  covers: "covers",
  cheats: "cheats",
  total: "total",
};

const FULL_ORDER = ["games", "homebrew", "cores", "bios", "covers", "cheats", "total"];
const NO_BIOS_ORDER = ["games", "homebrew", "cores", "covers", "cheats", "total"];

/** Every media x syncCores combination the component can be in. */
const FLAG_MATRIX = [];
for (const media of ["flash", "sd"]) {
  for (const syncCores of [false, true]) {
    for (const hasBios of [false, true]) FLAG_MATRIX.push({ media, syncCores, hasBios });
  }
}

// 19a. The artboard's order is the exported constant, spelled out here independently. If the
// module's array is reordered, this fails without anyone having to notice the reorder.
check("summary: SUMMARY_ROW_ORDER is the artboard order", () => {
  eq(SUMMARY_ROW_ORDER.join(","), FULL_ORDER.join(","), "row order");
});

// 19b. The composed rows, in both branches, are exactly that order. Driven over the whole
// flag matrix so a branch on media or syncCores anywhere in the module shows up here.
check("summary: composed order matches the artboard in every flag combination", () => {
  for (const flags of FLAG_MATRIX) {
    const want = flags.hasBios ? FULL_ORDER : NO_BIOS_ORDER;
    const got = composeSummaryRows(flags, MARKERS);
    eq(got.join(","), want.join(","), `order for ${JSON.stringify(flags)}`);
    eq(summaryRowKeys(flags).join(","), want.join(","), `keys for ${JSON.stringify(flags)}`);
  }
});

// 19c. Flash and SD AGREE. Compared pairwise rather than each against a literal, so a change
// that moved a row in both branches at once still fails 19a/19b, and a change that moved it in
// only one fails here.
check("summary: Flash and SD compose identical row orders", () => {
  for (const syncCores of [false, true]) {
    for (const hasBios of [false, true]) {
      const flash = composeSummaryRows({ media: "flash", syncCores, hasBios }, MARKERS);
      const sd = composeSummaryRows({ media: "sd", syncCores, hasBios }, MARKERS);
      eq(flash.join(","), sd.join(","), `flash vs sd (syncCores=${syncCores}, hasBios=${hasBios})`);
    }
  }
});

// 19d. Emulators is UNCONDITIONAL — present in both branches with syncCores off as well as on.
// Armed the only way it can be: syncCores=false is precisely the input under which a
// reintroduced "only when the cores checkbox is on" gate would drop the row, and it is
// exercised on both media.
check("summary: Emulators is present in both branches regardless of syncCores", () => {
  for (const flags of FLAG_MATRIX) {
    const got = composeSummaryRows(flags, MARKERS);
    assert(got.includes("cores"), `emulators missing for ${JSON.stringify(flags)}`);
  }
  // And it sits third, above BIOS — not appended wherever a conditional would have put it.
  for (const media of ["flash", "sd"]) {
    eq(composeSummaryRows({ media, syncCores: false, hasBios: true }, MARKERS)[2], "cores", "position");
  }
});

// 19e. Total is LAST, and last is not an accident of it being the final literal: checked over
// the whole matrix, including the shorter no-BIOS list where "last" is a different index.
check("summary: Total projected size is always the last row", () => {
  for (const flags of FLAG_MATRIX) {
    const got = composeSummaryRows(flags, MARKERS);
    eq(got[got.length - 1], "total", `last row for ${JSON.stringify(flags)}`);
    eq(got.indexOf("total"), got.length - 1, "total appears once, at the end");
  }
});

// 19f. BIOS appears ONLY when there is something to say. Armed: the SAME flags with hasBios
// flipped to true DO produce the row, so the absent-case assertion is not vacuous.
check("summary: the BIOS row appears only when a source declares a BIOS", () => {
  for (const media of ["flash", "sd"]) {
    for (const syncCores of [false, true]) {
      const without = composeSummaryRows({ media, syncCores, hasBios: false }, MARKERS);
      const with_ = composeSummaryRows({ media, syncCores, hasBios: true }, MARKERS);
      assert(!without.includes("bios"), `bios present with hasBios=false (${media})`);
      assert(with_.includes("bios"), `bios ABSENT with hasBios=true (${media}) — negative check unarmed`);
      eq(with_.length, without.length + 1, "exactly one row differs");
      eq(with_.indexOf("bios"), 3, "bios sits between Emulators and Cover art");
    }
  }
});

// 19g. A row the caller did not supply is dropped, not emitted as a hole — the summary must
// never render an empty line. Armed by the same set WITH the row supplied.
check("summary: an unsupplied bios row is dropped even when hasBios claims otherwise", () => {
  const flags = { media: "flash", syncCores: true, hasBios: true };
  const withoutRow = composeSummaryRows(flags, { ...MARKERS, bios: undefined });
  eq(withoutRow.join(","), NO_BIOS_ORDER.join(","), "hole dropped");
  eq(composeSummaryRows(flags, MARKERS).join(","), FULL_ORDER.join(","), "and present when supplied");
});

// 19h. The BIOS row's existence rule, at its own level: `any` is the ONLY thing that decides
// it. Armed with a state that has real satisfied/outstanding/pendingWrites numbers — if
// existence were (wrongly) derived from any of those counts instead, this input would still
// produce a row and the check would fail.
check("summary: biosSummaryDecision is undefined only when no source declares a BIOS", () => {
  eq(
    biosSummaryDecision({ any: false, satisfied: 3, outstanding: 2, pendingWrites: 5 }),
    undefined,
    "no declared slot => no row, despite non-zero counts",
  );
  assert(
    biosSummaryDecision({ any: true, satisfied: 0, outstanding: 0, pendingWrites: 0 }) !== undefined,
    "declared slot with all-zero counts must still produce a row",
  );
});

// 19i. The BIOS row carries the RIGHT delta. The three counts are deliberately all distinct
// and none is zero, so picking `satisfied` or `outstanding` by mistake yields a different
// number and this fails. `removed` is fixed at 0 — a BIOS install never deletes.
check("summary: the BIOS delta is pendingWrites, not satisfied and not outstanding", () => {
  const d = biosSummaryDecision({ any: true, satisfied: 7, outstanding: 3, pendingWrites: 2 });
  eq(d.added, 2, "delta is pendingWrites");
  assert(d.added !== 7 && d.added !== 3, "delta must not be satisfied or outstanding");
  eq(d.removed, 0, "nothing is ever removed");
  eq(d.satisfied, 7, "the stated count is satisfied");
});

// 19j. `short` (the warn tone + "needs a file" note) tracks outstanding, and nothing else.
// Armed both ways, and with pendingWrites held at a value that would flip it if the rule
// wrongly read that field instead.
check("summary: the BIOS row warns exactly when a slot is outstanding", () => {
  eq(biosSummaryDecision({ any: true, satisfied: 2, outstanding: 0, pendingWrites: 2 }).short, false, "nothing outstanding");
  eq(biosSummaryDecision({ any: true, satisfied: 2, outstanding: 1, pendingWrites: 0 }).short, true, "one outstanding");
});

// ============================================================================================
// 20. Two inputs sharing one extension  (the zelda3 "add a language" P0)
// ============================================================================================
//
// zelda3's tool declares `base` (required, one US ROM) and `language` (optional, allowMultiple,
// eleven translated ROMs) and BOTH take `.sfc`/`.smc`. `convertHomebrewTitle` used to throw the
// user's stated slot away and re-derive an input id from the file extension, taking the FIRST
// input whose `extensions[]` matched — so every translated ROM was assigned to `base`, hashed
// against `base`'s single US variant, matched nothing, and was refused under `base`'s `strict`:
//
//     Error: Couldn't prepare: input-unrecognised (Legend of Zelda, The - A Link to the Past
//     (France).sfc)
//
// The rule these pin: a file supplied FOR an input is gated against THAT input. Nothing
// downstream of the prompt may re-derive a role the user already stated.

const zBase = new Uint8Array([1, 1, 1, 1]); // stands in for the US cartridge dump
const zFr = new Uint8Array([2, 2, 2, 2]); // stands in for the French translation
const zJunk = new Uint8Array([3, 3, 3, 3]); // a file belonging to neither

/** The real manifest's shape, narrowed: two inputs, same extensions, disjoint variant tables. */
async function zeldaSpecs() {
  return [
    {
      id: "base",
      required: true,
      allowMultiple: false,
      extensions: [".sfc", ".smc"],
      maxBytes: 8388608,
      variants: [{ id: "us", sha1: await sha1Hex(zBase) }],
      strict: true,
    },
    {
      id: "language",
      required: false,
      allowMultiple: true,
      extensions: [".sfc", ".smc"],
      maxBytes: 8388608,
      variants: [{ id: "fr", sha1: await sha1Hex(zFr) }],
      strict: true,
    },
  ];
}

// 20a. THE BUG, at the gate. The French ROM is offered for `language` and must be recognised as
// `language`/`fr` — even though `base` is the first input whose `extensions[]` also match, and
// even though the SAME bytes match nothing at all under `base`. The second assertion is what
// arms this: it is the exact verdict the shipped code produced for the owner.
check("gate: a file supplied for the second of two same-extension inputs is gated against it", async () => {
  const specs = await zeldaSpecs();
  const g = await gateInputs(specs, [
    { inputId: "base", filename: "Zelda (USA).sfc", bytes: zBase },
    { inputId: "language", filename: "Zelda (France).sfc", bytes: zFr },
  ]);
  eq(g.errors.length, 0, "nothing is refused");
  eq(g.accepted.length, 2, "both files go through");
  eq(g.verdicts[1].inputId, "language", "the translation stayed on the slot it was supplied for");
  eq(g.verdicts[1].recognised, true, "and was recognised there");
  eq(g.verdicts[1].variantId, "fr", "as the French variant");
  // Armed: had the id been re-derived by extension, this is the verdict the user saw.
  const wrong = await gateInputs(specs, [{ inputId: "base", filename: "Zelda (France).sfc", bytes: zFr }]);
  eq(wrong.errors[0]?.code, "input-unrecognised", "the same bytes under `base` ARE unrecognised");
});

// 20b. `strict` is not weakened by any of this: a file that genuinely belongs to no variant of
// the slot it was supplied for is still refused, and named.
check("gate: a genuinely wrong file for the second input is still refused", async () => {
  const specs = await zeldaSpecs();
  const g = await gateInputs(specs, [
    { inputId: "base", filename: "Zelda (USA).sfc", bytes: zBase },
    { inputId: "language", filename: "not-a-rom.sfc", bytes: zJunk },
  ]);
  eq(g.errors.length, 1, "one refusal");
  eq(g.errors[0].code, "input-unrecognised", "under `language`'s own strict");
  eq(g.errors[0].detail, "not-a-rom.sfc", "naming the file the user picked");
  eq(g.accepted.length, 1, "and only the base ROM survives");
});

// 20c. `strict: false` on the SECOND input still accepts AND reports. The relaxation must be
// read off the input the file was supplied for, not off the first extension match — `base`
// staying strict here is what would have hidden a wrongly-derived id.
check("gate: strict:false on the second input accepts and reports as unrecognised", async () => {
  const specs = await zeldaSpecs();
  specs[1].strict = false;
  const g = await gateInputs(specs, [
    { inputId: "base", filename: "Zelda (USA).sfc", bytes: zBase },
    { inputId: "language", filename: "fan-translation.sfc", bytes: zJunk },
  ]);
  eq(g.errors.length, 0, "accepted");
  eq(g.unrecognised.length, 1, "and reported — that is a requirement, not a nicety");
  eq(g.unrecognised[0].inputId, "language", "attributed to the right slot");
  eq(g.accepted.length, 2, "both reach the module");
});

// 20d. `allowMultiple` still governs arity, per input. `language` takes many translations; `base`
// takes exactly one — and a second `base` is refused even while `language` holds three files.
check("gate: allowMultiple is still per-input with two same-extension inputs", async () => {
  const specs = await zeldaSpecs();
  const many = await gateInputs(specs, [
    { inputId: "base", filename: "us.sfc", bytes: zBase },
    { inputId: "language", filename: "fr.sfc", bytes: zFr },
    { inputId: "language", filename: "fr2.sfc", bytes: zFr },
  ]);
  eq(many.errors.length, 0, "an allowMultiple input takes several");
  const dup = await gateInputs(specs, [
    { inputId: "base", filename: "us.sfc", bytes: zBase },
    { inputId: "base", filename: "us2.sfc", bytes: zBase },
  ]);
  eq(dup.errors[0]?.code, "input-not-multiple", "a non-allowMultiple one does not");
});

// 20e. THE WIRING, which is where the bug actually lived: `prepareState.run` must hand the
// converter the OfferedFiles whole. It used to `.map()` them down to `{filename, bytes}`, which
// is what forced the re-derivation downstream. Armed: against the pre-fix module this check
// fails on `inputId` being `undefined`.
pcheck("prepare: the supplied inputId reaches the converter untouched", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true), inputSpec("language", false)] });
  let seen = null;
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async (_t, files) => {
    seen = files;
    return conversion([["assets.dat", new Uint8Array([7])]]);
  };

  eq(await prepareState.run(t, [offer("Zelda (France).sfc", "language")]), true, "prepared");
  eq(seen?.length, 1, "one file forwarded");
  eq(seen[0].inputId, "language", "with the slot the user filled, not one re-derived by extension");
  eq(seen[0].filename, "Zelda (France).sfc", "and the file it was");
  eq(prepareState.hasSupplied("o/r", "language"), true, "so the row credits the right input");
  eq(prepareState.hasSupplied("o/r", "base"), false, "and not the first one that shares the extension");
});


// ============================================================================================
// 21. The version picker: `resolveVersion` + the retained index (§2.4)
// ============================================================================================
//
// The picker offers versions out of a card that came back from localStorage, so two things
// have to be true and neither is obvious from reading the happy path:
//
//   (a) Choosing an older version runs EVERY guard the newest-version path runs. There is no
//       "we already trust this repo" shortcut: a source is trusted per document, and an older
//       manifest is a document nothing has ever read.
//   (b) The list is really persisted, so the control is drawn on the first paint rather than
//       after a round-trip.
//
// Each refusal below is ARMED by its positive twin: the same fixture without the one bad field
// is asserted to be ACCEPTED by both entry points in the same check. Delete a guard and the
// negative half starts passing while the twin still does, so neither half can be satisfied by
// a fixture that is broken some other way.
//
// Everything here is SERIALISED (`scheck`). These checks swap `globalThis.fetch` and drive the
// `sources` singleton, so running them concurrently — which is what plain `check()` does —
// would have them clobber each other's mirror.

const { resolveVersion, resolveSource } = await load("client.js");

// Chained onto `settled` so nothing here disturbs the seeded rows section 12c is still
// asserting against — this section drives the SAME `sourcesStore` singleton.
let verChain = Promise.resolve(settled);
function scheck(name, fn) {
  check(name, () => {
    const p = verChain.then(fn);
    verChain = p.catch(() => {});
    return p;
  });
}

const VJSON_URL = "https://o.github.io/r/dist/versions.json";
const M_NEW = "https://o.github.io/r/dist/v2.0.0/manifest.json";
const M_OLD = "https://o.github.io/r/dist/v1.0.0/manifest.json";

function vEntry(tag, over = {}) {
  return {
    tag,
    manifest: `${tag}/manifest.json`,
    publishedAt: "2026-01-02T00:00:00Z",
    prerelease: false,
    kind: "homebrew",
    requiresAbi: { version: 1, minSize: 0 },
    needsUserFiles: false,
    ...over,
  };
}

function vFile(entries, over = {}) {
  return {
    schemaVersion: 1,
    project: "demo",
    title: "Demo",
    repo: "o/r",
    releasesUrl: "https://github.com/o/r/releases",
    versions: entries,
    ...over,
  };
}

const THREE = [vEntry("v2.0.0"), vEntry("v1.5.0", { prerelease: true }), vEntry("v1.0.0")];

/** A fetch that serves JSON documents by exact URL and 404s everything else. */
function withJsonMirror(docs, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!Object.prototype.hasOwnProperty.call(docs, u)) {
      return { ok: false, status: 404, text: async () => "" };
    }
    const v = docs[u];
    const body = typeof v === "string" ? v : JSON.stringify(v);
    return { ok: true, status: 200, text: async () => body };
  };
  return Promise.resolve(fn()).finally(() => void (globalThis.fetch = real));
}

/** The standard three-version mirror; the two arguments override either manifest document. */
const mirror = (newest = manifestDoc(), old = manifestDoc({ title: "Demo 1.0" })) => ({
  [VJSON_URL]: vFile(THREE),
  [M_NEW]: newest,
  [M_OLD]: old,
});

scheck("version: resolveVersion returns the NAMED entry, not the newest", () =>
  withJsonMirror(mirror(), async () => {
    const r = await resolveVersion("o/r", "v1.0.0");
    eq(r.entry.tag, "v1.0.0", "the entry asked for");
    eq(r.manifestUrl, M_OLD, "its own manifest path, resolved against versions.json");
    eq(r.manifest.title, "Demo 1.0", "and its own manifest document");
    eq(r.index.versions.length, 3, "the whole index still comes back");
    eq(
      r.manifest.targets[0].artifacts[0].url,
      "https://o.github.io/r/dist/v1.0.0/engine.bin",
      "artifact urls resolve against THAT manifest, not the newest one",
    );
  }));

scheck("version: a repo reference that is not one is refused before any fetch", () =>
  withJsonMirror(mirror(), () => refuses("bad-url", () => resolveVersion("not a repo", "v1.0.0"))));

scheck("version: a tag the live index does not publish is refused, and names the tag", () =>
  withJsonMirror(mirror(), async () => {
    const e = await refuses("no-versions", () => resolveVersion("o/r", "v0.9.0"));
    eq(e.detail, "v0.9.0", "detail is the tag, which is what lets the store fall back silently");
  }));

scheck("version: it cannot proceed on a remembered manifest path alone", () =>
  // Only the manifest is reachable; versions.json is not. If `resolveVersion` ever took the
  // path out of a persisted card instead of re-listing the live index, this would SUCCEED —
  // and the URL it built would be third-party text out of localStorage.
  withJsonMirror({ [M_OLD]: manifestDoc() }, () =>
    refuses("no-pages", () => resolveVersion("o/r", "v1.0.0"))));

scheck("version: a network failure surfaces as `network`, never a raw fetch message", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("getaddrinfo ENOTFOUND o.github.io");
  };
  try {
    const e = await refuses("network", () => resolveVersion("o/r", "v1.0.0"));
    eq(e.message, "network", "the code is the message; the fetch text never escapes");
  } finally {
    globalThis.fetch = real;
  }
});

// --- The parity claim: the SAME document, refused the SAME way by BOTH entry points ---------
//
// `bad` is installed as whichever manifest the entry point under test will read, so both are
// judging an identical document. Every case ends by re-asserting that the untouched fixture is
// accepted by both — the arming.

for (const [why, bad, code] of [
  ["a traversing artifact filename", manifestDoc({}, { filename: "../bios/boot.bin" }), "malformed"],
  ["an absolute artifact filename", manifestDoc({}, { filename: "/etc/passwd" }), "malformed"],
  ["a nested artifact filename", manifestDoc({}, { filename: "sub/dir.bin" }), "malformed"],
  ["a traversing artifact url", manifestDoc({}, { url: "../../other/thing.bin" }), "malformed"],
  ["a backslash in a filename", manifestDoc({}, { filename: "..\\win\\evil.bin" }), "malformed"],
  ["an empty artifact filename", manifestDoc({}, { filename: "" }), "malformed"],
  ["a manifest schemaVersion it does not implement", manifestDoc({ schemaVersion: 2 }), "unsupported-schema"],
  ["a manifest with no targets", manifestDoc({ targets: [] }), "malformed"],
]) {
  scheck(`version: ${why} is refused by BOTH entry points, with the same code`, async () => {
    const viaNewest = await withJsonMirror(mirror(bad, manifestDoc()), () =>
      refuses(code, () => resolveSource("o/r")));
    const viaPicker = await withJsonMirror(mirror(manifestDoc(), bad), () =>
      refuses(code, () => resolveVersion("o/r", "v1.0.0")));
    eq(viaPicker.code, viaNewest.code, "same code from both paths");
    // ARMED: the twin, identical but for the one guarded field, is accepted by both.
    await withJsonMirror(mirror(), async () => {
      eq((await resolveSource("o/r")).entry.tag, "v2.0.0", "twin accepted by resolveSource");
      eq((await resolveVersion("o/r", "v1.0.0")).entry.tag, "v1.0.0", "twin accepted by resolveVersion");
    });
  });
}

scheck("version: a versions.json schemaVersion it does not implement is refused by the picker too", () =>
  withJsonMirror({ ...mirror(), [VJSON_URL]: vFile(THREE, { schemaVersion: 9 }) }, () =>
    refuses("unsupported-schema", () => resolveVersion("o/r", "v1.0.0"))));

scheck("version: originalSystem still follows the schema pattern in an older manifest", async () => {
  await withJsonMirror(mirror(manifestDoc(), manifestDoc({ originalSystem: "snes" })), async () => {
    eq((await resolveVersion("o/r", "v1.0.0")).manifest.originalSystem, "snes", "kept");
  });
  await withJsonMirror(mirror(manifestDoc(), manifestDoc({ originalSystem: "../snes" })), async () => {
    eq((await resolveVersion("o/r", "v1.0.0")).manifest.originalSystem, undefined, "dropped");
  });
});

// --- The retained index, through the real store ----------------------------------------------
//
// Reuses section 12c's compiled `sourcesStore` and its localStorage shim, so this is the real
// module with the real persistence path, not a second copy of either.

if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "stub:blob";
  URL.revokeObjectURL = () => {};
}

const sources = sourcesStore;
const readPersisted = () => JSON.parse(localStorage.getItem("gnw:sources.v1") ?? "[]");

/** Drop the in-memory rows, as a fresh tab has before `load()` runs. Storage is left alone —
 *  that is exactly what the round-trip check needs to read back. */
function coldStart() {
  sources.rows = [];
  sources.selected = null;
  sources.loaded = false;
}

/** ...and start from nothing persisted at all. */
function wipeStorage() {
  localStorage.removeItem("gnw:sources.v1");
}

/** A fetch that refuses everything — proves what renders with no network at all. */
function offline(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  return Promise.resolve(fn()).finally(() => void (globalThis.fetch = real));
}

scheck("store: adding a source retains the whole version list on the card", async () => {
  coldStart();
  wipeStorage();
  await withJsonMirror(mirror(), async () => {
    eq(await sources.add("o/r"), true, "added");
  });
  const row = sources.get("o/r");
  eq(row.card.versions.length, 3, "every entry the index published");
  eq(row.card.versions[0].tag, "v2.0.0", "newest first, as versions.json orders them");
  eq(row.card.versions[2].tag, "v1.0.0", "down to the oldest");
  eq(row.card.versions[1].prerelease, true, "the prerelease flag survives, so the picker can mark it");
  eq(row.card.versions[2].manifest, "v1.0.0/manifest.json", "and the path that addresses it");
  eq(row.card.tag, "v2.0.0", "the card still describes the newest by default");
  eq(row.pinnedTag, undefined, "and is not pinned");
});

scheck("store: the retained list survives a persist()/load() round-trip with NO network", async () => {
  // The whole reason it is persisted: the picker is drawn on the first paint.
  const raw = readPersisted();
  eq(raw.length, 1, "one row written");
  eq(raw[0].card.versions.length, 3, "the list really reached localStorage");

  coldStart();
  await offline(async () => {
    sources.load();
    // Synchronously, before the background refresh it kicked off could possibly answer:
    const row = sources.get("o/r");
    eq(row.card.versions.length, 3, "read straight back out of storage");
    eq(row.card.versions[1].tag, "v1.5.0", "in order");
    await new Promise((r) => setTimeout(r, 0));
    eq(sources.get("o/r").card.versions.length, 3, "and the failed refresh did not take it away");
  });
});

scheck("store: selecting an older version changes the card, the manifest, and the pin", async () => {
  coldStart();
  wipeStorage();
  await withJsonMirror(mirror(), async () => {
    await sources.add("o/r");
    await sources.selectVersion("o/r", "v1.0.0");
  });
  const row = sources.get("o/r");
  eq(row.status, "ok", "resolved");
  eq(row.card.tag, "v1.0.0", "the card is the older release");
  eq(row.manifest.title, "Demo 1.0", "and so is the manifest the install path reads");
  eq(row.pinnedTag, "v1.0.0", "pinned, so a later refresh does not undo it");
  eq(readPersisted()[0].pinnedTag, "v1.0.0", "and the pin persists");
});

scheck("store: a pin survives a reload and still governs the next refresh", async () => {
  coldStart();
  await offline(() => sources.load());
  eq(sources.get("o/r").pinnedTag, "v1.0.0", "read back");

  // A NEWER release appears upstream. A pinned row must not silently jump to it.
  const withV3 = {
    [VJSON_URL]: vFile([vEntry("v3.0.0"), ...THREE]),
    "https://o.github.io/r/dist/v3.0.0/manifest.json": manifestDoc({ title: "Demo 3.0" }),
    [M_NEW]: manifestDoc(),
    [M_OLD]: manifestDoc({ title: "Demo 1.0" }),
  };
  await withJsonMirror(withV3, () => sources.refresh("o/r"));
  eq(sources.get("o/r").card.tag, "v1.0.0", "still the pinned release");
  eq(sources.get("o/r").manifest.title, "Demo 1.0", "still its manifest");
  eq(sources.get("o/r").card.versions[0].tag, "v3.0.0", "but the picker now offers the new one");
});

scheck("store: choosing the newest release clears the pin rather than freezing on its number", async () => {
  await withJsonMirror(mirror(), () => sources.selectVersion("o/r", "v2.0.0"));
  const row = sources.get("o/r");
  eq(row.card.tag, "v2.0.0", "switched");
  eq(row.pinnedTag, undefined, "'latest' is a subscription, not a lock on today's tag");
});

scheck("store: a pinned tag that retention dropped falls back to newest, silently", async () => {
  coldStart();
  wipeStorage();
  await withJsonMirror(mirror(), async () => {
    await sources.add("o/r");
    await sources.selectVersion("o/r", "v1.0.0");
  });
  // The mirror now retains only the two newest.
  const trimmed = { [VJSON_URL]: vFile([vEntry("v2.0.0"), vEntry("v1.5.0")]), [M_NEW]: manifestDoc() };
  await withJsonMirror(trimmed, () => sources.refresh("o/r"));
  const row = sources.get("o/r");
  eq(row.status, "ok", "not an error the user has to read");
  eq(row.errorCode, undefined, "and no error copy invented for a case that has none");
  eq(row.card.tag, "v2.0.0", "back on the newest");
  eq(row.pinnedTag, undefined, "pin dropped");
});

scheck("store: a bundle row is given no version list at all", async () => {
  coldStart();
  wipeStorage();
  eq(await sources.importBundleFile(multiVersion()), true, "imported");
  const row = sources.get("someone/minesweeper");
  eq(row.origin, "bundle", "a bundle row");
  eq(row.card.versions, undefined, "and no picker data — a zip is one release, with no mirror");
  eq(readPersisted()[0].card.versions, undefined, "nothing persisted either");
  // And the store refuses to switch one even if something asked it to.
  await sources.selectVersion("someone/minesweeper", "v0.1.3");
  eq(row.card.tag, "v0.1.3", "untouched");
  row.releaseBundle?.();
});

// --- addResolved(): the add form's look-up result, kept without a second resolve ------------
//
// `ui/AddSource.svelte` resolves the typed repo once to draw its "Found" panel, and used to
// throw that result away and let `sources.add()` resolve the SAME repo all over again. Two
// things are being proved here, and the second is the one that matters:
//
//   (a) the new entry point performs NO network access at all (it runs under `offline()`);
//   (b) the row it stores is INDISTINGUISHABLE from the row `add()` produces — same card,
//       same manifest, same origin/active/status, same persisted record, same selection —
//       so this is one path with two doors, not a second, laxer way into the store.
//
// (b) is asserted by building both rows from the same mirror and deep-comparing them, rather
// than by re-listing the fields a reader thinks matter: a field added to the row later is
// covered automatically, and an `addResolved` that quietly wrote `origin: "bundle"`, skipped
// `versions[]`, or left the row inactive fails immediately.

/** Everything about a row that is not a live blob-URL closure, as comparable JSON. */
const rowShape = (row) =>
  JSON.stringify({
    repo: row.repo,
    active: row.active,
    origin: row.origin,
    status: row.status,
    pinnedTag: row.pinnedTag ?? null,
    card: row.card,
    manifest: row.manifest,
  });

scheck("addResolved: stores exactly the row add() stores, and touches the network zero times", async () => {
  coldStart();
  wipeStorage();
  await withJsonMirror(mirror(), async () => {
    eq(await sources.add("o/r"), true, "the old path added");
  });
  const viaAdd = rowShape(sources.get("o/r"));
  const persistedViaAdd = JSON.stringify(readPersisted());

  // The look-up the add form does, then the confirm — the confirm with NO mirror installed.
  coldStart();
  wipeStorage();
  const found = await withJsonMirror(mirror(), () => resolveSource("o/r"));
  await offline(() => {
    eq(sources.addResolved(found), true, "the look-up result was kept");
  });
  const row = sources.get("o/r");
  eq(rowShape(row), viaAdd, "byte-for-byte the row add() would have produced");
  eq(JSON.stringify(readPersisted()), persistedViaAdd, "and the persisted record matches too");
  eq(sources.selected, "o/r", "selection, as add() does");
  eq(row.card.versions.length, 3, "arming: this fixture really does carry a version list");
});

scheck("addResolved: still refuses a reference that is not a repo, and keeps the code add() uses", async () => {
  coldStart();
  wipeStorage();
  const found = await withJsonMirror(mirror(), () => resolveSource("o/r"));
  // A resolve object whose repo is junk — what a trusting `addResolved` would happily store.
  eq(sources.addResolved({ ...found, repo: "not a repo" }), false, "refused");
  eq(sources.addError.code, "bad-url", "the same code add() reports for the same input");
  eq(sources.rows.length, 0, "and nothing entered the list");
  // ARMED: the untouched twin is accepted, so the refusal is about the ref and nothing else.
  eq(sources.addResolved(found), true, "twin accepted");
  eq(sources.rows.length, 1, "one row");
});

scheck("addResolved: dedupes the way add() does — selects the existing row, adds no second one", async () => {
  coldStart();
  wipeStorage();
  const found = await withJsonMirror(mirror(), () => resolveSource("o/r"));
  eq(sources.addResolved(found), true, "first");
  sources.selected = null;
  eq(sources.addResolved(found), true, "adding it again is not an error");
  eq(sources.rows.length, 1, "but there is still exactly one row");
  eq(sources.selected, "o/r", "and the existing one is selected, as add() does");
  eq(readPersisted().length, 1, "one persisted record");
});

scheck("addResolved: a bundle row is never reachable through it", async () => {
  // The bundle path is untouched by this change; what must hold is that the URL door cannot
  // overwrite a bundle row behind `importBundleFile()`'s conflict guard.
  coldStart();
  wipeStorage();
  eq(await sources.importBundleFile(multiVersion()), true, "imported");
  const bundleRow = sources.get("someone/minesweeper");
  const found = await withJsonMirror(mirror(), () => resolveSource("o/r"));
  eq(sources.addResolved({ ...found, repo: "someone/minesweeper" }), true, "dedupe hit, not a write");
  eq(sources.get("someone/minesweeper").origin, "bundle", "the bundle row is still the bundle row");
  eq(sources.get("someone/minesweeper").card.tag, "v0.1.3", "with its own card");
  eq(sources.rows.length, 1, "and no url row was appended beside it");
  bundleRow.releaseBundle?.();
});


// ============================================================================================
// 17. Derived output names (`homebrewConvert.ts`'s `resolveOutputName`)
// ============================================================================================
//
// spec/03 "How a derived name is resolved" and spec/05 "Resolve names yourself, and force the
// declared extension". The driving case is Doom: a user brings `DOOM.WAD`, `doom2.wad` and
// `freedoom2.wad`; the first two match variants that publish canonical names, the third
// matches nothing and is accepted under `strict: false`. The module emits the id `"whd"` all
// three times and never learns the difference.
//
// What is NOT here: collisions, case-folding and `maxCount` — those are section 18, which
// polices the name this section resolves. Placement is still a later step. This answers
// "what is this file called", not "may it be written".

const WHD = { id: "whd", extension: ".whd", maxBytes: 24 * 1024 * 1024 };
const FIXED = { id: "assets", filename: "smw_assets.dat", maxBytes: 1 << 20 };
const verdict = (filename, extra = {}) => ({ inputId: "wad", filename, sha1: "", recognised: false, ...extra });

check("derived: a fixed `filename` output is that name, whatever the input was", () => {
  eq(resolveOutputName(FIXED, verdict("anything.sfc")), "smw_assets.dat", "fixed name");
  // And with no input in sight at all — a fixed name never consults one.
  eq(resolveOutputName(FIXED, undefined), "smw_assets.dat", "fixed name, no source file");
});

check("derived: rule 1 — a recognised input takes the matched variant's filename", () => {
  const src = verdict("DOOM2.WAD", {
    recognised: true,
    variantId: "doom2-1.9",
    variantFilename: "Doom II - Hell on Earth.whd",
  });
  eq(resolveOutputName(WHD, src), "Doom II - Hell on Earth.whd", "the publisher's canonical name");
});

check("derived: rule 2 — an unrecognised input derives stem + the DECLARED extension", () => {
  eq(resolveOutputName(WHD, verdict("freedoom2.wad")), "freedoom2.whd", "the driving case's third file");
});

check("derived: rule 1 only applies when the variant actually publishes a name", () => {
  // Recognised, but the variant declares no `filename`: there is nothing to prefer, so rule 2
  // runs exactly as it would for a stranger.
  const src = verdict("DOOM.WAD", { recognised: true, variantId: "doom-1.9" });
  eq(resolveOutputName(WHD, src), "DOOM.whd", "falls through to the stem");
});

// >>> The load-bearing half: the extension is REPLACED, never appended. <<<
check("derived: the extension replaces the input's own, it does not stack onto it", () => {
  eq(resolveOutputName(WHD, verdict("MYHACK.WAD")), "MYHACK.whd", "spec/03's own example");
  assert(!resolveOutputName(WHD, verdict("MYHACK.WAD")).endsWith(".WAD.whd"), "must not append");
  // A user's file cannot bring its own extension into the flat install set. This is what stops
  // a WAD named `doom.bin` landing where a core binary goes.
  eq(resolveOutputName(WHD, verdict("doom.bin")), "doom.whd", "a misleading extension is discarded");
  // Only the LAST dot separates an extension, so a dotted stem survives whole.
  eq(resolveOutputName(WHD, verdict("My.Game.v2.wad")), "My.Game.v2.whd", "dotted stem kept");
  // No extension at all is already a stem.
  eq(resolveOutputName(WHD, verdict("doomwad")), "doomwad.whd", "no dot to replace");
});

check("derived: a name that cannot be a plain filename is an error, never a canned fallback", async () => {
  // spec/05: "A name that sanitises to nothing usable is an error the user resolves. There is
  // no canned fallback: two files that collide would still collide under one."
  // `.hidden` moved here from the check above, gwrg-dist-spec `fb4c8be`. A leading dot is still
  // not an extension separator, so the derived name WOULD be `.hidden.whd` -- but `$defs/filename`
  // now refuses a name that begins with a dot, so that name cannot be written to the card.
  // Refusing is the required answer: spec/05 says a name that sanitises to nothing usable is an
  // error the user resolves, and stripping the dot here would be inventing a name for them.
  for (const bad of ["../evil.wad", "sub/doom.wad", "doom\u0000.wad", " doom.wad", ".hidden"]) {
    await refuses("output-name", () => resolveOutputName(WHD, verdict(bad)));
  }
  await refuses("output-name", () => resolveOutputName(WHD, verdict("")));
  await refuses("output-name", () => resolveOutputName(WHD, undefined));
});

check("derived: a variant filename that is not a plain filename is not trusted either", () => {
  // Publisher text gets the same treatment as user text: rule 1 is skipped and rule 2 runs.
  const src = verdict("doom2.wad", { recognised: true, variantId: "x", variantFilename: "../../Doom II.whd" });
  eq(resolveOutputName(WHD, src), "doom2.whd", "a path from a manifest is refused, not used");
});

check("derived: the whole driving case, three files through one output id", () => {
  const sources = [
    verdict("DOOM.WAD", { recognised: true, variantId: "ud", variantFilename: "The Ultimate Doom.whd" }),
    verdict("doom2.wad", { recognised: true, variantId: "d2", variantFilename: "Doom II - Hell on Earth.whd" }),
    verdict("freedoom2.wad"),
  ];
  eq(
    sources.map((v) => resolveOutputName(WHD, v)).join(" | "),
    "The Ultimate Doom.whd | Doom II - Hell on Earth.whd | freedoom2.whd",
    "one emitted id, three different names, none of them the module's doing",
  );
});

check("derived: the gate carries a matched variant's filename forward", async () => {
  // Rule 1 is only reachable because `gateInputs` records WHICH variant matched. Nothing
  // downstream can recover that, so this pins the hand-off rather than the resolution.
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  const spec = {
    id: "wad",
    required: true,
    allowMultiple: true,
    runPerFile: true,
    extensions: [".wad"],
    maxBytes: 1 << 20,
    variants: [{ id: "d2", sha1, filename: "Doom II - Hell on Earth.whd" }],
    strict: false,
  };
  const g = await gateInputs([spec], [{ inputId: "wad", filename: "DOOM2.WAD", bytes }]);
  eq(g.errors.length, 0, "accepted");
  eq(g.verdicts[0].variantFilename, "Doom II - Hell on Earth.whd", "carried out of the gate");
  eq(resolveOutputName(WHD, g.verdicts[0]), "Doom II - Hell on Earth.whd", "and used by rule 1");
});

check("derived: parseVariants holds a variant filename to the plain-filename rule", () => {
  const t = {
    inputs: [
      {
        id: "wad",
        required: true,
        allowMultiple: true,
        extensions: [".wad"],
        maxBytes: 1024,
        variants: [
          { id: "ok", sha1: "a".repeat(40), filename: "The Ultimate Doom.whd" },
          { id: "path", sha1: "b".repeat(40), filename: "../escape.whd" },
          { id: "num", sha1: "c".repeat(40), filename: 7 },
        ],
      },
    ],
  };
  const [got] = parseToolInputs(t);
  eq(got.variants[0].filename, "The Ultimate Doom.whd", "a good one is kept");
  eq(got.variants[1].filename, undefined, "a path is dropped, not carried");
  eq(got.variants[2].filename, undefined, "a non-string is dropped");
});

check("derived: parseToolOutputs keeps `extension` and leaves `filename` absent", () => {
  const [fixed, derived] = parseToolOutputs({
    outputs: [
      { id: "assets", filename: "smw_assets.dat", maxBytes: 4096 },
      { id: "whd", extension: ".whd", maxBytes: 4096 },
    ],
  });
  eq(fixed.filename, "smw_assets.dat", "fixed name parsed");
  eq(fixed.extension, undefined, "and no extension invented for it");
  eq(derived.extension, ".whd", "extension parsed");
  eq(derived.filename, undefined, "and no filename invented for it");
});


// ============================================================================================
// 18. The safety invariants around a name (`outputNames.ts`, and `maxCount` in `inputGate.ts`)
// ============================================================================================
//
// Section 17 resolves a name. This polices it. spec/05-host.md, "Resolve names yourself, and
// force the declared extension":
//
//   - a publisher-declared name wins over a derived one, and the loser is REFUSED, never
//     silently written and never renamed around;
//   - the comparison is CASE-FOLDED (the card is FAT/exFAT: `Doom.whd` and `DOOM.whd` are one
//     file there and two in any ordinary Map) and PER DESTINATION DIRECTORY;
//   - `maxCount` is checked BEFORE running, because with `runPerFile` the run count is the one
//     unbounded quantity in the model.
//
// Placement and the per-file run loop are still the next step. Everything here is handed its
// destinations rather than computing them.

const ROMS = "roms/doom/";
const CORES = "cores/";
const derived = (name, from) => ({ dir: ROMS, name, origin: "derived", ...(from ? { from } : {}) });

check("names: a clean plan accepts everything, in declared-first order", () => {
  const plan = planNames([
    derived("freedoom2.whd", "freedoom2.wad"),
    { dir: CORES, name: "prboom.bin", origin: "artifact" },
    derived("The Ultimate Doom.whd", "DOOM.WAD"),
  ]);
  eq(plan.collisions.length, 0, "nothing collides");
  eq(plan.accepted.map((p) => p.name).join(" | "), "prboom.bin | freedoom2.whd | The Ultimate Doom.whd",
    "the declared name is settled first; derived ones keep their offered order");
});

// >>> Invariant 2 + 3: a declared name wins, and case is folded before comparing. <<<
check("names: a derived name colliding CASE-ONLY with an artifact is refused", () => {
  const plan = planNames([
    derived("PRBoom.bin", "PRBoom.bin"),
    { dir: ROMS, name: "prboom.bin", origin: "artifact" },
  ]);
  eq(plan.collisions.length, 1, "refused, not written");
  const c = plan.collisions[0];
  eq(c.refused.origin, "derived", "the derived one loses");
  eq(c.kept.origin, "artifact", "the publisher's name is the one kept");
  eq(c.caseOnly, true, "and they differ only in case");
  // The ORIGINAL spellings survive for display; the folded key is never shown as a filename.
  eq(c.refused.name, "PRBoom.bin", "the user's spelling is preserved");
  eq(c.kept.name, "prboom.bin", "so is the manifest's");
  eq(plan.accepted.length, 1, "exactly one file may be written");
  eq(plan.accepted[0].origin, "artifact", "and it is the declared one");
});

check("names: a derived name colliding case-only with a FIXED output is refused", () => {
  // smw's asset pack is `smw_assets.dat`, declared by `outputs[].filename`. A derived name
  // that folds onto it is the same failure as the artifact case: one file on the card.
  const plan = planNames([
    { dir: CORES, name: "SMW_Assets.DAT", origin: "derived", from: "smw_assets.dat" },
    { dir: CORES, name: "smw_assets.dat", origin: "fixed" },
  ]);
  eq(plan.collisions.length, 1, "refused");
  eq(plan.collisions[0].kept.origin, "fixed", "the fixed output keeps the name");
  eq(plan.collisions[0].refused.origin, "derived", "the derived one is refused");
});

check("names: two derived names differing only in case are refused", () => {
  // Neither is a publisher's, so the FIRST offered keeps the name -- deterministic, and the
  // same order the user picked the files in. The second is refused, never renamed around.
  const plan = planNames([derived("Doom.whd", "Doom.wad"), derived("DOOM.whd", "DOOM.WAD")]);
  eq(plan.collisions.length, 1, "one refusal");
  eq(plan.collisions[0].kept.name, "Doom.whd", "first offered wins");
  eq(plan.collisions[0].refused.name, "DOOM.whd", "the second is refused");
  eq(plan.collisions[0].caseOnly, true, "case-only");
  eq(plan.accepted.length, 1, "one file, because that is what the card would hold");
});

// >>> Invariant 3's other half: the grouping is per destination directory. <<<
check("names: the SAME name in two different directories is not a collision", () => {
  // A core's converted outputs land in `roms/<system id>/` and its artifacts in the core
  // directory. Those two cannot collide with each other, however alike the names are.
  const plan = planNames([
    { dir: CORES, name: "core.bin", origin: "artifact" },
    { dir: ROMS, name: "CORE.BIN", origin: "derived" },
  ]);
  eq(plan.collisions.length, 0, "two directories, two files");
  eq(plan.accepted.length, 2, "both are written");
  // ...and the same pair inside ONE directory is a collision, so the check is really grouping
  // and not just failing to compare.
  eq(planNames([
    { dir: CORES, name: "core.bin", origin: "artifact" },
    { dir: CORES, name: "CORE.BIN", origin: "derived" },
  ]).collisions.length, 1, "same directory, one file");
});

check("names: a directory is matched case-folded too", () => {
  // `roms/Doom/` and `roms/doom/` are one directory on the card, so a name in each collides.
  const plan = planNames([
    { dir: "roms/Doom/", name: "freedoom2.whd", origin: "derived" },
    { dir: "roms/doom/", name: "freedoom2.whd", origin: "derived" },
  ]);
  eq(plan.collisions.length, 1, "one directory, whatever its spelling");
});

check("names: two DECLARED names that fold together are refused as well", () => {
  // A broken manifest rather than a user's mistake -- the published checker refuses one before
  // release (gwrg-dist-spec 930517c) -- but a host that assumed the publisher ran the checker
  // would be trusting the party it is validating, and the card cannot tell them apart either.
  const plan = planNames([
    { dir: CORES, name: "MineSweeper.bin", origin: "artifact" },
    { dir: CORES, name: "minesweeper.bin", origin: "artifact" },
  ]);
  eq(plan.collisions.length, 1, "refused");
  eq(plan.collisions[0].refused.origin, "artifact", "no rank breaks the tie, so offer order does");
});

check("names: a collision is refused, NEVER renamed around", () => {
  // The failure mode this rule exists to prevent has two faces: a silent overwrite, and a
  // silent rename. Both give the user a card that does not match what they asked for. So the
  // refused entry must simply be absent from `accepted`, under any name.
  const plan = planNames([
    { dir: ROMS, name: "doom.whd", origin: "artifact" },
    derived("DOOM.whd", "DOOM.WAD"),
  ]);
  eq(plan.accepted.length, 1, "one entry survives");
  assert(!plan.accepted.some((p) => p.origin === "derived"), "and it is not the derived one");
  assert(!plan.accepted.some((p) => /\(1\)|_1|-1/.test(p.name)), "no invented alternative name");
});

check("names: the driving case -- three WADs into one directory, all accepted", () => {
  // `DOOM.WAD`, `doom2.wad`, `freedoom2.wad` resolve (section 17) to the three names below,
  // and none of them folds onto another. This is the case the whole design is for, and it
  // must NOT be refused.
  const names = ["The Ultimate Doom.whd", "Doom II - Hell on Earth.whd", "freedoom2.whd"];
  const plan = planNames(names.map((n) => derived(n)));
  eq(plan.collisions.length, 0, "three distinct names");
  eq(plan.accepted.length, 3, "all three land in roms/doom/");
});

check("names: a fourth WAD deriving DOOM2.whd does NOT collide with the canonical name", () => {
  // The task's own trap. `DOOM2.whd` and `Doom II - Hell on Earth.whd` fold to different
  // strings, so they are two files on the card and this must be allowed -- refusing it would
  // be the check firing on a resemblance rather than on a collision.
  const plan = planNames([
    derived("Doom II - Hell on Earth.whd", "doom2.wad"),
    derived("DOOM2.whd", "DOOM2.WAD"),
  ]);
  eq(plan.collisions.length, 0, "a canonical name and a stem-derived one are different files");
  // It DOES collide with a stem-derived `doom2.whd`, which is the case that actually folds.
  eq(planNames([derived("doom2.whd"), derived("DOOM2.whd")]).collisions.length, 1, "these two fold");
});

check("names: folding is locale-independent", () => {
  // `toLowerCase`, not `toLocaleLowerCase`: a filesystem's folding does not move with the
  // user's browser language, so neither may this. (Under a Turkish locale the dotted capital
  // I folds to a dotted small i, which would change whether two names collide.)
  eq(foldName("DOOM.WHD"), "doom.whd", "plain ASCII fold");
  eq(foldName("FILE_I.BIN"), "file_i.bin", "an I stays an ASCII i");
});

check("names: a refusal is an inspectable value, and a typed error when one is wanted", () => {
  const clean = planNames([derived("a.whd"), derived("b.whd")]);
  eq(firstCollisionError(clean), undefined, "a clean plan yields no error");
  const plan = planNames([{ dir: ROMS, name: "doom.whd", origin: "artifact" }, derived("DOOM.whd")]);
  const err = firstCollisionError(plan);
  eq(err.name, "ConverterError", "a typed error, never a thrown string");
  eq(err.code, "name-collision", "with a code the UI can map");
  // The detail carries BOTH original spellings -- "Doom.whd and DOOM.whd" is the only
  // rendering of this a user can act on. Untrusted text; rendered as text, never markup.
  assert(err.detail.includes('"DOOM.whd"') && err.detail.includes('"doom.whd"'), `detail: ${err.detail}`);
  assert(describeCollision(plan.collisions[0]).startsWith(ROMS), "the directory is named too");
});

// >>> THE OWNER'S OpenLara REPORT. <<<
//
//   [OpenLara] Couldn't prepare: name-collision
//     (homebrews/openlara: "LEVEL3A.PKD" (derived) collides with "LEVEL3A.PKD" (derived))
//
// Four strings, two identical, naming nothing he could act on. The refusal itself is CORRECT --
// two files really do claim one name -- so what follows pins the message, not the verdict.

check("names: a collision names the file each side came from", () => {
  // `from` was populated by `homebrewConvert.ts` throughout the bug and `describeCollision`
  // never read it. The output name is the thing the user did not choose; the input is the
  // thing they did, and the only end of this they can change.
  const plan = planNames([
    derived("Doom II - Hell on Earth.whd", "doom2.wad"),
    derived("Doom II - Hell on Earth.whd", "DOOM2.WAD"),
  ]);
  eq(plan.collisions.length, 1, "one refusal");
  const msg = describeCollision(plan.collisions[0]);
  assert(msg.includes('from "DOOM2.WAD"'), `the refused file's source: ${msg}`);
  assert(msg.includes('from "doom2.wad"'), `the keeper's source: ${msg}`);
  eq(plan.collisions[0].sameSource, false, "two different sources");
});

check("names: sameSource is false when no source is stated at all", () => {
  // Two undefined `from`s are not "the same source": that is no source, and it says nothing.
  const plan = planNames([derived("a.whd"), derived("A.WHD")]);
  eq(plan.collisions.length, 1, "still a collision");
  eq(plan.collisions[0].sameSource, false, "absent is not equal");
  assert(!describeCollision(plan.collisions[0]).includes("from"), "and no source is invented");
});

check("names: ONE source on both sides is reported as two files, not as a repetition", () => {
  // The owner's case. Saying `"LEVEL3A.PKD" collides with "LEVEL3A.PKD", both from
  // "LEVEL3A.PHD"` would print one filename three times and still not say the thing that
  // matters: there are TWO files of that name, with different bytes, in his folders.
  const plan = planNames([
    { dir: "homebrews/openlara", name: "LEVEL3A.PKD", origin: "derived", from: "LEVEL3A.PHD" },
    { dir: "homebrews/openlara", name: "LEVEL3A.PKD", origin: "derived", from: "LEVEL3A.PHD" },
  ]);
  eq(plan.collisions.length, 1, "refused");
  eq(plan.collisions[0].sameSource, true, "one source, both sides");
  const msg = describeCollision(plan.collisions[0]);
  assert(msg.includes("two files"), `the count is the finding: ${msg}`);
  assert(msg.includes("different content"), `and why they are two: ${msg}`);
  assert(msg.includes('"LEVEL3A.PHD"'), `named by their INPUT name: ${msg}`);
  // caseOnly and sameSource are different facts and this collision is not the case-only one.
  eq(plan.collisions[0].caseOnly, false, "identical spellings, so not the FAT trap");
});

check("names: THE REPORTED CASE, end to end -- two folders, one path, different bytes", async () => {
  // Drives the REAL chain the owner's failure went through: two registered folders both
  // holding `openlara/LEVEL3A.PHD` with different bytes; `libraryScan` keeps BOTH (its stated
  // rule: identical content is ignored, different content is shown twice, told apart by an
  // internal id); `libraryCandidates` maps both back through `basePath()`; discovery offers
  // one filename twice; a `runPerFile` tool runs twice and derives one name twice.
  //
  // Nothing here is OpenLara-specific -- any runPerFile converter with a duplicated input
  // reaches it. OpenLara is where the owner met it because his levels are duplicated.
  const DUP = "\u0000";
  const folders = [
    { id: "fA", status: "ready", usedBy: [], handle: {} },
    { id: "fB", status: "ready", usedBy: [], handle: {} },
  ];
  const searchable = foldersToSearch(folders, ["o/tomb#openlara"]);
  eq(searchable.length, 2, "both folders are searched");

  const bare = "openlara/LEVEL3A.PHD";
  const dup = `openlara/LEVEL3A.PHD${DUP}a1b2c3d4e5f60718`;
  const userRoms = new Map([[bare, new Uint8Array([1, 2, 3, 4])], [dup, new Uint8Array([9, 9, 9, 9, 9])]]);
  const origin = new Map([[bare, "fA"], [dup, "fB"]]);
  const basePathOf = (k) => (k.indexOf(DUP) < 0 ? k : k.slice(0, k.indexOf(DUP)));
  const cands = libraryCandidates(userRoms, origin, new Set(["fA", "fB"]), basePathOf);
  eq(cands.length, 2, "two candidates");
  eq(cands[0].path, cands[1].path, "with the IDENTICAL path -- the duplicate id is stripped");

  const level = {
    id: "level", required: true, allowMultiple: true, runPerFile: true, maxCount: 32,
    extensions: [".PHD"], maxBytes: 1 << 22, variants: [], strict: false,
  };
  const offered = (await discoverInputs([level], cands, { hash: sha1Hex }))[0].files;
  eq(offered.length, 2, "discovery offers the one name twice");

  const gate = await gateInputs([level], offered);
  eq(gate.errors.length, 0, "the gate has no objection: both are real .PHD files");
  const batches = planRuns(gate.accepted, "level");
  eq(batches.length, 2, "two runs, one per pivot");

  const verdictOf = new Map();
  offered.forEach((f, i) => { const v = gate.verdicts[i]; if (v) verdictOf.set(f, v); });
  // Different bytes, so the gate's own hashes differ -- the two really are two files.
  const hashes = new Set(gate.verdicts.map((v) => v.sha1));
  eq(hashes.size, 2, "two distinct sha1s");

  const spec = { id: "level-out", extension: ".PKD", maxBytes: 1 << 22 };
  const planned = batches.map((b) => ({
    dir: "homebrews/openlara",
    name: resolveOutputName(spec, verdictOf.get(b.pivot)),
    origin: "derived",
    from: b.pivot.filename,
  }));
  eq(planned[0].name, planned[1].name, "both runs derive ONE name");

  const err = firstCollisionError(planNames(planned));
  eq(err.code, "name-collision", "refused, as it must be: one file where two were meant");
  assert(err.detail.includes("two files"), `and the message is actionable now: ${err.detail}`);
  assert(err.detail.includes('"LEVEL3A.PHD"'), `naming the INPUT he can remove: ${err.detail}`);
});

// >>> Invariant 4: `maxCount` is checked BEFORE running, not discovered afterwards. <<<

const wadSpec = (extra = {}) => ({
  id: "wad",
  required: true,
  allowMultiple: true,
  runPerFile: true,
  extensions: [".wad"],
  maxBytes: 1 << 20,
  variants: [],
  strict: false,
  ...extra,
});
const wadFile = (name) => ({ inputId: "wad", filename: name, bytes: new Uint8Array([name.length]) });

check("gate: maxCount refuses at the gate, with a code of its own", async () => {
  const g = await gateInputs([wadSpec({ maxCount: 2 })], ["a.wad", "b.wad", "c.wad"].map(wadFile));
  eq(g.errors.length, 1, "refused");
  eq(g.errors[0].code, "input-too-many", "not conflated with input-not-multiple");
  assert(g.errors[0].detail.includes("3 > 2"), `detail: ${g.errors[0].detail}`);
  // Exactly at the ceiling is fine, and no ceiling means no complaint.
  eq((await gateInputs([wadSpec({ maxCount: 3 })], ["a.wad", "b.wad", "c.wad"].map(wadFile))).errors.length,
    0, "three files, ceiling of three");
  eq((await gateInputs([wadSpec()], ["a.wad", "b.wad", "c.wad"].map(wadFile))).errors.length,
    0, "no maxCount, no ceiling");
});

check("gate: maxCount counts files OFFERED, not files accepted", async () => {
  // A slot handed twenty files is over its ceiling whether or not the gate liked them --
  // otherwise a user could push the run count up with files that fail for another reason.
  const strictSpec = wadSpec({ maxCount: 1, strict: true, variants: [{ id: "x", sha1: "0".repeat(40) }] });
  const g = await gateInputs([strictSpec], ["a.wad", "b.wad"].map(wadFile));
  assert(g.errors.some((e) => e.code === "input-too-many"), "the ceiling still bites");
  eq(g.accepted.length, 0, "even though nothing was accepted");
});

// >>> The point of "BEFORE": the run must not happen. Counted, not assumed. <<<
check("gate: maxCount stops the run before a Worker is ever spawned", async () => {
  let spawns = 0;
  const tool = {
    id: "wadconv",
    title: { en: "t" },
    binary: { url: "u", bytes: 1, sha256: "0".repeat(64) },
    limits: LIMITS,
    inputs: [wadSpec({ maxCount: 2 })],
    outputs: [WHD],
  };
  const run = () =>
    gateAndRun({
      tool,
      wasm: new Uint8Array(0),
      inputs: [],
      files: ["a.wad", "b.wad", "c.wad"].map(wadFile),
      spawnWorker: () => {
        spawns++;
        throw new Error("a run must not have been reached");
      },
    });
  await refuses("input-too-many", run);
  eq(spawns, 0, "the run function was NOT called -- the ceiling is checked before, not after");
  // The same flow with a legal count DOES reach the run (and fails there instead), so the
  // count above is a real observation and not a function that is never called at all.
  let ok = 0;
  await gateAndRun({
    tool: { ...tool, inputs: [wadSpec({ maxCount: 3 })] },
    wasm: new Uint8Array(0),
    inputs: [],
    files: ["a.wad", "b.wad", "c.wad"].map(wadFile),
    spawnWorker: () => {
      ok++;
      throw new Error("reached the run");
    },
  }).catch(() => {});
  eq(ok, 1, "under the ceiling, the run is reached");
});

// ============================================================================================
// 19. The `runPerFile` loop, accumulation, and placement (`homebrewConvert.ts`, `placement.ts`)
// ============================================================================================
//
// Sections 17 and 18 name a file and police the name. This is the step that decides HOW MANY
// files there are, WHERE they go, and refuses the install when two of them are one file.
//
// spec/03-manifest.md, "One run, or one run per file":
//   - `allowMultiple` alone -> ONE run over every file (zelda3: a base ROM plus translations,
//     one asset pack out);
//   - `runPerFile` -> one run PER FILE of that input (Doom: a shelf of WADs, one .whd each),
//     with every other input passed to every run unchanged.
// spec/05-host.md: "Accumulate the produced files across runs rather than replacing them, and
// place each by the rule for the project's kind."
//
// The driving case, end to end: a user brings DOOM.WAD, doom2.wad and freedoom2.wad. The
// first two match variants and become "The Ultimate Doom.whd" and "Doom II - Hell on
// Earth.whd"; freedoom2 matches nothing, is accepted under `strict: false` with a warning, and
// derives "freedoom2.whd". All three land in roms/doom/, and the module emits the id "whd" all
// three times without ever knowing the difference.

const WAD_BYTES = {
  "DOOM.WAD": new Uint8Array([1, 1, 1, 1]),
  "doom2.wad": new Uint8Array([2, 2, 2, 2]),
  "freedoom2.wad": new Uint8Array([3, 3, 3, 3]),
  "IWAD.wad": new Uint8Array([9, 9, 9, 9]),
};
const sha1Of = (b) => createHash("sha1").update(b).digest("hex");

/**
 * A Worker stand-in that records every request and answers with one output per run, carrying
 * the module's `id` (never a filename — spec/04) and bytes that identify the run, so a test
 * can tell three accumulated outputs apart.
 */
function recordingWorker(seen, outputIds = [FIXTURE_OUTPUT_ID]) {
  const w = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(req) {
      seen.push(req);
      const n = seen.length;
      queueMicrotask(() =>
        w.onmessage?.({
          data: {
            type: "done",
            outputs: outputIds.map((id) => ({
              name: id,
              outputId: id,
              bytes: new Uint8Array([n, id.length]),
            })),
            warnings: [`run ${n}`],
            durationMs: 1,
            steps: 1,
          },
        }),
      );
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

const WHD_OUT = { id: "whd", extension: ".whd", maxBytes: 1 << 20 };

/** A title exactly as `homebrewTitles.svelte.ts` builds one, with the tool already narrowed. */
function doomTitle({ inputs, outputs = [WHD_OUT], target = {}, wasm } = {}) {
  const bytes = wasm ?? new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 2, 3, 4]);
  return {
    title: {
      key: "slash-proc/doom#doom",
      repo: "slash-proc/doom",
      targetId: "doom",
      tool: {
        id: "doom-whd",
        title: { en: "WAD converter" },
        binary: { url: "https://example.invalid/c.wasm", bytes: bytes.byteLength, sha256: "a".repeat(64) },
        limits: LIMITS,
        inputs,
        outputs,
      },
      target: {
        id: "doom",
        kind: "homebrew",
        artifacts: [],
        uses: [{ tool: "doom-whd", outputs: outputs.map((o) => o.id), required: true }],
        ...target,
      },
    },
    wasm: bytes,
  };
}

/** Injected deps: the module bytes come from the fake fetch, never the network or a cache. */
const binaryDepsFor = (wasm) => ({
  fetch: async () => wasm,
  cache: new BlobCache({ backend: nullBlobBackend, quota: nullQuota }),
});

const wadInput = (extra = {}) => ({
  id: "wad",
  required: true,
  allowMultiple: true,
  runPerFile: true,
  extensions: [".wad"],
  maxBytes: 1 << 20,
  strict: false,
  variants: [
    { id: "ud", sha1: sha1Of(WAD_BYTES["DOOM.WAD"]), filename: "The Ultimate Doom.whd" },
    { id: "d2", sha1: sha1Of(WAD_BYTES["doom2.wad"]), filename: "Doom II - Hell on Earth.whd" },
  ],
  ...extra,
});
const iwadInput = (extra = {}) => ({
  id: "iwad",
  required: false,
  allowMultiple: false,
  extensions: [".wad"],
  maxBytes: 1 << 20,
  strict: false,
  variants: [],
  ...extra,
});
const wadOffer = (inputId, filename) => ({ inputId, filename, bytes: WAD_BYTES[filename] });

// --- The loop's shape, without a Worker ---------------------------------------------------

check("perfile: planRuns is one run per file of the runPerFile input", () => {
  const files = [wadOffer("wad", "DOOM.WAD"), wadOffer("wad", "doom2.wad"), wadOffer("wad", "freedoom2.wad")];
  const runs = planRuns(files, "wad");
  eq(runs.length, 3, "three files, three runs");
  eq(runs.map((r) => r.pivot.filename).join(" "), "DOOM.WAD doom2.wad freedoom2.wad", "in order");
  assert(runs.every((r) => r.inputs.length === 1), "each run gets exactly its own file");
});

check("perfile: a non-runPerFile input rides along in EVERY run, unchanged", () => {
  // The conversion-mod shape: a base IWAD alongside each PWAD.
  const files = [wadOffer("iwad", "IWAD.wad"), wadOffer("wad", "DOOM.WAD"), wadOffer("wad", "doom2.wad")];
  const runs = planRuns(files, "wad");
  eq(runs.length, 2, "the shared file does not add a run");
  for (const r of runs) {
    eq(r.inputs.length, 2, "shared + pivot");
    eq(r.inputs[0].inputId, "iwad", "the shared input is present");
    bytesEq(r.inputs[0].bytes, WAD_BYTES["IWAD.wad"], "and it is the same bytes each time");
  }
  eq(runs[0].inputs[1].filename, "DOOM.WAD", "run 1 converts the first WAD");
  eq(runs[1].inputs[1].filename, "doom2.wad", "run 2 the second");
});

check("perfile: a tool with NO runPerFile input runs ONCE however many files it got", () => {
  // zelda3's shape: a base ROM plus eleven translations feed ONE run that makes ONE asset
  // pack. Running eleven times would produce eleven packs where the manifest promised one.
  const files = [
    { inputId: "base", filename: "zelda3.sfc", bytes: new Uint8Array([1]) },
    { inputId: "language", filename: "de.sfc", bytes: new Uint8Array([2]) },
    { inputId: "language", filename: "fr.sfc", bytes: new Uint8Array([3]) },
  ];
  const runs = planRuns(files, undefined);
  eq(runs.length, 1, "exactly one run");
  eq(runs[0].inputs.length, 3, "with every file in it");
  eq(runs[0].pivot, undefined, "and nothing to derive a name from");
});

check("perfile: a runPerFile input that got no file falls back to a single run", () => {
  // The slot is optional, or the gate refused everything offered. Refusing here would turn an
  // optional slot into a required one.
  const runs = planRuns([wadOffer("iwad", "IWAD.wad")], "wad");
  eq(runs.length, 1, "one run, not zero");
  eq(runs[0].inputs.length, 1, "with what there is");
});

// --- The whole flow, through the real gate and the real Worker wrapper --------------------

check("perfile: three files through one runPerFile input produce three named outputs", async () => {
  const { title, wasm } = doomTitle({ inputs: [wadInput()] });
  const seen = [];
  const res = await convertHomebrewTitle(
    title,
    [wadOffer("wad", "DOOM.WAD"), wadOffer("wad", "doom2.wad"), wadOffer("wad", "freedoom2.wad")],
    { spawnWorker: () => recordingWorker(seen, ["whd"]), binaryDeps: binaryDepsFor(wasm) },
  );
  eq(seen.length, 3, "three runs");
  eq(res.files.size, 3, "three outputs ACCUMULATED, not one replaced twice");
  eq(
    [...res.files.keys()].join(" | "),
    "The Ultimate Doom.whd | Doom II - Hell on Earth.whd | freedoom2.whd",
    "one emitted id, three different names",
  );
});

check("perfile: outputs ACCUMULATE rather than replace", async () => {
  // The failure this guards is silent: a Map written per run keeps only the last. So the bytes
  // are checked too, not just the count — each run's payload identifies the run that made it.
  const { title, wasm } = doomTitle({ inputs: [wadInput()] });
  const seen = [];
  const res = await convertHomebrewTitle(
    title,
    [wadOffer("wad", "DOOM.WAD"), wadOffer("wad", "doom2.wad"), wadOffer("wad", "freedoom2.wad")],
    { spawnWorker: () => recordingWorker(seen, ["whd"]), binaryDeps: binaryDepsFor(wasm) },
  );
  eq(res.files.get("The Ultimate Doom.whd")[0], 1, "run 1's bytes");
  eq(res.files.get("Doom II - Hell on Earth.whd")[0], 2, "run 2's");
  eq(res.files.get("freedoom2.whd")[0], 3, "run 3's — every run survived");
  eq(res.warnings.join(" | "), "run 1 | run 2 | run 3", "warnings accumulate too, in run order");
});

check("perfile: the shared input reaches every run of the real flow", async () => {
  const { title, wasm } = doomTitle({ inputs: [iwadInput(), wadInput()] });
  const seen = [];
  await convertHomebrewTitle(
    title,
    [wadOffer("iwad", "IWAD.wad"), wadOffer("wad", "DOOM.WAD"), wadOffer("wad", "doom2.wad")],
    { spawnWorker: () => recordingWorker(seen, ["whd"]), binaryDeps: binaryDepsFor(wasm) },
  );
  eq(seen.length, 2, "two runs, one per WAD");
  for (const req of seen) {
    assert(req.inputs.some((i) => i.inputId === "iwad"), "the base IWAD is in every run");
  }
});

check("perfile: a non-runPerFile tool still runs exactly once for many files", async () => {
  // The zelda3 shape again, this time all the way through the loop: `runConverter` must be
  // reached exactly once.
  const { title, wasm } = doomTitle({
    inputs: [
      { id: "base", required: true, allowMultiple: false, extensions: [".sfc"], maxBytes: 1 << 20, variants: [], strict: false },
      { id: "language", required: false, allowMultiple: true, extensions: [".sfc"], maxBytes: 1 << 20, variants: [], strict: false },
    ],
    outputs: [{ id: "assets", filename: "zelda3_assets.dat", maxBytes: 1 << 20 }],
  });
  const seen = [];
  const res = await convertHomebrewTitle(
    title,
    [
      { inputId: "base", filename: "zelda3.sfc", bytes: new Uint8Array([1]) },
      { inputId: "language", filename: "de.sfc", bytes: new Uint8Array([2]) },
      { inputId: "language", filename: "fr.sfc", bytes: new Uint8Array([3]) },
    ],
    { spawnWorker: () => recordingWorker(seen, ["assets"]), binaryDeps: binaryDepsFor(wasm) },
  );
  eq(seen.length, 1, "ONE run");
  eq(seen[0].inputs.length, 3, "over all three files");
  eq([...res.files.keys()].join(" "), "zelda3_assets.dat", "one asset pack, under its fixed name");
});

// --- Placement ----------------------------------------------------------------------------

// The live firmware manifest's `paths` — `/homebrews`, plural, NOT under `roms/`.
const LIVE_PATHS = resolveInstallPaths({
  cores: "/cores", homebrew: "/homebrews", bios: "/bios", roms: "/roms",
  covers: "/covers", cheats: "/cheats", data: "/data",
});
// A firmware that renames BOTH roles. Nothing here may be a literal.
const RENAMED_PATHS = resolveInstallPaths({
  cores: "/plugins", homebrew: "/apps/hb", roms: "/games",
});

check("place: a homebrew's converted output goes beside its binary", () => {
  eq(converterOutputDir({ kind: "homebrew" }, undefined, LIVE_PATHS), "homebrews", "beside the binary");
  eq(artifactDir({ kind: "homebrew" }, LIVE_PATHS), "homebrews", "which is where its artifacts are too");
  // ...which is exactly why a homebrew's derived name CAN collide with its own artifact.
  eq(assetPrefix("homebrews", LIVE_PATHS), "homebrew", "the prepared-asset key `userDest` expands back");
});

check("place: the homebrew directory is the MANIFEST's paths.homebrew, not `roms/homebrew`", () => {
  // The firmware declares `/homebrews` (plural, not under roms/) and this file must not
  // disagree with it. `installPaths.ts` strips the leading slash exactly once.
  eq(homebrewDir(LIVE_PATHS), "homebrews", "the live manifest's own value");
  assert(homebrewDir(LIVE_PATHS) !== "roms/homebrew", "the pre-manifest literal is NOT the answer");
  eq(coresDir(LIVE_PATHS), "cores", "and cores comes from paths.cores the same way");
  // The pre-manifest fallback still works for a device we have never seen a manifest for.
  eq(homebrewDir(DEFAULT_INSTALL_PATHS), "roms/homebrew", "absent role -> the old literal");
});

check("place: a RENAMED role moves every directory, and the asset key does not move", () => {
  eq(converterOutputDir({ kind: "homebrew" }, undefined, RENAMED_PATHS), "apps/hb", "converter output follows");
  eq(artifactDir({ kind: "homebrew" }, RENAMED_PATHS), "apps/hb", "so do its artifacts");
  eq(artifactDir({ kind: "emulator" }, RENAMED_PATHS), "plugins", "and a core's binaries");
  eq(converterOutputDir({ kind: "emulator", systems: [{ id: "doom" }] }, undefined, RENAMED_PATHS),
    "games/doom", "a core's converted GAME lands under paths.roms");
  // The in-memory key is a ROLE NAME and must NOT track the rename: `userDest()` matches the
  // literal string "homebrew" and expands it to whatever the manifest says.
  eq(HOMEBREW_KEY_PREFIX, "homebrew", "the role name userDest matches on");
  eq(assetPrefix("apps/hb", RENAMED_PATHS), "homebrew", "renamed dir -> the same asset key");
  eq(assetPrefix("games/nes", RENAMED_PATHS), "nes", "and a renamed roms dir still drops its prefix");
});

check("place: a core's converted output is a GAME and goes to roms/<system id>/", () => {
  const oneSystem = { kind: "emulator", systems: [{ id: "doom" }] };
  eq(converterOutputDir(oneSystem, undefined, LIVE_PATHS), "roms/doom", "one system is implied, nothing declared");
  eq(artifactDir(oneSystem, LIVE_PATHS), "cores", "its own binaries are elsewhere — so they cannot collide");
  const many = { kind: "emulator", systems: [{ id: "doom" }, { id: "heretic" }] };
  eq(converterOutputDir(many, { tool: "t", outputs: ["whd"], required: true, system: "heretic" }, LIVE_PATHS),
    "roms/heretic", "several systems, so uses[].system says which");
});

check("place: a core that does not say which system is malformed, not guessed at", async () => {
  const many = { kind: "emulator", systems: [{ id: "doom" }, { id: "heretic" }] };
  await refuses("malformed", () => converterOutputDir(many));
  await refuses("malformed", () =>
    converterOutputDir(many, { tool: "t", outputs: [], required: true, system: "nope" }),
  );
  // `system` becomes a path segment and reaches us through an unvalidated cast, so a traversal
  // is refused on the pattern before it is even looked up.
  await refuses("malformed", () =>
    converterOutputDir(many, { tool: "t", outputs: [], required: true, system: "../../etc" }),
  );
});

check("place: a directory has ONE spelling, so the grouping cannot be defeated", () => {
  // `roms/doom/` and `roms/doom` reading as two directories would let two files that are one
  // file on the card through `planNames`. Two defences: normalisation at the source...
  eq(normalizeDir("roms/doom/"), "roms/doom", "no trailing slash comes out of placement");
  assert(!converterOutputDir({ kind: "emulator", systems: [{ id: "doom" }] }, undefined, LIVE_PATHS).endsWith("/"), "nor here");
  // ...including a manifest that spelled its own role WITH a trailing slash.
  eq(homebrewDir(resolveInstallPaths({ homebrew: "/homebrews/" })), "homebrews", "normalised at the source");
  // ...and `foldDir` normalising whatever it is handed anyway.
  eq(foldDir("roms/Doom/"), foldDir("roms/doom"), "both spellings fold to one key");
  eq(planNames([
    { dir: "roms/doom/", name: "x.whd", origin: "derived" },
    { dir: "roms/doom", name: "X.WHD", origin: "derived" },
  ]).collisions.length, 1, "so the two really are one directory");
});

// --- dataDir and subdir (gwrg-dist-spec 61d3726) --------------------------------------------

// OpenLara's real shape: `dataDir: "openlara"`, because the folder name is compiled into its
// binary and nothing can derive it. It is the ONLY published project using either field.
const OPENLARA = { kind: "homebrew", dataDir: "openlara" };

check("place: a homebrew's dataDir moves its converted output, never its binary", () => {
  eq(converterOutputDir(OPENLARA, undefined, LIVE_PATHS), "homebrews/openlara",
    "the .PKD levels land where OpenLara opens them");
  // The asymmetry is the whole point of the field: the launcher looks for the executable in
  // the homebrew directory itself, so moving that too would break launching to fix loading.
  eq(artifactDir(OPENLARA, LIVE_PATHS), "homebrews", "the binary stays beside the launcher");
  // And the key the caller builds must round-trip to the same place through `userDest`.
  eq(assetPrefix("homebrews/openlara", LIVE_PATHS), "homebrew/openlara",
    "role swap is a PREFIX replacement -- equality alone left `homebrews/openlara` intact, and "
    + "userDest reads an unrecognised first segment as a ROMs system");
});

check("place: a homebrew WITHOUT dataDir is unchanged", () => {
  // The regression that would hurt every project that is not OpenLara.
  eq(converterOutputDir({ kind: "homebrew" }, undefined, LIVE_PATHS), "homebrews", "still beside the binary");
  eq(assetPrefix("homebrews", LIVE_PATHS), "homebrew", "and still the bare role key");
  eq(outputSubdir({ kind: "homebrew" }, "fmv"), "",
    "a subdir with no dataDir to be relative to is DROPPED, not placed below the binary");
});

check("place: an output's subdir nests one level further, under dataDir", () => {
  eq(outputSubdir(OPENLARA, "fmv"), "fmv", "cutscenes reach /homebrews/openlara/fmv/");
  eq(outputSubdir(OPENLARA, undefined), "", "while the levels stay in /homebrews/openlara/");
  // Same untrusted-segment rule as every other path field here: ignored, never sanitised.
  eq(outputSubdir(OPENLARA, "../../etc"), "", "a traversal is not a subdir");
  eq(outputSubdir(OPENLARA, ""), "", "nor is an empty string");
});

check("place: a core ignores dataDir and subdir entirely", () => {
  // `parseManifest` already drops dataDir for a core; nothing downstream may reintroduce it.
  const core = { kind: "emulator", systems: [{ id: "doom" }], dataDir: "openlara" };
  eq(converterOutputDir(core, undefined, LIVE_PATHS), "roms/doom", "its output is a GAME, placed by system");
  eq(outputSubdir(core, "fmv"), "", "and games do not nest");
  eq(converterOutputDir({ kind: "core", systems: [{ id: "doom" }], dataDir: "x" }, undefined, LIVE_PATHS),
    "roms/doom", "the post-rename spelling too -- isCoreKind, never a comparison");
});

check("place: dataDir survives the firmware renaming the homebrew role", () => {
  // Nothing here is a literal: the directory comes from the manifest's `paths`, the subfolder
  // from the project's manifest, and the two are composed rather than either being assumed.
  eq(converterOutputDir(OPENLARA, undefined, RENAMED_PATHS), "apps/hb/openlara", "renamed role, same subfolder");
  eq(assetPrefix("apps/hb/openlara", RENAMED_PATHS), "homebrew/openlara", "and the role key does not move");
  // The pre-manifest fallback nests homebrew UNDER roms, which is why the homebrew test has to
  // run before the ROMs one -- otherwise this keys `homebrew/openlara` as a ROMs system.
  eq(converterOutputDir(OPENLARA, undefined, DEFAULT_INSTALL_PATHS), "roms/homebrew/openlara", "fallback composes too");
  eq(assetPrefix("roms/homebrew/openlara", DEFAULT_INSTALL_PATHS), "homebrew/openlara", "and is not read as a system");
});

check("place: collision grouping follows the REAL destination, subdir included", async () => {
  // Two files of one name in two directories are two files on the card, so they must NOT be
  // refused; the same two in one directory must be. `planNames` groups by `dir`...
  eq(planNames([
    { dir: "homebrews/openlara", name: "TITLE.PKD", origin: "derived" },
    { dir: "homebrews/openlara/fmv", name: "TITLE.PKD", origin: "derived" },
  ]).collisions.length, 0, "different subdirs, two files");
  eq(planNames([
    { dir: "homebrews/openlara", name: "TITLE.PKD", origin: "derived" },
    { dir: "homebrews/openlara", name: "title.pkd", origin: "derived" },
  ]).collisions.length, 1, "one directory, and FAT cannot tell the two apart");

  // ...but that only helps if the CALLER hands it the subdir-aware directory, which grouping
  // `planNames` alone cannot prove. Driving the real host is what does: two outputs sharing
  // one fixed filename, split by `subdir`, must both survive. Passing `outDir` for both would
  // refuse the second as a name-collision.
  const twoOutputs = [
    { id: "lvl", filename: "DATA.PKD", maxBytes: 1 << 20 },
    { id: "cut", filename: "DATA.PKD", maxBytes: 1 << 20, subdir: "fmv" },
  ];
  const { title, wasm } = doomTitle({
    inputs: [{ ...wadInput(), variants: [] }],
    outputs: twoOutputs,
    target: { dataDir: "openlara" },
  });
  const res = await convertHomebrewTitle(
    title,
    [{ inputId: "wad", filename: "a.wad", bytes: new Uint8Array([1]) }],
    { spawnWorker: () => recordingWorker([], ["lvl", "cut"]), binaryDeps: binaryDepsFor(wasm) },
  );
  eq([...res.files.keys()].sort().join(" "), "DATA.PKD fmv/DATA.PKD",
    "both kept -- one name, two directories, two files");

  // And the same two WITHOUT the subdir really are one file, so the host must still refuse.
  const flat = doomTitle({
    inputs: [{ ...wadInput(), variants: [] }],
    outputs: twoOutputs.map((o) => ({ ...o, subdir: undefined })),
    target: { dataDir: "openlara" },
  });
  await refuses("name-collision", () =>
    convertHomebrewTitle(
      flat.title,
      [{ inputId: "wad", filename: "a.wad", bytes: new Uint8Array([1]) }],
      { spawnWorker: () => recordingWorker([], ["lvl", "cut"]), binaryDeps: binaryDepsFor(flat.wasm) },
    ),
  );
});

check("place: a converted file is keyed relative to its output directory", async () => {
  // End to end through the real converter host: the returned Map key is what the caller
  // prefixes, so a subdir has to be IN it or the file lands one level too high.
  const { title, wasm } = doomTitle({
    inputs: [{ ...wadInput(), variants: [] }],
    outputs: [{ id: "whd", extension: ".whd", maxBytes: 1 << 20, subdir: "fmv" }],
    target: { dataDir: "openlara" },
  });
  const res = await convertHomebrewTitle(
    title,
    [{ inputId: "wad", filename: "cut1.wad", bytes: new Uint8Array([1]) }],
    { spawnWorker: () => recordingWorker([], ["whd"]), binaryDeps: binaryDepsFor(wasm) },
  );
  eq([...res.files.keys()].join(" "), "fmv/cut1.whd", "relative to the converted-output directory");
  // Which composes with the caller's prefix into the one path `userDest` expands.
  eq(`${assetPrefix(converterOutputDir(title.target, undefined, LIVE_PATHS), LIVE_PATHS)}/fmv/cut1.whd`,
    "homebrew/openlara/fmv/cut1.whd", "the key prepareState builds");
});

check("place: useForTool finds the uses[] entry that carries the system", () => {
  const target = { uses: [{ tool: "a", outputs: [], required: true }, { tool: "b", outputs: [], required: true, system: "gbc" }] };
  eq(useForTool(target, "b").system, "gbc", "matched by tool id");
  eq(useForTool(target, "missing"), undefined, "and absent when the target does not use it");
  eq(useForTool({}, "a"), undefined, "a target with no uses[] at all");
});

// --- The refusal ---------------------------------------------------------------------------

check("perfile: a collision among ACCUMULATED outputs refuses the install", async () => {
  // Two WADs whose derived names fold together are one file on the card. The accumulation must
  // NOT be a Map written per run: that would silently keep the last and install two files as
  // one. Note the run itself succeeds — the refusal is about what may be WRITTEN.
  const bytesA = new Uint8Array([7, 7]);
  const bytesB = new Uint8Array([8, 8]);
  const { title, wasm } = doomTitle({
    inputs: [{ ...wadInput(), variants: [] }],
  });
  const seen = [];
  const err = await refuses("name-collision", () =>
    convertHomebrewTitle(
      title,
      [
        { inputId: "wad", filename: "doom.wad", bytes: bytesA },
        { inputId: "wad", filename: "DOOM.WAD", bytes: bytesB },
      ],
      { spawnWorker: () => recordingWorker(seen, ["whd"]), binaryDeps: binaryDepsFor(wasm) },
    ),
  );
  eq(seen.length, 2, "both runs happened; it is the WRITE that is refused");
  assert(err.detail.includes("doom.whd") && err.detail.includes("DOOM.whd"), `detail: ${err.detail}`);
  assert(err.detail.includes(homebrewDir()), "and it names the directory");
});

check("perfile: a derived name colliding with the title's own ARTIFACT refuses too", async () => {
  // A homebrew's converted output sits beside its binary, so the publisher's name and the
  // user's stem are in one directory and the publisher's wins (spec/05).
  const { title, wasm } = doomTitle({
    inputs: [{ ...wadInput(), variants: [] }],
    target: { artifacts: [{ filename: "DOOM.whd", bytes: 1, sha256: "b".repeat(64), url: "u" }] },
  });
  const err = await refuses("name-collision", () =>
    convertHomebrewTitle(title, [{ inputId: "wad", filename: "doom.wad", bytes: new Uint8Array([5]) }], {
      spawnWorker: () => recordingWorker([], ["whd"]),
      binaryDeps: binaryDepsFor(wasm),
    }),
  );
  eq(err.code, "name-collision", "refused");
  assert(err.detail.includes("artifact"), `the artifact is the one kept: ${err.detail}`);
});

check("perfile: maxCount refuses the whole flow before a single Worker is spawned", async () => {
  const { title, wasm } = doomTitle({ inputs: [wadInput({ maxCount: 2 })] });
  let spawns = 0;
  await refuses("input-too-many", () =>
    convertHomebrewTitle(
      title,
      [wadOffer("wad", "DOOM.WAD"), wadOffer("wad", "doom2.wad"), wadOffer("wad", "freedoom2.wad")],
      {
        spawnWorker: () => {
          spawns++;
          return recordingWorker([], ["whd"]);
        },
        binaryDeps: binaryDepsFor(wasm),
      },
    ),
  );
  eq(spawns, 0, "the run count is the file count, so the ceiling is checked BEFORE any run");
});

// --- The driving case, as one composite check ----------------------------------------------

check("perfile: THE DRIVING CASE — three WADs, three names, one directory, one emitted id", async () => {
  const { title, wasm } = doomTitle({ inputs: [wadInput()] });
  const seen = [];
  const res = await convertHomebrewTitle(
    title,
    [wadOffer("wad", "DOOM.WAD"), wadOffer("wad", "doom2.wad"), wadOffer("wad", "freedoom2.wad")],
    { spawnWorker: () => recordingWorker(seen, ["whd"]), binaryDeps: binaryDepsFor(wasm) },
  );

  // 1. One run per WAD, each carrying exactly its own file.
  eq(seen.length, 3, "three runs");
  eq(seen.map((r) => r.inputs[0].filename).join(" "), "DOOM.WAD doom2.wad freedoom2.wad", "one each");

  // 2. The module emitted the id "whd" all three times and never knew the difference.
  for (const req of seen) eq(req.outputs[0].id, "whd", "the manifest's output id, not a filename");

  // 3. Two matched variants take their canonical names; the third derives from its own stem.
  eq(
    [...res.files.keys()].join(" | "),
    "The Ultimate Doom.whd | Doom II - Hell on Earth.whd | freedoom2.whd",
    "canonical, canonical, derived",
  );

  // 4. freedoom2 matched nothing and was accepted under `strict: false` — and SAID SO.
  eq(res.unrecognised.join(" "), "freedoom2.wad", "the user must be told, it is not optional");

  // 5. All three land in one directory, and none of them collides there.
  const dir = converterOutputDir(title.target, useForTool(title.target, title.tool.id));
  eq(dir, homebrewDir(), "a homebrew's output sits beside its binary");
  eq(planNames([...res.files.keys()].map((n) => ({ dir, name: n, origin: "derived" }))).collisions.length,
    0, "three distinct names in one directory");
  // ...and were this a Doom CORE rather than a homebrew, the same three files would be games.
  eq(converterOutputDir({ kind: "emulator", systems: [{ id: "doom" }] }, undefined, LIVE_PATHS), "roms/doom",
    "the launcher cannot tell a converted .whd from one the user already had");
});


// ============================================================================================
// 22. The Configure page's BUILT-STATE LIST, and managing a file that is already supplied
// ============================================================================================
//
// Two regressions, one section, because they are the same complaint: the per-source Configure
// page stopped MANAGING a source's files.
//
//   - "What gets installed" (ReposDetailReady.dc.html) was deleted in cffb0d3 on the grounds
//     that the two newer Config artboards do not draw it. It is the only place the user is
//     told what an install actually writes, and it is now `sources/installRows.ts` — pure, so
//     this can pin it instead of it living unguardable inside a Svelte `$derived` again.
//   - The Additional-files picker was drawn only while a row was in state `add`, so a file,
//     once supplied, could never be changed. `rowOffersPicker` is that guard, and the check
//     below is armed with the satisfied states — the exact inputs that used to hide it.
//
// Every mutation named in the per-check comments was run against a throwaway copy and
// confirmed to turn the named check red.

const { composeInstallRows, installTotal } = await load("installRows.js");
const { rowOffersPicker, rowOffersRemove } = await load("fileRows.js");

/** A manifest target and manifest as the rule reads them: two shipped files, one converted. */
const INSTALL_TARGET = {
  artifacts: [
    { filename: "zelda3.bin", bytes: 262144 },
    { filename: "zelda3.ro", bytes: 1048576 },
  ],
  uses: [{ tool: "extract", outputs: ["assets"] }],
};
const INSTALL_MANIFEST = {
  tools: [
    {
      id: "extract",
      outputs: [
        { id: "assets", filename: "zelda3_assets.dat" },
        // Declared but NOT taken by the target's `uses[]`, so it must never appear.
        { id: "extra", filename: "zelda3_extra.dat" },
      ],
    },
  ],
};
const NOT_BUILT = () => undefined;

// --- 22a. Both halves of the plan, in install order ------------------------------------------
//
// Mutation: dropping the `uses[]` loop, or seeding the rows from `manifest.tools` instead of
// the target's `uses[]`, turns this check red.
check("install: shipped artifacts AND converted outputs, in that order", () => {
  const rows = composeInstallRows(INSTALL_TARGET, INSTALL_MANIFEST, NOT_BUILT);
  eq(rows.map((r) => r.filename).join(" "), "zelda3.bin zelda3.ro zelda3_assets.dat", "order");
  eq(rows.map((r) => r.type).join(" "), "binary data built", "the artboard's three chip words");
  // Armed against "list every output the tool declares": `extra` exists and is not asked for.
  assert(!rows.some((r) => r.filename === "zelda3_extra.dat"), "an output the target does not take");
});

// --- 22b. The built row is what the ReposDetail -> ReposDetailReady difference IS ------------
check("install: a converted output has no size until it is built, then it has a real one", () => {
  const before = composeInstallRows(INSTALL_TARGET, INSTALL_MANIFEST, NOT_BUILT);
  eq(before[2].bytes, undefined, "not built yet");
  eq(installTotal(before), null, "no Total while a row is unsized");

  const after = composeInstallRows(INSTALL_TARGET, INSTALL_MANIFEST, (f) =>
    f === "zelda3_assets.dat" ? 13000000 : undefined,
  );
  eq(after[2].bytes, 13000000, "the prepared bytes");
  eq(installTotal(after), 262144 + 1048576 + 13000000, "Total is every row, once every row has one");
});

// --- 22c. The list reflects what would ACTUALLY be installed, not the whole manifest ---------
//
// Untrusted third-party data: a `uses[]` naming a tool that is not there, or an output id the
// tool does not declare, contributes nothing rather than emptying the list or inventing a row.
check("install: an unknown tool or output id contributes nothing, and empties nothing", () => {
  const rows = composeInstallRows(
    {
      artifacts: [{ filename: "core.bin", bytes: 1024 }],
      uses: [
        { tool: "nope", outputs: ["assets"] },
        { tool: "extract", outputs: ["nope"] },
        { tool: "extract", outputs: ["assets"] },
      ],
    },
    INSTALL_MANIFEST,
    NOT_BUILT,
  );
  eq(rows.map((r) => r.filename).join(" "), "core.bin zelda3_assets.dat", "the two real ones");
  // And with nothing resolvable at all, the section has no rows rather than a bogus Total.
  eq(installTotal(composeInstallRows(undefined, INSTALL_MANIFEST, NOT_BUILT)), null, "no target");
  eq(installTotal(composeInstallRows(INSTALL_TARGET, undefined, NOT_BUILT)), null, "no manifest");
});

// --- 22d. An extension-only output has no name to promise ------------------------------------
//
// `filename` XOR `extension` (types.ts): an extension-only output is named per input file, off
// a stem the user brings. Mutation: emitting a row for it (under its id, or a placeholder)
// turns this red — and would put a filename on screen the manifest never stated.
check("install: an output declaring only an extension is not named before it exists", () => {
  const rows = composeInstallRows(
    { artifacts: [], uses: [{ tool: "conv", outputs: ["whd"] }] },
    { tools: [{ id: "conv", outputs: [{ id: "whd", extension: ".whd" }] }] },
    NOT_BUILT,
  );
  eq(rows.length, 0, "nothing claimed");
});

// --- 22e. A supplied file stays MANAGEABLE ----------------------------------------------------
//
// The regression this exists for: the picker used to be `state === "add"` only, so `ok` and
// `found` — the two satisfied states — hid the only control that can hand over a file, making
// the first choice permanent. Armed with exactly those two states.
//
// Mutation: `return _state === "add";` in `rowOffersPicker` turns this check red.
check("addfiles: the picker is offered in EVERY state, so a supplied file can be replaced", () => {
  for (const state of ["ok", "found", "add", null]) {
    assert(rowOffersPicker(state), `state ${state} must still offer the picker`);
  }
  // The two satisfied states are the point, said again in the rule's own vocabulary: a slot
  // whose hash matched, and a converter input the gate accepted, both still offer it.
  assert(rowOffersPicker(biosRowState(slot())), "a hash-matched BIOS slot");
  assert(rowOffersPicker(converterRowState(true)), "a supplied converter input");
});

// --- 22e-bis. ...and a supplied file can now be TAKEN BACK OUT --------------------------------
//
// The other half of the same complaint: a file could be supplied and replaced, but never
// removed, because no affordance existed. `SourcesFilesSupplied.dc.html` draws it, and
// `rowOffersRemove` is the rule — two conditions, and the second is the one that matters:
// `Remove` must never be offered for a file this app does not hold (a BIOS sitting on the
// device or in the user's folder scan), because the word would promise a deletion it will not
// perform.
//
// Mutation: `return removable;` (dropping the state test) or `return state !== "add";`
// (dropping the ownership test) turns this check red.
check("addfiles: Remove is offered only on a satisfied row whose file the host holds", () => {
  assert(rowOffersRemove("ok", true), "a hash-matched slot the user supplied");
  assert(rowOffersRemove("found", true), "a converter input the gate accepted");
  assert(!rowOffersRemove("add", true), "nothing to take out of a row still asking for a file");
  assert(!rowOffersRemove(null, true), "nor out of a row with no state at all");
  assert(!rowOffersRemove("ok", false), "a file on the device or in the folder scan is not ours");
  assert(!rowOffersRemove("found", false), "in either satisfied state");
});

// --- 22f. ...and the component actually uses the rule -----------------------------------------
//
// `rowOffersPicker` returning true is worth nothing if the template re-adds its own state
// guard beside it. This reads the component and refuses the shape the bug had.
check("addfiles: the component's picker guard is the rule, not a state test of its own", () => {
  const src = readFileSync(join(here, "../../ui/AdditionalFiles.svelte"), "utf8");
  assert(src.includes("rowOffersPicker(row.state)"), "the template must call the rule");
  // Same shape for the remove affordance, and the board's own two requirements: it is the
  // LAST of the three elements on the row (state, picker chip, then `Remove`) and it is plain
  // text, not a second chip. Mutation: putting `class="chip"` on it turns this red.
  assert(src.includes("rowOffersRemove(row.state, row.removable)"), "and the remove rule too");
  assert(
    src.indexOf("rowOffersRemove(row.state") > src.indexOf("t.additional.chooseFile"),
    "Remove is drawn after the picker chip (SourcesFilesSupplied.dc.html)",
  );
  const removeBlock = src.slice(src.indexOf("rowOffersRemove(row.state"), src.indexOf("{t.remove}"));
  assert(!removeBlock.includes('class="chip"'), "one boxed affordance per row, so Remove is not one");
  assert(removeBlock.includes('class="remove"'), "it is the plain-text control");
  assert(
    !/state === "add" && row\.(bios|converter)/.test(src),
    'the picker must not be gated on state === "add" again',
  );
});

// 16z. PLACEMENT. A prepared file is keyed by WHERE it installs, not by a hardcoded
// `homebrew/` prefix — `sources/placement.ts` has always known that a core's binary belongs in
// `cores/` and its converted output is a GAME in `roms/<system id>/`, but `run()` ignored it
// and filed everything under `homebrew/`. That is what kept a converted Doom WAD out of
// `roms/doom/`, and the keys below are exactly the ones `planFlashImage()`'s `userDest()` reads.
const coreTitle = () => ({
  key: "o/doom#gnw-retro-go",
  repo: "o/doom",
  targetId: "gnw-retro-go",
  label: "Doom",
  displayName: "doom",
  deviceFiles: ["doom.bin"],
  sourceExtensions: [".wad"],
  selfContained: false,
  promptsForInput: true,
  tool: { id: "conv", inputs: [{ id: "base", required: true, allowMultiple: true }], outputs: [], limits: {}, processor: {} },
  target: {
    id: "gnw-retro-go",
    kind: "emulator",
    systems: [{ id: "doom", longName: "Doom", extensions: [".whd"] }],
    uses: [{ tool: "conv", outputs: ["whd"], required: true }],
    artifacts: [{ filename: "doom.bin" }],
  },
});

pcheck("prepare: a core's prepared files are keyed by where they install", async () => {
  const t = coreTitle();
  globalThis.__prepFakes.artifacts = async () => new Map([["doom.bin", new Uint8Array([1])]]);
  globalThis.__prepFakes.convert = async () =>
    conversion([["The Ultimate Doom.whd", new Uint8Array([2])]]);

  eq(await prepareState.run(t, [offer("DOOM.WAD")]), true, "prepared");
  assert(prepareState.assets.has("cores/doom.bin"), "the core binary goes to cores/");
  assert(
    prepareState.assets.has("doom/The Ultimate Doom.whd"),
    "and the converted game to roms/<system id>/ — the key userDest() expands",
  );
  assert(!prepareState.assets.has("homebrew/doom.bin"), "NOT under homebrew/, which is a title's place");
  // The lookup helpers still answer by filename, wherever the file landed.
  assert(prepareState.has("doom.bin"), "has() finds it outside homebrew/ too");
  bytesEq(prepareState.get("The Ultimate Doom.whd"), new Uint8Array([2]), "and so does get()");
});

pcheck("prepare: a homebrew title's keys are unchanged", async () => {
  const t = prepTitle({ hasTool: false, artifacts: [{ filename: "engine.bin" }] });
  globalThis.__prepFakes.artifacts = async () => new Map([["engine.bin", new Uint8Array([1])]]);
  eq(await prepareState.run(t, []), true, "prepared");
  assert(prepareState.assets.has("homebrew/engine.bin"), "still homebrew/<filename>");
});

// 16y. DISCOVERY meets prepare. The picker is not asked for a file the app is already holding,
// and an empty offer runs on what discovery found — but a file the USER picked always wins.
const DISC_INPUT = {
  id: "base",
  required: true,
  allowMultiple: true,
  extensions: [".wad"],
  maxBytes: 1024,
  variants: [],
  strict: false,
};

pcheck("prepare: needsPrompt is false once discovery has answered every input", async () => {
  prepareState.discovered = new Map();
  const t = prepTitle({ inputs: [DISC_INPUT] });
  eq(prepareState.needsPrompt(t), true, "nothing found yet, so the picker is the only route");
  prepareState.setDiscovered(t.repo, "base", [offer("DOOM.WAD")]);
  eq(prepareState.isSatisfied(t.repo, "base"), true, "the row reads as satisfied");
  eq(prepareState.needsPrompt(t), false, "and the prompt no longer asks for a file we hold");
  prepareState.setDiscovered(t.repo, "base", []);
  eq(prepareState.needsPrompt(t), true, "a removed file puts the question back");
  eq(prepareState.isSatisfied(t.repo, "base"), false, "and nothing lingers as satisfied");
});

pcheck("prepare: an empty offer runs on the discovered files, and a picked file wins", async () => {
  prepareState.discovered = new Map();
  const t = prepTitle({ inputs: [DISC_INPUT], artifacts: [] });
  prepareState.setDiscovered(t.repo, "base", [offer("FOUND.WAD")], ["FOUND.WAD"]);
  let seen = null;
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async (_t, f) => {
    seen = f.map((x) => x.filename).join(",");
    return conversion([["out.whd", new Uint8Array([3])]]);
  };
  eq(await prepareState.run(t, []), true, "prepared without a picker");
  eq(seen, "FOUND.WAD", "the converter ran on what discovery found");
  assert(
    prepareState.noticesFor(t.key, "FOUND.WAD").join("\n").includes("UR|FOUND.WAD"),
    "and its strict:false warning still reached the user, under the file it was about",
  );

  seen = null;
  eq(await prepareState.run(t, [offer("PICKED.WAD")]), true, "prepared from the picker");
  eq(seen, "PICKED.WAD", "a file the user picked is never displaced by a discovered one");
});


// 16z. UN-SUPPLY. A user could supply a file and replace it, but never take it back out.
// `prepareState.unsupply()` is that inverse, and it is three facts at once (see its comment):
// the input stops being satisfied, everything DERIVED from it is dropped, and the removal is
// REMEMBERED so neither the next discovery pass nor the next reload undoes it.
//
// Every mutation named per check was run against the real source and confirmed red.

/** Clears the removal memory too — `pcheck` only resets the three older fields. */
function clearRemoved() {
  prepareState.removed = new Set();
  prepareState.discovered = new Map();
  globalThis.localStorage.removeItem("gnw.unsupplied.v1");
}

// Mutation: dropping the `supplied.delete(key)` line turns this red.
pcheck("unsupply: a supplied row returns to its unsatisfied state", async () => {
  clearRemoved();
  const t = prepTitle({ inputs: [DISC_INPUT], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () => conversion([["out.whd", new Uint8Array([3])]]);
  eq(await prepareState.run(t, [offer("PICKED.WAD")]), true, "prepared");
  eq(prepareState.hasSupplied(t.repo, "base"), true, "and the row reads satisfied");

  prepareState.unsupply(t.repo, "base", [t]);
  eq(prepareState.hasSupplied(t.repo, "base"), false, "the row is unsatisfied again");
  eq(prepareState.isSatisfied(t.repo, "base"), false, "by either route");
  eq(prepareState.needsPrompt(t), true, "so the picker is the route back in");
});

// Mutation: skipping the `assets.delete(assetKey)` loop (or clearing `supplied` only) turns
// this red — the converted `.whd` would still be sitting in the install with no input behind it.
pcheck("unsupply: removing an input drops what was converted FROM it", async () => {
  clearRemoved();
  const t = prepTitle({ inputs: [DISC_INPUT], artifacts: [{ filename: "engine.bin" }] });
  globalThis.__prepFakes.artifacts = async () => new Map([["engine.bin", new Uint8Array([1])]]);
  globalThis.__prepFakes.convert = async () => conversion([["out.whd", new Uint8Array([3])]]);
  eq(await prepareState.run(t, [offer("PICKED.WAD")]), true, "prepared");
  eq(prepareState.assets.size, 2, "artifact + converted output");

  prepareState.unsupply(t.repo, "base", [t]);
  assert(!prepareState.has("out.whd"), "the derived output cannot be reproduced, so it goes");
  assert(!prepareState.has("engine.bin"), "and the rest of the title's set with it");
  eq(prepareState.assets.size, 0, "nothing half-prepared is left looking installable");
});

// Mutation: dropping the `if (title.repo !== repo)`/input-id guards turns this red.
pcheck("unsupply: another title's prepared files are left alone", async () => {
  clearRemoved();
  const mine = prepTitle({ inputs: [DISC_INPUT], artifacts: [], repo: "o/mine" });
  const other = prepTitle({ hasTool: false, artifacts: [{ filename: "engine.bin" }], repo: "o/other" });
  // NB: the real `fetchTargetArtifacts` takes the TARGET, not the title.
  globalThis.__prepFakes.artifacts = async (target) =>
    target.artifacts.length > 0 ? new Map([["engine.bin", new Uint8Array([1])]]) : new Map();
  globalThis.__prepFakes.convert = async () => conversion([["out.whd", new Uint8Array([3])]]);
  eq(await prepareState.run(mine, [offer("PICKED.WAD")]), true, "mine prepared");
  eq(await prepareState.run(other, []), true, "the other prepared");

  prepareState.unsupply("o/mine", "base", [mine, other]);
  assert(!prepareState.has("out.whd"), "mine is gone");
  assert(prepareState.has("engine.bin"), "and a title that never used that input is untouched");
});

// THE SUBTLE ONE. Discovery re-answers from the user's folders every time its signature moves,
// so without a memory of the removal the row would be satisfied again on the very next pass and
// `Remove` would read as a no-op.
//
// Mutation: deleting the `if (this.removed.has(key) && files.length > 0) return;` guard in
// `setDiscovered` turns this red.
pcheck("unsupply: a removed auto-discovered file does not come back on the next scan", async () => {
  clearRemoved();
  const t = prepTitle({ inputs: [DISC_INPUT] });
  prepareState.setDiscovered(t.repo, "base", [offer("DOOM.WAD")]);
  eq(prepareState.isSatisfied(t.repo, "base"), true, "discovery answered it");

  prepareState.unsupply(t.repo, "base", [t]);
  eq(prepareState.isRemoved(t.repo, "base"), true, "the removal is remembered");
  // Exactly what `discoverForSource` does on its next pass: write the full current answer.
  prepareState.setDiscovered(t.repo, "base", [offer("DOOM.WAD")]);
  eq(prepareState.isSatisfied(t.repo, "base"), false, "the folder still holds it; the row does not");
  eq(prepareState.discoveredFor(t.repo, "base").length, 0, "and nothing is held for it");
});

// ...but the removal is not a life sentence: answering the input again is the way back.
// Mutation: dropping `run()`'s `removed.delete(...)` loop turns this red.
pcheck("unsupply: picking a file again lifts the removal", async () => {
  clearRemoved();
  const t = prepTitle({ inputs: [DISC_INPUT], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () => conversion([["out.whd", new Uint8Array([3])]]);
  prepareState.unsupply(t.repo, "base", [t]);
  eq(await prepareState.run(t, [offer("PICKED.WAD")]), true, "the picker still works");
  eq(prepareState.isRemoved(t.repo, "base"), false, "and the removal is lifted");
  prepareState.setDiscovered(t.repo, "base", [offer("DOOM.WAD")]);
  eq(prepareState.discoveredFor(t.repo, "base").length, 1, "so discovery is heard again");
});

// PERSISTENCE. `restore()` puts back what an earlier session converted, from a localStorage
// pointer written BEFORE the removal. A removal that lived only in memory would therefore be
// undone by the next reload — the same bug, one pass later.
//
// Mutation: deleting the `t.inputs.some((id) => this.removed.has(...)) continue;` line in
// `restore()` turns this red.
pcheck("unsupply: a reload does not restore what was removed", async () => {
  clearRemoved();
  const t = prepTitle({ inputs: [DISC_INPUT], artifacts: [] });
  t.tool.binary = { sha256: "aa" };
  // The on-disk pointer for a previous session's conversion, and its blob cache.
  const index = {
    get: (k) => (k === t.key ? entry : null),
    set: () => {},
    entries: () => [[t.key, entry]],
  };
  const entry = {
    sig: "s",
    tool: "aa",
    repo: t.repo,
    inputs: ["base"],
    files: { "out.whd": "h1" },
    warnings: [],
    unrecognised: [],
  };
  const cache = { get: async (h) => (h === "h1" ? new Uint8Array([3]) : null) };

  // Control: with no removal recorded, this pointer really does restore.
  prepareState.restored = false;
  await prepareState.restore([t], { index, cache });
  assert(prepareState.has("out.whd"), "control: the cache pointer restores a converted output");

  prepareState.assets = new Map();
  prepareState.supplied = new Map();
  prepareState.unsupply(t.repo, "base", [t]);
  prepareState.restored = false; // what a reload is: a fresh session reading the same pointer
  await prepareState.restore([t], { index, cache });
  assert(!prepareState.has("out.whd"), "the removed input's output stays gone across the reload");
  eq(prepareState.hasSupplied(t.repo, "base"), false, "and it is not re-marked as supplied");
});

// 16j. PER-FILE PREPARE. `runPerFile` means the Library prepares ONE game per press, and two
// facts have to follow the file rather than the title: which row reads as busy, and which
// asset keys the title is on the hook for. Both were per-title, so pressing Prepare on
// `DOOM.WAD` made `doom2.wad`'s row say "extracting…" and then made `unsupply` orphan whichever
// game was not prepared last.

pcheck("prepare: a scoped run marks only ITS file busy, never the whole core", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  let release;
  const held = new Promise((r) => (release = r));
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () => {
    await held;
    return conversion([["The Ultimate Doom.whd", new Uint8Array([1])]]);
  };

  const run = prepareState.run(t, [offer("DOOM.WAD")]);
  await Promise.resolve();
  assert(prepareState.isExtractingFile(t.key, "DOOM.WAD"), "the pressed row is busy");
  assert(
    !prepareState.isExtractingFile(t.key, "doom2.wad"),
    "THE OWNER'S REPORT: its sibling is NOT — one press must not light up both entries",
  );
  release();
  await run;
  assert(!prepareState.isExtractingFile(t.key, "DOOM.WAD"), "and it clears when the run ends");
});

pcheck("prepare: a whole-title run (no offer) still reports every row busy", async () => {
  // The Configure page's prepare-all offers nothing and converts everything discovery found,
  // so every row of that title genuinely IS busy — the per-file answer must fall back to it.
  const t = prepTitle({ hasTool: false, artifacts: [ART] });
  let release;
  const held = new Promise((r) => (release = r));
  globalThis.__prepFakes.artifacts = async () => {
    await held;
    return new Map([["engine.bin", new Uint8Array([1])]]);
  };

  const run = prepareState.run(t, []);
  await Promise.resolve();
  assert(prepareState.isExtractingFile(t.key, "anything.wad"), "no per-file record means all of it");
  release();
  await run;
  assert(!prepareState.isExtractingFile(t.key, "anything.wad"), "cleared when it finishes");
});

pcheck("prepare: two scoped runs accumulate — the second does not orphan the first", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();

  globalThis.__prepFakes.convert = async () => conversion([["one.whd", new Uint8Array([1])]]);
  eq(await prepareState.run(t, [offer("DOOM.WAD")]), true, "first game prepared");
  globalThis.__prepFakes.convert = async () => conversion([["two.whd", new Uint8Array([2])]]);
  eq(await prepareState.run(t, [offer("doom2.wad")]), true, "second game prepared");

  assert(prepareState.has("one.whd"), "both outputs are held");
  assert(prepareState.has("two.whd"), "…including the one prepared first");

  // `produced` is provenance, and `unsupply` is the only thing that reads it. If the second run
  // REPLACED it, the first game's bytes would stay in `assets` with nothing accounting for them.
  prepareState.unsupply(t.repo, "base", [t]);
  assert(!prepareState.has("one.whd"), "removing the input drops the FIRST game's output too");
  assert(!prepareState.has("two.whd"), "and the second's");
  eq(prepareState.assets.size, 0, "nothing orphaned in the install");
});

pcheck("prepare: one file failing leaves an already-prepared sibling alone", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () => conversion([["one.whd", new Uint8Array([1])]]);
  eq(await prepareState.run(t, [offer("DOOM.WAD")]), true, "the first one worked");

  globalThis.__prepFakes.convert = async () => {
    throw new PrepConverterError("worker-failed");
  };
  eq(await prepareState.run(t, [offer("doom2.wad")]), false, "the second blew up");
  assert(prepareState.has("one.whd"), "which says nothing about the game already prepared");
  assert(!prepareState.isExtractingFile(t.key, "doom2.wad"), "and the failed row is not left spinning");
});

// 16h. THE OWNER'S REPORT. `Error: cropped 11 widescreen lumps to 320w: HELP1(560x200) ...`
// appeared under EVERY homebrew app on the Library page. Two separate faults in one line
// (`if (notices.length > 0) this.error = notices.join("\n")`): a converter's warnings are what
// a SUCCESSFUL run says, and they were held in a single store-wide slot that every row read.
pcheck("notices: a run that only warns SUCCEEDS and is not a failure", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () =>
    conversion([["The Ultimate Doom.whd", new Uint8Array([1])]], [], ["cropped 11 widescreen lumps"]);

  eq(await prepareState.run(t, [offer("DOOM.WAD")]), true, "the run succeeded");
  eq(prepareState.failureFor(t.key, "DOOM.WAD"), undefined, "a warning is NOT a failure");
  assert(
    prepareState.noticesFor(t.key, "DOOM.WAD").join("\n").includes("cropped 11 widescreen lumps"),
    "the module's own words still reach the user — they are its only voice",
  );
});

pcheck("notices: a warning belongs to the row that produced it, and to no sibling", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () =>
    conversion([["one.whd", new Uint8Array([1])]], [], ["cropped 11 widescreen lumps"]);
  eq(await prepareState.run(t, [offer("DOOM.WAD")]), true, "the first game prepared");

  eq(prepareState.noticesFor(t.key, "DOOM.WAD").length, 1, "its own row carries the note");
  // THE SYMPTOM: this row never ran a converter, and used to show the same line anyway.
  eq(prepareState.noticesFor(t.key, "doom2.wad").length, 0, "its sibling shows nothing");
  eq(prepareState.noticesFor("other/repo#t").length, 0, "and neither does another title entirely");
});

pcheck("notices: preparing a second game neither moves nor duplicates the first's note", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () =>
    conversion([["one.whd", new Uint8Array([1])]], [], ["cropped 11 widescreen lumps"]);
  eq(await prepareState.run(t, [offer("DOOM.WAD")]), true, "first prepared");

  globalThis.__prepFakes.convert = async () => conversion([["two.whd", new Uint8Array([2])]]);
  eq(await prepareState.run(t, [offer("doom2.wad")]), true, "second prepared, silently");

  eq(prepareState.noticesFor(t.key, "DOOM.WAD").length, 1, "the first note survived, once");
  eq(prepareState.noticesFor(t.key, "doom2.wad").length, 0, "and did not follow the second run");
  eq(prepareState.noticesFor(t.key, "one.whd").length, 0, "and does not leak onto an output name");
});

pcheck("notices: a real failure is still a failure, and clears on a clean retry", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () => {
    throw new PrepConverterError("worker-failed");
  };
  eq(await prepareState.run(t, [offer("DOOM.WAD")]), false, "it failed");
  eq(prepareState.failureFor(t.key, "DOOM.WAD"), "PT|interrupted", "and says so as a failure");
  eq(lastLoggedCode(), "worker-failed", "with the code in the log");
  eq(prepareState.noticesFor(t.key, "DOOM.WAD").length, 0, "not as a notice");

  globalThis.__prepFakes.convert = async () => conversion([["one.whd", new Uint8Array([1])]]);
  eq(await prepareState.run(t, [offer("DOOM.WAD")]), true, "the retry worked");
  eq(prepareState.failureFor(t.key, "DOOM.WAD"), undefined, "and the old failure is gone");
});

pcheck("notices: a strict:false file is reported, as a notice and not as an error", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () =>
    conversion([["freedoom2.whd", new Uint8Array([1])]], ["freedoom2.wad"]);

  eq(await prepareState.run(t, [offer("freedoom2.wad")]), true, "accepted under strict:false");
  const notes = prepareState.noticesFor(t.key, "freedoom2.wad").join("\n");
  assert(notes.includes("UR|freedoom2.wad"), "spec/03 requires the user to be told it was used");
  eq(prepareState.failureFor(t.key, "freedoom2.wad"), undefined, "but using it is not an error");
});

pcheck("notices: a discovery-fed run still files under the FILE discovery found", async () => {
  // An empty offer is not automatically a whole-title run: `run()` substitutes what discovery
  // found BEFORE deciding the keys, so the note lands on that file's row, not on all of them.
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () =>
    conversion([["zelda3_assets.dat", new Uint8Array([1])]], [], ["patched 3 lumps"]);
  prepareState.setDiscovered(t.repo, "base", [offer("zelda3.sfc")]);

  eq(await prepareState.run(t, []), true, "prepared from what discovery found");
  assert(
    prepareState.noticesFor(t.key, "zelda3.sfc").join("\n").includes("patched 3 lumps"),
    "the row that names that file reads it",
  );
  eq(prepareState.noticesFor(t.key, "other.sfc").length, 0, "and a row naming another does not");
});

pcheck("notices: a title-level verdict is read by every row of that title", async () => {
  // A run with genuinely nothing to blame — an artifacts-only title, no converter, no offer —
  // files under the title, and `noticesFor`/`failureFor` fall back to it whatever file a row
  // asks with. That fallback is what lets a homebrew pseudo-row (which has no filename at all)
  // read its own verdict.
  const t = prepTitle({ hasTool: false, artifacts: [ART] });
  globalThis.__prepFakes.artifacts = async () => {
    throw new PrepSourceError("malformed", "x");
  };
  eq(await prepareState.run(t, []), false, "the artifact fetch failed");
  eq(prepareState.failureFor(t.key), "PT|unreadable", "filed under the title");
  eq(prepareState.failureFor(t.key, "anything.wad"), "PT|unreadable", "and any row of it reads it");
});

pcheck("prepare: preparedSize answers per system, out of the asset store", async () => {
  const t = prepTitle({ inputs: [inputSpec("base", true)], artifacts: [] });
  globalThis.__prepFakes.artifacts = async () => new Map();
  globalThis.__prepFakes.convert = async () =>
    conversion([["The Ultimate Doom.whd", new Uint8Array([1, 2, 3])]]);
  eq(await prepareState.run(t, [offer("DOOM.WAD")]), true, "prepared");

  // `assetPrefix()` turns `roms/doom` into `doom`; a homebrew title's key stays `homebrew`.
  const [key] = [...prepareState.assets.keys()];
  const dir = key.slice(0, key.indexOf("/"));
  eq(prepareState.preparedSize(dir, "The Ultimate Doom.whd"), 3, "the row learns the output's weight");
  eq(prepareState.preparedSize("other", "The Ultimate Doom.whd"), undefined, "and only for ITS console");
  eq(prepareState.preparedSize(dir, "nope.whd"), undefined, "an unprepared name has no size");
});

// ============================================================================================
// 17. Automatic discovery of a converter input from the user's own folders
// ============================================================================================
//
// The owner: "They should be recognized automatically. I've added my rom folder that has
// doom/*.wad and I also added doom as a dedicated source folder. it doesn't make sense."
//
// The fixture is the LIVE DOOM manifest's input shape — `.wad`, `runPerFile`, `allowMultiple`,
// `maxCount: 32`, `strict: false`, four variants each with `sha1` + `bytes` + a canonical
// `filename` — narrowed by the REAL `parseToolInputs`, so a change to the narrowing breaks
// these too. Only the digests and lengths are the fixtures' own; they cannot be the published
// ones without shipping the WADs.
//
// The check that matters most is the COST one. `libraryScan.ts` hashes zero files on a clean
// scan and this must not undo that from a different direction, so the hash count is asserted
// as a NUMBER, not as "few".

const wad = (n, fill) => new Uint8Array(n).fill(fill);

const ULTIMATE = wad(1200, 1);
const UNITY = wad(1270, 4);
const DOOM2 = wad(1400, 2);
const SHAREWARE = wad(400, 3);
/** Matches no variant, and its length matches none either. `strict: false` still takes it. */
const FREEDOOM = wad(999, 5);
/** A wad that is exactly DOOM II's published LENGTH and none of its bytes: the one file the
 *  size test cannot eliminate, so it is the second (and last) thing hashed. */
const IMPOSTOR = wad(1400, 6);

function doomToolRaw(over = {}) {
  return {
    id: "doom-whd",
    processor: { type: "wasm", version: 1 },
    // The live manifest's `binary` block, shaped as `prepareTool` requires it (url/bytes/sha256).
    binary: { file: "doom_whd.wasm", url: "doom_whd.wasm", bytes: 678369, sha256: "1e".repeat(32) },
    limits: { maxMemoryPages: 8192, maxOutputBytes: 25165824 },
    inputs: [
      {
        id: "base",
        required: true,
        allowMultiple: true,
        runPerFile: true,
        maxCount: 32,
        label: { en: "Doom WAD" },
        extensions: [".wad"],
        maxBytes: 67108864,
        strict: false,
        variants: [
          { id: "ultimate", sha1: sha1Of(ULTIMATE), bytes: ULTIMATE.length, filename: "The Ultimate Doom.whd" },
          { id: "ultimate-unity", sha1: sha1Of(UNITY), bytes: UNITY.length, filename: "The Ultimate Doom - Unity.whd" },
          { id: "doom2", sha1: sha1Of(DOOM2), bytes: DOOM2.length, filename: "Doom II - Hell on Earth.whd" },
          { id: "shareware", sha1: sha1Of(SHAREWARE), bytes: SHAREWARE.length, filename: "Doom - Shareware.whd" },
        ],
        ...over,
      },
    ],
    outputs: [{ id: "whd", extension: ".whd", maxBytes: 25165824 }],
  };
}

const doomInput = (over) => parseToolInputs(doomToolRaw(over))[0];
const WHD_SPEC = { id: "whd", extension: ".whd", maxBytes: 25165824 };

/** A candidate whose bytes are already in memory — the library-scan case. */
const cand = (path, bytes, folderId = "roms1") => ({
  path,
  folderId,
  size: bytes.length,
  read: async () => bytes,
});

/** A thousand ROMs that are not WADs. The library the cost rule exists to protect. */
function bigLibrary(n = 1000) {
  const exts = [".nes", ".gb", ".gbc", ".sfc", ".md", ".png"];
  const out = [];
  for (let i = 0; i < n; i++) {
    const ext = exts[i % exts.length];
    out.push(cand(`sys${i % 6}/game${i}${ext}`, wad(64 + (i % 7), i & 0xff)));
  }
  return out;
}

/** Counts every hash the discovery actually performs. */
function counting() {
  const d = {
    n: 0,
    hash: async (b) => {
      d.n++;
      return sha1Hex(b);
    },
  };
  return d;
}

check("discovery: a .wad already in a registered folder satisfies `base` with no picker", async () => {
  const deps = counting();
  const d = await discoverInput(doomInput(), [...bigLibrary(20), cand("doom/DOOM.WAD", ULTIMATE)], deps);
  eq(d.files.length, 1, "one file offered");
  eq(d.files[0].inputId, "base", "bound to the input it was found for");
  eq(d.found[0].match, "variant", "hashes first: this is a variant match, not a name one");
  eq(d.found[0].variantId, "ultimate", "the variant it matched");
  eq(d.found[0].variantFilename, "The Ultimate Doom.whd", "the canonical name the gate carries");
  eq(d.unrecognised.length, 0, "nothing to warn about");
  // ...and that name is what the output actually takes.
  eq(
    resolveOutputName(WHD_SPEC, { recognised: true, variantFilename: d.found[0].variantFilename, filename: "DOOM.WAD" }),
    "The Ultimate Doom.whd",
    "rule 1 of the derived-name resolution",
  );
});

check("discovery: an unrecognised .wad is still accepted under strict:false, and derives its name", async () => {
  const deps = counting();
  const d = await discoverInput(doomInput(), [cand("doom/freedoom2.wad", FREEDOOM)], deps);
  eq(d.files.length, 1, "accepted, not silently dropped");
  eq(d.found[0].match, "extension", "the weak match, since nothing hashed");
  eq(d.unrecognised[0], "freedoom2.wad", "and the user is told, as spec/03 requires");
  eq(deps.n, 0, "its length matches no published variant, so it was never hashed");
  eq(
    resolveOutputName(WHD_SPEC, { recognised: false, filename: "freedoom2.wad" }),
    "freedoom2.whd",
    "rule 2: the file's own stem, with the declared extension forced",
  );
});

check("discovery: strict:true refuses what it cannot recognise rather than offering it", async () => {
  const deps = counting();
  const d = await discoverInput(doomInput({ strict: true }), [cand("doom/freedoom2.wad", FREEDOOM)], deps);
  eq(d.files.length, 0, "a strict input takes variants and nothing else");
});

check("discovery: a clean 1000-ROM library with no candidate hashes NOTHING", async () => {
  const deps = counting();
  const d = await discoverInput(doomInput(), bigLibrary(1000), deps);
  eq(d.files.length, 0, "nothing found");
  eq(deps.n, 0, "and not one file was hashed — the whole point of the ordering");
});

check("discovery: hashing is bounded by the SIZE-plausible candidates, not by the library", async () => {
  const deps = counting();
  const candidates = [
    ...bigLibrary(1000),
    cand("doom/DOOM.WAD", ULTIMATE), // a published length AND a published hash
    cand("doom/freedoom2.wad", FREEDOOM), // no published length: never hashed
    cand("doom/mystery.wad", IMPOSTOR), // a published length, a different file: hashed, no match
  ];
  const d = await discoverInput(doomInput(), candidates, deps);
  eq(deps.n, 2, "exactly the two size-plausible WADs; 1000 ROMs and one odd-sized WAD cost nothing");
  eq(d.files.length, 3, "all three WADs are offered — strict:false takes the two it did not know");
  eq(d.found[0].match, "variant", "the recognised one is ordered first");
  eq(d.found.filter((f) => f.match === "variant").length, 1, "and it is the only strong match");
  eq(d.unrecognised.length, 2, "the other two are reported as unrecognised");
});

check("discovery: an input declaring no extensions is not auto-discovered at all", async () => {
  const deps = counting();
  const d = await discoverInput(doomInput({ extensions: [] }), [cand("doom/DOOM.WAD", ULTIMATE)], deps);
  eq(d.files.length, 0, "no cheap narrowing available, so nothing is offered");
  eq(deps.n, 0, "and nothing is hashed — this is the hash-everything trap");
});

check("discovery: a file added later is picked up, and one removed stops satisfying", async () => {
  const input = doomInput();
  const before = await discoverInput(input, bigLibrary(10), counting());
  eq(before.files.length, 0, "nothing there yet");
  const after = await discoverInput(input, [...bigLibrary(10), cand("doom/DOOM.WAD", ULTIMATE)], counting());
  eq(after.files.length, 1, "the WAD the user dropped in is found on the next pass");
  const gone = await discoverInput(input, bigLibrary(10), counting());
  eq(gone.files.length, 0, "and removing it stops satisfying the input — nothing lingers");
});

check("discovery: maxCount 32 is enforced before anything is offered", async () => {
  const many = [];
  for (let i = 0; i < 40; i++) many.push(cand(`doom/pack${i}.wad`, wad(700 + i, i)));
  const d = await discoverInput(doomInput(), many, counting());
  eq(d.files.length, 32, "the manifest's ceiling, applied here as well as in the gate");
  eq(capacityOf(doomInput()), 32, "capacity is the manifest's number, not a local guess");
  eq(capacityOf({ allowMultiple: false }), 1, "a single-file slot takes exactly one");
});

check("discovery: the same dump found in two folders is one input, not two runs", async () => {
  const d = await discoverInput(
    doomInput(),
    [cand("doom/DOOM.WAD", ULTIMATE, "roms1"), cand("wads/doom.wad", ULTIMATE, "hb1")],
    counting(),
  );
  eq(d.files.length, 1, "one variant, one file");
  eq(d.found[0].folderId, "roms1", "the first folder in scan order wins");
});

check("discovery: a name that looks like a variant outranks a bare extension match", async () => {
  // Neither hashes to anything (both are unpublished lengths), so the ONLY thing separating
  // them is the filename — the owner's "hashes first and then filenames", second half.
  const d = await discoverInput(
    doomInput(),
    [cand("doom/zzz-random.wad", wad(701, 8)), cand("doom/Doom II - Hell on Earth.wad", wad(702, 9))],
    counting(),
  );
  eq(d.found[0].match, "name", "the variant-named file is ordered first");
  eq(d.found[1].match, "extension", "the anonymous one after it");
});

check("discovery: the two narrowing steps, directly", () => {
  const input = doomInput();
  const all = [cand("a/x.wad", ULTIMATE), cand("a/y.nes", wad(10, 1)), cand("a/z.WAD", FREEDOOM)];
  eq(extensionCandidates(input, all).length, 2, "case-folded extension match, .nes dropped");
  eq(sizePlausible(input.variants, extensionCandidates(input, all)).length, 1, "only a published length");
  eq(sizePlausible([], all).length, 0, "no variants means nothing to hash against");
  eq(
    sizePlausible([{ id: "v", sha1: "0".repeat(40) }], all).length,
    3,
    "a variant with no `bytes` eliminates nothing, so everything stays plausible",
  );
  eq(declaredExtensions([input]).join(","), ".wad", "what a folder walk should look for");
});

check("discovery: which folders are searched — usedBy narrows, kind does not, status gates", () => {
  const rows = [
    { id: "roms-any", kind: "roms", status: "ready", usedBy: [], handle: {} },
    { id: "hb-dedicated", kind: "homebrew", status: "ready", usedBy: ["o/doom#t"], handle: {} },
    { id: "hb-other", kind: "homebrew", status: "ready", usedBy: ["o/zelda#t"], handle: {} },
    { id: "roms-locked", kind: "roms", status: "needs-permission", usedBy: [], handle: {} },
    { id: "roms-gone", kind: "roms", status: "missing", usedBy: [], handle: null },
  ];
  const got = foldersToSearch(rows, ["o/doom#t"]).map((f) => f.id);
  eq(got.join(","), "roms-any,hb-dedicated", "the general ROM folder AND the dedicated one");
  eq(
    foldersToSearch(rows, []).map((f) => f.id).join(","),
    "roms-any",
    "with no target context, only the permissive 'Any' folders",
  );
});

check("discovery: library candidates cost nothing and respect the folder narrowing", async () => {
  const files = new Map([
    ["doom/DOOM.WAD", ULTIMATE],
    ["doom/other.wad", FREEDOOM],
  ]);
  const origin = new Map([
    ["doom/DOOM.WAD", "roms-any"],
    ["doom/other.wad", "not-allowed"],
  ]);
  const got = libraryCandidates(files, origin, new Set(["roms-any"]), (k) => k);
  eq(got.length, 1, "a file from a folder narrowed away from this target is not a candidate");
  eq(got[0].size, ULTIMATE.length, "size without reading");
  bytesEq(await got[0].read(), ULTIMATE, "and the bytes are already in memory");
});

check("discovery: walking a folder nothing else walks reads no file content", async () => {
  let reads = 0;
  const file = (bytes) => ({
    kind: "file",
    getFile: async () => ({
      size: bytes.length,
      arrayBuffer: async () => {
        reads++;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    }),
  });
  const dir = (entries) => ({
    kind: "directory",
    entries: async function* () {
      for (const e of entries) yield e;
    },
  });
  const handle = dir([
    ["DOOM.WAD", file(ULTIMATE)],
    ["readme.txt", file(wad(4, 1))],
    [".hidden.wad", file(wad(4, 1))],
    ["sub", dir([["DOOM2.WAD", file(DOOM2)]])],
  ]);
  const got = await folderCandidates(handle, "hb1", [".wad"]);
  eq(got.map((c) => c.path).join(","), "DOOM.WAD,sub/DOOM2.WAD", "extension-filtered, recursive, no dotfiles");
  eq(reads, 0, "and NOTHING was read to produce that list");
  bytesEq(await got[0].read(), ULTIMATE, "bytes arrive only when asked for");
  eq(reads, 1, "once");
  await got[0].read();
  eq(reads, 1, "and memoised, so the hash pass and the offer do not read twice");
});

check("discovery: several inputs are answered independently", async () => {
  const inputs = [doomInput(), doomInput({ ...{} })];
  inputs[1] = { ...inputs[1], id: "second" };
  const ds = await discoverInputs(inputs, [cand("doom/DOOM.WAD", ULTIMATE)], counting());
  eq(ds.length, 2, "one result per input");
  eq(ds[0].files[0].inputId, "base", "each file is bound to its own input");
  eq(ds[1].files[0].inputId, "second", "including the second slot");
});

// 17b. THE OWNER'S ZELDA 3 CASE — one registered folder, inputs in TWO subdirectories
// --------------------------------------------------------------------------------------------
// Verbatim: "I've added the french and german zelda3 roms into my homebrew folder in
// roms/snes/ and the ntsc-u zelda3 lives in roms/homebrew/ ... Since originalSystem is snes,
// having the two localized ROMs in snes should work just as well. bringing all three in from
// both locations should just work."
//
// zelda3 v0.3.0's REAL shape, which differs from Doom's in three ways that all matter here:
//   - TWO inputs sharing one extension set (`.sfc`/`.smc`), so a file cannot be attributed by
//     extension — only a hash can say whether a ROM is the base or a translation;
//   - variants publish `sha1` ONLY — no `bytes`, no `filename` — so the size narrowing has
//     nothing to eliminate with and every `.sfc` in range is hashed (see `sizePlausible`);
//   - `strict: true` on both, so a file matching no variant is never offered.
// Real sha1s are UPPERCASE in the manifest and lowercased by `parseToolInputs`.
const Z_BASE = wad(1024, 0x5a); // stands in for the NTSC-U dump
const Z_FR = wad(1024, 0x66);
const Z_DE = wad(1024, 0x77);
const Z_SMW = wad(512, 0x11); // a .sfc in the same folder that is NOT a zelda3 ROM

function zelda3ToolRaw(over = {}) {
  const shared = {
    extensions: [".sfc", ".smc"],
    maxBytes: 8388608,
    strict: true,
  };
  return {
    id: "zelda3-assets",
    processor: { type: "wasm", version: 1 },
    binary: { file: "zelda3_restool.wasm", url: "zelda3_restool.wasm", bytes: 254770, sha256: "a".repeat(64) },
    limits: { maxMemoryPages: 1024, maxOutputBytes: 67108864 },
    options: [],
    inputs: [
      {
        id: "base",
        required: true,
        allowMultiple: false,
        ...shared,
        // No `bytes`, no `filename` — exactly as zelda3 publishes.
        variants: [{ id: "us", sha1: sha1Of(Z_BASE).toUpperCase() }],
        ...(over.base ?? {}),
      },
      {
        id: "language",
        required: false,
        allowMultiple: true,
        ...shared,
        variants: [
          { id: "de", sha1: sha1Of(Z_DE).toUpperCase() },
          { id: "fr", sha1: sha1Of(Z_FR).toUpperCase() },
          { id: "es", sha1: "3".repeat(40) },
          { id: "pl", sha1: "4".repeat(40) },
        ],
        ...(over.language ?? {}),
      },
    ],
    outputs: [{ id: "assets", filename: "zelda3_assets.dat", maxBytes: 1572864 }],
  };
}

const zelda3Inputs = (over) => parseToolInputs(zelda3ToolRaw(over));

/** The owner's shelf: one registered folder, three zelda3 ROMs across two subdirectories. */
const ownersShelf = () => [
  cand("homebrew/zelda3.sfc", Z_BASE, "roms-any"),
  cand("homebrew/smw.sfc", Z_SMW, "roms-any"),
  cand("snes/Legend of Zelda, The - A Link to the Past (France).sfc", Z_FR, "roms-any"),
  cand("snes/Legend of Zelda, The - A Link to the Past (Germany).sfc", Z_DE, "roms-any"),
];

// The same shelf, but with the tool declared EXACTLY as zelda3 v0.3.0 publishes it today: the
// pre-`4eb5a86` `repeatable`, no `allowMultiple`. Before `allowMultipleOf`, `parseToolInputs`
// threw on this and the owner saw "could not be read" with no rows and no prompt. This is the
// live blocker, end to end — delete it only when zelda3 has republished AND the shim is gone.
check("zelda3: the owner's shelf works against the manifest AS PUBLISHED (repeatable)", async () => {
  const published = zelda3ToolRaw();
  for (const i of published.inputs) {
    i.repeatable = i.allowMultiple;
    delete i.allowMultiple;
  }
  assert(
    published.inputs.every((i) => i.allowMultiple === undefined && typeof i.repeatable === "boolean"),
    "the fixture really is the old shape",
  );

  const specs = parseToolInputs(published);
  eq(specs[0].allowMultiple, false, "base parses as single-file");
  eq(specs[1].allowMultiple, true, "language parses as repeatable");

  const ds = await discoverInputs(specs, ownersShelf(), counting());
  const base = ds.find((d) => d.inputId === "base");
  const lang = ds.find((d) => d.inputId === "language");
  eq(base.files.length, 1, "the base ROM is still found from homebrew/");
  eq(lang.files.length, 2, "and BOTH localised ROMs from snes/ — the owner's exact case");
  eq(
    lang.found.map((f) => f.variantId).sort().join(","),
    "de,fr",
    "attributed by hash, on a manifest this host used to refuse outright",
  );
});

check("zelda3: all three ROMs are found across homebrew/ and snes/, each on the right input", async () => {
  const ds = await discoverInputs(zelda3Inputs(), ownersShelf(), counting());
  const base = ds.find((d) => d.inputId === "base");
  const lang = ds.find((d) => d.inputId === "language");

  eq(base.files.length, 1, "the base ROM is found — it sits in homebrew/");
  eq(base.files[0].filename, "zelda3.sfc", "and it is the NTSC-U dump");
  eq(base.found[0].variantId, "us", "matched by hash, not by where it happened to sit");

  eq(lang.files.length, 2, "BOTH localised ROMs are found — they sit in snes/");
  eq(
    lang.found.map((f) => f.variantId).sort().join(","),
    "de,fr",
    "the French and German dumps, each identified by its own hash",
  );
  eq(
    lang.files.map((f) => f.filename).sort().join(" | "),
    "Legend of Zelda, The - A Link to the Past (France).sfc | Legend of Zelda, The - A Link to the Past (Germany).sfc",
    "offered under the names the user actually has",
  );
});

check("zelda3: two inputs share one extension, so ONLY a hash can tell them apart", async () => {
  const ds = await discoverInputs(zelda3Inputs(), ownersShelf(), counting());
  const base = ds.find((d) => d.inputId === "base");
  const lang = ds.find((d) => d.inputId === "language");
  assert(
    !base.files.some((f) => f.filename.includes("France") || f.filename.includes("Germany")),
    "a translated ROM is never offered as the base",
  );
  assert(!lang.files.some((f) => f.filename === "zelda3.sfc"), "and the base is never offered as a language");
});

check("zelda3: a .sfc that is no zelda3 ROM is not attributed, because both inputs are strict", async () => {
  const ds = await discoverInputs(zelda3Inputs(), ownersShelf(), counting());
  for (const d of ds) {
    assert(!d.files.some((f) => f.filename === "smw.sfc"), `smw.sfc is not offered to ${d.inputId}`);
    eq(d.unrecognised.length, 0, `and strict means nothing unrecognised reaches ${d.inputId}`);
  }

  // The assertions above hold even without discovery's own strict guard, because `gateInputs`
  // refuses an unmatched file under `strict` anyway — they prove the GATE, not this module.
  // What the guard actually buys is not carrying a file the gate is certain to refuse: under
  // `strict` an unmatched candidate is never re-read and never offered. Count the reads.
  let reads = 0;
  const counted = ownersShelf().map((c) => ({ ...c, read: async () => { reads++; return c.read(); } }));
  await discoverInputs(zelda3Inputs(), counted, counting());
  // base: 4 hash reads + 1 to offer its match. language: 4 + 2. smw.sfc is hashed (it is a
  // size-plausible .sfc, since zelda3 publishes no `bytes`) but, matching no variant under
  // `strict`, is never carried into the offer — dropping the guard makes this 13.
  eq(reads, 11, "an unmatched .sfc is hashed once per input and then dropped, never offered");
});

check("zelda3: the same dump reachable from two folders is ONE input", async () => {
  // Asserted on `language`, NOT `base`: base is `allowMultiple: false`, so capacity alone would
  // truncate a duplicate to one and the check would pass without the dedup existing at all.
  const shelf = [
    ...ownersShelf(),
    cand("zelda3/zelda3.sfc", Z_BASE, "hb-dedicated"), // a dedicated folder holding copies
    cand("zelda3/Zelda3 (France).sfc", Z_FR, "hb-dedicated"),
  ];
  const ds = await discoverInputs(zelda3Inputs(), shelf, counting());
  eq(ds.find((d) => d.inputId === "base").files.length, 1, "one base ROM, not two");
  const lang = ds.find((d) => d.inputId === "language");
  eq(lang.files.length, 2, "the French dump found twice is still ONE language, not three files");
  eq(lang.found.map((f) => f.variantId).sort().join(","), "de,fr", "one entry per variant");
});

check("zelda3: maxCount caps the languages offered", async () => {
  const ds = await discoverInputs(zelda3Inputs({ language: { maxCount: 1 } }), ownersShelf(), counting());
  eq(ds.find((d) => d.inputId === "language").files.length, 1, "capped at the declared maximum");
});

check("zelda3: the cost — variants publish no `bytes`, so every .sfc in range is hashed", async () => {
  // The honest cost of THIS manifest. Doom's variants publish `bytes` and the size step throws
  // almost everything away before a single hash; zelda3's do not, so the extension is the only
  // narrowing there is. A library of 1000 non-.sfc ROMs still costs nothing.
  const deps = counting();
  await discoverInputs(zelda3Inputs(), ownersShelf(), deps);
  eq(deps.n, 4, "four .sfc candidates, hashed ONCE each — not once per input");

  // The saving is the point: two inputs sharing an extension set must not double the work.
  const perInput = counting();
  const [one] = zelda3Inputs();
  await discoverInput(one, ownersShelf(), perInput);
  eq(perInput.n, 4, "one input alone also hashes the four .sfc candidates");

  const clean = counting();
  const noSfc = bigLibrary(1000).filter((c) => !c.path.endsWith(".sfc"));
  await discoverInputs(zelda3Inputs(), noSfc, clean);
  eq(clean.n, 0, "a library with no .sfc at all hashes nothing");
});

// 18. `needsUserFiles` in a BUNDLE: both halves of the spec's rule
// --------------------------------------------------------------------------------------------
// spec/02-versions.md:70 — "any tool declares a required input, OR any system declares a
// required BIOS". `bundle.ts` synthesised the tool half only, so fceumm, pce-go and SMSPlusGX
// (no converter at all; `nes/disksys`, `pcecd/syscard3`, `col/coleco`) imported from a bundle
// as `needsUserFiles: false` while the SAME project over HTTP came back `true` from the
// publisher's own versions.json. One project must not have two answers.
const biosCoreManifest = (biosOver = {}) =>
  bundleManifest({
    targets: [
      {
        id: "gnw-retro-go",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind: "emulator",
        requiresAbi: { version: 1, minSize: 0 },
        artifacts: [
          {
            filename: "minesweeper.bin",
            url: "minesweeper.bin",
            bytes: ENGINE.length,
            sha256: sha256Of(ENGINE),
          },
        ],
        systems: [
          {
            id: "nes",
            longName: "Nintendo",
            shortName: "NES",
            extensions: [".nes"],
            bios: [{ id: "disksys", filename: "disksys.rom", required: true, ...biosOver }],
          },
        ],
      },
    ],
  });

check("bundle: a required BIOS makes needsUserFiles true, with no tool in sight", async () => {
  const { resolved } = await importZip(
    makeZip([["manifest.json", jsonBytes(biosCoreManifest())], ["minesweeper.bin", ENGINE]]),
  );
  eq(resolved.entry.needsUserFiles, true, "the BIOS half of the rule, which used to be missing");
});

check("bundle: a conditional (requiredFor) BIOS DOES claim needsUserFiles", async () => {
  // This assertion was inverted, and deliberately: it used to read `false`, reasoning that
  // whether a conditional BIOS bites depends on the user's own games. spec/02-versions.md:78
  // decides the other way, and gives the reason -- "the flag warns that files may be needed,
  // and it cannot know which games somebody intends to play". Answering `false` meant a bundle
  // import disagreeing with the publisher's own versions.json, which is the one thing section
  // 18 exists to prevent.
  const { resolved } = await importZip(
    makeZip([
      ["manifest.json", jsonBytes(biosCoreManifest({ required: undefined, requiredFor: [".fds"] }))],
      ["minesweeper.bin", ENGINE],
    ]),
  );
  eq(resolved.entry.needsUserFiles, true, "a conditional BIOS still warns");
});

check("bundle: a required BIOS the project SHIPS claims nothing", async () => {
  // The `!b.url` half. Nothing asks the user for a file the bundle already contains --
  // "otherwise every MSX install would warn about files it was about to install itself".
  const { resolved } = await importZip(
    makeZip([
      ["manifest.json", jsonBytes(biosCoreManifest({ url: "disksys.rom" }))],
      ["minesweeper.bin", ENGINE],
    ]),
  );
  eq(resolved.entry.needsUserFiles, false, "a shipped BIOS is not a file the user must find");
});

// 19. The Configure page shows every DECLARED BIOS slot, not just the installable ones
// --------------------------------------------------------------------------------------------
// This is a source-text guard for the same reason `rowOffersPicker`'s is: the bug was one
// identifier. `biosState.installable` drops a slot whose system has no games yet on Flash, so
// fceumm/pce-go/SMSPlusGX said "Needs user files" in the release panel and then offered nothing
// to supply. The install-time policy is untouched; the CONFIGURE page asks a different question.
check("configure: the BIOS rows are every declared slot, not the medium's installable subset", () => {
  const src = readFileSync(join(here, "../../ui/AdditionalFiles.svelte"), "utf8");
  assert(
    /selectBiosNeeds\(biosState\.sorted,\s*biosState\.all,/.test(src),
    "the Configure page must pass biosState.all",
  );
  assert(
    !/selectBiosNeeds\(biosState\.sorted,\s*biosState\.installable/.test(src),
    "and must not go back to the medium-filtered set",
  );
  assert(
    !/source\.card\?\.kind !== "homebrew"/.test(src),
    "nor gate the converter rows on the card kind again — a core may declare a tool",
  );
});

// 20. WHAT COUNTS AS A TITLE — the core-as-title gate
// ============================================================================================
//
// `titlesFor()` decides whether a target gets a prepare button and a file prompt AT ALL, and
// its old rule was `target.kind !== "homebrew" -> skip`. That single line is why the owner's
// Doom source offered nothing: Doom is `kind: "emulator"` (a core plus a `.wad` -> `.whd`
// converter), so it produced no title, so there was nothing to press and nothing to ask for.
//
// The rule was module-private, which is why reverting it broke no check. It is exported now,
// and compiled here on its own: `store.svelte.js` is a runes module full of app state and the
// only thing this rule takes from it is nothing at all — `titlesFor` is a pure function of
// (repo, manifest), which is exactly why it can be pinned.
//
// The fixtures are the LIVE manifest shapes: Doom v0.2.0's emulator target with
// `uses: [{tool: "doom-whd", outputs: ["whd"], required: true}]`, and the nineteen cores that
// publish `tools: []` with no `uses[]`.

await esbuild.build({
  entryPoints: [join(here, "../homebrewTitles.svelte.ts")],
  outdir: join(out, "titles"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["module"],
  target: "es2022",
  define: { $derived: "__derived", $state: "__rune" },
  banner: {
    js: "const __rune = (v) => v; const __derived = (v) => v; __derived.by = (f) => f();",
  },
  logLevel: "warning",
  plugins: [
    gnwResolve(join(here, "../../../../test")),
    {
      // The app-state store. `titlesFor` never touches it; the class field that does is
      // evaluated at import time, so it needs to exist and be empty.
      name: "titles-fakes",
      setup(build) {
        build.onResolve({ filter: /store\.svelte\.js$/ }, () => ({
          path: "store.svelte.js",
          namespace: "titles-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "titles-fake" }, () => ({
          contents: "export const sources = { rows: [] };",
          loader: "js",
        }));
      },
    },
  ],
});
const { titlesFor } = await import(pathToFileURL(join(out, "titles", "homebrewTitles.svelte.js")).href);

/** Doom v0.2.0's target, verbatim in shape: a core that converts WADs into games. */
function doomTarget(over = {}) {
  return {
    id: "gnw-retro-go",
    platform: "game-and-watch",
    label: "Game & Watch (Retro-Go SD)",
    kind: "emulator",
    requiresAbi: { version: 2, minSize: 832 },
    artifacts: [{ filename: "doom.bin", url: "doom.bin", bytes: 1, sha256: "0".repeat(64) }],
    systems: [{ id: "doom", longName: "Doom", shortName: "Doom", extensions: [".whd"] }],
    uses: [{ tool: "doom-whd", outputs: ["whd"], required: true }],
    ...over,
  };
}

/** One of the nineteen: a core with `tools: []` and no `uses[]` — fceumm, gwenesis, snes… */
function plainCoreTarget(over = {}) {
  const t = doomTarget(over);
  delete t.uses;
  return t;
}

function hbTarget(over = {}) {
  return {
    id: "gnw",
    platform: "game-and-watch",
    label: "Game & Watch",
    kind: "homebrew",
    requiresAbi: { version: 1, minSize: 0 },
    artifacts: [{ filename: "celeste.bin", url: "celeste.bin", bytes: 1, sha256: "0".repeat(64) }],
    ...over,
  };
}

const titleManifest = (targets, tools = []) => ({
  schemaVersion: 1,
  project: "p",
  title: "Doom",
  source: { repo: "o/r" },
  tools,
  targets,
});

check("titles: a CORE that declares a runnable converter IS a title", () => {
  const ts = titlesFor("o/doom", titleManifest([doomTarget()], [doomToolRaw()]));
  eq(ts.length, 1, "the emulator target produced a title");
  const t = ts[0];
  eq(t.key, "o/doom#gnw-retro-go", "keyed like any other title");
  eq(t.targetId, "gnw-retro-go", "the target it came from");
  assert(t.tool !== undefined, "and it carries the converter, so `prepare` has work to do");
  eq(t.promptsForInput, true, "so the prepare button opens the file prompt");
  eq(t.selfContained, false, "a required input means the user must supply a file");
  eq(t.derivedOutputs, 1, "its one output takes a derived name (.whd)");
});

check("titles: a core is FLAGGED as one, so the Library keeps it out of Homebrew", () => {
  // Step 4. A core is in this list because it has something to PREPARE — the Sources tab's
  // Additional-files section asks it for a WAD exactly as it asks a homebrew for its assets,
  // and dropping cores back out would blank that section again. What must not follow is a
  // pseudo-row in the Library's Homebrew group: a core's games are real ROMs under its own
  // console. `isCore` is the field `views/RomManagementTab.svelte` filters on.
  const core = titlesFor("o/doom", titleManifest([doomTarget()], [doomToolRaw()]))[0];
  eq(core.isCore, true, "Doom is a core, however preparable it is");
  const hb = titlesFor("o/celeste", titleManifest([hbTarget()], []))[0];
  eq(hb.isCore, false, "a homebrew is not, and still belongs in the Homebrew group");
});

check("titles: the spec's renamed `core` kind is a core here too", () => {
  // DOOM published `kind: "emulator"` until v0.2.1 and `"core"` after; both must flag alike or
  // the rename silently moves Doom into the Homebrew group.
  const asCore = titlesFor("o/doom", titleManifest([doomTarget({ kind: "core" })], [doomToolRaw()]));
  eq(asCore.length, 1, "still a title");
  eq(asCore[0].isCore, true, "and still a core");
});

check("titles: that title's inputs ARE the manifest's declared tool inputs", () => {
  const ts = titlesFor("o/doom", titleManifest([doomTarget()], [doomToolRaw()]));
  eq(ts.length, 1, "the core is a title at all — without which there is no modal to render");
  const t = ts[0];
  eq(t.tool.inputs.length, 1, "one input, as the manifest declares");
  const input = t.tool.inputs[0];
  eq(input.id, "base", "the manifest's own id — this is what the modal renders");
  eq(input.extensions.join(","), ".wad", "and its extensions");
  eq(input.maxCount, 32, "and its ceiling");
  eq(input.allowMultiple, true, "and its arity");
  eq(input.variants.length, 4, "and every variant the prompt names");
  eq(t.sourceExtensions.join(","), ".wad", "the folder-file hint follows the same declaration");
});

check("titles: a core with NO converter is not a title — there is nothing to prepare", () => {
  const ts = titlesFor("o/fceumm", titleManifest([plainCoreTarget()], []));
  eq(ts.length, 0, "the nineteen tools-less cores stay out of the title list");
});

check("titles: a core whose converter this host REFUSES is not a title either", () => {
  // This used to use zelda3 v0.3.0's shape (`repeatable`, no `allowMultiple`) as its example of
  // a refusal. That key is now deliberately accepted — see `allowMultipleOf` — so the fixture no
  // longer refuses anything and had to move. The RULE is untouched: a tool this host cannot
  // parse leaves the target with no runnable converter, and it must not present an empty prepare
  // button. A non-boolean multiplicity flag still refuses, which is the point of that shim being
  // one NAME wider and not one TYPE looser.
  const broken = doomToolRaw();
  broken.inputs = [{ id: "base", required: true, allowMultiple: "yes", extensions: [".sfc"], maxBytes: 4 }];
  eq(titlesFor("o/z", titleManifest([doomTarget()], [broken])).length, 0, "no title from a refused tool");
});

// Consequence 1 of the shim, and the thing the owner actually sees: the Configure page renders
// one "Additional files" row per DECLARED input, so a tool this host refuses leaves it with
// nothing to render and it shows the malformed error instead. zelda3 v0.3.0 as published used
// to land there. It must now arrive with both of its inputs intact.
check("titles: zelda3 AS PUBLISHED keeps its converter, so Configure has rows to render", () => {
  const zelda3AsPublished = {
    id: "zelda3-assets",
    processor: { type: "wasm", version: 1 },
    binary: { file: "z.wasm", url: "z.wasm", bytes: 1, sha256: "a".repeat(64) },
    limits: { maxMemoryPages: 1024, maxOutputBytes: 1 << 20 },
    options: [],
    inputs: [
      { id: "base", required: true, repeatable: false, extensions: [".sfc", ".smc"], maxBytes: 4194304 },
      { id: "language", required: false, repeatable: true, extensions: [".sfc", ".smc"], maxBytes: 4194304 },
    ],
    outputs: [{ id: "assets", filename: "zelda3_assets.dat", maxBytes: 1572864 }],
  };
  const ts = titlesFor(
    "o/zelda3",
    titleManifest(
      [hbTarget({ uses: [{ tool: "zelda3-assets", outputs: ["assets"], required: true }] })],
      [zelda3AsPublished],
    ),
  );
  eq(ts.length, 1, "the title exists");
  assert(ts[0].tool !== undefined, "and it KEPT its converter — this is the malformed error going away");
  eq(ts[0].tool.inputs.length, 2, "both declared inputs reach the Configure page");
  eq(ts[0].tool.inputs.map((i) => i.id).join(","), "base,language", "under their own ids");
  assert(ts[0].promptsForInput, "and the Library has something to prompt for");
});

check("titles: a homebrew target is still a title, with or without a converter", () => {
  eq(titlesFor("o/celeste", titleManifest([hbTarget()], [])).length, 1, "artifacts-only homebrew");
  const withTool = titlesFor(
    "o/zelda",
    titleManifest([hbTarget({ uses: [{ tool: "doom-whd", outputs: ["whd"], required: true }] })], [doomToolRaw()]),
  );
  eq(withTool.length, 1, "converting homebrew");
  assert(withTool[0].tool !== undefined, "and it keeps its converter");
});

check("titles: a non-Game-&-Watch target is never a title, converter or not", () => {
  const ts = titlesFor("o/doom", titleManifest([doomTarget({ platform: "esp32" })], [doomToolRaw()]));
  eq(ts.length, 0, "platform still gates everything");
});

// ============================================================================================
// 23. Taking a supplied BIOS file back out (`sources/biosState.svelte.ts`)
// ============================================================================================
//
// `addUserFiles` writes the bytes into TWO places — this store's own map (what the row's state
// is resolved from) and the library's folder-scan map (what an install actually packs). A
// removal that undid only the first would take the file off the screen and still write it to
// the device, which is worse than not offering `Remove` at all. Both halves are asserted here.
//
// The store is compiled with the REAL `bios.ts` (so `biosDestKey` really decides the paths) and
// fakes for the four modules that reach out of it — the device, the library, the ROM selection
// and the sources store. The runes are stubbed the way this file already stubs `$state`.

const biosStateFakes = {
  "device.svelte.js": "export const device = { targetMedia: 'flash', sdHandle: null, installedFrogfs: null };",
  // Reached through a global so the CHECK below holds the very object the bundle mutates —
  // importing the fake module separately would give it a private second copy.
  "library.svelte.js": "export const library = globalThis.__biosFakes.library;",
  "romSelection.svelte.js": "export const romSelection = { games: [] };",
  "store.svelte.js": "export const sources = { rows: [] };",
  "sdBios.js": "export async function scanSdBios() { return []; }",
};

const fakeLibrary = { scan: { userRoms: new Map() }, dirty: [], markDirty(pth) { this.dirty.push(pth); } };
globalThis.__biosFakes = { library: fakeLibrary };

await esbuild.build({
  entryPoints: [join(here, "../biosState.svelte.ts")],
  outfile: join(out, "biosStore.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["module"],
  target: "es2022",
  define: { $state: "__rune", $derived: "__rune" },
  // The derived fields are stubbed to `[]` rather than evaluated: they run at construction,
  // BEFORE the `$state` fields further down the class body exist. Nothing below reads one —
  // the two methods under test read the underlying maps directly.
  banner: { js: "const __rune = Object.assign((v) => v, { by: () => [] });" },
  logLevel: "warning",
  plugins: [
    {
      name: "bios-state-fakes",
      setup(build) {
        build.onResolve({ filter: /(device\.svelte|library\.svelte|romSelection\.svelte|store\.svelte|sdBios)\.js$/ }, (a) => ({
          path: a.path.slice(a.path.lastIndexOf("/") + 1),
          namespace: "bios-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "bios-fake" }, (a) => ({
          contents: biosStateFakes[a.path],
          loader: "js",
        }));
      },
    },
  ],
});
const { biosState: biosStore } = await import(pathToFileURL(join(out, "biosStore.js")).href);

/** The slot the user supplies a file for: `bios/gba/gba_bios.bin`, via the real `biosDestKey`. */
const GBA_SLOT = { biosDir: "gba", filenames: ["gba_bios.bin"], entry: {} };

// Mutation: deleting the `next.delete(key)` line, or the `folder?.delete(key)` line, in
// `removeUserFiles` turns this check red — each half on its own assertion.
check("bios: a file supplied through the prompt can be taken back out of BOTH maps", () => {
  // The manifest's spelling of the filename wins over the user's — the REAL `biosDestKey`.
  const key = "bios/gba/gba_bios.bin";
  biosStore.addUserFiles(GBA_SLOT, [{ filename: "GBA_BIOS.BIN", bytes: new Uint8Array([7]) }]);
  eq(biosStore.hasUserFiles(GBA_SLOT), true, "the store holds it");
  assert(fakeLibrary.scan.userRoms.has(key), "and it is mirrored where an install would pack it");

  fakeLibrary.dirty.length = 0;
  biosStore.removeUserFiles(GBA_SLOT);
  eq(biosStore.hasUserFiles(GBA_SLOT), false, "the store lets go of it");
  assert(!fakeLibrary.scan.userRoms.has(key), "and so does the map an install actually reads");
  // SD mode syncs the CHANGED subset only; a key that vanished has to be in it to be noticed.
  eq(fakeLibrary.dirty.join(""), key, "the removal is marked dirty, exactly as the add was");
  eq(biosStore.hasUserFiles({ biosDir: "nes", filenames: ["disksys.rom"] }), false, "a slot never supplied");
});

// 23. The spec renamed `kind: "emulator"` -> `kind: "core"`
// --------------------------------------------------------------------------------------------
// gwrg-dist-spec `d6c24b0` ("Call a core a core") renamed the target kind; the schema's enum is
// now ["homebrew","core"] only. Sixteen of seventeen published cores had already republished
// while `client.ts` still compared against the literal "emulator", so every one of them was
// refused with errMalformed — "The project published a file this tool could not read." The
// helper existed (`isCoreKind`) and the fix that introduced it simply did not reach the parser.
//
// The subtle half is `systems[]`. It is parsed only for a core (spec/07-cores.md:54: required
// for a core, forbidden for homebrew). Relaxing the two `kind` guards WITHOUT relaxing that
// branch would let a `kind: "core"` target parse "successfully" carrying no systems at all —
// no folder, no extensions, no console button — which is worse than the loud refusal it
// replaces. So these assert the systems SURVIVE, not merely that nothing threw.

/** A manifest whose one game-and-watch target is a core declaring one system. */
function coreManifestDoc(kind, systemsOver) {
  return manifestDoc({
    targets: [
      {
        id: "gnw-retro-go",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind,
        requiresAbi: { version: 2, minSize: 832 },
        artifacts: [
          { filename: "doom.bin", url: "doom.bin", bytes: 16, sha256: "0".repeat(64) },
        ],
        ...(systemsOver === undefined
          ? {
              systems: [
                {
                  id: "doom",
                  longName: "Doom",
                  shortName: "Doom",
                  extensions: [".whd"],
                  browse: "file",
                },
              ],
            }
          : systemsOver),
      },
    ],
  });
}

/** Run `fn` and require a SourceError("malformed") — the code errorText maps to errMalformed. */
function refusesMalformed(fn, why) {
  let threw;
  try {
    fn();
  } catch (e) {
    threw = e;
  }
  assert(threw, `${why}: must be refused, got success`);
  eq(threw.code, "malformed", `${why}: must be "malformed"`);
}

check('kind: "core" parses AND its systems survive', () => {
  const m = parseManifest(coreManifestDoc("core"), MANIFEST_URL);
  const t = m.targets[0];
  eq(t.kind, "core", "the kind is carried through verbatim");
  assert(Array.isArray(t.systems), "a core MUST come back with systems[] — the line-338 trap");
  eq(t.systems.length, 1, "one declared system");
  eq(t.systems[0].id, "doom", "the folder key survives");
  eq(t.systems[0].extensions.join(","), ".whd", "and the extensions, or there is no console");
});

check('kind: "emulator" still parses identically', () => {
  // Not hypothetical: DOOM was live as "emulator" while this was written, and a cached or
  // bundled manifest can still carry it. Both spellings must produce the same shape.
  const core = parseManifest(coreManifestDoc("core"), MANIFEST_URL).targets[0];
  const emu = parseManifest(coreManifestDoc("emulator"), MANIFEST_URL).targets[0];
  eq(emu.kind, "emulator", "the old spelling is preserved, not rewritten");
  eq(JSON.stringify(emu.systems), JSON.stringify(core.systems), "same systems either way");
});

check('a versions.json entry with kind "core" is accepted', () => {
  const doc = versionsDoc();
  doc.versions[0].kind = "core";
  const v = parseVersions(doc);
  eq(v.versions[0].kind, "core", "the index entry carries the new kind");
});

check("an unknown kind is still refused — this is not 'accept anything'", () => {
  refusesMalformed(() => parseManifest(coreManifestDoc("engine"), MANIFEST_URL), "a bogus target kind");
  const doc = versionsDoc();
  doc.versions[0].kind = "engine";
  refusesMalformed(() => parseVersions(doc), "a bogus versions.json kind");
});

check("a core with no systems is refused, both shapes", () => {
  refusesMalformed(
    () => parseManifest(coreManifestDoc("core", {}), MANIFEST_URL),
    "systems[] missing entirely",
  );
  refusesMalformed(
    () => parseManifest(coreManifestDoc("core", { systems: [] }), MANIFEST_URL),
    "systems[] present but empty (schema says minItems 1)",
  );
});

// ============================================================================================
// 24. A WHOLE FOLDER, FOR AN INPUT THAT SAYS IT TAKES MANY FILES (`inputPrompt.acceptsFolder`)
// ============================================================================================
//
// The owner added OpenLara and expected to hand it a directory: "I wanted to be able to add a
// folder so it would recursively look for all the files it needs... could you also derive the
// fact that adding a directory would be fine?"
//
// It IS derivable, and that is what these checks pin. OpenLara's live v0.0.1 manifest declares
// `level` as `allowMultiple: true, runPerFile: true, maxCount: 32, strict: false`, extensions
// `[".PHD"]` (UPPERCASE, as the DOS install writes them) and 21 variants that publish `bytes`
// but no `filename`. Nothing there is OpenLara-specific: `allowMultiple` is the manifest saying
// "many files", and a directory is many files.
//
// The folder path is NOT a second matcher. `FilePromptModal.pickFolder` walks with
// `folderCandidates` and then hands the result to `discoverInput` — the same call the automatic
// case makes — so `maxBytes`, `strict`, `maxCount` and the variant table decide identically
// whether the user picked a folder or thirty-two files.

/** OpenLara's input, live-manifest shaped. `bytes` differ per level, as the real ones do. */
const LEVELS = [
  ["TITLE.PHD", 316460],
  ["GYM.PHD", 3237128],
  ["LEVEL1.PHD", 2533634],
  ["LEVEL2.PHD", 2873450],
];
const levelBytes = (n, seed) => wad(Math.max(4, Math.round(n / 1024)), seed);
const LEVEL_DATA = LEVELS.map(([name, n], i) => [name, levelBytes(n, 0x40 + i)]);

function openLaraToolRaw(over) {
  return {
    id: "openlara-levels",
    processor: { type: "wasm", version: 1 },
    binary: { file: "tr_pkd.wasm", url: "tr_pkd.wasm", bytes: 4096, sha256: "2b".repeat(32) },
    limits: { maxMemoryPages: 4096, maxOutputBytes: 25165824 },
    inputs: [
      {
        id: "level",
        required: true,
        allowMultiple: true,
        runPerFile: true,
        maxCount: 32,
        label: { en: "Tomb Raider level file" },
        extensions: [".PHD"],
        maxBytes: 67108864,
        strict: false,
        variants: LEVEL_DATA.map(([name, bytes], i) => ({
          id: `lvl${i}`,
          sha1: sha1Of(bytes),
          bytes: bytes.length,
          label: { en: name.replace(".PHD", "") },
        })),
        ...over,
      },
    ],
    outputs: [{ id: "pkd", extension: ".PKD", maxBytes: 25165824 }],
  };
}
const openLaraInput = (over) => parseToolInputs(openLaraToolRaw(over))[0];

/** A directory handle, `folderCandidates`-shaped, that counts the bytes it is asked to read. */
function dirHandle(tree, meter = { reads: 0 }) {
  const file = (bytes) => ({
    kind: "file",
    getFile: async () => ({
      size: bytes.length,
      arrayBuffer: async () => {
        meter.reads++;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    }),
  });
  const dir = (entries) => ({
    kind: "directory",
    entries: async function* () {
      for (const [name, v] of entries) yield [name, Array.isArray(v) ? dir(v) : file(v)];
    },
  });
  return { handle: dir(tree), meter };
}

// --- 24a. The rule itself, and its converse -------------------------------------------------

check("folder: an `allowMultiple` input may be answered by a directory", () => {
  assert(acceptsFolder(openLaraInput()), "OpenLara's `level` takes many files, so a folder answers it");
  assert(acceptsFolder(doomInput()), "and the rule is general: DOOM's `base` is the same shape");
});

check("folder: a single-file input may NOT", () => {
  assert(
    !acceptsFolder(openLaraInput({ allowMultiple: false })),
    "`everything in here` cannot answer `the one file`",
  );
  assert(!acceptsFolder({ allowMultiple: false }), "and the rule reads that field alone");
});

// --- 24b. The owner's case: one folder, levels in a DATA subdirectory ------------------------

check("folder: a Tomb Raider install answers the input from its DATA subdirectory", async () => {
  const { handle, meter } = dirHandle([
    ["tomb.exe", wad(8, 1)],
    ["DATA", LEVEL_DATA.map(([n, b]) => [n, b])],
  ]);
  const cands = await folderCandidates(handle, "", openLaraInput().extensions);
  eq(cands.length, 4, "the walk recursed into DATA and took only the levels");
  eq(meter.reads, 0, "and read NOTHING to produce that list");
  const d = await discoverInput(openLaraInput(), cands, counting());
  eq(d.files.length, 4, "all four levels offered from the one folder");
  eq(
    d.files.map((f) => f.filename).join(","),
    "TITLE.PHD,GYM.PHD,LEVEL1.PHD,LEVEL2.PHD",
    "under the names the user has, in walk order",
  );
  eq(d.found.every((f) => f.match === "variant"), true, "each matched a published level");
});

check("folder: an UPPERCASE declared extension matches a lowercase file on disk", async () => {
  // The manifest says `.PHD`; a DOS install written by a modern tool may well say `.phd`.
  const { handle } = dirHandle([["DATA", [["level1.phd", LEVEL_DATA[2][1]]]]]);
  const cands = await folderCandidates(handle, "", openLaraInput().extensions);
  eq(cands.length, 1, "case folds on BOTH sides or nothing matches at all");
  const d = await discoverInput(openLaraInput(), cands, counting());
  eq(d.files[0].filename, "level1.phd", "and the user's own spelling survives to the offer");
});

// --- 24c. The cost rule, which a folder does not get to escape ------------------------------

check("folder: a big folder is not hashed, it is narrowed first", async () => {
  // 400 files: 4 real levels, 96 other `.PHD` of implausible length, 300 non-levels.
  const others = [];
  for (let i = 0; i < 96; i++) others.push([`X${i}.PHD`, wad(9 + (i % 3), i)]);
  for (let i = 0; i < 300; i++) others.push([`art${i}.tga`, wad(6, i)]);
  const { handle, meter } = dirHandle([["DATA", [...LEVEL_DATA.map(([n, b]) => [n, b]), ...others]]]);
  const cands = await folderCandidates(handle, "", openLaraInput().extensions);
  eq(cands.length, 100, "extension alone drops the 300 non-levels, reading nothing");
  eq(meter.reads, 0, "still nothing read");
  const deps = counting();
  const d = await discoverInput(openLaraInput(), cands, deps);
  eq(deps.n, 4, "and only the four files of a PUBLISHED length were HASHED, not 100");
  // Reads are a different budget from hashes, and this is where they part company. Under
  // `strict: false` an unrecognised `.PHD` is a legitimate level (the `freedoom2` rule), so the
  // weak pool is offered too, up to `maxCount`, and an offered file must be read. The bound
  // that matters is that neither number tracks the FOLDER: 100 candidates, 4 hashes, 32 reads.
  eq(meter.reads, 32, "reads are capped by `maxCount`, not by what the folder holds");
  eq(d.files.length, 32, "and the offer is capped there too");
});

check("folder: under `strict: true` the weak pool is not read at all", async () => {
  // The same folder, with the manifest saying only a published level counts. Now the 96
  // implausible `.PHD` are never offered, so they are never read either.
  const others = [];
  for (let i = 0; i < 96; i++) others.push([`X${i}.PHD`, wad(9 + (i % 3), i)]);
  const { handle, meter } = dirHandle([["DATA", [...LEVEL_DATA.map(([n, b]) => [n, b]), ...others]]]);
  const cands = await folderCandidates(handle, "", openLaraInput().extensions);
  const deps = counting();
  const d = await discoverInput(openLaraInput({ strict: true }), cands, deps);
  eq(deps.n, 4, "still four hashes");
  eq(meter.reads, 4, "and now only four reads, because nothing else can be accepted");
  eq(d.files.length, 4, "the four published levels");
});

check("folder: `maxCount` still caps what a directory may contribute", async () => {
  const spec = openLaraInput({ maxCount: 2 });
  const { handle } = dirHandle([["DATA", LEVEL_DATA.map(([n, b]) => [n, b])]]);
  const cands = await folderCandidates(handle, "", spec.extensions);
  const d = await discoverInput(spec, cands, counting());
  eq(d.files.length, 2, "capped at the declared maximum, not at what the folder holds");
});

check("folder: an unrecognised .PHD is still accepted under `strict: false`", async () => {
  const rogue = wad(999, 0xab);
  const { handle } = dirHandle([["DATA", [["CUSTOM.PHD", rogue], [LEVEL_DATA[0][0], LEVEL_DATA[0][1]]]]]);
  const cands = await folderCandidates(handle, "", openLaraInput().extensions);
  const d = await discoverInput(openLaraInput(), cands, counting());
  eq(d.files.length, 2, "both offered");
  assert(d.unrecognised.includes("CUSTOM.PHD"), "and spec/03's `say it was not recognised` is honoured");
  const strict = await discoverInput(openLaraInput({ strict: true }), cands, counting());
  eq(strict.files.length, 1, "under `strict: true` only the published level survives");
  eq(strict.unrecognised.length, 0, "and nothing unrecognised is offered at all");
});

// ============================================================================================
// The gwrg-dist-spec delta: fb4c8be, 61d3726, 44b0bf3
// ============================================================================================
//
// Three commits landed that this host had never been checked against. Two are relaxations the
// parser had to stop out-running, one is a refusal that deliberately stays at publish time.
//
// The fixtures are the REAL published shapes, verified against the live sites while this was
// written: OpenLara v0.0.1 declares `dataDir: "openlara"` on a homebrew target with a
// `runPerFile` input and one derived `.PKD`; zelda3 v0.3.1 names a single `zelda3_assets.dat`
// and does not run per file; DOOM v0.2.1 runs per file with a derived `.whd` and names nothing.

// --- fb4c8be: a filename is what the CARD can hold, not a tidy whitelist --------------------

check("fb4c8be: the names people actually write are accepted", () => {
  for (const name of [
    "Doom (Shareware).whd",
    "Kirby's Adventure.whd",
    "Legend of Zelda, The - A Link to the Past (USA).whd",
    "Doom II - Hell on Earth.whd",
    "zelda3_assets.dat",
    "Doom..whd", // `..` in the MIDDLE is a legal card name; only a separator was ever unsafe
  ]) {
    assert(isPlainFilename(name), `the No-Intro and GoodTools conventions must parse: ${name}`);
  }
});

check("fb4c8be: what the filesystem refuses, we refuse", () => {
  // exFAT's own illegal set. Accepting these produced a name we take and the card rejects.
  for (const bad of ['a"b.whd', "a*b.whd", "a:b.whd", "a<b.whd", "a>b.whd", "a?b.whd", "a|b.whd"]) {
    assert(!isPlainFilename(bad), `exFAT refuses this, so must we: ${bad}`);
  }
  assert(!isPlainFilename(".hidden.whd"), "a leading dot is refused");
  assert(!isPlainFilename("trailing."), "a trailing dot is refused");
  assert(!isPlainFilename(" lead.whd"), "a leading space is refused");
  assert(!isPlainFilename("trail .whd".replace(".whd", " ")), "a trailing space is refused");
  assert(!isPlainFilename("a/b.whd"), "a separator is the one exclusion that was ever about safety");
  assert(!isPlainFilename("a\\b.whd"), "and so is the other separator");
  assert(!isPlainFilename("."), "a bare dot is not a filename");
  assert(!isPlainFilename(".."), "and neither is a bare double dot");
});

check("fb4c8be: the 200-character ceiling is the schema's, not 255", () => {
  const stem = "x".repeat(196);
  assert(isPlainFilename(`${stem}.whd`), "200 characters exactly is allowed");
  assert(!isPlainFilename(`${stem}0.whd`), "201 is refused -- $defs/filename maxLength is 200");
});

check("fb4c8be: a relaxed name survives the manifest parser end to end", () => {
  const m = parse({}, { filename: "Doom (Shareware).whd", url: "Doom (Shareware).whd" });
  eq(m.targets[0].artifacts[0].filename, "Doom (Shareware).whd", "parentheses reach the model");
});

// --- 61d3726: a homebrew that keeps its data in a folder ------------------------------------

/** OpenLara's real target shape: homebrew, one binary, `dataDir`, one per-file converter. */
function openLaraTargetDoc(over = {}) {
  return manifestDoc({
    targets: [
      {
        id: "gnw-retro-go",
        platform: "game-and-watch",
        label: "Game & Watch",
        kind: "homebrew",
        requiresAbi: { version: 2, minSize: 0 },
        artifacts: [
          { filename: "OpenLara.bin", url: "OpenLara.bin", bytes: 16, sha256: "0".repeat(64) },
        ],
        uses: [{ tool: "openlara-levels", outputs: ["pkd"], required: true }],
        dataDir: "openlara",
        ...over,
      },
    ],
  });
}

check("61d3726: a homebrew's `dataDir` is parsed", () => {
  const t = parseManifest(openLaraTargetDoc(), MANIFEST_URL).targets[0];
  eq(t.dataDir, "openlara", "OpenLara reads /homebrews/openlara/, and the manifest says so");
});

check("61d3726: `dataDir` is a path segment, so a traversal is refused", () => {
  for (const bad of ["../etc", "/abs", "a//b", "..", ".hidden", "x".repeat(101)]) {
    const t = parseManifest(openLaraTargetDoc({ dataDir: bad }), MANIFEST_URL).targets[0];
    eq(t.dataDir, undefined, `a dataDir that is not a subpath is dropped, never used: ${bad}`);
  }
});

check("61d3726: `dataDir` may be more than one segment deep", () => {
  const t = parseManifest(openLaraTargetDoc({ dataDir: "openlara/fmv" }), MANIFEST_URL).targets[0];
  eq(t.dataDir, "openlara/fmv", "$defs/subpath allows a nested folder");
});

check("61d3726: a CORE declaring `dataDir` is ignored, not refused", () => {
  // spec/03: dataDir is homebrew-only, because a core's converted output is a game and
  // roms/<system id>/ already answers where it goes. Two answers for one file is the bug.
  const doc = coreManifestDoc("core");
  doc.targets[0].dataDir = "somewhere";
  const t = parseManifest(doc, MANIFEST_URL).targets[0];
  eq(t.dataDir, undefined, "the field is dropped");
  assert(Array.isArray(t.systems) && t.systems.length > 0, "and the core still parses in full");
});

check("61d3726: an output's `subdir` is parsed and validated", () => {
  const [out] = parseToolOutputs({
    outputs: [{ id: "fmv", extension: ".fmv", subdir: "fmv", maxBytes: 1024 }],
  });
  eq(out.subdir, "fmv", "how cutscenes reach /homebrews/openlara/fmv/");
  const [bad] = parseToolOutputs({
    outputs: [{ id: "fmv", extension: ".fmv", subdir: "../..", maxBytes: 1024 }],
  });
  eq(bad.subdir, undefined, "a subdir that escapes its folder is dropped");
});

// --- 44b0bf3: the refusal we deliberately leave at publish time ------------------------------
//
// A `runPerFile` tool that also names an output writes that same name on every run. The spec
// added an ERROR for it in `site/check.js`, which is the PUBLISHER's checker -- spec/05-host
// says nothing about it, and `site/validate.js` (the schema) does not encode it either.
//
// This host does not refuse such a manifest at parse time, on purpose. Refusing there makes the
// whole source unusable -- its artifacts, and any other tool in it that is fine -- over a defect
// that only bites when a user actually converts two or more files. The failure is already
// handled where it happens: `homebrewConvert` appends every run to ONE list and puts the whole
// list through `planNames`, so the second run's identical name is a collision and is refused by
// name. These checks prove that, so "we do not implement the refusal" is a verified behaviour
// and not a gap.

check("44b0bf3: the shape parses -- we do not refuse it at the boundary", () => {
  const outs = parseToolOutputs({
    outputs: [
      { id: "pkd", extension: ".PKD", maxBytes: 1024 },
      { id: "title", filename: "TITLE.SCR", maxBytes: 1024 },
    ],
  });
  eq(outs.length, 2, "a mixed tool is not rejected by the parser");
  eq(outs[0].filename, undefined, "the derived output still has no name");
  eq(outs[1].filename, "TITLE.SCR", "and the fixed one keeps its own");
});

check("44b0bf3: two runs writing one fixed name collide, and are refused by name", () => {
  // Exactly the shape 44b0bf3 describes: the same filename produced twice, which is what a
  // per-file tool with a fixed output would do on its second level.
  const collision = firstCollisionError(
    planNames([
      { dir: "homebrew", name: "TITLE.SCR", origin: "declared" },
      { dir: "homebrew", name: "TITLE.SCR", origin: "declared" },
    ]),
  );
  assert(collision !== undefined, "the host refuses rather than letting the last run win");
  assert(
    String(collision.detail ?? collision.message ?? collision).includes("TITLE.SCR"),
    "and the refusal names the file, so the author can see which one",
  );
});

// --- Report ------------------------------------------------------------------------------------

// --- 25. The prepare-failure code -> message mapping ------------------------------------------
//
// `prepareState.run()` catches a ConverterError (27 codes) or a SourceError (11) and used to
// render `convertFailed(err.code)`, interpolating a raw kebab-case identifier into a translated
// sentence: the owner's "Konnte nicht vorbereitet werden: malformed". `prepareMessageKind` is
// the RULE (which codes share a message), `prepareText` the LOOKUP, mirroring section 18.
//
// The code list is READ OUT OF THE TYPE, not hand-maintained. Section 18's ALL_CODES has to be
// kept in sync by hand and guarded with a count; deriving it means a code added to
// converterTypes.ts with no group assigned cannot be silently absorbed by the default arm.
const CONVERTER_CODES = (() => {
  const src = readFileSync(join(here, "../converterTypes.ts"), "utf8");
  const body = src.slice(
    src.indexOf("export type ConverterErrorCode ="),
    src.indexOf('| "bad-utf8"'),
  );
  const codes = [...body.matchAll(/\|\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  codes.push("bad-utf8");
  return codes;
})();

const SOURCE_CODES_FOR_PREPARE = [
  "bad-url", "no-pages", "no-versions", "malformed", "unsupported-schema", "network",
  "artifact-size-mismatch", "aborted", "bundle-invalid", "bundle-missing-file", "bundle-conflict",
];

const PREPARE_KINDS = new Set(["unreadable", "input", "collision", "interrupted"]);

check("prepare: the code list really was read out of converterTypes.ts", () => {
  eq(CONVERTER_CODES.length, 27, "27 ConverterErrorCode members");
  assert(CONVERTER_CODES.includes("bad-binary"), "first member present");
  assert(CONVERTER_CODES.includes("name-collision"), "the collision code present");
  assert(CONVERTER_CODES.includes("bad-utf8"), "last member present");
});

// 25a. Totality. Every code the two error families can throw maps to a real kind, and every
// kind produces a non-empty string that is NOT the code. Armed by mutation 1 (drop an arm).
check("prepare: every code maps to a kind, and none renders a raw code", () => {
  const t = {
    errPrepareUnreadable: "M:unreadable",
    errPrepareInput: "M:input",
    errPrepareCollision: "M:collision",
    errPrepareInterrupted: "M:interrupted",
  };
  for (const code of [...CONVERTER_CODES, ...SOURCE_CODES_FOR_PREPARE]) {
    const kind = prepareMessageKind(code);
    assert(PREPARE_KINDS.has(kind), `${code} produced a kind outside the union: ${kind}`);
    const text = prepareText(t, code);
    assert(text.length > 0, `${code} produced empty text`);
    assert(!text.includes(code), `${code} leaked its own identifier into the sentence`);
  }
});

// 25b. The groups themselves. These are the judgement calls, so they are pinned by name: a
// module failure is the publisher's, a gate failure is the user's file, a collision is its own
// thing, and only a genuinely unfinished run is retryable. Armed by mutations 2 and 3.
check("prepare: a module failure is the project's, never the user's file", () => {
  for (const code of [
    "bad-binary", "imports-forbidden", "missing-export", "bad-export", "extra-export",
    "unbounded-memory", "memory-too-large", "binary-hash", "unsupported-processor",
    "unsupported-abi", "instantiate-failed", "module-error", "no-progress", "alloc-failed",
    "out-of-bounds", "output-too-large", "output-name", "unknown-output", "bad-utf8",
    "malformed", "unsupported-schema", "artifact-size-mismatch", "bundle-invalid",
    "bundle-missing-file",
  ]) {
    eq(prepareMessageKind(code), "unreadable", `${code} is the project's problem`);
  }
});

check("prepare: every input-gate code blames the file, not the project", () => {
  for (const code of [
    "input-too-large", "input-unrecognised", "input-missing", "input-not-multiple",
    "input-too-many",
  ]) {
    eq(prepareMessageKind(code), "input", `${code} is about a file the user chose`);
  }
});

check("prepare: a collision is its own group, and only timeouts are retryable", () => {
  eq(prepareMessageKind("name-collision"), "collision", "the user's own two files");
  for (const code of ["timeout", "worker-failed", "network", "aborted"]) {
    eq(prepareMessageKind(code), "interrupted", `${code} did not finish`);
  }
  // An unexpected throw arrives as an Error.message, not a code. It must not blame the
  // publisher for something we did not diagnose, nor the user for a file.
  eq(prepareMessageKind("Cannot read properties of undefined"), "interrupted", "a raw message");
  eq(prepareMessageKind(undefined), "interrupted", "no code at all");
});

// 25c. `detail` cannot reach the sentence, because `prepareText` has nowhere to put it. This is
// the defect being fixed: `describeCollision`'s detail is
// `roms/doom: "DOOM.whd" (derived) collides with "Doom.whd" (derived)`, and appending it would
// reproduce exactly what the owner objected to. Armed by mutation 4.
check("prepare: prepareText takes no detail, so untrusted text cannot reach the user", () => {
  eq(prepareText.length, 2, "prepareText(t, code) and nothing else");
});

// 25d. Four kinds, four distinct sentences: an identity-proxy table driven across every code
// must collapse to exactly 4 strings. Armed by mutations 2/3 together.
check("prepare: one string per kind, in every locale", () => {
  const t = {
    errPrepareUnreadable: "M:unreadable",
    errPrepareInput: "M:input",
    errPrepareCollision: "M:collision",
    errPrepareInterrupted: "M:interrupted",
  };
  const seen = new Set(
    [...CONVERTER_CODES, ...SOURCE_CODES_FOR_PREPARE].map((c) => prepareText(t, c)),
  );
  eq(seen.size, 4, "exactly the four kinds are reachable");

  // Every locale carries all four, none is the English string pasted through, and none of them
  // smuggles in a banned separator.
  const LOCALES = ["de", "es", "fr", "ja", "ko", "pl"];
  const en = readFileSync(join(here, "../../i18n/strings/sources.ts"), "utf8");
  const KEYS = [
    "errPrepareUnreadable", "errPrepareInput", "errPrepareCollision", "errPrepareInterrupted",
  ];
  const valueOf = (src, key) => {
    const at = src.indexOf(`${key}:`);
    if (at < 0) return undefined;
    const q = src.indexOf('"', at);
    let out = "";
    for (let i = q + 1; i < src.length; i++) {
      if (src[i] === "\\") { out += src[i + 1]; i++; continue; }
      if (src[i] === '"') break;
      out += src[i];
    }
    return out;
  };
  for (const key of KEYS) {
    const enVal = valueOf(en, key);
    assert(enVal && enVal.length > 0, `English ${key} missing`);
    for (const loc of LOCALES) {
      const src = readFileSync(join(here, `../../i18n/strings/sources.${loc}.ts`), "utf8");
      const val = valueOf(src, key);
      assert(val && val.length > 0, `${loc} is missing ${key}`);
      assert(val !== enVal, `${loc}:${key} is the English string pasted through`);
      assert(!val.includes("·") && !val.includes("—"), `${loc}:${key} uses a banned separator`);
    }
  }
});

// 25e. The collision sentence is the BOARD's, not a second wording. ModalNameCollision.dc.html
// draws "differ only in case" and "can hold only one of them"; reusing those exact clauses is
// what stops a modal and a one-liner telling the user two different things about one failure.
check("prepare: the collision sentence reuses the board's wording", () => {
  const board = readFileSync(
    join(here, "../../../../../../docs/design/mockups/ModalNameCollision.dc.html"),
    "utf8",
  );
  const en = readFileSync(join(here, "../../i18n/strings/sources.ts"), "utf8");
  const at = en.indexOf("errPrepareCollision:");
  const sentence = en.slice(at, en.indexOf("\n", en.indexOf('"', at) + 1));
  for (const clause of ["differ only in case", "can hold only one of them"]) {
    assert(board.includes(clause), `the board should still say "${clause}"`);
    assert(sentence.includes(clause), `the string should reuse "${clause}"`);
  }
});

// 25f. THE CODE SURVIVES. `convertFailed` keeps its untranslated `${reason}` shape because the
// activity log is where a maintainer reads the identifier. If someone "fixes" that key by
// mapping it too, the code stops reaching any bug report and this fails. Armed by mutation 5.
check("prepare: convertFailed stays the diagnostic form, so the log still carries the code", () => {
  const en = readFileSync(join(here, "../../i18n/strings/roms.ts"), "utf8");
  assert(
    /convertFailed: \(reason: string\) =>[^\n]*\$\{reason\}/.test(en),
    "convertFailed must still interpolate the raw reason",
  );
  const prep = readFileSync(join(here, "../prepareState.svelte.ts"), "utf8");
  assert(
    prep.includes("t.roms.selectGames.convertFailed, code"),
    "prepareState must still log the code through convertFailed",
  );
});

// 25g. The Configure panel renders no run verdict at all, the same rule the Library rows got.
// A refused TOOL still speaks, because that is the panel's own state and not a report on a run.
check("addfiles: the Configure panel carries no converter verdict", () => {
  const raw = readFileSync(join(here, "../../ui/AdditionalFiles.svelte"), "utf8");
  // Comments are stripped first: the replacement's own comment quotes `convertFailed("malformed")`
  // to record what it replaced, and a naive scan matches that instead of live code.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const gone of ["failuresForTitle", "noticesForTitle", "sourceFailures", "sourceNotices"]) {
    assert(!src.includes(gone), `${gone} must not come back to this panel`);
  }
  assert(!src.includes("filenote"), "the note style went with the notes");
  // The refused-tool line stays, and reads the code that was actually thrown rather than the
  // hardcoded "malformed" that produced the owner's German screenshot.
  assert(src.includes("rejectedToolCode"), "a refused tool is still reported");
  assert(
    !src.includes('convertFailed("malformed")'),
    "the fabricated code is gone",
  );
  assert(src.includes("prepareText(locale.t.sources, rejectedToolCode)"), "and it is mapped copy");
});

// 25h. THE REMOVED ROLL-UPS STAY REMOVED. `failuresForTitle`/`noticesForTitle` were the
// per-SOURCE views the Configure panel read; the panel reports on no run any more, so both had
// zero production callers. "Put a summary line back on the panel" is a reasonable-looking
// change that would quietly reintroduce them. The underlying `failures`/`notices` maps are NOT
// guarded away — the log reads them and `forgetSource` clears them.
check("prepare: the whole-title roll-ups are gone, the maps they read are not", () => {
  const raw = readFileSync(join(here, "../prepareState.svelte.ts"), "utf8");
  // Comments first: the removal note in that file names both helpers to record what it
  // replaced, so a naive scan matches the tombstone rather than a live definition.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const gone of ["failuresForTitle", "noticesForTitle"]) {
    assert(!src.includes(gone), `${gone} must not come back`);
  }
  assert(/\bfailures = \$state/.test(src), "the failures map still exists");
  assert(/\bnotices = \$state/.test(src), "the notices map still exists");
});

// 25i. NO CODE REACHES THE USER. The store's user-facing text is `prepareText` and nothing
// else; `convertFailed` — the key that interpolates a raw identifier — may appear only in the
// `auditLog.add` call. Armed by mutation: putting `convertFailed` back on the `text` line fails
// this even though the runtime checks above would still describe a real behaviour.
check("prepare: the store's user-facing text is mapped copy, the log's is the code", () => {
  const raw = readFileSync(join(here, "../prepareState.svelte.ts"), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert(/const text = prepareText\(/.test(src), "the user's line comes from prepareText");
  const hits = src.match(/convertFailed/g) ?? [];
  eq(hits.length, 1, "convertFailed survives exactly once, in the log call");
  assert(/auditLog\.add\([\s\S]{0,200}convertFailed/.test(src), "and that one is the audit-log call");
  // The signature `prepareText` deliberately does not have. A `detail` argument would put the
  // thrower's untrusted words back into the sentence.
  assert(
    !/prepareText\([^)]*detail/.test(src),
    "prepareText takes no detail — the detail belongs to the log",
  );
});

// 25j. BANNED CHARACTERS IN THE `convertUnrecognised` COPY, in every locale. An em-dash reached
// all seven files at once; the owner has struck both it and the middle dot from user-visible
// copy repeatedly. Checked per locale so a fix in English cannot mask a miss in Polish.
check("i18n: no locale's convertUnrecognised carries a banned character", () => {
  const dir = join(here, "../../i18n/strings");
  const files = ["roms.ts", "roms.de.ts", "roms.es.ts", "roms.fr.ts", "roms.ja.ts", "roms.ko.ts", "roms.pl.ts"];
  let seen = 0;
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    const at = src.indexOf("convertUnrecognised");
    assert(at !== -1, `${f} must define convertUnrecognised`);
    const line = src.slice(at, src.indexOf("\n", at));
    for (const banned of ["—", "–", "·"]) {
      assert(!line.includes(banned), `${f}: convertUnrecognised must not contain ${banned}`);
    }
    seen++;
  }
  eq(seen, 7, "all seven locales were actually read");
});

// 25k. NO RAW NUL BYTE IN SOURCE. `sources/outputNames.ts` carried one inside a template
// literal — a composite map-key separator written as the byte instead of the escape its sibling
// (`prepareState.svelte.ts`'s `NOTICE_SEP`) uses correctly. The consequence is not cosmetic:
// `grep` classifies such a file as BINARY and silently skips it, so any grep-based audit would
// report clean on a file it never read. Fixing the file beats teaching every future guard a
// workaround. (No guard in this repo was actually blind to it — they all use `readFileSync` —
// but that was luck, not design.)
// WIDENED after a second one appeared: `apps/web/test/sourceremoval.mjs` was written with the
// separator as a raw byte inside a template literal, and `git` reported the file as `Bin` on the
// diff that introduced it. Scoping the first guard to `src/lib/sources` is what let that through,
// so it now covers every hand-written source and suite file in apps/web.
check("no hand-written file in apps/web carries a raw NUL byte", () => {
  const roots = [join(here, "../../../.."), join(here, "..")];
  const bad = [];
  let scanned = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs|svelte|css|json)$/.test(e.name)) {
        scanned++;
        if (readFileSync(p).includes(0)) bad.push(p.slice(p.indexOf("apps/web")));
      }
    }
  };
  walk(join(here, "../../../../src"));
  walk(join(here, "../../../../test"));
  assert(scanned > 100, `the scan must actually walk the tree (saw ${scanned} files)`);
  eq(bad.join(","), "", "write the escape, not the byte");
});

await allChecks();
rmSync(out, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `converter host + install artifacts + file prompt + bundles + bios + error text + library summary: ${passed} checks passed`,
);
