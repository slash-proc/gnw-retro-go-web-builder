/**
 * THE VERSION IS CHOSEN IN THE MODAL, AND THE CHOICE IS REAL.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/installversion.mjs'
 *
 * The owner moved the version picker off the guided Install step and into the confirm modal that
 * already asks whether games and saves should carry over: "I forgot about the modal that pops up
 * asking if the user wants to migrate game/saves. THAT is where I want the version drop-down and
 * the refresh button."
 *
 * Two things are easy to get wrong here and neither is visible to a type check.
 *
 * 1. A PICKER THAT DOES NOT PICK. `runStep2` fetched `versions[0]` in three places. A dropdown
 *    that changes a label while the newest release is installed regardless is worse than no
 *    dropdown, because it lies about what it did. The download is asserted against the SELECTED
 *    release, not against the head of the index.
 * 2. A LABEL FROZEN AT OPEN TIME. `prompt` is plain data written once by `run()`, so a confirm
 *    label captured there cannot follow the picker. It is a function for the same reason
 *    `ConfirmGate.ready` is, and the modal is rendered twice here with different selections to
 *    prove the rendered verb actually moves.
 *
 * Downgrade is not new machinery: `versionRelation` has always answered `older` for any
 * candidate, and every call site simply asked it about `versions[0]`. `versionActionFace` is
 * that answer mapped to a verb, and it lives beside `installTitleState` so this surface and the
 * Advanced rail cannot answer one question two ways.
 */
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";

const here = new URL(".", import.meta.url).pathname;
const web = join(here, "..");
// CI installs from the repo root, so `apps/web/node_modules` may not exist; node still
// resolves the bundle's imports by walking up to the root install.
mkdirSync(join(web, "node_modules"), { recursive: true });
const out = mkdtempSync(join(web, "node_modules/.installversion-"));
const failures = [];
let passed = 0;

