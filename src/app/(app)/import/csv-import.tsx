"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { CircleCheck, FileUp, Plus, TriangleAlert } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useAppData } from "@/components/app/app-data";
import { Banner, Button, Card, Chip, Label, Select, buttonClass } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { getLinesInRange, importTransactions } from "@/lib/data/import-actions";
import {
  COLUMN_ROLE_LABELS,
  buildDrafts,
  columnsProblem,
  createCategorizer,
  decodeCsvBytes,
  draftProblem,
  draftSignedCents,
  draftToItem,
  extractRows,
  fileBalances,
  findTransferLinks,
  guessColumns,
  isTransferType,
  normalizeText,
  parseCsv,
  type ColumnRole,
  type DraftRow,
  type DraftType,
  type ExistingLine,
  type ParsedCsv,
} from "@/lib/domain/csv-import";
import { numericDate, todayIso } from "@/lib/domain/dates";
import { formatCents } from "@/lib/domain/money";
import type { Account } from "@/lib/domain/types";
import { ImportRowView, type RowActions } from "./import-row";
import { Spinner } from "@/components/ui/spinner";

type Filter = "all" | "review" | "transfers" | "existing" | "excluded";

interface LoadedFile {
  name: string;
  encoding: string;
  parsed: ParsedCsv;
  roles: ColumnRole[];
  errors: { line: number; reason: string }[];
  opening: { cents: number; date: string } | null;
  closingFromFile: number | null;
}

const compact = (s: string) => normalizeText(s).replace(/[^a-z0-9]+/g, "");

/** Compte dont le nom apparaît dans le nom du fichier (« LivretA.csv » → Livret A). */
function guessAccountFromFileName(fileName: string, accounts: Account[]): Account | undefined {
  const name = compact(fileName.replace(/\.[^.]+$/, ""));
  return [...accounts]
    .sort((a, b) => compact(b.name).length - compact(a.name).length)
    .find((a) => compact(a.name).length >= 4 && name.includes(compact(a.name)));
}

