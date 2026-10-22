import { getBankOverview } from "@/lib/data/bank";
import { getSession } from "@/lib/data/queries";
import { BackLink, PageHeader } from "@/components/ui/primitives";
import { BankSettings } from "./bank-settings";

export const metadata = { title: "Banque" };

export default async function BankSettingsPage({ searchParams }: { searchParams: Promise<{ connecte?: string; erreur?: string }> }) {
  const [{ user }, params] = await Promise.all([getSession(), searchParams]);
  const overview = await getBankOverview(user.id);
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink href="/parametres">Paramètres</BackLink>
        <PageHeader kicker="Connexion bancaire" title="Banque" />
      </div>
      <BankSettings overview={overview} justConnected={params.connecte === "1"} authError={params.erreur ?? null} />
    </>
  );
}
