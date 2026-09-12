#!/usr/bin/env node
// Guard against a build footgun that svelte-check cannot see:
// a TypeScript OPTIONAL PARAMETER (`foo?: T`) inside a .svelte <script lang="ts">
// type-checks fine, but the Svelte TS-stripping transform removes the type and
// leaves the `?` behind -> invalid JS -> `vite build` fails / blank page.
// (See CLAUDE.md "Dev-container gotchas", and commit d3493c5.)
//
// Precision: this does NOT grep. It parses each <script> block with the real
// TypeScript parser and reports only ts.ParameterDeclaration nodes carrying a
// questionToken, skipping parameters that live in a *type* position
// (interfaces / function types / call signatures / `declare`), which are erased
// wholesale and are therefore harmless.
//
// Run:  docker compose exec dev sh -c 'cd /app && node apps/web/test/svelte-optional-params.mjs'
// Exits non-zero on any hit.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");

const here = dirname(fileURLToPath(import.meta.url));
const roots = process.argv.slice(2).map((p) => (p.startsWith("/") ? p : join(process.cwd(), p)));
if (roots.length === 0) roots.push(join(here, "..", "src"));

function walkDir(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      walkDir(p, out);
    } else if (e.name.endsWith(".svelte")) out.push(p);
  }
}

const files = [];
for (const r of roots) {
  if (statSync(r).isDirectory()) walkDir(r, files);
  else if (r.endsWith(".svelte")) files.push(r);
}
files.sort();

// A parameter in one of these is only ever a type annotation; it is erased
// entirely by the transform, so its `?` cannot survive into emitted JS.
const TYPE_POSITION = new Set([
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.CallSignature,
  ts.SyntaxKind.ConstructSignature,
  ts.SyntaxKind.IndexSignature,
  ts.SyntaxKind.FunctionType,
  ts.SyntaxKind.ConstructorType,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
]);

function inTypePosition(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (TYPE_POSITION.has(n.kind)) return true;
    if (n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return true;
  }
  return false;
}

/** Scan one .svelte source for offending optional parameters. Returns hit records. */
function scanSource(source, file) {
  const found = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const attrs = m[1];
    const body = m[2];
    if (!/lang\s*=\s*["']ts["']/.test(attrs) && !/lang\s*=\s*["']typescript["']/.test(attrs)) continue;
    const bodyStart = m.index + m[0].indexOf(body, attrs.length);
    const preLines = source.slice(0, bodyStart).split("\n").length - 1;

    const sf = ts.createSourceFile(file + ".ts", body, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isParameter(node) && node.questionToken && !inTypePosition(node)) {
        const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push({
          file,
          line: preLines + pos.line + 1,
          text: node.getText(sf).replace(/\s+/g, " "),
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }
  return found;
}

// --- Self-test -------------------------------------------------------------------------
// A clean tree makes this scanner report nothing, which is indistinguishable from a scanner
// that reports nothing because it is BROKEN. A mutation audit confirmed that: neutering
// `inTypePosition()` to always return true, or dropping the `!inTypePosition(node)` term,
// or walking zero files, all left the check green. These fixtures arm it: the detector must
// still fire on the exact pattern that shipped a blank page in d3493c5, and must still stay
// quiet on the three shapes documented as harmless.
const SELF_BAD = [
  ['value parameter', '<script lang="ts">\n  function f(a: number, b?: string) {}\n</script>'],
  ['arrow parameter', '<script lang="ts">\n  const f = (done?: () => void) => {};\n</script>'],
  ['method parameter', '<script lang="ts">\n  class C { m(x?: number) {} }\n</script>'],
];
const SELF_GOOD = [
  ['explicit union default', '<script lang="ts">\n  function f(done: (() => void) | undefined = undefined) {}\n</script>'],
  ['optional property in a type literal', '<script lang="ts">\n  let p: { a?: number } = {};\n</script>'],
  ['parameter in a function TYPE (erased wholesale)', '<script lang="ts">\n  let cb: (a?: number) => void;\n</script>'],
  ['parameter in an interface method signature', '<script lang="ts">\n  interface I { m(a?: number): void }\n</script>'],
  ['optional chaining', '<script lang="ts">\n  const v = obj?.a;\n</script>'],
  ['untyped script block is not parsed', '<script>\n  function f(a?) {}\n</script>'],
];
const selfFailures = [];
for (const [name, src] of SELF_BAD) {
  if (scanSource(src, "<self:" + name + ">").length !== 1) selfFailures.push(`missed a real hit: ${name}`);
}
for (const [name, src] of SELF_GOOD) {
  const n = scanSource(src, "<self:" + name + ">").length;
  if (n !== 0) selfFailures.push(`false positive (${n}) on: ${name}`);
}
if (selfFailures.length) {
  console.error("FAIL: the optional-parameter detector is broken (self-test):");
  for (const f of selfFailures) console.error("  " + f);
  process.exit(1);
}

// The scanner must actually have files to scan; an empty walk would otherwise report "OK".
const MIN_FILES = 20;
if (files.length < MIN_FILES) {
  console.error(`FAIL: only ${files.length} .svelte file(s) found (expected >= ${MIN_FILES}).`);
  console.error("The walk is broken or pointed at the wrong root; a zero-file scan cannot pass.");
  process.exit(1);
}

const hits = [];
for (const file of files) hits.push(...scanSource(readFileSync(file, "utf8"), file));

const rel = (p) => relative(process.cwd(), p) || p;
if (hits.length > 0) {
  console.error(`FAIL: ${hits.length} optional parameter(s) in .svelte <script lang="ts"> blocks.`);
  console.error("These pass svelte-check but break `vite build` (the `?` survives TS stripping).");
  console.error('Fix: widen to an explicit union with a default, e.g. `done: (() => void) | undefined = undefined`.\n');
  for (const h of hits) console.error(`  ${rel(h.file)}:${h.line}  ${h.text}`);
  process.exit(1);
}
console.log(`OK: ${files.length} .svelte files scanned (detector self-test: ${SELF_BAD.length} caught, ${SELF_GOOD.length} clean), no optional parameters in <script lang="ts">.`);
