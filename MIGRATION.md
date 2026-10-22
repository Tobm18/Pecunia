# Plan de migration : Supabase → Neon + Better Auth + Drizzle (hébergé sur Vercel)

> **Statut : appliqué** sur la branche `migration/neon-better-auth`. Écarts par rapport au plan :
>
> - Driver `postgres` (postgres.js) au lieu de `@neondatabase/serverless` : transactions SQL complètes et compatible avec n'importe quel PostgreSQL.
> - Schéma Drizzle des tables métier avec des clés en snake_case : `mappers.ts` et le format de la sauvegarde JSON sont inchangés.
> - Migrations SQL appliquées par `scripts/migrate.mjs` (`npm run db:migrate`), pas par drizzle-kit.
> - Clés étrangères `user_id → user(id) on delete cascade` : la suppression du compte se résume à supprimer l'utilisateur.
> - Pas d'étape 8 : les données de l'ancien projet Supabase n'ont pas été reprises.

Objectif : faire tourner Pecunia sans Supabase, avec des services gratuits.

| Brique | Avant | Après |
|---|---|---|
| Base de données | Supabase Postgres | **Neon** (Postgres serverless, offre gratuite) |
| Accès aux données | `supabase.from(...)` (PostgREST) | **Drizzle ORM** + driver `@neondatabase/serverless` |
| Authentification | Supabase Auth | **Better Auth** (mot de passe + lien magique + réinitialisation) |
| Isolation par utilisateur | RLS via `auth.uid()` | Filtre `user_id` systématique dans la couche données |
| E-mails | SMTP Supabase | **Resend** (3 000 e-mails/mois gratuits) |
| Hébergement | Vercel | Vercel (inchangé) |

## 0. Périmètre : ce qui change, ce qui ne change pas

**À réécrire**

- `src/lib/data/queries.ts` : 15 appels `.from(...)` + `getSession()`
- `src/lib/data/actions.ts` : 23 appels
- `src/lib/data/planning-actions.ts` : 18 appels + RPC `delete_my_account`
- `src/lib/data/import-actions.ts` : 4 appels
- `src/app/api/export/[format]/route.ts` : 5 appels
- `src/proxy.ts` : protection des routes
- `src/lib/supabase/` : à supprimer
- Écrans d'authentification : `login-form.tsx`, `signup-form.tsx`, `mot-de-passe-oublie/page.tsx`, `auth/reinitialiser/page.tsx`, `auth/callback/route.ts`
- `supabase/migrations/*.sql` : à adapter (voir étape 2)
- `.env.example`, `README.md`

**Inchangé** : `src/lib/domain/*`, `mappers.ts` (au pire quelques ajustements de noms de colonnes), `views.ts`, tous les composants d'UI, les graphiques, les tests du domaine.

**Principe** : le contrat des fonctions exportées (`getAccounts()`, `getTransactions()`, les server actions et leur `ActionResult`) ne bouge pas. L'UI ne doit pas voir la migration.

---

## 1. Préparation (30 min)

