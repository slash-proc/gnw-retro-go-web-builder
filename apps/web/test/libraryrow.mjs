/**
 * THE LIBRARY'S FILTER ROW: consoles, then search, then the Library refresh.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/libraryrow.mjs'
 *
 * WHY THIS EXISTS, in the owner's words: "the consoles div should be to the left of the search
 * div so the consoles wrap around and the search stays centered to that. To the right of the
 * search, there should be a tasteful refresh button to refresh the Library."
 *
 * The search field used to be the LAST CHILD of `.consoles`, pushed right with
 * `margin-inline-start: auto` so the chips kept one wrapping run. The consequence, which is what
 * he was looking at, is that the field followed the chips to the END of their last line instead
 * of sitting against the middle of the block. Centring it requires it to be a SIBLING of the
 * chips, so the row is now `.filterrow` holding three items with `align-items: center`.
 *
 * Two halves, checked two ways, because neither alone is enough:
 *
 *   - WHAT RENDERS. The real component compiled by the real Svelte compiler and rendered
 *     server-side, so the order of the three items is read off the markup the app produces
 *     rather than off the template's indentation.
 *   - WHAT THE STYLESHEET SAYS. Order in the DOM does not make the field centred; `align-items`
 *     does, and `.consoles` has to be the item that grows. Those are read from the CSS the
 *     compiler EMITS, which is also the only way to see that `.search` has stopped carrying the
 *     `margin-inline-start: auto` that used to push it.
 *
 * The wiring is asserted separately: the button must call a LIBRARY rescan. Calling
 * `library.sync()` would look identical and do nothing, because `sync()` no-ops on an unchanged
 * `romFolderSignature` and the signature covers the registry rather than the files inside it.
 * `library.refresh()` clears the synced signature first, which is the whole point of it existing.
 *
 * ARMED: the render depends on a `library` stub putting `listState` into "ready". If that stub
 * stops taking, the component renders its empty gate instead and every markup assertion would
 * pass vacuously on a page that has no filter row at all. The harness fails loudly in that case
 * rather than reporting a pass.
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";

const here = new URL(".", import.meta.url).pathname;
const web = join(here, "..");
const failures = [];
let passed = 0;

const ok = (c, msg) => { if (!c) throw new Error(msg); };
const eq = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}: got ${x}, want ${y}`);
};
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};

const SRC = join(web, "src/lib/views/RomManagementTab.svelte");
const LIB = join(web, "src/lib/library.svelte.ts");
const BTN = join(web, "src/lib/ui/RefreshButton.svelte");

/* The real store pulls the whole engine in and decides which of three gates the tab draws.
 * Only `listState` matters to the row under test; the rest is what the surrounding markup
 * reads while rendering. Data only: nothing here stands in for the layout being asserted. */
const LIBRARY_STUB = `
  export const library = {
    listState: "ready", progress: null, scan: null, dirtyFiles: new Set(),
    romFolderSignature: "x", sourcesResolving: false, loaded: true, fileOrigin: new Map(),
    scanCollisions: [], scanDuplicates: [], scanSkipped: [], error: null, pendingHandle: null,
    sync: async () => {}, refresh: async () => {}, ensureFolders: async () => {},
    openFolderGate: async () => {}, markDirty: () => {}, clearDirty: () => {},
  };`;
/* The ST-Link vendor is a browser bundle with no node entry point; nothing it exports is
 * reachable from the markup being rendered. */
const WEBSTLINK_STUB = `export default {}; export const Stlinkv2 = {}; export const Logger = class {};`;

function sveltePlugin() {
  return {
    name: "svelte-ssr",
    setup(b) {
      b.onResolve({ filter: /library\.svelte\.js$/ }, () => ({ path: "library", namespace: "libstub" }));
      b.onLoad({ filter: /.*/, namespace: "libstub" }, () => ({ contents: LIBRARY_STUB, loader: "js" }));
      b.onResolve({ filter: /^@webstlink\// }, () => ({ path: "webstlink", namespace: "wsstub" }));
      b.onLoad({ filter: /.*/, namespace: "wsstub" }, () => ({ contents: WEBSTLINK_STUB, loader: "js" }));
      b.onLoad({ filter: /\.svelte$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const src = await fs.readFile(a.path, "utf8");
        return { contents: compile(src, { generate: "server", filename: a.path, runes: true }).js.code, loader: "js" };
      });
      b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const src = await fs.readFile(a.path, "utf8");
        const js = (await esbuild.transform(src, { loader: "ts", target: "es2022" })).code;
        return { contents: compileModule(js, { generate: "server", filename: a.path }).js.code, loader: "js" };
      });
    },
  };
}

