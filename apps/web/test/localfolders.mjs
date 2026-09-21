#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/sources/localFolders.svelte.ts` — the list of the user's local
 * content folders that replaces the single "romDir".
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/localfolders.mjs'
 *
 * Plain node, no framework (repo convention). Nothing here touches a device or a browser: the
 * storage layer is INJECTED (`LocalFolderDeps`), the way `bundleStore.ts` takes a
 * `BundleBlobStore`, so the failure cases that matter — a handle that is gone, a permission
 * that is refused — are staged directly rather than hoped for.
 *
 * The contract under test:
 *   - an EMPTY `usedBy` means "Any": the folder serves every target. That is the default and
 *     the permissive case; a non-empty list narrows it. There is no separate "any" boolean.
 *   - one folder can serve an emulator AND a homebrew target at once (the whole point).
 *   - add / rename / associate / remove survive a reload through the fake storage.
 *   - removing a folder removes its handle (or IndexedDB leaks entries forever).
 *   - `load()` is idempotent.
 *   - a missing or permission-denied handle yields a DEGRADED BUT PRESENT row, never a
 *     silently dropped one.
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

// --- Build the store. `$state` is a Svelte rune, defined away for node the same way
// `test/safety.mjs` does it: `$state(x)` becomes `x` and assignments are plain.
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-localfolders-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/localFolders.svelte.ts")],
  outfile: join(out, "localFolders.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
});

// persist.ts is bundled in (the module's default deps import it); give it a real localStorage
// so the import path is the browser's. The tests themselves inject their own storage.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const mod = await import(pathToFileURL(join(out, "localFolders.js")).href);
const { LocalFolderStore, servesTarget, displayName, handleKey, targetKey } = mod;

// --- Fake storage ---------------------------------------------------------------------
function makeStorage() {
  const sel = new Map();
  const dirs = new Map();
  /** Handles whose permission query answers false (the "needs a re-grant" case). */
  const denied = new Set();
  /** Handles whose INTERACTIVE request also refuses. */
  const hardDenied = new Set();
  let ids = 0;
  return {
    sel, dirs, denied, hardDenied,
    deps: {
      loadSel: (k, fb) => (sel.has(k) ? JSON.parse(sel.get(k)) : fb),
      saveSel: (k, v) => void sel.set(k, JSON.stringify(v)),
      loadDir: async (k) => (dirs.has(k) ? dirs.get(k) : null),
      saveDir: async (k, h) => void dirs.set(k, h),
      deleteDir: async (k) => void dirs.delete(k),
      handlePermission: async (h, _mode, interactive) => {
        if (hardDenied.has(h)) return false;
        if (denied.has(h)) {
          if (!interactive) return false;
          denied.delete(h);
          return true;
        }
        return true;
      },
      // Identity by object reference: the fake handles below are shared objects, which is
      // exactly what `FileSystemHandle.isSameEntry()` answers for one real directory.
      isSameEntry: async (a, b) => a === b,
      newId: () => `id-${++ids}`,
    },
  };
}
// Native File System Access handles are structured-cloneable and expose
// getDirectoryHandle(). The production store uses that capability to distinguish
// persistable Chromium handles from the read-only webkitdirectory fallback.
const handle = (name) => ({
  name,
  getDirectoryHandle: async () => ({ kind: "directory", name }),
});

const EMU = targetKey("org/retro-go", "gnw");
const HB = targetKey("someone/zelda3", "zelda3");
const OTHER = targetKey("other/pack", "smw");

// 1. Empty usedBy is "Any".
await check("an empty usedBy serves every target", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const row = await store.add({ handle: handle("ROMs") });
  deepEq(row.usedBy, [], "default usedBy is empty");
  ok(servesTarget(row, EMU), "serves an emulator target");
  ok(servesTarget(row, HB), "serves a homebrew target");
  ok(servesTarget(row, "anything/at#all"), "serves an unknown target");
  eq(store.foldersFor(OTHER).length, 1, "offered to an unrelated target too");
});

// 2. A narrowed folder matches only what it names.
await check("a non-empty usedBy narrows to exactly the listed targets", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const row = await store.add({ handle: handle("SNES"), usedBy: [EMU] });
  ok(servesTarget(store.get(row.id), EMU), "serves the listed target");
  ok(!servesTarget(store.get(row.id), HB), "does NOT serve an unlisted target");
  eq(store.foldersFor(HB).length, 0, "not offered to an unlisted target");
  eq(store.foldersFor(EMU).length, 1, "offered to the listed one");
});

