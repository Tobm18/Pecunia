import { BackLink, PageHeader } from "@/components/ui/primitives";
import { CsvImport } from "./csv-import";

// le classement automatique (recherches dans l'annuaire des entreprises) tourne après la réponse
export const maxDuration = 60;

export const metadata = { title: "Importer un CSV" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { compte } = await searchParams;
  return (
    <>
      {/* installée, l'app n'a pas de bouton « précédent » : retour vers l'écran d'où l'on vient */}
      <div className="flex flex-col gap-3">
        <BackLink href={compte ? `/comptes/${compte}` : "/parametres"}>{compte ? "Le compte" : "Paramètres"}</BackLink>
        <PageHeader kicker="Transactions" title="Importer un CSV" />
      </div>
      <CsvImport initialAccountId={compte ?? null} />
    </>
  );
}
