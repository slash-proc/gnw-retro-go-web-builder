#!/usr/bin/env node
/**
 * Offline coverage for the disconnect-safety state machine and the progress store that
 * drives it — `deviceSafety` / `installProgress` in src/lib/installProgress.svelte.ts.
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/safety.mjs'
 *
 * Plain node, no framework (repo convention). NOTHING here touches a device: the only seam
 * the real code offers is `deviceSafety.setNoLinkProbe()` (injected in production by
 * device.svelte.ts as `() => !device.isConnected`), plus `installProgress.run()`'s own
 * `exec` callback. Everything else is the real shipping module.
 *
 * Why this file exists: `deviceSafety.state` is the app's answer to "can I unplug now?".
 * A wrong "safe" is the most damaging answer this codebase can give — it tells a user to
 * pull the cable on a device that is still erasing or programming its flash.
 *
 * The design being pinned (all asymmetries are deliberate, see the module's own comments):
 *   - release() never returns to "safe" while a link exists; it drops only to "settling".
 *   - only markQuiet() — the liveness poll, after the target actually answered — clears
 *     "settling"; it must never pull the warning out from under a hold.
 *   - holds are REFERENCE COUNTED, so a nested flow's inner release cannot drop the warning.
 *   - a link drop while a hold is outstanding is ignored (it is usually the expected
 *     stub-boot USB re-enumeration).
 *   - the injected no-link probe is the one path to "safe" straight out of release(), and
 *     only when there is no live link at all.
 *
 * ANTI-VACUITY: every negative assertion below is run from a state in which the thing it
 * denies is otherwise reachable, and the arming transition is asserted in the same check.
 * The injected probe is a real closure over a mutable flag, never a constant that happens
 * to satisfy the guard under test.
 *
 * `installProgress.svelte.ts` is a RUNES module, so it is compiled for node with `$state`
 * defined away to an identity function (same recipe as src/lib/sources/test/validate.mjs):
 * the rune's reactivity is Svelte's business; the state MACHINE is what this asserts.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// --- Tiny harness ----------------------------------------------------------------------
// Sequential on purpose: the module under test is a singleton store, so checks share state
// and their ORDER is part of what each one sets up.
let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// --- Compile the module under test ------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-safety-"));
// The compiled bundle lives outside the workspace; one link lets node resolve the externals.
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
import { gnwResolveFor } from "./gnwResolve.mjs";
await esbuild.build({
  // logEntry.ts and the two string tables are bundled alongside the store so the audit-log
  // section below can build entries and render them against a CHOSEN table (see section 6).
  entryPoints: [
    join(here, "../src/lib/installProgress.svelte.ts"),
    join(here, "../src/lib/logEntry.ts"),
    join(here, "../src/lib/i18n/en.ts"),
    join(here, "../src/lib/i18n/de.ts"),
    join(here, "../src/lib/i18n/es.ts"),
    join(here, "../src/lib/i18n/fr.ts"),
    join(here, "../src/lib/i18n/ja.ts"),
    join(here, "../src/lib/i18n/ko.ts"),
    join(here, "../src/lib/i18n/pl.ts"),
    join(here, "../src/lib/util.ts"),
    join(here, "../src/lib/i18n/locale.svelte.ts"),
  ],
  outdir: out,
  bundle: true,
  // Shared modules must be ONE instance across the entry points: the locale store is
  // stateful, and section 7 switches it from the test while the store reads it internally.
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  // The runes, defined away: `$state(x)` becomes `x` and the store's assignments are plain.
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url)],
});
// persist.ts touches localStorage at import time (loadSel for the log-open flag). It is
// wrapped in try/catch, but give it a real one anyway so the import path is the browser's.
if (typeof globalThis.localStorage === "undefined") {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
}
const { deviceSafety, installProgress } =
  await import(pathToFileURL(join(out, "installProgress.svelte.js")).href);
const { msg, renderEntry, renderLine, errText } = await import(pathToFileURL(join(out, "logEntry.js")).href);
const { en } = await import(pathToFileURL(join(out, "i18n/en.js")).href);
const { de } = await import(pathToFileURL(join(out, "i18n/de.js")).href);
const { formatSize } = await import(pathToFileURL(join(out, "util.js")).href);
// All seven locales: section 8 asserts the subsystem prefixes are identical across them. The
// five newer assemblers export nothing — they self-register with the locale store — so their
// tables are read back through it, which also proves the registration really happened.
for (const code of ["es", "fr", "ja", "ko", "pl"]) {
  await import(pathToFileURL(join(out, `i18n/${code}.js`)).href);
}
const { locale } = await import(pathToFileURL(join(out, "i18n/locale.svelte.js")).href);
const TABLES = { en, de };
{
  const before = locale.current;
  for (const code of ["es", "fr", "ja", "ko", "pl"]) {
    locale.set(code);
    if (locale.current !== code) throw new Error(`locale ${code} did not register`);
    TABLES[code] = locale.t;
  }
  locale.set(before);
}
const { es, fr, ja, ko, pl } = TABLES;

const S = () => deviceSafety.state;

// ========================================================================================
// 1. Baseline, with NO probe injected yet (production's pre-device.svelte.ts-import state).
// ========================================================================================

await check("baseline: a freshly loaded app says it is safe to unplug", () => {
  eq(S(), "safe", "initial state");
  eq(deviceSafety.unsafe, false, "unsafe mirrors state !== safe");
});

await check("hold() raises the warning to 'writing'", () => {
  deviceSafety.hold();
  eq(S(), "writing", "after hold");
  eq(deviceSafety.unsafe, true, "unsafe");
});

// NOTE (mutation audit): markQuiet()'s two terms — `holds === 0` and `state === "settling"`
// — are each independently sufficient in every REACHABLE state, so removing either one alone
// leaves all three markQuiet checks green. That is not vacuity: removing BOTH does turn this
// check red (verified), which is what the check claims. There is no reachable state that
// separates the terms (`settling` is only ever entered when `holds` reaches 0), so no fixture
// can pin them individually — don't add one chasing it.
await check("markQuiet() does NOT promote out of 'writing' (armed: it does out of settling)", () => {
  // A ping answered mid-flash proves the device is alive, NOT that the write finished. If
  // this promoted, the header would say "safe to unplug" during an erase.
  eq(S(), "writing", "precondition: a hold is outstanding");
  deviceSafety.markQuiet();
  eq(S(), "writing", "markQuiet must not clear a held warning");
  // Arming: from the state release() actually produces, the very same call DOES reach safe,
  // so this check cannot be passing merely because markQuiet is inert.
  deviceSafety.release();
  eq(S(), "settling", "release drops to settling");
  deviceSafety.markQuiet();
  eq(S(), "safe", "…and markQuiet promotes from there");
});

await check("release() drops to 'settling', never straight to 'safe' (with a link)", () => {
  // Armed by the previous check: markQuiet() from this exact state reaches "safe", so
  // "safe" is genuinely reachable here and release() declining to go there is a real choice.
  deviceSafety.hold();
  deviceSafety.release();
  eq(S(), "settling", "release must not answer 'safe'");
  assert(deviceSafety.unsafe, "still unsafe after every write returned");
  deviceSafety.markQuiet();
  eq(S(), "safe", "arming: safe was reachable from that state");
});

await check("markQuiet() from 'safe' is a harmless no-op", () => {
  eq(S(), "safe", "precondition");
  deviceSafety.markQuiet();
  eq(S(), "safe");
});

// ========================================================================================
// 2. Nesting. Holds are reference COUNTED, not boolean.
// ========================================================================================

await check("nested holds: one release of two does not drop the warning", () => {
  deviceSafety.hold();
  deviceSafety.hold();
  deviceSafety.release();
  eq(S(), "writing", "inner release must leave the outer hold's warning up");
  // …and a ping cannot sneak it down either while the outer hold stands.
  deviceSafety.markQuiet();
  eq(S(), "writing", "markQuiet is still refused with one hold outstanding");
  deviceSafety.release();
  eq(S(), "settling", "the LAST release is the one that drops to settling");
  deviceSafety.markQuiet();
  eq(S(), "safe");
});

await check("holds are counted, not boolean: 1×hold+1×release differs from 2×hold+1×release", () => {
  // The discriminating pair. A boolean flag would make both of these land in the same state.
  deviceSafety.hold();
  deviceSafety.release();
  const one = S();
  deviceSafety.markQuiet();
  deviceSafety.hold();
  deviceSafety.hold();
  deviceSafety.release();
  const two = S();
  eq(one, "settling", "single hold released");
  eq(two, "writing", "two holds, one released");
  assert(one !== two, "a boolean hold flag would make these identical");
  deviceSafety.release();
  deviceSafety.markQuiet();
  eq(S(), "safe", "unwound");
});

await check("three deep: only the third release lets go", () => {
  deviceSafety.hold(); deviceSafety.hold(); deviceSafety.hold();
  deviceSafety.release(); eq(S(), "writing", "after 1 of 3");
  deviceSafety.release(); eq(S(), "writing", "after 2 of 3");
  deviceSafety.release(); eq(S(), "settling", "after 3 of 3");
  deviceSafety.markQuiet();
});

await check("PINNED: an unbalanced extra release() re-arms 'settling' from 'safe'", () => {
  // Not obviously desirable, but it errs toward warning rather than toward "safe", which is
  // the correct direction for this module. Pinned so a future refactor has to choose it.
  eq(S(), "safe", "precondition");
  deviceSafety.release();
  eq(S(), "settling", "an underflowing release does not go to safe");
  deviceSafety.markQuiet();
  eq(S(), "safe", "and a ping clears it again");
});

// ========================================================================================
// 3. Link loss.
// ========================================================================================

await check("linkGone() with a hold outstanding is ignored (armed: with none, it clears)", () => {
  deviceSafety.hold();
  deviceSafety.linkGone();
  eq(S(), "writing", "a mid-flash USB blip is the expected stub-boot re-enumeration");
  deviceSafety.hold();
  deviceSafety.linkGone();
  eq(S(), "writing", "still ignored while nested");
  deviceSafety.release();
  deviceSafety.linkGone();
  eq(S(), "writing", "one hold still outstanding");
  deviceSafety.release();
  eq(S(), "settling");
  // Arming: the identical call, with the holds gone, really does reach "safe" — so the
  // three refusals above are the guard working, not linkGone() being inert.
  deviceSafety.linkGone();
  eq(S(), "safe", "no hold left: nothing to protect, stop nagging");
});

await check("linkGone() clears 'settling' without any ping", () => {
  deviceSafety.hold();
  deviceSafety.release();
  eq(S(), "settling");
  deviceSafety.linkGone();
  eq(S(), "safe", "the link is gone; there is nothing left to corrupt");
});

// ========================================================================================
// 4. The injected no-link probe. Real closure over a mutable flag — never a constant.
// ========================================================================================

let linkPresent = true; // production: `() => !device.isConnected`
let probeCalls = 0;
deviceSafety.setNoLinkProbe(() => { probeCalls++; return !linkPresent; });

await check("probe: with a live link, release() still refuses 'safe'", () => {
  linkPresent = true;
  const before = probeCalls;
  deviceSafety.hold();
  deviceSafety.release();
  assert(probeCalls > before, "release consulted the probe");
  eq(S(), "settling", "a live link must wait for an actual ping");
  deviceSafety.markQuiet();
});

await check("probe: with NO link at all, release() may go straight to 'safe'", () => {
  // The SD-only-sync case: no device attached, so no liveness ping will ever arrive and
  // "settling" would otherwise stick forever. Same code path, only the flag differs.
  linkPresent = false;
  deviceSafety.hold();
  eq(S(), "writing", "a hold still raises the warning even with no link");
  deviceSafety.release();
  eq(S(), "safe", "no link => nothing to attest");
});

await check("probe: it is only consulted on the LAST release, not a nested one", () => {
  linkPresent = false; // the permissive value — a nested release must still refuse it
  deviceSafety.hold();
  deviceSafety.hold();
  deviceSafety.release();
  eq(S(), "writing", "the inner release must not shortcut to safe via the probe");
  deviceSafety.release();
  eq(S(), "safe", "arming: the outer release, same probe value, does reach safe");
});

await check("probe: it cannot promote out of 'writing' by itself", () => {
  linkPresent = false;
  deviceSafety.hold();
  eq(S(), "writing", "hold wins over the probe");
  deviceSafety.markQuiet();
  eq(S(), "writing", "and markQuiet is still refused");
  deviceSafety.release();
  eq(S(), "safe", "arming");
  linkPresent = true; // back to the realistic default for the rest of the file
});

// ========================================================================================
// 5. installProgress.run()/confirm() — the single funnel that raises the hold in production.
// ========================================================================================

/** Drive one operation end-to-end: run() (which only ARMS the confirm step), then confirm(),
 *  then close(). `exec` is the seam. */
