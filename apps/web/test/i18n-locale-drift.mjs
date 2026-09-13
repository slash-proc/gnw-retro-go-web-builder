#!/usr/bin/env node
// Guard: an English i18n string value must never change without every locale sibling
// changing in the SAME commit.
//
// Why this exists: `strings/<area>.ts` (English) has a sibling `strings/<area>.<locale>.ts`
// for every non-English locale, and each sibling is shape-checked against English by the
// area's `Widen<...>` mapped type. The type only checks the SHAPE — add/remove a key and
// every sibling fails to compile, but *reword* an existing key's value and nothing at all
// complains. The siblings then keep a faithful translation of English wording that no
// longer exists. That happened for real: commit 0658cdf renamed the "Firmware Setup" tab to
// "Firmware" and the "ROMs" tab to "Library" in English and German only, and es/fr/ja/ko/pl
// carried translations of the retired names for months.
//
// A "value identical to English" scan cannot see this — the stale strings are properly
// translated, just of the wrong source text. Only the commit history can.
//
// What this checks, per commit since BASELINE (first-parent only):
//   1. an English key whose value changed        -> every sibling's value for that key must
//                                                    have changed in that same commit
//   2. an English key that was RENAMED in place  -> same, matched under the new key name
// A sibling is exempt when its file did not yet exist at the parent commit.
//
// Escape hatch for a genuinely translation-neutral English edit (fixing a typo in a
// filename, re-casing a proper noun, changing punctuation that other languages don't
// share): put the trailer
//     i18n-locale-drift: ok
// in the commit message. That is a deliberate, reviewable, in-history waiver — do not
// reach for it just to make the check green.
//
// Deterministic, offline, and bounded: it walks at most MAX_COMMITS first-parent commits
// after a pinned baseline sha. If git is unavailable or the baseline is not in this
// repository (a shallow clone, an export tarball), it skips loudly rather than passing
// silently or failing spuriously.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const DIR = "apps/web/src/lib/i18n/strings";

// Every commit at or before this one is history we inherited; the guard only polices what
// lands after it. The fifteen-locale rollout and its English rewordings are already part of
// main, but its waiver lived on a side merge that is not in main's first-parent history. Keep
// that accepted history out of the forward-looking check while continuing to police every new
// English edit from this point onward.
const BASELINE = "1d376c6";
const MAX_COMMITS = 500;
const WAIVER = /^i18n-locale-drift:\s*ok\s*$/im;

const AREAS = ["deviceHeader", "firmwareSetup", "landing", "overview", "roms", "shared", "sources", "wizard"];

/**
 * Is an English edit translation-neutral — i.e. can no sibling possibly need to change?
 *
 * Two cases, both established by real edits this guard blocked:
 *  - WHITESPACE. Moving a fragment boundary's space out of the .svelte template and into the
 *    strings changes only where the space lives. Requiring siblings to follow would be actively
 *    wrong: ja and ko do not use inter-word spaces, so their correct value is the one WITHOUT it.
 *  - CASE. Title Case -> sentence case is an English typographic convention. German capitalises
 *    nouns regardless ("Flash-Dienstprogramm"), Japanese and Korean have no case at all. Holding
 *    an artboard-backed casing fix hostage to six no-op edits blocked real work.
 *
 * Deliberately NOT exempt: punctuation. A comma or an em dash can carry meaning, and the fr/ko
 * composition bugs this guard exists to catch were punctuation-shaped.
 */
