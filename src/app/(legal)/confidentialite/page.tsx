import type { Metadata } from "next";
import { LegalShell } from "../legal-shell";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function ConfidentialitePage() {
  return (
    <LegalShell title="Politique de confidentialité" updated="22 octobre 2026">
      <section>
        <p>
          Pecunia est une application de suivi de budget à usage strictement personnel. Elle est conçue, hébergée et utilisée par une seule personne, qui en est
          aussi la seule utilisatrice et le responsable du traitement. Elle n&apos;est pas proposée au public.
        </p>
      </section>
      <section>
        <h2>Données traitées</h2>
        <ul>
          <li>Les comptes, transactions, catégories, budgets et objectifs saisis ou importés par son utilisateur.</li>
          <li>
            Lorsque la connexion bancaire est activée : les soldes et les transactions des comptes bancaires que l&apos;utilisateur a lui-même autorisés,
            récupérés en lecture seule via le service d&apos;agrégation Enable Banking (accès aux informations de compte, norme DSP2).
          </li>
          <li>Les informations de connexion à l&apos;application (adresse e-mail, mot de passe chiffré, clés d&apos;accès).</li>
        </ul>
      </section>
      <section>
        <h2>Finalité</h2>
        <p>Ces données servent uniquement à afficher et analyser les finances personnelles de l&apos;utilisateur. Elles ne sont ni vendues, ni partagées, ni utilisées à des fins publicitaires.</p>
      </section>
      <section>
        <h2>Accès en lecture seule</h2>
        <p>
          Pecunia ne peut ni effectuer de paiement, ni de virement, ni modifier quoi que ce soit sur les comptes bancaires. Le consentement donné à la banque est
          limité dans le temps et peut être révoqué à tout moment, depuis l&apos;application de la banque ou depuis Pecunia.
        </p>
      </section>
      <section>
        <h2>Hébergement et conservation</h2>
        <p>
          Les données sont stockées dans une base PostgreSQL privée et servies par une application hébergée en Europe. Elles sont conservées tant que
          l&apos;utilisateur les garde dans l&apos;application et peuvent être exportées ou supprimées par lui à tout moment.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          Pour toute question relative aux données personnelles :{" "}
          <a href="mailto:tomballester1812@gmail.com" className="font-semibold text-accent-700">
            tomballester1812@gmail.com
          </a>
          .
        </p>
      </section>
    </LegalShell>
  );
}
