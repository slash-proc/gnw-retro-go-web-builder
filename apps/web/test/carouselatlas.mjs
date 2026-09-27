#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-carouselatlas-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/carouselAtlas.ts")],
  outfile: join(out, "carouselAtlas.mjs"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "silent",
});
const { carouselAtlasFiles, carouselAtlasCacheSignature } = await import(pathToFileURL(join(out, "carouselAtlas.mjs")).href);

const sourceId = "covers-source";
const owner = "celeste-title";
const lower = "homebrew/celeste.png";
const upper = "homebrew/Celeste.png\u0000duplicate";
const owners = new Map([[`${sourceId}\u0000${lower}`, owner]]);
const origins = new Map([[lower, sourceId], [upper, sourceId]]);
const names = new Map([[owner, "Celeste"]]);
const files = new Map([[lower, new Uint8Array([1])], [upper, new Uint8Array([2])]]);
const conflicts = [];
const selected = carouselAtlasFiles(files, origins, owners, names, new Map(), (key, candidates, chosen) => {
  conflicts.push({ key, candidates, chosen });
});
if (selected.length !== 1 || selected[0].path !== upper || selected[0].file[0] !== 2) {
  throw new Error("the displayed spelling must choose the matching original art");
}
if (conflicts.length !== 1 || conflicts[0].candidates.length !== 2) {
  throw new Error("multiple covers must be reported once per game");
}
const reversed = carouselAtlasFiles(new Map([...files].reverse()), origins, owners, names);
if (reversed[0].path !== upper) throw new Error("scan order must not change the chosen art");
const overridden = carouselAtlasFiles(files, origins, owners, names, new Map([[owner, lower]]));
if (overridden[0].path !== lower) throw new Error("an explicit cover update must take precedence");
const signature = (path) => carouselAtlasCacheSignature(sourceId, [{ key: owner, path, size: 1 }]);
if (signature(lower) === signature(upper)) throw new Error("a changed winner must invalidate the atlas cache");
console.log("carousel atlas cover selection: 5 checks passed");
