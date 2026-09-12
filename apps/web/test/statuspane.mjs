#!/usr/bin/env node
/**
 * The Overview Status pane.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/statuspane.mjs'
 *
 * WHY THIS EXISTS. `Status.dc.html` is the one board in the overview-v2 proposal that came
 * back approved outright, and every rule it won is a rule the page had already broken once:
 * a value that restates its label as a verb ("Taken"), a needs-attention state that rebuilds
 * the page instead of recolouring a row, a second copy of a fact that is already on screen.
 * Those are the things asserted here.
 *
 * The layout decision is exercised for real, against bank shapes, because it is a decision.
 * The rest are source-shape assertions: the pane is a `.svelte` file and every suite in this
 * repo stubs runes as identity functions, so a rendered DOM is not reachable here. If the
 * markup is restructured these must be re-read rather than trusted.
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gnwResolveFor } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const pane = read("../src/lib/ui/StatusPane.svelte");
const tab = read("../src/lib/views/OverviewTab.svelte");
// The rail landing (docs/design/proposals/overview-v2) moved three of this suite's subjects out
// of OverviewTab: StatusPane and ActivityPane are mounted by the rail, and the external-flash
// figures moved into the Details pane. Section 5 below reads them where they now live. Nothing
// about WHAT it asserts changed -- only which file is asked.
const rail = read("../src/lib/views/OverviewRail.svelte");
const details = read("../src/lib/ui/DetailsPane.svelte");
const tokens = read("../src/styles/tokens.css");
// The pane with its comments removed. Assertions about what the CODE does read this: a comment
// explaining why a rule is ABSENT otherwise reads as the rule being present, which is how a
// check in this repo has quietly vouched for the very thing it was hunting.
const paneCode = pane.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
// Every locale on disk, derived once for every suite -- see test/locales.mjs.
import { LOCALES } from "./locales.mjs";

let checks = 0;
const failures = [];
const ok = (cond, label) => {
  checks++;
  if (!cond) failures.push(label);
};
const eq = (got, want, label) => ok(got === want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- 1. The layout row, from real bank shapes -------------------------------------------------
const out = mkdtempSync(join(tmpdir(), "statuspane-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/ui/statusLayout.ts")],
  outfile: join(out, "statusLayout.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url)],
});
const { bankLayout } = await import(pathToFileURL(join(out, "statusLayout.js")).href);

// Shapes as `engine/intflashscan.ts` produces them: `ofw` set only when official firmware was
// recognised, `retroGoVersion` only when the Retro-Go signature was found.
const stockBank = { index: 1, base: 0x08000000, dataSize: 131072, type: "Mario OFW (patched)", ofw: { model: "mario", patched: true } };
const rgBank = { index: 2, base: 0x08100000, dataSize: 900000, type: "Retro-Go", retroGoVersion: "v1.4.1-44-g5dc98285" };
const emptyBank = { index: 2, base: 0x08100000, dataSize: 0, type: "empty" };
const junkBank = { index: 1, base: 0x08000000, dataSize: 4096, type: "unknown app" };

eq(bankLayout([stockBank, rgBank]), "dual", "stock + retro-go is dual boot");
eq(bankLayout([rgBank]), "retrogo", "retro-go alone");
eq(bankLayout([emptyBank, rgBank]), "retrogo", "retro-go beside an empty bank");
eq(bankLayout([stockBank, emptyBank]), "stock", "stock alone");
eq(bankLayout([junkBank, emptyBank]), "other", "an app we do not recognise is not a claim");
eq(bankLayout([]), "other", "nothing scanned yet");
// A stock bank whose OFW is UNPATCHED is still stock; `type` text must not be what decides.
eq(bankLayout([{ ...stockBank, type: "Zelda OFW (stock)", ofw: { model: "zelda", patched: false } }]), "stock",
  "stock is decided by `ofw`, not by the display string");

// --- 2. Needs attention is the same rows, not a different page --------------------------------
const rowCount = (pane.match(/<div class="row"|<div class="row row-last"/g) || []).length;
// SIX rows, drawn once: Debug probe, Read protection, Firmware backup, Storage, Layout,
// Installed firmware. A second table (an "attention" variant) would push this past six.
//
// Layout joined them rather than standing above the table as its own label and value: the pane
// read "Status / Status / Layout / Dual boot / <table>", two headings deep before any content.
// It is a fact about the device like every other row here, so it reads as one.
const mainTable = pane.slice(pane.indexOf('<dl class="rows">'), pane.indexOf("</dl>"));
eq((mainTable.match(/<div class="row/g) || []).length, 6, "the status table is exactly six rows");
// And it is not ALSO drawn above the table, which would be the old shape kept by accident.
eq(/class="layout-(label|value)"/.test(pane), false, "the standalone Layout label and value are gone");
// Directly above Installed firmware, which is where the owner asked for it.
const layoutAt = mainTable.indexOf("s.layoutLabel");
const firmwareAt = mainTable.indexOf("s.installedFirmware");
eq(layoutAt > 0 && firmwareAt > layoutAt, true, "Layout sits immediately above Installed firmware");
ok(rowCount >= 5, "rows are drawn, not generated from a branch this guard cannot see");
ok(!/\{#if\s+attention[^}]*\}\s*<dl/.test(pane), "no alternate table behind the attention count");
// The count under the title is the number of rows wearing an amber dot. Both amber conditions
// must feed it, or a device with no backup reads "everything is fine" while its own row is amber.
const attnExpr = (pane.match(/const attention = \$derived\(([^;]*)\);/) || [])[1] || "";
// The count and the amber dot must agree. `backupWants` is what both read; it has to reach the
// missing case, or a row wearing amber sits under a headline saying nothing needs attention --
// the exact defect this suite caught once before.
ok(/backupWants/.test(attnExpr), "the attention count includes the backup row's wants");
const wantsExpr = (pane.match(/const backupWants = \$derived\(([^;]*)\);/) || [])[1] || "";
ok(/backupMissing/.test(wantsExpr), "backupWants covers a folder with no backup");
ok(/backupMismatch/.test(wantsExpr), "backupWants covers a folder whose backups are for the other console");
ok(/sdMissing/.test(attnExpr), "the attention count includes the no-card row");
// The action lives INSIDE the backup row, not in a promoted panel above the table.
const backupRow = mainTable.slice(mainTable.indexOf("firmwareBackup"));
ok(backupRow.includes("row-action") && backupRow.includes("backUpNow"),
  "`Back up now` is an in-row action on the backup row");
ok(!pane.includes("openSdCard") && !/Open SD card/i.test(pane),
  "the promoted `Open SD card` panel the review deleted has not come back");

// --- 3. The backup row names the CONSOLES covered, or None -- never a verb, never a date -------
// The owner's instruction: "the status for 'Firmware backup' should just show Zelda and/or Mario
// with green checkmarks when found not a date (closer model to the actual handling on the
// firmware tab)". A date answers "when did someone do something"; the question this row is asked
// is whether the console in your hands can be put back, which is what the Firmware tab already
// decides with `offerBackup`.
ok(!/Intl\.DateTimeFormat/.test(pane), "the backup row prints no date -- the value is which consoles are covered");
ok(/modelLabel/.test(pane), "the covered consoles are named with the shared model label");
ok(/backupNone/.test(pane), "an absent backup prints the `None` value");
const en = read("../src/lib/i18n/strings/overview.ts");
const statusBlockOf = (src) => {
  const i = src.indexOf("  status: {");
  return src.slice(i, src.indexOf("\n  },", i));
};
const enStatus = statusBlockOf(en);
ok(enStatus.length > 0, "the English status block exists");
// The exact word the review rejected, and the whole class it stands for: a value column that
// answers "what was done to it" instead of "what it is".
for (const verb of ["Taken", "taken", "Done", "Yes", "Completed"]) {
  ok(!new RegExp(`:\\s*"${verb}"`).test(enStatus), `no status value reads "${verb}"`);
}
// `device.svelte.ts`'s own record is untouched by this row's change: `Wizard.svelte` still needs
// `backupTaken` latched (its comment says why), and a legacy `true` must still load.
const store = read("../src/lib/device.svelte.ts");
ok(/typeof rec === "number"/.test(store), "a legacy boolean backup record still loads as taken");

// --- 4. No new width or scroll rules ----------------------------------------------------------
// `--maxw` is the GLOBAL page cap (CLAUDE.md); a pane that redefines it silently resizes every
// other tab. And `overflow: hidden` on a pane turns the page from scrollable into clipped with
// no scrollbar, which no other gate in this repo detects.
ok(!/--maxw/.test(paneCode), "the pane does not touch the global page-width cap");
ok(!/overflow:\s*hidden/.test(paneCode), "the pane does not clip");
ok(/--maxw: 1360px/.test(tokens), "the global page cap is unchanged");
// z-index comes from the scale or not at all (test/zlayers.mjs owns the scale itself).
ok(!/z-index/.test(paneCode), "the pane introduces no z-index");
// Copy rules: no interpunct separators, no em-dashes in pane copy.
ok(!/·/.test(pane) && !/·/.test(enStatus), "no interpunct separators");

// --- 5. The rest of the tab is not disturbed --------------------------------------------------
ok(rail.includes("<StatusPane />"), "the pane is mounted");
ok(!tab.includes("device-sect"), "the old Device card is gone, not left beside it");
// Details lists Read protection as a recorded VALUE while Status carries it as a precondition
// with a dot; they are different jobs on different panes and only one pane is mounted at a
// time, so this only forbids the tab itself drawing it a second time.
eq((tab.match(/overview\.info\.readProtection/g) || []).length, 0, "Read protection is not drawn twice on one page");
ok(pane.includes("overview.info.readProtection"), "Read protection moved into the pane");
// The extflash chip size was the Device card's other real fact. It must still be on the page.
ok(/formatSize\(extBytes\)/.test(details), "the external-flash size survived the card's removal");
// The screen dock is untouched: capture still lives in the screenshot column, not in here.
ok(tab.includes("triggerScreenshot") && !pane.includes("Screenshot"), "the screen dock is untouched");
// The three-way no-device branch and the Activity accordion are other suites' subjects; assert
// only that they are still present, so a restructure here cannot silently delete them.
ok(tab.includes("noDevice.browserTitle"), "the no-device branch is intact");
ok(rail.includes("<ActivityPane"), "the Activity section is intact");

// --- 6. Every new string is translated ---------------------------------------------------------
const enValues = [...enStatus.matchAll(/^\s{4}(\w+): "([^"]*)",$/gm)].map(([, k, v]) => [k, v]);
ok(enValues.length >= 15, "the English status block has its keys");
// Values that are the SAME word in every language on purpose. Everything else being identical
// to English means the file was filled with English to silence the compiler.
const BRAND = new Set(["title"]);
for (const code of LOCALES) {
  const blk = statusBlockOf(read(`../src/lib/i18n/strings/overview.${code}.ts`));
  ok(blk.length > 0, `${code}: has a status block`);
  const map = new Map([...blk.matchAll(/^\s{4}(\w+): "([^"]*)",$/gm)].map(([, k, v]) => [k, v]));
  for (const [k, v] of enValues) {
    ok(map.has(k), `${code}: has key ${k}`);
    if (!BRAND.has(k)) ok(map.get(k) !== v, `${code}: ${k} is not the English string`);
  }
  ok(/needAttention: \(n: number\)/.test(blk), `${code}: the attention count is a real plural function`);
}

// --- 7. The backup row reads the FOLDER, not a local flag --------------------------------------
// This is the defect the owner reported: "the new Status page's Firmware backup field doesn't
// mirror the real backup folder check". The row derived from `device.backupTaken`, a per-unit
// localStorage boolean, so a user holding a good backup folder was told None and a user who had
// deleted their files was still told they were covered. Automatic unlock gates on a backup
// existing, which makes the optimistic direction a real hazard rather than a cosmetic one.
//
// NOTE FOR A LATER READER: every one of section 3's checks above passed while the row was still
// wired to the flag, because they only ever asked whether `backupNone` was mentioned. Assertions
// about which SOURCE a value comes from are the ones that bite here.
ok(/backupPresence/.test(pane), "the backup row consults the backup-folder store");
// Comments are stripped first: the pane's own comment EXPLAINS which source was wrong and why,
// which is the note a future reader needs. What must not survive is a real read of the flag.
ok(/backupPresence/.test(paneCode), "precondition: stripping comments left the pane's code intact");
ok(!/device\.backupTaken/.test(paneCode) && !/device\.backupAt/.test(paneCode),
  "the backup row no longer reads the per-unit local flag");
const bvExpr = (pane.match(/const backupValue = \$derived\.by\(\(\) => \{([\s\S]*?)\n  \}\);/) || [])[1] || "";
ok(!/backupAt/.test(bvExpr) && !/backup\.at/.test(bvExpr),
  "no timestamp reaches the value, from the flag or from the file");

// `disconnected` is not `none`. Same amber treatment, different sentence, different action:
// "we have not looked" and "you have no backup" are different facts and only one of them is
// fixed by taking a backup.
ok(/backupNotConnected/.test(pane), "a folder we cannot see has its own value");
ok(/connectFolder/.test(pane), "a folder we cannot see offers to connect one");
const rowMarkup = pane.slice(pane.indexOf("firmwareBackup"), pane.indexOf("</dd>", pane.indexOf("firmwareBackup")));
ok(/backup\.kind === "none"[\s\S]*backUpNow/.test(rowMarkup),
  "`Back up now` is the action for a folder that HAS no backup");
ok(/backup\.kind === "disconnected"[\s\S]*connectFolder/.test(rowMarkup),
  "`Connect folder` is the action for a folder we cannot see");
// Both states that want something must reach `backupMissing`, which is what feeds the amber dot
// and (via the existing check in section 2) the "N need attention" count.
const missingExpr = (pane.match(/const backupMissing = \$derived\(([^;]*)\);/) || [])[1] || "";
ok(/"none"/.test(missingExpr), "backupMissing covers a folder with no backup");
ok(/"disconnected"/.test(missingExpr), "backupMissing covers a folder we cannot see");
// --- 7a. Which consoles are covered, and the cross-model warning ------------------------------
// "yes, show both on the same line. yeah, that's worth a tasteful yellow warning sign." -- the
// owner, asked what happens when both backups exist and when the only one is for the console you
// are NOT holding.
const presentBranch = pane.slice(pane.indexOf('{#if backup.kind === "present"}'), pane.indexOf("{:else}", pane.indexOf('{#if backup.kind === "present"}')));
ok(presentBranch.length > 0, "precondition: the present branch was found");
// The list is iterated WHOLE. Anchored on purpose: a bare /#each backupHits/ also matches
// `backupHits.slice(0, 1)`, which draws one model and passes a check that reads as covering this.
ok(/#each\s+backupHits\s+as\b/.test(presentBranch), "every model found is drawn, not just the newest");
// One line: the chips share a single flex container rather than each becoming a row.
ok(/class="models"/.test(presentBranch), "the models sit together on one line");
ok(/display:\s*flex/.test(pane.slice(pane.indexOf(".models {"))), "that container is a single flex line");
// Green tick vs caution mark, driven by the mismatch and nothing else.
ok(/class:ok=\{!backupMismatch\}/.test(presentBranch), "a covered console gets the success ink");
ok(/class:warn=\{backupMismatch\}/.test(presentBranch), "an uncovered one gets the caution ink");
ok(/backupMismatch \? "⚠" : "✓"/.test(presentBranch), "the glyph follows the same fact as the ink");
// The rule itself: covered means a backup for THIS hardware, which is the Firmware tab's rule.
const coveredExpr = (pane.match(/const backupCovered = \$derived\(([\s\S]*?)\n  \);/) || [])[1] || "";
ok(/device\.model/.test(coveredExpr), "coverage is judged against the connected hardware");
ok(/h\.model === device\.model/.test(coveredExpr), "a backup counts only when it is for this console");
ok(/"unknown"/.test(coveredExpr), "with no device scanned, coverage is not asserted either way");
const mismatchExpr = (pane.match(/const backupMismatch = \$derived\(([^;]*)\);/) || [])[1] || "";
ok(/!backupCovered/.test(mismatchExpr), "the mismatch is the uncovered case, not a second rule");
// The same rule the Firmware tab runs, so the two surfaces cannot disagree about who is covered.
const ofw = read("../src/lib/advanced/OfficialFirmwareSection.svelte");
ok(/f\.model === device\.model/.test(ofw), "precondition: the Firmware tab still judges coverage per model");
// A folder full of the wrong console's backups still needs a backup taken. Read the ACTION'S
// OWN CONDITION, not the row: the row also mentions `backupMismatch` in the chips' class
// bindings, so a `mismatch ... backUpNow` search over it is bridged by markup that has nothing
// to do with the action and passes even when the action is gone.
const backUpCondition = (pane.match(/\{#if \(([^)]*)\) && canBackUp\}/) || [])[1] || "";
ok(/backupMismatch/.test(backUpCondition),
  "`Back up now` is offered when every backup is for the other console");
// The glyph is not the only carrier of the fact.
ok(/backupNotThisDevice/.test(pane), "the caution mark has an accessible name");
for (const loc of ["", ...LOCALES]) {
  const f = loc ? `../src/lib/i18n/strings/overview.${loc}.ts` : "../src/lib/i18n/strings/overview.ts";
  ok(/backupNotThisDevice:/.test(read(f)), `${loc || "en"} carries the caution mark's name`);
}

// --- 7b. A locked device is not offered a backup it cannot take ------------------------------
// Found while auditing beginner-audit F3. RDP 1 makes internal flash unreadable over SWD, so
// `OfficialFirmwareSection` disables its own `Back up now` on `device.locked === true` and
// `doBackup` throws `errDeviceLocked` before starting. Sending someone there from this row put
// them on a disabled control -- the unsupported-browser-card defect in a second place.
//
// Unlocking is NOT the escape and must not be offered as one: clearing RDP mass-erases both
// flashes, so on a device with no backup it is the one action that guarantees the original can
// never be saved. `engine/unlockGate.ts` is the record of that ordering.
const lockGuard = (pane.match(/const canBackUp = \$derived\(([^;]*)\);/) || [])[1] || "";
ok(/device\.locked/.test(lockGuard), "the backup action is gated on the device's lock state");
ok(/!==\s*true/.test(lockGuard),
  "an unscanned device (`locked === null`) is not treated as locked");
// The condition that draws `Back up now` -- whatever states reach it, `canBackUp` must gate it,
// or a locked device is routed to a control that is disabled when it arrives.
const backUpCond = (pane.match(/\{#if \(([^)]*)\) && canBackUp\}/) || [])[1];
ok(backUpCond !== undefined, "`Back up now` is withheld from a locked device");
ok(/backup\.kind === "none"/.test(backUpCond || ""), "a folder with no backup offers it");
const disconnectedBranch = (pane.match(/\{:else if backup\.kind === "disconnected"([^}]*)\}/) || [])[1] || "";
ok(!/canBackUp/.test(disconnectedBranch),
  "`Connect folder` is NOT withheld: picking a folder is a filesystem action, not a device one");
// The row must not grow an unlock affordance. Offering it here would point a user with no
// backup at the single action that makes a backup impossible forever.
const backupRowMarkup = pane.slice(pane.indexOf("firmwareBackup"), pane.indexOf("</dd>", pane.indexOf("firmwareBackup")));
ok(!/unlock/i.test(backupRowMarkup), "the backup row offers no unlock action");

// The mount look-up must be UNTRACKED. `refresh()` touches the store's own state synchronously
// before its first `await`, so a tracked effect would depend on what the call sets and re-run
// itself forever. Nothing else in this repo can catch that: every suite stubs runes as identity
// functions, so a rendered, reactive pane is not reachable from node.
const mountEffect = (pane.match(/\$effect\(\(\) => \{\s*untrack\([\s\S]*?\n  \}\);/) || [])[0] || "";
ok(/backupPresence\.refresh/.test(mountEffect), "the mount look-up is wrapped in untrack()");
ok(/import \{ untrack \} from "svelte"/.test(pane), "untrack is imported, not assumed global");

// Rescan has to rescan THIS row too, or the button's own label is untrue.
const footMarkup = pane.slice(pane.indexOf('class="foot"'));
ok(/backupPresence\.refresh/.test(footMarkup), "Rescan re-reads the backup folder as well as the device");

// --- 8. The store, executed --------------------------------------------------------------------
// Behaviour, not source shape: the states are the whole point and a regex cannot tell
// "disconnected" from "none".
const bpOut = mkdtempSync(join(tmpdir(), "backuppresence-"));
const bpFakes = {
  "persist.js":
    "export const loadDir = async (k) => globalThis.__bp.loadDir(k);\n" +
    "export const saveDir = async (k, h) => globalThis.__bp.saveDir(k, h);\n" +
    "export const handlePermission = async (h, m, i) => globalThis.__bp.permission(h, m, i);\n",
  "ofw.js":
    "export const backupPickerSupported = () => globalThis.__bp.supported;\n" +
    "export const pickBackupFolder = async () => globalThis.__bp.pick();\n" +
    "export const probeBackupFolder = async (d) => globalThis.__bp.probe(d);\n",
};
await esbuild.build({
  entryPoints: [join(here, "../src/lib/backupPresence.svelte.ts")],
  outfile: join(bpOut, "backupPresence.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      name: "bp-fakes",
      setup(build) {
        build.onResolve({ filter: /(persist|engine\/ofw)\.js$/ }, (a) => ({
          path: a.path.endsWith("persist.js") ? "persist.js" : "ofw.js",
          namespace: "bp-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "bp-fake" }, (a) => ({ contents: bpFakes[a.path], loader: "js" }));
      },
    },
  ],
});
const { backupPresence } = await import(pathToFileURL(join(bpOut, "backupPresence.js")).href);

const HANDLE = { kind: "directory", name: "gnw-backups" };
const bp = (over) => {
  globalThis.__bp = {
    supported: true,
    loadDir: async () => HANDLE,
    saveDir: async () => {},
    permission: async () => true,
    probe: async () => [],
    pick: async () => null,
    ...over,
  };
  backupPresence.forget();
};

bp({ loadDir: async () => null });
await backupPresence.refresh();
eq(backupPresence.state.kind, "disconnected", "no remembered folder is `disconnected`");

bp({ permission: async () => false });
await backupPresence.refresh();
eq(backupPresence.state.kind, "disconnected", "a folder whose permission was not re-granted is `disconnected`");

// The check that matters most. A folder we could not open says so; it must NEVER report `none`,
// which is a positive claim about a folder nobody read.
bp({ probe: async () => { throw new Error("NotFoundError"); } });
await backupPresence.refresh();
eq(backupPresence.state.kind, "disconnected", "a folder that fails to open is `disconnected`, never `none`");

bp({ probe: async () => [] });
await backupPresence.refresh();
eq(backupPresence.state.kind, "none", "a readable folder with no pair is `none`");

bp({ probe: async () => [{ model: "zelda", at: 1780000000000, dirName: "backups-2026-06-12-09-00-00" }] });
await backupPresence.refresh();
eq(backupPresence.state.kind, "present", "a pair on disk is `present`");
eq(backupPresence.state.hits[0].at, 1780000000000, "the file's own date survives into the state");
eq(backupPresence.state.hits[0].model, "zelda", "and so does WHICH console it covers");

// A browser that cannot pick folders at all (Firefox) has nothing for the user to act on. It
// must not show an amber row wired to a button that cannot work -- that is the same defect as
// the unsupported-browser card the beginner audit found clickable.
bp({ supported: false, loadDir: async () => { throw new Error("must not be consulted"); } });
await backupPresence.refresh();
eq(backupPresence.state.kind, "unknown", "a browser with no directory picker stays `unknown`");

// A cancelled picker leaves the previous answer standing rather than inventing one.
bp({ probe: async () => [] });
await backupPresence.refresh();
eq(backupPresence.state.kind, "none", "precondition: a scanned empty folder");
globalThis.__bp.pick = async () => null;
await backupPresence.connect();
eq(backupPresence.state.kind, "none", "cancelling the folder picker changes nothing");

// --- 9. The folder walk finds the app's own later backups --------------------------------------
// `writeBackup` puts the pair in the picked folder when it is EMPTY and in a `backups-<stamp>/`
// subfolder when it is not, while the scan only ever read the top level. A user who picked a
// folder that already had anything in it had their first backup written where nothing could
// find it, and was told they had none -- the reported symptom, from a second cause.
const ofwOut = mkdtempSync(join(tmpdir(), "ofwprobe-"));
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/ofw.ts")],
  outfile: join(ofwOut, "ofw.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      name: "ofw-deps",
      setup(build) {
        // The patch engine (WASM liblzma) and the device flasher are irrelevant to reading a
        // folder; without stubbing them this build drags the whole patcher in.
        build.onResolve({ filter: /\?url$/ }, () => ({ path: "url", namespace: "ofw-fake" }));
        build.onResolve({ filter: /(patch|flasher|debug)\.js$/ }, () => ({ path: "engine", namespace: "ofw-fake" }));
        build.onLoad({ filter: /.*/, namespace: "ofw-fake" }, (a) => ({
          contents:
            a.path === "url"
              ? "export default '';"
              : "export const patchModel = () => {}; export const flashImage = () => {};" +
                " export const dumpRegion = () => {}; export const dbgLog = () => {};",
          loader: "js",
        }));
      },
    },
  ],
});
const { probeBackupFolder } = await import(pathToFileURL(join(ofwOut, "ofw.js")).href);

