/**
 * Guards the "device is locked" copy and the separator ban.
 *
 * Two things this pins:
 *
 * 1. Unlocking IS something this app does, and the copy has to say so. This guard has now
 *    been inverted twice, which is the point of keeping it.
 *
 *    Round one: every locale promised unlocking "happens automatically during Easy setup's
 *    backup step" while `unlock()` was `notImplemented` -- a flat lie about the hardware. The
 *    fix was to name gnwmanager, the tool that really did it, and never claim it was automatic.
 *
 *    Round two (now): `unlock()` is implemented and every write flow calls it, so the copy
 *    pointing at gnwmanager became the lie -- it sends the user to another tool for something
 *    this one does unasked. So the ban is REVERSED: locked copy must NOT name gnwmanager, and
 *    must not describe unlocking as a manual step the user performs elsewhere.
 *
 *    Round three: Guided Setup stopped refusing a locked device altogether, so its locked copy
 *    was deleted rather than reworded. Section 4 is inverted to match -- it now requires the
 *    ABSENCE of that copy, and 4b requires the chooser not to branch on `locked` at all. See
 *    the comment there for why inverting beat deleting.
 *
 *    What did not change across all three rounds is the thing worth guarding: the copy must
 *    never soften what unlocking costs. Clearing RDP mass-erases both flashes and a locked
 *    device's firmware cannot be read first, so the destructive prompt's body has to say the
 *    original is gone. That prompt (section 3b) is now the ONLY place the user is told, which
 *    makes it more load-bearing than when Guided Setup said it too, not less.
 *
 * 2. `·` (in any encoding: literal, `·`, `&middot;`) and the em-dash are banned in
 *    user-visible copy. Both survived earlier sweeps -- the escaped and entity forms
 *    because every sweep grepped the literal character.
 *
 * The banned-character scan runs over STRING LITERALS ONLY for `.ts` and over
 * comment-stripped markup for `.svelte`. Developer comments legitimately discuss the
 * `·` glyph (AddSource.svelte:112 quotes the artboard; :338 explains the ban itself), so
 * a naive whole-file regex would fail against correct code -- the classic guard that
 * matches the very thing it guards.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Every locale on disk, English first, derived once -- see test/locales.mjs.
import { LOCALE_SUFFIXES as LOCALES, latinEquivalentLength } from "./locales.mjs";
let checks = 0;
const fail = (m) => { console.error(`locked-copy: FAIL ${m}`); process.exit(1); };
const ok = () => { checks++; };

const read = (rel) => readFileSync(resolve(root, rel), "utf8");

/** Scan TS/JS: returns {strings: [{line, raw, text}], code: string-with-comments-and-strings-removed}. */
function scanTs(src) {
  const strings = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c, start = line; let raw = ""; i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") { raw += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === "\n") line++;
        raw += src[i]; i++;
      }
      i++;
      strings.push({ line: start, raw, text: raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) });
      continue;
    }
    i++;
  }
  return strings;
}

/** Strip `//`, `/* *\/` and `<!-- -->` comments from svelte markup, keeping line count. */
function stripSvelteComments(src) {
  let out = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/^(\s*)\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/(\s)\*\s.*$/gm, (m, s) => s + m.slice(1).replace(/[^\n]/g, " "));
  return out;
}

const BANNED = [
  { name: "middot", re: /·/ },
  { name: "&middot; entity", re: /&middot;/ },
  { name: "em-dash", re: /—/ },
];

// --- 1. banned characters in firmwareSetup* string values -------------------
for (const loc of LOCALES) {
  const rel = `src/lib/i18n/strings/firmwareSetup${loc}.ts`;
  for (const s of scanTs(read(rel))) {
    for (const b of BANNED) {
      if (b.re.test(s.text)) fail(`${rel}:${s.line} user-visible string contains ${b.name}: ${JSON.stringify(s.text.slice(0, 90))}`);
    }
  }
  ok();
}

// --- 2. banned characters in AddSource.svelte markup -----------------------
{
  const rel = "src/lib/ui/AddSource.svelte";
  const stripped = stripSvelteComments(read(rel));
  stripped.split("\n").forEach((l, n) => {
    for (const b of BANNED) {
      if (b.re.test(l)) fail(`${rel}:${n + 1} markup contains ${b.name}: ${JSON.stringify(l.trim().slice(0, 90))}`);
    }
  });
  // and the real separator element must still be there (3 sites)
  const dots = (read(rel).match(/<span class="sep"/g) || []).length;
  if (dots !== 3) fail(`${rel} expected 3 <span class="sep"> separators, found ${dots}`);
  if (!/\.sep\s*\{/.test(read(rel))) fail(`${rel} .sep separator has no CSS rule`);
  ok();
}

// --- 3. locked copy no longer sends anyone to gnwmanager ------------------
const LOCKED_KEYS = ["lockedNotice", "lockedCannotBackUp", "errDeviceLocked", "unlockModalBody"];

for (const loc of LOCALES) {
  const rel = `src/lib/i18n/strings/firmwareSetup${loc}.ts`;
  const src = read(rel);
  let found = 0;
  for (const key of LOCKED_KEYS) {
    const re = new RegExp(`${key}:\\s*("(?:[^"\\\\]|\\\\.)*")`, "g");
    let m;
    while ((m = re.exec(src))) {
      found++;
      const val = JSON.parse(m[1]);
      const at = `${rel}:${src.slice(0, m.index).split("\n").length}`;
      // The inverted ban. This tool unlocks the device itself now, so naming another tool
      // here is the new version of the old lie.
      if (/gnwmanager/.test(val)) fail(`${at} ${key} still sends the user to gnwmanager: ${JSON.stringify(val)}`);
    }
  }
  // 3 lockedNotice sites (dump/flash/erase) + lockedCannotBackUp + errDeviceLocked + the
  // destructive prompt's body.
  if (found !== 6) fail(`${rel} expected 6 locked-copy values, found ${found}`);
  ok();
}

// --- 3b. the destructive prompt still says the firmware is gone -----------
// The one prompt that survives automatic unlocking is the only place the user is told that
// this unit's original firmware cannot be recovered. Softening it to "this will unlock your
// device" would be true and useless. Each locale states the loss in its own words, so this
// checks LENGTH and distinctness rather than pattern-matching seven languages: a one-clause
// reassurance cannot carry the fact.
for (const loc of LOCALES) {
  const rel = `src/lib/i18n/strings/firmwareSetup${loc}.ts`;
  const m = /unlockModalBody:\s*("(?:[^"\\]|\\.)*")/.exec(read(rel));
  if (!m) fail(`${rel} has no unlockModalBody -- the destructive prompt must exist`);
  const val = JSON.parse(m[1]);
  // The shortest honest version of this in any locale is well over 60 characters -- measured in
  // LATIN-EQUIVALENT characters, because a Han ideograph carries a whole morpheme and a faithful
  // Chinese rendering of the same facts is about a third the length. See locales.mjs.
  if (latinEquivalentLength(val) < 60)
    fail(`${rel} unlockModalBody is too short to state the loss: ${JSON.stringify(val)} ` +
         `(${latinEquivalentLength(val)} latin-equivalent chars)`);
  ok();
}

