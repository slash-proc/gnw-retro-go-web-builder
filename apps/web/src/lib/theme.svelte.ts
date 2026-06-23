// Light/dark theme. Defaults from prefers-color-scheme, persists the choice,
// applies it as data-theme on <html> (tokens.css keys off it).
type Mode = "light" | "dark";

function initial(): Mode {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

class ThemeStore {
  mode = $state<Mode>(initial());

  set(m: Mode): void {
    this.mode = m;
    document.documentElement.setAttribute("data-theme", m);
    localStorage.setItem("theme", m);
  }
  toggle(): void {
    this.set(this.mode === "light" ? "dark" : "light");
  }
}

export const theme = new ThemeStore();
theme.set(theme.mode); // apply on load