async function operation(exec) {
  const closed = installProgress.run({ title: "t", phases: [{ id: "p", label: "P" }], exec });
  await installProgress.confirm();
  installProgress.close();
  await closed;
}

await check("run() alone does not raise the warning — only confirm() does", async () => {
  eq(S(), "safe", "precondition");
  let seen = null;
  const closed = installProgress.run({
    title: "t", phases: [{ id: "p", label: "P" }],
    exec: async () => { seen = S(); },
  });
  eq(S(), "safe", "still at the confirm step: nothing has touched the device");
  eq(installProgress.modalPhase, "confirm");
  await installProgress.confirm();
  eq(seen, "writing", "exec ran under a hold");
  eq(S(), "settling", "…and the warning survived exec returning");
  installProgress.close();
  await closed;
  eq(S(), "settling", "closing the MODAL does not answer a DEVICE question");
  deviceSafety.markQuiet();
  eq(S(), "safe", "arming: safe was reachable from there all along");
});

await check("a THROWING exec still releases the hold (and lands in settling, not safe)", async () => {
  eq(S(), "safe", "precondition");
  let seen = null;
  await operation(async (r) => {
    r.start("p");
    seen = S();
    throw new Error("boom");
  });
  eq(seen, "writing", "held while running");
  eq(installProgress.modalPhase, "error", "the failure surfaced");
  eq(installProgress.error, "boom");
  eq(S(), "settling", "a failed write is MORE likely to have left the device mid-write");
  // Arming + proof the count did not leak: one more balanced pair still behaves.
  deviceSafety.markQuiet();
  eq(S(), "safe");
  deviceSafety.hold(); deviceSafety.release();
  eq(S(), "settling", "the hold count was not leaked by the throw");
  deviceSafety.markQuiet();
});

