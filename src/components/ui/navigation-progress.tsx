"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "loading" | "done";

/**
 * Fine barre en haut de l'écran pendant une navigation interne (changement de page, de
 * mois, de filtre) : démarre au clic sur un lien interne, se termine quand l'URL affichée
 * change, c'est-à-dire quand les données du serveur sont arrivées.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");
  const safety = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setPhase("loading");
      // filet de sécurité si la navigation n'aboutit jamais (erreur réseau)
      clearTimeout(safety.current);
      safety.current = setTimeout(() => setPhase("idle"), 15_000);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    clearTimeout(safety.current);
    setPhase((p) => (p === "loading" ? "done" : p));
    const t = setTimeout(() => setPhase("idle"), 350);
    return () => clearTimeout(t);
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px]"
      style={{ opacity: phase === "idle" ? 0 : 1, transition: "opacity 300ms" }}
    >
      <div
        className="h-full bg-accent shadow-[0_0_8px_var(--accent)]"
        style={{
          width: phase === "idle" ? "0%" : phase === "loading" ? "85%" : "100%",
          transition: phase === "loading" ? "width 6s cubic-bezier(0.1, 0.7, 0.2, 1)" : phase === "done" ? "width 200ms ease-out" : "none",
        }}
      />
    </div>
  );
}