export function CsvImport({ initialAccountId }: { initialAccountId: string | null }) {
  const { activeAccounts, activeCategories, placeMemory, balances, categoryById } = useAppData();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [accountId, setAccountId] = useState<string>(
    activeAccounts.find((a) => a.id === initialAccountId)?.id ?? activeAccounts[0]?.id ?? "",
  );
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  /** Lignes des autres comptes sur la période (mouvements à relier aux virements) */
  const [otherLines, setOtherLines] = useState<ExistingLine[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [setOpening, setSetOpening] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; linked: number; accountName: string; accountId: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const newKey = useRef(0);

  const account = activeAccounts.find((a) => a.id === accountId);
  const categorizer = useMemo(() => createCategorizer(activeCategories, placeMemory), [activeCategories, placeMemory]);
  const otherAccounts = useMemo(() => activeAccounts.filter((a) => a.id !== accountId), [activeAccounts, accountId]);
  const typeOptions = useMemo<DraftType[]>(
    () => (account?.type === "savings" ? ["out", "in", "interest", "transfer_out", "transfer_in"] : ["out", "in", "transfer_out", "transfer_in"]),
    [account?.type],
  );

  /** (Re)construit le tableau à partir du fichier, du compte et de la correspondance des colonnes. */
  const rebuild = useCallback(
    (loaded: LoadedFile, targetId: string) => {
      const target = activeAccounts.find((a) => a.id === targetId);
      if (!target) return;
      const { rows, errors } = extractRows(loaded.parsed, loaded.roles, 0);
      const balancesInfo = fileBalances(rows);
      const next: LoadedFile = { ...loaded, errors, opening: balancesInfo.opening, closingFromFile: balancesInfo.closingFromFile };
      setFile(next);
      setSetOpening(!!balancesInfo.opening && target.initialBalanceCents === 0);
      if (rows.length === 0) {
        setDrafts([]);
        return;
      }
      const dates = rows.map((r) => r.date).sort();
      startTransition(async () => {
        const lines = await getLinesInRange(dates[0]!, dates[dates.length - 1]!).catch(() => [] as ExistingLine[]);
        startTransition(() => {
          setOtherLines(lines.filter((l) => l.accountId !== target.id));
          const existing = lines.filter((l) => l.accountId === target.id);
          // virement interne sans compte nommé : depuis un livret, c'est le compte courant ; depuis le
          // courant, le livret s'il n'y en a qu'un (sinon à choisir ligne par ligne)
          const others = activeAccounts.filter((a) => a.id !== target.id);
          const savings = others.filter((a) => a.type === "savings");
          const internalTransferAccountId =
            target.type === "savings" ? (others.find((a) => a.type === "current")?.id ?? null) : savings.length === 1 ? savings[0]!.id : null;
          setDrafts(buildDrafts({ rows, account: target, accounts: activeAccounts, categorizer, existing, internalTransferAccountId }));
        });
      });
    },
    [activeAccounts, categorizer],
  );

  async function onFile(f: File) {
    setLoadError(null);
    setResult(null);
    try {
      const { text, encoding } = decodeCsvBytes(new Uint8Array(await f.arrayBuffer()));
      const parsed = parseCsv(text);
      if (parsed.header.length < 2 || parsed.rows.length === 0) throw new Error("vide");
      const guessed = initialAccountId ? undefined : guessAccountFromFileName(f.name, activeAccounts);
      const target = guessed?.id ?? accountId;
      if (guessed) setAccountId(guessed.id);
      const loaded: LoadedFile = { name: f.name, encoding, parsed, roles: guessColumns(parsed.header), errors: [], opening: null, closingFromFile: null };
      setFile(loaded);
      setFilter("all");
      if (columnsProblem(loaded.roles)) {
        setDrafts(null);
        return;
      }
      rebuild(loaded, target);
    } catch {
      setFile(null);
      setDrafts(null);
      setLoadError("Ce fichier ne peut pas être lu, vérifie le format CSV");
    }
  }

  function changeRole(index: number, role: ColumnRole) {
    if (!file) return;
    // un rôle (hors « Ignorer ») n'est porté que par une colonne
    const roles = file.roles.map((r, i) => (i === index ? role : role !== "ignore" && r === role ? "ignore" : r));
    const next = { ...file, roles };
    setFile(next);
    if (columnsProblem(roles)) setDrafts(null);
    else rebuild(next, accountId);
  }

  function changeAccount(id: string) {
    setAccountId(id);
    if (file && !columnsProblem(file.roles)) rebuild(file, id);
    else if (drafts) setDrafts(drafts.map((d) => (d.counterpartId === id ? { ...d, counterpartId: null } : d)));
  }

  function startEmpty() {
    setFile(null);
    setResult(null);
    setDrafts([]);
    addRow();
  }

  function addRow() {
    const last = drafts?.[0];
    const row: DraftRow = {
      key: `new-${++newKey.current}`,
      line: null,
      include: true,
      date: last?.date ?? todayIso(),
      type: "out",
      label: "",
      categoryId: null,
      counterpartId: null,
      amount: "",
      categoryManual: true,
      existing: null,
    };
    setDrafts((list) => [row, ...(list ?? [])]);
    setFilter("all");
  }

  const actions = useMemo<RowActions>(
    () => ({
      update: (key, patch) => setDrafts((list) => list?.map((d) => (d.key === key ? { ...d, ...patch } : d)) ?? list),
      // Changer une catégorie l'applique aussi aux lignes de même libellé encore catégorisées automatiquement
      setCategory: (key, categoryId) =>
        setDrafts((list) => {
          if (!list) return list;
          const source = list.find((d) => d.key === key);
          if (!source) return list;
          const label = normalizeText(source.label);
          return list.map((d) =>
            d.key === key
              ? { ...d, categoryId, categoryManual: true }
              : !d.categoryManual && d.type === source.type && normalizeText(d.label) === label
                ? { ...d, categoryId }
                : d,
          );
        }),
      remove: (key) => setDrafts((list) => list?.filter((d) => d.key !== key) ?? list),
    }),
    [],
  );

  const problems = useMemo(
    () => new Map((drafts ?? []).map((d) => [d.key, draftProblem(d, accountId)])),
    [drafts, accountId],
  );

  const links = useMemo(() => findTransferLinks(drafts ?? [], otherLines), [drafts, otherLines]);

  const autresId = activeCategories.find((c) => normalizeText(c.name) === "autres")?.id;
  const visible = useMemo(() => {
    const q = normalizeText(search);
    return (drafts ?? []).filter((d) => {
      if (q && !normalizeText(d.label).includes(q)) return false;
      if (filter === "review") return d.include && (!!problems.get(d.key) || (!!autresId && d.categoryId === autresId));
      if (filter === "transfers") return isTransferType(d.type);
      if (filter === "existing") return !!d.existing;
      if (filter === "excluded") return !d.include;
      return true;
    });
  }, [drafts, filter, search, problems, autresId]);

  const summary = useMemo(() => {
    const valid = (drafts ?? []).filter((d) => d.include && !problems.get(d.key));
    const sum = (types: DraftType[]) =>
      valid.filter((d) => types.includes(d.type)).reduce((s, d) => s + Math.abs(draftSignedCents(d)), 0);
    return {
      valid,
      invalid: (drafts ?? []).filter((d) => d.include && problems.get(d.key)).length,
      expenses: sum(["out"]),
      income: sum(["in", "interest"]),
      transfers: valid.filter((d) => isTransferType(d.type)).length,
      net: valid.reduce((s, d) => s + draftSignedCents(d), 0),
      review: (drafts ?? []).filter((d) => d.include && autresId && d.categoryId === autresId).length,
      existing: (drafts ?? []).filter((d) => d.existing).length,
    };
  }, [drafts, problems, autresId]);

  // Solde du compte après import (solde initial éventuellement remplacé par celui déduit du fichier)
  const currentBalance = account ? (balances[account.id] ?? account.initialBalanceCents) : 0;
  const projected =
    account && (setOpening && file?.opening ? file.opening.cents - account.initialBalanceCents + currentBalance : currentBalance) + summary.net;

  function submit() {
    if (!account || summary.valid.length === 0) return;
    setSubmitError(null);
    setSubmitting(true);
    startTransition(async () => {
      const res = await importTransactions({
        items: summary.valid.map((d) => draftToItem(d, account.id, links.get(d.key)?.id ?? null)),
        openingBalances: setOpening && file?.opening ? [{ accountId: account.id, cents: file.opening.cents, date: file.opening.date }] : [],
      }).catch(() => ({ ok: false as const, error: "Import impossible, réessaie dans un instant." }));
      startTransition(() => {
        setSubmitting(false);
        if (!res.ok) return setSubmitError(res.error);
        toast(`${res.inserted} transaction${res.inserted > 1 ? "s" : ""} importée${res.inserted > 1 ? "s" : ""}`);
        setResult({ inserted: res.inserted, skipped: res.skipped, linked: res.linked, accountName: account.name, accountId: account.id });
        setOtherLines([]);
        setDrafts(null);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
      });
    });
  }

  const counts: Record<Filter, number> = {
    all: drafts?.length ?? 0,
    review: (drafts ?? []).filter((d) => d.include && (problems.get(d.key) || (autresId && d.categoryId === autresId))).length,
    transfers: (drafts ?? []).filter((d) => isTransferType(d.type)).length,
    existing: summary.existing,
    excluded: (drafts ?? []).filter((d) => !d.include).length,
  };

  return (
    <div className="flex flex-col gap-4">
      {result && (
        <Banner
          tone="success"
          action={
            <Link href={`/transactions?compte=${result.accountId}`} className="font-bold">
              Voir les transactions
            </Link>
          }
        >
          <span className="inline-flex items-center gap-2">
            <CircleCheck size={16} />
            {result.inserted} transaction{result.inserted > 1 ? "s" : ""} importée{result.inserted > 1 ? "s" : ""} sur{" "}
            {result.accountName}
            {result.skipped > 0 && ` · ${result.skipped} déjà présente${result.skipped > 1 ? "s" : ""} ignorée${result.skipped > 1 ? "s" : ""}`}
            {result.linked > 0 && ` · ${result.linked} virement${result.linked > 1 ? "s" : ""} relié${result.linked > 1 ? "s" : ""} à une ligne existante`}.
          </span>
        </Banner>
      )}

      {/* Étape 1 : compte + fichier */}
      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)] md:items-end">
          <div>
            <Label htmlFor="import-account">Compte concerné</Label>
            <Select id="import-account" value={accountId} onChange={(e) => changeAccount(e.target.value)} disabled={pending}>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={buttonClass("primary", "cursor-pointer")}>
              <FileUp size={16} /> {file ? "Changer de fichier" : "Choisir un fichier CSV"}
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </label>
            <Button onClick={startEmpty} disabled={pending}>
              Tableau vide
            </Button>
            {file && (
              <span className="text-xs text-n-600">
                {file.name} · {file.parsed.rows.length} lignes · séparateur « {file.parsed.separator === "\t" ? "tab" : file.parsed.separator} » ·{" "}
                {file.encoding}
              </span>
            )}
          </div>
        </div>
        {loadError && <p className="mt-3 text-sm font-semibold text-danger-700">{loadError}</p>}
        {!file && !drafts && (
          <p className="mt-3 text-xs text-n-600">
            Un fichier par compte, par exemple <code>Raison;Date;Recette;Depense;Total</code>. Les virements vers tes autres comptes
            sont reconnus par leur nom dans le libellé, et les lignes déjà enregistrées sont repérées pour éviter les doublons.
          </p>
        )}
      </Card>

      {/* Étape 2 : correspondance des colonnes */}
      {file && (
        <Card>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-n-700">Correspondance des colonnes</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {file.parsed.header.map((h, i) => (
              <div key={i}>
                <Label htmlFor={`col-${i}`}>
                  {h || `Colonne ${i + 1}`}{" "}
                  <span className="text-n-600">· {file.parsed.rows[0]?.cells[i] || "-"}</span>
                </Label>
                <Select id={`col-${i}`} value={file.roles[i]} onChange={(e) => changeRole(i, e.target.value as ColumnRole)}>
                  {(Object.keys(COLUMN_ROLE_LABELS) as ColumnRole[]).map((r) => (
                    <option key={r} value={r}>
                      {COLUMN_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          {columnsProblem(file.roles) ? (
            <p className="mt-3 text-sm font-semibold text-danger-700">{columnsProblem(file.roles)}</p>
          ) : (
            <p className="mt-3 text-xs text-n-600">Modifier la correspondance recharge le tableau (les modifications faites dans le tableau sont perdues).</p>
          )}
          {file.errors.length > 0 && (
            <details className="mt-3 text-xs text-warn-800">
              <summary className="cursor-pointer font-semibold">
                {file.errors.length} ligne{file.errors.length > 1 ? "s" : ""} illisible{file.errors.length > 1 ? "s" : ""} ignorée
                {file.errors.length > 1 ? "s" : ""}
              </summary>
              <ul className="mt-1 list-disc pl-5">
                {file.errors.slice(0, 20).map((e) => (
                  <li key={e.line}>
                    Ligne {e.line} : {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}

      {/* Étape 3 : tableau modifiable */}
      {pending && !drafts && (
        <Card>
          <p className="flex items-center gap-2 text-sm text-n-700">
            <Spinner /> Lecture du fichier et recherche des lignes déjà enregistrées…
          </p>
        </Card>
      )}
      {pending && drafts && !submitting && (
        <p className="flex items-center gap-2 text-sm text-n-700">
          <Spinner /> Mise à jour du tableau…
        </p>
      )}
      {drafts && account && (
        <Card className="!p-0">
          <div className="flex flex-col gap-3 border-b border-divider p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
                {(
                  [
                    ["all", "Toutes"],
                    ["review", "À vérifier"],
                    ["transfers", "Virements"],
                    ["existing", "Déjà présentes"],
                    ["excluded", "Exclues"],
                  ] as [Filter, string][]
                ).map(([f, label]) => (
                  <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                    {label} · {counts[f]}
                  </Chip>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un libellé"
                  className="min-h-9 rounded-[10px] border border-n-300 bg-surface px-3 text-sm focus:border-accent focus:outline-none"
                />
                <Button onClick={addRow}>
                  <Plus size={15} /> Ajouter une ligne
                </Button>
              </div>
            </div>
            <p className="text-xs text-n-600">
              Changer la catégorie d&apos;une ligne l&apos;applique aux autres lignes de même libellé. Les lignes « Déjà présentes »
              existent déjà sur ce compte (par exemple un virement créé lors de l&apos;import de l&apos;autre compte) : elles sont exclues.
              Un virement « Relié » correspond à une entrée ou sortie déjà saisie sur l&apos;autre compte : elle sera convertie en
              virement au lieu d&apos;être dupliquée.
            </p>
          </div>

          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="sticky top-0 z-10 bg-surface text-[11px] font-bold uppercase tracking-wider text-n-600 shadow-[0_1px_0_var(--divider)]">
                <tr>
                  <th className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="Tout sélectionner"
                      checked={visible.length > 0 && visible.every((d) => d.include)}
                      onChange={(e) => {
                        const keys = new Set(visible.map((d) => d.key));
                        setDrafts((list) => list?.map((d) => (keys.has(d.key) ? { ...d, include: e.target.checked } : d)) ?? list);
                      }}
                    />
                  </th>
                  <th className="px-2">Date</th>
                  <th className="px-2">Type</th>
                  <th className="px-2">Libellé</th>
                  <th className="px-2">Catégorie / compte</th>
                  <th className="px-2 text-right">Montant</th>
                  <th className="px-2">Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <ImportRowView
                    key={d.key}
                    row={d}
                    problem={problems.get(d.key) ?? null}
                    link={links.get(d.key) ?? null}
                    linkAccountName={links.get(d.key) ? (activeAccounts.find((a) => a.id === links.get(d.key)!.accountId)?.name ?? "") : ""}
                    typeOptions={typeOptions}
                    categories={activeCategories}
                    otherAccounts={otherAccounts}
                    actions={actions}
                  />
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <p className="p-6 text-center text-sm text-n-600">Aucune ligne dans ce filtre.</p>}
          </div>

          {/* Pied : récapitulatif, solde et validation */}
          <div className="flex flex-col gap-3 border-t border-divider p-4">
            {file?.opening && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={setOpening} onChange={(e) => setSetOpening(e.target.checked)} className="mt-0.5" />
                <span>
                  Définir le solde initial de <strong>{account.name}</strong> à <strong>{formatCents(file.opening.cents)}</strong> au{" "}
                  {numericDate(file.opening.date)} <span className="text-n-600">(déduit de la colonne « Total »)</span>
                  {account.initialBalanceCents !== 0 && (
                    <span className="block text-xs text-warn-800">Remplace le solde initial actuel ({formatCents(account.initialBalanceCents)}).</span>
                  )}
                </span>
              </label>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p>
                  <strong>{summary.valid.length}</strong> ligne{summary.valid.length > 1 ? "s" : ""} validée{summary.valid.length > 1 ? "s" : ""} ·
                  dépenses <strong>{formatCents(summary.expenses)}</strong> · entrées <strong>{formatCents(summary.income)}</strong> ·{" "}
                  {summary.transfers} virement{summary.transfers > 1 ? "s" : ""}
                </p>
                <p className="mt-0.5 text-xs text-n-600">
                  Solde de {account.name} après import : <strong className="text-text">{formatCents(projected ?? 0)}</strong>
                  {file?.closingFromFile !== null && file?.closingFromFile !== undefined && (
                    <>
                      {" "}
                      · total du fichier {formatCents(file.closingFromFile)}{" "}
                      {projected === file.closingFromFile ? (
                        <span className="font-bold text-accent-700">✓ identique</span>
                      ) : (
                        <span className="font-bold text-warn-800">écart de {formatCents((projected ?? 0) - file.closingFromFile, "always")}</span>
                      )}
                    </>
                  )}
                </p>
                {summary.invalid > 0 && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-danger-700">
                    <TriangleAlert size={13} /> {summary.invalid} ligne{summary.invalid > 1 ? "s" : ""} incomplète
                    {summary.invalid > 1 ? "s" : ""} ne ser{summary.invalid > 1 ? "ont" : "a"} pas importée{summary.invalid > 1 ? "s" : ""}
                  </p>
                )}
              </div>
              <Button
                variant="primary"
                onClick={submit}
                loading={submitting}
                disabled={pending || summary.valid.length === 0}
                className={clsx("md:min-h-10")}
              >
                {submitting ? "Import en cours…" : `Valider le bloc · ${summary.valid.length} transaction${summary.valid.length > 1 ? "s" : ""}`}
              </Button>
            </div>
            {submitError && <p className="text-sm font-semibold text-danger-700">{submitError}</p>}
            {summary.review > 0 && (
              <p className="text-xs text-n-600">
                {summary.review} ligne{summary.review > 1 ? "s" : ""} en « {autresId ? categoryById.get(autresId)?.name : "Autres"} » : filtre « À vérifier »
                pour les recatégoriser.
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