await check("a nested hold INSIDE exec (e.g. bootStub) does not drop the warning early", async () => {
  const seen = [];
  await operation(async () => {
    deviceSafety.hold();          // device.svelte.ts's ensureStub()
    deviceSafety.release();
    seen.push(S());               // must still be "writing": the modal's hold stands
  });
  eq(seen[0], "writing", "the inner release must not clear the install's own warning");
  eq(S(), "settling", "and the outer release lands in settling as usual");
  deviceSafety.markQuiet();
});

await check("a link drop DURING exec does not clear the warning", async () => {
  const seen = [];
  await operation(async () => {
    deviceSafety.linkGone();      // device.svelte.ts's handleLost()
    seen.push(S());
  });
  eq(seen[0], "writing", "the stub-boot re-enumeration must not read as 'safe to unplug'");
  eq(S(), "settling");
  deviceSafety.markQuiet();
});

await check("a poll ping DURING exec does not clear the warning", async () => {
  const seen = [];
  await operation(async () => { deviceSafety.markQuiet(); seen.push(S()); });
  eq(seen[0], "writing");
  eq(S(), "settling");
  deviceSafety.markQuiet();
});

await check("cancelling at the confirm step never holds", async () => {
  eq(S(), "safe", "precondition");
  let ran = false;
  const closed = installProgress.run({
    title: "t", phases: [{ id: "p", label: "P" }], exec: async () => { ran = true; },
  });
  installProgress.cancel();
  await closed;
  eq(ran, false, "exec never ran");
  eq(S(), "safe", "nothing touched the device, so nothing to warn about");
});