function neutral(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
/** Derived from disk, not listed: see the same note in `firstrun.mjs`. A hand-kept copy of this
 *  list in a third file is how a newly landed locale goes unpoliced without anything failing. */
const LOCALES = [...new Set(
  fs.readdirSync(path.join(REPO, DIR))
    .map((f) => f.match(/\.([a-z]{2}(?:-[A-Za-z]{2,4})?)\.ts$/))
    .filter((m) => m !== null)
    .map((m) => m[1]),
)].sort();

/**
 * Locate this checkout's git directory when git itself cannot.
 *
 * A linked worktree's `.git` is a FILE holding `gitdir: <absolute path>` — and that path is
 * written by whoever ran `git worktree add`, i.e. the HOST. The dev container bind-mounts the
 * repo somewhere else (`/app`), so from inside the container that path does not exist and every
 * git command fails; the guard then went SKIP in the one environment all the work happens in.
 *
 * Rather than assume a mount point, this DERIVES it: walk up from the worktree looking for a
 * main clone whose `.git/worktrees/<name>/gitdir` back-reference names this same worktree. That
 * back-reference is also written host-side, so only its TAIL is comparable — it must end with
 * the worktree's path relative to the candidate root plus `/.git`. Name and relative location
 * must both agree, so a coincidental same-named directory elsewhere cannot match. Returns null
 * when nothing checks out — the caller then skips loudly, exactly as before.
 */
function findGitDir() {
  let dotgit;
  try {
    dotgit = fs.readFileSync(path.join(REPO, ".git"), "utf8");
  } catch {
    return null; // not a linked worktree (a normal clone has a .git DIRECTORY): nothing to fix
  }
  const m = dotgit.match(/^gitdir:\s*(.+?)\s*$/m);
  if (!m) return null;
  if (fs.existsSync(m[1])) return m[1]; // the recorded path resolves here (host side): use it
  const name = path.basename(m[1]);
  for (let dir = path.dirname(REPO); ; dir = path.dirname(dir)) {
    const cand = path.join(dir, ".git", "worktrees", name);
    const tail = `/${path.relative(dir, REPO)}/.git`;
    try {
      const back = fs.readFileSync(path.join(cand, "gitdir"), "utf8").trim();
      if (back === tail.slice(1) || back.endsWith(tail)) return cand;
    } catch {
      /* keep walking */
    }
    if (dir === path.dirname(dir)) return null;
  }
}

// Set only when the recorded gitdir is unreachable and we found the real one (container-side
// worktree). Empty otherwise, so the main clone's behaviour is byte-for-byte unchanged.
const GITDIR = findGitDir();
const GIT_ENV = GITDIR && GITDIR !== path.join(REPO, ".git") ? { ...process.env, GIT_DIR: GITDIR } : process.env;

function git(args) {
  // `-c safe.directory=*`: inside the dev container the bind-mounted repo is owned by the host
  // user, so git refuses it as "dubious ownership" and this guard silently went INERT in the one
  // place `npm run check` actually runs. Reading history is not a privileged operation.
  return execFileSync("git", ["-c", "safe.directory=*", ...args], { cwd: REPO, env: GIT_ENV, maxBuffer: 1 << 28, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// Flatten `export const <name><Suffix> = { ... }` into "exportBase.nested.key" -> value.
// Only single-line string literals are collected; a key whose value spans lines or is a
// function is skipped (it is not a plain literal, so a value diff is not meaningful here).
function parse(text, suffix) {
  const out = new Map();
  let root = null;
  const stack = [];
  for (const line of text.split("\n")) {
    const ex = line.match(/^export const ([A-Za-z0-9_]+)\s*(?::[^=]*)?=\s*\{/);
    if (ex) {
      root = ex[1];
      stack.length = 0;
      continue;
    }
    if (root === null) continue;
    if (/^\}/.test(line)) {
      root = null;
      stack.length = 0;
      continue;
    }
    if (!root.endsWith(suffix)) continue;
    const nest = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*\{\s*$/);
    if (nest) {
      stack.push(nest[1]);
      continue;
    }
    if (/^\s*\},?\s*$/.test(line)) {
      stack.pop();
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(['"`])((?:[^\\]|\\.)*?)\2\s*,?\s*$/);
    if (kv) out.set([root.slice(0, -suffix.length), ...stack, kv[1]].join("."), kv[3]);
  }
  return out;
}

const parentOf = (key) => key.slice(0, key.lastIndexOf("."));

// English edits that a translator would have to follow: reworded keys, plus keys renamed in
// place (paired by identical parent object AND identical preceding key, so an unrelated
// insertion elsewhere in the file cannot create a bogus pair).
function englishEdits(before, after) {
  const edits = [];
  for (const [k, v] of after) {
    // Whitespace-only edits are translation-neutral BY CONSTRUCTION: moving a fragment
    // boundary's spacing out of the .svelte template and into the strings changes only where
    // the space lives. Requiring siblings to change there would be actively wrong — ja and ko
    // do not use inter-word spaces, so their correct value is the one WITHOUT the space.
    if (before.has(k) && before.get(k) !== v && !neutral(before.get(k), v))
      edits.push({ oldKey: k, newKey: k, from: before.get(k), to: v });
  }
  const bk = [...before.keys()];
  const ak = [...after.keys()];
  const added = ak.filter((k) => !before.has(k));
  for (const removed of bk.filter((k) => !after.has(k))) {
    const i = bk.indexOf(removed);
    const prev = i > 0 ? bk[i - 1] : null;
    const mate = added.find((a) => {
      const j = ak.indexOf(a);
      return parentOf(a) === parentOf(removed) && (j > 0 ? ak[j - 1] : null) === prev;
    });
    if (mate && before.get(removed) !== after.get(mate) && !neutral(before.get(removed), after.get(mate)))
      edits.push({ oldKey: removed, newKey: mate, from: before.get(removed), to: after.get(mate) });
  }
  return edits;
}

function run(range) {
  const problems = [];
  let inspected = 0;
  for (const area of AREAS) {
    const enPath = `${DIR}/${area}.ts`;
    const log = gitOrNull(["log", "--first-parent", `--max-count=${MAX_COMMITS}`, "--format=%H", range, "--", enPath]);
    if (log === null) return null;
    const commits = log.trim().split("\n").filter(Boolean).reverse();
    for (const sha of commits) {
      inspected++;
      if (WAIVER.test(git(["log", "-1", "--format=%B", sha]))) continue;
      const edits = englishEdits(
        parse(gitOrNull(["show", `${sha}^:${enPath}`]) ?? "", "En"),
        parse(gitOrNull(["show", `${sha}:${enPath}`]) ?? "", "En"),
      );
      if (!edits.length) continue;
      const subject = git(["log", "-1", "--format=%s", sha]).trim();
      for (const loc of LOCALES) {
        const sibPath = `${DIR}/${area}.${loc}.ts`;
        const sibBefore = gitOrNull(["show", `${sha}^:${sibPath}`]);
        const sibAfter = gitOrNull(["show", `${sha}:${sibPath}`]);
        if (sibBefore === null || sibAfter === null) continue; // sibling did not exist yet
        const suffix = loc[0].toUpperCase() + loc[1];
        const pb = parse(sibBefore, suffix);
        const pa = parse(sibAfter, suffix);
        for (const e of edits) {
          if (!pb.has(e.oldKey)) continue;
          const now = pa.get(e.newKey);
          if (now === undefined) continue; // key gone in this locale; the type check owns that
          if (now === pb.get(e.oldKey))
            problems.push({ area, loc, sha: sha.slice(0, 8), subject, ...e, locale: now });
        }
      }
    }
  }
  return { problems, inspected };
}

function main() {
  if (gitOrNull(["rev-parse", "--git-dir"]) === null) {
    // We land here when this run proves nothing: an export with no history, or a worktree
    // whose recorded gitdir is unreachable AND whose real one findGitDir() could not derive.
    // (The common container case — a worktree whose .git file records the HOST path — is
    // handled by findGitDir(); reaching this point means even that failed.)
    console.log(
      "i18n-locale-drift: SKIP -- no usable git history from " +
        REPO +
        "\n  This check is INERT here; it did not pass, it could not run." +
        "\n  Run it on the host, or in CI on a normal clone, to actually police locale drift.",
    );
    return 0;
  }
  const explicit = process.argv[2];
  if (!explicit && gitOrNull(["cat-file", "-e", `${BASELINE}^{commit}`]) === null) {
    console.log(`i18n-locale-drift: SKIP (baseline ${BASELINE.slice(0, 8)} not present — shallow clone?)`);
    return 0;
  }
  const range = explicit ?? `${BASELINE}..HEAD`;
  const result = run(range);
  if (result === null) {
    console.log("i18n-locale-drift: SKIP (git log failed)");
    return 0;
  }
  const { problems, inspected } = result;
  if (!problems.length) {
    console.log(`i18n-locale-drift: OK (${inspected} commit/area pair(s) inspected over ${range})`);
    return 0;
  }
  console.error(`\ni18n-locale-drift: FAIL — ${problems.length} stale translation(s) over ${range}\n`);
  const groups = new Map();
  for (const p of problems) {
    const id = `${p.sha}\u0000${p.area}\u0000${p.oldKey}\u0000${p.newKey}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(p);
  }
  for (const members of groups.values()) {
    const p = members[0];
    console.error(`${p.sha} ${p.subject}`);
    console.error(`  ${p.area}: ${p.oldKey}${p.newKey === p.oldKey ? "" : ` -> ${p.newKey}`}`);
    console.error(`    English was: ${JSON.stringify(p.from)}`);
    console.error(`    English now: ${JSON.stringify(p.to)}`);
    for (const m of members) console.error(`    ${m.loc} still: ${JSON.stringify(m.locale)}`);
    console.error("");
  }
  console.error(
    "\nEach locale above still holds a translation of the OLD English wording.\n" +
      "Retranslate it in apps/web/src/lib/i18n/strings/<area>.<locale>.ts, or — only if the\n" +
      "English edit truly needs no translation change — add the trailer 'i18n-locale-drift: ok'\n" +
      "to the commit message.\n",
  );
  return 1;
}

process.exit(main());
