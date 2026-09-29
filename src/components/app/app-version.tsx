import { clsx } from "clsx";
import { APP_NAME, copyrightLine, versionLabel } from "@/lib/version";

/** « Pecunia v0.2.0 · © 2026 Tom Courgenay · Tous droits réservés » */
export function AppVersion({ className, full = false }: { className?: string; full?: boolean }) {
  return (
    <p className={clsx("text-[11px] text-n-500", className)}>
      {APP_NAME} {versionLabel()} · {copyrightLine()}
      {full && " · Tous droits réservés"}
    </p>
  );
}
