#!/usr/bin/env node
/**
 * Moving a card's legacy `roms/homebrew` to the manifest's `/homebrews`.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/sdhomebrewmove.mjs'
 *
 * WHY THIS EXISTS. The move deletes files off a user's SD card, and the directory it deletes
 * from is where an OLDER firmware looks. Two things therefore have to hold and neither is
 * observable from the UI: the offer must not appear when the layout cannot be established, and
 * no source may be removed before its copy is on the card and verified.
 *
 * The whole suite drives the REAL module against an in-memory directory tree, so the copy,
 * the read-back and the delete are the ones that ship. A mock of the module's own logic would
 * assert nothing; the fixture stands in for the card, not for the code.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gnwResolveFor } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));

let checks = 0;
const failures = [];
const ok = (cond, label) => {
  checks++;
  if (!cond) failures.push(label);
};
const eq = (got, want, label) =>
  ok(
    JSON.stringify(got) === JSON.stringify(want),
    `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
function report(e) {
  if (e) console.error(e);
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(
    failures.length
      ? `\nsd homebrew move: ${checks - failures.length} passed, ${failures.length} failed`
      : `\nsd homebrew move: ${checks} checks passed`,
  );
  process.exit(failures.length || e ? 1 : 0);
}
process.on("uncaughtException", report);
process.on("unhandledRejection", report);

// --- build the real module --------------------------------------------------------------------
const out = mkdtempSync(join(tmpdir(), "sdhbmove-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sdHomebrewMigration.ts")],
  outfile: join(out, "mig.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url)],
});
// `persist.ts` writes the decline through the global `localStorage`, which node does not have;
// without this the decline silently no-ops and section 5 would pass whatever the module did.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// The marker's CRC, from the same implementation the parser uses. A second implementation here
// could agree with itself and disagree with the module, which is the shape of a vacuous fixture.
await esbuild.build({
  stdin: {
    contents: 'export { superblockCrc32 } from "@gnw/gnw-patch";',
    resolveDir: join(here, ".."),
    loader: "ts",
  },
  outfile: join(out, "crc.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url)],
});

const mig = await import(pathToFileURL(join(out, "mig.js")).href);
const {
  LEGACY_HOMEBREW_DIR,
  scanLegacyHomebrew,
  readyToMove,
  moveLegacyHomebrew,
  removeLegacyDirIfEmpty,
  hasDeclinedMove,
  rememberDeclinedMove,
  movePlan,
  moveDestination,
  cardHomebrewLayout,
  readsModernLayout,
  CARD_MARKER_PATH,
} = mig;

// Armed: the stub above has to actually reach `persist.ts`, or the decline checks are vacuous.
rememberDeclinedMove("__probe__");
if (!hasDeclinedMove("__probe__")) {
  console.error("the localStorage stub did not take; the decline checks would pass whatever the module did.");
  process.exit(1);
}

// Armed: if the module stops exporting the gate, every check below would vacuously pass.
if (typeof readyToMove !== "function" || typeof moveLegacyHomebrew !== "function" || typeof cardHomebrewLayout !== "function") {
  console.error("sdHomebrewMigration no longer exports readyToMove/moveLegacyHomebrew; this suite cannot test what it claims to.");
  process.exit(1);
}
eq(LEGACY_HOMEBREW_DIR, "roms/homebrew", "the legacy directory is the pre-manifest default");

// --- an in-memory card ------------------------------------------------------------------------
// Files are Uint8Array; directories are Maps. The handles are the FSAA surface the module uses
// and nothing more, so a method it starts relying on shows up as a TypeError here rather than
// as a silent pass.
const MODERN = "homebrews";

/**
 * Every FSAA operation the module issues, in order. The ordering checks read THIS rather than
 * the end state: an implementation that deleted every source first and then copied would leave
 * exactly the same card behind, and would be catastrophic if interrupted.
 */
const opLog = [];

function makeDir(name, entries = new Map()) {
  const self = {
    kind: "directory",
    name,
    _entries: entries,
    async *entries() {
      for (const [k, v] of [...self._entries]) yield [k, v];
    },
    async getDirectoryHandle(n, opts) {
      const hit = self._entries.get(n);
      if (hit && hit.kind === "directory") return hit;
      if (hit) throw new Error(`${n} is a file`);
      if (!opts?.create) throw new Error(`NotFound: ${n}`);
      const made = makeDir(n);
      self._entries.set(n, made);
      return made;
    },
    async getFileHandle(n, opts) {
      const hit = self._entries.get(n);
      if (hit && hit.kind === "file") return hit;
      if (hit) throw new Error(`${n} is a directory`);
      if (!opts?.create) throw new Error(`NotFound: ${n}`);
      const made = makeFile(n, new Uint8Array(0));
      self._entries.set(n, made);
      return made;
    },
    async removeEntry(n) {
      opLog.push(`remove ${name}/${n}`);
      if (!self._entries.delete(n)) throw new Error(`NotFound: ${n}`);
    },
  };
  return self;
}

