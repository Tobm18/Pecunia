import Link from "next/link";
import { PageHeader } from "@/components/ui/primitives";
import { CsvImport } from "./csv-import";

export const metadata = { title: "Importer un CSV" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { compte } = await searchParams;
  return (
    <>
      {/* installée, l'app n'a pas de bouton « précédent » : retour vers l'écran d'où l'on vient */}
      <div className="flex flex-col gap-3 pr-12 lg:pr-0">
        <Link href={compte ? `/comptes/${compte}` : "/parametres"} className="text-xs font-bold text-accent-700">
          ‹ {compte ? "Le compte" : "Paramètres"}
        </Link>
        <PageHeader kicker="Transactions" title="Importer un CSV" />
      </div>
      <CsvImport initialAccountId={compte ?? null} />
    </>
  );
}