// The probe must stay CHEAP: the Overview tab opens constantly and the external dump is up to
// 16 MiB, so reading contents here would put a multi-megabyte read behind a status row. Asserted
// on the source FIRST, because it reports the reason plainly; the fake files below also throw
// from `arrayBuffer()`, which catches a read reached by any other route.
const ofwSrc = read("../src/lib/engine/ofw.ts");
const probeSrc = ofwSrc.slice(ofwSrc.indexOf("export async function probeBackupFolder"));
ok(!/arrayBuffer/.test(probeSrc.slice(0, probeSrc.indexOf("\n}"))),
  "the presence probe reads metadata only, never file contents");

// A probe that throws is a failed CHECK, not a dead suite: everything after this section still
// has to run and report.
const runProbe = async (d, label) => {
  try {
    return await probeBackupFolder(d);
  } catch (e) {
    checks++;
    failures.push(`${label}: the probe threw ${e && e.message}`);
    return [];
  }
};

// Indexed reads are guarded: a regression that empties `hits` must report every check it broke,
// not halt the suite on a TypeError and hide the sections after this one.
const hit = (hs, i = 0) => hs[i] ?? { model: null, at: null, dirName: null };
const MIB = 1024 * 1024;
const file = (name, size, lastModified) => ({
  kind: "file",
  name,
  getFile: async () => ({ size, lastModified, arrayBuffer: async () => { throw new Error("the presence probe read file contents"); } }),
});
const dir = (name, children) => ({
  kind: "directory",
  name,
  entries: async function* () { for (const c of children) yield [c.name, c]; },
});
const zeldaPair = (t) => [
  file("internal_flash_backup_zelda.bin", 0x20000, t),
  file("flash_backup_zelda.bin", 4 * MIB, t),
];

