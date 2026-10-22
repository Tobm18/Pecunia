# Pecunia

> Chaque euro à sa place.

Pecunia remplace le fichier Excel de suivi des finances personnelles : la saisie reste manuelle (2–3 sessions par mois), mais elle est plus rapide (mémoire des lieux, saisie en rafale) et plus utile (tableau de bord, budgets, alertes). Web et mobile, une seule base de code.

Références : cahier des charges, SFD (spécifications fonctionnelles détaillées) et maquettes v3 (mobile et web).

## Stack

| Couche | Choix |
| --- | --- |
| Front | Next.js 16 (App Router, Server Components, Server Actions), React 19, Tailwind CSS 4 |
| Base de données | PostgreSQL (Neon en production), requêtes via Drizzle ORM |
| Authentification | Better Auth : email + mot de passe (aucun envoi d'email) |
| Hébergement | Vercel |
| Graphiques | Recharts + sparklines SVG |
| Tests | Vitest : logique métier, et couche de données sur PostgreSQL en mémoire (PGlite) |

## Démarrer

```bash
npm install
cp .env.example .env.local   # renseigner DATABASE_URL et BETTER_AUTH_SECRET
npm run db:migrate           # crée les tables (relançable sans risque)
npm run dev                  # http://localhost:3000
```

Base locale : n'importe quel PostgreSQL 15+, par exemple
`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pecunia postgres:17-alpine`
puis `DATABASE_URL=postgres://postgres:pecunia@localhost:5432/postgres`.

### Mise en production (Vercel + Neon)

1. Projet Vercel relié au dépôt, base Neon ajoutée depuis l'onglet **Storage** (offre gratuite, région `fra1`) : `DATABASE_URL` et `DATABASE_URL_UNPOOLED` sont créées automatiquement.
2. Variables à ajouter : `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL` (URL de production) et `NEXT_PUBLIC_ALLOW_SIGNUP`.
3. Migrations : `vercel env pull .env.production.local`, puis `node --env-file=.env.production.local scripts/migrate.mjs`.
4. Créer son compte sur `/inscription`, puis passer `NEXT_PUBLIC_ALLOW_SIGNUP=false` et redéployer. À la première connexion, l'application crée le profil, les catégories par défaut et un compte courant.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm test` | Tests (logique métier et couche de données) |
| `npm run db:migrate` | Applique les migrations SQL de `db/migrations/` pas encore exécutées |
| `npm run typecheck` | Vérification TypeScript |

## Architecture

```
db/migrations/           Schéma SQL (PostgreSQL standard), appliqué par scripts/migrate.mjs
src/lib/domain/          Logique métier pure et testée : montants, dates, KPI, budgets,
                         mémoire des lieux, construction des saisies, CSV
src/lib/db/              Connexion et schéma Drizzle (miroir du SQL)
src/lib/auth.ts          Better Auth (sessions en base, cookies, passkeys, clés d'API)
src/lib/data/            Accès aux données : lectures (queries.ts) et mutations validées
                         par zod (actions.ts…), toujours filtrées sur l'utilisateur connecté
src/components/          UI : primitives, navigation, saisie, transactions, comptes, graphiques
src/app/(auth)/          Connexion, inscription
src/app/(app)/           Écrans : accueil, saisie, transactions, comptes, budgets, catégories, paramètres
src/app/api/integrations/ Applications reliées (G Koi À Faire), authentifiées par clé d'API
src/proxy.ts             Redirection vers /login sans cookie de session
```

### Règles métier structurantes (voir `src/lib/domain`)

- **Les virements ne comptent jamais** dans les dépenses, revenus, budgets ou taux d'épargne. Les régularisations non plus. Ces règles sont couvertes par des tests.
- Les montants sont stockés en **centimes entiers**, signés du point de vue du compte (sortie < 0).
- Un virement = **deux lignes** liées par `transfer_id`. Donc solde = solde initial + somme des lignes du compte (vue SQL `account_balances`).
- Budget : montant fixe, ou pourcentage du revenu de référence. Seuils à 80 % (orange) et 100 % (rouge). Le budget global porte sur toutes les dépenses des comptes « dans le budget ».
- « Début du mois » (1 à 28) : si J > 1, le mois budgétaire M va du J du mois M−1 au J−1 du mois M.

### Isolation des données et portabilité

- Pas de RLS : chaque requête de `src/lib/data` filtre sur `user_id`. Des clés étrangères composites `(id, user_id)` empêchent en plus de référencer le compte ou la catégorie d'un autre utilisateur. `src/lib/data/data-layer.test.ts` vérifie cette isolation action par action.
- Toutes les tables métier dépendent de `user` avec suppression en cascade : supprimer l'utilisateur efface toutes ses données.
- Le schéma est du PostgreSQL standard : Neon, un Postgres auto-hébergé ou tout autre hébergeur conviennent, en changeant seulement `DATABASE_URL`.
- Export complet à tout moment depuis Paramètres : CSV des transactions, sauvegarde JSON intégrale.

## Avancement

### MVP (v1) - livré

- [x] Authentification : email + mot de passe ou **passkey** (Face ID, Touch ID : bouton dédié et suggestion dans le champ email, gestion dans Paramètres → Passkeys, migration `0003_passkeys.sql`), messages neutres. Pas d'envoi d'email : ni lien magique ni réinitialisation du mot de passe. Les passkeys sont liées au domaine de production (`BETTER_AUTH_URL`) : elles ne marchent pas sur une URL de prévisualisation Vercel
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
- [x] **Suppression du compte utilisateur** (Paramètres), confirmée par l'email ou « SUPPRIMER »

### Application reliée : G Koi À Faire

[G Koi À Faire](https://g-koi-a-faire.tballester.fr) (liste de tâches et d'achats) envoie à Pecunia ses achats et réparations chiffrés, et reçoit en retour ce qu'on peut vraiment dépenser ce mois-ci (migration `0002_wishes_api_keys.sql`).

- **Souhaits** (`wishes`) : la liste envoyée par G Koi remplace la précédente. Chaque souhait est **proposé** dans le Prévisionnel, au mois de son échéance (ou au mois en cours), sur le compte principal : **oui** crée une dépense prévue liée au souhait, **non** le refuse pour le mois, **modifier** change montant, date ou compte.
- **Marge renvoyée** : solde prévu en fin de mois des comptes « dans le budget », souhaits non comptés, moins un **coussin de sécurité** réglable dans Paramètres.
- **Boucle fermée** : quand une vraie dépense est rapprochée (« Lier » à la saisie, libellé différent accepté si le montant est à ±25 % sous 45 jours), G Koi coche l'achat au montant réellement payé, puis le souhait disparaît de Pecunia.
- **Clé d'API** (Better Auth, plugin `api-key`) : créée et révoquée dans Paramètres → « Applications reliées », affichée une seule fois, limitée à la permission `wishes:sync`. Côté G Koi : `npx wrangler secret put PECUNIA_API_KEY`.
- API : `GET /api/integrations/wishes` (rapport : marge et état de chaque souhait), `PUT` (synchronise la liste puis renvoie le rapport). Clé dans l'en-tête `x-api-key` ou `Authorization: Bearer`. Les requêtes s'exécutent au nom du propriétaire de la clé, avec le même filtrage par utilisateur que l'app.

### Interface et mouvement

Principes d'interface « fluide » à la manière d'Apple (`src/lib/motion/spring.ts`) :

- **Ressorts** définis par un amortissement et une réactivité, sans rebond par défaut, interruptibles et repris depuis la position affichée (une modale en train de se fermer peut être rattrapée).
- **Feuilles mobiles** : entrée et sortie par le même chemin, poignée pour tirer vers le bas, suivi 1:1, résistance élastique vers le haut, l'élan au lâcher décide entre fermer et revenir.
- **Glisser pour supprimer** une transaction (écrans tactiles) : seuil de 10 px avant de choisir entre glisser et défiler, projection de l'élan, vibration discrète au seuil.
- **Retour immédiat** à l'appui sur les boutons, puces et lignes ; barre du bas en matériau translucide ; typographie resserrée sur les grands textes.
- Préférences système respectées : réduire les animations (fondus), réduire la transparence, contraste élevé.

### Application iPhone (PWA)

Dans Safari : Partager → « Sur l'écran d'accueil ». Pecunia s'ouvre alors en plein écran, sans l'interface du navigateur. La session est distincte de celle de Safari, il faut donc se reconnecter une fois.

- Manifeste `src/app/manifest.ts` (mode `standalone`, raccourci « Nouvelle saisie »), balises iOS dans `src/app/layout.tsx`. La barre d'état prend la couleur du thème choisi.
- Logo : un P dont la boucle est un camembert de budget, avec un € découpé au centre (`src/app/icon.svg`, composant `src/components/ui/logo.tsx`). Icônes : `src/app/apple-icon.png`, `src/app/favicon.ico`, `public/icon-*.png` (dont une version adaptative Android).
- Service worker `public/sw.js`, en production seulement : écran « Pas de connexion » (`public/offline.html`) au lieu de l'erreur du navigateur, et fichiers statiques en cache. Aucune page ni donnée n'est mise en cache.
- Comme une app : champs en 16 px sur mobile (pas de zoom au toucher), pas de menu d'appui long sur les boutons et les liens, un lien de retour sur chaque sous-page.

### Restant

- [ ] Consultation hors connexion (aujourd'hui : écran « Pas de connexion »)
