import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

/** Page de texte publique (accessible sans session) : confidentialité, conditions d'utilisation. */
export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <main className="w-full max-w-xl flex-1 py-8">
        <div className="flex items-center gap-3">
          <Logo className="size-11 rounded-[11px]" />
          <div>
            <p className="text-[15px] font-semibold text-n-600">Pecunia</p>
            <h1 className="text-[26px] leading-tight font-extrabold">{title}</h1>
          </div>
        </div>
        <p className="mt-3 text-sm text-n-600">Dernière mise à jour : {updated}</p>
        <div className="mt-6 space-y-6 text-[16px] leading-relaxed [&_h2]:mb-2 [&_h2]:text-[18px] [&_h2]:font-bold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">{children}</div>
      </main>
    </div>
  );
}