await check("confirm() with no prompt in flight is inert (it must not strand a hold)", async () => {
  installProgress.prompt = null;
  await installProgress.confirm();
  eq(S(), "safe", "no spurious warning");
  // The real risk is a LEAKED hold, which is invisible in `state`. Probe the counter
  // indirectly: one balanced pair must still reach settling on its single release.
  deviceSafety.hold();
  deviceSafety.release();
  eq(S(), "settling", "hold count was untouched (a leak would have kept this 'writing')");
  deviceSafety.markQuiet();
  eq(S(), "safe");
});

// ========================================================================================
// 6. The audit log is DATA (key + params), rendered at display time.
//
// The point of this representation: one logged entry must be able to render as the user's
// language on screen AND as English for a bug report. A rendered-at-log-time string cannot,
// which is why `report.log()` stores `{time, tag, entry}` instead of a formatted line.
//
// ANTI-VACUITY: the "renders English when asked" checks below all assert the OTHER table
// produces DIFFERENT text from the same entry — a renderer that ignored its table argument
// (or an entry that had baked its text at log time) fails them.
// ========================================================================================

/** Run one operation whose exec only logs, and hand back the raw entries. */
async function logged(exec) {
  const closed = installProgress.run({
    title: "t",
    phases: [{ id: "p", label: "Phase", substeps: [{ id: "s", label: "Step" }] }],
    exec,
  });
  await installProgress.confirm();
  const lines = installProgress.auditLog;
  installProgress.close();
  await closed;
  deviceSafety.markQuiet();
  return lines;
}

