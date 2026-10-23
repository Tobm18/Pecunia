import Link from "next/link";
import { Sparkles } from "lucide-react";
import { countUncategorized } from "@/lib/data/categorize";
import { getAppData, getBudgets, getSession } from "@/lib/data/queries";
import { effectiveBudgetCents } from "@/lib/domain/budgets";
import { Banner, PageHeader, buttonClass } from "@/components/ui/primitives";
import { CategoriesManager } from "./categories-manager";

export const metadata = { title: "Catégories" };

export default async function CategoriesPage() {
  const [{ profile, categories }, budgets, { user }] = await Promise.all([getAppData(), getBudgets(), getSession()]);
  const uncategorized = await countUncategorized(user.id);
  const budgetByCategory = Object.fromEntries(
    budgets.map((b) => [b.categoryId, effectiveBudgetCents(b, profile.referenceIncomeCents)]),
  );
  return (
    <>
      <div>
        <PageHeader
          kicker="Gestion"
          title="Catégories"
          actions={
            <Link href="/categories/classer" className={buttonClass("secondary")}>
              <Sparkles size={15} /> Classer mes transactions
            </Link>
          }
        />
      </div>
      {uncategorized > 0 && (
        <Banner
          tone="info"
          action={
            <Link href="/categories/classer" className="font-bold">
              Classer
            </Link>
          }
        >
          {uncategorized} transaction{uncategorized > 1 ? "s sont" : " est"} dans « Autres » ou sans catégorie : classe-les par commerçant en quelques clics.
        </Banner>
      )}
      <CategoriesManager categories={categories} budgetByCategory={budgetByCategory} />
    </>
  );
}
