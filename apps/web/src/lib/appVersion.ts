// The version of this build of the app.
//
// VERSION IS A BUILD CONSTANT, not a runtime lookup. `vite.config.ts` reads it out of
// `apps/web/package.json` and defines `__APP_VERSION__` from it, the same shape
// `lib/storageScope.ts` uses for `__STORAGE_SCOPE__`. Importing `package.json` into the bundle
// instead would pull its scripts and dependency list in with it for one string.
//
// The fallback is `null`, never a made-up number. A node suite and a raw `svelte-check` both
// evaluate this module with nothing defined, and Details would rather draw its unknown value
// than assert a version this build does not have. That is the same rule the pane applies to the
// external-flash part number: no data, no claim.

declare const __APP_VERSION__: string | undefined;

/** This build's version, or `null` where the bundle was not built by Vite. */
export const APP_VERSION: string | null = (() => {
  try {
    if (typeof __APP_VERSION__ === "string" && __APP_VERSION__ !== "") return __APP_VERSION__;
  } catch {
    /* not defined (node suites, svelte-check) -> no claim */
  }
  return null;
})();