// A third table: a stand-in whose one key is unmistakable, so "the renderer really consulted
// the table it was handed" is asserted without depending on any particular translation.
const xx = {
  ...en,
  roms: { ...en.roms, sdSync: { ...en.roms.sdSync, logCoversScanned: (n) => `XX-${n}-XX` } },
};

await check("a keyed entry renders exactly the text the old rendered-at-log-time call produced", async () => {
  const lines = await logged(async (r) => {
    r.start("p");
    r.log("p", msg((t) => t.roms.sdSync.logCoversScanned, 3));
  });
  eq(lines.length, 1, "one line");
  eq(installProgress.logText(en)[0], `${lines[0].time} [Phase] ${en.roms.sdSync.logCoversScanned(3)}`,
    "same timestamp, same [Phase] tag, same body as before");
});

await check("the SAME entry renders in another table when asked (English stays recoverable)", async () => {
  const e = msg((t) => t.shared.installProgressModal.logLabel, 3);
  eq(renderEntry(e, en), "Log (3)", "English");
  eq(renderEntry(e, de), "Protokoll (3)", "German, from the very same entry");
  assert(renderEntry(e, en) !== renderEntry(e, de), "arming: the table argument is what decides");
  // …and via the store, on a line that was already logged (the bug-report path).
  const lines = await logged(async (r) => {
    r.start("p");
    r.log("p", msg((t) => t.roms.sdSync.logCoversScanned, 7));
  });
  eq(renderLine(lines[0], xx), `${lines[0].time} [Phase] XX-7-XX`, "re-rendered after the fact");
  eq(renderLine(lines[0], en), `${lines[0].time} [Phase] ${en.roms.sdSync.logCoversScanned(7)}`, "and in English");
});

await check("a literal (non-keyed) entry round-trips unchanged in every table", async () => {
  const lines = await logged(async (r) => {
    r.start("p");
    r.log("p", "/roms/gb/Zelda.gb"); // a path — never came from the string table
  });
  eq(lines[0].entry.kind, "literal", "stored as a literal, not a key");
  eq(renderEntry(lines[0].entry, en), "/roms/gb/Zelda.gb");
  eq(renderEntry(lines[0].entry, de), "/roms/gb/Zelda.gb");
  eq(renderEntry(lines[0].entry, xx), "/roms/gb/Zelda.gb", "no table can rewrite a filename");
});

await check("params are preserved, in order, and nested entries resolve in the DISPLAY table", async () => {
  const lines = await logged(async (r) => {
    r.start("p");
    r.log("p", msg((t) => t.roms.sdSync.logGamesScanned, 4, 2, msg((t) => t.roms.sdSync.freshTargetSuffix)));
  });
  const params = lines[0].entry.params;
  eq(params.length, 3, "three params");
  eq(params[0], 4, "first");
  eq(params[1], 2, "second — order, not just membership");
  eq(typeof params[2], "object", "third is a nested entry, still unrendered");
  eq(renderEntry(lines[0].entry, en),
    en.roms.sdSync.logGamesScanned(4, 2, en.roms.sdSync.freshTargetSuffix),
    "composes identically to a direct call");
  // Anti-vacuity for order: swapping the two counts must produce different text.
  assert(en.roms.sdSync.logGamesScanned(4, 2, "") !== en.roms.sdSync.logGamesScanned(2, 4, ""),
    "arming: the two numeric params are distinguishable in the output");
});

await check("logActive() still logs into the active phase/sub-step, and is inert when idle", async () => {
  installProgress.logActive("must not appear");
  const lines = await logged(async (r) => {
    r.start("p");
    r.subStart("p", "s");
    installProgress.logActive("Link dropped, continuing…"); // device.svelte.ts's real call shape
    r.subFinish("p", "s");
  });
  eq(lines.length, 1, "exactly the one logged while running — the idle call was a no-op");
  eq(renderLine(lines[0], en), `${lines[0].time} [Phase — Step] Link dropped, continuing…`,
    "tagged with the phase AND the sub-step that were active");
  // logActive also accepts a keyed entry now.
  const l2 = await logged(async (r) => {
    r.start("p");
    installProgress.logActive(msg((t) => t.shared.installProgressModal.logLabel, 1));
  });
  eq(renderLine(l2[0], de), `${l2[0].time} [Phase] Protokoll (1)`, "keyed, and still deferred");
});

