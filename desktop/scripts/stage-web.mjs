/**
 * Copy the built web app into the desktop package, and refuse to do it wrong.
 *
 * The desktop shell loads `index.html` over `file://`, so every asset URL in it must be
 * RELATIVE. Vite emits absolute URLs (`/assets/index-abc.js`) unless `base` says otherwise, and
 * an absolute URL under `file://` resolves to the filesystem root -- the app opens as a white
 * page with 404s in a console nobody is watching. That is the exact shape of the blank-page bug
 * `CLAUDE.md` records shipping once already, so this script asserts the base rather than
 * trusting whoever invoked the build to have set `PUBLIC_BASE=./`.
 *
 * Run from the repo root or anywhere; paths are resolved from this file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO = path.resolve(DESKTOP, "..");

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
    `the web build has ABSOLUTE asset URLs and will load as a blank page over file://:\n` +
      absolute.map((u) => `  ${u}`).join("\n") +
      `\nbuild it with PUBLIC_BASE=./ for the desktop shell`,
  );
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });

let files = 0;
for (const entry of fs.readdirSync(DEST, { recursive: true, withFileTypes: true })) {
  if (entry.isFile()) files++;
}
console.log(`stage-web: ${files} file(s) -> ${path.relative(REPO, DEST)}`);
