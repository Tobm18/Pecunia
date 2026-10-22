/**
 * Couche de données contre un vrai PostgreSQL (PGlite, en mémoire) avec le schéma de
 * db/migrations. Sans RLS, l'isolation entre utilisateurs repose sur les filtres user_id
 * et les clés étrangères composites : ces tests la vérifient action par action.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { EntryInput } from "@/lib/domain/entries";

const pg = new PGlite();
const db = drizzle(pg, { schema });
let current: { id: string; email: string; name: string } | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db, schema }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => (current ? { user: current } : null), signOut: async () => undefined } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ set: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const q = await import("./queries");
const actions = await import("./actions");
const planning = await import("./planning-actions");
const wishes = await import("./wishes");

const alice = { id: "00000000-0000-4000-8000-00000000000a", email: "alice@example.com", name: "Alice" };
const bob = { id: "00000000-0000-4000-8000-00000000000b", email: "bob@example.com", name: "" };
const as = (u: typeof alice) => {
  current = u;
};

const entry = (over: Partial<EntryInput>): EntryInput => ({
  kind: "out",
  amount: "12,50",
  place: "Boulangerie",
  categoryId: null,
  accountId: null,
  toAccountId: null,
  nature: "income",
  date: "2026-10-01",
  note: "",
  ...over,
});

beforeAll(async () => {
  // toutes les migrations, dans l'ordre (comme scripts/migrate.mjs)
  const dir = path.join(process.cwd(), "db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(path.join(dir, file), "utf8"));
  for (const u of [alice, bob]) await db.insert(schema.user).values({ id: u.id, email: u.email, name: u.name });
});

describe("initialisation et lecture", () => {
  it("sans session, redirige vers /login", async () => {
    current = null;
    await expect(q.getSession()).rejects.toThrow("redirect:/login");
  });

  it("crée profil, catégories et compte par défaut à la 1re connexion", async () => {
    as(alice);
    const profile = await q.getProfile();
    expect(profile.email).toBe(alice.email);
    expect(profile.displayName).toBe("Alice");
    expect((await q.getAccounts()).length).toBe(1);
    expect((await q.getCategories()).length).toBeGreaterThan(3);
    as(bob);
    expect((await q.getProfile()).displayName).toBeNull();
    // une 2e lecture ne réinitialise rien
    await q.getProfile();
    expect((await q.getAccounts()).length).toBe(1);
  });
});

describe("isolation entre utilisateurs", () => {
  it("chacun ne voit et ne modifie que ses données", async () => {
    as(alice);
    const [aliceAccount] = await q.getAccounts();
    const aliceCategory = (await q.getCategories()).find((c) => !c.isIncome)!;
    const created = await actions.createEntry(entry({ accountId: aliceAccount!.id, categoryId: aliceCategory.id }));
    expect(created.ok).toBe(true);
    const [aliceTx] = await q.getTransactions();
    expect(aliceTx!.amountCents).toBe(-1250);
    expect((await q.getBalances()).get(aliceAccount!.id)?.balanceCents).toBe(-1250);
    expect((await q.getPlaceMemory())[0]?.place).toBe("Boulangerie");

    as(bob);
    expect(await q.getTransactions()).toEqual([]);
    expect((await q.getAccounts()).map((a) => a.id)).not.toContain(aliceAccount!.id);
    expect((await q.getBalances()).has(aliceAccount!.id)).toBe(false);
    expect(await q.getPlaceMemory()).toEqual([]);

    // écritures visant les lignes d'Alice : refusées ou sans effet
    expect((await actions.updateAccount(aliceAccount!.id, { name: "Piraté", color: "#000000", icon: "card" })).ok).toBe(false);
    expect((await actions.setAccountArchived(aliceAccount!.id, true)).ok).toBe(false);
    expect((await actions.updateCategory(aliceCategory.id, { name: "Piraté", color: "#000000", icon: "x", isIncome: false, restrictedAccountIds: [] })).ok).toBe(false);
    expect((await actions.saveBudget({ categoryId: aliceCategory.id, mode: "fixed", amount: "100" })).ok).toBe(false);
    expect((await actions.createEntry(entry({ accountId: aliceAccount!.id, categoryId: aliceCategory.id }))).ok).toBe(false);
    await actions.deleteTransaction(aliceTx!.id);
    expect((await actions.updateTransaction(aliceTx!.id, entry({ accountId: aliceAccount!.id }))).ok).toBe(false);

    as(alice);
    expect((await q.getAccounts())[0]!.name).toBe(aliceAccount!.name);
    expect((await q.getCategories()).find((c) => c.id === aliceCategory.id)!.name).toBe(aliceCategory.name);
    expect(await q.getBudgets()).toEqual([]);
    expect((await q.getTransactions()).map((t) => t.id)).toEqual([aliceTx!.id]);
  });
});

describe("écritures", () => {
  it("virement : deux lignes liées, modifiées et supprimées ensemble", async () => {
    as(alice);
    const created = await actions.createAccount({
      name: "Livret A",
      type: "savings",
      initialBalance: "1000",
      initialBalanceDate: "2026-01-01",
      color: "#148270",
      icon: "piggy",
      today: "2026-10-22",
    });
    expect(created.ok).toBe(true);
    const [current, savings] = await q.getAccounts();
    const transfer = entry({ kind: "transfer", amount: "200", place: "Épargne", accountId: current!.id, toAccountId: savings!.id });
    expect((await actions.createEntry(transfer)).ok).toBe(true);
    const lines = (await q.getTransactions()).filter((t) => t.type === "transfer");
    expect(lines.map((t) => t.amountCents).sort()).toEqual([-20000, 20000]);
    expect(lines[0]!.transferId).toBe(lines[1]!.transferId);

    expect((await actions.updateTransaction(lines[0]!.id, { ...transfer, amount: "250" })).ok).toBe(true);
    const updated = (await q.getTransactions()).filter((t) => t.type === "transfer");
    expect(updated.map((t) => t.amountCents).sort()).toEqual([-25000, 25000]);
    expect((await q.getBalances()).get(savings!.id)?.balanceCents).toBe(100000 + 25000);

    expect((await actions.deleteTransaction(updated[0]!.id)).ok).toBe(true);
    expect((await q.getTransactions()).filter((t) => t.type === "transfer")).toEqual([]);
  });

  it("catégories : nom en double refusé, ordre modifiable", async () => {
    as(alice);
    const first = (await q.getCategories())[0]!;
    const dup = await actions.createCategory({ name: first.name.toUpperCase(), color: "#123456", icon: "x", isIncome: false, restrictedAccountIds: [] });
    expect(dup).toEqual({ ok: false, error: "Ce nom existe déjà" });
    expect((await actions.moveCategory(first.id, "down")).ok).toBe(true);
    expect((await q.getCategories()).filter((c) => !c.archivedAt)[1]!.id).toBe(first.id);
  });

  it("budget : création puis mise à jour (upsert) puis suppression", async () => {
    as(alice);
    const cat = (await q.getCategories()).find((c) => !c.isIncome)!;
    expect((await actions.saveBudget({ categoryId: cat.id, mode: "fixed", amount: "300" })).ok).toBe(true);
    expect((await actions.saveBudget({ categoryId: cat.id, mode: "percent", amount: "12,5" })).ok).toBe(true);
    const [b] = await q.getBudgets();
    expect(b).toMatchObject({ mode: "percent", percent: 12.5, amountCents: 0 });
    expect((await actions.saveBudget({ categoryId: cat.id, mode: "fixed", amount: "" })).ok).toBe(true);
    expect(await q.getBudgets()).toEqual([]);
  });

  it("prévisionnel : séries, décisions (upsert) et récurrence réalisée", async () => {
    as(alice);
    const [acc] = await q.getAccounts();
    const cat = (await q.getCategories()).find((c) => !c.isIncome)!;
    const planned = { label: "Assurance", amount: "40", direction: "out" as const, date: "2026-11-05", accountId: acc!.id, today: "2026-10-22" };
    expect((await planning.createForecastItems({ ...planned, months: 3 })).ok).toBe(true);
    const items = await q.getForecastItems();
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.seriesId)).size).toBe(1);
    expect((await planning.deleteForecastItem(items[1]!.id, true)).ok).toBe(true);
    expect(await q.getForecastItems()).toHaveLength(1);

    const key = `bud:${cat.id}:2026-11`;
    expect((await planning.decideProposals([{ sourceKey: key, month: "2026-11", status: "rejected" }])).ok).toBe(true);
    expect((await planning.decideProposals([{ sourceKey: key, month: "2026-11", status: "accepted", amount: "55" }])).ok).toBe(true);
    const decisions = await q.getForecastDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ status: "accepted", amountCents: 5500 });

    const rec = await planning.saveRecurrence(null, {
      type: "out",
      label: "Netflix",
      amount: "13,49",
      categoryId: cat.id,
      accountId: acc!.id,
      toAccountId: null,
      frequency: "monthly",
      dueDay: 3,
      startDate: "2026-01-03",
      endDate: null,
      isSubscription: true,
    });
    expect(rec.ok).toBe(true);
    const [r] = await q.getRecurrences();
    expect((await planning.setOccurrenceDone(r!.id, "2026-10-03", true, null)).ok).toBe(true);
    const done = (await q.getTransactions()).find((t) => t.recurrenceId === r!.id)!;
    expect(done.amountCents).toBe(-1349);
    expect((await planning.setOccurrenceDone(r!.id, "2026-10-03", false, done.id)).ok).toBe(true);
    expect((await q.getTransactions()).some((t) => t.recurrenceId === r!.id)).toBe(false);
  });

  it("profil : préférences enregistrées", async () => {
    as(alice);
    expect((await actions.updateProfile({ monthStartDay: 25, referenceIncome: "2500", displayName: "Al" })).ok).toBe(true);
    expect(await q.getProfile()).toMatchObject({ monthStartDay: 25, referenceIncomeCents: 250000, displayName: "Al" });
  });
});

describe("suppression du compte", () => {
  it("efface l'utilisateur et toutes ses données, sans toucher aux autres", async () => {
    as(bob);
    const [acc] = await q.getAccounts();
    await actions.createEntry(entry({ accountId: acc!.id, categoryId: (await q.getCategories())[0]!.id }));
    expect((await planning.deleteMyAccount("pas bon")).ok).toBe(false);
    await expect(planning.deleteMyAccount("SUPPRIMER")).rejects.toThrow("redirect:/login");

    for (const table of [schema.profiles, schema.accounts, schema.categories, schema.transactions] as const) {
      const rows = await db.select().from(table);
      expect(rows.every((r) => ("user_id" in r ? r.user_id : r.id) === alice.id)).toBe(true);
    }
    expect(await db.select().from(schema.user).where(eq(schema.user.id, bob.id))).toEqual([]);
    as(alice);
    expect((await q.getTransactions()).length).toBeGreaterThan(0);
  });
});

describe("souhaits (G Koi À Faire)", () => {
  const list = [
    { externalId: "g1", title: "Changer les 2 pneus avant", amountCents: 12200, priority: "high" as const, dueDate: null },
    { externalId: "g2", title: "Racheter une bouilloire", amountCents: 3500 },
  ];

  it("synchronise la liste de l'utilisateur, sans toucher aux autres", async () => {
    as(alice);
    expect((await wishes.syncWishes({ wishes: list })).ok).toBe(true);
    expect((await q.getWishes()).map((w) => w.externalId)).toEqual(["g1", "g2"]);
    as(bob);
    expect(await q.getWishes()).toEqual([]);
    expect((await wishes.syncWishes({ wishes: [] })).ok).toBe(true);
    as(alice);
    expect(await q.getWishes()).toHaveLength(2);
  });

  it("refuse une liste invalide", async () => {
    as(alice);
    expect((await wishes.syncWishes({ wishes: [{ externalId: "x", title: "", amountCents: -1 }] })).ok).toBe(false);
  });

  it("accepter crée une ligne prévue liée ; le souhait disparu emporte sa ligne non réalisée", async () => {
    as(alice);
    const [pneus] = await q.getWishes();
    const month = (await wishes.wishReport()).month;
    expect((await planning.decideProposals([{ sourceKey: `wish:${pneus!.id}:${month}`, month, status: "accepted", amount: "130" }])).ok).toBe(true);
    const items = (await q.getForecastItems()).filter((f) => f.wishId === pneus!.id);
    expect(items).toMatchObject([{ status: "planned", amountCents: -13000, label: "Changer les 2 pneus avant" }]);

    const report = await wishes.wishReport();
    expect(report.wishes.find((w) => w.externalId === "g1")).toMatchObject({ state: "planned", amountCents: 13000 });
    expect(report.wishes.find((w) => w.externalId === "g2")).toMatchObject({ state: "proposed", amountCents: 3500 });

    // pneus faits ou abandonnés dans G Koi À Faire : il n'est plus dans la liste
    await wishes.syncWishes({ wishes: [list[1]!] });
    expect((await q.getForecastItems()).some((f) => f.label === "Changer les 2 pneus avant")).toBe(false);
  });

  it("refuser pour le mois", async () => {
    as(alice);
    const [bouilloire] = await q.getWishes();
    const month = (await wishes.wishReport()).month;
    expect((await planning.decideProposals([{ sourceKey: `wish:${bouilloire!.id}:${month}`, month, status: "rejected" }])).ok).toBe(true);
    expect((await wishes.wishReport()).wishes).toMatchObject([{ externalId: "g2", state: "rejected" }]);
  });
});