const ok = (c, msg) => { if (!c) throw new Error(msg); };
const eq = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}: got ${x}, want ${y}`);
};
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};

const DEVICE_STUB = `
export const device = {
  get banks() { return []; },
  get partitions() { return []; },
  get info() { return null; },
  get isConnected() { return false; },
  get targetMedia() { return "flash"; },
};
export const modelLabel = (m) => String(m ?? "");
`;

function sveltePlugin() {
  return {
    name: "svelte-ssr",
    setup(b) {
      b.onResolve({ filter: /device\.svelte\.js$/ }, () => ({ path: "device", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: DEVICE_STUB, loader: "js" }));
      b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "urlstub" }));
      b.onLoad({ filter: /.*/, namespace: "urlstub" }, () => ({ contents: 'export default "stub:";', loader: "js" }));
      b.onResolve({ filter: /^@webstlink\// }, (a) => ({ path: a.path, namespace: "wsl" }));
      b.onLoad({ filter: /.*/, namespace: "wsl" }, () => ({ contents: "export default {}; export const Logger = class {};", loader: "js" }));
      b.onLoad({ filter: /\.svelte$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const src = await fs.readFile(a.path, "utf8");
        return { contents: compile(src, { generate: "server", filename: a.path, runes: true }).js.code, loader: "js" };
      });
      b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const js = (await esbuild.transform(await fs.readFile(a.path, "utf8"), { loader: "ts", target: "es2022" })).code;
        return { contents: compileModule(js, { generate: "server", filename: a.path }).js.code, loader: "js" };
      });
    },
  };
}

const { gnwResolve } = await import("./gnwResolve.mjs");

// One entry re-exporting BOTH the modal and the singleton it reads. Importing the store from a
// second bundle would hand the test a DIFFERENT instance from the one the component renders --
// the trap `activitypane.mjs` records hitting, where the suite drives a store nothing renders.
const ENTRY = join(out, "entry.js");
const { writeFileSync } = await import("node:fs");
writeFileSync(ENTRY, `
export { default as Modal } from ${JSON.stringify(join(web, "src/lib/ui/InstallProgressModal.svelte"))};
export { installProgress } from ${JSON.stringify(join(web, "src/lib/installProgress.svelte.js"))};
export { versionActionFace, versionRelation } from ${JSON.stringify(join(web, "src/lib/firmwareDist/compare.js"))};
`);

await esbuild.build({
  entryPoints: [ENTRY],
  outdir: join(out, "build"), bundle: true, format: "esm", platform: "node", target: "es2022",
  external: ["svelte", "svelte/*"],
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  plugins: [gnwResolve(join(here, ".")), sveltePlugin()],
  logLevel: "error",
});
const mod = await import(pathToFileURL(join(out, "build/entry.js")).href);
const { Modal, installProgress, versionActionFace } = mod;

// ── The face, executed rather than read ──────────────────────────────────────────────────
// Newest first, as the index publishes them.
const ORDER = ["Retro-Go SD v3", "Retro-Go SD v2", "Retro-Go SD v1"];

await check("the four faces, from the relation the index can establish", () => {
  eq(versionActionFace(null, "Retro-Go SD v2", ORDER), "install", "nothing installed");
  eq(versionActionFace("Retro-Go SD v2", "Retro-Go SD v3", ORDER), "upgrade", "ahead of installed");
  eq(versionActionFace("Retro-Go SD v2", "Retro-Go SD v2", ORDER), "reinstall", "the same release");
  eq(versionActionFace("Retro-Go SD v2", "Retro-Go SD v1", ORDER), "downgrade", "behind installed");
});

await check("A RELATION WE CANNOT DEMONSTRATE IS NOT A DOWNGRADE", () => {
  // An installed build the index cannot place and cannot parse. `isUpgrade` has always refused
  // to promise an upgrade here; the same restraint has to apply in the other direction, or the
  // button claims an ordering nothing established.
  eq(versionActionFace("some-hand-built-thing", "Retro-Go SD v1", ORDER), "reinstall",
    "an unplaceable installed version");
});

// ── The modal, rendered ──────────────────────────────────────────────────────────────────
const VERSIONS = [
  { value: "v3", label: "v3" },
  { value: "v2", label: "v2" },
  { value: "v1", label: "v1" },
];

/** Render the confirm step with a picker sitting on `selected`, and the verb that implies. */
function renderConfirm(selected, verb) {
  installProgress.modalPhase = "confirm";
  installProgress.checkboxValues = {};
  installProgress.prompt = {
    title: "Install Retro-Go",
    body: "",
    confirmText: () => verb,
    danger: true,
    phases: [],
    checkboxes: [{ id: "migrateGames", label: "Migrate games" }],
    confirmGate: null,
    versionPicker: {
      label: "Version",
      options: () => VERSIONS,
      selected: () => selected,
      onSelect: () => {},
      onRefresh: async () => {},
      refreshLabel: "Check for new versions",
    },
    exec: async () => {},
    resolve: () => {},
    reject: () => {},
  };
  return render(Modal).body;
}

await check("THE PICKER IS IN THE MODAL: it draws every published release", () => {
  const html = renderConfirm("v2", "Reinstall");
  ok(/<select\b/.test(html), "the confirm step draws no select at all");
  for (const v of VERSIONS) {
    ok(html.includes(`value="${v.value}"`), `the picker is missing the release ${v.value}`);
  }
});

await check("the refresh sits AFTER the picker, inside the same row", () => {
  const html = renderConfirm("v2", "Reinstall");
  const row = html.slice(html.indexOf("confirm-version"));
  const rowEnd = row.indexOf("</div>");
  const inRow = row.slice(0, rowEnd);
  const select = inRow.indexOf("<select");
  const refresh = inRow.indexOf("<button");
  ok(select >= 0, "the picker is not in the version row");
  ok(refresh >= 0, "the refresh is not in the version row, so it is not beside the picker");
  ok(select < refresh, "the refresh is drawn before the picker; the owner asked for it to the right");
});

await check("the refresh in the modal is named for a screen reader", () => {
  const html = renderConfirm("v2", "Reinstall");
  ok(/aria-label="Check for new versions"/.test(html), "the icon-only refresh has no accessible name");
});

await check("THE CONFIRM VERB FOLLOWS THE PICKER rather than freezing at open time", () => {
  // The same dialog, two selections. A `confirmText` captured as a string at `run()` would
  // render the same word both times.
  const up = renderConfirm("v3", "Upgrade");
  const down = renderConfirm("v1", "Downgrade");
  ok(up.includes("Upgrade"), "the upgrade face does not reach the confirm button");
  ok(down.includes("Downgrade"), "the downgrade face does not reach the confirm button");
  ok(!down.includes(">Upgrade<"), "the downgrade render still shows the upgrade verb");
});

await check("a prompt with no picker draws none, so every other caller is unchanged", () => {
  installProgress.modalPhase = "confirm";
  installProgress.checkboxValues = {};
  installProgress.prompt = {
    title: "Erase", body: "", confirmText: "Erase", danger: true,
    phases: [], checkboxes: [], confirmGate: null, versionPicker: null,
    exec: async () => {}, resolve: () => {}, reject: () => {},
  };
  const html = render(Modal).body;
  ok(!/<select\b/.test(html), "a caller that passes no picker got one anyway");
  ok(html.includes("Erase"), "a plain string confirmText no longer renders");
});

// ── The choice reaches the download ──────────────────────────────────────────────────────
const wiz = readFileSync(join(web, "src/lib/views/Wizard.svelte"), "utf8");

await check("A PICKER THAT ACTUALLY PICKS: the bundle fetched is the selected release", () => {
  const body = wiz.slice(wiz.indexOf('report.start("download")'), wiz.indexOf('report.start("build")'));
  ok(body.length > 0, "the download phase is gone or reshaped");
  ok(/find\(\(v\) => v\.tag === selectedTag\)/.test(body),
    "the download does not resolve the selected tag, so the picker cannot change what is installed");
  ok(!/versions\[0\]/.test(body),
    "the download still reaches for the head of the index, so a picked release is ignored");
  ok(/fetchBundle\(target\.tag/.test(body),
    "fetchBundle is not given the resolved target");
});

await check("the step passes the picker to the modal, and does not draw one itself", () => {
  ok(/versionPicker: \{/.test(wiz), "the install modal is opened without a version picker");
  // The step's own control rows are Install / Reinstall / Upgrade and the version caption. A
  // <select> among them would be the placement the owner moved away from.
  const rows = wiz.slice(wiz.indexOf('{:else if id === "install"}'), wiz.indexOf('{:else if id === "sources"}'));
  ok(rows.length > 0, "the install step's control rows are gone or reshaped");
  ok(!/<select/.test(rows), "the step still draws a version picker of its own");
});

await check("a refetch cannot silently re-pin a choice that aged out", () => {
  const fn = wiz.slice(wiz.indexOf("async function doRefreshVersions"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  ok(/selectedTagUserSet = null/.test(body),
    "a refresh keeps a pinned tag that the new list no longer contains");
});

for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`\ninstall version: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
