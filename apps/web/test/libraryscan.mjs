#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/sources/libraryScan.ts` — merging the user's many local ROM
 * folders into ONE de-duplicated library.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/libraryscan.mjs'
 *
 * Plain node, no framework (repo convention). Every dependency the merge has — walking a
 * folder, handle identity, containment, hashing — is INJECTED, the way `test/localfolders.mjs`
 * fakes its storage layer, so the real logic runs with no browser and no disk.
 *
 * The contract under test, in the order the module applies it (the order IS the design — see
 * the module header; hashing a 1000-ROM library on load is exactly the cost that would make
 * this feature unusable):
 *   1. identity first, before a byte is read: the same folder twice, or one nested in another,
 *      is walked ONCE.
 *   2. then path + size: a KEPT entry of a different byte length is never hashed to prove it is
 *      a different file — its length already did. The fake hash function COUNTS ITS CALLS, and
 *      a library with no repeated path must leave it at 0. Only a path offered twice is ever
 *      hashed at all, and then only enough of the group to settle it.
 *   3. then hash, colliding paths only: identical bytes collapse to ONE entry; DIFFERENT bytes
 *      survive as TWO, the second under an internal `<path>\0<id>` key whose id is derived from
 *      its own content and is therefore the same on every rescan. Nothing is dropped, nothing
 *      is renamed, and nothing about the id is ever shown.
 * Plus: an unreadable folder is skipped, not fatal; and the "romDir" migration is idempotent.
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
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function deepEq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg}: expected ${B}, got ${A}`);
}
function ok(v, msg) { if (!v) throw new Error(msg); }

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-libraryscan-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/libraryScan.ts")],
  outfile: join(out, "libraryScan.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const {
  dedupeSources, mergeFolderScans, scanLibraryFolders, migrateLegacyRomDir, romFolderGateNeeded,
  DUP_MARK, basePath, duplicateIdOf, isDuplicateKey,
  romFolderSources, romFolderSignature, libraryListState, applyPlacement,
} = await import(pathToFileURL(join(out, "libraryScan.js")).href);

// --- Fakes -------------------------------------------------------------------------------------

/** A directory handle that knows its own identity and what it contains. */
function dir(name, contains = []) {
  const h = {
    name,
    contains,
    async isSameEntry(other) { return other === h; },
    async resolve(other) {
      return h.contains.includes(other) ? [other.name] : null;
    },
  };
  return h;
}

const bytes = (s) => new TextEncoder().encode(s);

/** A hash dep that counts its calls — the whole point of step 2 is that this stays low. */
function countingHash() {
  const fn = async (b) => {
    fn.calls++;
    // Content-addressed but cheap: the test never needs a real SHA-1, only agreement.
    return new TextDecoder().decode(b);
  };
  fn.calls = 0;
  return fn;
}

const identityDeps = {
  isSameEntry: (a, b) => (a && a.isSameEntry ? a.isSameEntry(b) : Promise.resolve(a === b)),
  resolveWithin: (a, b) => (a && a.resolve ? a.resolve(b) : Promise.resolve(null)),
};

/** Build the full dep bundle around a map of folderId -> files map. */
function depsFor(tree, hash) {
  return {
    ...identityDeps,
    hash,
    async scan(src) {
      const entry = tree[src.id];
      if (typeof entry === "function") return entry();
      return { files: entry, hasRomsPrefix: false };
    },
  };
}

const src = (id, handle, status = "ready") => ({ id, handle, status });

// 1. STEP 1 — the same folder registered twice is walked once.
await check("the same folder added twice yields each file exactly once", async () => {
  const h = dir("roms");
  const hash = countingHash();
  const files = new Map([["nes/mario.nes", bytes("MARIO")], ["gb/tetris.gb", bytes("TETRIS")]]);
  const r = await scanLibraryFolders(
    [src("a", h), src("b", h)],
    depsFor({ a: files, b: files }, hash),
  );
  eq(r.scanned.length, 1, "only one folder was actually walked");
  eq(r.files.size, 2, "each file present once");
  deepEq(r.skipped, [{ id: "b", reason: "duplicate", coveredBy: "a" }], "the twin was skipped as a duplicate");
  eq(hash.calls, 0, "identity dedup happens BEFORE any hashing");
  deepEq(r.collisions, [], "a duplicate registration is not a collision");
});

// 2. STEP 1 — a nested folder does not double-count, in either registration order.
await check("a folder nested inside another is not double-counted", async () => {
  const inner = dir("nes");
  const outer = dir("roms", [inner]);
  const hash = countingHash();
  const tree = { in: new Map([["mario.nes", bytes("M")]]), out: new Map([["nes/mario.nes", bytes("M")]]) };

  const a = await scanLibraryFolders([src("out", outer), src("in", inner)], depsFor(tree, hash));
  deepEq(a.scanned.map((s) => s.id), ["out"], "parent first: the inner folder is skipped");
  deepEq(a.skipped, [{ id: "in", reason: "nested", coveredBy: "out" }], "reported as nested");

  // Registered the other way round the parent still wins — the inner one is dropped
  // retro-actively rather than walked twice under two ids.
  const b = await scanLibraryFolders([src("in", inner), src("out", outer)], depsFor(tree, hash));
  deepEq(b.scanned.map((s) => s.id), ["out"], "child first: the parent still supersedes it");
  deepEq(b.skipped, [{ id: "in", reason: "nested", coveredBy: "out" }], "reported as nested");
  eq(hash.calls, 0, "containment is decided without reading anything");
});

// 3. STEP 3 — same path, same size, same bytes collapses to one entry.
await check("same name + same size + same bytes collapses to one entry", async () => {
  const hash = countingHash();
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B"))],
    depsFor(
      {
        a: new Map([["nes/mario.nes", bytes("MARIO")]]),
        b: new Map([["nes/mario.nes", bytes("MARIO")]]),
      },
      hash,
    ),
  );
  eq(r.files.size, 1, "one entry survives");
  eq(r.origin.get("nes/mario.nes"), "a", "the first folder in the user's order owns it");
  deepEq(r.collisions, [], "identical bytes are not a collision");
  eq(hash.calls, 2, "exactly the two candidates were hashed");
  eq(r.hashed, 2, "the reported hash count matches");
});

// 4. STEP 3 — same path, same size, DIFFERENT bytes is RECORDED, not silently merged.
await check("same name + same size + different bytes is recorded as a collision", async () => {
  const hash = countingHash();
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B"))],
    depsFor(
      {
        a: new Map([["nes/mario.nes", bytes("MARIO")]]),
        b: new Map([["nes/mario.nes", bytes("LUIGI")]]), // same length, different content
      },
      hash,
    ),
  );
  eq(r.files.size, 2, "BOTH survive — that is the whole rule");
  deepEq(
    r.collisions,
    [{ path: "nes/mario.nes", winnerId: "a", loserIds: ["b"], decidedBy: "hash" }],
    "the doubled path is still indexed",
  );
  // The FIRST variant in the user's own folder order keeps the bare path, so every consumer of
  // an ordinary library is untouched; the second is filed under an internal id.
  eq(new TextDecoder().decode(r.files.get("nes/mario.nes")), "MARIO", "first folder keeps the bare path");
  const dupKeys = [...r.files.keys()].filter(isDuplicateKey);
  eq(dupKeys.length, 1, "exactly one key carries an id");
  eq(basePath(dupKeys[0]), "nes/mario.nes", "and it is the same real path");
  ok(duplicateIdOf(dupKeys[0]).length > 0, "with a non-empty id");
  eq(new TextDecoder().decode(r.files.get(dupKeys[0])), "LUIGI", "holding the other folder's bytes");
  eq(r.origin.get(dupKeys[0]), "b", "attributed to the folder it came from");
  eq(hash.calls, 2, "only the colliding pair was hashed");
  eq(r.duplicates.length, 1, "one doubled path reported");
  deepEq(r.duplicates[0].members.map((m) => m.folderId), ["a", "b"], "both variants listed, in scan order");
  eq(r.duplicates[0].members[0].dupId, "", "the bare-path variant has no id");
});

// 4b. THE ID IS INVISIBLE. It lives in the map key and nowhere else: `basePath` of every key is
// a real path, and no key's real path contains the marker.
await check("the duplicate id never leaks into the path", async () => {
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B"))],
    depsFor(
      {
        a: new Map([["nes/mario.nes", bytes("MARIO")]]),
        b: new Map([["nes/mario.nes", bytes("LUIGI")]]),
      },
      countingHash(),
    ),
  );
  for (const key of r.files.keys()) {
    eq(basePath(key), "nes/mario.nes", "every key resolves to the one real path");
    ok(!basePath(key).includes(DUP_MARK), "and the real path carries no marker");
  }
  eq(basePath("gb/tetris.gb"), "gb/tetris.gb", "an ordinary key is returned untouched");
  eq(duplicateIdOf("gb/tetris.gb"), "", "and has no id");
});

// 4c. STABILITY. The id is the content hash, so it depends on the bytes and on NOTHING else —
// not the scan run, not the folder's row id, not when the folder was registered. A user must
// never watch rows re-identify themselves because a scan happened again.
await check("the duplicate ids are unchanged across a rescan", async () => {
  const tree = {
    a: new Map([["nes/mario.nes", bytes("MARIO")]]),
    b: new Map([["nes/mario.nes", bytes("LUIGI")]]),
  };
  const keysOf = async (deps) =>
    [...(await scanLibraryFolders([src("a", dir("A")), src("b", dir("B"))], deps)).files.keys()].sort();
  const first = await keysOf(depsFor(tree, countingHash()));
  const second = await keysOf(depsFor(tree, countingHash()));
  deepEq(second, first, "a second scan of the same library reproduces the same keys");

  // Removing folder b and adding it back reproduces them too: the bytes did not change, so
  // neither does the id. (Its ROW id in localFolders may well be new — that is exactly why the
  // id is not derived from it.)
  const dropped = await scanLibraryFolders([src("a", dir("A"))], depsFor(tree, countingHash()));
  deepEq([...dropped.files.keys()], ["nes/mario.nes"], "with b gone nothing is a duplicate any more");
  const readded = [
    ...(await scanLibraryFolders(
      [src("a", dir("A")), src("b-readded-under-a-new-row-id", dir("B"))],
      depsFor({ a: tree.a, "b-readded-under-a-new-row-id": tree.b }, countingHash()),
    )).files.keys(),
  ].sort();
  deepEq(readded, first, "re-adding the folder restores the very same keys");
});

// 4d. THREE folders, TWO distinct contents. The third folder's copy is identical to the second's
// — it must collapse onto it, not open a third row.
await check("a third folder identical to the second adds no row", async () => {
  const hash = countingHash();
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B")), src("c", dir("C"))],
    depsFor(
      {
        a: new Map([["nes/mario.nes", bytes("MARIO")]]),
        b: new Map([["nes/mario.nes", bytes("LUIGI")]]),
        c: new Map([["nes/mario.nes", bytes("LUIGI")]]),
      },
      hash,
    ),
  );
  eq(r.files.size, 2, "two distinct contents, two entries");
  eq(r.duplicates[0].members.length, 2, "the third copy joined neither as a new variant nor at all");
  deepEq(r.collisions[0].loserIds, ["b"], "and c is not reported as a further loser");
});

// 5. STEP 2 — differing sizes are settled without hashing at all.
await check("different sizes are never hashed", async () => {
  const hash = countingHash();
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B"))],
    depsFor(
      {
        a: new Map([["nes/mario.nes", bytes("MARIO")], ["gb/tetris.gb", bytes("TETRIS")]]),
        b: new Map([["nes/mario.nes", bytes("MARIO-REV-A")], ["sms/alex.sms", bytes("ALEX")]]),
      },
      hash,
    ),
  );
  // The INCUMBENT is never hashed: a different byte length already proves it is a different
  // file. The NEWCOMER is hashed exactly once, because a surviving variant needs an id derived
  // from its own content — one hash of one colliding file, not of the library.
  eq(hash.calls, 1, "only the newcomer, and only for its id");
  eq(r.hashed, 1, "and the reported count matches");
  eq(r.files.size, 4, "three distinct paths, one of them served twice");
  deepEq(
    r.collisions,
    [{ path: "nes/mario.nes", winnerId: "a", loserIds: ["b"], decidedBy: "size" }],
    "recorded as a size-decided collision",
  );
  const dup = [...r.files.keys()].find(isDuplicateKey);
  eq(basePath(dup), "nes/mario.nes", "the second variant is the doubled path");
  eq(new TextDecoder().decode(r.files.get(dup)), "MARIO-REV-A", "carrying the other folder's bytes");
});

// 5b. The common case: many folders, no duplicates at all — the hash function is never called.
await check("a duplicate-free library hashes nothing", async () => {
  const hash = countingHash();
  const mk = (sys, n) =>
    new Map(Array.from({ length: n }, (_, i) => [`${sys}/game${i}.rom`, bytes(`${sys}-${i}`)]));
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B")), src("c", dir("C"))],
    depsFor({ a: mk("nes", 200), b: mk("gb", 200), c: mk("md", 200) }, hash),
  );
  eq(r.files.size, 600, "everything is served");
  eq(hash.calls, 0, "600 files, zero hashes");
});

// 5c. THE CARD CASE-FOLDS. `nes/Zelda.nes` and `nes/ZELDA.nes` are ONE file on a FAT/exFAT
// card and two in any ordinary Map, so the merge folds case before comparing — the same rule
// spec/05-host.md states for converted output names, in the one other place this app builds a
// set of names. An unfolded merge reports two ROMs, budgets for two, and then writes one over
// the other on the card.
await check("a case-only duplicate is ONE file, not two", async () => {
  const hash = countingHash();
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B"))],
    depsFor(
      {
        a: new Map([["nes/Zelda.nes", bytes("ZELDA")]]),
        b: new Map([["nes/ZELDA.nes", bytes("ZELDA")]]),
      },
      hash,
    ),
  );
  eq(r.files.size, 1, "one file, because that is what the card would hold");
  // The FOLD is only the comparison key: what is kept and shown is the winner's ORIGINAL
  // spelling, which is what the file is really called in its source folder.
  ok(r.files.has("nes/Zelda.nes"), "kept under the first folder's own spelling");
  ok(!r.files.has("nes/zelda.nes"), "the merge does not lowercase anybody's filename");
  eq(r.origin.get("nes/Zelda.nes"), "a", "attributed to the folder it came from");
  deepEq(r.collisions, [], "identical bytes collapse, exactly as for an exact-path match");
  eq(hash.calls, 2, "settled by step 3, the pair being same-size candidates");
});

await check("a case-only duplicate with DIFFERENT bytes is a recorded collision", async () => {
  // Not silently merged and not silently overwritten: the same treatment an exact-path
  // conflict gets, reported under the winner's spelling for a later step to present.
  const hash = countingHash();
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B"))],
    depsFor(
      {
        a: new Map([["nes/Zelda.nes", bytes("ZELDA")]]),
        b: new Map([["nes/ZELDA.nes", bytes("LINKS")]]), // same length, different content
      },
      hash,
    ),
  );
  eq(r.files.size, 2, "two entries — different content is still different content");
  deepEq(
    r.collisions,
    [{ path: "nes/Zelda.nes", winnerId: "a", loserIds: ["b"], decidedBy: "hash" }],
    "recorded under the first variant's original spelling",
  );
  eq(new TextDecoder().decode(r.files.get("nes/Zelda.nes")), "ZELDA", "first folder keeps the bare path");
  // CASE FOLDING SURVIVES. The second variant keeps its OWN spelling, and the two are still
  // one name on the card — which is why the install refuses rather than writing both (see
  // `installNameError` in src/lib/romSelection.svelte.ts). Nothing here lowercases anybody.
  const dup = [...r.files.keys()].find(isDuplicateKey);
  eq(basePath(dup), "nes/ZELDA.nes", "the second variant is stored under its own spelling");
  ok(basePath(dup).toLowerCase() === "nes/zelda.nes", "and folds onto the first — one file on the card");
});

await check("a case-only duplicate of a different SIZE is still never hashed", async () => {
  const hash = countingHash();
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B"))],
    depsFor(
      {
        a: new Map([["nes/Zelda.nes", bytes("ZELDA")]]),
        b: new Map([["nes/ZELDA.NES", bytes("ZELDA-REV-A")]]),
      },
      hash,
    ),
  );
  eq(hash.calls, 1, "the incumbent is never hashed; the newcomer is, once, for its id");
  eq(r.files.size, 2, "two files, because the content differs");
  deepEq(
    r.collisions,
    [{ path: "nes/Zelda.nes", winnerId: "a", loserIds: ["b"], decidedBy: "size" }],
    "a size disagreement decides it, folded name and all",
  );
  eq(basePath([...r.files.keys()].find(isDuplicateKey)), "nes/ZELDA.NES", "each keeps its own spelling");
});

await check("the DIRECTORY part of a path folds too, and unlike names still differ", async () => {
  const hash = countingHash();
  const r = await scanLibraryFolders(
    [src("a", dir("A")), src("b", dir("B"))],
    depsFor(
      {
        // `NES/` and `nes/` are one directory on the card.
        a: new Map([["NES/zelda.nes", bytes("ZELDA")], ["nes/mario.nes", bytes("MARIO")]]),
        // ...but `zelda2.nes` differs by more than case, so it is a genuinely second file.
        b: new Map([["nes/zelda.nes", bytes("ZELDA")], ["nes/zelda2.nes", bytes("ZELDA2")]]),
      },
      hash,
    ),
  );
  eq(r.files.size, 3, "zelda collapses across the two directory spellings; the rest stand");
  ok(r.files.has("NES/zelda.nes"), "under the spelling the first folder used");
  ok(r.files.has("nes/zelda2.nes"), "a name differing by more than case is its own file");
  deepEq(r.collisions, [], "no conflict: the collapsed pair is byte-identical");
});

// 6. A folder that cannot be read is skipped, and does not take the scan down with it.
await check("an unreadable folder is skipped without failing the scan", async () => {
  const hash = countingHash();
  const deps = depsFor(
    {
      ok: new Map([["nes/mario.nes", bytes("MARIO")]]),
      boom: () => {
        throw new Error("NotAllowedError");
      },
    },
    hash,
  );
  const r = await scanLibraryFolders(
    [
      src("ok", dir("OK")),
      src("boom", dir("BOOM")),
      src("locked", dir("L"), "needs-permission"),
      src("gone", null, "missing"),
    ],
    deps,
  );
  eq(r.files.size, 1, "the readable folder still contributed");
  deepEq(r.scanned.map((s) => s.id), ["ok"], "only the readable folder was walked");
  const byId = Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]));
  deepEq(
    byId,
    { locked: "needs-permission", gone: "missing", boom: "error" },
    "every non-contributor is reported with its reason, none silently treated as empty",
  );
  ok(
    r.skipped.find((s) => s.id === "boom").message.includes("NotAllowedError"),
    "the read failure's message is surfaced, not swallowed",
  );
});

// 7. A third folder colliding on the same path must not re-hash the incumbent.
await check("a three-way collision hashes each file once", async () => {
  const hash = countingHash();
  const r = await mergeFolderScans(
    [
      { id: "a", files: new Map([["p", bytes("AAAAA")]]), hasRomsPrefix: false },
      { id: "b", files: new Map([["p", bytes("BBBBB")]]), hasRomsPrefix: false },
      { id: "c", files: new Map([["p", bytes("CCCCC")]]), hasRomsPrefix: false },
    ],
    { hash },
  );
  eq(hash.calls, 3, "the incumbent is hashed once, not once per challenger");
  deepEq(r.collisions[0].loserIds, ["b", "c"], "both losers are recorded under one collision");
});

// 8. dedupeSources on its own reads nothing and preserves the user's order.
await check("dedupeSources keeps the user's order and reads nothing", async () => {
  const a = dir("A"), b = dir("B"), c = dir("C");
  const { kept, skipped } = await dedupeSources([src("a", a), src("b", b), src("c", c)], identityDeps);
  deepEq(kept.map((k) => k.id), ["a", "b", "c"], "order preserved");
  deepEq(skipped, [], "nothing dropped");
});

// 9. MIGRATION — the legacy single "romDir" folder is adopted once, and only once.
await check("the romDir migration is idempotent", async () => {
  const legacy = dir("roms");
  let n = 0;
  const target = {
    folders: [],
    async add(opts) {
      const row = { id: `f${++n}`, handle: opts.handle, usedBy: opts.usedBy ?? [] };
      target.folders.push(row);
      return row;
    },
  };

  const first = await migrateLegacyRomDir(legacy, target, identityDeps);
  eq(first.adopted, true, "adopted on the first run");
  eq(target.folders.length, 1, "one row");
  deepEq(target.folders[0].usedBy, [], "adopted with no associations, i.e. shared");

  const second = await migrateLegacyRomDir(legacy, target, identityDeps);
  eq(second.adopted, false, "the second run is a no-op");
  eq(target.folders.length, 1, "still one row — running twice does not duplicate it");

  // A DIFFERENT directory is still adopted (the guard is identity, not "is the list empty").
  const other = dir("more-roms");
  await migrateLegacyRomDir(other, target, identityDeps);
  eq(target.folders.length, 2, "a genuinely different folder is still adopted");

  // No handle at all: nothing to do, and no row invented.
  const none = await migrateLegacyRomDir(null, target, identityDeps);
  eq(none.adopted, false, "a missing legacy handle adopts nothing");
  eq(target.folders.length, 2, "and adds no row");
});

// --- The ROM-folder gate -----------------------------------------------------------------------
// The modal must ask "has a ROM folder been REGISTERED?", not "is a scan in memory?" (the old
// `library.selected` rule, which was false after every reload and greeted the user on mount).

/** A LocalFolderStore stand-in whose rows only exist once `load()` has resolved — the real one
 *  reads IndexedDB, so the gate may be consulted before the array is populated. */
function gateStore(rows) {
  let loaded = false;
  const store = {
    folders: [],
    loadCalls: 0,
    async load() {
      store.loadCalls++;
      if (loaded) return;
      await Promise.resolve();
      store.folders = rows.slice();
      loaded = true;
    },
  };
  return store;
}

await check("gate: no registered directory at all opens the modal", async () => {
  eq(await romFolderGateNeeded(gateStore([])), true, "empty store gates");
  // BEHAVIOUR CHANGE, deliberate. This used to ask for a ROM folder specifically, so a user
  // whose only registered folder was a homebrew one still got the modal. There is no kind to
  // ask about any more: a registered directory is a registered directory, and the gate's
  // question is whether the user has pointed us at anything.
  eq(
    await romFolderGateNeeded(gateStore([{ status: "ready", usedBy: [] }])),
    false,
    "one registered directory is enough, whatever it was added for",
  );
});

await check("gate: one registered, readable ROM folder does NOT open the modal", async () => {
  eq(await romFolderGateNeeded(gateStore([{ status: "ready" }])), false, "ready gates nothing");
});

await check("gate: an unusable but registered ROM folder still suppresses the modal", async () => {
  // Chrome does not silently re-grant a persisted handle, so "needs-permission" is the normal
  // post-reload state; counting it as "no folder" would reinstate the bug. `missing` rows keep
  // their own repoint affordance. See romFolderGateNeeded's doc comment.
  eq(
    await romFolderGateNeeded(gateStore([{ status: "needs-permission" }])),
    false,
    "needs-permission is registered",
  );
  eq(
    await romFolderGateNeeded(gateStore([{ status: "missing" }])),
    false,
    "missing is registered",
  );
});

await check("gate: a not-yet-loaded store does not read as empty", async () => {
  const store = gateStore([{ status: "ready" }]);
  eq(store.folders.length, 0, "precondition: the rows are not there before load()");
  const needed = await romFolderGateNeeded(store);
  eq(needed, false, "the gate awaits load() instead of seeing an empty array");
  eq(store.loadCalls, 1, "load() is called, once");
  // And a second consult is still correct (load() is idempotent).
  eq(await romFolderGateNeeded(store), false, "still satisfied on a second consult");
});


// --- The registry IS the library ---------------------------------------------------------------
// The owner's report: "The Library's Game/App list doesn't go by the Sources." These checks pin
// the fix — the local-folder registry is the ONLY thing that decides what the library contains.

const row = (id, over = {}) => ({ id, status: "ready", handle: dir(id), ...over });

await check("registry: a ROM folder in the registry becomes a library source", async () => {
  const folders = [row("a"), row("b")];
  deepEq(romFolderSources(folders).map((s) => s.id), ["a", "b"], "both rows are sources");
});

await check("registry: a folder removed from the registry leaves the library", async () => {
  const folders = [row("a"), row("b")];
  const after = folders.filter((f) => f.id !== "a");
  deepEq(romFolderSources(after).map((s) => s.id), ["b"], "the removed row is gone");
  ok(
    romFolderSignature(folders) !== romFolderSignature(after),
    "removing a folder changes the rescan signature",
  );
});

// A registry that places one core target. `isLibrarySource` reads `systems[].targetKey` and, for
// a system-scoped association key, `.id`; `dedicatedFolderPlacement` also reads `.folder` and,
// for a folder serving several systems, `.installable` / `.ingestable`.
const CORE_KEY = "o/core#gnw";
const HB_KEY = "o/tomb#openlara";
const REG = { systems: [{ targetKey: CORE_KEY, id: "gb", folder: "gb" }], byFolder: new Map(), hasCoreSources: true, declaredFolders: new Set() };

await check("registry: a directory dedicated only to a homebrew target is not a library source", async () => {
  // COST, not taxonomy. `romScan.ts`'s walk() reads every file it meets into memory whole, so
  // a game install registered for a homebrew title would be read entirely for a library that
  // then discards all of it. Those folders are served on demand by discoveryWire instead.
  // This is what the `kind: "roms"` filter used to buy, expressed as the rule it really was.
  const folders = [row("shared", { usedBy: [] }), row("hb", { usedBy: [HB_KEY] })];
  deepEq(romFolderSources(folders, REG).map((s) => s.id), ["shared"], "the homebrew-dedicated one is out");
});

await check("registry: a directory dedicated to a CORE is still a library source", async () => {
  // The other half, and the one a naive merge breaks: a ROM folder narrowed to a core still
  // holds the user's ROMs and still belongs in the list.
  const folders = [row("core", { usedBy: [CORE_KEY] })];
  const got = romFolderSources(folders, REG);
  deepEq(got.map((s) => s.id), ["core"], "dedicated to a core, still a source");
  eq(got[0].placement?.fallback, "gb", "and its loose files file under that core's console");
});

await check("registry: shared is a source whatever the registry says", async () => {
  const folders = [row("any", { usedBy: [] })];
  deepEq(romFolderSources(folders).map((s) => s.id), ["any"], "with no registry at all");
  deepEq(romFolderSources(folders, REG).map((s) => s.id), ["any"], "and with one");
  deepEq(
    romFolderSources(folders).map((s) => s.status),
    ["ready"],
    "an Any folder is offered unconditionally",
  );
});

await check("registry: an unreadable row stays a source (so it can be REPORTED, not vanish)", async () => {
  const folders = [row("np", { status: "needs-permission" }), row("gone", { status: "missing", handle: null })];
  deepEq(romFolderSources(folders).map((s) => s.status), ["needs-permission", "missing"], "kept");
  const { skipped } = await dedupeSources(romFolderSources(folders), identityDeps);
  deepEq(skipped.map((s) => s.reason), ["needs-permission", "missing"], "each is skipped with its reason");
});

const handleTokenOf = (f) => romFolderSignature([f], REG).split(":")[2];

await check("registry: an untouched folder's signature does NOT move when keys gained a system half", async () => {
  // `usedBy` is persisted, and `romFolderSignature` drives the Library's rescan. If the shape
  // change moved the signature for a folder nobody edited, every user would rescan their whole
  // library once on upgrade. It does not: the signature carries the resolved PREFIX, never the
  // key, and a persisted `owner/repo#targetId` resolves exactly as it did before.
  const f = row("f", { usedBy: [CORE_KEY] });
  eq(romFolderSignature([f], REG), `f:ready:${handleTokenOf(f)}:gb`, "the prefix it always had");
  // The same folder with the system named explicitly: same prefix, so no rescan for that either.
  eq(romFolderSignature([{ ...f, usedBy: [CORE_KEY + "@gb"] }], REG), romFolderSignature([f], REG),
     "naming that core's only system resolves to the same prefix");
});

