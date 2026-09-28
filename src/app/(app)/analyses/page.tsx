import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Analyses" };

export default function AnalysesPage() {
  return (
    <ComingSoon
      kicker="Gestion"
      title="Analyses"
      features={[
        "Comparaison avec le mois dernier par catégorie",
        "Classement des lieux et évolution d'une catégorie sur 12 mois",
        "Épargne cumulée (virements / intérêts) et évolution du patrimoine",
      ]}
    />
  );
}
