#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/sdFolderPick.svelte.ts` — telling a GENUINE SD-card folder
 * pick/scan failure apart from a user CANCEL, and surfacing only the first.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/sdfolderpick.mjs'
 *
 * Plain node, no framework (repo convention). Every dependency is injected, the way
 * `test/localfolders.mjs` fakes its storage, so a permission denial and a scan blow-up are
 * staged directly rather than hoped for.
 *
 * The contract (ModalFolderSdUnreadable.dc.html):
 *   - a throw from the picker or from the scan sets the error and, when a folder was actually
 *     picked, names it;
 *   - a cancel (`pick()` → null) sets NOTHING — it is a no-op by design;
 *   - any later pick clears a previous error, whether it succeeds or is cancelled;
 *   - the gate row's status slot never becomes "done" because of an error (asserted against
 *     FolderGateModal.svelte's own markup: the requirement is still unmet).
 */
import { mkdtempSync, symlinkSync, readFileSync } from "node:fs";
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
function ok(v, msg) { if (!v) throw new Error(msg); }

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-sdfolderpick-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sdFolderPick.svelte.ts")],
  outfile: join(out, "sdFolderPick.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
});
const { runSdCardFolderPick, sdFolderPick } =
  await import(pathToFileURL(join(out, "sdFolderPick.js")).href);

const dir = (name) => ({ name });

/** A recording stand-in for the shared store. */
function makeState() {
  const s = {
    failed: false,
    failedFolder: null,
    clears: 0,
    clear() { s.clears++; s.failed = false; s.failedFolder = null; },
    fail(name) { s.failed = true; s.failedFolder = name; },
  };
  return s;
}

/** A DOMException-shaped failure — what the real catch actually holds. */
function denial(name = "NotAllowedError") {
  const e = new Error("The user denied permission to access the file system.");
  e.name = name;
  return e;
}

await check("a scan failure sets the error and names the picked folder", async () => {
  const state = makeState();
  const logged = [];
  await runSdCardFolderPick({
    pick: async () => dir("NO NAME"),
    adopt: async () => { throw denial(); },
    state,
    onError: (e, h) => logged.push([e.name, h && h.name]),
  });
  eq(state.failed, true, "failed");
  eq(state.failedFolder, "NO NAME", "failedFolder");
  eq(logged.length, 1, "the failure is still logged");
  eq(logged[0][1], "NO NAME", "the log sees the handle too");
});

await check("a picker failure sets the error with no folder name", async () => {
  const state = makeState();
  await runSdCardFolderPick({
    pick: async () => { throw denial("SecurityError"); },
    adopt: async () => { throw new Error("adopt must not run"); },
    state,
  });
  eq(state.failed, true, "failed");
  eq(state.failedFolder, null, "no folder was ever picked, so none is named");
});

await check("a user cancel sets nothing at all", async () => {
  const state = makeState();
  let adopted = 0;
  await runSdCardFolderPick({
    pick: async () => null,
    adopt: async () => { adopted++; },
    state,
  });
  eq(state.failed, false, "a cancel is NOT an error");
  eq(state.failedFolder, null, "a cancel names no folder");
  eq(adopted, 0, "a cancel adopts nothing");
});

await check("a later SUCCESSFUL pick clears a previous error", async () => {
  const state = makeState();
  await runSdCardFolderPick({ pick: async () => dir("NO NAME"), adopt: async () => { throw denial(); }, state });
  eq(state.failed, true, "precondition: failed");
  const adopted = [];
  await runSdCardFolderPick({
    pick: async () => dir("SDCARD"),
    adopt: async (h) => { adopted.push(h.name); },
    state,
  });
  eq(state.failed, false, "the stale error is gone");
  eq(state.failedFolder, null, "and so is the stale folder name");
  eq(adopted.join(","), "SDCARD", "a successful pick still adopts the folder");
});

await check("a later CANCELLED pick also clears a previous error", async () => {
  const state = makeState();
  await runSdCardFolderPick({ pick: async () => dir("NO NAME"), adopt: async () => { throw denial(); }, state });
  eq(state.failed, true, "precondition: failed");
  await runSdCardFolderPick({ pick: async () => null, adopt: async () => {}, state });
  eq(state.failed, false, "a stale error under a folder the user has since changed is worse than none");
  eq(state.failedFolder, null, "no stale name either");
});

await check("the shared singleton is the default target and clears itself", async () => {
  await runSdCardFolderPick({ pick: async () => dir("NO NAME"), adopt: async () => { throw denial(); } });
  eq(sdFolderPick.failed, true, "the module-level store took the failure");
  eq(sdFolderPick.failedFolder, "NO NAME", "…and the folder name");
  await runSdCardFolderPick({ pick: async () => null, adopt: async () => {} });
  eq(sdFolderPick.failed, false, "…and a later cancel cleared it");
});

// --- The gate row itself: an error must not flip the status slot to done ------------------
await check("FolderGateModal draws the error without satisfying the requirement", async () => {
  const src = readFileSync(join(here, "../src/lib/ui/FolderGateModal.svelte"), "utf8");
  const sd = src.slice(src.indexOf("SD card folder (SD mode only)"));
  const row = sd.slice(0, sd.indexOf("</div>\n        {/if}"));
  ok(row.includes("sdFolderPick.failed"), "the SD row must render the failure state");
  ok(row.includes("folderGateModal.errRead"), "…using the approved string");
  ok(row.includes("sdFolderPick.failedFolder"), "…and naming the folder that failed");
  ok(!/mark done[\s\S]{0,200}sdFolderPick/.test(row), "the green check must not be driven by the error");
  // The status slot is decided by device.sdHandle ALONE — the requirement is still unmet.
  const mark = row.slice(row.indexOf("{#if"), row.indexOf("item-label"));
  ok(mark.includes("device.sdHandle"), "the status slot is keyed on the handle");
  ok(!mark.includes("sdFolderPick"), "the status slot must ignore the error entirely");
  // No retry link: `Choose…` on the same row IS the retry, so the row has exactly one control.
  eq((row.match(/<button/g) || []).length, 1, "the SD row must carry exactly one button");
});

if (failures.length) {
  console.error(`sdfolderpick: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`sdfolderpick: ${passed} checks passed`);
