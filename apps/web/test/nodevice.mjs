#!/usr/bin/env node
/**
 * The Overview tab with no device attached, and the canvas having no two boards on top of
 * each other.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/nodevice.mjs'
 *
 * WHY THIS EXISTS. `OverviewTab.svelte` is the default tab of "Manage Device", so its
 * disconnected state is the first thing a great many people see, and for a while it was one
 * grey line -- "Waiting for a device connection..." -- shown forever and identically to three
 * different situations. The beginner audit ranked that second by how many people it stops.
 *
 * The distinction the guard defends is that a browser with no WebUSB is NOT waiting. No
 * adapter, no patience and no amount of plugging in will ever produce a device there, so
 * telling that user to wait is false, and offering them Connect is worse -- an action that
 * cannot succeed. Those two cases must never collapse back into one message.
 *
 * These are source-shape assertions. The behaviour lives in a `.svelte` component and every
 * suite in this repo stubs runes as identity functions, so a rendered DOM is not reachable
 * here; if the markup is restructured these must be re-read rather than trusted.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tab = readFileSync(join(here, "../src/lib/views/OverviewTab.svelte"), "utf8");
const rail = readFileSync(join(here, "../src/lib/views/OverviewRail.svelte"), "utf8");
const strings = join(here, "../src/lib/i18n/strings");
// Every locale on disk, derived once for every suite -- see test/locales.mjs.
import { LOCALES } from "./locales.mjs";

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message || e}`);
  }
};
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const eq = (got, want, msg) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg}: got ${g}, want ${w}`);
};

/**
 * The disconnected markup, which is now a `{#snippet disconnected()}` handed to `OverviewRail`
 * rather than an `{#if !device.isConnected}` branch wrapping the whole tab. That restructure is
 * the rail landing (docs/design/proposals/overview-v2): the rail is drawn with or without a
 * device, and only Status swaps to this snippet. The three states inside it are unchanged and
 * are still what this file exists to defend.
 */
const snipIdx = tab.indexOf("{#snippet disconnected()}");
ok(
  snipIdx >= 0,
  "OverviewTab no longer defines a `disconnected` snippet -- fix this guard",
);
const snipEnd = tab.indexOf("{/snippet}", snipIdx);
ok(snipEnd > snipIdx, "the `disconnected` snippet is unterminated -- fix this guard");
const noDeviceMarkup = tab.slice(snipIdx, snipEnd);

// ---------------------------------------------------------------------------------------
// 1. The state is actionable, not just a wait line.
// ---------------------------------------------------------------------------------------

check("the no-device state says what is needed, not only that it is waiting", () => {
  ok(
    /overview\.noDevice\.title/.test(noDeviceMarkup),
    "no `overview.noDevice.title` -- the state is back to a bare wait line",
  );
  ok(
    /overview\.noDevice\.body/.test(noDeviceMarkup),
    "no `overview.noDevice.body` -- nothing names the adapter the device physically needs",
  );
});

check("and offers Connect, so it is a next step rather than a dead end", () => {
  ok(
    /device\.connect\(\)/.test(noDeviceMarkup),
    "the disconnected state offers no connect action",
  );
  ok(
    /shared\.common\.connect/.test(noDeviceMarkup),
    "the connect action does not use the shipped `shared.common.connect` label",
  );
});

// ---------------------------------------------------------------------------------------
// 2. An unsupported browser is a different problem and gets a different answer.
// ---------------------------------------------------------------------------------------

check("a browser with no WebUSB is detected at all", () => {
  ok(
    /navigator\s*!==\s*"undefined"\s*&&\s*!!navigator\.usb/.test(tab),
    "OverviewTab does not test `navigator.usb`, so it cannot tell the two cases apart",
  );
});

check("an unsupported browser is told so, in its own words", () => {
  ok(
    /overview\.noDevice\.browserTitle/.test(noDeviceMarkup) &&
      /overview\.noDevice\.browserBody/.test(noDeviceMarkup),
    "no browser-specific copy -- an unsupported browser shares the plug-it-in message",
  );
});

