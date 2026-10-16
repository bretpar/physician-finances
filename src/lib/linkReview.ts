/**
 * Pure builder for the Link Review page. Lists income entries and deposits
 * whose links are missing or uncertain and explains how each is currently
 * counted. "Counted" is read from the canonical record-selection bridge,
 * never recomputed here. No tax math.
 */
type Row = Record<string, any>;

export type LinkReviewKind =
  | "suggested"
  | "unlinked_deposit"
  | "unconfirmed_income"
  | "auto_linked"
  | "merge_group";

export interface LinkReviewItem {
  key: string;
  kind: LinkReviewKind;
  title: string;
  date: string | null;
  amount: number;
  howCounted: string;
  /** Transaction ids involved (for actions). */
  transactionIds: string[];
  groupId?: string | null;
  confidenceLabel?: string;
  /** For merge groups: every transaction to link into a single group. */
  linkAllIds?: string[];
}

export interface LinkReviewArgs {
  transactions: Row[];
  incomeEntries: Row[];
  transactionLinks: Row[];
  suggestions: Array<{ kind: "single" | "split"; plaidTx: Row; manualTx?: Row; manualTxs?: Row[]; confidenceLabel: string; reasons: string[] }>;
  /** Output of buildRecordSelectionBridge (may be null while loading). */
  bridge: { incomeTransactions: Row[]; mergeGroups: Row[] } | null;
  dismissedKeys: Set<string>;
  today: string; // YYYY-MM-DD
}

const num = (v: unknown) => Math.abs(Number(v) || 0);
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isImported = (t: Row) => t.source_type === "plaid";
const isIncome = (t: Row) => t.transaction_type === "income";
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function countedText(txId: string, bridgeTx: Map<string, Row>, fallbackAmount: number): string {
  const b = bridgeTx.get(txId);
  if (!b) return "Not part of the current tax-year calculation.";
  if (b.included === "gross") return `Counted as business income: ${money(b.gross_selected_for_calculation)}.`;
  return `Not counted in your taxes (${b.reason}). Amount on record: ${money(fallbackAmount)}.`;
}

