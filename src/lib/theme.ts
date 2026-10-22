export const THEME_COOKIE = "pecunia-theme";
export type Theme = "light" | "dark";

/** Fond de l'app (--bg) : couleur de la barre d'état une fois installée sur l'écran d'accueil. */
export const THEME_COLORS: Record<Theme, string> = { light: "#f5f6f8", dark: "#11151c" };

/** Met à jour la barre d'état sans recharger la page (changement de thème). */
export function applyThemeColor(theme: Theme) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}