// ========================================================================================
// 7. Copy log — the clipboard always gets ENGLISH, and a rejection is not silent.
//
// The point: a bug report pasted from a Japanese or German UI must read the same as one from
// an English UI, WITHOUT switching the user's locale to produce it. `copyLog()` therefore
// renders through `logText(en)` while the modal keeps rendering through `locale.t`.
//
// The clipboard write can be rejected by the browser for reasons the user did not cause
// (non-secure context, denied permission, unfocused document). The artboard states no error
// copy, so the chosen handling is: log the rejection to the console and fall back to the
// download path with the SAME English text — visible, wordless, and never thrown into the UI.
// ========================================================================================

// A fake clipboard, and a fake download sink (util.ts's download() reaches for URL/document).
let clipboardText = null;
let clipboardReject = null;
let downloaded = null;
globalThis.navigator = {
  clipboard: {
    writeText: async (t) => {
      if (clipboardReject) throw clipboardReject;
      clipboardText = t;
    },
  },
};
globalThis.URL.createObjectURL = (blob) => {
  downloaded = blob;
  return "blob:stub";
};
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  createElement: () => ({ click() {}, remove() {} }),
  body: { appendChild() {} },
};

/** Log one keyed line whose German differs from its English, and leave it in the store. */
async function loggedLeftOpen() {
  const closed = installProgress.run({
    title: "t",
    phases: [{ id: "p", label: "Phase", substeps: [] }],
    exec: async (r) => {
      r.start("p");
      r.log("p", msg((t) => t.shared.installProgressModal.logLabel, 5));
      r.log("p", "/roms/gb/Zelda.gb");
    },
  });
  await installProgress.confirm();
  return { closed };
}

async function finish(h) {
  installProgress.close();
  await h.closed;
  deviceSafety.markQuiet();
}

await check("copyLog() copies ENGLISH even when the active locale is not English", async () => {
  const prev = locale.current;
  locale.set("de");
  const h = await loggedLeftOpen();
  // Arming: with German active, the MODAL really is showing German — so an implementation
  // that just reused the on-screen rendering would fail the next assertion.
  eq(installProgress.logText()[0].endsWith("Protokoll (5)"), true, "on screen: German");
  clipboardText = null;
  clipboardReject = null;
  eq(await installProgress.copyLog(), "copied", "the clipboard path ran");
  assert(clipboardText.includes("Log (5)"), "clipboard: English");
  assert(!clipboardText.includes("Protokoll (5)"), "clipboard: no German anywhere");
  // …and the user's locale was NOT switched to get there.
  eq(locale.current, "de", "the active locale is untouched");
  eq(installProgress.logText()[0].endsWith("Protokoll (5)"), true, "the on-screen log is unchanged");
  await finish(h);
  locale.set(prev);
});

await check("with English active, the copied text is exactly what the modal shows", async () => {
  const prev = locale.current;
  locale.set("en");
  const h = await loggedLeftOpen();
  clipboardText = null;
  clipboardReject = null;
  await installProgress.copyLog();
  eq(clipboardText, installProgress.logText().join("\n") + "\n",
    "byte-identical to the on-screen rendering (plus the trailing newline)");
  await finish(h);
  locale.set(prev);
});

await check("a literal line is identical in the copy whichever locale is active", async () => {
  const grab = async (code) => {
    const prev = locale.current;
    locale.set(code);
    const h = await loggedLeftOpen();
    clipboardText = null;
    clipboardReject = null;
    await installProgress.copyLog();
    const out = clipboardText;
    await finish(h);
    locale.set(prev);
    return out;
  };
  const enText = await grab("en");
  const deText = await grab("de");
  const line = (txt) => txt.split("\n").find((l) => l.includes("Zelda"));
  eq(line(enText).slice(8), line(deText).slice(8), "the filename line matches (timestamps aside)");
  assert(line(enText).includes("/roms/gb/Zelda.gb"), "and it really is the path");
});

await check("a rejected clipboard write falls back to the download, with the same English text", async () => {
  const prev = locale.current;
  locale.set("de");
  const h = await loggedLeftOpen();
  clipboardText = null;
  downloaded = null;
  clipboardReject = new Error("NotAllowedError: document is not focused");
  // The rejection now goes through `dbg()` rather than `console.error`, so it reaches the
  // Activity log and a bug report rather than only the developer's devtools. `dbg()` mirrors
  // to `console.debug`, which is what this captures; the point of the assertion is unchanged
  // and stronger -- the failure is still not silent, and now it is reachable in a built app.
  const errs = [];
  const realErr = console.debug;
  console.debug = (...a) => errs.push(a);
  let threw = null;
  let result = null;
  try {
    result = await installProgress.copyLog();
  } catch (e) {
    threw = e;
  } finally {
    console.debug = realErr;
    clipboardReject = null;
  }
  eq(threw, null, "the rejection never reaches the UI as a throw");
  eq(result, "saved", "it reports the fallback it took");
  eq(clipboardText, null, "nothing reached the clipboard");
  assert(downloaded !== null, "a file was produced instead — the failure is not silent");
  eq(errs.length, 1, "and the rejection was reported through dbg(), which reaches the Activity log");
  const text = await downloaded.text();
  assert(text.includes("Log (5)"), "the downloaded fallback is the ENGLISH text");
  assert(!text.includes("Protokoll (5)"), "not the active locale's");
  await finish(h);
  locale.set(prev);
});