export function buildLinkReviewItems(args: LinkReviewArgs): LinkReviewItem[] {
  const bridgeTx = new Map((args.bridge?.incomeTransactions ?? []).map((t) => [t.id as string, t]));
  const items: LinkReviewItem[] = [];
  const inSuggestion = new Set<string>();

  for (const s of args.suggestions) {
    const manual = s.kind === "single" ? [s.manualTx!] : s.manualTxs ?? [];
    if (!isIncome(s.plaidTx)) continue;
    const ids = [...manual.map((m) => m.id), s.plaidTx.id];
    ids.forEach((id) => inSuggestion.add(id));
    const manualTotal = manual.reduce((a, m) => a + num(m.amount), 0);
    items.push({
      key: `suggested:${[...ids].sort().join(",")}`,
      kind: "suggested",
      title: `${s.plaidTx.merchant_name || s.plaidTx.vendor || "Deposit"} ↔ ${manual.map((m) => m.vendor).join(", ")}`,
      date: s.plaidTx.transaction_date,
      amount: num(s.plaidTx.amount),
      confidenceLabel: s.confidenceLabel,
      howCounted:
        `Right now both are counted separately: the deposit (${money(num(s.plaidTx.amount))}) and your entry (${money(manualTotal)}). ` +
        `Confirming keeps your entry and stops counting the deposit, so the income is counted once.`,
      transactionIds: ids,
    });
  }

  const linkedTxIds = new Set<string>();
  for (const l of args.transactionLinks) {
    if (l.status !== "linked") continue;
    if (l.manual_transaction_id) linkedTxIds.add(l.manual_transaction_id);
    if (l.plaid_transaction_record_id) linkedTxIds.add(l.plaid_transaction_record_id);
  }
  const isLinked = (t: Row) => t.match_status === "linked" || !!t.linked_group_id || linkedTxIds.has(t.id);

  for (const t of args.transactions) {
    if (!isIncome(t) || t.status !== "active" || isLinked(t) || inSuggestion.has(t.id)) continue;
    if (isImported(t)) {
      items.push({
        key: `deposit:${t.id}`,
        kind: "unlinked_deposit",
        title: t.vendor || "Bank deposit",
        date: t.transaction_date,
        amount: num(t.amount),
        howCounted: `${countedText(t.id, bridgeTx, num(t.amount))} It isn't linked to an income entry, so no pay-stub deductions or withholding are attached and it may duplicate an entry.`,
        transactionIds: [t.id],
      });
    } else if (t.source_type === "manual" && daysBetween(t.transaction_date, args.today) >= 7) {
      items.push({
        key: `income:${t.id}`,
        kind: "unconfirmed_income",
        title: t.vendor || "Income entry",
        date: t.transaction_date,
        amount: num(t.amount),
        howCounted: `${countedText(t.id, bridgeTx, num(t.amount))} No bank deposit has been linked to confirm it.`,
        transactionIds: [t.id],
      });
    }
  }

  // Automatic (not user-confirmed) income links.
  const autoGroups = new Map<string, Set<string>>();
  for (const l of args.transactionLinks) {
    if (l.status !== "linked" || l.created_by_user) continue;
    const set = autoGroups.get(l.linked_group_id) ?? new Set<string>();
    if (l.manual_transaction_id) set.add(l.manual_transaction_id);
    if (l.plaid_transaction_record_id) set.add(l.plaid_transaction_record_id);
    autoGroups.set(l.linked_group_id, set);
  }
  const txById = new Map(args.transactions.map((t) => [t.id as string, t]));
  for (const [gid, ids] of autoGroups) {
    const rows = [...ids].map((id) => txById.get(id)).filter(Boolean) as Row[];
    if (rows.length < 2 || !rows.some(isIncome)) continue;
    const kept = rows.find((r) => r.status === "active");
    items.push({
      key: `auto:${gid}`,
      kind: "auto_linked",
      title: rows.map((r) => r.vendor).join(" ↔ "),
      date: kept?.transaction_date ?? rows[0].transaction_date,
      amount: num(kept?.amount),
      howCounted: kept
        ? `Linked automatically. Only "${kept.vendor}" (${money(num(kept.amount))}) is counted; the other ${rows.length - 1} record(s) are not.`
        : "Linked automatically, but no record in the group is active, so none is counted.",
      transactionIds: rows.map((r) => r.id),
      groupId: gid,
    });
  }

  // Merge groups with stranded income entries.
  for (const g of args.bridge?.mergeGroups ?? []) {
    if (!g.flags?.length) continue;
    const stranded = g.stranded_income_entries ?? [];
    const memberIds: string[] = (g.members ?? []).filter((m: Row) => m.status !== "missing").map((m: Row) => m.id);
    const strandedTxIds: string[] = stranded.map((s: Row) => s.linked_transaction_id);
    const all = [...new Set([...strandedTxIds, ...memberIds])];
    const first = stranded[0];
    items.push({
      key: `merge:${g.linked_group_id ?? strandedTxIds.join(",")}`,
      kind: "merge_group",
      title: `${first?.company ?? "Income"} — entry and deposits don't line up`,
      date: first?.date ?? null,
      amount: Number(g.stranded_gross) || 0,
      howCounted:
        `Your entry (${money(Number(g.stranded_gross) || 0)}) is merged away and not counted, along with its deductions and withholding. ` +
        `Currently counted from this group: ${money(Number(g.surviving_counted_amount) || 0)}. ` +
        `Linking all deposits to the entry counts the entry's gross once and attaches its deductions and withholding.`,
      transactionIds: all,
      groupId: g.linked_group_id ?? null,
      linkAllIds: all,
    });
  }

  return items
    .filter((i) => !args.dismissedKeys.has(i.key))
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

/** Records the given one could be linked to: deposits for entries, entries for deposits (±30 days, unlinked). */
export function manualLinkCandidates(deposit: Row, transactions: Row[]): Row[] {
  const wantImported = !isImported(deposit);
  return transactions
    .filter(
      (t) =>
        t.id !== deposit.id &&
        isIncome(t) &&
        t.status === "active" &&
        isImported(t) === wantImported &&
        t.match_status !== "linked" &&
        !t.linked_group_id &&
        Math.abs(daysBetween(t.transaction_date, deposit.transaction_date)) <= 30,
    )
    .sort(
      (a, b) =>
        Math.abs(daysBetween(a.transaction_date, deposit.transaction_date)) -
        Math.abs(daysBetween(b.transaction_date, deposit.transaction_date)),
    );
}
