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
const { carouselAtlasFiles, carouselAtlasCacheSignature, carouselAtlasSignature, carouselAtlasContentFingerprint } = await import(pathToFileURL(join(out, "carouselAtlas.mjs")).href);

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
// Oracle for the persisted format: the previous BigInt algorithm. Include unsigned
// carries, nonzero byte offsets, and Unicode metadata so existing caches stay valid.
function referenceFingerprint(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}
for (const bytes of [new Uint8Array(), new TextEncoder().encode("cover/日本語.png"),
  Uint8Array.from({ length: 65539 }, (_, i) => (i * 73 + 255) & 255).subarray(3)]) {
  if (carouselAtlasContentFingerprint(bytes) !== referenceFingerprint(bytes)) {
    throw new Error("atlas fingerprint must match the persisted FNV-1a oracle");
  }
}
const metadata = [
  { key: "日本語", path: "covers/a.png", size: 123, lastModified: 456 },
  { key: "abc", path: "covers/b.png", size: 321, contentFingerprint: "f00" },
];
const ordered = [...metadata].sort((a, b) => a.key.localeCompare(b.key));
const text = `${sourceId}\n${ordered.map(e => `${e.key}\0${e.path ?? ""}\0${e.size}\0${e.lastModified ?? 0}${e.contentFingerprint === undefined ? "" : `\0${e.contentFingerprint}`}`).join("\n")}`;
if (carouselAtlasSignature(sourceId, metadata) !== referenceFingerprint(new TextEncoder().encode(text))) {
  throw new Error("atlas metadata signature must preserve existing cache identity");
}
console.log("carousel atlas cover selection and cache fingerprints: 9 checks passed");
