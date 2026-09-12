#!/usr/bin/env node
/**
 * Offline coverage for the SPA back-button contract: `src/lib/nav.ts` (who writes history and
 * when) and `src/lib/sourcesRoute.ts` (the Sources tab's URL grammar).
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/history.mjs'
 *
 * Why these two modules and not the components: no test in this repo can observe a Svelte
 * effect re-running (the runes are defined away as identity functions in every node suite),
 * so both DECISIONS live in rune-free functions and the components only apply them. What is
 * asserted here is exactly what the owner reported as broken:
 *
 *   - a user navigation PUSHES a history entry, so Back returns inside the app. Every hash
 *     write in the app used to be `replaceState`, which is why Back always left it.
 *   - a derived/programmatic navigation REPLACES, so no entry the user did not create exists.
 *   - a write to the hash we are already on does nothing, in either mode — a duplicate entry
 *     would cost one dead Back press.
 *   - `pushState`/`replaceState` fire no event, so our own writes never ping our own readers;
 *     a real Back press does, and the reader is handed the URL to read, never a value to
 *     write back.
 *   - Back with a dismissable overlay open DISMISSES it and leaves the route where it was.
 *   - Back with a NON-dismissable overlay open (the install progress modal mid-flash) does
 *     NOT dismiss it — that modal is a store-backed singleton precisely because it must
 *     survive; see docs/AUDIT_NOTES.md item #17.
 *   - the Sources tab has a route at all: a pane, a selected source and its configure page
 *     each have their own URL, which is what makes Back from a config page possible.
 */
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function deq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}: expected ${y}, got ${x}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-history-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