const { gnwResolve } = await import("./gnwResolve.mjs");

/* NOT under node_modules: the worktree's node_modules is a symlink to the main clone's, so a
 * temp dir made there would write the build into the MAIN clone and import it from there. */
const out = mkdtempSync(join(web, ".libraryrow-"));
let body = "";
try {
  await esbuild.build({
    entryPoints: [SRC], outdir: out, bundle: true, format: "esm",
    platform: "node", target: "es2022", external: ["svelte", "svelte/*"],
    loader: { ".wasm": "empty", ".bin": "empty", ".png": "empty", ".svg": "empty" },
    plugins: [gnwResolve(join(here, ".")), sveltePlugin()], logLevel: "error",
  });
  const C = (await import(pathToFileURL(join(out, "RomManagementTab.js")).href)).default;
  body = render(C, { props: {} }).body;
} finally {
  rmSync(out, { recursive: true, force: true });
}

// --- armed: the render has to be of the page that HAS the row ---------------------------------
if (!/filterrow/.test(body)) {
  console.error(
    "library row: the rendered markup has no filter row at all, so the library stub is no longer " +
    "putting listState into \"ready\" and every markup assertion below would pass on the empty " +
    "gate instead. This suite cannot test what it claims to.",
  );
  process.exit(1);
}

// --- what renders -----------------------------------------------------------------------------
const rowStart = body.indexOf("filterrow");
const row = body.slice(rowStart, body.indexOf("two-pane", rowStart));

check("THE REPORTED ORDER: consoles, then search, then the refresh", () => {
  const order = [
    [row.indexOf('class="consoles'), "consoles"],
    [row.indexOf('class="search'), "search"],
    [row.search(/aria-label="[^"]*"[^>]*class="refresh|class="refresh/), "refresh"],
  ];
  ok(order.every(([i]) => i >= 0), `an item is missing from the row: ${JSON.stringify(order)}`);
  const sorted = [...order].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  eq(sorted, ["consoles", "search", "refresh"], "the row's three items are not in that order");
});

check("the search is a SIBLING of the chips, not the last one among them", () => {
  const consoles = row.indexOf('class="consoles');
  const close = row.indexOf("</div>", consoles);
  const search = row.indexOf('class="search');
  ok(close >= 0 && search > close,
    "the search field is still inside the `.consoles` box, so it wraps with the chips and " +
    "follows them to the end of their last line instead of sitting centred beside them");
});

check("the refresh button carries an accessible name, from the real string table", () => {
  const en = readFileSync(join(web, "src/lib/i18n/strings/roms.ts"), "utf8");
  const m = /refreshLibrary: "([^"]+)"/.exec(en);
  ok(m, "roms.ts has no refreshLibrary key");
  ok(body.includes(`aria-label="${m[1]}"`),
    `the icon-only button has no accessible name in the rendered markup (wanted "${m[1]}")`);
});

