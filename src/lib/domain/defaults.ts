/** Données créées à la première connexion d'un utilisateur. */
import type { AccountType } from "./types";

export interface DefaultCategory {
  name: string;
  icon: string;
  color: string;
  isIncome?: boolean;
}

/** Catégories prédéfinies (ordre des tuiles de saisie des maquettes). */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Courses", icon: "cart", color: "#3b82c4" },
  { name: "Restaurants", icon: "utensils", color: "#ef8354" },
  { name: "Transport", icon: "bus", color: "#8b7fd6" },
  { name: "Logement", icon: "home", color: "#3a4152" },
  { name: "Abonnements", icon: "repeat", color: "#d9579a" },
  { name: "Loisirs", icon: "ticket", color: "#7cb860" },
  { name: "Santé", icon: "heart", color: "#4bb3c8" },
  { name: "Épargne", icon: "piggy", color: "#e0a030" },
  { name: "Autres", icon: "more", color: "#a89f91" },
  { name: "Salaire", icon: "briefcase", color: "#16806b", isIncome: true },
];

export const DEFAULT_ACCOUNT: { name: string; type: AccountType; icon: string; color: string } = {
  name: "Compte courant",
  type: "current",
  icon: "card",
  color: "#2f3a4f",
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  current: "Courant",
  savings: "Épargne",
  cash: "Espèces",
};

/** Par défaut, l'épargne est « hors budget », le reste « dans le budget ». */
export const defaultInBudget = (type: AccountType) => type !== "savings";

export const ACCOUNT_ICONS = ["card", "bank", "plane", "wallet", "piggy", "home", "gift"] as const;
export const CATEGORY_ICONS = [
  "cart", "utensils", "bus", "home", "repeat", "ticket", "heart", "piggy", "more", "briefcase",
  "gift", "shirt", "book", "baby", "paw", "fuel", "phone", "plane",
] as const;
export const PALETTE = [
  "#2f3a4f", "#5b6bd6", "#e08a2e", "#5f9a57", "#3b82c4", "#ef8354", "#8b7fd6",
  "#d9579a", "#7cb860", "#4bb3c8", "#e0a030", "#a89f91", "#16806b", "#c0504d",
];
