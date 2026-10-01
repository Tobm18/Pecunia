"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/primitives";
import { startNavigationProgress } from "@/components/ui/navigation-progress";
import { Spinner } from "@/components/ui/spinner";

/** Choix de la catégorie suivie (paramètre « categorie » de l'URL). */
export function CategoryPicker({ categories, value }: { categories: { id: string; name: string }[]; value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {pending && <Spinner size={14} label="Chargement" />}
      <Select
        value={value ?? ""}
        aria-label="Catégorie"
        className="w-48"
        disabled={pending}
        onChange={(e) => {
          const next = new URLSearchParams(searchParams);
          next.set("categorie", e.target.value);
          startNavigationProgress();
          startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
        }}
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