function makeFile(name, bytes, opts = {}) {
  const self = {
    kind: "file",
    name,
    _bytes: bytes,
    async getFile() {
      if (opts.unreadable) throw new Error("unreadable");
      return {
        size: self._bytes.length,
        async arrayBuffer() {
          return self._bytes.buffer.slice(self._bytes.byteOffset, self._bytes.byteOffset + self._bytes.length);
        },
      };
    },
    async createWritable() {
      let buf = new Uint8Array(0);
      return {
        async write(d) {
          if (opts.failWrite) throw new Error("write failed");
          buf = d instanceof Uint8Array ? d : new Uint8Array(d);
        },
        async close() {
          // `truncate` models a card that accepts the write and stores less than it was given,
          // which is exactly the case the read-back exists to catch.
          self._bytes = opts.truncate ? buf.slice(0, Math.max(0, buf.length - 1)) : buf;
          opLog.push(`wrote ${name}`);
        },
      };
    },
  };
  return self;
}

/** Build a card from a flat `{ "roms/homebrew/a.bin": Uint8Array }` map. */
function card(files, fileOpts = {}) {
  const root = makeDir("GNW-SD");
  for (const [path, bytes] of Object.entries(files)) {
    const parts = path.split("/");
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!dir._entries.has(parts[i])) dir._entries.set(parts[i], makeDir(parts[i]));
      dir = dir._entries.get(parts[i]);
    }
    const base = parts[parts.length - 1];
    dir._entries.set(base, makeFile(base, bytes, fileOpts[path] ?? {}));
  }
  return root;
}

/** Every file path on the card, for asserting what survived. */
async function listAll(dir, prefix = "") {
  const out = [];
  for await (const [name, h] of dir.entries()) {
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (h.kind === "directory") out.push(...(await listAll(h, rel)));
    else out.push(rel);
  }
  return out.sort();
}

const b = (n, fill = 7) => new Uint8Array(n).fill(fill);

/** A card whose firmware reads the modern directory, for the sections that are not about the gate. */
const MODERN_FW = { known: true, gitTag: "v1.4.1", homebrew: "homebrews" };

// --- 1. THE GATE: WHAT THE CARD'S OWN FIRMWARE READS ------------------------------------------
// The whole feature turns on one question, and `deviceInstallPaths()` is not allowed to answer
// it -- it reports where the NEWEST PUBLISHED firmware puts homebrew, which is a different
// card's worth of truth. The gate reads `data/INSTALL` off the card instead and resolves that
// build's own manifest.

/** A marker the parser accepts, carrying `gitTag`. Built to the layout installMarker.ts documents. */
function marker(gitTag, { magic = 0x4e494752, version = 1, corruptCrc = false } = {}) {
  const bytes = new Uint8Array(76);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, magic, true);
  dv.setUint8(4, version);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  new TextEncoder().encodeInto(gitTag, bytes.subarray(20, 68));
  dv.setUint32(72, crc32Of(bytes), true);
  if (corruptCrc) dv.setUint32(72, 0xdeadbeef, true);
  return bytes;
}
// The marker's CRC is `superblockCrc32` over the record with the field zeroed. Rather than
// reimplement it (a second implementation could agree with itself and not with the parser), the
// real one is imported from the same package the module uses.
const { superblockCrc32 } = await import(
  pathToFileURL(join(out, "crc.js")).href
);
function crc32Of(bytes) {
  const zeroed = bytes.slice(0, 76);
  new DataView(zeroed.buffer).setUint32(72, 0, true);
  return superblockCrc32(zeroed);
}

const lookup = (file, paths) => ({
  readCardFile: async (p) => (p === CARD_MARKER_PATH ? file : null),
  pathsForGitTag: async () => paths,
});

{
  const layout = await cardHomebrewLayout(lookup(marker("v1.4.1"), { homebrew: MODERN }));
  eq(layout, { known: true, gitTag: "v1.4.1", homebrew: MODERN }, "the card names its firmware and that firmware's homebrew directory");
  ok(readsModernLayout(layout), "and that directory is not the legacy one");
}

