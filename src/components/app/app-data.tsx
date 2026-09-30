"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Account, Category, ForecastItem, PlaceMemoryEntry, Profile, Recurrence } from "@/lib/domain/types";

export interface AppDataInput {
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  /** Solde courant par id de compte, en centimes */
  balances: Record<string, number>;
  placeMemory: PlaceMemoryEntry[];
  recurrences: Recurrence[];
  /** Dépenses / revenus ponctuels prévus, non encore liés */
  forecastItems: ForecastItem[];
}

export interface AppData extends AppDataInput {
  activeAccounts: Account[];
  activeCategories: Category[];
  accountById: Map<string, Account>;
  categoryById: Map<string, Category>;
  netWorthCents: number;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ value, children }: { value: AppDataInput; children: ReactNode }) {
  const data = useMemo<AppData>(() => {
    const activeAccounts = value.accounts.filter((a) => !a.archivedAt);
    return {
      ...value,
      activeAccounts,
      activeCategories: value.categories.filter((c) => !c.archivedAt),
      accountById: new Map(value.accounts.map((a) => [a.id, a])),
      categoryById: new Map(value.categories.map((c) => [c.id, c])),
      netWorthCents: activeAccounts.reduce((sum, a) => sum + (value.balances[a.id] ?? 0), 0),
    };
  }, [value]);
  return <AppDataContext.Provider value={data}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const data = useContext(AppDataContext);
  if (!data) throw new Error("useAppData doit être utilisé sous <AppDataProvider>");
  return data;
}

