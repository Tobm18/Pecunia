/** Version du logiciel et mentions de copyright (injectées au build depuis package.json). */

export const APP_NAME = "Pecunia";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
/** Commit court du déploiement (Vercel), vide en local */
export const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT ?? "";
export const COPYRIGHT_HOLDER = process.env.NEXT_PUBLIC_APP_AUTHOR ?? "";
export const FIRST_YEAR = 2026;

/** « © 2026 Tom Courgenay » ou « © 2026-2027 Tom Courgenay » */
export function copyrightLine(year = new Date().getFullYear()): string {
  const years = year > FIRST_YEAR ? `${FIRST_YEAR}-${year}` : String(FIRST_YEAR);
  return `© ${years}${COPYRIGHT_HOLDER ? ` ${COPYRIGHT_HOLDER}` : ""}`;
}

/** « v0.2.0 » ou « v0.2.0 (a1b2c3d) » */
export function versionLabel(): string {
  return `v${APP_VERSION}${APP_COMMIT ? ` (${APP_COMMIT})` : ""}`;
}