{
  // THE SAFETY PAIR. These two cards are identical on disk; only the firmware differs, and that
  // is the entire difference between a safe move and deleting somebody's homebrew.
  const files = { "roms/homebrew/celeste.bin": b(10) };

  const modernFw = await cardHomebrewLayout(lookup(marker("v1.4.1"), { homebrew: MODERN }));
  const modernScan = await scanLegacyHomebrew(card(files), modernFw.homebrew);
  eq(
    readyToMove(modernScan, "CARD-A", modernFw, MODERN),
    "offer",
    "A CARD HOLDING ONLY THE LEGACY DIRECTORY IS OFFERED when its firmware reads /homebrews: " +
      "that card is exactly the one this feature exists for, and an earlier gate excluded it",
  );

  const legacyFw = await cardHomebrewLayout(lookup(marker("v1.0.0"), { homebrew: "roms/homebrew" }));
  ok(legacyFw.known, "the older firmware is placed just as well");
  ok(!readsModernLayout(legacyFw), "it simply reads somewhere else");
  const legacyScan = await scanLegacyHomebrew(card(files), legacyFw.homebrew);
  eq(
    readyToMove(legacyScan, "CARD-A", legacyFw, MODERN),
    "firmware-wants-legacy",
    "AND THE SAME CARD IS REFUSED when its firmware still reads roms/homebrew: moving would " +
      "hide the homebrew from the build actually running",
  );
}

// AN UNRESOLVABLE MARKER STILL OFFERS. This block used to assert the opposite, and the owner
// overruled it: a firmware built from a local branch carries a gitTag no published release
// matches, so requiring the marker to resolve silenced the feature permanently for every dev
// build. The marker still reports honestly WHY it could not answer -- that part is unchanged and
// still asserted -- it just no longer decides whether to ask.
{
  const cases = [
    ["no marker on the card", { readCardFile: async () => null, pathsForGitTag: async () => ({ homebrew: MODERN }) }, "no-marker"],
    ["a marker with the wrong magic", lookup(marker("v1.4.1", { magic: 0x41414141 }), { homebrew: MODERN }), "no-marker"],
    ["a marker with an unknown version", lookup(marker("v1.4.1", { version: 9 }), { homebrew: MODERN }), "no-marker"],
    ["a marker whose CRC does not check out", lookup(marker("v1.4.1", { corruptCrc: true }), { homebrew: MODERN }), "no-marker"],
    ["a card the reader throws on", { readCardFile: async () => { throw new Error("card pulled"); }, pathsForGitTag: async () => ({ homebrew: MODERN }) }, "no-marker"],
    ["a tag no published release carries", lookup(marker("v9.9.9"), null), "no-release"],
    ["no network", { readCardFile: async () => marker("v1.4.1"), pathsForGitTag: async () => { throw new Error("offline"); } }, "lookup-failed"],
  ];
  for (const [label, lu, why] of cases) {
    const layout = await cardHomebrewLayout(lu);
    eq(layout, { known: false, why }, `the marker reports honestly why it could not answer: ${label}`);
    // A card with only the legacy directory -- no /homebrews -- which is the owner's main case.
    const scan = await scanLegacyHomebrew(card({ "roms/homebrew/a.bin": b(4) }), MODERN);
    eq(
      readyToMove(scan, "CARD-X", layout, MODERN),
      "offer",
      `AN UNRESOLVABLE MARKER STILL OFFERS, because the card's own layout is the evidence: ${label}`,
    );
  }
}

// The destination when the marker cannot answer, and the one case where there is none.
{
  const unresolved = { known: false, why: "no-release" };
  eq(
    moveDestination(unresolved, { homebrew: MODERN }),
    MODERN,
    "with no marker the current release's declared path is the destination",
  );
  eq(
    moveDestination({ known: true, gitTag: "v1.2.3", homebrew: "somewhere-else" }, { homebrew: MODERN }),
    "somewhere-else",
    "A RESOLVED MARKER WINS: the card moves to its own firmware's directory, not the newest one",
  );
  eq(
    moveDestination(unresolved, { homebrew: "roms/homebrew" }),
    null,
    "NOWHERE TO MOVE TO when nothing has been learned and the only path is the legacy directory " +
      "itself; a move onto itself is not a move",
  );
  const scan = await scanLegacyHomebrew(card({ "roms/homebrew/a.bin": b(4) }), MODERN);
  eq(
    readyToMove(scan, "CARD-Y", unresolved, null),
    "nothing-to-move",
    "and that is withheld rather than copying every file over itself",
  );
}

