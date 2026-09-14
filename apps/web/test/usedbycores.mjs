#!/usr/bin/env node
/**
 * The "Used by" list names the SYSTEMS, one entry each -- not the core, and not the platform.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/usedbycores.mjs'
 *
 * Every core manifest publishes the same target label: `"label": "Game & Watch (Retro-Go SD)"`
 * is a constant in the manifest generator, because it names the PLATFORM the target builds for.
 * Drawing that in the picker gave fourteen identical rows, with no way to tell a Game Boy core
 * from a GBA one. The project name is `manifest.title`, which is what the Sources list already
 * shows and what a user recognises.
 *
 * The function is exported from a `<script module>` block, so it is compiled here with the real
 * Svelte compiler rather than being re-implemented.
 */
import { readFileSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// The rows the store would hold. Shaped like real manifests: the label is the platform and is
// identical across projects, which is the whole point.
const rows = [];
const out = mkdtempSync(join(tmpdir(), "gnw-usedby-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");

// esbuild has no .svelte loader, and the whole component is not needed: `coreOptions` lives in
// the `<script module>` block, which is plain TypeScript. Take that block, replace its store
// imports with the fixtures, and compile it as TS.
const sfc = readFileSync(join(here, "../src/lib/ui/UsedBySelect.svelte"), "utf8");
const mod = sfc.slice(sfc.indexOf(">", sfc.indexOf("<script lang=\"ts\" module>")) + 1, sfc.indexOf("</script>"));
const stubbed = mod
  .replace(/import \{ sources \}[^\n]*\n/, "const sources = { get rows() { return globalThis.__rows; } };\n")
  .replace(/import \{ homebrew \}[^\n]*\n/, "const homebrew = { titles: [] };\n")
  .replace(/import \{ targetKey[^}]*\}[^\n]*\n/, "const targetKey = (repo, id) => `${repo}#${id}`;\nconst OFW_BACKUP_USED_BY_KEY = \"__ofw_backup__\";\n")
  // `isCoreKind` is the real rule (it accepts the pre-rename "emulator" too), so it is inlined
  // from its own module rather than stubbed with a guess. `systemKey`/`targetOf` are the real
  // ones, imported from the compiled module they live in -- the key shape is what is under test
  // here, so restating it would be testing the restatement.
  .replace(/import \{[^}]*\} from "\.\.\/sources\/types\.js";\n/,
    'const isCoreKind = (k) => k === "core" || k === "emulator";\n' +
    'import { BIOS_USED_BY_KEY, systemKey, targetOf } from "KEYS";\n');
// The real key helpers, compiled out of `sources/types.ts`.
const keysJs = (await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/types.ts")],
  bundle: true, format: "esm", write: false, platform: "neutral",
})).outputFiles[0].text;
writeFileSync(join(out, "keys.mjs"), keysJs);

const js = (await esbuild.transform(stubbed.replace('"KEYS"', '"./keys.mjs"'), { loader: "ts", format: "esm" })).code;
writeFileSync(join(out, "opts.mjs"), js);

globalThis.__rows = rows;
const { coreOptions, expandSelection } = await import(pathToFileURL(join(out, "opts.mjs")).href);
const { targetOf } = await import(pathToFileURL(join(out, "keys.mjs")).href);

const PLATFORM = "Game & Watch (Retro-Go SD)"; // the constant every manifest publishes
rows.push(
  { repo: "slash-proc/gba-retro-go-sd", manifest: { title: "gpSP", targets: [
    { id: "gnw-retro-go", kind: "core", label: PLATFORM, systems: [{ id: "gba", longName: "Game Boy Advance" }] },
  ] } },
  // One core, several systems: tgb-dual's real shape. Both are named, because the question the
  // control asks is which consoles belong in this folder.
  { repo: "slash-proc/tgb-dual-retro-go-sd", manifest: { title: "tgb-dual", targets: [
    { id: "gnw-retro-go", kind: "core", label: PLATFORM, systems: [
      { id: "gb", longName: "Game Boy" },
      { id: "gbc", longName: "Game Boy Color" },
    ] },
  ] } },
  { repo: "slash-proc/zelda3-retro-go-sd", manifest: { title: "Zelda 3", targets: [{ id: "gnw-retro-go", kind: "homebrew", label: PLATFORM }] } },
);

check("EVERY system is its own entry -- PCE is not PCECD", () => {
  const labels = coreOptions().map((o) => o.label);
  eq(labels, ["Game Boy", "Game Boy Advance", "Game Boy Color"], "one row per system, alphabetical");
  // ARMED: the platform label really is what the manifests carry, identical across projects, so
  // drawing it would have produced duplicates. Without this the check could pass on any naming.
  assert(rows[0].manifest.targets[0].label === rows[1].manifest.targets[0].label,
    "the fixture's two cores must share a target label, or this proves nothing");
});

