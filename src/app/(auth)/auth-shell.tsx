import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { AppVersion } from "@/components/app/app-version";
import { Logo } from "@/components/ui/logo";
import { Spinner } from "@/components/ui/spinner";

/**
 * Écrans d'authentification à la manière d'une app iPhone : icône et nom au centre, champs groupés
 * dans un seul bloc arrondi, grands boutons pleine largeur, lien secondaire en bas d'écran.
 */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <main className="flex w-full max-w-sm flex-1 flex-col justify-center py-8">
        <div className="flex flex-col items-center text-center">
          <Logo className="size-[84px] rounded-[20px] shadow-[0_8px_22px_-10px_rgba(20,130,112,0.7)]" />
          <h1 className="mt-5 text-[28px] leading-tight font-extrabold">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px] text-n-600">{subtitle}</p>}
        </div>
        <div className="mt-9">{children}</div>
      </main>
      <footer className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        {footer}
        <AppVersion />
      </footer>
    </div>
  );
}

/** Bloc de champs groupés (style Réglages d'iOS), séparateurs en retrait. */
export function FieldGroup({ children, invalid }: { children: ReactNode; invalid?: boolean }) {
  return (
    <div
      className={clsx(
        // focus : le bloc entier se souligne (pas de contour par champ, rogné par les coins arrondis)
        "overflow-hidden rounded-2xl bg-surface shadow-card ring-1 transition-shadow [&>*+*]:border-t [&>*+*]:border-divider",
        invalid ? "ring-danger" : "ring-divider focus-within:ring-2 focus-within:ring-accent",
      )}
    >
      {children}
    </div>
  );
}

/** Champ sans bordure d'un FieldGroup ; le libellé reste lu par les lecteurs d'écran. */
export function GroupInput({ label, className, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="ml-4 block">
      <span className="sr-only">{label}</span>
      <input
        placeholder={label}
        className={clsx("block h-[52px] w-full bg-transparent pr-4 text-[17px] text-text placeholder:text-n-500 focus-visible:outline-none!", className)}
        {...props}
      />
    </label>
  );
}

/** Grand bouton pleine largeur : « primary » plein, « secondary » sur fond de surface. */
export function AuthButton({
  variant = "primary",
  loading = false,
  className,
  children,
  type = "button",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary"; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        "flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[17px] font-semibold transition-[transform,opacity] duration-100 active:scale-[0.98] active:opacity-85 disabled:opacity-60",
        variant === "primary" ? "bg-accent text-on-accent" : "bg-surface text-text shadow-card ring-1 ring-divider",
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}

/** Message d'erreur sous le formulaire, annoncé aux lecteurs d'écran. */
export function AuthError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="px-1 text-center text-sm font-medium text-danger-700">
      {children}
    </p>
  );
}
