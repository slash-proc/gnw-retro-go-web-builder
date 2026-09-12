/**
 * Removing a source lets go of everything it was the reason for.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/sourceremoval.mjs'
 *
 * The owner: "I added and removed a few homebrew several times and the Library page didn't
 * remove them correctly and show the majority of the data still being there."
 *
 * `sources.remove()` tidied the row, the bundle bytes, the download and the dismissal, and
 * nothing else heard. `prepareState` kept the source's prepared files in `assets` with their
 * provenance in `produced`, and the Library sums bytes BY provenance -- so a removed source
 * went on being counted, and each add/remove cycle orphaned another set. Same root as the size
 * bug from the other side: provenance outliving the thing it belonged to.
 *
 * The seam under test is `sourceRemoval.ts`'s module-level announcement: the store says a
 * source is gone, `prepareState` is the only thing listening, and the store still knows nothing
 * about what anyone else was keeping. `prepareState`, `blobCache`, `convertedCache` and
 * `sourceRemoval` are therefore compiled in ONE splitting build -- a second build would hand
 * the subscriber a private copy of the registry and the announcement would go nowhere.
 *
 * WHAT THIS CANNOT PROVE. Every suite in this repo stubs runes as identity functions
 * (`define: { $state: "__rune" }`), so a `$derived` re-running is not observable here. These
 * checks pin the STORE rule -- that the bytes, their provenance and their pointers are gone.
 * That the Library row disappears without a reload rests on the `assets` reassignment the store
 * does for every other mutation, and only a human can confirm it on screen.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = new URL(".", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "gwrg-srcremove-"));
const failures = [];
let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}
function eq(a, b, msg) {
  if (Array.isArray(a) && Array.isArray(b)) {
    a = JSON.stringify(a);
    b = JSON.stringify(b);
  }
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// --- Build -------------------------------------------------------------------------------------

const { gnwResolve } = await import("./gnwResolve.mjs");

// Only what reaches OUT of the process is faked: the converter (worker + WASM), the artifact
// fetch (network) and the locale table. The announcement, the provenance bookkeeping and the
// persisted pointer index all stay real.
const fake = {
  "homebrewConvert.js":
    "export async function convertHomebrewTitle(t, f) { return globalThis.__srFakes.convert(t, f); }",
  "installArtifacts.js":
    "export async function fetchTargetArtifacts(t) { return globalThis.__srFakes.artifacts(t); }",
  "locale.svelte.js":
    "export const locale = { t: { roms: { selectGames: {" +
    " convertFailed: (c) => `CF|${c}`, convertUnrecognised: (f) => `UR|${f}` } } } };",
};

const src = join(here, "../src/lib/sources");
await esbuild.build({
  entryPoints: [
    join(src, "prepareState.svelte.ts"),
    join(src, "blobCache.ts"),
    join(src, "convertedCache.ts"),
    join(src, "sourceRemoval.ts"),
  ],
  outdir: join(out, "store"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [
    gnwResolve(join(here, ".")),
    {
      name: "srcremove-fakes",
      setup(build) {
        build.onResolve({ filter: /(homebrewConvert|installArtifacts|locale\.svelte)\.js$/ }, (a) => ({
          path: a.path.slice(a.path.lastIndexOf("/") + 1),
          namespace: "sr-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "sr-fake" }, (a) => ({
          contents: fake[a.path],
          loader: "js",
        }));
      },
    },
  ],
});

const { prepareState } = await import(pathToFileURL(join(out, "store", "prepareState.svelte.js")).href);
const { announceSourceRemoved } = await import(pathToFileURL(join(out, "store", "sourceRemoval.js")).href);
const { localConvertedIndex } = await import(pathToFileURL(join(out, "store", "convertedCache.js")).href);

// --- Fixtures ----------------------------------------------------------------------------------

const bytes = (n, fill) => new Uint8Array(n).fill(fill);

globalThis.__srFakes = {
  convert: async () => ({ files: new Map(), unrecognised: [], warnings: [] }),
  artifacts: async () => new Map(),
};

/** A localStorage that behaves, so `removed` and the converted pointer are really exercised. */
function fakeStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
  return map;
}

function title({ repo = "o/r", id = "t", artifacts = [], hasTool = true } = {}) {
  return {
    key: `${repo}#${id}`,
    repo,
    targetId: id,
    label: id,
    displayName: id,
    deviceFiles: [],
    sourceExtensions: [],
    selfContained: false,
    promptsForInput: true,
    isCore: false,
    ...(hasTool
      ? {
          tool: {
            id: "conv",
            binary: { sha256: "a".repeat(64) },
            inputs: [{ id: "base" }],
            outputs: [],
            limits: {},
            processor: {},
          },
        }
      : {}),
    target: { id, kind: "homebrew", artifacts },
  };
}