// 3. One folder, both flavours of target.
await check("one folder can serve an emulator and a homebrew title at once", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const row = await store.add({ handle: handle("Shared"), usedBy: [EMU] });
  store.associate(row.id, HB);
  deepEq(store.get(row.id).usedBy, [EMU, HB], "both keys held");
  eq(store.foldersFor(EMU)[0].id, row.id, "offered to the emulator");
  eq(store.foldersFor(HB)[0].id, row.id, "offered to the homebrew title");
  eq(store.foldersFor(OTHER).length, 0, "still narrowed");
});

await check("dropping the last association returns the folder to Any", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const row = await store.add({ handle: handle("R"), usedBy: [EMU] });
  store.disassociate(row.id, EMU);
  deepEq(store.get(row.id).usedBy, [], "list is empty again");
  ok(servesTarget(store.get(row.id), OTHER), "Any once more");
});

// 3b. A key may name ONE SYSTEM of a target, since the "Used by" menu lists systems separately.
//     Everything that asks "does this folder serve target X" must still say yes -- an input
//     belongs to a target, not to a console, and the alternative is a silent un-association.
await check("a folder narrowed to one SYSTEM still serves its target", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const row = await store.add({ handle: handle("GBC"), usedBy: [`${EMU}@gbc`] });
  ok(servesTarget(store.get(row.id), EMU), "the target half is what is matched");
  eq(store.foldersFor(EMU).length, 1, "offered to its target");
  // ARMED: narrowing is still narrowing -- this is not a match-everything regression.
  ok(!servesTarget(store.get(row.id), HB), "and not to an unrelated target");
  eq(store.foldersFor(OTHER).length, 0, "nor an unrelated one");
});

await check("disassociating a target drops its system-scoped keys too", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const row = await store.add({ handle: handle("GB+GBC"), usedBy: [`${EMU}@gb`, `${EMU}@gbc`, HB] });
  store.disassociate(row.id, EMU);
  deepEq(store.get(row.id).usedBy, [HB], "both systems of that target are gone, the other stays");
  ok(!servesTarget(store.get(row.id), EMU), "so the source's page stops listing it");
});

// 4. Round-trips through persistence.
await check("add / rename / associate round-trip through a reload", async () => {
  const s = makeStorage();
  const a = new LocalFolderStore(s.deps);
  await a.load();
  const row = await a.add({ handle: handle("Disk"), usedBy: [HB] });
  a.rename(row.id, "My homebrew");
  a.associate(row.id, EMU);

  const b = new LocalFolderStore(s.deps);
  await b.load();
  eq(b.folders.length, 1, "one row restored");
  const r = b.folders[0];
  eq(r.id, row.id, "id survives");
  eq(r.name, "My homebrew", "label survives");
  eq(r.folderName, "Disk", "the folder's own name survives");
  deepEq(r.usedBy, [HB, EMU], "associations survive");
  eq(r.status, "ready", "handle re-adopted");
  eq(displayName(r), "My homebrew", "label wins for display");
});

await check("clearing the label falls back to the folder's own name", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const row = await store.add({ handle: handle("Games"), name: "Label" });
  store.rename(row.id, "");
  eq(displayName(store.get(row.id)), "Games", "falls back to folderName");
});

await check("internal OFW backup metadata never leaks into the displayed name", async () => {
  eq(displayName({ name: "", folderName: "__ofw_backup__" }), "OFW Backup",
    "the reserved backup folder key must have a user-facing label");
});

await check("remove round-trips: the row is gone after a reload", async () => {
  const s = makeStorage();
  const a = new LocalFolderStore(s.deps);
  await a.load();
  const one = await a.add({ handle: handle("A") });
  await a.add({ handle: handle("B") });
  await a.remove(one.id);
  const b = new LocalFolderStore(s.deps);
  await b.load();
  eq(b.folders.length, 1, "only the survivor came back");
  eq(b.folders[0].folderName, "B", "and it is the right one");
});

