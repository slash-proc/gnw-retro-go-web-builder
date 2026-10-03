/**
 * Copy the built web app into the desktop package, and refuse to do it wrong.
 *
 * The desktop shell serves `index.html` from its `gnw://app` origin. Relative asset URLs keep
 * the bundle portable across Electron and web builds and prevent an accidental deployment-base
 * prefix from sending requests to the wrong origin. The script asserts that Vite was built with
 * `PUBLIC_BASE=./` rather than trusting whoever invoked it.
 *
 * Run from the repo root or anywhere; paths are resolved from this file.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO = path.resolve(DESKTOP, "..");
const require = createRequire(import.meta.url);
const { rendererSourceFingerprint } = require(path.join(DESKTOP, "src", "build-contract.js"));

/** Vite's output for `@gnw/web`. `apps/web/vite.config.ts` sets no `build.outDir`, so this is
 *  Vite's default `dist` beside the config, and `deploy-pages.yml` uploads the same path. */
const SRC = path.join(REPO, "apps", "web", "dist");
/** Where `package.json`'s electron-builder `files` picks it up. */
const DEST = path.join(DESKTOP, "build", "web");

function fail(msg) {
  console.error(`stage-web: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(SRC, "index.html"))) {
  fail(`no web build at ${path.relative(REPO, SRC)} -- run \`npm run build --workspace @gnw/web\` first`);
}

const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
// Absolute asset references are the failure this script exists to catch. Match src/href
// attributes that start with a single slash (not `//host`, which is a protocol-relative URL and
// a different mistake, and not `file:` or `https:`).
const absolute = [...html.matchAll(/\b(?:src|href)="(\/(?!\/)[^"]*)"/g)].map((m) => m[1]);
if (absolute.length > 0) {
  fail(
    `the web build has ABSOLUTE asset URLs and will load from the wrong location on gnw://app:\n` +
      absolute.map((u) => `  ${u}`).join("\n") +
      `\nbuild it with PUBLIC_BASE=./ for the desktop shell`,
  );
}

const jsFiles = fs.readdirSync(path.join(SRC, "assets")).filter((name) => name.endsWith(".js"));
if (!jsFiles.some((name) => fs.readFileSync(path.join(SRC, "assets", name), "utf8").includes("gnwDesktopFs"))) {
  fail("renderer bundle has no gnwDesktopFs integration; refusing to launch an outdated Electron build");
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });
fs.writeFileSync(path.join(DEST, "desktop-build.json"), JSON.stringify({
  rendererSourceFingerprint: rendererSourceFingerprint(REPO),
}, null, 2) + "\n");

let files = 0;
for (const entry of fs.readdirSync(DEST, { recursive: true, withFileTypes: true })) {
  if (entry.isFile()) files++;
}
console.log(`stage-web: ${files} file(s) -> ${path.relative(REPO, DEST)}`);
