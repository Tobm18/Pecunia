import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Prévisionnel" };

export default function ForecastPage() {
  return (
    <ComingSoon
      kicker="Anticipation"
      title="Prévisionnel"
      features={[
        "Solde projeté par compte sur 1, 3, 6 ou 12 mois",
        "Alerte si un compte risque de passer en négatif",
        "Dépenses et revenus ponctuels prévus, rapprochés à la saisie",
      ]}
    />
  );
}
