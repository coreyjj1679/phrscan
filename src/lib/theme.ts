import { getSettings, saveSettings, type ThemeMode } from "./storage";

export type { ThemeMode };

/** Resolve a theme mode to the concrete theme applied to the document. */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return mode;
}

/** Write the resolved theme onto <html data-theme>. */
export function applyResolvedTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

/** Persist the chosen mode and apply it immediately. */
export function setThemeMode(mode: ThemeMode): void {
  saveSettings({ theme: mode });
  applyResolvedTheme(mode);
}

/** Apply the saved theme and keep "system" in sync with OS changes. */
export function initTheme(): void {
  applyResolvedTheme(getSettings().theme);
  const mql = window.matchMedia?.("(prefers-color-scheme: light)");
  mql?.addEventListener?.("change", () => {
    if (getSettings().theme === "system") applyResolvedTheme("system");
  });
}