const entry = join(out, "entry.ts");
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(here, "../src/lib/nav.ts"))};`,
  `export * from ${JSON.stringify(join(here, "../src/lib/sourcesRoute.ts"))};`,
].join("\n"));

// ---- the browser globals nav.ts wires itself to ---------------------------------------------
// A miniature history stack, not a mock of the two methods: the point of the suite is which
// ENTRY you land on after a Back press, and a call-count spy cannot answer that.
const listeners = { popstate: [], hashchange: [] };
const stack = ["#info"];
let idx = 0;
const location = {
  pathname: "/",
  search: "",
  get hash() { return stack[idx]; },
  set hash(v) {
    // A bare assignment is a real navigation: it pushes AND fires hashchange (pushState does
    // neither). Three call sites in the app rely on this; the model has to keep them honest.
    if (stack[idx] === v) return;
    stack.length = idx + 1;
    stack.push(v);
    idx = stack.length - 1;
    for (const f of [...listeners.hashchange]) f();
  },
};
const history = {
  pushState(_s, _t, url) { stack.length = idx + 1; stack.push(url); idx = stack.length - 1; },
  replaceState(_s, _t, url) { stack[idx] = url; },
};
/** The browser's Back button: move the cursor, then fire popstate and hashchange, in order. */
function back() {
  if (idx === 0) throw new Error("Back left the document — no entry behind us");
  idx--;
  for (const f of [...listeners.popstate]) f();
  for (const f of [...listeners.hashchange]) f();
}
globalThis.location = location;
globalThis.history = history;
globalThis.window = {
  addEventListener: (t, f) => listeners[t]?.push(f),
  removeEventListener: (t, f) => {
    const a = listeners[t]; const i = a ? a.indexOf(f) : -1; if (i >= 0) a.splice(i, 1);
  },
};

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [entry],
  outfile: join(out, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});

const nav = await import(pathToFileURL(join(out, "bundle.js")).href);

/** Reset the model and the module between cases. */
function reset(hash = "#info") {
  stack.length = 0;
  stack.push(hash);
  idx = 0;
  nav.__resetNav();
}

// ---- push vs replace ------------------------------------------------------------------------
check("a user navigation pushes an entry", () => {
  reset();
  nav.navigate("#roms", true);
  eq(stack.length, 2, "a pushed navigation adds an entry");
  eq(location.hash, "#roms", "and lands on it");
  back();
  eq(location.hash, "#info", "Back returns INSIDE the app");
});

check("a derived navigation replaces", () => {
  reset();
  nav.navigate("#guided", false);
  eq(stack.length, 1, "a replaced navigation adds no entry");
  eq(location.hash, "#guided", "but does move");
});

check("several user navigations unwind one at a time", () => {
  reset();
  nav.navigate("#roms", true);
  nav.navigate("#sources/remote-cores", true);
  nav.navigate("#sources/remote-cores/owner/name/config", true);
  eq(stack.length, 4, "three pushes over the entry we started on");
  back();
  eq(location.hash, "#sources/remote-cores", "Back leaves the config page for the list");
  back();
  eq(location.hash, "#roms", "and again for the previous tab");
});

check("re-writing the current hash is a no-op in both modes", () => {
  reset("#roms");
  nav.navigate("#roms", true);
  nav.navigate("#roms", false);
  eq(stack.length, 1, "no duplicate entry — a duplicate is one dead Back press");
});

// ---- reading -----------------------------------------------------------------------------
check("our own writes never ping our own readers", () => {
  reset();
  let seen = 0;
  nav.onRoute(() => seen++);
  nav.navigate("#roms", true);
  nav.navigate("#sources", false);
  eq(seen, 0, "pushState/replaceState fire no event; the writer already knows");
});

check("a Back press tells the reader to read the URL", () => {
  reset();
  const seen = [];
  nav.onRoute(() => seen.push(location.hash));
  nav.navigate("#roms", true);
  back();
  eq(seen.length > 0, true, "the reader ran");
  for (const h of seen) eq(h, "#info", "every ping observed the entry we returned to");
  eq(stack.length, 2, "reading wrote nothing back — no entry was manufactured");
});

check("a bare location.hash assignment is still read", () => {
  reset();
  let seen = null;
  nav.onRoute(() => (seen = location.hash));
  location.hash = "#info/overview";
  eq(seen, "#info/overview", "hashchange is wired, not just popstate");
});

check("unsubscribing stops the pings", () => {
  reset();
  let seen = 0;
  const off = nav.onRoute(() => seen++);
  off();
  location.hash = "#roms";
  eq(seen, 0, "a destroyed component is not called");
});

// ---- Back dismisses a modal ------------------------------------------------------------------
check("Back dismisses a dismissable modal and keeps the route", () => {
  reset();
  nav.navigate("#roms", true);
  const routed = [];
  nav.onRoute(() => routed.push(location.hash));
  let dismissed = 0;
  const off = nav.pushDismiss(() => { dismissed++; off(); });
  back();
  eq(dismissed, 1, "the modal closed");
  eq(location.hash, "#roms", "the URL is where it was");
  // The Back step's queued `hashchange` still arrives, but the cancelling `pushState` ran
  // synchronously inside the `popstate` handler — so every reader observes the RESTORED hash
  // and re-applies the state it already had. The tab must never flicker to the entry behind.
  for (const h of routed) eq(h, "#roms", "no reader ever saw the entry we bounced off");
});

check("Back after the modal closed navigates again", () => {
  reset();
  nav.navigate("#roms", true);
  const off = nav.pushDismiss(() => off());
  back();
  eq(location.hash, "#roms", "first Back was spent on the modal");
  back();
  eq(location.hash, "#info", "the next one navigates");
});

check("a modal that must survive an operation is NOT Back-dismissable", () => {
  reset();
  nav.navigate("#roms", true);
  // InstallProgressModal mid-flash: ModalShell is given `onDismiss = null`, so it registers
  // nothing — the same answer backdrop-click and Escape get.
  let routed = 0;
  nav.onRoute(() => routed++);
  back();
  eq(routed > 0, true, "with nothing registered, Back is an ordinary navigation");
  eq(location.hash, "#info", "and it moves");
});

check("the innermost of two stacked modals is the one Back closes", () => {
  reset();
  nav.navigate("#roms", true);
  const closed = [];
  const offOuter = nav.pushDismiss(() => { closed.push("outer"); offOuter(); });
  const offInner = nav.pushDismiss(() => { closed.push("inner"); offInner(); });
  back();
  deq(closed, ["inner"], "the stub prompt over an install closes first");
  back();
  deq(closed, ["inner", "outer"], "then the one beneath it");
  eq(location.hash, "#roms", "neither press navigated");
});

// ---- the Sources tab has a route at all --------------------------------------------------
const { parseSourcesRoute, serializeSourcesRoute, defaultSourcesRoute } = nav;

check("a bare tab route is the default pane", () => {
  deq(parseSourcesRoute(""), defaultSourcesRoute(), "#sources alone");
  eq(serializeSourcesRoute(defaultSourcesRoute()), "remote-cores", "and serializes back");
});

check("a pane is addressable", () => {
  deq(parseSourcesRoute("local-cache"), { pane: "local-cache", selected: null, page: "none" }, "cache pane");
  eq(serializeSourcesRoute({ pane: "local-cache", selected: null, page: "none" }), "local-cache", "round trip");
});

check("a selected source is addressable, slash and all", () => {
  const r = parseSourcesRoute("remote-cores/owner/name");
  deq(r, { pane: "remote-cores", selected: "owner/name", page: "none" }, "the repo keeps its slash");
  eq(serializeSourcesRoute(r), "remote-cores/owner/name", "round trip");
});

check("a source's CONFIGURE page has its own URL — the reported case", () => {
  const r = parseSourcesRoute("remote-homebrew/owner/name/config");
  deq(r, { pane: "remote-homebrew", selected: "owner/name", page: "config" }, "config page");
  eq(serializeSourcesRoute(r), "remote-homebrew/owner/name/config", "round trip");
  // Back from it must land on a DIFFERENT url, or there is nothing to go back to.
  eq(serializeSourcesRoute({ ...r, page: "none" }) !== serializeSourcesRoute(r), true,
    "the list underneath is a distinct address");
});

check("the add page has its own URL", () => {
  deq(parseSourcesRoute("local-directories/add"), { pane: "local-directories", selected: null, page: "add" }, "add page");
  eq(serializeSourcesRoute({ pane: "local-directories", selected: null, page: "add" }), "local-directories/add", "round trip");
});

check("every pane round-trips", () => {
  for (const pane of nav.SOURCE_PANE_IDS) {
    for (const page of ["none", "add", "config"]) {
      const r = { pane, selected: page === "add" ? null : "owner/name", page };
      if (page === "none" && !r.selected) continue;
      deq(parseSourcesRoute(serializeSourcesRoute(r)), r, `${pane}/${page}`);
    }
  }
});

check("garbage in the hash lands on a usable tab", () => {
  deq(parseSourcesRoute("not-a-pane/whatever"), defaultSourcesRoute(), "unknown pane");
  deq(parseSourcesRoute("/"), defaultSourcesRoute(), "a bare slash");
  deq(parseSourcesRoute("remote-cores/%E0%A4%A"), { pane: "remote-cores", selected: "%E0%A4%A", page: "none" },
    "a malformed percent escape is text, not a throw");
});

// -------------------------------------------------------------------------------------------
if (failures.length) {
  console.error(`history: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
if (passed === 0) {
  console.error("history: no checks ran");
  process.exit(1);
}
console.log(`history: ${passed} checks passed`);
