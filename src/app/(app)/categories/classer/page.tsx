import { after } from "next/server";
import { autoCategorize, countUnprocessed, getReviewOverview } from "@/lib/data/categorize";
import { getAppData, getSession } from "@/lib/data/queries";
import { BackLink, PageHeader } from "@/components/ui/primitives";
import { ClassifyView } from "./classify-view";

// le classement automatique (recherches dans l'annuaire des entreprises) tourne après la réponse
export const maxDuration = 60;

export const metadata = { title: "À vérifier" };

export default async function ReviewPage() {
  const [{ user }, { categories }] = await Promise.all([getSession(), getAppData()]);
  const [overview, unprocessed] = await Promise.all([getReviewOverview(user.id), countUnprocessed(user.id)]);
  // lignes pas encore passées par le classement automatique : il tourne après l'affichage
  if (unprocessed > 0) after(() => autoCategorize(user.id).catch(() => undefined));
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink href="/categories">Catégories</BackLink>
        <PageHeader kicker="Classement automatique" title="À vérifier" />
      </div>
      <ClassifyView overview={overview} unprocessed={unprocessed} categories={categories.filter((c) => !c.archivedAt)} />
    </>
  );
}
