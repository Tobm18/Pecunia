import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Récurrences" };

export default function RecurrencesPage() {
  return (
    <ComingSoon
      kicker="Gestion"
      title="Récurrences"
      features={[
        "Abonnements, loyer, salaire et virements d'épargne programmés",
        "Occurrences générées automatiquement et validées d'un geste",
        "Coût mensuel et annuel des abonnements",
      ]}
    />
  );
}
