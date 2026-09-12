#!/usr/bin/env node
/**
 * An SD card sync touches the card and nothing else.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/sdsyncdevice.mjs'
 *
 * THE BUG THIS EXISTS FOR. The owner picked an SD card in the new Sources > SD Card pane and
 * then pressed "Sync Library", and the app connected to the device and booted the RAM stub,
 * resetting a running Retro-Go, for what is a pure filesystem write.
 *
 * `doSdSync` itself was never the problem and still is not: nothing in it reaches hardware.
 * The fault is that the app was not in SD mode at all. `device.targetMedia` is persisted,
 * defaults to "flash", and until the card became a SOURCE its only writer was the Landing
 * page. The Sources pane's picker is the first caller that can run while the app still thinks
 * it is flashing, and the Library's dock branches on exactly that flag -- so it drew the FLASH
 * button, which carries the SAME `syncLibraryButton` label, and "Sync Library" quietly meant
 * `ensureConnectGate()` followed by `ensureStub()`.
 *
 * Two checks execute the REAL code (lifted out of the modules, as recoveryrescan.mjs does, so
 * that editing the module is what breaks them) and one walks the tab's own call graph.
 */
let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const SCAN = join(here, "../src/lib/romScan.ts");
const DEVICE = join(here, "../src/lib/device.svelte.ts");
const TAB = join(here, "../src/lib/views/RomManagementTab.svelte");

const scanSrc = readFileSync(SCAN, "utf8");
const deviceSrc = readFileSync(DEVICE, "utf8");
const tabSrc = readFileSync(TAB, "utf8");

// --- 1. picking a card declares the target ----------------------------------------------------

/**
 * The real `adopt` callback out of `pickSdCardFolder`, compiled on its own.
 *
 * Restating it here would test the restatement; the failure being guarded is someone editing
 * the picker, so the picker's own text has to run.
 */
function realAdopt() {
  const at = scanSrc.indexOf("export async function pickSdCardFolder()");
  ok(at >= 0, "no pickSdCardFolder() in romScan.ts");
  const open = scanSrc.indexOf("adopt: async (handle) => {", at);
  ok(open >= 0, "pickSdCardFolder() no longer has an `adopt` callback; this suite cannot " +
    "test what it claims to");
  const end = scanSrc.indexOf("\n    },", open);
  ok(end > open, "the adopt callback is unterminated");
  const body = scanSrc.slice(scanSrc.indexOf("{", open) + 1, end);
  // Armed: if the lift stops matching the real thing, fail loudly rather than pass on a stub.
  ok(/device\.sdHandle\s*=/.test(body), "the lifted body does not assign device.sdHandle; the " +
    "lift is broken and this suite would be testing an invented function");
  return new Function("device", `return async function (handle) {${body}}`);
}

await check("picking an SD card puts the app in SD mode", async () => {
  const order = [];
  const device = {
    sdHandle: null,
    _m: "flash",
    get targetMedia() { return this._m; },
    set targetMedia(v) { this._m = v; order.push(`targetMedia=${v}`); },
    scanSdCardGames: async () => { order.push("scanSdCardGames"); },
  };
  await realAdopt()(device)({ name: "GNW-SD" });
  eq(device.targetMedia, "sd",
    "picking a card left the app in flash mode, so the Library's dock keeps drawing the FLASH " +
    "button under the same 'Sync Library' label and pressing it connects and boots the stub");
});

await check("the mode is set BEFORE the card is read, or the read is a no-op", async () => {
  const order = [];
  const device = {
    sdHandle: null,
    _m: "flash",
    get targetMedia() { return this._m; },
    set targetMedia(v) { this._m = v; order.push(`targetMedia=${v}`); },
    scanSdCardGames: async () => { order.push("scanSdCardGames"); },
  };
  await realAdopt()(device)({ name: "GNW-SD" });
  const mode = order.indexOf("targetMedia=sd");
  const scan = order.indexOf("scanSdCardGames");
  ok(mode >= 0 && scan >= 0, `both steps have to happen: ${JSON.stringify(order)}`);
  ok(mode < scan,
    `scanSdCardGames() early-returns on targetMedia !== "sd" and CLEARS installedGames, so ` +
    `reading the card before the mode is set leaves the baseline empty and the next sync ` +
    `calls itself a fresh target and rewrites the whole selection: ${JSON.stringify(order)}`);
});

