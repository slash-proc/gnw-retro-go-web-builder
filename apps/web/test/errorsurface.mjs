// ERRORS HAVE TO REACH THE ACTIVITY LOG.
//
// WHY THIS EXISTS. A failed Recovery Mode boot wrote `device.error` and stopped there. No
// component renders that field, so from outside the app "the boot failed" and "the click never
// landed" were the same event: the owner pressed the button repeatedly and reported a hardware
// flake. It was a real race, and it had been invisible for weeks. An audit then found the app
// had exactly ONE catch in `src/` that reached `auditLog.add` -- the converter's.
//
// Two structural rules, both of which that bug broke. Neither is a per-site assertion: they are
// shaped so a NEW silent sink fails them, which a list of today's call sites would not.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;
let failures = [];
const check = (name, fn) => {
  try { fn(); console.log(`  ok ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}: ${e.message}`); }
};
// Arrays compare by VALUE here. Comparing them with `!==` (identity) made both checks fail
// with "got [], want []" -- the guard was broken in the direction that shouts, which is the
// lucky direction; the same slip in an `if (a === b) pass` shape would have passed silently.
const eq = (a, b, m) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${m}: got ${A}, want ${B}`);
};
const ok = (c, m) => { if (!c) throw new Error(m); };

function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e), st = statSync(p);
    if (st.isDirectory()) { if (e !== "node_modules") walk(p, out); }
    else if (/\.(ts|svelte)$/.test(e)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const read = (f) => readFileSync(f, "utf8");

// The idiom every store uses to capture a thrown error into its own state.
const CAPTURE = /this\.(\w*[eE]rror\w*)\s*=\s*e instanceof Error \? e\.message : String\(e\)/g;
// A write that reaches the log, directly or through dbg()'s injected sink -- AND that carries
// the failure with it. Matching a bare `auditLog.add(`/`dbg(` anywhere in the block is not
// enough: the connect path logs a line on the user's own picker dismissal right beside the
// capture, and a guard that accepted any log call in the vicinity passed with the real error
// path deleted. The log call has to mention the captured field or the caught binding.
const LOG_CALL = /(?:auditLog\.add|dbg)\(([\s\S]*?)\);/g;
function carriesTheFailure(block, field) {
  LOG_CALL.lastIndex = 0;
  let m;
  while ((m = LOG_CALL.exec(block))) {
    const args = m[1];
    if (new RegExp(`this\\.${field}\\b`).test(args)) return true;
    if (/\be\.message\b|\be instanceof Error\b|\$\{e\}|\(e\)/.test(args)) return true;
  }
  return false;
}

function captures() {
  const out = [];
  for (const f of files.filter((f) => f.endsWith(".svelte.ts"))) {
    const src = read(f);
    const lines = src.split("\n");
    let m;
    CAPTURE.lastIndex = 0;
    while ((m = CAPTURE.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      // The enclosing catch block, approximated by the window from the capture to the closing
      // brace of its block. A capture logs if the log write sits in that same block.
      let depth = 0, end = line - 1;
      for (let j = line - 1; j < Math.min(line + 30, lines.length); j++) {
        for (const ch of lines[j]) { if (ch === "{") depth++; else if (ch === "}") depth--; }
        end = j;
        if (depth < 0) break;
      }
      out.push({ file: relative(SRC, f), line, field: m[1], block: lines.slice(line - 1, end + 1).join("\n") });
    }
  }
  return out;
}

check("an error captured into store state also reaches the activity log", () => {
  const caps = captures();
  // ARMED: if the capture idiom is renamed this suite must fail loudly rather than pass on an
  // empty list, which is how a guard quietly stops guarding.
  ok(caps.length >= 4, `the store error-capture idiom matched ${caps.length} sites; it used to match at least 4, so this guard is no longer reading what it claims to`);
  const silent = caps.filter((c) => !carriesTheFailure(c.block, c.field));
  eq(
    silent.map((c) => `${c.file}:${c.line} (${c.field})`),
    [],
    "a store captured a thrown error into its own state and told nothing else; no component is obliged to render that field, so this is the shape that made a failed Recovery Mode boot look like a button that did nothing",
  );
});

check("no error goes only to the browser console", () => {
  // `console.error`/`console.warn` reach devtools and nothing else. The deployed build is
  // exactly where someone is asked for a bug report, and CLAUDE.md records the same argument
  // against `debug.ts`'s old `/api/debug` POST, which only ever reached the dev server.
  const bad = [];
  for (const f of files) {
    const src = read(f).split("\n");
    src.forEach((l, i) => {
      if (/(?<!\/\/.*)\bconsole\.(error|warn)\s*\(/.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*")) {
        bad.push(`${relative(SRC, f)}:${i + 1}`);
      }
    });
  }
  eq(bad, [], "an error is reported only to the browser console, which a deployed build cannot show and a bug report cannot carry; route it through dbg() or auditLog.add()");
});

console.log(`error surface: ${failures.length ? `${failures.length} FAILED, ` : ""}${2 - failures.length} checks passed`);
for (const f of failures) console.log(`  ${f}`);
process.exit(failures.length ? 1 : 0);