await check("registry: the signature moves for add / remove / grant / repoint, and only then", async () => {
  const a = row("a"), b = row("b");
  const base = [a, b];
  eq(romFolderSignature(base), romFolderSignature([a, b]), "an unchanged registry is stable");
  ok(romFolderSignature(base) !== romFolderSignature([a]), "removal moves it");
  ok(romFolderSignature(base) !== romFolderSignature([a, b, row("c")]), "an addition moves it");
  ok(
    romFolderSignature(base) !== romFolderSignature([a, { ...b, status: "needs-permission" }]),
    "a grant/revoke moves it",
  );
  ok(
    romFolderSignature(base) !== romFolderSignature([a, { ...b, handle: dir("b") }]),
    "a repoint (same id + status, new handle) moves it",
  );
  eq(
    romFolderSignature([a, { ...b, usedBy: ["o/tomb#openlara"] }]),
    romFolderSignature([a]),
    "narrowing a folder to a homebrew-only target takes it out of the library, like removing it",
  );
});

// --- Loading is not empty ----------------------------------------------------------------------

const st = (o) => libraryListState({ registryReady: true, loaded: true, scanning: false, hasScan: false, ...o });

await check("state: before the registry has loaded, the library is LOADING, never empty", async () => {
  eq(st({ registryReady: false }), "loading", "registry not read yet");
  eq(st({ registryReady: false, loaded: true, hasScan: true }), "loading", "still loading");
});