{
  const modernFw = { known: true, gitTag: "v1.4.1", homebrew: MODERN };
  const root = card({ "homebrews/celeste.bin": b(10) });
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(readyToMove(scan, "CARD-C", modernFw, MODERN), "nothing-to-move", "an already-migrated card is not asked");
  ok(!scan.legacyDirExists, "because it has no legacy directory at all");
}

// The destination directory is NOT created by looking: a declined or failed run must leave no
// empty `/homebrews` behind.
{
  const root = card({ "roms/homebrew/a.bin": b(4) });
  await scanLegacyHomebrew(root, MODERN);
  const names = [];
  for await (const [n] of root.entries()) names.push(n);
  ok(!names.includes(MODERN), `SCANNING CREATES NOTHING: got ${JSON.stringify(names)}`);
}

// --- 2. NOTHING IS DELETED BEFORE ITS COPY EXISTS ---------------------------------------------

{
  const root = card({
    "roms/homebrew/celeste.bin": b(10, 1),
    "roms/homebrew/sub/deep.bin": b(6, 2),
    "homebrews/keep.bin": b(4, 3),
  });
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(scan.movable.map((f) => f.rel).sort(), ["celeste.bin", "sub/deep.bin"], "a subdirectory comes along");
  eq(scan.movable.find((f) => f.rel === "sub/deep.bin").to, "homebrews/sub/deep.bin", "and keeps its subdirectory");

  const results = await moveLegacyHomebrew(root, scan.movable, MODERN);
  eq(results.map((r) => r.outcome), ["moved", "moved"], "both files moved");
  eq(
    await listAll(root),
    ["homebrews/celeste.bin", "homebrews/keep.bin", "homebrews/sub/deep.bin"],
    "the files are at the new location and gone from the old one",
  );
  const moved = await (await (await root.getDirectoryHandle("homebrews")).getFileHandle("celeste.bin")).getFile();
  eq(moved.size, 10, "the copy carries the source's bytes");
  eq(await removeLegacyDirIfEmpty(root), true, "the emptied legacy directory is removed");
  eq(await listAll(root), ["homebrews/celeste.bin", "homebrews/keep.bin", "homebrews/sub/deep.bin"], "and nothing else went with it");
}

{
  // The card stores less than it was handed. The read-back catches it and the SOURCE SURVIVES.
  const root = card(
    { "roms/homebrew/celeste.bin": b(10), "homebrews/keep.bin": b(4) },
    { "roms/homebrew/celeste.bin": {} },
  );
  // Make the DESTINATION truncate: it is created on demand, so patch the parent's factory by
  // pre-creating a truncating file at the destination name is not possible without occupying
  // it. Instead fail the write itself, which is the same contract: no delete without a copy.
  const legacy = await (await root.getDirectoryHandle("roms")).getDirectoryHandle("homebrew");
  const src = await legacy.getFileHandle("celeste.bin");
  const realCreate = src.createWritable;
  void realCreate;
  const modern = await root.getDirectoryHandle("homebrews");
  const origGetFile = modern.getFileHandle.bind(modern);
  modern.getFileHandle = async (n, opts) => {
    const h = await origGetFile(n, opts);
    if (n === "celeste.bin") {
      h.createWritable = async () => ({
        async write() {},
        async close() {
          h._bytes = new Uint8Array(3); // short write, silently accepted by the card
        },
      });
    }
    return h;
  };

  const scan = await scanLegacyHomebrew(root, MODERN);
  const results = await moveLegacyHomebrew(root, scan.movable, MODERN);
  eq(results.map((r) => r.outcome), ["failed"], "a short copy is a failure, not a move");
  ok(
    /copy does not match the source \(3 of 10 bytes\)/.test(results[0].error ?? ""),
    `the read-back names the mismatch: ${results[0].error}`,
  );
  const survived = await listAll(root);
  ok(
    survived.includes("roms/homebrew/celeste.bin"),
    `THE SOURCE SURVIVES A FAILED COPY: got ${JSON.stringify(survived)}`,
  );
  ok(
    !survived.includes("homebrews/celeste.bin"),
    `THE HALF-WRITTEN COPY IS REMOVED, so the next run cannot read it as a finished ` +
      `migration: got ${JSON.stringify(survived)}`,
  );
  eq(await removeLegacyDirIfEmpty(root), false, "and its directory stays, because it is not empty");
}

