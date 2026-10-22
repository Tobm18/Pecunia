/** Briques d'interface partagées (boutons, cartes, champs, segments, puces, barres). */
import { clsx } from "clsx";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes } from "react";
import type { BudgetStatus } from "@/lib/domain/budgets";
import { Spinner } from "./spinner";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** Retour vers l'écran parent, à la manière d'iOS : chevron et libellé, grande zone de toucher. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-2.5 inline-flex min-h-11 items-center gap-0.5 self-start rounded-lg pr-2 text-[17px] font-medium text-accent-700 transition-opacity active:opacity-50 md:min-h-9 md:text-[15px]"
    >
      <ChevronLeft size={26} strokeWidth={2.4} className="shrink-0" aria-hidden />
      {children}
    </Link>
  );
}

export function buttonClass(variant: ButtonVariant = "secondary", extra?: string) {
  return clsx(
    "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-100 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 md:min-h-9",
    variant === "primary" && "bg-accent text-on-accent hover:bg-accent-600",
    variant === "secondary" && "border border-n-300 bg-surface text-text hover:bg-n-100",
    variant === "ghost" && "text-accent-700 hover:bg-accent-100",
    variant === "danger" && "bg-danger-solid text-white hover:brightness-110",
    extra,
  );
}

/** Bouton ; `loading` affiche un spinner et le désactive pendant un envoi. */
export function Button({
  variant = "secondary",
  className,
  type = "button",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button type={type} className={buttonClass(variant, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Spinner size={15} />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("rounded-card bg-surface p-4 shadow-card md:p-5", className)}>{children}</section>;
}

/** Petit titre de bloc en capitales (« MES COMPTES ») avec lien optionnel à droite. */
export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">{title}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ kicker, title, actions }: { kicker?: string; title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <p className="text-[11px] font-bold uppercase tracking-wider text-n-600">{kicker}</p>}
        <h1 className="text-3xl font-extrabold md:text-4xl">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] text-n-700">
      {children}
    </label>
  );
}

export const inputClass =
  "block w-full min-h-11 rounded-[10px] border border-n-300 bg-surface px-3 text-base text-text placeholder:text-n-500 focus:border-accent focus:outline-none md:min-h-9 md:text-sm aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={clsx(inputClass, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputClass, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-[13px] font-medium text-danger-700">
      {children}
    </p>
  );
}

/** Segment à options (Sortie / Entrée / Virement, 6 mois / 12 mois…). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className={clsx("inline-flex gap-0.5 rounded-[10px] bg-n-200 p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex-1 whitespace-nowrap rounded-lg font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-100 ease-out motion-safe:active:scale-[0.97]",
            size === "sm" ? "min-h-8 px-2.5 text-xs" : "min-h-10 px-3 text-sm md:min-h-8",
            value === o.value ? "bg-surface text-text shadow-card" : "text-n-700 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Puce de filtre (« Tous », « • Courant »…). */
export function Chip({
  active,
  color,
  children,
  onClick,
  href,
}: {
  active: boolean;
  color?: string;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const className = clsx(
    "inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-100 ease-out motion-safe:active:scale-[0.97] md:min-h-8 md:px-3 md:text-xs",
    active ? "border-ink bg-ink text-on-ink" : "border-n-300 bg-surface text-text hover:bg-n-100",
  );
  const content = (
    <>
      {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className} aria-current={active ? "true" : undefined} scroll={false}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} aria-pressed={active}>
      {content}
    </button>
  );
}

export const statusColor: Record<BudgetStatus, string> = {
  ok: "bg-accent",
  warn: "bg-warn",
  over: "bg-danger",
};

export const statusText: Record<BudgetStatus, string> = {
  ok: "text-accent-700",
  warn: "text-warn-800",
  over: "text-danger-700",
};

export function ProgressBar({ ratio, status, className }: { ratio: number; status: BudgetStatus; className?: string }) {
  const width = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 1)) * 100;
  return (
    <div
      className={clsx("h-2 overflow-hidden rounded-full bg-n-200", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
    >
      <div className={clsx("h-full rounded-full transition-[width]", statusColor[status])} style={{ width: `${width}%` }} />
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl bg-n-100 p-4 text-sm text-n-700">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Banner({
  tone,
  children,
  action,
  onClose,
}: {
  tone: "warn" | "danger" | "info" | "success";
  children: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx(
        "flex items-start gap-3 rounded-xl px-4 py-3 text-sm",
        tone === "warn" && "bg-warn-100 text-warn-800",
        tone === "danger" && "bg-danger-100 text-danger-700",
        tone === "info" && "bg-n-200 text-n-800",
        tone === "success" && "bg-accent-100 text-accent-700",
      )}
    >
      <div className="flex-1">{children}</div>
      {action}
      {onClose && (
        <button type="button" onClick={onClose} className="-m-1 p-1 font-bold" aria-label="Fermer">
          ×
        </button>
      )}
    </div>
  );
}