// ========================================================================================
// 8. Log lines are DEBUG output: a subsystem prefix, real values, and the real exception.
//
// The shape the owner asked for is `subsystem: fact` — a lowercase identifier prefix, then
// concrete values (hex for addresses, raw `B` for byte counts, the underlying exception text
// for a failure). The prefix is an IDENTIFIER, not prose, so it must be byte-identical in all
// seven locales; everything after the colon is translated.
//
// ANTI-VACUITY: each check below asserts the thing it denies is otherwise reachable — the
// prefix check proves the seven tables really do differ after the colon, the formatSize check
// proves formatSize() would have produced something different, and the exception check
// proves a different exception yields a different line.
// ========================================================================================

/** Every log-line key that carries a subsystem prefix, with arguments that exercise it. */
const PREFIXED = [
  ["device:", (t) => t.roms.install.logConnecting, []],
  ["device:", (t) => t.roms.install.logFlashUtilReady, ["0x90000000", 65536, 16777216]],
  ["device:", (t) => t.wizard.step2.logConfirmingLinkResponsive, [true, 43]],
  ["device:", (t) => t.wizard.common.rescanningDeviceGeometry, []],
  ["flash:", (t) => t.wizard.restore.logRestoring, ["mario", 131072, 1048576]],
  ["flash:", (t) => t.eraseSection.erasingLog, ["frogfs", "262144", "0x90000000"]],
  ["frogfs:", (t) => t.roms.install.logImageReady, [239364, "0x0"]],
  ["frogfs:", (t) => t.roms.install.logBuildingImage, [214]],
  ["littlefs:", (t) => t.wizard.step2.logCoresSavesBuilt, []],
  ["bundle:", (t) => t.wizard.step2.logBundleDownloaded, ["v1.4.1", 13123584, 4100]],
  ["covers:", (t) => t.roms.sdSync.logCoversScanned, [3]],
  ["cheats:", (t) => t.roms.sdSync.logCheatsScanned, [3]],
  ["saves:", (t) => t.wizard.step2.logCouldNotExtractSavesSettings, ["boom"]],
  ["gamestate:", (t) => t.wizard.step2.logReadPreviousGameState, ["0x90000000", 4096]],
  ["superblock:", (t) => t.wizard.step2.logSuperblockPatched, []],
  ["cores:", (t) => t.roms.sdSync.logCoresSkipped, []],
  ["budget:", (t) => t.roms.install.logBudgetFits, [61200000, "62914560"]],
  ["backup:", (t) => t.wizard.step1.logSavingBackup, []],
  ["patch:", (t) => t.officialFirmware.logPatchingModel, ["mario", 131072, 1048576]],
  ["migrate:", (t) => t.romSection.logSameVersionRepair, ["v1.4.1"]],
  ["sd:", (t) => t.roms.sdSync.logRemoved, ["/roms/gb/Zelda.gb"]],
  ["sdcache:", (t) => t.wizard.step2.logSdCacheBoundarySet, [1048576]],
];

await check("every log line opens with its subsystem prefix, byte-identical in all 7 locales", () => {
  let differed = 0;
  for (const [prefix, pick, params] of PREFIXED) {
    const rendered = {};
    for (const [code, table] of Object.entries(TABLES)) {
      const text = renderEntry(msg(pick, ...params), table);
      assert(text.startsWith(prefix), `${code}: ${JSON.stringify(text)} does not start with ${prefix}`);
      // The prefix is an identifier: lowercase, no spaces, exactly one colon at the front.
      assert(!/[A-Z]/.test(prefix), `${prefix} must be lowercase`);
      rendered[code] = text;
    }
    // Arming: at least SOME of these really are translated after the colon, so a table that
    // silently fell back to English everywhere could not pass the count assertion below.
    if (new Set(Object.values(rendered)).size > 1) differed++;
  }
  assert(differed >= PREFIXED.length - 4,
    `only ${differed}/${PREFIXED.length} keys differ across locales — the six siblings look like English copies`);
});