await check("state: before the first scan finishes, the library is LOADING", async () => {
  eq(st({ loaded: false }), "loading", "no scan has completed");
  eq(st({ loaded: true, scanning: true }), "loading", "a scan is in flight");
});

await check("state: EMPTY only after loading genuinely finished with nothing configured", async () => {
  eq(st({}), "empty", "loaded, not scanning, no scan result");
  // Every other combination that could be mistaken for empty must not be.
  for (const bad of [{ registryReady: false }, { loaded: false }, { scanning: true }]) {
    ok(st(bad) !== "empty", `must not read as empty: ${JSON.stringify(bad)}`);
  }
});

await check("state: a scan in memory renders the LIST", async () => {
  eq(st({ hasScan: true }), "list", "loaded with a scan");
});

// --- Dedicated folders: both layouts the owner actually uses ------------------------------------
// "we also added dedicated source folders which also need to be taken into account as-is without
// the need for a subfolder with the core folder shortname."
//
// So a general ROM folder holds `doom/DOOM.WAD`, and a folder registered FOR the Doom core holds
// `DOOM.WAD` at its root. Both must land under the same console.

/** A registry with one single-system core, as `buildCoreRegistry` would produce it. */
const doomReg = {
  systems: [{
    targetKey: "slash-proc/doom#gnw-retro-go", repo: "slash-proc/doom", id: "doom", folder: "doom",
    longName: "Doom", shortName: "Doom", installable: [".whd"], ingestable: [".wad"],
    browse: "file", compression: false,
  }],
  byFolder: new Map([["doom", { folder: "doom", shortName: "Doom" }]]),
};