{
  // A write that throws outright. Same contract.
  const root = card(
    { "roms/homebrew/celeste.bin": b(10), "homebrews/keep.bin": b(4) },
  );
  const modern = await root.getDirectoryHandle("homebrews");
  const orig = modern.getFileHandle.bind(modern);
  modern.getFileHandle = async (n, opts) => {
    const h = await orig(n, opts);
    if (n === "celeste.bin") h.createWritable = async () => ({ async write() { throw new Error("card pulled"); }, async close() {} });
    return h;
  };
  const scan = await scanLegacyHomebrew(root, MODERN);
  const results = await moveLegacyHomebrew(root, scan.movable, MODERN);
  eq(results.map((r) => r.outcome), ["failed"], "a throwing write is a failure");
  ok((await listAll(root)).includes("roms/homebrew/celeste.bin"), "and the source is untouched");
}

// --- 3. A COLLISION IS NOT AN OVERWRITE -------------------------------------------------------

{
  const root = card({
    "roms/homebrew/celeste.bin": b(10, 1),
    "homebrews/celeste.bin": b(20, 9),
  });
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(scan.movable.length, 0, "a name already taken is not movable");
  eq(scan.conflicts.map((c) => c.rel), ["celeste.bin"], "it is reported as a conflict");
  eq(scan.conflicts[0].sameSize, false, "and the report says the two differ");
  eq(scan.alreadyThere.length, 0, "different bytes are never counted as already migrated");
  eq(readyToMove(scan, "CARD-D", MODERN_FW, MODERN), "nothing-to-move", "a card of nothing but conflicts is not asked to move");

  const dest = await (await root.getDirectoryHandle("homebrews")).getFileHandle("celeste.bin");
  eq((await dest.getFile()).size, 20, "THE DESTINATION IS NOT OVERWRITTEN");
  ok((await listAll(root)).includes("roms/homebrew/celeste.bin"), "and the source is still there");
}

{
  // A destination that appears between the scan and the move is the same refusal.
  const root = card({ "roms/homebrew/celeste.bin": b(10, 1), "homebrews/keep.bin": b(4) });
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(scan.movable.length, 1, "movable at scan time");
  const modern = await root.getDirectoryHandle("homebrews");
  modern._entries.set("celeste.bin", makeFile("celeste.bin", b(99, 5))); // different bytes
  const results = await moveLegacyHomebrew(root, scan.movable, MODERN);
  eq(results.map((r) => r.outcome), ["skipped"], "a race is skipped, not resolved by overwriting");
  eq((await (await modern.getFileHandle("celeste.bin")).getFile()).size, 99, "the file that got there first stands");
  ok((await listAll(root)).includes("roms/homebrew/celeste.bin"), "and the source is still there");
}

// --- 4. PARTIAL RUNS ARE RECOVERABLE ----------------------------------------------------------

{
  const root = card({
    "roms/homebrew/a.bin": b(4, 1),
    "roms/homebrew/b.bin": b(4, 2),
    "roms/homebrew/c.bin": b(4, 3),
    "homebrews/keep.bin": b(4),
  });
  const scan = await scanLegacyHomebrew(root, MODERN);
  const signal = { aborted: false };
  let seen = 0;
  const results = await moveLegacyHomebrew(root, scan.movable, MODERN, {
    signal,
    onResult: () => {
      if (++seen === 1) signal.aborted = true;
    },
  });
  eq(results.length, 1, "a cancel lands on a file boundary");
  const after = await listAll(root);
  eq(after.filter((p) => p.startsWith("roms/homebrew/")).length, 2, "the unmoved files are where they were");
  eq(
    after.filter((p) => p.startsWith("homebrews/")).length,
    2,
    "and the one that moved is at its destination, once",
  );

  // The next run picks up exactly what is left, which is what makes a partial run recoverable.
  const again = await scanLegacyHomebrew(root, MODERN);
  eq(again.movable.length, 2, "a second run sees the remainder");
  eq(again.conflicts.length, 0, "and nothing has become a conflict");
}