1. Créer une branche : `git checkout -b migration/neon-better-auth`.
2. Créer un projet **Neon** (région UE, Francfort). Récupérer deux chaînes de connexion :
   - `DATABASE_URL` (pooled, pour l'app) ;
   - `DATABASE_URL_UNPOOLED` (directe, pour les migrations).
3. Créer un compte **Resend**, générer une clé API (`RESEND_API_KEY`). Sans domaine vérifié, Resend n'envoie qu'à l'adresse du propriétaire du compte. C'est suffisant pour un usage personnel.
4. Générer un secret : `openssl rand -base64 32` → `BETTER_AUTH_SECRET`.
5. Si tu as déjà des données dans Supabase : **les exporter maintenant** (voir étape 8) et garder le projet Supabase intact jusqu'à la fin.

Nouvelles variables d'environnement (`.env.example`) :

```
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://.../neondb?sslmode=require
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
RESEND_API_KEY=re_...
MAIL_FROM="Pecunia <onboarding@resend.dev>"
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_ALLOW_SIGNUP=true
```

Les variables `NEXT_PUBLIC_SUPABASE_*` disparaissent.

## 2. Adapter le schéma SQL (1 h)

Le schéma est du Postgres standard : peu de choses à toucher.

**Modifications à faire dans les migrations**

1. **Supprimer `auth.uid()`** : sur Neon le schéma `auth` n'existe pas, donc `create policy ... auth.uid()` plante.
   - Choix recommandé : **supprimer toute la RLS** et filtrer par `user_id` dans le code (étape 5). C'est plus simple avec un pool de connexions HTTP/serverless.
   - Alternative : conserver la RLS et ouvrir une transaction par requête avec `set_config('app.user_id', ..., true)`, en redéfinissant `auth.uid()`. Plus lourd, plus fragile avec le driver serverless. Déconseillé.
2. **Supprimer `delete_my_account()`** et son `delete from auth.users`. La suppression devient une action serveur : un `delete` en cascade puis la suppression de l'utilisateur Better Auth (étape 6).
3. **Vues** `account_balances` et `place_memory` : retirer `with (security_invoker = true)`, qui n'a de sens qu'avec la RLS. Elles portent déjà `user_id`, donc on filtrera dessus.
4. **Clé étrangère `profiles.id`** : vérifier si elle référence `auth.users(id)`. Si oui, la retirer ou la repointer vers la table `user` de Better Auth.

**Type des identifiants**

Better Auth génère par défaut des identifiants texte, alors que tes tables utilisent `uuid`. Deux options :

- Configurer Better Auth pour générer des UUID : `advanced: { database: { generateId: "uuid" } }`. **Recommandé**, car aucune colonne `user_id` ne change de type.
- Ou passer toutes les colonnes `user_id` en `text`. Plus invasif.

**Livrables**

- Un nouveau dossier `db/migrations/` (ou on garde `supabase/migrations/` historique en archive dans `docs/legacy-supabase/`).
- Un fichier consolidé `0001_init.sql` sans RLS, avec toutes les évolutions : `forecast_decisions`, `series_id`, `forecast_transfers`.
- Les tables Better Auth sont générées par sa CLI (étape 4).

## 3. Installer Drizzle et la connexion (1 h)

```bash
npm i drizzle-orm @neondatabase/serverless
npm i -D drizzle-kit
```

Créer :

- `src/lib/db/index.ts` : client Drizzle, importé uniquement côté serveur (`import "server-only"`).
- `src/lib/db/schema.ts` : définition des tables. Générable depuis la base avec `drizzle-kit pull` après avoir appliqué `0001_init.sql`, puis relue à la main.
- `drizzle.config.ts` : pointe sur `DATABASE_URL_UNPOOLED`.

Points d'attention :

- **Montants** en `bigint` : dans Drizzle, utiliser `bigint({ mode: "number" })`. Les centimes restent très en dessous de 2^53.
- **Enums** : `pgEnum` pour `account_type`, `budget_mode`, `transaction_type`, `recurrence_frequency`, `forecast_status`.
- **Dates** : les colonnes `date` doivent rester des chaînes ISO (`mode: "string"`), pour correspondre à ce qu'attendent `mappers.ts` et `lib/domain/dates.ts`.
- **Pagination** : la limite de 1000 lignes de PostgREST (`const PAGE = 1000` dans `queries.ts`) disparaît. On peut supprimer la boucle de pagination.
- Appliquer la migration sur Neon : `psql "$DATABASE_URL_UNPOOLED" -f db/migrations/0001_init.sql`, ou `drizzle-kit migrate`.

## 4. Installer Better Auth (2 h)

```bash
npm i better-auth resend
npx @better-auth/cli generate   # génère le schéma des tables user/session/account/verification
```

Créer `src/lib/auth.ts` :

- Adaptateur Drizzle (`drizzleAdapter(db, { provider: "pg" })`).
- `emailAndPassword: { enabled: true, sendResetPassword }` : envoi du mail de réinitialisation via Resend.
- Plugin `magicLink({ sendMagicLink })` : remplace `signInWithOtp`.
- `disableSignUp` piloté par `NEXT_PUBLIC_ALLOW_SIGNUP` (conserve la logique « usage personnel »).
- Plugin `nextCookies()` pour que les cookies soient posés depuis les server actions.
- `advanced.database.generateId: "uuid"` (voir étape 2).

Créer :

- `src/app/api/auth/[...all]/route.ts` : handler Better Auth.
- `src/lib/auth-client.ts` : client navigateur (`createAuthClient`) pour les formulaires.

Appliquer les tables d'authentification sur Neon, puis ajouter la FK `profiles.id → user.id` (`on delete cascade`).

## 5. Réécrire la couche de données (1 à 2 jours)

C'est le gros morceau. Procéder fichier par fichier, en gardant les signatures.

**5.1 `getSession()` dans `queries.ts`**

```ts
export const getSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return { user: session.user };   // plus de "supabase" dans le retour
});
```

Le retour contenait `supabase`. Il faut donc corriger tous les appelants qui font `const { supabase, user } = await getSession()`. Ils importeront `db` à la place.

**5.2 Règle d'or d'isolation** : toute requête filtre `eq(table.userId, user.id)`, y compris les `update` et `delete`. Sans RLS, un oubli est une faille.
Pour s'en protéger, créer de petits helpers dans `src/lib/db/scoped.ts` (par exemple `owned(table, userId, extra?)`) et les utiliser partout.

**5.3 Table de correspondance PostgREST → Drizzle**

| Supabase | Drizzle |
|---|---|
| `.from("t").select("*").eq("user_id", id)` | `db.select().from(t).where(eq(t.userId, id))` |
| `.insert(rows)` | `db.insert(t).values(rows)` |
| `.update(v).eq("id", x)` | `db.update(t).set(v).where(and(eq(t.id, x), eq(t.userId, id)))` |
| `.delete().eq(...)` | `db.delete(t).where(...)` |
| `.upsert(...)` | `.onConflictDoUpdate({ target, set })` |
| `.order("date", { ascending: false })` | `.orderBy(desc(t.date))` |
| `.gte / .lte / .in` | `gte / lte / inArray` |
| `error.code === "23505"` | `catch (e)` puis vérifier `e.code === "23505"` (Postgres) |
| `supabase.rpc("delete_my_account")` | server action dédiée (étape 6) |

**5.4 Ordre conseillé**

1. `queries.ts` : lectures, plus facile à tester visuellement.
2. `actions.ts`.
3. `planning-actions.ts`.
4. `import-actions.ts` : utiliser des insertions par lots (`values(rows)` par tranches de 500) et une **transaction** pour que l'import soit atomique.
5. Route d'export.

**5.5 Transactions SQL** : les opérations multi-lignes, comme un virement (deux lignes liées par `transfer_id`) ou la création d'une série prévisionnelle, doivent passer par `db.transaction(...)`. Avec PostgREST elles ne l'étaient pas, donc c'est une amélioration. Attention : le driver `neon-http` ne supporte pas les transactions interactives. Utiliser `drizzle-orm/neon-serverless` (WebSocket, `Pool`) pour ces cas, ou `neon-http` avec `db.batch([...])` quand les requêtes sont indépendantes.

**5.6 Vérifier `mappers.ts`** : les noms de champs retournés par Drizzle sont en camelCase (`userId`) alors que PostgREST renvoyait du snake_case (`user_id`). Soit on définit les colonnes Drizzle avec les noms SQL d'origine, soit on adapte les `toXxx` / `xxxToRow`. Le plus rapide : adapter les mappers.

## 6. Réécrire l'authentification côté UI (½ journée)

| Fichier | Changement |
|---|---|
| `src/proxy.ts` | Remplacer `createServerClient` par `getSessionCookie(request)` de `better-auth/cookies` (vérification légère) pour rediriger. La vraie validation se fait dans `getSession()` côté serveur. Garder `PUBLIC_PATHS` et les redirections. |
| `login-form.tsx` | `authClient.signIn.email({ email, password })` et `authClient.signIn.magicLink({ email })` |
| `signup-form.tsx` | `authClient.signUp.email({ email, password, name })` (le `display_name` devient `name`) |
| `mot-de-passe-oublie/page.tsx` | `authClient.requestPasswordReset({ email, redirectTo })` |
| `auth/reinitialiser/page.tsx` | `authClient.resetPassword({ newPassword, token })`, le token étant lu dans l'URL |
| `auth/callback/route.ts` | À supprimer : Better Auth gère la vérification via `/api/auth/*`. Les liens de mail pointent directement vers elle. |
| Déconnexion (`actions.ts:461`) | `auth.api.signOut({ headers: await headers() })` |
| Suppression de compte (`planning-actions.ts:371`) | Dans une transaction : supprimer les lignes de toutes les tables de l'utilisateur dans l'ordre existant de `delete_my_account()`, puis `auth.api.deleteUser` (ou `delete from "user"`). Les FK `on delete cascade` simplifient l'ensemble. |
| `initializeUser()` | Inchangée sur le principe (insertion du profil + catégories par défaut à la 1re connexion). La gestion du `23505` se fait sur l'erreur Postgres. |

Penser à régler `trustedOrigins` et `BETTER_AUTH_URL` pour la prod et pour les URLs de prévisualisation Vercel.

## 7. Nettoyage (30 min)

```bash
npm uninstall @supabase/ssr @supabase/supabase-js
```

- Supprimer `src/lib/supabase/`.
- `grep -ri supabase src` doit être vide.
- Mettre à jour `README.md` : stack, mise en place, section « Portabilité » (qui n'a plus d'objet).
- Mettre à jour `.env.example`.

## 8. Reprise des données existantes (si nécessaire, 1 à 2 h)

Seulement si tu as de vraies données dans Supabase.

1. Dans Supabase : `pg_dump --data-only --column-inserts` des tables métier (pas `auth.*`), ou export CSV via l'éditeur.
2. Créer ton compte dans la nouvelle app (Better Auth génère un nouvel `id`).
3. Remplacer l'ancien `user_id` par le nouveau dans le dump :
   `sed 's/ANCIEN-UUID/NOUVEAU-UUID/g' dump.sql > dump-remap.sql`
4. Désactiver temporairement les contraintes si besoin, ou charger dans l'ordre : `profiles` → `accounts` / `categories` → `budgets` / `recurrences` / `forecast_items` / `goals` → `transactions` → `forecast_decisions`.
5. Charger dans Neon. Comparer les soldes via la vue `account_balances` avec ceux de l'ancienne base.

Plus simple pour un usage perso : l'app possède déjà un **export** et un **import CSV**, donc passer par eux est possible (en vérifiant que les virements gardent leur `transfer_id`).

## 9. Tests et validation (½ journée)

- `npm run typecheck` et `npm test` doivent passer (les tests du domaine ne sont pas touchés).
- Ajouter quelques tests d'intégration sur la couche données, sur une branche Neon dédiée (les branches Neon sont gratuites et instantanées).
- **Test d'isolation** : créer deux comptes et vérifier que l'un ne voit, ne modifie et ne supprime jamais les données de l'autre. C'est le test le plus important, car la RLS n'est plus là.
- Parcours manuel complet :
  - inscription → connexion → déconnexion ;
  - lien magique ; mot de passe oublié ;
  - création de compte, catégorie, budget ;
  - dépense, virement, récurrence ;
  - prévisionnel (création en série, liaison) ;
  - import CSV, export ;
  - suppression de compte.
- Vérifier le comportement après une longue inactivité : Neon met la base en veille, le premier appel est plus lent (environ 1 s). Acceptable, mais le noter.

## 10. Déploiement (1 h)

1. Vercel : renseigner toutes les variables d'environnement (mêmes noms qu'à l'étape 1, avec `BETTER_AUTH_URL` = URL de prod).
2. Appliquer les migrations sur la base Neon de production (utiliser une branche Neon `main` pour la prod, une branche `dev` pour le développement).
3. Mettre `NEXT_PUBLIC_ALLOW_SIGNUP=false` après la création de ton compte.
4. Si tu utilises Resend sans domaine vérifié, n'envoie qu'à ton adresse. Pour d'autres destinataires, vérifier un domaine.
5. Sauvegardes : activer la rétention (restauration à un instant donné) dans Neon et prévoir un `pg_dump` périodique, car l'offre gratuite a une fenêtre courte.

## Récapitulatif et ordre des commits

| # | Étape | Durée estimée | Commit |
|---|---|---|---|
| 1 | Préparation, comptes, variables | 30 min | `chore: variables d'environnement` |
| 2 | Schéma SQL sans RLS | 1 h | `db: schéma Postgres portable` |
| 3 | Drizzle + connexion | 1 h | `db: client Drizzle` |
| 4 | Better Auth | 2 h | `auth: Better Auth` |
| 5 | Couche de données | 1 à 2 jours | un commit par fichier |
| 6 | UI d'authentification | ½ jour | `auth: écrans` |
| 7 | Nettoyage | 30 min | `chore: suppression de Supabase` |
| 8 | Reprise des données | 1 à 2 h | (hors dépôt) |
| 9 | Tests | ½ jour | `test: isolation entre utilisateurs` |
| 10 | Déploiement | 1 h | (hors dépôt) |

Total : environ 3 à 4 jours de travail.

## Risques

| Risque | Mitigation |
|---|---|
| Oubli d'un `user_id` dans un filtre → fuite de données | Helpers `owned()`, revue systématique, test d'isolation à deux comptes |
| Transactions non atomiques (virements) | `db.transaction` avec le driver WebSocket de Neon |
| Types `bigint` renvoyés en chaîne | `mode: "number"` dans Drizzle, test sur les soldes |
| Identifiants texte de Better Auth vs `uuid` | `generateId: "uuid"` |
| Limites du plan gratuit (stockage ~0,5 Go, veille de la base) | Largement suffisant pour des finances perso ; surveiller l'usage |
| E-mails non reçus (Resend sans domaine) | Tester tôt ; vérifier un domaine si besoin |
| Version de Next.js différente de ce que je connais (voir `AGENTS.md`) | Lire `node_modules/next/dist/docs/` avant de toucher `proxy.ts`, aux cookies et aux server actions |