await check("layout: a dedicated folder's LOOSE files are filed under its core", async () => {
  const files = new Map([["DOOM.WAD", bytes("wad")], ["doom2.wad", bytes("wad2")]]);
  const got = applyPlacement(files, { fallback: "doom" });
  deepEq([...got.keys()], ["doom/DOOM.WAD", "doom/doom2.wad"],
    "no `doom/` subfolder needed — the registration says which console this folder is");
});

await check("layout: a file already under a subfolder keeps its own path", async () => {
  const files = new Map([["DOOM.WAD", bytes("a")], ["doom/doom2.wad", bytes("b")]]);
  deepEq([...applyPlacement(files, { fallback: "doom" }).keys()], ["doom/DOOM.WAD", "doom/doom2.wad"],
    "never doom/doom/… — one folder may hold both shapes");
});

await check("layout: a general folder is untouched", async () => {
  const files = new Map([["doom/DOOM.WAD", bytes("a")], ["nes/mario.nes", bytes("b")]]);
  eq(applyPlacement(files, undefined), files, "no placement is the identity, not a copy");
});

await check("layout: the prefix reaches the scan, and only for the dedicated folder", async () => {
  const folders = [
    row("general", { usedBy: [] }),
    row("dedicated", { usedBy: ["slash-proc/doom#gnw-retro-go"] }),
  ];
  const srcs = romFolderSources(folders, doomReg);
  deepEq(srcs.map((s) => s.placement?.fallback ?? null), [null, "doom"],
    "Any gets none; dedicated gets doom for everything in it");
});