{
  // An unreadable source is skipped and left behind, so the directory stays and says so.
  const root = card(
    { "roms/homebrew/a.bin": b(4), "roms/homebrew/bad.bin": b(4), "homebrews/keep.bin": b(4) },
    { "roms/homebrew/bad.bin": { unreadable: true } },
  );
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(scan.movable.map((f) => f.rel), ["a.bin"], "an unreadable source is not offered for moving");
  await moveLegacyHomebrew(root, scan.movable, MODERN);
  eq(await removeLegacyDirIfEmpty(root), false, "THE LEGACY DIRECTORY STAYS while a real file is in it");
  ok((await listAll(root)).includes("roms/homebrew/bad.bin"), "and that file is still there");
}

// --- 4b. THE ORDER OF OPERATIONS, not just the end state --------------------------------------

{
  // An implementation that removed every source first and then copied would leave an IDENTICAL
  // card behind, and would lose everything if the card were pulled in between. So the ordering
  // is asserted at the FSAA surface: for each file, its write completes before its delete.
  const root = card({
    "roms/homebrew/a.bin": b(4, 1),
    "roms/homebrew/b.bin": b(5, 2),
    "roms/homebrew/c.bin": b(6, 3),
    "homebrews/keep.bin": b(4),
  });
  const scan = await scanLegacyHomebrew(root, MODERN);
  opLog.length = 0;
  await moveLegacyHomebrew(root, movePlan(scan), MODERN);

  for (const name of ["a.bin", "b.bin", "c.bin"]) {
    const wrote = opLog.indexOf(`wrote ${name}`);
    const removed = opLog.indexOf(`remove homebrew/${name}`);
    ok(wrote >= 0, `${name} was written`);
    ok(removed >= 0, `${name} was removed from the legacy directory`);
    ok(
      wrote < removed,
      `COPY BEFORE DELETE for ${name}: the write must complete before the original goes, ` +
        `got ${JSON.stringify(opLog)}`,
    );
  }

  // And the files do not interleave: each one is finished before the next begins, so a card
  // pulled at any instant has every file whole somewhere.
  const firstRemove = opLog.indexOf("remove homebrew/a.bin");
  const secondWrite = opLog.indexOf("wrote b.bin");
  ok(
    firstRemove < secondWrite,
    `ONE FILE AT A TIME: a.bin is finished before b.bin starts, got ${JSON.stringify(opLog)}`,
  );
}

// --- 4c. AN INTERRUPTED RUN FINISHES ON THE NEXT PASS -----------------------------------------

{
  // The exact state a pulled card leaves: the copy landed, the original was not removed. That is
  // not a conflict, it is a job half done, and running again must complete it.
  const root = card({
    "roms/homebrew/a.bin": b(8, 1),
    "homebrews/a.bin": b(8, 1), // identical: an earlier run copied it and stopped
    "roms/homebrew/b.bin": b(8, 2),
    "homebrews/keep.bin": b(4),
  });
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(scan.alreadyThere.map((f) => f.rel), ["a.bin"], "an identical destination is already there");
  eq(scan.conflicts.length, 0, "IDENTICAL IS NOT A CONFLICT, or a resumed run would report damage");
  eq(scan.movable.map((f) => f.rel), ["b.bin"], "and the untouched file is still movable");
  eq(readyToMove(scan, "CARD-G", MODERN_FW, MODERN), "offer", "so there is still work to offer");

  const results = await moveLegacyHomebrew(root, movePlan(scan), MODERN);
  eq(
    results.map((r) => `${r.file.rel}:${r.outcome}`),
    ["b.bin:moved", "a.bin:reconciled"],
    "the second pass copies what is left and retires the original the first pass had copied",
  );
  eq(
    await listAll(root),
    ["homebrews/a.bin", "homebrews/b.bin", "homebrews/keep.bin"],
    "the card is now fully migrated",
  );
  eq(await removeLegacyDirIfEmpty(root), true, "and the legacy directory goes");
}

{
  // Same name, same LENGTH, different bytes. The cheap size test says "maybe"; only the content
  // comparison separates a resumable copy from a real conflict.
  const root = card({
    "roms/homebrew/a.bin": b(8, 1),
    "homebrews/a.bin": b(8, 9), // same size, different contents
  });
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(scan.alreadyThere.length, 0, "A NAME AND A SIZE ARE NOT IDENTITY: this is not already there");
  eq(scan.conflicts.map((c) => c.rel), ["a.bin"], "it is a conflict");
  ok(scan.conflicts[0].sameSize, "and the report says they agree on length and still differ");
  await moveLegacyHomebrew(root, movePlan(scan), MODERN);
  ok((await listAll(root)).includes("roms/homebrew/a.bin"), "nothing was deleted on a conflict");
  eq(
    (await (await (await root.getDirectoryHandle("homebrews")).getFileHandle("a.bin")).getFile()).size,
    8,
    "and the destination is untouched",
  );
}

