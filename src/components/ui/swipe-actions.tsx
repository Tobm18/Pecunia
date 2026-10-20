"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { animateSpring, project, rubberband, SPRINGS, velocityFrom, type SpringAnimation } from "@/lib/motion/spring";
import { prefersReducedMotion, useToast } from "./overlay";
import { Spinner } from "./spinner";

const ACTION_WIDTH = 92;
/** Hystérésis avant de choisir entre glisser (horizontal) et défiler (vertical) */
const SLOP = 10;
const OPEN_EVENT = "pecunia:swipe-open";

/**
 * Glisser vers la gauche pour révéler « Supprimer » (écrans tactiles).
 * La ligne suit le doigt 1:1, résiste au-delà des bords, et l'élan au lâcher décide
 * d'ouvrir ou de refermer. Une seule ligne ouverte à la fois ; toucher ailleurs referme.
 */
export function SwipeActions({
  children,
  label,
  onDelete,
  successMessage = "Supprimée",
}: {
  children: ReactNode;
  /** Nom accessible du bouton de suppression */
  label: string;
  onDelete: () => Promise<{ ok: true } | { ok: false; error: string }>;
  successMessage?: string;
}) {
  const id = useId();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const motion = useRef({
    offset: 0,
    anim: null as SpringAnimation | null,
    gesture: null as null | {
      pointerId: number;
      x: number;
      y: number;
      startOffset: number;
      axis: "x" | "y" | null;
      crossed: boolean;
      history: { t: number; v: number }[];
    },
    suppressClick: false,
  });

  const paint = (v: number) => {
    motion.current.offset = v;
    if (rowRef.current) rowRef.current.style.transform = v ? `translate3d(${v}px, 0, 0)` : "";
    // l'action n'existe visuellement que lorsqu'elle est découverte
    if (actionRef.current) actionRef.current.style.visibility = v < 0 ? "visible" : "hidden";
  };

  const settle = (target: number, velocity = 0) => {
    const m = motion.current;
    const from = m.anim ? m.anim.stop().value : m.offset;
    m.anim = null;
    setOpen(target !== 0);
    if (target !== 0) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    if (prefersReducedMotion()) return paint(target);
    m.anim = animateSpring({
      from,
      to: target,
      velocity,
      // léger rebond seulement si le geste avait de l'élan
      config: Math.abs(velocity) > 300 ? SPRINGS.momentum : SPRINGS.default,
      onUpdate: paint,
      onComplete: () => (m.anim = null),
    });
  };

  // Une autre ligne s'ouvre, ou on touche ailleurs : on referme
  useEffect(() => {
    if (!open) return;
    const onOtherOpen = (e: Event) => (e as CustomEvent).detail !== id && settle(0);
    const onPointerDown = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && settle(0);
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOtherOpen);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  useEffect(() => {
    const m = motion.current;
    return () => {
      m.anim?.stop();
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" || pending) return; // à la souris : la modale de modification suffit
    const m = motion.current;
    const current = m.anim ? m.anim.stop().value : m.offset; // rattrapée en plein vol : on part de l'affiché
    m.anim = null;
    m.gesture = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, startOffset: current, axis: null, crossed: current !== 0, history: [] };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = motion.current.gesture;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < SLOP) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.axis === "y") return; // défilement vertical natif
      rowRef.current?.setPointerCapture(e.pointerId);
    }
    if (g.axis !== "x") return;
    const width = rootRef.current?.offsetWidth ?? 360;
    const raw = g.startOffset + dx;
    g.history.push({ t: e.timeStamp, v: raw });
    if (g.history.length > 12) g.history.shift();
    // résistance au-delà des bords : vers la droite, et au-delà de la largeur de l'action
    const v = raw > 0 ? rubberband(raw, width) : raw < -ACTION_WIDTH ? -ACTION_WIDTH + rubberband(raw + ACTION_WIDTH, width) : raw;
    paint(v);
    // retour haptique discret au franchissement du seuil (Android)
    const past = v < -ACTION_WIDTH / 2;
    if (past !== g.crossed) {
      g.crossed = past;
      if (past) navigator.vibrate?.(8);
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const m = motion.current;
    const g = m.gesture;
    m.gesture = null;
    if (!g || g.pointerId !== e.pointerId || g.axis !== "x") return;
    m.suppressClick = true; // un glisser n'est pas un clic sur la ligne
    const velocity = velocityFrom(g.history);
    // décision d'après la position projetée par l'élan (décélération « sèche »)
    const projected = m.offset + project(velocity, 0.99);
    settle(projected < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0, velocity);
  };

  const onClickCapture = (e: ReactMouseEvent) => {
    const m = motion.current;
    if (m.suppressClick || m.offset !== 0) {
      e.preventDefault();
      e.stopPropagation();
      if (!m.suppressClick) settle(0); // ligne ouverte : toucher la referme
    }
    m.suppressClick = false;
  };

  function remove() {
    startTransition(async () => {
      const r = await onDelete();
      startTransition(() => {
        if (!r.ok) {
          toast(r.error, "error");
          settle(0);
        } else toast(successMessage);
      });
    });
  }

  return (
    <div ref={rootRef} className="relative overflow-hidden">
      <button
        ref={actionRef}
        type="button"
        onClick={remove}
        aria-label={label}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        disabled={pending}
        className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-danger-solid text-xs font-semibold text-white"
        style={{ width: ACTION_WIDTH, visibility: "hidden" }}
      >
        {pending ? <Spinner size={18} className="text-white" label="Suppression" /> : <Trash2 size={18} />}
        Supprimer
      </button>
      <div
        ref={rowRef}
        className="relative touch-pan-y bg-surface will-change-transform"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
