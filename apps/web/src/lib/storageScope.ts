// WHICH BUILD OWNS WHICH BYTES.
//
// A `/wip/` deployment on GitHub Pages is the SAME ORIGIN as production: same `localStorage`,
// same IndexedDB, same OPFS. Without a scope a tester on the wip build reads and writes the
// production user's registrations, directory handles, cover pointers and cached bytes — and
// runs the wip build's storage migrations over them. `sources/cacheMigrations.ts` and
// `storage-migration` exist because migrations have already run once in this project; a newer
// one executing against production data is destructive and not reversible.
//
// THE RULE. Every persisted name in this app goes through `scoped()`. Production builds with an
// empty scope and its names are therefore BYTE-IDENTICAL to what they have always been — no
// rename, no migration, no orphaned data for anybody already using the app. Any other build
// passes a non-empty scope and gets its own private set.
//
// The separator is `-` rather than `#` or `:` because the same helper names three different
// kinds of thing: `localStorage` keys, IndexedDB database names, and an OPFS directory. A
// hyphen is unambiguously legal in all three, so one rule covers all of them and there is no
// per-store escaping to get wrong later.
//
// SCOPE IS A BUILD CONSTANT, not a runtime setting. `vite.config.ts` defines
// `__STORAGE_SCOPE__` from `PUBLIC_STORAGE_SCOPE` at build time, so a bundle cannot be talked
// into reading another build's data, and production dead-code-eliminates the branch.

declare const __STORAGE_SCOPE__: string | undefined;

/** The scope this bundle was built with. `""` for production. */
export const STORAGE_SCOPE: string = (() => {
  try {
    if (typeof __STORAGE_SCOPE__ === "string") return __STORAGE_SCOPE__;
  } catch {
    /* not defined (node suites, dev without the flag) -> production names */
  }
  return "";
})();

/**
 * The name this build should use for a persisted thing.
 *
 * `scope` is a parameter rather than a closed-over constant ONLY so a test can drive both
 * builds in one process; production callers pass one argument and get the build's own scope.
 */
export function scoped(name: string, scope: string = STORAGE_SCOPE): string {
  return scope ? `${name}-${scope}` : name;
}

/** True when this build keeps its own private storage, i.e. it is not production. */
export function isScopedBuild(scope: string = STORAGE_SCOPE): boolean {
  return scope !== "";
}