check("each system entry carries its own key, so two systems cannot share a checkbox", () => {
  const keys = coreOptions().map((o) => o.key);
  eq(keys, [
    "slash-proc/tgb-dual-retro-go-sd#gnw-retro-go@gb",
    "slash-proc/gba-retro-go-sd#gnw-retro-go@gba",
    "slash-proc/tgb-dual-retro-go-sd#gnw-retro-go@gbc",
  ], "system-scoped keys");
  assert(new Set(keys).size === keys.length, "the keys must be distinct");
});

check("the list is ALPHABETICAL by label, not by the order sources were added", () => {
  const labels = coreOptions().map((o) => o.label);
  eq(labels, [...labels].sort((x, y) => x.localeCompare(y)), "sorted by what the user reads");
  // ARMED: the fixture's insertion order is NOT alphabetical (gpSP's "Game Boy Advance" is
  // added before tgb-dual's "Game Boy"), so an unsorted list cannot pass this by luck.
  const insertion = ["Game Boy Advance", "Game Boy", "Game Boy Color"];
  assert(JSON.stringify(labels) !== JSON.stringify(insertion),
    "the fixture must not already be in order, or this proves nothing");
});

check("a core declaring no systems falls back to its project name, under the target key", () => {
  rows.push({ repo: "slash-proc/odd-retro-go-sd", manifest: { title: "Odd Core", targets: [
    { id: "gnw-retro-go", kind: "core", label: PLATFORM },
  ] } });
  const last = coreOptions().slice(-1)[0];
  eq(last.label, "Odd Core", "the fallback");
  eq(last.key, "slash-proc/odd-retro-go-sd#gnw-retro-go", "a bare target key, having no system");
  rows.pop();
});

check("homebrew is not listed among the cores", () => {
  eq(coreOptions().map((o) => o.key).filter((k) => k.includes("zelda3")), [], "no homebrew key");
});

check("two nameless core targets in one repo stay distinguishable", () => {
  // Only the fallback needs qualifying: two targets that declare systems already read as
  // different consoles, and appending a target id to those would be noise.
  rows.push({
    repo: "slash-proc/multi-retro-go-sd",
    manifest: { title: "Multi", targets: [
      { id: "gnw-retro-go", kind: "core", label: PLATFORM },
      { id: "gnw-retro-go-b", kind: "core", label: PLATFORM },
    ] },
  });
  // Both qualified names are present and distinct. The ORDER between them is the collator's
  // (ICU shifts the bracket, so the `-b` target leads); asserting a hand-guessed order here
  // would be testing the collator rather than the qualifying.
  eq(coreOptions().map((o) => o.label).slice(3).sort(), ["Multi (gnw-retro-go)", "Multi (gnw-retro-go-b)"],
     "qualified by target id");
  rows.pop();
});

check("a row with no manifest falls back rather than drawing nothing", () => {
  rows.push({ repo: "slash-proc/pending", card: { title: "Pending" }, manifest: undefined });
  eq(coreOptions().length, 3, "an unresolved row contributes no core targets");
  rows.pop();
});

// --- The migration -----------------------------------------------------------------------------
//
// `usedBy` is persisted. Rows written before this menu listed systems hold `owner/repo#targetId`
// and there is no error path for getting this wrong: the folder simply stops being associated and
// the user's ROMs quietly stop being filed.

check("a PERSISTED old-shape key still ticks its boxes", () => {
  const stored = ["slash-proc/tgb-dual-retro-go-sd#gnw-retro-go"]; // written by the old build
  const opts = coreOptions();
  eq(expandSelection(stored, opts), [
    "slash-proc/tgb-dual-retro-go-sd#gnw-retro-go@gb",
    "slash-proc/tgb-dual-retro-go-sd#gnw-retro-go@gbc",
  ], "the whole target means every system it declares");
  // ARMED: the stored key is NOT one of the drawn options, which is exactly why it needs
  // expanding -- without it the menu would tick nothing and the folder would read as "Any".
  assert(!opts.some((o) => o.key === stored[0]), "the old key must not be an option, or this proves nothing");
});

check("a legacy key naming a core that is not resolved is KEPT, never dropped", () => {
  eq(expandSelection(["slash-proc/gone#gnw-retro-go"], coreOptions()),
     ["slash-proc/gone#gnw-retro-go"], "an unresolved association survives");
});

check("a system-scoped key is left exactly as stored", () => {
  eq(expandSelection(["slash-proc/tgb-dual-retro-go-sd#gnw-retro-go@gbc"], coreOptions()),
     ["slash-proc/tgb-dual-retro-go-sd#gnw-retro-go@gbc"], "no widening of a deliberate choice");
});

check("targetOf reads an old key as the whole target, which is what keeps folders associated", () => {
  eq(targetOf("slash-proc/tgb#gnw-retro-go@gbc"), "slash-proc/tgb#gnw-retro-go", "system stripped");
  eq(targetOf("slash-proc/tgb#gnw-retro-go"), "slash-proc/tgb#gnw-retro-go", "old shape unchanged");
});

console.log(`\nusedbycores: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