await check("layout: activating the core changes the rescan signature", async () => {
  // Otherwise a dedicated folder's loose WADs would stay invisible until something unrelated
  // happened to move the signature.
  const folders = [row("dedicated", { usedBy: ["slash-proc/doom#gnw-retro-go"] })];
  const before = romFolderSignature(folders, { systems: [], byFolder: new Map() });
  const after = romFolderSignature(folders, doomReg);
  ok(before !== after, "the resolved prefix is part of the signature");
});

await check("layout: a dedicated folder's WADs merge into the library under their console", async () => {
  const hash = countingHash();
  const merged = await scanLibraryFolders(
    romFolderSources(
      [row("general"), row("dedicated", { usedBy: ["slash-proc/doom#gnw-retro-go"] })],
      doomReg,
    ),
    {
      ...identityDeps,
      hash,
      scan: async (src) => ({
        files: src.id === "general"
          ? new Map([["nes/mario.nes", bytes("mario")]])
          : new Map([["DOOM.WAD", bytes("doomwad")]]),
        hasRomsPrefix: false,
      }),
    },
  );
  deepEq([...merged.files.keys()].sort(), ["doom/DOOM.WAD", "nes/mario.nes"],
    "both layouts land in one library");
  eq(hash.calls, 0, "and nothing was hashed to do it");
});

