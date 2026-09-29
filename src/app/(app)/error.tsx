"use client";

import { Button, Card } from "@/components/ui/primitives";

/** Échec de chargement : message sans jargon + nouvelle tentative sans recharger l'app. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-md text-center">
      <p className="font-bold">Impossible de charger - réessayer</p>
      <p className="mt-1 text-sm text-n-600">Vérifie ta connexion puis relance le chargement.</p>
      <Button variant="primary" onClick={reset} className="mt-4">
        Réessayer
      </Button>
    </Card>
  );
}