// --- 4. Guided Setup has NO locked copy, because it does not refuse a locked device -------
//
// THIS SECTION IS INVERTED FROM WHAT IT USED TO CHECK, and the inversion is the record of a
// third round. It used to require `lockedHow` in every locale and forbid it naming gnwmanager.
// The chooser that displayed it is gone: a locked device now draws the same three cards as any
// other, and unlocking happens inside the Backup phase without a prompt. The owner: "WE DON'T
// CARE! We unlock the device if it is locked! The user is not explicitly prompted. Unlocking is
// an inherent part of the Backup phase."
//
// So the fact worth guarding flipped with it. Requiring copy that nothing renders would pin
// dead strings; requiring its ABSENCE pins the behaviour, because reinstating the wall means
// reinstating the copy and this fails on the first locale that grows it back.
//
// The substantive protection did NOT move: section 3b still requires the destructive prompt to
// state that the original firmware is gone, and that prompt is the one place the user is ever
// told. It survived automatic unlocking precisely because a locked device's flash cannot be read
// first, so there is nothing to back up and the loss is real. Deleting section 4 outright would
// have been the tempting move and would have left nothing watching Guided Setup.
for (const loc of LOCALES) {
  const rel = `src/lib/i18n/strings/wizard${loc}.ts`;
  const src = read(rel);
  for (const key of ["lockedTitle", "lockedBody", "lockedHow"]) {
    if (new RegExp(`\\b${key}\\s*:`).test(src))
      fail(`${rel} still carries ${key}: Guided Setup no longer refuses a locked device, so copy explaining the refusal is either dead or a wall being rebuilt`);
  }
  ok();
}

// --- 4b. and the chooser does not branch on `locked` ----------------------
// The strings are the symptom; this is the thing itself. A `kind === "locked"` test in the
// chooser is how the wall gets rebuilt, with or without new copy.
{
  const rel = "src/lib/views/Wizard.svelte";
  const src = read(rel)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  if (/"locked"/.test(src))
    fail(`${rel} tests for the "locked" device kind: unlocking belongs to engine/unlockGate.ts, inside the Backup phase, and the chooser has no opinion about it`);
  ok();
}

// --- 5. the flasher really CAN unlock (the reason all of the above) --------
// This check used to assert the opposite, and failing it is what forced the copy above to be
// rewritten. It now guards the other direction: if `unlock()` ever goes back to being a stub,
// every string above becomes a promise the app cannot keep, and this says so before a user
// finds out by clicking Flash.
{
  const rel = "../../packages/gnw-flasher/src/index.ts";
  const src = read(rel);
  if (/async unlock\(\)[^{]*\{\s*notImplemented\("unlock"\)/.test(src))
    fail(`${rel} unlock() is a stub again -- the locked copy above promises this app unlocks the device`);
  if (!/async unlock\(\)/.test(src)) fail(`${rel} has no unlock() at all`);
  // lock() stays unimplemented on purpose (the owner: "We don't care about locking because
  // there's no benefit to it"), and its comment is the record of that. If it ever grows a real
  // body, that decision was reversed and the copy above deserves another read.
  if (!/async lock\(\)[^{]*\{\s*notImplemented\("lock"\)/.test(src))
    fail(`${rel} lock() is no longer a deliberate stub -- re-read the locked copy above`);
  ok();
}

// --- 6. no non-English file left an English locked string verbatim ---------
{
  const enSrc = read("src/lib/i18n/strings/firmwareSetup.ts");
  const grab = (src) => {
    const out = [];
    for (const key of LOCKED_KEYS) {
      const re = new RegExp(`${key}:\\s*("(?:[^"\\\\]|\\\\.)*")`, "g");
      let m;
      while ((m = re.exec(src))) out.push(JSON.parse(m[1]));
    }
    return out;
  };
  const en = grab(enSrc);
  for (const loc of LOCALES.filter((l) => l)) {
    const rel = `src/lib/i18n/strings/firmwareSetup${loc}.ts`;
    const vals = grab(read(rel));
    vals.forEach((v, i) => {
      if (v === en[i]) fail(`${rel} locked string #${i} is the English text verbatim: ${JSON.stringify(v)}`);
    });
    ok();
  }
}

console.log(`locked-copy: ${checks} checks passed`);