// --- A folder dedicated to SEVERAL systems ------------------------------------------------------
//
// The owner registered `~/Emulation/Roms/Gameboy/` for gb AND gbc and its games did not appear.
// One prefix cannot answer a folder holding both `.gb` and `.gbc` files, so placement is per
// file, by extension. See `coreRegistry.ts`'s `dedicatedFolderPlacement`.

/** tgb-dual as `buildCoreRegistry` produces it: ONE target, TWO systems. */
const TGB = "slash-proc/tgb#gnw-retro-go";
const tgbReg = {
  systems: [
    {
      targetKey: TGB, repo: "slash-proc/tgb", id: "gb", folder: "gb",
      longName: "Game Boy", shortName: "Game Boy", installable: [".gb"], ingestable: [],
      browse: "file", compression: false,
    },
    {
      targetKey: TGB, repo: "slash-proc/tgb", id: "gbc", folder: "gbc",
      longName: "Game Boy Color", shortName: "Game Boy Color", installable: [".gbc"], ingestable: [],
      browse: "file", compression: false,
    },
  ],
  byFolder: new Map([["gb", { folder: "gb", shortName: "Game Boy" }], ["gbc", { folder: "gbc", shortName: "Game Boy Color" }]]),
  declaredFolders: new Set(["gb", "gbc"]),
  hasCoreSources: true,
};

