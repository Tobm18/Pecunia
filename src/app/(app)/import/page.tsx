import { PageHeader } from "@/components/ui/primitives";
import { CsvImport } from "./csv-import";

export const metadata = { title: "Importer un CSV" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { compte } = await searchParams;
  return (
    <>
      <div className="pr-12 lg:pr-0">
        <PageHeader kicker="Transactions" title="Importer un CSV" />
      </div>
      <CsvImport initialAccountId={compte ?? null} />
    </>
  );
}
