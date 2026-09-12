/**
 * A STATE WRITE INSIDE AN EFFECT FLUSH RE-TRIGGERS THE EFFECT.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/effectloop.mjs'
 *
 * WHY THIS EXISTS. A one-line diagnostic was added to `GameDetailsPanel`, first inside a
 * `$derived` (which throws `state_unsafe_mutation`, and took the Cheats tab down), then moved
 * into an `$effect` to fix that -- which took the SAVES tab down as well. `dbg()` writes through
 * its sink into `auditLog`, `auditLog.add()` assigns `$state`, and a write performed during the
 * flush re-dirties the batch the effect belongs to: the effect runs again, writes again, and the
 * runtime ends it with `effect_update_depth_exceeded`.
 *
 * THE SECOND-ORDER DAMAGE IS THE POINT. That error aborts the whole effect flush, so every
 * effect declared AFTER the offending one silently stops running. In the panel that is the
 * Saves tab's LFS-tree loader, which is why a cheats diagnostic broke Saves, while Cover art --
 * which needs no effect at all -- kept working and made the failure look selective.
 *
 * NOTHING ELSE IN THIS REPO CATCHES IT. `svelte-check`, `vite build` and every node suite pass:
 * the component compiles, renders correctly under SSR (all three panels, right ARIA, right
 * panel per tab), and SSR does not run effects. Only running the reactive graph shows it.
 *
 * `untrack()` is NOT the fix and that is measured here, not assumed -- it loops exactly as the
 * synchronous call does. Deferring the write out of the flush is what works.
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { compileModule } from "svelte/compiler";

const here = new URL(".", import.meta.url).pathname;
const web = join(here, "..");
const out = mkdtempSync(join(web, "node_modules/.effectloop-"));
const failures = [];
let passed = 0;

const check = (name, fn) => {
  try { fn(); passed++; }
  catch (e) { failures.push(`  FAIL ${name}: ${e.message}`); }
};
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg); };

const runes = {
  name: "runes",
  setup(b) {
    b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => {
      const fs = await import("node:fs/promises");
      const js = (await esbuild.transform(await fs.readFile(a.path, "utf8"), { loader: "ts", target: "es2022" })).code;
      return { contents: compileModule(js, { generate: "client", filename: a.path }).js.code, loader: "js" };
    });
  },
};

// The REAL auditLog and the REAL logEntry, driven by an effect shaped like the panel's.
const H = join(out, "h.svelte.ts");
writeFileSync(H, [
  'import { untrack } from "svelte";',
  `import { auditLog } from ${JSON.stringify(join(web, "src/lib/auditLog.svelte.ts"))};`,
  `import { literal } from ${JSON.stringify(join(web, "src/lib/logEntry.ts"))};`,
  'export function run(mode, cap) {',
  '  let tick = $state(0);',
  '  $effect.root(() => {',
  '    $effect(() => {',
  '      tick;',
  '      globalThis.RUNS = (globalThis.RUNS ?? 0) + 1;',
  '      if (globalThis.RUNS > cap) return;',
  '      const write = () => auditLog.add("debug", "device", literal("x"));',
  '      if (mode === "untrack") untrack(write);',
  '      else if (mode === "deferred") queueMicrotask(write);',
  '      else write();',
  '    });',
  '  });',
  '  return { bump: () => { tick++; } };',
  '}',
].join("\n"));

await esbuild.build({
  entryPoints: [H], outdir: out, bundle: true, format: "esm", platform: "node",
  target: "es2022", external: ["svelte", "svelte/*"], plugins: [runes], logLevel: "error",
});

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
delete globalThis.window;

const CAP = 300;
const { flushSync } = await import("svelte");
const mod = await import(pathToFileURL(join(out, "h.svelte.js")).href);

/** One measured run of the effect shape. Returns how many times the effect body ran. */
async function runs(mode) {
  globalThis.RUNS = 0;
  mod.run(mode, CAP).bump();
  flushSync();
  await new Promise((r) => setTimeout(r, 200));
  return globalThis.RUNS;
}

const sync = await runs("sync");
const untracked = await runs("untrack");
const deferred = await runs("deferred");

check("A SYNCHRONOUS audit-log write inside an effect re-triggers that effect", () => {
  ok(sync > CAP, `a synchronous auditLog.add() inside an $effect settled after ${sync} run(s); it is supposed to run away, and if it no longer does the hazard this suite guards has changed`);
});

check("untrack() does NOT make the write safe", () => {
  ok(untracked > CAP, `untrack(write) settled after ${untracked} run(s). If Svelte's tracking changed so this is now safe, say so deliberately rather than letting the panel's comment keep claiming otherwise`);
});

check("DEFERRING the write out of the flush runs the effect exactly once", () => {
  eq(deferred, 1, "a write handed to queueMicrotask still re-triggered its effect, so the fix in GameDetailsPanel does not hold");
});

// --- the panel itself -------------------------------------------------------------------
const panel = readFileSync(join(web, "src/lib/views/GameDetailsPanel.svelte"), "utf8");

/** The body of every `$effect(() => { ... })` in the component, crudely but adequately: from the
 *  opening to the matching close, counted on braces. */
function effectBodies(src) {
  const bodies = [];
  const re = /\$effect\(\(\)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    bodies.push(src.slice(m.index, i));
  }
  return bodies;
}

check("no $effect in the panel writes the audit log synchronously", () => {
  // BOTH write paths, not just `dbg()`. `dbg()` reaches `auditLog.add()` through its sink, so
  // a direct `auditLog.add()` inside an effect body is the same hazard wearing the other name
  // -- and a later edit reaching for the direct call would have walked straight past a guard
  // that only knew the indirect one.
  const WRITES = /\bdbg\(|\bauditLog\.add\(/;
  const DEFERRED = /(?:queueMicrotask|setTimeout)\(\s*\(\)\s*=>\s*(?:dbg\(|\n?\s*auditLog\.add\()/;
  const bad = effectBodies(panel)
    .filter((b) => WRITES.test(b))
    .filter((b) => !DEFERRED.test(b));
  eq(bad.length, 0, `an $effect writes the audit log inside the flush; that write re-triggers the effect and aborts the flush, stopping every effect declared after it (that is how a cheats diagnostic broke the Saves tab)`);
});

check("the cheats diagnostic is still there to be read", () => {
  ok(/\[cheats\]/.test(panel), "the [cheats] diagnostic line is gone; it is what tells a bug report which of the three hops failed");
  ok(effectBodies(panel).some((b) => /\[cheats\]/.test(b)), "the [cheats] line is no longer inside an $effect, so it will not re-log when the row or the database changes");
});

rmSync(out, { recursive: true, force: true });
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`effect loop: ${failures.length} FAILED, ${passed} passed`);
  process.exit(1);
}
console.log(`effect loop: ${passed} checks passed`);