await check("layout: a folder dedicated to gb AND gbc files each loose ROM by its extension", async () => {
  const folders = [row("gameboy", { usedBy: [`${TGB}@gb`, `${TGB}@gbc`] })];
  const files = new Map([["Tetris.gb", bytes("t")], ["Oracle of Ages.gbc", bytes("z")]]);
  const { files: got } = await scanLibraryFolders(
    romFolderSources(folders, tgbReg), depsFor({ gameboy: files }, countingHash()));
  deepEq([...got.keys()].sort(), ["gb/Tetris.gb", "gbc/Oracle of Ages.gbc"].sort(),
    "each file takes the console that CLAIMS its extension, not one shared guess");
});

await check("layout: a zipped ROM in such a folder places by its INNER extension", async () => {
  // `romScan.ts` already keys a zipped ROM by the inner file name, so `Aladdin.zip` holding
  // `Disney's Aladdin (USA).gb` reaches this merge as a `.gb` path. Placement must therefore
  // need no zip knowledge at all -- if it read the archive name it would see `.zip` and place
  // nothing, which is the owner's 375-archive library going missing.
  const folders = [row("gameboy", { usedBy: [`${TGB}@gb`, `${TGB}@gbc`] })];
  const files = new Map([["Disney's Aladdin (USA).gb", bytes("a")]]);
  const { files: got } = await scanLibraryFolders(
    romFolderSources(folders, tgbReg), depsFor({ gameboy: files }, countingHash()));
  deepEq([...got.keys()], ["gb/Disney's Aladdin (USA).gb"], "the inner name decided it");
});