// 5. Removing a folder removes its handle (IndexedDB leak guard).
await check("removing a folder deletes its stored handle", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const row = await store.add({ handle: handle("A") });
  ok(s.dirs.has(handleKey(row.id)), "handle was stored under the row's id");
  await store.remove(row.id);
  eq(s.dirs.size, 0, "handle store is empty again");
});

await check("the handle is keyed by the generated id, not the folder name", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const a = await store.add({ handle: handle("roms") });
  const b = await store.add({ handle: handle("roms") });
  ok(a.id !== b.id, "two same-named folders get distinct ids");
  eq(s.dirs.size, 2, "and two distinct handle entries");
  ok(!JSON.stringify([...s.sel.values()]).includes('"handle"'), "no handle in localStorage");
});

// 6. load() idempotence.
await check("load() is idempotent and does not duplicate rows", async () => {
  const s = makeStorage();
  const a = new LocalFolderStore(s.deps);
  await a.load();
  await a.add({ handle: handle("A") });
  const b = new LocalFolderStore(s.deps);
  await b.load();
  await b.load();
  await b.load();
  eq(b.folders.length, 1, "still one row after three loads");
});

await check("a second load() does not clobber rows added since the first", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  await store.add({ handle: handle("A") });
  await store.load();
  eq(store.folders.length, 1, "the freshly added row is still there");
});

// 7. Degraded-but-present rows.
await check("a handle that is gone yields a present row with status missing", async () => {
  const s = makeStorage();
  const a = new LocalFolderStore(s.deps);
  await a.load();
  const row = await a.add({ handle: handle("Gone"), usedBy: [EMU] });
  s.dirs.delete(handleKey(row.id)); // cleared storage / revoked

  const b = new LocalFolderStore(s.deps);
  await b.load();
  eq(b.folders.length, 1, "row survives with no handle");
  eq(b.folders[0].status, "missing", "and says so");
  eq(b.folders[0].handle, null, "no handle");
  eq(displayName(b.folders[0]), "Gone", "still nameable, so it can be re-pointed");
  deepEq(b.folders[0].usedBy, [EMU], "associations preserved for the re-point");
});

await check("a handle awaiting a re-grant yields needs-permission, not a drop", async () => {
  const s = makeStorage();
  const h = handle("Locked");
  const a = new LocalFolderStore(s.deps);
  await a.load();
  await a.add({ handle: h });
  s.denied.add(h); // next visit: query says no, an interactive request would say yes

  const b = new LocalFolderStore(s.deps);
  await b.load();
  eq(b.folders.length, 1, "row survives");
  eq(b.folders[0].status, "needs-permission", "degraded, not dropped");
  ok(b.folders[0].handle !== null, "handle retained so a re-grant is possible");
  eq(b.readyFoldersFor(EMU).length, 0, "not offered as usable");
  eq(await b.grant(b.folders[0].id), true, "an interactive grant fixes it");
  eq(b.folders[0].status, "ready", "status updated in place");
  eq(b.readyFoldersFor(EMU).length, 1, "now usable");
});

await check("a refused interactive grant leaves the row needs-permission", async () => {
  const s = makeStorage();
  const h = handle("Nope");
  const a = new LocalFolderStore(s.deps);
  await a.load();
  await a.add({ handle: h });
  s.hardDenied.add(h);
  const b = new LocalFolderStore(s.deps);
  await b.load();
  eq(b.folders[0].status, "needs-permission", "restored as needing permission");
  eq(await b.grant(b.folders[0].id), false, "the grant was refused");
  eq(b.folders[0].status, "needs-permission", "and the row still says so");
});

await check("repoint keeps id, label and associations while replacing the handle", async () => {
  const s = makeStorage();
  const a = new LocalFolderStore(s.deps);
  await a.load();
  const row = await a.add({ handle: handle("Old"), name: "Mine", usedBy: [HB] });
  s.dirs.delete(handleKey(row.id));
  const b = new LocalFolderStore(s.deps);
  await b.load();
  await b.repoint(row.id, handle("New"));
  const r = b.get(row.id);
  eq(r.status, "ready", "usable again");
  eq(r.folderName, "New", "points at the new directory");
  eq(r.name, "Mine", "label kept");
  deepEq(r.usedBy, [HB], "associations kept");
  ok(s.dirs.has(handleKey(row.id)), "new handle persisted under the same id");
});

