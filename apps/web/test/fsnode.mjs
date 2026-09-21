/**
 * Does the directory-handle seam actually hold for a desktop build?
 *
 * `docs/ELECTRON.md` claims the app can read a real path through the same interface it uses for
 * a browser handle. A plan that says so proves nothing; this runs the REAL consumers —
 * `scanRomDirectory`, `walk` and `getValidRoot` from `romScan.ts`, not copies — against
 * `lib/fsNode.ts` over a temporary directory, and against the in-memory shim the browser
 * fallback already uses, and requires the two to agree.
 *
 * That comparison is the point. Either implementation alone could be self-consistently wrong;
 * agreeing with the shim that ships today is what makes the seam a fact rather than a promise.
 *
 * NOTE this is the first suite to exercise `walk()` at all — `coreregistry.mjs` stubs `romScan`
 * out entirely (`"romScan.js": "export const nativeFolderPickerSupported = () => true;"`), so
 * the recursion, the hidden-file rule and the `roms/` prefix strip were previously uncovered.
 */
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gnwResolveFor } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`  FAIL ${label}: got ${a}, want ${e}`);
  }
}
function ok(cond, label) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL ${label}`);
  }
}

// --- Build the real romScan, with only its store imports faked ---------------------------------
// `homebrew`/`coreRegistry` are reactive singletons that cannot load outside a browser. Every
// function under test is real; nothing about the walk or the root rule is stubbed.
const out = await mkdtemp(join(tmpdir(), "fsnode-build-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/romScan.ts")],
  outfile: join(out, "romScan.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url), {
    name: "romscan-fakes",
    setup(build) {
      const fakes = {
        // Only consulted inside a `homebrew/` directory; the fixtures below stay clear of it so
        // the walk's own rules, not these, decide every assertion.
        "homebrewTitles.svelte.js":
          "export const homebrew = { deviceFiles: new Set() };" +
          "export const isHomebrewSourceFile = () => false;",
        // `getValidRoot` takes a registry explicitly, so this only satisfies the import.
        "coreRegistry.svelte.js":
          "export const coreRegistry = { current: { systems: [], byFolder: new Map(), declaredFolders: new Set(), hasCoreSources: false } };",
        "debug.js": "export const dbg = () => {}; export const setDbgSink = () => {};",
        "util.js": "export const download = () => {};",
        // `pickSdCardFolder` reaches these through a DYNAMIC import, which keeps them out of
        // the app's initial chunk but not out of a bundle. Nothing here calls it; faking them
        // is what stops the whole device/transport graph (and its .bin and dapjs imports)
        // being dragged into a filesystem test.
        "device.svelte.js": "export const device = { sdHandle: null, scanSdCardGames: async () => {} };",
        "sdFolderPick.svelte.js": "export const runSdCardFolderPick = async () => {};",
      };
      build.onResolve(
        { filter: /(homebrewTitles\.svelte|coreRegistry\.svelte|device\.svelte|sdFolderPick\.svelte|debug|util)\.js$/ },
        (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "rs-fake" }),
      );
      build.onLoad({ filter: /.*/, namespace: "rs-fake" }, (a) => ({
        contents: fakes[a.path],
        loader: "js",
      }));
    },
  }],
});
const { scanRomDirectory, getValidRoot, dirSupportsWriteBack, buildTreeFromFileList, LazyRom, romBytes, pickRomFolder } = await import(
  pathToFileURL(join(out, "romScan.js")).href
);

// Firefox keeps directory-upload picker state per input control. ROM and SD picks must therefore
// use distinct IDs rather than two anonymous inputs sharing the same browser picker state.
const romScanSource = await import("node:fs/promises").then(({ readFile }) =>
  readFile(join(here, "../src/lib/romScan.ts"), "utf8"),
);
ok(/function pickFolderViaInput\(id: string\)/.test(romScanSource),
  "the fallback picker accepts a distinct picker id");
ok(/input\.id = id[\s\S]*input\.name = id/.test(romScanSource),
  "the fallback picker identifies ROM and SD controls separately");

await esbuild.build({
  entryPoints: [join(here, "../src/lib/fsNode.ts")],
  outfile: join(out, "fsNode.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: ["node:*"],
  logLevel: "warning",
});
const { nodeDirHandle } = await import(pathToFileURL(join(out, "fsNode.js")).href);

// --- A fixture written to a real directory -----------------------------------------------------
const root = await mkdtemp(join(tmpdir(), "fsnode-roms-"));
const files = {
  "roms/nes/mario.nes": [1, 2, 3],
  "roms/gbc/zelda.gbc": [4, 5, 6, 7],
  "roms/doom/doom.wad": [8, 9],
  "covers/mario.png": [10],
};
for (const [rel, bytes] of Object.entries(files)) {
  await mkdir(join(root, dirname(rel)), { recursive: true });
  await writeFile(join(root, rel), Buffer.from(bytes));
}
// Hidden entries the walk must skip, one file and one whole directory.
await writeFile(join(root, "roms/nes/.DS_Store"), Buffer.from([0]));
await mkdir(join(root, ".git"), { recursive: true });
await writeFile(join(root, ".git/HEAD"), Buffer.from([0]));

console.log("fsNode: the seam, driven through the real romScan\n");

// --- 1. The real scan over a real path ---------------------------------------------------------
const scanned = await scanRomDirectory(nodeDirHandle(root));
const keys = [...scanned.userRoms.keys()].sort();

eq(keys, ["covers/mario.png", "doom/doom.wad", "gbc/zelda.gbc", "nes/mario.nes"],
  "a real directory scans to the same keys a browser handle produces, with `roms/` stripped");
ok(scanned.hasRomsPrefix === true, "the `roms/` prefix is detected on a real path");
eq([...scanned.userRoms.get("nes/mario.nes")], [1, 2, 3],
  "the bytes arrive intact through node's File");
eq(scanned.userRoms.get("gbc/zelda.gbc").length, 4, "and so does the length of another");
ok(!keys.some((k) => k.includes(".DS_Store")), "a hidden FILE is skipped, as in the browser");
ok(!keys.some((k) => k.includes("HEAD")), "a hidden DIRECTORY is not recursed into");
eq(scanned.summary.totalFiles, 4, "the summary counts what the walk kept");
eq(scanned.summary.totalBytes, 10, "and sums their real bytes");

// --- 2. Agreement with the shim that ships today -----------------------------------------------
// `buildInputDirTree` is what Firefox and Safari already use. Feeding it the same fixture and
// requiring an identical result is what proves this is the same seam and not a parallel one.
const asFileList = Object.entries(files).map(([rel, bytes]) => {
  const f = new File([new Uint8Array(bytes)], rel.slice(rel.lastIndexOf("/") + 1));
  Object.defineProperty(f, "webkitRelativePath", { value: `picked/${rel}` });
  return f;
});
const shimRoot = buildTreeFromFileList(asFileList);
const viaShim = await scanRomDirectory(shimRoot);

eq([...viaShim.userRoms.keys()].sort(), keys,
  "the browser shim and a real path agree on every key");
eq(viaShim.summary.totalBytes, scanned.summary.totalBytes,
  "and on every byte, so the seam is one seam");
ok(viaShim.userRoms.get("nes/mario.nes") instanceof LazyRom,
  "the browser shim wraps files in LazyRom so scanning does not read file contents eagerly");
eq([...await romBytes(viaShim.userRoms.get("nes/mario.nes"))], [1, 2, 3],
  "inflating via romBytes yields the file bytes intact");

// --- 3. Write-back is what actually differs ----------------------------------------------------
// The shim is read-only and the app already branches on that (`dirSupportsWriteBack`), which is
// the ZIP fallback the desktop build removes the need for.
ok(dirSupportsWriteBack(shimRoot) === false,
  "the browser shim reports no write-back, which is why the ZIP fallback exists");

// --- 4. The root rule, unchanged -----------------------------------------------------------------
// A registry that declares `nes` accepts the folder through its `roms/` child; an empty registry
// with no core sources falls back to the legacy table, which also knows `nes`.
const reg = {
  systems: [{ folder: "nes" }],
  byFolder: new Map([["nes", { folder: "nes" }]]),
  declaredFolders: new Set(["nes"]),
  hasCoreSources: true,
};
ok((await getValidRoot(nodeDirHandle(root), reg)) !== null,
  "getValidRoot accepts a real directory whose roms/ holds a declared console");

const barren = await mkdtemp(join(tmpdir(), "fsnode-barren-"));
await mkdir(join(barren, "photos"), { recursive: true });
ok((await getValidRoot(nodeDirHandle(barren), reg)) === null,
  "and refuses one that holds no console directory at all");

const homebrewOnly = await mkdtemp(join(tmpdir(), "fsnode-homebrew-"));
await mkdir(join(homebrewOnly, "homebrews"), { recursive: true });
await writeFile(join(homebrewOnly, "homebrews/OpenLara.bin"), Buffer.from([1, 2, 3]));
ok((await getValidRoot(nodeDirHandle(homebrewOnly), reg)) !== null,
  "accepts an SD root containing only the manifest homebrew directory");

// --- 5. A symlink is skipped, not followed -------------------------------------------------------
// Not a browser concern; a real path can contain a loop, and a scan that hangs is worse than one
// that misses a file.
const linked = await mkdtemp(join(tmpdir(), "fsnode-link-"));
await mkdir(join(linked, "nes"), { recursive: true });
await writeFile(join(linked, "nes/real.nes"), Buffer.from([1]));
let symlinkSupported = true;
try {
  await symlink(linked, join(linked, "nes/loop"), "dir");
} catch {
  symlinkSupported = false;
}
if (symlinkSupported) {
  const looped = await scanRomDirectory(nodeDirHandle(linked));
  eq([...looped.userRoms.keys()], ["nes/real.nes"],
    "a symlinked directory is skipped rather than followed into a loop");
} else {
  console.log("  (symlink unsupported here; loop check skipped)");
}

await rm(root, { recursive: true, force: true });
await rm(barren, { recursive: true, force: true });
await rm(linked, { recursive: true, force: true });
await rm(out, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\nfsNode: ${checks - failures} passed, ${failures} FAILED`);
  process.exit(1);
}
console.log(`fsNode: ${checks} checks passed`);