const offer = (filename, inputId = "base") => ({
  inputId,
  filename,
  bytes: bytes(8, 1),
  variant: undefined,
  recognised: false,
});

/** Prepare a title for real, through `run()`, so provenance is recorded the way it really is. */
async function prepare(t, { artifacts = new Map(), converted = new Map(), offered = [offer("in.rom")] } = {}) {
  globalThis.__srFakes.artifacts = async () => artifacts;
  globalThis.__srFakes.convert = async () => ({ files: converted, unrecognised: [], warnings: [] });
  return prepareState.run(t, offered);
}

const assetKeys = () => [...prepareState.assets.keys()].sort();

function reset() {
  prepareState.assets = new Map();
  prepareState.notices = new Map();
  prepareState.failures = new Map();
  prepareState.supplied = new Map();
  prepareState.discovered = new Map();
  prepareState.discoveredUnrecognised = new Map();
  prepareState.removed = new Set();
  prepareState.extracting = new Set();
  prepareState.extractingFiles = new Map();
  return fakeStorage();
}

// --- 1. THE OWNER'S CASE ------------------------------------------------------------------------

await check("removing a source drops the bytes it prepared", async () => {
  reset();
  const t = title();
  await prepare(t, { converted: new Map([["out.bin", bytes(16, 7)]]) });
  eq(prepareState.preparedSize("homebrew", "out.bin"), 16, "prepared before the removal");

  announceSourceRemoved("o/r");
  eq(prepareState.preparedSize("homebrew", "out.bin"), undefined, "and gone after it");
  eq(assetKeys().length, 0, "nothing left in assets");
  eq(prepareState.preparedBytesFor(t.key), undefined, "and no provenance claiming it");
});

await check("its verdicts go with it", async () => {
  reset();
  const t = title();
  await prepare(t, {
    converted: new Map([["out.bin", bytes(16, 7)]]),
    offered: [offer("in.rom")],
  });
  prepareState.notices = new Map([[t.key, ["something happened"]]]);
  prepareState.failures = new Map([[`${t.key}\u0000in.rom`, "it broke"]]);

  announceSourceRemoved("o/r");
  eq(prepareState.notices.size, 0, "no notice survives a source that is gone");
  eq(prepareState.failures.size, 0, "and no failure either");
});

await check("its inputs stop being satisfied", async () => {
  reset();
  const t = title();
  await prepare(t);
  prepareState.discovered = new Map([["o/r#base", [offer("found.rom")]]]);
  ok(prepareState.isSatisfied("o/r", "base"), "satisfied before the removal");

  announceSourceRemoved("o/r");
  ok(!prepareState.isSatisfied("o/r", "base"), "and unsatisfied after it");
});

// --- 2. ONLY THAT SOURCE ------------------------------------------------------------------------

await check("a second source keeps everything of its own", async () => {
  reset();
  const mine = title({ repo: "o/mine", id: "a" });
  const yours = title({ repo: "o/yours", id: "b" });
  await prepare(mine, { converted: new Map([["mine.bin", bytes(16, 7)]]) });
  await prepare(yours, { converted: new Map([["yours.bin", bytes(32, 9)]]) });
  prepareState.notices = new Map([[yours.key, ["kept"]]]);
  prepareState.discovered = new Map([["o/yours#base", [offer("found.rom")]]]);

  announceSourceRemoved("o/mine");

  eq(prepareState.preparedSize("homebrew", "mine.bin"), undefined, "the removed source's bytes went");
  eq(prepareState.preparedSize("homebrew", "yours.bin"), 32, "the other source's did not");
  eq(prepareState.preparedBytesFor(yours.key), 32, "nor its provenance");
  eq(prepareState.notices.size, 1, "nor its verdicts");
  ok(prepareState.isSatisfied("o/yours", "base"), "nor its satisfied input");
});

await check("a repo whose name merely starts the same is not caught", async () => {
  reset();
  // `o/r` and `o/rr` share a prefix as bare strings; the separator is what makes them distinct.
  const short = title({ repo: "o/r", id: "a" });
  const longer = title({ repo: "o/rr", id: "b" });
  await prepare(short, { converted: new Map([["short.bin", bytes(16, 7)]]) });
  await prepare(longer, { converted: new Map([["longer.bin", bytes(32, 9)]]) });

  announceSourceRemoved("o/r");
  eq(prepareState.preparedSize("homebrew", "short.bin"), undefined, "the named source went");
  eq(prepareState.preparedSize("homebrew", "longer.bin"), 32, "the similarly named one stayed");
});