// 8. Junk in localStorage must not take the list down.
await check("malformed persisted records are dropped, good ones survive", async () => {
  const s = makeStorage();
  s.sel.set(
    "localFolders.v1",
    JSON.stringify([null, 42, { kind: "roms" }, { id: "keep", usedBy: ["a", "a", 7] }]),
  );
  s.dirs.set(handleKey("keep"), handle("K"));
  const store = new LocalFolderStore(s.deps);
  await store.load();
  eq(store.folders.length, 1, "only the record with an id survived (a bare v1 kind is not one)");
  deepEq(store.folders[0].usedBy, ["a"], "usedBy de-duplicated and de-junked");
});


// --- adopt(): re-picking a directory must not clone its row -------------------------------
//
// A file prompt offers no list of what is already registered, so picking the same folder twice
// is trivially easy. `add()` mints a fresh id every time; `adopt()` is the identity-aware door.

await check("adopt registers a folder the store has never seen", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const h = handle("DATA");
  const row = await store.adopt({ handle: h, usedBy: [HB] });
  eq(store.folders.length, 1, "one row");
  deepEq(row.usedBy, [HB], "pinned to the target that asked");
  eq(s.dirs.get(handleKey(row.id)), h, "and its handle reached IndexedDB");
});

await check("adopt of the SAME directory reuses the row instead of cloning it", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const h = handle("DATA");
  const first = await store.adopt({ handle: h, usedBy: [HB] });
  const again = await store.adopt({ handle: h, usedBy: [HB] });
  eq(store.folders.length, 1, "still ONE row for one directory on disk");
  eq(again.id, first.id, "and it is the same row");
});

await check("adopt WIDENS a narrowed row rather than replacing its associations", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const h = handle("DATA");
  await store.adopt({ handle: h, usedBy: [HB] });
  const row = await store.adopt({ handle: h, usedBy: [EMU] });
  deepEq(row.usedBy, [HB, EMU], "now feeds both, and the first was not dropped");
});

await check("adopt leaves an Any folder on Any, because widening must never narrow", async () => {
  const s = makeStorage();
  const store = new LocalFolderStore(s.deps);
  await store.load();
  const h = handle("ROMs");
  await store.add({ handle: h });
  const row = await store.adopt({ handle: h, usedBy: [HB] });
  deepEq(row.usedBy, [], "still Any: writing [HB] here would RESTRICT a folder the user opened up");
  ok(servesTarget(row, OTHER), "so it still serves everything");
});

await check("adopt re-points a row whose permission had lapsed", async () => {
  const s = makeStorage();
  const h = handle("DATA");
  s.sel.set("localFolders.v1", JSON.stringify([{ id: "old", kind: "homebrew", name: "", folderName: "DATA", usedBy: [HB] }]));
  s.dirs.set(handleKey("old"), h);
  s.denied.add(h);
  const store = new LocalFolderStore(s.deps);
  await store.load();
  eq(store.folders[0].status, "needs-permission", "restored but not yet granted");
  const row = await store.adopt({ handle: h, usedBy: [HB] });
  eq(store.folders.length, 1, "the picked folder IS the dead row, not a new one");
  eq(row.status, "ready", "and picking it is the re-grant");
});


// --- v1 -> Directory migration ------------------------------------------------------------
// The `kind` of "roms"/"homebrew" is gone (localFolders.svelte.ts). A user who registered
// folders under the old model must come back to the same folders, with the same associations
// and the same behaviour, having been asked nothing. There is no re-keying and no version
// bump: `sanitise()` stops reading the field and the next `persist()` drops it, which is what
// keeps the change reversible. These checks pin that, and the SHARED/DEDICATED axis that is
// all a directory has left.

const V1 = [
  { id: "r1", kind: "roms", name: "Games", folderName: "ROMS", usedBy: [] },
  { id: "h1", kind: "homebrew", name: "", folderName: "TombRaider", usedBy: [HB] },
];

await check("v1: a roms folder and a homebrew folder both load as directories", async () => {
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify(V1));
  s.dirs.set(handleKey("r1"), handle("ROMS"));
  s.dirs.set(handleKey("h1"), handle("TombRaider"));
  const store = new LocalFolderStore(s.deps);
  await store.load();
  eq(store.folders.length, 2, "both rows survive the migration");
  const [r1, h1] = store.folders;
  eq(r1.id, "r1", "the ROM folder keeps its id");
  eq(h1.id, "h1", "the homebrew folder keeps its id");
  eq(r1.name, "Games", "its label survives");
  eq(h1.folderName, "TombRaider", "the folder's own name survives");
  deepEq(r1.usedBy, [], "the shared one is still shared");
  deepEq(h1.usedBy, [HB], "the dedicated one still names its target");
  eq(r1.status, "ready", "handles are re-adopted as before");
  eq(h1.status, "ready", "both of them");
  ok(!("kind" in r1), "the row carries no kind any more");
});

