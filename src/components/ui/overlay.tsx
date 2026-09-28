"use client";

import { clsx } from "clsx";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Modale centrée sur ordinateur, feuille remontant du bas sur mobile.
 * Échap ou clic sur le fond ferme sans action.
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
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose est souvent une fonction inline : on la garde en ref pour ne pas relancer l'effet
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // focus sur le premier champ de la modale
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])")?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="presentation">
      <div className="absolute inset-0 bg-n-900/45" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={clsx(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-[22px] bg-surface shadow-modal md:rounded-[18px]",
          size === "lg" ? "md:max-w-2xl" : "md:max-w-md",
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 px-5 pt-5">
            <h2 className="text-lg font-bold">{title}</h2>
            <button
              type="button"
              data-close
              onClick={onClose}
              className="-mr-2 flex size-10 items-center justify-center rounded-full text-xl text-n-600 hover:bg-n-100"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-divider px-5 py-3 pb-safe">{footer}</div>}
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
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3500);
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
              t.tone === "success" ? "bg-ink text-on-ink" : "bg-danger text-white",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
