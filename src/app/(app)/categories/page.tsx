import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { countToReview } from "@/lib/data/categorize";
import { listRecipients, listRentRules } from "@/lib/data/rent";
import { getAppData, getBudgets, getSession } from "@/lib/data/queries";
import { effectiveBudgetCents } from "@/lib/domain/budgets";
import { Banner, PageHeader, buttonClass } from "@/components/ui/primitives";
import { CategoriesManager } from "./categories-manager";
import { RentSettings } from "./rent-settings";

export const metadata = { title: "Catégories" };

export default async function CategoriesPage() {
  const [{ profile, categories }, budgets, { user }] = await Promise.all([getAppData(), getBudgets(), getSession()]);
  const [toReview, rentRules, recipients] = await Promise.all([countToReview(user.id), listRentRules(user.id), listRecipients(user.id)]);
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
              <ShieldCheck size={15} /> À vérifier{toReview > 0 ? ` (${toReview})` : ""}
            </Link>
          }
        />
      </div>
      {toReview > 0 && (
        <Banner
          tone="warn"
          action={
            <Link href="/categories/classer" className="font-bold">
              Vérifier
            </Link>
          }
        >
          {toReview} transaction{toReview > 1 ? "s ont" : " a"} été classée{toReview > 1 ? "s" : ""} automatiquement sans assez de certitude.
        </Banner>
      )}
      <CategoriesManager categories={categories} budgetByCategory={budgetByCategory} />
      <RentSettings rules={rentRules} recipients={recipients} categories={categories} />
    </>
  );
}
