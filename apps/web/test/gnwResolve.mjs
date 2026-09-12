// Resolve `@gnw/*` to THIS checkout's built packages.
//
// These suites keep the workspace packages `external` so the engine code under test runs
// against the real built `dist/`, resolved by node through a `node_modules` symlink dropped
// into the esbuild outdir. In a git WORKTREE that symlink is a trap: the worktree's
// `node_modules` points at the main clone's, whose `@gnw/*` entries point back into the MAIN
// clone's `packages/` — so the suite compiles the worktree's TypeScript and then runs it
// against a DIFFERENT checkout's `dist/`. Adding an export in a worktree therefore fails with
// "does not provide an export named …" even though `tsc -b` just built it right there.
//
// This plugin keeps the imports external (no re-bundling, so `instanceof` identity across the
// package boundary still holds) but rewrites the bare specifier to an absolute file URL under
// this checkout, taking node's resolver out of the loop. Bare `@gnw/<pkg>` only — subpath
// imports (`@gnw/gnw-flasher/blobs/*?url`) are left to whichever plugin handles them.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @param {string} testDir - the `apps/web/test` directory (dirname of the caller's URL). */
export function gnwResolve(testDir) {
  const packages = join(testDir, "../../../packages");
  return {
    name: "gnw-local-packages",
    setup(b) {
      b.onResolve({ filter: /^@gnw\/[^/]+$/ }, (a) => ({
        path: pathToFileURL(join(packages, a.path.slice("@gnw/".length), "dist/index.js")).href,
        external: true,
      }));
    },
  };
}

/** Convenience for `gnwResolve(dirname(fileURLToPath(import.meta.url)))`. */
export const gnwResolveFor = (metaUrl) => gnwResolve(dirname(fileURLToPath(metaUrl)));

/**
 * Dynamic-import a workspace package from THIS checkout's `dist/`.
 *
 * The esbuild plugin above only fixes specifiers inside the BUNDLE. A suite that also imports
 * `@gnw/<pkg>` directly at the top level (to grab an error class for `instanceof`, a helper,
 * a constant) goes through NODE's resolver instead — which in a worktree follows the
 * `node_modules` symlink into the MAIN clone. The bundle then holds one copy of the class and
 * the suite another, and `instanceof` is silently false. That is exactly how `flashretry.mjs`
 * kept failing after `gnwResolve` landed. Use this instead of a bare `import("@gnw/...")`.
 *
 * @param {string} metaUrl - the caller's `import.meta.url`.
 * @param {string} pkg     - package name, with or without the `@gnw/` prefix.
 */
export function gnwImport(metaUrl, pkg) {
  const name = pkg.startsWith("@gnw/") ? pkg.slice("@gnw/".length) : pkg;
  const here = dirname(fileURLToPath(metaUrl));
  return import(pathToFileURL(join(here, "../../../packages", name, "dist/index.js")).href);
}
