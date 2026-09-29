import type { ReactNode } from "react";
import { AppVersion } from "@/components/app/app-version";

/** Mise en page des écrans d'authentification : bandeau accent + formulaire. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <div className="m-4 flex flex-col justify-between rounded-[22px] bg-accent p-7 text-white md:m-0 md:w-1/2 md:rounded-none md:p-10">
        <p className="text-lg font-bold">Pecunia</p>
        <p className="mt-8 text-5xl leading-[1.02] font-extrabold md:text-6xl">
          Chaque euro
          <br />à sa place.
        </p>
        <p className="mt-6 hidden text-xs opacity-80 md:block">Budget, comptes &amp; prévisionnel - usage personnel</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-6 md:px-10">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-extrabold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-n-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          <AppVersion className="mt-10 text-center" full />
        </div>
      </div>
    </div>
  );
}
