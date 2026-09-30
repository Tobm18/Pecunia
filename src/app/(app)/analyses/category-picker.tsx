"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/primitives";

/** Choix de la catégorie suivie (paramètre « categorie » de l'URL). */
export function CategoryPicker({ categories, value }: { categories: { id: string; name: string }[]; value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <Select
      value={value ?? ""}
      aria-label="Catégorie"
      className="w-48"
      onChange={(e) => {
        const next = new URLSearchParams(searchParams);
        next.set("categorie", e.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
    >
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}
