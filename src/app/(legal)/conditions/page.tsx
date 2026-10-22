import type { Metadata } from "next";
import { LegalShell } from "../legal-shell";

export const metadata: Metadata = { title: "Conditions d'utilisation" };

export default function ConditionsPage() {
  return (
    <LegalShell title="Conditions d'utilisation" updated="22 octobre 2026">
      <section>
        <h2>Objet</h2>
        <p>
          Pecunia est une application de suivi de budget développée et utilisée à titre personnel. Elle n&apos;est pas un service commercial et n&apos;est pas
          ouverte au public : l&apos;accès est réservé à son propriétaire.
        </p>
      </section>
      <section>
        <h2>Usage</h2>
        <ul>
          <li>L&apos;application sert à suivre, catégoriser et analyser les finances personnelles de son utilisateur.</li>
          <li>La connexion bancaire, lorsqu&apos;elle est activée, se limite à la lecture des soldes et des transactions des comptes que l&apos;utilisateur autorise.</li>
          <li>Aucun paiement ni virement ne peut être initié depuis l&apos;application.</li>
        </ul>
      </section>
      <section>
        <h2>Responsabilité</h2>
        <p>
          Pecunia est fournie telle quelle, sans garantie. Les montants et prévisions affichés sont indicatifs et ne remplacent pas les relevés officiels de la
          banque.
        </p>
      </section>
      <section>
        <h2>Données personnelles</h2>
        <p>
          Le traitement des données est décrit dans la <a href="/confidentialite" className="font-semibold text-accent-700">politique de confidentialité</a>.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          <a href="mailto:tomballester1812@gmail.com" className="font-semibold text-accent-700">
            tomballester1812@gmail.com
          </a>
        </p>
      </section>
    </LegalShell>
  );
}