await check("layout: in a multi-system folder an unclaimed extension stays unplaced", async () => {
  const folders = [row("gameboy", { usedBy: [`${TGB}@gb`, `${TGB}@gbc`] })];
  const files = new Map([["Tetris.gb", bytes("t")], ["notes.txt", bytes("n")], ["README", bytes("r")]]);
  const { files: got } = await scanLibraryFolders(
    romFolderSources(folders, tgbReg), depsFor({ gameboy: files }, countingHash()));
  deepEq([...got.keys()].sort(), ["README", "gb/Tetris.gb", "notes.txt"].sort(),
    "no console claims .txt or a name with no extension, and none is invented");
});

await check("layout: a subfolder inside a multi-system folder is still untouched", async () => {
  const folders = [row("gameboy", { usedBy: [`${TGB}@gb`, `${TGB}@gbc`] })];
  const files = new Map([["Tetris.gb", bytes("t")], ["gbc/Zelda.gbc", bytes("z")]]);
  const { files: got } = await scanLibraryFolders(
    romFolderSources(folders, tgbReg), depsFor({ gameboy: files }, countingHash()));
  deepEq([...got.keys()].sort(), ["gb/Tetris.gb", "gbc/Zelda.gbc"].sort(), "never gbc/gbc/…");
});

await check("layout: the signature moves when a system is added to a folder's usedBy", async () => {
  // Without this the owner's folder stays wrong until a reload: he ticks Game Boy Color and
  // nothing rescans.
  // ONE handle, shared: `row()` mints a fresh one per call and the signature carries a
  // per-handle token, so two independently built rows would differ whatever the placement did
  // and this would pass for the wrong reason.
  const h = dir("gameboy");
  const one = [{ id: "gameboy", status: "ready", handle: h, usedBy: [`${TGB}@gb`] }];
  const two = [{ id: "gameboy", status: "ready", handle: h, usedBy: [`${TGB}@gb`, `${TGB}@gbc`] }];
  ok(romFolderSignature(one, tgbReg) !== romFolderSignature(two, tgbReg),
     "adding a system changes how files are placed, so it must trigger a rescan");
  eq(romFolderSignature(two, tgbReg), romFolderSignature(two, tgbReg), "and is stable otherwise");
});

console.log(`\nlibraryscan: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