// --- 3. WHAT SURVIVES, AND WHAT DELIBERATELY DOES NOT -------------------------------------------

await check("an explicit per-input removal on ANOTHER source survives", async () => {
  reset();
  const t = title({ repo: "o/keep", id: "a" });
  await prepare(t);
  prepareState.unsupply("o/keep", "base", [t]);
  ok(prepareState.isRemoved("o/keep", "base"), "removed before");

  announceSourceRemoved("o/gone");
  ok(prepareState.isRemoved("o/keep", "base"), "and still removed after an unrelated source went");
});

await check("the removed source's own removals go, so a re-add is not half-restored", async () => {
  reset();
  const t = title();
  await prepare(t);
  prepareState.unsupply("o/r", "base", [t]);
  ok(prepareState.isRemoved("o/r", "base"), "removed before");

  announceSourceRemoved("o/r");
  ok(
    !prepareState.isRemoved("o/r", "base"),
    "a removal scoped to a source cannot outlive the source -- re-adding must start clean",
  );
});

await check("a run left in flight does not leave the title busy forever", async () => {
  reset();
  const t = title();
  prepareState.extracting = new Set([t.key]);
  prepareState.extractingFiles = new Map([[t.key, new Set(["in.rom"])]]);

  announceSourceRemoved("o/r");
  ok(!prepareState.extracting.has(t.key), "not extracting");
  ok(!prepareState.extractingFiles.has(t.key), "and nothing left claiming to be");
});

// --- 4. THE PERSISTED POINTER -------------------------------------------------------------------

await check("the converted pointer is pruned for that source only", async () => {
  reset();
  const index = localConvertedIndex();
  const entry = (repo) => ({
    sig: "s",
    tool: "a".repeat(64),
    repo,
    inputs: ["base"],
    files: { "out.bin": "b".repeat(64) },
    warnings: [],
    unrecognised: [],
  });
  index.set("o/gone#a", entry("o/gone"));
  index.set("o/stay#b", entry("o/stay"));

  announceSourceRemoved("o/gone");

  eq(index.get("o/gone#a"), null, "the removed source's pointer is gone");
  ok(index.get("o/stay#b") !== null, "and the other source's is not");
});

await check("the entry's own repo field agrees with the key it is filed under", async () => {
  reset();
  const index = localConvertedIndex();
  index.set("o/gone#a", {
    sig: "s",
    tool: "a".repeat(64),
    repo: "o/gone",
    inputs: ["base"],
    files: { "out.bin": "b".repeat(64) },
    warnings: [],
    unrecognised: [],
  });
  for (const [key, e] of index.entries()) {
    ok(key.startsWith(`${e.repo}#`), `key ${key} does not sit under its own repo ${e.repo}`);
  }
});

// --- 5. ADD, REMOVE, ADD ------------------------------------------------------------------------

await check("add / remove / add leaves exactly one clean set", async () => {
  reset();
  const t = title();
  // Each cycle converts a DIFFERENTLY named output on purpose. Re-preparing the same filename
  // would overwrite its own key in `assets`, so the count would read 1 whether or not anything
  // was ever cleaned up -- the check would pass against the very bug it is here to catch.
  for (const name of ["one.bin", "two.bin", "three.bin"]) {
    await prepare(t, { converted: new Map([[name, bytes(16, 7)]]) });
    if (name !== "three.bin") announceSourceRemoved("o/r");
  }

  eq(assetKeys(), ["homebrew/three.bin"], "only the surviving cycle's file, not one per cycle");
  eq(prepareState.preparedBytesFor(t.key), 16, "and its size is one file's worth");
});

// --- 6. THE WIRING ------------------------------------------------------------------------------

// Every check above drives the listener directly, which proves what `forgetSource` does and
// nothing about whether anything calls it. The store cannot be imported here -- it would drag
// the curated import, the client and the auto-downloader into this build to read one line -- so
// the connection is pinned by shape instead. That is weaker than behaviour and is why it is
// stated: if `remove()` is ever restructured, this has to be re-read rather than trusted.
await check("`sources.remove()` announces, so the listener is reachable at all", async () => {
  const { readFileSync } = await import("node:fs");
  const store = readFileSync(join(here, "../src/lib/sources/store.svelte.ts"), "utf8");
  const body = store.slice(store.indexOf("\n  remove(repo: string): void {"));
  const end = body.indexOf("\n  }");
  ok(end > 0, "could not find the end of remove()");
  ok(
    body.slice(0, end).includes("announceSourceRemoved(repo)"),
    "remove() does not announce, so nothing lets go of what the source left behind",
  );
});

// --- Report -------------------------------------------------------------------------------------

if (failures.length) {
  console.log(`source removal: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`source removal: ${passed} checks passed`);
