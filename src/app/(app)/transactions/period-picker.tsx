"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Segmented } from "@/components/ui/primitives";
import { todayIso } from "@/lib/domain/dates";

export type PeriodMode = "mois" | "3m" | "12m" | "tout" | "dates";

const withParams = (params: Record<string, string | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/transactions?${s}` : "/transactions";
};

/** Période affichée : un mois (flèches), 3 ou 12 derniers mois, tout l'historique, ou des dates choisies. */
export function PeriodPicker({ mode, from, to, account }: { mode: PeriodMode; from: string | null; to: string | null; account: string | null }) {
  const router = useRouter();
  const [du, setDu] = useState(from ?? "");
  const [au, setAu] = useState(to ?? todayIso());

  function go(next: PeriodMode) {
    if (next === "dates") {
      router.push(withParams({ periode: "dates", du: du || null, au: au || null, compte: account }));
      return;
    }
    router.push(withParams({ periode: next === "mois" ? null : next, compte: account }));
  }

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        value={mode}
        onChange={go}
        size="sm"
        className="self-start"
        options={[
          { value: "mois", label: "Mois" },
          { value: "3m", label: "3 mois" },
          { value: "12m", label: "12 mois" },
          { value: "tout", label: "Tout" },
          { value: "dates", label: "Dates" },
        ]}
      />
      {mode === "dates" && (
        <form
          className="flex flex-wrap items-end gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            go("dates");
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-n-700">Du</span>
            <input type="date" value={du} max={au || undefined} onChange={(e) => setDu(e.target.value)} className="min-h-9 rounded-[10px] border border-n-300 bg-surface px-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-n-700">Au</span>
            <input type="date" value={au} min={du || undefined} onChange={(e) => setAu(e.target.value)} className="min-h-9 rounded-[10px] border border-n-300 bg-surface px-2" />
          </label>
          <button type="submit" className="min-h-9 rounded-[10px] bg-accent px-3 font-semibold text-on-accent">
            Afficher
          </button>
        </form>
      )}
    </div>
  );
}