// The exact reported shape: the picked folder holds an unrelated file, so the ONLY backup is in
// a dated subfolder.
const onlySub = dir("picked", [
  file("notes.txt", 12, 1),
  dir("backups-2026-06-12-09-00-00", zeldaPair(1780000000000)),
]);
let hits = await runProbe(onlySub, "subfolder-only folder");
eq(hits.length, 1, "a backup that landed in a dated subfolder is found");
eq(hit(hits).dirName, "backups-2026-06-12-09-00-00", "the hit names the folder it is really in");

// Several backups: the newest wins, and the top level is the OLDEST (it is what gets written
// while the folder is still empty).
const many = dir("picked", [
  ...zeldaPair(1000),
  dir("backups-2026-01-01-00-00-00", zeldaPair(2000)),
  dir("backups-2026-08-30-12-00-00", zeldaPair(3000)),
]);
hits = await runProbe(many, "many backups");
eq(hits.length, 1, "one hit per model, not one per copy");
eq(hit(hits).at, 3000, "the newest dated subfolder wins");
eq(hit(hits).dirName, "backups-2026-08-30-12-00-00", "newest-first ordering is by the folder stamp");

// A top-level-only folder (the case that always worked) still works.
hits = await runProbe(dir("picked", zeldaPair(4000)), "top-level pair");
eq(hits.length, 1, "a top-level pair is still found");
eq(hit(hits).dirName, "picked", "a top-level pair reports the picked folder");

// Size is the only cheap validity signal, and it has to actually be applied: a truncated or
// zero-byte file must not read as "you are covered".
hits = await runProbe(dir("picked", [
  file("internal_flash_backup_zelda.bin", 0, 5000),
  file("flash_backup_zelda.bin", 4 * MIB, 5000),
]), "empty internal dump");
eq(hits.length, 0, "an empty internal dump is not a backup");
hits = await runProbe(dir("picked", [
  file("internal_flash_backup_zelda.bin", 0x20000, 5000),
  file("flash_backup_zelda.bin", 1024, 5000),
]), "truncated external dump");
eq(hits.length, 0, "a truncated external dump is not a backup");
// Half a pair is not a pair.
hits = await runProbe(dir("picked", [file("flash_backup_zelda.bin", 4 * MIB, 5000)]), "half a pair");
eq(hits.length, 0, "one file of the pair is not a backup");


console.log(failures.length ? `statuspane: ${failures.length} FAILED of ${checks}` : `statuspane: ${checks} checks passed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
