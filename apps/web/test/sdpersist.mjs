#!/usr/bin/env node
/**
 * THE PICKED SD CARD IS REMEMBERED, AND IS THERE BEFORE ANYONE CONCLUDES IT IS NOT.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/sdpersist.mjs'
 *
 * The owner, twice, from two directions: "It seems the SD card isn't being saved - same
 * persistence issue we've seen elsewhere", and "the modal SD card prompt doesn't save the SD
 * card to the Sources SD Card page".
 *
 * Both were one bug. `device.sdHandle` was a bare `$state(null)` that NOTHING persisted --
 * `saveDir` had four callers and none of them was the card -- while `targetMedia` and the
 * stated capacity both did persist. So a reload came back in SD mode, with a remembered size,
 * and no card. The Sources SD page derives its state from that same handle, so it had nothing
 * to show either; there was never a second registration path that forgot to run.
 *
 * What this pins, in the order the bug happened:
 *
 *   - a handle written through the setter reaches the STORE, and survives a fresh page;
 *   - the restore runs at CONSTRUCTION, not on first read (the `favorites` failure mode, where
 *     a lazy load from a `$derived` left the store empty for the life of the page);
 *   - a card picked while the read is in flight is not overwritten by it;
 *   - the shim that cannot be structured-cloned is never handed to IndexedDB;
 *   - the folder gate and the Sources pane both WAIT for the restore, which is what stops the
 *     modal asking for a card the app is about to hold.
 *
 * The round trip goes through the serialised store, not a live object: every "reload" below
 * drops the module instance and keeps only what IndexedDB holds. A check that kept the same
 * in-memory store would pass while this bug was live, which is the mistake the favourites fix
 * made and caught.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gnwResolveFor } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const esbuild = await import("esbuild");

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const acheck = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const ok = (c, m) => {
  if (!c) throw new Error(m);
};
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// --- a disk that outlives a page ---------------------------------------------------------
// Minimal IndexedDB, enough for the REAL persist.ts to drive: open/createObjectStore,
// a readwrite put/delete, a readonly get. Backed by a Map held OUT here, so dropping the
// module instance (a reload) keeps the bytes exactly as a browser would.
function makeIdb() {
  const dbs = new Map(); // dbName -> Map(key -> value)
  const fire = (obj, prop, arg) => queueMicrotask(() => obj[prop]?.(arg));
  return {
    _dump: (name) => Object.fromEntries(dbs.get(name) ?? new Map()),
    open(name) {
      const req = {};
      const fresh = !dbs.has(name);
      if (fresh) dbs.set(name, new Map());
      const store = dbs.get(name);
      const db = {
        createObjectStore: () => {},
        close: () => {},
        transaction: () => {
          const tx = {
            objectStore: () => ({
              put: (v, k) => store.set(k, v),
              delete: (k) => store.delete(k),
              get: (k) => {
                const r = {};
                fire(r, "onsuccess", { target: { result: store.get(k) } });
                Object.defineProperty(r, "result", { get: () => store.get(k) });
                return r;
              },
            }),
          };
          fire(tx, "oncomplete");
          return tx;
        },
      };
      req.result = db;
      queueMicrotask(() => {
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

// A native FSAA handle duck-types on getDirectoryHandle; the <input webkitdirectory> shim does
// not, and is not structured-cloneable. `dirSupportsWriteBack` draws the same line.
const nativeCard = { name: "GNW-SD", getDirectoryHandle: () => {} };
const shimCard = { name: "GNW-SD" };

const outDir = mkdtempSync(join(tmpdir(), "gnw-sdpersist-"));
let seq = 0;
const persistBuilt = (
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/persist.ts")],
    bundle: true,
    format: "esm",
    write: false,
    platform: "neutral",
  })
).outputFiles[0].text;

/** A fresh `persist.ts` instance -- i.e. a new page against the same disk. */
async function freshPersist(idb) {
  const f = join(outDir, `persist${seq++}.mjs`);
  writeFileSync(f, persistBuilt);
  globalThis.indexedDB = idb;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  return await import(`file://${f}`);
}