// --- 2. why the order matters: the real guard -------------------------------------------------

/** The real `scanSdCardGames` guard, lifted and executed against a stub `this`. */
function realScanGuard() {
  const at = deviceSrc.indexOf("async scanSdCardGames(): Promise<void> {");
  ok(at >= 0, "no scanSdCardGames() in device.svelte.ts");
  const body = deviceSrc.slice(deviceSrc.indexOf("{", at) + 1);
  const guard = body.slice(0, body.indexOf("}") + 1);
  ok(/targetMedia\s*!==\s*'sd'|targetMedia\s*!==\s*"sd"/.test(guard),
    "scanSdCardGames() no longer guards on targetMedia; this check is testing nothing");
  return new Function(`return async function () {${guard}\n return "scanned";}`)();
}

await check("reading a card while the app thinks it is flashing clears the baseline", async () => {
  const self = { targetMedia: "flash", sdHandle: { name: "GNW-SD" }, installedGames: [{ name: "x" }] };
  const out = await realScanGuard().call(self);
  eq(out, undefined, "the guard did not early-return for a flash-mode read");
  eq(self.installedGames, [],
    "the guard is what makes the ordering above load-bearing: it wipes installedGames");
});

await check("reading a card in SD mode gets past the guard", async () => {
  const self = { targetMedia: "sd", sdHandle: { name: "GNW-SD" }, installedGames: [] };
  const out = await realScanGuard().call(self);
  eq(out, "scanned", "an SD-mode read was refused, so the card would never be scanned at all");
});

// --- 3. the sync path itself reaches no hardware ----------------------------------------------

/**
 * Walk the tab's own call graph from the SD button and report any function that reaches a
 * device primitive.
 *
 * Scoped to this file's own top-level functions, which is where the two media's paths are
 * written and where a stray call would be added. Bounded, and it says so: a primitive reached
 * through a store method is out of its sight, which is why the two checks above execute real
 * code rather than leaning on this one.
 */
const HARDWARE = ["ensureStub", "ensureConnectGate", "connectSilent", "ensureUnlocked", "runScan", "dumpRegion"];

/** Comments have to go first: `doSdSync`'s own text says "mirrors runInstall()'s post-FrogFS
 *  flash rescan", and a walker that reads prose follows that into the flash installer and
 *  reports its hardware as the SD path's. That was a false positive on this suite's first run. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function bodies(src) {
  const out = new Map();
  const re = /\n  (?:async )?function ([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf("{", re.lastIndex - 1);
    let depth = 0, i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    out.set(m[1], src.slice(open, i + 1));
  }
  return out;
}

await check("every device call the SD path can reach is behind a media guard", () => {
  const fns = bodies(stripComments(tabSrc));
  ok(fns.has("doSdSync") && fns.has("handleSdSyncClick"),
    `could not lift doSdSync/handleSdSyncClick from RomManagementTab.svelte (saw ` +
    `${fns.size} functions); this suite cannot test what it claims to`);
  ok(fns.has("runInstall") && HARDWARE.some((h) => fns.get("runInstall").includes(h)),
    "the walker sees no hardware call in runInstall(), which is full of them; its matching " +
    "is broken and the SD result below would be a false pass");

  const seen = new Set();
  const unguarded = [];
  const walk = (name) => {
    if (seen.has(name) || !fns.has(name)) return;
    seen.add(name);
    const body = fns.get(name);
    // CLAUDE.md's rule: anything Flash-only reached from a shared path must early-out on
    // `targetMedia`. A function holding a primitive with no such test is one the SD sync runs
    // into unconditionally, which is the bug shape being guarded.
    const guarded = /targetMedia/.test(body);
    for (const h of HARDWARE) if (body.includes(h) && !guarded) unguarded.push(`${name} -> ${h}`);
    for (const other of fns.keys()) {
      if (other !== name && new RegExp(`\\b${other}\\s*\\(`).test(body)) walk(other);
    }
  };
  walk("handleSdSyncClick");
  walk("doSdSync");
  eq(unguarded, [],
    "an SD card sync reaches a device primitive with no targetMedia guard in front of it; " +
    "writing a card must not connect, halt, boot the stub or reset anything");
  ok(seen.size >= 3, `the walk only visited ${seen.size} function(s); it is not walking`);
});

// ----------------------------------------------------------------------------------------------
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`sd sync device: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
