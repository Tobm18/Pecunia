# Pecunia

> Chaque euro à sa place.

Pecunia remplace le fichier Excel de suivi des finances personnelles : la saisie reste manuelle (2–3 sessions par mois), mais elle est plus rapide (mémoire des lieux, saisie en rafale) et plus utile (tableau de bord, budgets, alertes). Web et mobile, une seule base de code.

Références : cahier des charges, SFD (spécifications fonctionnelles détaillées) et maquettes v3 (mobile et web).

## Stack

| Couche | Choix |
| --- | --- |
| Front | Next.js 16 (App Router, Server Components, Server Actions), React 19, Tailwind CSS 4 |
| Back (v1) | Supabase : PostgreSQL, Auth, API. RLS sur toutes les tables |
| Graphiques | Recharts + sparklines SVG |
| Tests | Vitest (logique métier) |

## Démarrer

```bash
npm install
cp .env.example .env.local   # renseigner l'URL et la clé anon Supabase
npm run dev                  # http://localhost:3000
```

### Mise en place de Supabase

1. Créer un projet sur [supabase.com](https://supabase.com), région UE.
2. **SQL Editor** : exécuter, dans l'ordre, chaque fichier de `supabase/migrations/` (`20260928000000_init.sql`, puis `20260930000000_delete_account.sql`, puis `20261001000000_forecast_decisions.sql`, puis `20261002000000_forecast_transfers.sql`). Coller **tout** le fichier, sans rien sélectionner (sinon seule la sélection est exécutée), puis « Run ». Le script peut être relancé sans risque. Autre option, avec la CLI : `supabase link` puis `supabase db push`.
3. **Authentication → URL Configuration** :
   - Site URL : `http://localhost:3000` (puis l'URL de production) ;
   - Redirect URLs : `http://localhost:3000/auth/callback` (et l'équivalent en production).
4. **Settings → API** : copier l'URL du projet et la clé `anon` dans `.env.local`.
5. Créer son compte sur `/inscription`, puis passer `NEXT_PUBLIC_ALLOW_SIGNUP=false`. À la première connexion, l'application crée le profil, les catégories par défaut et un compte courant.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm test` | Tests unitaires de la logique métier |
| `npm run typecheck` | Vérification TypeScript |

## Architecture

```
supabase/migrations/     Schéma SQL (Postgres standard + RLS)
src/lib/domain/          Logique métier pure et testée : montants, dates, KPI, budgets,
                         mémoire des lieux, construction des saisies, CSV
src/lib/data/            Seule couche dépendante de Supabase : lectures (queries.ts) et
                         mutations validées par zod (actions.ts)
src/components/          UI : primitives, navigation, saisie, transactions, comptes, graphiques
src/app/(auth)/          Connexion, lien magique, mot de passe oublié, inscription
src/app/(app)/           Écrans : accueil, saisie, transactions, comptes, budgets, catégories, paramètres
src/proxy.ts             Rafraîchissement de session et redirection vers /login
```

### Règles métier structurantes (voir `src/lib/domain`)

- **Les virements ne comptent jamais** dans les dépenses, revenus, budgets ou taux d'épargne. Les régularisations non plus. Ces règles sont couvertes par des tests.
- Les montants sont stockés en **centimes entiers**, signés du point de vue du compte (sortie < 0).
- Un virement = **deux lignes** liées par `transfer_id`. Donc solde = solde initial + somme des lignes du compte (vue SQL `account_balances`).
- Budget : montant fixe, ou pourcentage du revenu de référence. Seuils à 80 % (orange) et 100 % (rouge). Le budget global porte sur toutes les dépenses des comptes « dans le budget ».
- « Début du mois » (1 à 28) : si J > 1, le mois budgétaire M va du J du mois M−1 au J−1 du mois M.

### Portabilité (Supabase → auto-hébergé)

- Le schéma est du PostgreSQL standard, sans trigger sur `auth.users`. L'initialisation d'un utilisateur est faite par l'application.
- Seules les politiques RLS utilisent `auth.uid()`. Des clés étrangères composites `(id, user_id)` empêchent aussi de référencer les données d'un autre utilisateur.
- Toute la dépendance à Supabase est confinée dans `src/lib/data` et `src/lib/supabase`.
- Export complet à tout moment depuis Paramètres : CSV des transactions, sauvegarde JSON intégrale.

## Avancement

### MVP (v1) - livré

- [x] Authentification : email + mot de passe, lien magique, mot de passe oublié / réinitialisation, messages neutres
- [x] Comptes : création, liste, soldes, sparklines, détail, ajustement de solde (régularisation), « dans le budget », modification, archivage / restauration
- [x] Saisie rapide : sortie / entrée / virement, mémoire des lieux, suggestions, nature intérêts / revenu, date et compte conservés, alerte de budget à 80 % / 100 %. Feuille mobile et page web
- [x] Transactions : filtres (recherche, mois, compte, type, catégorie), regroupement par jour, modification, suppression avec confirmation
- [x] Catégories : catégories par défaut, création, modification, ordre, archivage, comptes concernés
- [x] Budgets : fixe ou %, barres de progression, alertes, report du reste, revenu de référence
- [x] Tableau de bord : KPI du mois, comptes, budget global, répartition, historique 6 / 12 mois, alertes, top lieux
- [x] Paramètres : début du mois, thème clair / sombre, export CSV, sauvegarde JSON

- [x] Import CSV par compte (`/import`), détaillé plus bas

### Import CSV

Un fichier par compte. Le format de référence est celui du tableur (`Raison;Date;Recette;Depense;Total`), mais les exports bancaires avec une colonne « Montant » signée fonctionnent aussi.

1. Choisir le compte, ou le laisser deviner d'après le nom du fichier (« LivretA.csv » → Livret A), puis déposer le fichier. L'encodage est détecté automatiquement (UTF-8 ou Windows-1252 des exports Excel), comme le séparateur et les colonnes. La correspondance reste modifiable.
2. Un tableau modifiable s'affiche : date, type, libellé, catégorie ou autre compte, montant. On peut exclure, modifier, supprimer ou ajouter des lignes.
   - Les **virements** sont reconnus au nom d'un autre compte dans le libellé (« vers livretA », « livret A : essence », « recharge compte courant »).
   - Les **catégories** viennent de la mémoire des lieux, puis de mots-clés, avec « Autres » par défaut. Le filtre « À vérifier » regroupe les lignes à revoir. Changer une catégorie l'applique aux lignes de même libellé.
   - Les lignes **déjà présentes** sur le compte sont exclues par défaut : même montant, même jour, ou jusqu'à ±3 jours pour un virement. C'est notamment le cas du côté d'un virement créé lors de l'import de l'autre compte.
3. Le **solde initial** est déduit de la colonne Total, et le solde après import est comparé au total du fichier.
4. « Valider le bloc » : l'import est ré-exécutable, les lignes identiques déjà enregistrées sont ignorées.

Conseil : importer d'abord le compte courant (les virements vers l'épargne créent aussi leur ligne côté épargne), puis le livret. Au 2e import, ces virements apparaissent comme « Déjà présentes ».

### Évolutions (v2) - livrées

- [x] **Récurrences** (`/recurrences`) : loyer, salaire, abonnements, virements programmés ; fréquence hebdo / mensuelle / trimestrielle / annuelle ; échéances à venir avec bascule ✓ (crée ou retire la transaction liée) ; **rapprochement automatique** des transactions déjà saisies ou importées (libellé proche, montant ±10 %) ; coût mensuel et annuel des abonnements
- [x] **Modèles rapides** dans la saisie : une puce par récurrence active, qui pré-remplit tout le formulaire
- [x] **Prévisionnel validé à la main** (`/prevision`, migration `20261001000000_forecast_decisions.sql`) : pour chaque mois, les échéances des récurrences non réalisées sont **retenues d'office** (refusables ou modifiables pour le mois), et une ligne par budget est **proposée** (hors part couverte par une récurrence ; pour le mois en cours, le reste à dépenser) : **oui**, **non** ou **modifier** (montant, compte, pour ce mois seulement), ou « Tout accepter ». On ajoute aussi des **entrées, sorties ou virements internes prévus, pour 1 à 36 mois**, modifiables ou supprimables mois par mois (ou toute la série). Seules les lignes retenues comptent dans le solde projeté ; les budgets à valider donnent le solde « si tout était accepté ». Courbe par compte, bilan du mois, alertes de solde négatif
- [x] **Rapprochement à la saisie** : une saisie qui correspond à une dépense prévue propose « Lier » (elle passe à « réalisée ») ou « Ignorer »
- [x] **Objectifs d'épargne** (écran Comptes et détail du compte) : progression, statut « En avance » / « En retard » selon les virements récurrents programmés, manque à l'échéance
- [x] **Analyses** (`/analyses`) : taux d'épargne, patrimoine sur 12 mois, épargne cumulée par compte (virements / intérêts), comparaison avec le mois précédent, évolution d'une catégorie, classement des lieux
- [x] Tableau de bord : bloc **« À venir »** (5 prochaines échéances et dépenses prévues)
- [x] **Suppression du compte utilisateur** (Paramètres), confirmée par l'email ou « SUPPRIMER » ; nécessite la migration `20260930000000_delete_account.sql`

### Restant

- [ ] Passkey (WebAuthn), glisser pour supprimer (mobile), mode hors connexion
