// Light/dark theme. Defaults from prefers-color-scheme, persists the choice,
// applies it as data-theme on <html> (tokens.css keys off it). Stored as `gnw:theme`;
// the pre-namespace `theme` key is adopted once and removed (see persist.ts).
import { loadRawMigrated, saveRaw } from "./persist.js";
type Mode = "light" | "dark";

function initial(): Mode {
  const saved = loadRawMigrated("theme", "theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

class ThemeStore {
  mode = $state<Mode>(initial());

  set(m: Mode): void {
    this.mode = m;
    document.documentElement.setAttribute("data-theme", m);
    saveRaw("theme", m);
  }
  toggle(): void {
    this.set(this.mode === "light" ? "dark" : "light");
  }
}

export const theme = new ThemeStore();
theme.set(theme.mode); // apply on load
