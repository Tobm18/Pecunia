import { clsx } from "clsx";
import { LoaderCircle } from "lucide-react";

/** Indicateur de chargement circulaire (hérite de la couleur du texte). */
export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <LoaderCircle
      size={size}
      className={clsx("shrink-0 animate-spin", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
