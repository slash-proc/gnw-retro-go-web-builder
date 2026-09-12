#!/usr/bin/env node
// Guard: every z-index in apps/web/src is a token from the stacking scale in
// styles/tokens.css, and every component that keeps raw intra-component ordering isolates
// itself so those values cannot leak into the app's layers.
//
// Why this exists: there was no scale. Each component picked its own number (0, 1, 2, 10, 30,
// 40, 100, 1000) and nothing recorded which was meant to win. The Library's bottom dock lost
// to the coverflow — not because its number was too small, but because it was NOT POSITIONED
// at all, and CSS paints non-positioned blocks under positioned descendants whichever came
// later in the DOM. Neither `vite build` nor svelte-check can see a mis-stacked page, so the
// next hand-picked `z-index: 9999` would land unchallenged. This fails instead.
//
// Two halves, matching the rule stated beside the tokens:
//   1. every `z-index:` resolves to a `var(--z-*)` that tokens.css actually defines;
//   2. every EXCEPTION below sits in a file that also calls `isolation: isolate`, so its
//      relative values are contained. `isolation` and not `overflow`/`transform`/`filter`,
//      which create a stacking context but bring clipping or a containing-block change with
//      them — and an `overflow` on a pane clips the app's only scroll container silently.
//
// Cost: one recursive read of apps/web/src. ~30 ms.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");
const SRC = path.join(WEB, "src");
const TOKENS = path.join(SRC, "styles/tokens.css");

// Raw z-index values that are deliberately NOT on the scale, each because only the ORDER of
// the values matters and never their height against the app. Keyed by file, with the reason
// the next reader needs. A file listed here MUST isolate (checked below).
const EXCEPTIONS = [
  {
    file: "lib/ui/Carousel.svelte",
    match: /^\{20 - a\}$/,
    why: "coverflow slide order, computed per slide from its distance to the selection",
    // Relative values with no meaning against the app: they MUST be contained.
    needsIsolation: true,
  },
  {
    file: "lib/ui/ModalShell.svelte",
    match: /^\{zIndex\}$/,
    why: "pass-through of the caller's token; every caller is checked for a token below",
    // Not an ordering of its own, so nothing to contain — the value IS a scale token.
    needsIsolation: false,
  },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(svelte|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

function main() {
  if (!fs.existsSync(TOKENS)) {
    console.error(`zlayers: FAIL — cannot read ${TOKENS}`);
    return 1;
  }
  const tokensSrc = fs.readFileSync(TOKENS, "utf8");
  const scale = new Set([...tokensSrc.matchAll(/^\s*(--z-[a-z-]+)\s*:/gm)].map((m) => m[1]));
  if (scale.size === 0) {
    console.error("zlayers: FAIL — no --z-* tokens found in tokens.css; the scale is gone");
    return 1;
  }

  const files = walk(SRC);
  if (files.length === 0) {
    console.error("zlayers: FAIL — walked apps/web/src and found no .svelte/.css files");
    return 1;
  }

  const problems = [];
  let checked = 0;
  const isolators = new Set();

  for (const abs of files) {
    const rel = path.relative(SRC, abs);
    const src = fs.readFileSync(abs, "utf8");
    if (/isolation:\s*isolate/.test(src)) isolators.add(rel);

    for (const m of src.matchAll(/z-index:\s*([^;\n]+)/g)) {
      const raw = m[1].trim().replace(/"$/, "");
      const line = src.slice(0, m.index).split("\n").length;
      const exempt = EXCEPTIONS.find((e) => e.file === rel && e.match.test(raw));
      if (exempt) { checked++; continue; }
      const tok = raw.match(/^var\(\s*(--z-[a-z-]+)\s*\)$/);
      if (!tok) {
        problems.push(`${rel}:${line}  z-index: ${raw}  -> use a token from the scale in styles/tokens.css`);
      } else if (!scale.has(tok[1])) {
        problems.push(`${rel}:${line}  z-index: ${raw}  -> ${tok[1]} is not defined in tokens.css`);
      }
      checked++;
    }

    // A caller handing ModalShell a layer must hand it a token too.
    for (const m of src.matchAll(/zIndex\s*=\s*(?:"([^"]*)"|\{([^}]*)\})/g)) {
      const val = (m[1] ?? m[2] ?? "").trim();
      if (rel === "lib/ui/ModalShell.svelte") continue; // its own prop declaration/default
      const line = src.slice(0, m.index).split("\n").length;
      const tok = val.match(/^var\(\s*(--z-[a-z-]+)\s*\)$/);
      if (!tok) problems.push(`${rel}:${line}  zIndex=${val}  -> pass a var(--z-*) token, not a number`);
      else if (!scale.has(tok[1])) problems.push(`${rel}:${line}  zIndex=${val}  -> ${tok[1]} is not defined in tokens.css`);
      checked++;
    }
  }

  for (const e of EXCEPTIONS) {
    if (!fs.existsSync(path.join(SRC, e.file))) {
      problems.push(`${e.file}  -> listed as a z-index exception but the file is gone; drop the entry`);
    } else if (e.needsIsolation && !isolators.has(e.file)) {
      problems.push(`${e.file}  -> keeps raw z-index (${e.why}) but never calls isolation: isolate, so those values leak into the app's layers`);
    }
  }

  if (!problems.length) {
    console.log(`zlayers: OK — ${checked} z-index site(s) across ${files.length} file(s), all on the ${scale.size}-layer scale (${EXCEPTIONS.length} documented intra-component exception(s), each isolated)`);
    return 0;
  }
  console.error(`\nzlayers: FAIL — ${problems.length} stacking problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\n  The scale and the rule for choosing a layer are documented beside --z-raised in apps/web/src/styles/tokens.css.\n");
  return 1;
}

process.exit(main());
