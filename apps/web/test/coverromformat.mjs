#!/usr/bin/env node
/**
 * Cover scraping uses the full suffixes declared by the active core. A compound ROM extension
 * ending in an image suffix is a ROM when the core says it is; an ordinary PNG stays artwork.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../src/lib/screenscraper/scanner.js");
const result = await build({
  entryPoints: [source], bundle: true, write: false, format: "esm", platform: "neutral",
  loader: { ".json": "json" },
});
const { buildPlan } = await import(
  "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")
);
const filenameBundle = await build({
  entryPoints: [join(here, "../src/lib/filename.ts")],
  bundle: true, write: false, format: "esm", platform: "neutral",
});
const { filenameExtension, stripFilenameExtension } = await import(
  "data:text/javascript;base64," + Buffer.from(filenameBundle.outputFiles[0].text).toString("base64")
);
const coverPlanBundle = await build({
  entryPoints: [join(here, "../src/lib/sources/coverPlan.ts")],
  bundle: true, write: false, format: "esm", platform: "neutral",
});
const { coverTargetForGame } = await import(
  "data:text/javascript;base64," + Buffer.from(coverPlanBundle.outputFiles[0].text).toString("base64")
);

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const eq = (a, b, message) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${message}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};
const extensions = [".p8", ".p8.png"];
const file = (name, path, gnwExtensions = extensions) => ({ name, webkitRelativePath: path, gnwExtensions });

check("core-declared PICO-8 suffixes match complete filenames", () => {
  eq(filenameExtension("celeste.p8", extensions), ".p8", "single suffix");
  eq(filenameExtension("celeste2.p8.png", extensions), ".p8.png", "compound suffix");
  eq(stripFilenameExtension("celeste2.p8.png", extensions), "celeste2", "full title suffix");
  eq(stripFilenameExtension("celeste.p8", extensions), stripFilenameExtension("celeste.p8.png", extensions), "both PICO-8 formats share a cover stem");
});

check("declared `.p8.png` enters the scrape plan even though generic `.png` is excluded", () => {
  const cart = file("celeste2.p8.png", "root/pico8/celeste2.p8.png");
  const plan = buildPlan([cart]);
  eq(plan.roms.length, 1, "PICO-8 cart survives ROM filtering and skip-existing");
  eq(plan.roms[0].systemeid, 234, "the pico8 folder resolves to ScreenScraper system 234");
  eq(plan.roms[0].extensions, extensions, "core-declared suffixes reach the lookup row");
});

check("an ordinary PNG in the same folder remains artwork, not a ROM", () => {
  const artwork = file("cover.png", "root/pico8/cover.png");
  const plan = buildPlan([artwork]);
  eq(plan.roms.length, 0, "generic PNG is still excluded");
});

check("the install cover path strips the complete core-declared ROM suffix", () => {
  const target = coverTargetForGame({
    key: "pico8/celeste.p8.png",
    outputKey: "pico8/celeste.p8.png",
    owner: "pico8/celeste.p8.png",
    sourcePath: "pico8/celeste.png",
    declaredExtensions: extensions,
  });
  eq(target.devicePath, "covers/pico8/celeste.p8.img", "compound extension follows firmware's final-dot cover rule");
  const singleSuffixTarget = coverTargetForGame({
    key: "pico8/celeste.p8",
    outputKey: "pico8/celeste.p8",
    owner: "pico8/celeste.p8",
    sourcePath: "pico8/celeste.png",
    declaredExtensions: extensions,
  });
  eq(singleSuffixTarget.devicePath, "covers/pico8/celeste.img", "single extension follows firmware's final-dot cover rule");
});

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`coverromformat: ${failures.length ? `${failures.length} failed, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