await check("an error line carries the underlying exception text, not a bare '(continuing)'", async () => {
  const boom = new RangeError("LIBUSB_ERROR_TIMEOUT");
  const lines = await logged(async (r) => {
    r.start("p");
    r.log("p", msg((t) => t.wizard.step2.logCouldNotReadPreviousGameState, "0x90000000", 4096, errText(boom)));
    r.log("p", msg((t) => t.wizard.step2.logCouldNotExtractSavesSettings, errText(boom)));
  });
  for (const table of [en, de, es, fr, ja, ko, pl]) {
    for (const l of lines) {
      const text = renderEntry(l.entry, table);
      assert(text.includes("LIBUSB_ERROR_TIMEOUT"), `missing exception message: ${text}`);
      assert(text.includes("RangeError"), `missing exception name/code: ${text}`);
    }
  }
  // The offset is hex and the window is a raw byte count, both present in every locale.
  for (const table of Object.values(TABLES)) {
    const text = renderEntry(lines[0].entry, table);
    assert(text.includes("0x90000000"), `missing hex address: ${text}`);
    assert(/\b4096 B\b/.test(text), `missing raw byte window: ${text}`);
  }
  // Arming: a DIFFERENT exception produces a different line — the message is really carried
  // through rather than being fixed prose that happens to contain the words.
  const other = renderEntry(msg((t) => t.wizard.step2.logCouldNotExtractSavesSettings, errText(new Error("nope"))), en);
  assert(other !== renderEntry(lines[1].entry, en), "arming: the exception text is what varies");
});

await check("byte counts in log lines are raw `B`, never run through formatSize()", () => {
  const RAW = [
    [(t) => t.roms.install.logImageReady, [239364, "0x0"], 239364],
    [(t) => t.wizard.step2.logBundleDownloaded, ["v1.4.1", 13123584, 4100], 13123584],
    [(t) => t.wizard.step2.logExtractedSavesSettings, [61, 2202009], 2202009],
    [(t) => t.roms.sdSync.logWritingCores, [12, 8388608], 8388608],
    [(t) => t.romSection.logFlashUtilReady, [16777216, 65536], 16777216],
  ];
  for (const [pick, params, bytes] of RAW) {
    // Arming: formatSize() really would have rendered this number differently.
    assert(formatSize(bytes) !== String(bytes), `arming: formatSize(${bytes}) is not distinct`);
    for (const [code, table] of Object.entries(TABLES)) {
      const text = renderEntry(msg(pick, ...params), table);
      assert(text.includes(`${bytes} B`), `${code}: ${text} lacks the raw "${bytes} B"`);
      assert(!text.includes(formatSize(bytes)), `${code}: ${text} leaked a formatSize() string`);
      assert(!/\d\s?(KB|MB|GB|KiB|MiB|GiB)\b/.test(text), `${code}: ${text} used a formatted size unit`);
    }
  }
});

await check("the English copy still matches the English table after the rewrite", async () => {
  const prev = locale.current;
  locale.set("ja");
  const closed = installProgress.run({
    title: "t",
    phases: [{ id: "p", label: "Phase", substeps: [] }],
    exec: async (r) => {
      r.start("p");
      r.log("p", msg((t) => t.roms.install.logImageReady, 239364, "0x0"));
      r.log("p", msg((t) => t.roms.sdSync.logCoversScanned, 3));
    },
  });
  await installProgress.confirm();
  // Arming: Japanese really is on screen, so a copy that reused the rendering would fail.
  assert(installProgress.logText()[0].endsWith(ja.roms.install.logImageReady(239364, "0x0")), "on screen: Japanese");
  assert(ja.roms.install.logImageReady(239364, "0x0") !== en.roms.install.logImageReady(239364, "0x0"),
    "arming: the two tables differ for this key");
  clipboardText = null;
  clipboardReject = null;
  await installProgress.copyLog();
  const copied = clipboardText.trimEnd().split("\n");
  const body = (l) => l.slice(l.indexOf("[Phase] "));
  eq(body(copied[0]), `[Phase] ${en.roms.install.logImageReady(239364, "0x0")}`, "line 1 is the English table's text");
  eq(body(copied[1]), `[Phase] ${en.roms.sdSync.logCoversScanned(3)}`, "line 2 too");
  installProgress.close();
  await closed;
  deviceSafety.markQuiet();
  locale.set(prev);
});

// --- Report -----------------------------------------------------------------------------
if (failures.length) {
  console.error(`safety: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`safety: ${passed} checks passed`);
