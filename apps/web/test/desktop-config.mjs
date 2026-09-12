// Guard: the desktop packaging config and the release workflow must agree, and must agree with
// where the web build actually lands.
//
// Three ways this drifts silently, none of which any other gate can see:
//
//   1. The workflow matrix grows a target the packager does not build (or loses one it does),
//      so a release ships with an arch missing and the failure is an absent asset nobody
//      notices until a user asks for it.
//   2. `stage-web.mjs` copies from a path Vite no longer writes to, or into a path
//      electron-builder no longer packages, so the app ships with no web build inside it.
//   3. The `main` entry disappears or is renamed, which Electron reports only at runtime.
//
// CI cannot be run from here, so this is the most that can be checked without launching it.
// Like `conformance-counts.mjs` and `artboard-index.mjs`, it exits non-zero if it cannot
// actually perform its check rather than printing a green line it has not earned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const DESKTOP = path.join(REPO, "desktop");
const WORKFLOW = path.join(REPO, ".github/workflows/release-desktop.yml");

let failures = 0;
const fail = (msg) => {
  console.error(`  FAIL ${msg}`);
  failures++;
};
const need = (cond, msg) => {
  if (!cond) fail(msg);
};

function die(msg) {
  console.error(`desktop-config: cannot run -- ${msg}`);
  process.exit(1);
}

// --- inputs -------------------------------------------------------------------------------
if (!fs.existsSync(DESKTOP)) die(`no desktop package at ${path.relative(REPO, DESKTOP)}`);
if (!fs.existsSync(WORKFLOW)) die(`no release workflow at ${path.relative(REPO, WORKFLOW)}`);

const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf8"));
const build = pkg.build;
if (!build) die("desktop/package.json has no `build` block for electron-builder");

const workflow = fs.readFileSync(WORKFLOW, "utf8");
const stage = fs.readFileSync(path.join(DESKTOP, "scripts/stage-web.mjs"), "utf8");
const viteConfig = fs.readFileSync(path.join(REPO, "apps/web/vite.config.ts"), "utf8");

// --- 1. the entry point exists ---------------------------------------------------------------
need(typeof pkg.main === "string", "desktop/package.json has no `main`");
if (typeof pkg.main === "string") {
  need(
    fs.existsSync(path.join(DESKTOP, pkg.main)),
    `\`main\` points at ${pkg.main}, which does not exist`,
  );
}

// --- 2. the web build path is the one Vite writes --------------------------------------------
// `apps/web/vite.config.ts` sets no `build.outDir`, so Vite's default `dist` beside the config
// is the output -- the same path `deploy-pages.yml` uploads. If someone adds an outDir, the
// staging script's hardcoded source is wrong and this must say so.
need(
  !/\boutDir\s*:/.test(viteConfig),
  "apps/web/vite.config.ts now sets build.outDir -- desktop/scripts/stage-web.mjs still copies from apps/web/dist",
);
need(
  /path\.join\(REPO,\s*"apps",\s*"web",\s*"dist"\)/.test(stage),
  "stage-web.mjs no longer copies from apps/web/dist",
);

// The staged destination must be inside something electron-builder packages.
const destMatch = stage.match(/const DEST = path\.join\(DESKTOP,\s*([^)]+)\)/);
need(destMatch !== null, "stage-web.mjs has no recognisable DEST");
if (destMatch) {
  const dest = destMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .join("/");
  const files = Array.isArray(build.files) ? build.files : [];
  need(
    files.some((f) => f.startsWith(dest)),
    `stage-web.mjs writes to ${dest}, which no entry in electron-builder \`files\` (${files.join(", ")}) packages`,
  );
}

// --- 3. the matrix and the packager agree on every target ------------------------------------
// The workflow's matrix entries are a fixed shape we control. Parse them narrowly and refuse to
// pass if none are found, rather than silently checking nothing.
const matrix = [...workflow.matchAll(/- runner:\s*(\S+)\s*\n\s*platform:\s*(\S+)\s*\n\s*arch:\s*(\S+)/g)].map(
  (m) => ({ runner: m[1], platform: m[2], arch: m[3] }),
);
if (matrix.length === 0) die("found no matrix entries in the release workflow");

const declared = new Set();
for (const platform of ["win", "mac", "linux"]) {
  for (const t of build[platform]?.target ?? []) {
    for (const arch of t.arch ?? []) declared.add(`${platform}/${arch}`);
  }
}
if (declared.size === 0) die("desktop/package.json declares no build targets");

for (const { platform, arch, runner } of matrix) {
  need(
    declared.has(`${platform}/${arch}`),
    `the workflow builds ${platform}/${arch} on ${runner}, which desktop/package.json does not declare`,
  );
}
for (const pair of declared) {
  need(
    matrix.some(({ platform, arch }) => `${platform}/${arch}` === pair),
    `desktop/package.json declares ${pair}, which no workflow matrix leg builds`,
  );
}

// Each leg must name its own arch on the command line: `electron-builder --linux` alone honours
// every arch in the config, so an x64 runner would attempt the arm64 build too and the whole
// point of using native runners would be lost.
need(
  /electron-builder --\$\{\{ matrix\.platform \}\} --\$\{\{ matrix\.arch \}\}/.test(workflow),
  "the packaging step does not pass the matrix arch, so each leg would build every declared arch",
);

// --- 4. the two packages agree on a real version ----------------------------------------------
// `artifactName` above interpolates ${version}, so desktop/package.json's copy is what a release
// asset is called, while apps/web/package.json's copy is what `vite.config.ts` bakes into
// __APP_VERSION__ and the Details pane prints. Nothing else ties them together, so a bump to one
// alone ships a download whose filename disagrees with the version the app reports.
//
// 0.0.0 is rejected outright rather than merely compared: both packages sat at it, which is why
// Details could not draw an app version at all, and two matching placeholders would pass an
// equality check while still being no version.
const webPkg = JSON.parse(fs.readFileSync(path.join(REPO, "apps/web/package.json"), "utf8"));
need(
  typeof pkg.version === "string" && pkg.version !== "0.0.0",
  `desktop/package.json version is ${JSON.stringify(pkg.version)} -- a release asset would be named after a placeholder`,
);
need(
  typeof webPkg.version === "string" && webPkg.version !== "0.0.0",
  `apps/web/package.json version is ${JSON.stringify(webPkg.version)} -- the Details pane would print a placeholder as a fact`,
);
need(
  pkg.version === webPkg.version,
  `desktop/package.json is ${pkg.version} but apps/web/package.json is ${webPkg.version} -- the download filename and the version the app reports would disagree`,
);

// The version only reaches the bundle if vite.config.ts actually defines it from the package.
need(
  /__APP_VERSION__:\s*JSON\.stringify\(version\)/.test(viteConfig),
  "apps/web/vite.config.ts no longer defines __APP_VERSION__ from the package version, so the app would report no version at all",
);

// --- report ----------------------------------------------------------------------------------
if (failures > 0) {
  console.error(`desktop-config: ${failures} problem(s)`);
  process.exit(1);
}
console.log(
  `desktop-config: OK -- ${matrix.length} matrix leg(s) match ${declared.size} declared target(s), web build staged from apps/web/dist`,
);
