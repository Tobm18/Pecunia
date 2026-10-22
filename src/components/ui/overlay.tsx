"use client";

import { clsx } from "clsx";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { animateSpring, project, rubberband, SPRINGS, velocityFrom, type SpringAnimation, type SpringConfig } from "@/lib/motion/spring";

/** Préférence système « réduire les animations ». */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Modale centrée sur ordinateur, feuille remontant du bas sur mobile.
 * Échap ou clic sur le fond ferme sans action.
 *
 * Mouvement : ressorts interruptibles (une modale en train de se fermer peut être rattrapée),
 * entrée et sortie par le même chemin. Sur mobile, la feuille se tire vers le bas par sa
 * poignée : elle suit le doigt 1:1, résiste vers le haut, et l'élan au lâcher décide entre
 * fermer et revenir. « Réduire les animations » : simple fondu.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  // onClose est souvent une fonction inline : on la garde en ref pour ne pas relancer l'effet
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Contenu conservé pendant l'animation de sortie (le parent l'a souvent déjà vidé)
  const content = useRef({ title, children, footer });
  if (open) content.current = { title, children, footer };

  // État du mouvement, hors rendu React (mis à jour à chaque image)
  const motion = useRef({
    sheet: false,
    reduced: false,
    height: 600,
    /** feuille : décalage en px (0 = ouverte) ; boîte de dialogue : 0 = ouverte, 1 = fermée */
    value: 1,
    anim: null as SpringAnimation | null,
    releaseVelocity: 0,
    drag: null as null | { startY: number; startValue: number; active: boolean; history: { t: number; v: number }[] },
  });

  const closedValue = () => (motion.current.sheet ? motion.current.height : 1);

  const paint = useCallback((v: number) => {
    const m = motion.current;
    m.value = v;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;
    const closedness = m.sheet ? Math.min(1, Math.max(0, v / m.height)) : v;
    scrim.style.opacity = String(1 - closedness);
    if (m.reduced && !m.drag?.active) {
      panel.style.opacity = String(1 - closedness);
      panel.style.transform = m.sheet && v < 0 ? `translate3d(0, ${v}px, 0)` : "";
    } else if (m.sheet) {
      panel.style.opacity = "";
      panel.style.transform = `translate3d(0, ${v}px, 0)`;
    } else {
      // la surface « se matérialise » : opacité et échelle ensemble
      panel.style.opacity = String(1 - v);
      panel.style.transform = `translate3d(0, ${v * 8}px, 0) scale(${1 - v * 0.04})`;
    }
  }, []);

  const animateTo = useCallback(
    (target: number, opts: { velocity?: number; config?: SpringConfig; onComplete?: () => void } = {}) => {
      const m = motion.current;
      const current = m.anim ? m.anim.stop() : { value: m.value, velocity: 0 };
      m.anim = animateSpring({
        from: current.value,
        to: target,
        velocity: opts.velocity ?? current.velocity,
        config: opts.config ?? (m.sheet ? SPRINGS.sheet : SPRINGS.default),
        restDelta: m.sheet ? 0.5 : 0.002,
        onUpdate: paint,
        onComplete: () => {
          m.anim = null;
          opts.onComplete?.();
        },
      });
    },
    [paint],
  );

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Entrée / sortie
  useLayoutEffect(() => {
    if (!mounted) return;
    const m = motion.current;
    const panel = panelRef.current;
    if (open) {
      // ouverture depuis l'état fermé ; si la sortie était en cours, on repart de là
      if (!m.anim) {
        m.sheet = window.matchMedia("(max-width: 767px)").matches;
        m.reduced = prefersReducedMotion();
        m.height = panel?.getBoundingClientRect().height || 600;
        paint(closedValue());
      }
      animateTo(0);
    } else {
      const velocity = m.releaseVelocity || undefined;
      m.releaseVelocity = 0;
      animateTo(closedValue(), { velocity, config: m.sheet ? SPRINGS.sheet : SPRINGS.default, onComplete: () => setMounted(false) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  useEffect(() => {
    const m = motion.current;
    return () => {
      m.anim?.stop();
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // focus sur le premier champ de la modale
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])")?.focus({ preventScroll: true });
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.({ preventScroll: true });
    };
  }, [mounted]);

  // Glisser pour fermer (feuille mobile)
  const onPointerDown = (e: ReactPointerEvent) => {
    const m = motion.current;
    if (!m.sheet || !open || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    const current = m.anim ? m.anim.stop() : { value: m.value, velocity: 0 };
    m.anim = null;
    m.drag = { startY: e.clientY, startValue: current.value, active: false, history: [{ t: e.timeStamp, v: current.value }] };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = motion.current.drag;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.active && Math.abs(dy) < 4) return;
    d.active = true;
    const raw = d.startValue + dy;
    d.history.push({ t: e.timeStamp, v: raw });
    if (d.history.length > 12) d.history.shift();
    // vers le haut : résistance, il n'y a rien de plus à ouvrir
    paint(raw < 0 ? rubberband(raw, motion.current.height) : raw);
  };
  const onPointerUp = () => {
    const m = motion.current;
    const d = m.drag;
    m.drag = null;
    if (!d?.active) return;
    const velocity = velocityFrom(d.history);
    // décision sur la position projetée par l'élan, pas sur la position au lâcher
    if (m.value + project(velocity) > m.height * 0.5) {
      m.releaseVelocity = velocity;
      onCloseRef.current();
    } else {
      animateTo(0, { velocity, config: SPRINGS.momentum });
    }
  };

  if (!mounted) return null;
  const { title: shownTitle, children: shownChildren, footer: shownFooter } = content.current;
  const dragProps = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
  return (
    <div className={clsx("fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6", !open && "pointer-events-none")} role="presentation">
      <div ref={scrimRef} className="absolute inset-0 bg-n-900/45" style={{ opacity: 0 }} onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        style={{ opacity: 0 }}
        className={clsx(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-[22px] bg-surface shadow-modal will-change-transform md:rounded-[18px]",
          size === "lg" ? "md:max-w-2xl" : "md:max-w-md",
        )}
      >
        {/* poignée : zone de glisser de la feuille mobile */}
        <div {...dragProps} className="flex shrink-0 touch-none justify-center pt-2 pb-1 md:hidden" aria-hidden>
          <span className="h-1.5 w-10 rounded-full bg-n-300" />
        </div>
        {shownTitle && (
          <div {...dragProps} className="flex touch-none items-center justify-between gap-3 px-5 pt-3 md:touch-auto md:pt-5">
            <h2 className="text-lg font-bold">{shownTitle}</h2>
            <button
              type="button"
              data-close
              onClick={onClose}
              className="-mr-2 flex size-10 items-center justify-center rounded-full text-xl text-n-600 hover:bg-n-100 motion-safe:active:scale-90"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>
        )}
        {/* marge du bas = espace normal + zone de l'indicateur d'accueil (iPhone), jamais l'un à la place de l'autre */}
        <div
          className={clsx(
            "overflow-y-auto overscroll-contain px-5 pt-4",
            shownFooter ? "pb-4" : "pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:pb-5",
          )}
        >
          {shownChildren}
        </div>
        {shownFooter && (
          <div className="flex justify-end gap-2 border-t border-divider px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
            {shownFooter}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error";
  leaving?: boolean;
}

const ToastContext = createContext<(message: string, tone?: ToastItem["tone"]) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    // sortie par le même chemin que l'entrée, puis retrait
    setTimeout(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 3300);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3550);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto rounded-xl px-4 py-2.5 text-sm font-semibold shadow-pop",
              t.leaving ? "toast-out" : "toast-in",
              t.tone === "success" ? "bg-ink text-on-ink" : "bg-danger-solid text-white",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
