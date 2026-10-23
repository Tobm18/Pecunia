import { getCategoryAnalysis } from "@/lib/data/categorize";
import { getAppData, getSession } from "@/lib/data/queries";
import { BackLink, PageHeader } from "@/components/ui/primitives";
import { ClassifyView } from "./classify-view";

export const metadata = { title: "Classer mes transactions" };

export default async function ClassifyPage() {
  const [{ user }, { categories }] = await Promise.all([getSession(), getAppData()]);
  const analysis = await getCategoryAnalysis(user.id);
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink href="/categories">Catégories</BackLink>
        <PageHeader kicker="Analyse" title="Classer mes transactions" />
      </div>
      <ClassifyView analysis={analysis} categories={categories.filter((c) => !c.archivedAt)} />
    </>
  );
}