// --- the real source, for the lifts and the wiring ---------------------------------------
const deviceSrc = readFileSync(join(here, "../src/lib/device.svelte.ts"), "utf8");
const librarySrc = readFileSync(join(here, "../src/lib/library.svelte.ts"), "utf8");
const sourcesSrc = readFileSync(join(here, "../src/lib/views/Sources.svelte"), "utf8");
const romScanSrc = readFileSync(join(here, "../src/lib/romScan.ts"), "utf8");

/** Strip block and line comments, so a rule is never "matched" inside prose about it. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The REAL `set sdHandle` body, lifted and run against a recording persist layer. */
function liftSetter() {
  const m = code(deviceSrc).match(/set sdHandle\(val: any\) \{([\s\S]*?)\n  \}/);
  ok(m, "could not lift `set sdHandle` from device.svelte.ts; this suite would be testing an " +
    "invented setter rather than the one the app uses");
  const body = m[1].replace(/SD_DIR_KEY/g, '"sdDir"');
  // Armed: the whole point of the setter is that it persists. If the lift stops containing a
  // save, the checks below would pass against a setter that does nothing.
  ok(/saveDir\(/.test(body), "the lifted setter does not call saveDir; the lift is broken");
  return new Function("saveDir", "deleteDir", "self", `return function (val) {${body}}`);
}

/** The REAL `_restoreSdHandle` body, lifted and run against a recording persist layer. */
function liftRestore() {
  const m = code(deviceSrc).match(/private async _restoreSdHandle\(\): Promise<void> \{([\s\S]*?)\n  \}/);
  ok(m, "could not lift `_restoreSdHandle` from device.svelte.ts; this suite would be testing " +
    "an invented restore");
  const body = m[1].replace(/SD_DIR_KEY/g, '"sdDir"');
  ok(/loadDir\(/.test(body), "the lifted restore does not call loadDir; the lift is broken");
  return new Function("loadDir", "dbg", "self", `return async function () {${body}}`);
}

// --- 1. the store actually round-trips ----------------------------------------------------
await acheck("A PICKED CARD SURVIVES A RELOAD: it is written to the store and read back", async () => {
  const idb = makeIdb();
  const page1 = await freshPersist(idb);
  await page1.saveDir("sdDir", nativeCard);

  // The reload. Nothing in memory crosses this line; only what the disk holds.
  const page2 = await freshPersist(idb);
  const back = await page2.loadDir("sdDir");
  ok(back, "the remembered card did not survive a reload: loadDir returned nothing after " +
    "saveDir, so the card is gone the moment the tab is");
  eq(back.name, "GNW-SD", "a different card came back than was stored");
});

await acheck("clearing the card forgets it, so a reload does not resurrect it", async () => {
  const idb = makeIdb();
  const page1 = await freshPersist(idb);
  await page1.saveDir("sdDir", nativeCard);
  await page1.deleteDir("sdDir");
  const page2 = await freshPersist(idb);
  eq(await page2.loadDir("sdDir"), null, "a card cleared before the reload came back after it");
});

// --- 2. the setter is the registration ----------------------------------------------------
await acheck("ASSIGNING THE HANDLE PERSISTS IT, so no caller can half-register a card", async () => {
  const setter = liftSetter();
  const saved = [];
  const deleted = [];
  const self = { _sdHandle: null };
  setter((k, v) => saved.push([k, v.name]), (k) => deleted.push(k), self).call(self, nativeCard);
  eq(saved, [["sdDir", "GNW-SD"]],
    "assigning device.sdHandle did not reach the store, so a caller that sets the field " +
    "without calling the picker leaves the card unremembered");
});

await acheck("the shim that cannot be cloned is never handed to IndexedDB", async () => {
  const setter = liftSetter();
  const saved = [];
  const self = { _sdHandle: null };
  setter((k, v) => saved.push(k), () => {}, self).call(self, shimCard);
  eq(saved, [],
    "the <input webkitdirectory> shim was sent to saveDir; it is not structured-cloneable, so " +
    "IndexedDB rejects it and the write fails silently");
});

await acheck("clearing the handle deletes the stored one rather than leaving it behind", async () => {
  const setter = liftSetter();
  const deleted = [];
  const self = { _sdHandle: nativeCard };
  setter(() => {}, (k) => deleted.push(k), self).call(self, null);
  eq(deleted, ["sdDir"],
    "setting the handle to null left the stored card in place, so the next reload restores a " +
    "card the user has cleared");
});

// --- 3. the restore is eager, and defers to a live pick -----------------------------------
await acheck("THE RESTORE RUNS AT CONSTRUCTION, not on first read", async () => {
  // `_sdRestored` is a FIELD INITIALIZER. A getter would make it lazy, which is the shape that
  // left `favorites` empty for the life of the page, and the reason its header says so.
  const src = code(deviceSrc);
  ok(/private _sdRestored: Promise<void> = this\._restoreSdHandle\(\);/.test(src),
    "the restore is not started by a field initializer, so it is lazy: the first reader sees " +
    "an empty handle and concludes there is no card");
  ok(!/get sdHandle\(\)[^}]*_restoreSdHandle/.test(src),
    "the restore is reachable from the `sdHandle` getter; a lazy load from a reader is the " +
    "favorites failure mode, and in a $derived it throws state_unsafe_mutation");
});

await acheck("a stored card is adopted by the restore", async () => {
  const restore = liftRestore();
  const self = { _sdHandle: null };
  await restore(async () => nativeCard, () => {}, self).call(self);
  eq(self._sdHandle?.name, "GNW-SD",
    "the restore read the card but did not adopt it, so the app starts with no card anyway");
});

await acheck("a card picked while the read was in flight is NOT overwritten by it", async () => {
  const restore = liftRestore();
  const justPicked = { name: "FRESH-PICK", getDirectoryHandle: () => {} };
  const self = { _sdHandle: justPicked };
  await restore(async () => nativeCard, () => {}, self).call(self);
  eq(self._sdHandle.name, "FRESH-PICK",
    "the restore clobbered a card the user picked while it was loading, swapping the card out " +
    "from under them");
});

await acheck("a store that cannot be read is not fatal, and is reported", async () => {
  const restore = liftRestore();
  const logged = [];
  const self = { _sdHandle: null };
  await restore(async () => { throw new Error("blocked"); }, (m) => logged.push(m), self).call(self);
  eq(self._sdHandle, null, "a failed restore left something other than no card");
  ok(logged.some((l) => /\[sd\]/.test(l)),
    "a failed restore said nothing; it must reach the activity log, which a deployed build " +
    "can show and a bug report can carry");
});

// --- 4. nobody concludes "no card" before the read has settled ----------------------------
await acheck("THE FOLDER GATE WAITS for the restore before asking for a card", async () => {
  const src = code(librarySrc);
  const m = src.match(/async ensureFolders\(sd: boolean\): Promise<void> \{([\s\S]*?)\n  \}/);
  ok(m, "could not lift ensureFolders from library.svelte.ts; this suite cannot test what it claims to");
  const body = m[1];
  ok(/await device\.whenSdRestored\(\)/.test(body),
    "ensureFolders does not await the restore, so it reads a null handle on a fresh load and " +
    "raises the modal for a card the app is about to hold: " + body.trim().slice(0, 140));
  // Order matters: awaiting AFTER the decision would be no await at all.
  ok(body.indexOf("whenSdRestored") < body.indexOf("romFolderGateNeeded"),
    "the restore is awaited after the gate has already decided, which is the same as not " +
    "awaiting it");
});

await acheck("THE SOURCES SD PAGE WAITS for it too, so a remembered card is not drawn as absent", async () => {
  const src = code(sourcesSrc);
  const m = src.match(/async function rescanSdCard\(\): Promise<void> \{([\s\S]*?)\n  \}/);
  ok(m, "could not lift rescanSdCard from Sources.svelte; this suite cannot test what it claims to");
  ok(/await device\.whenSdRestored\(\)/.test(m[1]),
    "the SD pane refreshes without awaiting the restore, so it walks a null handle and reports " +
    "`unavailable` -- the page saying no card is chosen for a card we hold");
  ok(/readSdCardIfUnread/.test(src),
    "nothing reads the card when the pane is opened, so a restored card shows as unread until " +
    "the user presses Rescan");
});

await acheck("THE LIBRARY TAB waits for it before deciding there is no card to scan", async () => {
  const src = code(readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8"));
  const m = src.match(/onMount\(\(\) => \{([\s\S]*?)\n  \}\);/);
  ok(m, "could not lift RomManagementTab's onMount; this suite cannot test what it claims to");
  ok(/whenSdRestored\(\)[\s\S]*sdAutoScannedHandle = device\.sdHandle/.test(m[1]),
    "the once-per-handle SD scan runs before the restore has settled, so it sees a null handle " +
    "and never fires -- leaving installedGames empty, which is what makes the next sync call " +
    "itself a fresh target and rewrite the entire selection");
});

// --- 5. the owner's exact report: the MODAL path, then a reload ---------------------------
await acheck("A CARD PICKED IN THE MODAL REACHES THE SOURCES PAGE AFTER A RELOAD", async () => {
  // One path, not two. The gate modal's SD row and the Sources pane both call
  // `pickSdCardFolder`, whose `adopt` is lifted here and driven against the real setter and a
  // real store, then read back by the real restore on a fresh page.
  const m = code(romScanSrc).match(/adopt: async \(handle\) => \{([\s\S]*?)\n    \},/);
  ok(m, "could not lift pickSdCardFolder's adopt from romScan.ts; this suite would be testing " +
    "an invented pick");
  ok(/device\.sdHandle\s*=/.test(m[1]), "the lifted adopt does not set device.sdHandle");
  const adopt = new Function("device", `return async function (handle) {${m[1]}}`);

  const idb = makeIdb();
  const page1 = await freshPersist(idb);
  const setter = liftSetter()(
    (k, v) => page1.saveDir(k, v),
    (k) => page1.deleteDir(k),
    null,
  );
  // A device stand-in whose sdHandle setter is the REAL one.
  const store = { _sdHandle: null, targetMedia: "flash", scanSdCardGames: async () => {} };
  Object.defineProperty(store, "sdHandle", {
    get() { return this._sdHandle; },
    set(v) { setter.call(this, v); },
  });
  await adopt(store)(nativeCard);
  eq(store.targetMedia, "sd", "picking a card in the modal left the app in flash mode");

  // The reload: a new page, a new device, only the disk in common.
  const page2 = await freshPersist(idb);
  const restore = liftRestore();
  const reloaded = { _sdHandle: null };
  await restore((k) => page2.loadDir(k), () => {}, reloaded).call(reloaded);
  ok(reloaded._sdHandle,
    "a card picked through the folder modal was gone after a reload, so the Sources SD Card " +
    "page -- which derives its state from this handle -- has nothing to show");
  eq(reloaded._sdHandle.name, "GNW-SD", "a different card came back than the modal picked");
});

// --- 6. the pane actually READS the restored card -----------------------------------------
// The real sdStorage store, so the guard below meets the real INITIAL state rather than an
// assumed one. Bundled exactly as test/sdstorage.mjs does, including the @gnw resolver: this
// module reaches engine/devicePaths.ts, which pulls the littlefs vendor.
const sdOut = mkdtempSync(join(tmpdir(), "gnw-sdstore-"));
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sdStorage.svelte.ts")],
  outfile: join(sdOut, "sdStorage.js"),
  bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "silent",
  define: { $state: "__rune" }, banner: { js: "const __rune = (v) => v;" },
  plugins: [gnwResolveFor(import.meta.url)],
});
const { sdStorage } = await import(`file://${join(sdOut, "sdStorage.js")}`);

