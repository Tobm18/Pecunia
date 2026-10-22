"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { useState } from "react";
import { Logo } from "@/components/ui/logo";
import {
  ChartColumn,
  CreditCard,
  Ellipsis,
  LayoutGrid,
  List,
  LogOut,
  Plus,
  Repeat,
  Settings,
  Tag,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "@/lib/data/actions";
import { formatCents } from "@/lib/domain/money";
import { Modal } from "@/components/ui/overlay";
import { useAppData } from "./app-data";
import { QuickEntryForm } from "@/components/entry/quick-entry-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { AppVersion } from "./app-version";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const MAIN: NavItem[] = [
  { href: "/", label: "Accueil", icon: LayoutGrid },
  { href: "/saisie", label: "Saisie", icon: Plus },
  { href: "/transactions", label: "Transactions", icon: List },
  { href: "/comptes", label: "Comptes", icon: CreditCard },
  { href: "/prevision", label: "Prévisionnel", icon: TrendingUp },
  { href: "/budgets", label: "Budgets", icon: Target },
];

const MANAGEMENT: NavItem[] = [
  { href: "/categories", label: "Catégories", icon: Tag },
  { href: "/recurrences", label: "Récurrences", icon: Repeat },
  { href: "/analyses", label: "Analyses", icon: ChartColumn },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors",
        active ? "bg-accent-100 text-accent-700" : "text-n-700 hover:bg-n-200 hover:text-text",
      )}
    >
      <item.icon size={16} />
      {item.label}
    </Link>
  );
}

/** Barre latérale (ordinateur). */
export function Sidebar() {
  const pathname = usePathname();
  const { profile, netWorthCents } = useAppData();
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-divider bg-surface px-3 py-5 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2.5 text-lg font-extrabold">
        <Logo className="size-7" />
        Pecunia
      </Link>
      <nav className="flex flex-col gap-0.5" aria-label="Navigation principale">
        {MAIN.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
        <p className="mt-5 mb-1 px-2.5 text-[10px] font-bold uppercase tracking-wider text-n-600">Gestion</p>
        {MANAGEMENT.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        <div className="rounded-xl bg-n-100 px-3 py-2.5">
          <p className="text-[11px] text-n-600">Patrimoine</p>
          <p className="font-extrabold tabular-nums">{formatCents(netWorthCents)}</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-divider px-1 pt-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{profile.displayName ?? profile.email.split("@")[0]}</p>
            <p className="truncate text-[11px] text-n-600">{profile.email}</p>
          </div>
          <form action={signOut}>
            <SubmitButton className="flex items-center rounded-lg p-2 text-n-600 hover:bg-n-200" aria-label="Se déconnecter" pendingChildren={null}>
              <LogOut size={16} />
            </SubmitButton>
          </form>
        </div>
        <AppVersion className="px-1" />
      </div>
    </aside>
  );
}

/** Onglets de la barre du bas (mobile), de part et d'autre du bouton de saisie. */
const TABS: NavItem[] = [
  { href: "/", label: "Accueil", icon: LayoutGrid },
  { href: "/comptes", label: "Comptes", icon: CreditCard },
  { href: "/prevision", label: "Prévision", icon: TrendingUp },
];

/** Rubriques de l'onglet « Plus », chacune avec sa pastille de couleur (à la manière des Réglages d'iOS). */
const MORE: (NavItem & { color: string })[] = [
  { href: "/transactions", label: "Transactions", icon: List, color: "#0a84ff" },
  { href: "/budgets", label: "Budgets", icon: Target, color: "#ff9f0a" },
  { href: "/recurrences", label: "Récurrences", icon: Repeat, color: "#5e5ce6" },
  { href: "/categories", label: "Catégories", icon: Tag, color: "#ff375f" },
  { href: "/analyses", label: "Analyses", icon: ChartColumn, color: "#30b0c7" },
  { href: "/parametres", label: "Paramètres", icon: Settings, color: "#8e8e93" },
];

const tabClass = (active: boolean) =>
  clsx(
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-transform duration-100 motion-safe:active:scale-95",
    // sur matériau translucide : couleurs plus contrastées (vibrance)
    active ? "text-accent-700" : "text-n-700",
  );

/**
 * Barre d'onglets (mobile) : Accueil, Comptes, saisie rapide (+), Prévision et « Plus », qui ouvre
 * une feuille avec les autres rubriques. Fixe en bas, au-dessus de la zone du geste d'accueil.
 */
export function BottomNav() {
  const pathname = usePathname();
  const [entryOpen, setEntryOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = MORE.some((item) => isActive(pathname, item.href));
  const tab = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    return (
      <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
        <item.icon size={22} strokeWidth={active ? 2.4 : 2} />
        {item.label}
      </Link>
    );
  };
  return (
    <>
      <nav className="material-bar fixed inset-x-0 bottom-0 z-40 flex items-end px-2 pb-safe lg:hidden" aria-label="Navigation principale">
        {TABS.slice(0, 2).map(tab)}
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={() => setEntryOpen(true)}
            className="-mt-6 mb-2 flex size-14 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-pop ring-4 ring-bg transition-transform duration-100 ease-out motion-safe:active:scale-[0.92]"
            aria-label="Nouvelle saisie"
          >
            <Plus size={28} strokeWidth={2.4} />
          </button>
        </div>
        {TABS.slice(2).map(tab)}
        <button type="button" onClick={() => setMoreOpen(true)} className={tabClass(inMore)} aria-haspopup="dialog" aria-current={inMore ? "page" : undefined}>
          <Ellipsis size={22} strokeWidth={inMore ? 2.6 : 2.2} />
          Plus
        </button>
      </nav>
      <Modal open={entryOpen} onClose={() => setEntryOpen(false)} size="lg">
        <QuickEntryForm variant="sheet" onDone={() => setEntryOpen(false)} />
      </Modal>
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Plus">
        <nav className="flex flex-col gap-4 pb-safe" aria-label="Plus">
          <div className="grid grid-cols-3 gap-2.5">
            {MORE.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl px-1 text-[13px] font-semibold transition-transform duration-100 motion-safe:active:scale-95",
                    active ? "bg-accent-100 text-accent-700 ring-1 ring-accent-200" : "bg-n-100 text-text",
                  )}
                >
                  <span className="flex size-10 items-center justify-center rounded-[11px] text-white" style={{ backgroundColor: item.color }}>
                    <item.icon size={21} strokeWidth={2.2} />
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
          <form action={signOut}>
            <SubmitButton
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-n-100 font-semibold text-danger-700"
              pendingChildren="Déconnexion…"
            >
              <LogOut size={18} />
              Se déconnecter
            </SubmitButton>
          </form>
        </nav>
      </Modal>
    </>
  );
}

