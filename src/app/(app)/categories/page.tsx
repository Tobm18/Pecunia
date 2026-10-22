import { getAppData, getBudgets } from "@/lib/data/queries";
import { effectiveBudgetCents } from "@/lib/domain/budgets";
import { PageHeader } from "@/components/ui/primitives";
import { CategoriesManager } from "./categories-manager";

export const metadata = { title: "Catégories" };

export default async function CategoriesPage() {
  const [{ profile, categories }, budgets] = await Promise.all([getAppData(), getBudgets()]);
  const budgetByCategory = Object.fromEntries(
    budgets.map((b) => [b.categoryId, effectiveBudgetCents(b, profile.referenceIncomeCents)]),
  );
  return (
    <>
      <div>
        <PageHeader kicker="Gestion" title="Catégories" />
      </div>
      <CategoriesManager categories={categories} budgetByCategory={budgetByCategory} />
    </>
  );
}