// --- 5. A DECLINE STAYS DECLINED --------------------------------------------------------------

{
  const root = card({ "roms/homebrew/celeste.bin": b(10), "homebrews/keep.bin": b(4) });
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(readyToMove(scan, "CARD-E", MODERN_FW, MODERN), "offer", "asked once");
  rememberDeclinedMove("CARD-E");
  eq(
    readyToMove(scan, "CARD-E", MODERN_FW, MODERN),
    "declined",
    "A USER WHO SAID NO IS NOT ASKED AGAIN every time the Library opens",
  );
  eq(
    readyToMove(scan, "CARD-F", MODERN_FW, MODERN),
    "offer",
    "and a DIFFERENT card is still asked: the decline is per card, not global",
  );
}

// --- 6. PRUNING CANNOT REACH A FILE -----------------------------------------------------------

{
  // A file buried two levels down. `removeLegacyDirIfEmpty` walks for files before it removes
  // anything, so a nested straggler protects the whole tree.
  const root = card({ "roms/homebrew/x/y/buried.bin": b(3), "homebrews/keep.bin": b(4) });
  eq(await removeLegacyDirIfEmpty(root), false, "a file at depth stops the prune");
  ok((await listAll(root)).includes("roms/homebrew/x/y/buried.bin"), "and it is untouched");
}

// --- 7. THE LIBRARY ACTUALLY ASKS -------------------------------------------------------------
// Everything above would stay green if the call site were deleted, so the wiring is asserted at
// the source. It is a shape check because the offer lives inside `onMount` in a `.svelte`
// component, which nothing here can run.