/** The REAL `readSdCardIfUnread` body, with its dynamic import replaced by an injected device. */
function liftReader() {
  const m = code(sourcesSrc).match(/async function readSdCardIfUnread\(\): Promise<void> \{([\s\S]*?)\n  \}/);
  ok(m, "could not lift readSdCardIfUnread from Sources.svelte; this suite would be testing an " +
    "invented reader");
  const body = m[1].replace(/const \{ device \} = await import\([^)]*\);/, "");
  ok(/sdStorage\.state/.test(body), "the lifted reader does not consult sdStorage.state; the lift is broken");
  return new Function("device", "sdStorage", "rescanSdCard",
    `return async function () {${body}}`);
}

await acheck("OPENING THE SD PAGE AFTER A RELOAD READS THE RESTORED CARD", async () => {
  // The state a fresh page is really in: the store untouched, the handle restored.
  eq(sdStorage.state.kind, "unknown",
    "sdStorage no longer starts at `unknown`; the reader's guard is written against this exact " +
    "value and this check would stop meaning anything");
  let walked = false;
  const device = { sdHandle: nativeCard, whenSdRestored: async () => {} };
  await liftReader()(device, sdStorage, async () => { walked = true; })();
  ok(walked,
    "the SD page did not read the restored card: its guard admits only `unavailable`, but a " +
    "fresh page starts at `unknown`, so the one case the reader exists for is the one it " +
    "returns early on -- the Library sees the card and the Sources page shows nothing");
});