await check("v1: shared still serves everything, dedicated still serves only its target", async () => {
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify(V1));
  s.dirs.set(handleKey("r1"), handle("ROMS"));
  s.dirs.set(handleKey("h1"), handle("TombRaider"));
  const store = new LocalFolderStore(s.deps);
  await store.load();
  // The widening the merge exists for: a shared folder is no longer shared-within-one-list.
  deepEq(store.foldersFor(HB).map((f) => f.id), ["r1", "h1"], "the shared folder now reaches a homebrew target too");
  deepEq(store.foldersFor(EMU).map((f) => f.id), ["r1"], "the dedicated one is not offered elsewhere");
  deepEq(store.foldersFor(OTHER).map((f) => f.id), ["r1"], "nor to an unrelated target");
});

await check("v1: the kind is dropped from storage on the next write, not merely ignored", async () => {
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify(V1));
  s.dirs.set(handleKey("r1"), handle("ROMS"));
  s.dirs.set(handleKey("h1"), handle("TombRaider"));
  const store = new LocalFolderStore(s.deps);
  await store.load();
  store.rename("r1", "Renamed");
  const written = JSON.parse(s.sel.get("localFolders.v1"));
  eq(written.length, 2, "both rows are written back");
  ok(!written.some((r) => "kind" in r), "no record carries a kind after a persist");
  eq(written[0].name, "Renamed", "the write that dropped it is the user's own edit");
  deepEq(written[1].usedBy, [HB], "and it did not disturb the other row");
});

await check("v1: a migrated row reloads a second time unchanged", async () => {
  // The migration is a read-time coercion, so the dangerous shape is the SECOND load - the
  // one reading what the first one wrote. A row that lost `usedBy` here would look fine once.
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify(V1));
  s.dirs.set(handleKey("r1"), handle("ROMS"));
  s.dirs.set(handleKey("h1"), handle("TombRaider"));
  const a = new LocalFolderStore(s.deps);
  await a.load();
  a.rename("r1", "Renamed");
  const b = new LocalFolderStore(s.deps);
  await b.load();
  eq(b.folders.length, 2, "still two rows");
  eq(b.folders[0].name, "Renamed", "the label round-trips");
  deepEq(b.folders[1].usedBy, [HB], "the association round-trips");
  eq(b.folders[1].folderName, "TombRaider", "so does the folder name");
});

// --- Surviving a reload ---------------------------------------------------------------
// The owner: "The UI keeps deleting the directory sources I add upon refresh." Three distinct
// defects produce that, and each is staged here rather than argued about.

await check("a folder added WHILE load() is in flight survives", async () => {
  // THE RACE. `load()` reads its snapshot, then awaits IndexedDB per row. A pick landing in
  // that window pushes onto a `folders` that is still empty, so `persist()` writes a list of
  // one and the stored rows are gone; then `load()` finishes and assigns its snapshot over the
  // top, so the row the user just added is gone too. Both halves of the user's list are lost by
  // a pick that looked like it worked.
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify([
    { id: "old", name: "Roms", folderName: "ROMS", usedBy: [] },
  ]));
  s.dirs.set(handleKey("old"), handle("ROMS"));
  const store = new LocalFolderStore(s.deps);
  const loading = store.load();          // deliberately not awaited
  await store.add({ handle: handle("NEW") });
  await loading;
  eq(store.folders.length, 2, "the stored folder and the new one are both present");
  const back = new LocalFolderStore(s.deps);
  await back.load();
  eq(back.folders.length, 2, "and both are still there after a reload");
});

