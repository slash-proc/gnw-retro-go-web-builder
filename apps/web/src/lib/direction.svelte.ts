// Writing direction. Arabic is the app's first right-to-left locale, so `dir` is now a real
// variable rather than the constant `index.html` hardcoded.
//
// DELIBERATELY NOT INSIDE `locale.svelte.ts`. That module is pulled into every offline node
// test that bundles anything importing `util.ts` (formatSize reads the locale for its unit
// suffixes), where there is no `document` — the same reason its `matchBrowserLocale()` guards
// `navigator`. Keeping the DOM write here, behind its own guard, means adding a direction did
// not make the locale store browser-only.
//
// The application point is an `$effect` in App.svelte, not `locale.set()`: the locale can also
// change by any other writer to `locale.current`, and an effect tracks the value rather than
// the one method that happens to assign it today.
import type { Locale } from "./i18n/locale.svelte.js";

/**
 * The locales written right to left.
 *
 * DATA, not a comparison. `code === "ar"` would work today and would be the thing someone has
 * to find and edit when Hebrew, Persian or Urdu lands — and the person adding a locale is
 * exactly the person who will not know this line exists. A set is a place to add a code to.
 */
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["ar"]);

/** Whether this locale reads right to left. */
export function isRtl(code: Locale): boolean {
  return RTL_LOCALES.has(code);
}

/** `"rtl"` or `"ltr"` for a locale, as the `dir` attribute spells it. */
export function directionFor(code: Locale): "rtl" | "ltr" {
  return isRtl(code) ? "rtl" : "ltr";
}

/**
 * Put the direction and the language on `<html>`.
 *
 * Both, not just `dir`: `index.html` ships `lang="en"` and nothing ever updated it, so every
 * locale claimed to be English to a screen reader. They are one concern and they change
 * together, so they are set together.
 *
 * A no-op with no `document`, so a node test importing this module does not have to care.
 */
export function applyDirection(code: Locale): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.setAttribute("dir", directionFor(code));
  el.setAttribute("lang", code);
}