// --- what the stylesheet says -----------------------------------------------------------------
const css = compile(readFileSync(SRC, "utf8"), { generate: "client", filename: SRC, runes: true }).css.code;
/** The declarations of one rule, by the class it is written against.
 *
 *  Two traps, both hit while writing this. Comments are stripped FIRST: a loose match found the
 *  prose inside a `/* ... *\/` block that happened to name `.search`, and returned it as if it
 *  were the rule, so the assertion passed whatever the rule actually declared. And the match is
 *  anchored on the class PLUS Svelte's scope suffix immediately before the brace, so `.search`
 *  cannot match `.search input` or `.search:focus-within`. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
const ruleFor = (cls) => {
  const re = new RegExp(`\\.${cls}\\.svelte-[a-z0-9]+\\s*\\{([^}]*)\\}`);
  const m = re.exec(bare);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
};

check("THE CENTRING RULE: the row centres its items against each other", () => {
  const r = ruleFor("filterrow");
  ok(r, ".filterrow is not in the emitted stylesheet");
  ok(/align-items:\s*center/.test(r),
    `the row does not centre its items, so the field sits against the chips' first or last line ` +
    `rather than the middle of the block: ${r}`);
});

check("the chips are the item that grows and is allowed to shrink", () => {
  const r = ruleFor("consoles");
  ok(r, ".consoles is not in the emitted stylesheet");
  ok(/flex:\s*1\s+1\s+(?:auto|0)\b/.test(r),
    `.consoles does not grow, so the search and the refresh do not sit at the row's end: ${r}`);
  ok(/min-width:\s*0/.test(r),
    `.consoles cannot shrink below its content, which is what pushes a flex row wider than its ` +
    `track and puts a horizontal scrollbar on the page: ${r}`);
});

check("the search no longer pushes itself right from inside the chip run", () => {
  const r = ruleFor("search");
  ok(r, ".search is not in the emitted stylesheet");
  ok(!/margin-inline-start:\s*auto/.test(r),
    `.search still carries the auto margin it used to need as the last child of .consoles; as a ` +
    `sibling that margin would push it away from the chips instead of centring it: ${r}`);
});

check("the chips wrap inside their own box, not by pushing the field to a new line", () => {
  const r = ruleFor("consoles");
  ok(/flex:\s*1\s+1\s+0\b/.test(r),
    `.consoles takes flex-basis auto, so its hypothetical size is every chip on one line; that ` +
    `never fits beside .search's 210px floor, so .filterrow wraps and the field drops below the ` +
    `chips instead of sitting beside them: ${r}`);
});

check("the row can wrap, so a narrow viewport does not scroll sideways", () => {
  const r = ruleFor("filterrow");
  ok(/flex-wrap:\s*wrap/.test(r),
    `.search holds a 210px floor and will not shrink below it; without wrapping, a narrow ` +
    `viewport pushes the row past the page instead of dropping the field to its own line: ${r}`);
});

// --- the wiring -------------------------------------------------------------------------------
const tab = readFileSync(SRC, "utf8");
const lib = readFileSync(LIB, "utf8");

check("THE BUTTON RESCANS THE LIBRARY, not the firmware version list", () => {
  const m = /<RefreshButton[\s\S]{0,200}?onRefresh=\{([^}]+)\}/.exec(tab);
  ok(m, "the Library's RefreshButton has no onRefresh");
  ok(/library\.refresh\(\)/.test(m[1]),
    `the Library's refresh calls ${m[1].trim()} rather than library.refresh()`);
  ok(!/refreshVersions/.test(m[1]),
    "the Library's refresh is wired to the firmware version list, which is a different document");
});

check("library.refresh() FORCES the rescan that sync() would skip", () => {
  const m = /async refresh\(\): Promise<void> \{([\s\S]*?)\n  \}/.exec(lib);
  ok(m, "library.svelte.ts has no refresh()");
  const bodyOf = m[1];
  ok(/this\.syncedSignature = null/.test(bodyOf),
    "refresh() does not clear the synced signature, so sync() no-ops on an unchanged registry " +
    "and pressing the button does nothing when the user has changed files on disk");
  ok(/await this\.sync\(\)/.test(bodyOf), "refresh() never calls sync()");
  const order = bodyOf.indexOf("syncedSignature") < bodyOf.indexOf("this.sync()");
  ok(order, "refresh() clears the signature AFTER syncing, which is too late to force anything");
});

check("the control rate limits itself, like the one it was modelled on", () => {
  const btn = readFileSync(BTN, "utf8");
  ok(/COOLDOWN_MS = 10000/.test(btn), "the lockout is not the 10 s the owner asked for");
  ok(/disabled=\{disabled \|\| busy \|\| cooling\}/.test(btn),
    "the button is not disabled while in flight or cooling down, so it can be mashed");
  ok(/class:spin=\{busy\}/.test(btn),
    "the icon does not spin while the work is in flight, or spins on the silent lockout too");
});

if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`library row: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`library row: ${passed} checks passed`);