{
  const tab = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
  const code = tab.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  ok(
    /from "\.\.\/sdHomebrewMigration\.js"/.test(code),
    "the Library imports the migration module at all",
  );
  // The onMount BODY, not the whole file. An unbounded `onMount([\s\S]*?offerHomebrewMove`
  // matches the function's own DEFINITION further down and passes with the call site deleted --
  // it did, until the mutant caught it.
  const mountAt = code.indexOf("onMount(() => {");
  ok(mountAt >= 0, "onMount is where the Library's own startup work lives");
  const mountEnd = code.indexOf("\n  });", mountAt);
  const mountBody = mountAt >= 0 && mountEnd > mountAt ? code.slice(mountAt, mountEnd) : "";
  ok(
    mountBody.length > 0 && mountBody.length < 4000,
    `the onMount body was isolated, not the rest of the file: ${mountBody.length} chars`,
  );
  ok(
    /void offerHomebrewMove\(/.test(mountBody),
    "THE OFFER IS MADE WHEN THE LIBRARY OPENS: nothing else in the app reaches this module, so " +
      "without the call in onMount the whole feature is unreachable and every check above is moot",
  );
  ok(
    /targetMedia === "sd" && device\.sdHandle\) void offerHomebrewMove/.test(code),
    "and only in SD mode with a card connected, so a Flash user is never asked",
  );
  ok(
    /readyToMove\(/.test(code) && /if \(verdict !== "offer" \|\| destination === null\) return;/.test(code),
    "the gate decides, and every non-offer verdict returns without a prompt",
  );
  ok(
    /cardHomebrewLayout\(\{/.test(code),
    "the card's marker is still consulted, because it can still produce the one silence",
  );
  ok(
    !/if \(!layout\.known\)\s*\{?\s*(?:\/\/[^\n]*\n\s*)*return/.test(code),
    "AN UNRESOLVABLE MARKER DOES NOT RETURN EARLY: that early return is what silenced every " +
      "dev build, and reinstating it would silence them again",
  );
  ok(
    /const plan = movePlan\(scan\);/.test(code) && /body: t\(\)\.body\(plan\.length\),/.test(code),
    "THE SENTENCE STATES THE PLAN'S COUNT, not every file in the legacy directory: widening it " +
      "to include conflicts would promise to migrate files the run deliberately refuses to move, " +
      "and which the scan now hides from the Library",
  );
  ok(
    /const destination = moveDestination\(layout\);/.test(code) &&
      /moveLegacyHomebrew\(root, plan, destination,/.test(code),
    "THE DESTINATION COMES FROM moveDestination, which prefers the marker and falls back to the " +
      "current release, so the gate's evidence and the write cannot disagree",
  );
  // The lazy order: the legacy directory is read before the network lookup, so a card with
  // nothing to migrate costs no fetch.
  const scanAt = code.indexOf("scanLegacyHomebrew(root, LEGACY_HOMEBREW_DIR)");
  const lookupAt = code.indexOf("cardHomebrewLayout({");
  ok(
    scanAt >= 0 && lookupAt > scanAt,
    "THE NETWORK LOOKUP IS LAZY: the card is read first, so a card with no legacy directory " +
      "never reaches a fetch",
  );
  ok(
    /if \(!confirmed\) rememberDeclinedMove\(/.test(code),
    "A DECLINE IS REMEMBERED: `exec` runs only on confirm, so this is what tells a decline " +
      "apart from a completed run, and without it the prompt returns on every visit",
  );
}

// --- 8. THE COPY, AND WHICH COUNT IT STATES --------------------------------------------------

{
  const { readFileSync: rf } = await import("node:fs");
  const en = rf(join(here, "../src/lib/i18n/strings/roms.ts"), "utf8");
  const block = en.slice(en.indexOf("sdHomebrewMove: {"));
  const body = block.slice(0, block.indexOf("\n  },"));

  ok(/title: "Migrate Homebrew Folder"/.test(body), `the owner's title, verbatim: ${body.slice(0, 120)}`);
  ok(
    /body: \(count: number\) => `[^`]*\$\{count\}[^`]*`/.test(body),
    "THE COUNT IS RUNTIME DATA, not a baked number: the sentence interpolates it",
  );
  ok(
    /roms\/homebrew/.test(body) && /homebrews\//.test(body),
    "and both paths are literals in the sentence, untranslated",
  );
  // UI_VOICE calls two keys differing only in plurality a smell by name. One entry, one form,
  // as `logCoversScanned` and the filter labels already do.
  ok(
    !/bodyOne|bodySingular|bodyPlural/.test(block.slice(0, block.indexOf("\n  },"))),
    "ONE ENTRY, NO PLURAL PAIR",
  );

  // Every locale carries the same shape, so a translation cannot quietly drop the count.
  for (const code of ["de", "fr", "es", "it", "pt", "pl", "no", "ru", "uk", "ja", "ko", "zh-Hans", "zh-Hant", "ar"]) {
    const t = rf(join(here, `../src/lib/i18n/strings/roms.${code}.ts`), "utf8");
    const b = t.slice(t.indexOf("sdHomebrewMove: {"));
    const blk = b.slice(0, b.indexOf("\n  },"));
    ok(/\$\{count\}/.test(blk), `${code} keeps the count`);
    ok(/roms\/homebrew/.test(blk) && /homebrews\//.test(blk), `${code} keeps both paths as literals`);
  }
}

{
  // The count the sentence states is what the run will act on, NOT every file in the legacy
  // directory. A conflict is refused by the move and hidden from the Library, so counting it
  // would promise a migration that will not happen.
  const root = card({
    "roms/homebrew/moves.bin": b(4, 1),
    "roms/homebrew/already.bin": b(4, 2),
    "homebrews/already.bin": b(4, 2),
    "roms/homebrew/clash.bin": b(4, 3),
    "homebrews/clash.bin": b(9, 4),
  });
  const scan = await scanLegacyHomebrew(root, MODERN);
  eq(scan.movable.length, 1, "one file to copy");
  eq(scan.alreadyThere.length, 1, "one already copied by an earlier run");
  eq(scan.conflicts.length, 1, "one refused");
  eq(
    movePlan(scan).length,
    2,
    "THE COUNT EXCLUDES CONFLICTS: the sentence promises only what the run will move",
  );
}

// --- 9. THE SHADOWED LEGACY COPY IS NOT LISTED ------------------------------------------------
// The rule itself is exercised against the real resolver in devicepaths.mjs; this pins that the
// SD scan actually applies it, which nothing else would catch.

{
  const dev = readFileSync(join(here, "../src/lib/device.svelte.ts"), "utf8");
  const code = dev.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(
    /shadowedLegacyHomebrewKeys/.test(code),
    "the SD scan imports the shadowing rule",
  );
  ok(
    /const shadowed = shadowedLegacyHomebrewKeys\(scan\.userRoms\.keys\(\)\);/.test(code) &&
      /if \(shadowed\.has\(path\)\) continue;/.test(code),
    "THE SCAN SKIPS A SHADOWED KEY, so the Library is handed one row per title and the Library " +
      "itself is not touched",
  );
}

report();