await acheck("a card already read is not walked again on every visit", async () => {
  let walked = false;
  const device = { sdHandle: nativeCard, whenSdRestored: async () => {} };
  const store = { state: { kind: "ready", totalBytes: 1 } };
  await liftReader()(device, store, async () => { walked = true; })();
  ok(!walked,
    "the pane re-walks the whole card on every visit, which is what the guard exists to avoid");
});

await acheck("with no card there is nothing to read", async () => {
  let walked = false;
  const device = { sdHandle: null, whenSdRestored: async () => {} };
  await liftReader()(device, { state: { kind: "unknown" } }, async () => { walked = true; })();
  ok(!walked, "the pane walked a card it does not have");
});

await acheck("A PANE ALREADY MOUNTED WHEN THE RESTORE LANDS ALSO SHOWS THE CARD", async () => {
  // The trigger has to be the HANDLE, not the navigation. `applyRoute` fires once per distinct
  // route, so a pane already on screen when the handle arrives would never look again -- and a
  // check that only navigates would pass while that was true.
  const src = code(sourcesSrc);
  const effects = [...src.matchAll(/\$effect\(\(\) => \{([\s\S]*?)\n  \}\);/g)].map((m) => m[1]);
  ok(effects.length, "could not lift any $effect from Sources.svelte; this suite cannot test " +
    "what it claims to");
  const follower = effects.find((b) => /device\.sdHandle/.test(b) && /readSdCardIfUnread/.test(b));
  ok(follower,
    "no effect tracks device.sdHandle to read the card, so the read is driven by navigation " +
    "alone: a pane already open when the restore lands never looks again");
  // The write-back inside must not be tracked, or the effect retriggers on its own output.
  ok(/untrack\(/.test(follower),
    "the handle-following effect does not untrack its body; rescanSdCard writes sdStorage.state " +
    "and statedCard, so reading either here would make the effect retrigger itself");
});

await acheck("the read is not wired to the route handler, which fires once per route", async () => {
  const m = code(sourcesSrc).match(/function applyRoute\(raw: string\): void \{([\s\S]*?)\n  \}/);
  ok(m, "could not lift applyRoute from Sources.svelte; this suite cannot test what it claims to");
  ok(!/readSdCardIfUnread/.test(m[1]),
    "the card read still hangs off applyRoute; it fires per distinct route and never again, " +
    "which is the trigger this moved away from");
});

// --- report --------------------------------------------------------------------------------
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`sd persist: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