await check("a second load() waits for the first, rather than returning empty", async () => {
  // `loaded = true` is set BEFORE the awaits, so a concurrent caller returns immediately and
  // reads an empty list while believing the read is done. Every "you have no folders" path
  // downstream then acts on that.
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify([
    { id: "a", name: "", folderName: "A", usedBy: [] },
  ]));
  s.dirs.set(handleKey("a"), handle("A"));
  const store = new LocalFolderStore(s.deps);
  const first = store.load();            // in flight
  await store.load();                    // must not resolve before the rows are there
  eq(store.folders.length, 1, "the second caller sees the loaded rows");
  ok(store.ready, "and the store reports itself ready");
  await first;
});

await check("one unreadable handle does not take the whole list with it", async () => {
  // `loadDir` rejecting throws straight out of the loop: `folders` is never assigned, `loaded`
  // stays true so nothing retries, and every row vanishes because ONE was unreadable.
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify([
    { id: "bad", name: "", folderName: "BAD", usedBy: [] },
    { id: "good", name: "", folderName: "GOOD", usedBy: [] },
  ]));
  s.dirs.set(handleKey("good"), handle("GOOD"));
  const deps = { ...s.deps, loadDir: async (k) => {
    if (k === handleKey("bad")) throw new Error("IndexedDB went away");
    return s.deps.loadDir(k);
  } };
  const store = new LocalFolderStore(deps);
  await store.load();
  eq(store.folders.length, 2, "both rows survive; the unreadable one is degraded, not dropped");
  eq(store.folders.find((f) => f.id === "bad").status, "missing", "the unreadable row is missing");
  eq(store.folders.find((f) => f.id === "good").status, "ready", "the readable one is unaffected");
});

await check("a mutation before load() does not write a truncated list", async () => {
  // `persist()` serialises `this.folders`. Called before the read has happened, that is a write
  // of everything the store does NOT know about yet, which is the whole stored list.
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify([
    { id: "keep", name: "Keep", folderName: "KEEP", usedBy: [] },
  ]));
  s.dirs.set(handleKey("keep"), handle("KEEP"));
  const store = new LocalFolderStore(s.deps);
  await store.add({ handle: handle("FRESH") });   // no load() first
  const written = JSON.parse(s.sel.get("localFolders.v1"));
  eq(written.length, 2, "the stored row is still in the file beside the new one");
});

await check("a permission query that throws degrades one row, not the list", async () => {
  // `loadDir` is not the only browser call in the loop. A handle that deserialises but is dead
  // rejects on the permission query instead, and an unguarded rejection loses the list exactly
  // the same way.
  const s = makeStorage();
  s.sel.set("localFolders.v1", JSON.stringify([
    { id: "dead", name: "", folderName: "DEAD", usedBy: [] },
    { id: "live", name: "", folderName: "LIVE", usedBy: [] },
  ]));
  const deadHandle = handle("DEAD");
  s.dirs.set(handleKey("dead"), deadHandle);
  s.dirs.set(handleKey("live"), handle("LIVE"));
  const deps = { ...s.deps, handlePermission: async (h, mode, interactive) => {
    if (h === deadHandle) throw new Error("handle is not usable");
    return s.deps.handlePermission(h, mode, interactive);
  } };
  const store = new LocalFolderStore(deps);
  await store.load();
  eq(store.folders.length, 2, "both rows survive a throwing permission query");
  eq(store.folders.find((f) => f.id === "dead").status, "needs-permission",
    "the dead handle is offered for a re-grant rather than dropped");
  eq(store.folders.find((f) => f.id === "live").status, "ready", "the live one is unaffected");
});

await check("adopt() on an unread store finds the existing row instead of duplicating it", async () => {
  // `adopt` walks `folders` to answer "is this directory already registered". Against a store
  // that has not read yet that walk is over an empty list, so re-picking a folder the user
  // already has mints a SECOND row for one directory on disk, with a second handle.
  const s = makeStorage();
  const shared = handle("ROMS");
  s.sel.set("localFolders.v1", JSON.stringify([
    { id: "have", name: "Roms", folderName: "ROMS", usedBy: [] },
  ]));
  s.dirs.set(handleKey("have"), shared);
  const store = new LocalFolderStore(s.deps);
  const row = await store.adopt({ handle: shared });   // no load() first
  eq(row.id, "have", "the existing row is reused");
  eq(store.folders.length, 1, "no duplicate row for one directory");
  eq(JSON.parse(s.sel.get("localFolders.v1")).length, 1, "and the stored list is not truncated");
});

console.log(`\nlocalfolders: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
