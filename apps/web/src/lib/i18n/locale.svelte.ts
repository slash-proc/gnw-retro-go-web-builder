// Locale selection. Mirrors theme.svelte.ts's pattern exactly: a class with $state,
// initialized from localStorage, a set() method that persists, exported singleton.
//
// Supported locales beyond en/de are added incrementally: each locale's translation lives in
// its own set of files (apps/web/src/lib/i18n/strings/<area>.<locale>.ts, one per area file,
// never editing the existing en/de content) assembled into apps/web/src/lib/i18n/<locale>.ts
// (mirrors en.ts/de.ts). `registry` below maps a Locale to its assembled Strings — a locale
// listed in SUPPORTED_LOCALES but not yet present in `registry` transparently falls back to
// English (see `t` below) rather than crashing, so this file can list the full target locale
// set before every translation has actually landed.
import { en } from "./en.js";
import { de } from "./de.js";
import type { Strings } from "./en.js";

export type Locale =
  | "en"
  | "de"
  | "fr"
  | "es"
  | "pl"
  | "nl"
  | "pt"
  | "ja"
  | "ko"
  | "zh-Hans"
  | "zh-Hant"
  | "ru"
  | "uk"
  | "no";

/** Every locale the UI offers a switcher option for, in display order. Label is the
 *  language's own native name (never English), so a user looking for their language can
 *  always find it regardless of what locale is currently active. */
export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "pl", label: "Polski" },
  { code: "nl", label: "Nederlands" },
  { code: "pt", label: "Português" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "zh-Hant", label: "繁體中文" },
  { code: "ru", label: "Русский" },
  { code: "uk", label: "Українська" },
  { code: "no", label: "Norsk" },
];

// Populated incrementally as each locale's assembler file (apps/web/src/lib/i18n/<locale>.ts)
// lands — see the module-level `registerLocale` calls at the bottom of each assembler file
// once it exists. Do NOT hand-edit this object directly.
const registry: Partial<Record<Locale, Strings>> = { en, de };

/** Called once by each locale's assembler module (apps/web/src/lib/i18n/<locale>.ts) at
 *  import time to register itself. Keeps locale.svelte.ts from needing an import edit (and
 *  therefore a merge/collision risk) every time a new locale's assembler is wired in — instead
 *  each new assembler file is the only thing that needs to import this. */
export function registerLocale(code: Locale, strings: Strings): void {
  registry[code] = strings;
}

/** Whether a locale has an actual translation registered (vs. just being a planned future
 *  entry in SUPPORTED_LOCALES) — used to hide not-yet-translated locales from the switcher UI
 *  rather than showing an option that silently falls back to English. Safe to call any time
 *  after the app's registerLocales.ts side-effect imports have run (i.e. any time a component
 *  is actually rendering). */
export function isRegistered(code: Locale): boolean {
  return code in registry;
}

function isLocale(v: string | null): v is Locale {
  return !!v && SUPPORTED_LOCALES.some((l) => l.code === v);
}

function matchBrowserLocale(): Locale {
  const nav = navigator.language; // e.g. "en-US", "zh-TW", "pt-BR"
  const lower = nav.toLowerCase();
  if (lower.startsWith("zh")) {
    // Traditional in Taiwan/Hong Kong/Macau, Simplified everywhere else zh is reported.
    return lower.includes("tw") || lower.includes("hk") || lower.includes("mo") ? "zh-Hant" : "zh-Hans";
  }
  const prefix = lower.split("-")[0];
  const match = SUPPORTED_LOCALES.find((l) => l.code.toLowerCase().split("-")[0] === prefix);
  return match?.code ?? "en";
}

function initial(): Locale {
  const saved = localStorage.getItem("locale");
  if (isLocale(saved)) return saved;
  return matchBrowserLocale();
}

class LocaleStore {
  current = $state<Locale>(initial());

  set(l: Locale): void {
    this.current = l;
    localStorage.setItem("locale", l);
  }
  toggle(): void {
    // Legacy EN/DE quick-toggle, kept only for any call site still using it — the header UI
    // itself now uses a full <select> (see DeviceHeader.svelte) since there are 13+ locales.
    this.set(this.current === "en" ? "de" : "en");
  }
  // Reactive string-table getter — evaluated fresh on every access (not cached at import
  // time), so components using `locale.t.foo.bar` update live when the locale changes.
  // Falls back to English for any SUPPORTED_LOCALES entry not yet registered.
  get t(): Strings {
    return registry[this.current] ?? en;
  }
}

export const locale = new LocaleStore();