check("THE DISTINCTION: waiting and cannot-ever are not the same message", () => {
  const en = readFileSync(join(strings, "overview.ts"), "utf8");
  const grab = (k) => {
    const m = en.match(new RegExp(`${k}:\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    ok(m, `overview.ts has no ${k}`);
    return m[1];
  };
  const waiting = grab("waitingForConnection");
  ok(
    grab("browserTitle") !== waiting && grab("browserBody") !== waiting,
    "the unsupported-browser copy reuses the wait line, which is false there",
  );
  ok(
    grab("title") !== grab("browserTitle"),
    "the two disconnected states share one title",
  );
});

check("and an unsupported browser is NOT offered an action that cannot succeed", () => {
  // The browser branch runs from its own `{#if !webusbSupported}` to the first `{:else`.
  const bIdx = noDeviceMarkup.indexOf("{#if !webusbSupported}");
  ok(bIdx >= 0, "no `{#if !webusbSupported}` branch");
  const rest = noDeviceMarkup.slice(bIdx);
  const branch = rest.slice(0, rest.indexOf("{:else"));
  ok(branch.length > 0, "the browser branch has no {:else} after it -- fix this guard");
  ok(
    !/device\.connect\(\)/.test(branch),
    "the unsupported-browser branch offers Connect, which can never work there",
  );
});

// ---------------------------------------------------------------------------------------
// 3. Activity still works with no device.
// ---------------------------------------------------------------------------------------

check("Activity stays reachable with no device", () => {
  // The pane moved into the rail, so the invariant now spans two files: the rail must render
  // ActivityPane, and OverviewTab must render the rail OUTSIDE any `device.isConnected` branch.
  // `StatusNoDevice.dc.html` states the requirement outright ("Activity stays live in the
  // rail"), and the reason outlives the board: the audit log fills up from Sources and the
  // Library with no device attached, so gating the rail on a connection would hide the whole
  // session record from exactly the people most likely to want it.
  ok(/<ActivityPane\b/.test(rail), "OverviewRail no longer renders ActivityPane");
  ok(
    /<OverviewRail\b/.test(tab),
    "OverviewTab no longer renders OverviewRail -- fix this guard",
  );
  const railIdx = tab.indexOf("<OverviewRail");
  const gate = tab.lastIndexOf("{#if device.isConnected}", railIdx);
  ok(
    gate === -1,
    "OverviewRail moved inside a device-connected branch, so Activity vanishes with no device",
  );
});

check("the rail offers Activity as an item, not a hidden pane", () => {
  ok(
    /items:\s*\["activity", "log"\]/.test(rail),
    "the LOGS group no longer lists activity -- it is unreachable from the rail",
  );
});

// ---------------------------------------------------------------------------------------
// 4. Seven locales, none of them English-by-copy-paste.
// ---------------------------------------------------------------------------------------

/** The `noDevice: { ... }` object literal out of one string table, brace-matched. */
function noDeviceBlock(file) {
  const src = readFileSync(join(strings, file), "utf8");
  const at = src.indexOf("noDevice: {");
  ok(at >= 0, `${file} declares no noDevice block`);
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`${file}: unbalanced noDevice block`);
}

/** `{ key: "value" }` pairs from one such block, comments stripped. */
function valuesIn(block) {
  const out = {};
  for (const raw of block.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "");
    const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*$/);
    const inline = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (inline) out[inline[1]] = inline[2];
    else if (m) out[m[1]] = null; // value wrapped to the next line; filled below
  }
  // Values that prettier wrapped onto their own line.
  for (const m of block.matchAll(/([A-Za-z_$][\w$]*):\s*\n\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

const enValues = valuesIn(noDeviceBlock("overview.ts"));

check("all four keys exist in English", () => {
  eq(Object.keys(enValues).sort(), ["body", "browserBody", "browserTitle", "title"], "English keys");
});

for (const loc of LOCALES) {
  check(`${loc} is translated, not the English string pasted through`, () => {
    const v = valuesIn(noDeviceBlock(`overview.${loc}.ts`));
    eq(Object.keys(v).sort(), Object.keys(enValues).sort(), `${loc} keys`);
    for (const [k, text] of Object.entries(v)) {
      ok(typeof text === "string" && text.length > 0, `${loc}.${k} is empty`);
      ok(text !== enValues[k], `${loc}.${k} is the English string verbatim: ${JSON.stringify(text)}`);
    }
  });
}

check("no locale's no-device copy carries a middot or an em dash", () => {
  for (const f of ["overview.ts", ...LOCALES.map((l) => `overview.${l}.ts`)]) {
    const block = noDeviceBlock(f);
    ok(!block.includes("·"), `${f} uses a middot`);
    ok(!block.includes("—"), `${f} uses an em dash`);
  }
});

// ---------------------------------------------------------------------------------------
// 5. The canvas has no two boards on top of each other.
// ---------------------------------------------------------------------------------------

check("no two artboards share a position, or overlap at all", () => {
  const canvas = JSON.parse(
    readFileSync(join(here, "../../../docs/design/mockups/canvas.json"), "utf8"),
  );
  const a = canvas.artboards;
  ok(Array.isArray(a) && a.length > 50, `only ${a?.length} artboards -- fix this guard`);
  const clashes = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const p = a[i];
      const q = a[j];
      if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) {
        clashes.push(`${p.file} and ${q.file} at (${p.x}, ${p.y})`);
      }
    }
  }
  eq(clashes, [], "boards drawn on top of one another");
});

if (failures.length) {
  console.error(`no-device overview: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  x " + f);
  process.exit(1);
}
console.log(`no-device overview: ${passed} checks passed`);
