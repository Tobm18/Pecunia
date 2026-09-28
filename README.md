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
2. **SQL Editor** : coller **tout** le fichier `supabase/migrations/20260928000000_init.sql`, sans rien sélectionner (sinon seule la sélection est exécutée), puis « Run ». Le script peut être relancé sans risque. Autre option, avec la CLI : `supabase link` puis `supabase db push`.
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

### MVP (v1) — livré

- [x] Authentification : email + mot de passe, lien magique, mot de passe oublié / réinitialisation, messages neutres
- [x] Comptes : création, liste, soldes, sparklines, détail, ajustement de solde (régularisation), « dans le budget », modification, archivage / restauration
- [x] Saisie rapide : sortie / entrée / virement, mémoire des lieux, suggestions, nature intérêts / revenu, date et compte conservés, alerte de budget à 80 % / 100 %. Feuille mobile et page web
- [x] Transactions : filtres (recherche, mois, compte, type, catégorie), regroupement par jour, modification, suppression avec confirmation
- [x] Catégories : catégories par défaut, création, modification, ordre, archivage, comptes concernés
- [x] Budgets : fixe ou %, barres de progression, alertes, report du reste, revenu de référence
- [x] Tableau de bord : KPI du mois, comptes, budget global, répartition, historique 6 / 12 mois, alertes, top lieux
- [x] Paramètres : début du mois, thème clair / sombre, export CSV, sauvegarde JSON

### Évolutions (v2)

- [ ] Saisie en lot (tableau éditable) et modèles rapides
- [ ] Import CSV avec correspondance des colonnes
- [ ] Récurrences (tables prêtes) et rapprochement avec le prévisionnel
- [ ] Prévisionnel : solde projeté par compte, alertes de solde négatif
- [ ] Objectifs d'épargne (table prête)
- [ ] Analyses : comparaisons mensuelles, classement des lieux, évolution du patrimoine
- [ ] Passkey (WebAuthn), suppression du compte utilisateur, glisser pour supprimer (mobile), mode hors connexion
