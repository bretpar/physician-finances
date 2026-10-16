/**
 * Pre-calculation validation of income links. Read-only: it only reports
 * issues; nothing is changed until the user confirms a fix in Link Review.
 */
type Row = Record<string, any>;

export type LinkIssueKind = "duplicate" | "missing" | "conflicting" | "incomplete_metadata";

export interface LinkIssue {
  key: string;
  kind: LinkIssueKind;
  message: string;
  recordIds: string[];
}

const abs = (v: unknown) => Math.abs(Number(v) || 0);
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/**
 * `transactions` must be the FULL read-only history (active + merged rows) so
 * merged partners are visible; only active rows are treated as counted.
 * `incomeEntryLinks` resolves merged income entries to their canonical entry.
 * `plaidTransactionIds` are raw bank rows an entry may legitimately point at.
 */
export function validateIncomeLinks(args: {
  transactions: Row[];
  incomeEntries: Row[];
  incomeEntryLinks?: Row[];
  transactionLinks?: Row[];
  plaidTransactionIds?: ReadonlySet<string>;
}): LinkIssue[] {
  const issues: LinkIssue[] = [];
  const txById = new Map(args.transactions.map((t) => [t.id as string, t]));
  const incomeTx = args.transactions.filter((t) => t.transaction_type === "income");
  const entryById = new Map(args.incomeEntries.map((e) => [e.id as string, e]));
  // Merged income entries whose canonical entry still exists are resolved history.
  const resolvedMerged = new Set<string>();
  for (const l of args.incomeEntryLinks ?? []) {
    if (l.status !== "linked") continue;
    const canonical = entryById.get(l.canonical_entry_id);
    if (canonical && canonical.status !== "merged" && canonical.status !== "deleted") resolvedMerged.add(l.merged_entry_id);
  }
  const isHistorical = (e: Row) => e.status === "deleted" || (e.status === "merged" && resolvedMerged.has(e.id));

  // Duplicate: several income entries attached to one transaction.
  const entriesByTx = new Map<string, Row[]>();
  for (const e of args.incomeEntries) {
    if (!e.linked_transaction_id || isHistorical(e) || e.status === "merged") continue;
    const list = entriesByTx.get(e.linked_transaction_id) ?? [];
    list.push(e);
    entriesByTx.set(e.linked_transaction_id, list);
  }
  for (const [txId, list] of entriesByTx) {
    if (list.length > 1) {
      issues.push({ key: `dup-entries:${txId}`, kind: "duplicate", recordIds: [txId, ...list.map((e) => e.id)],
        message: `${list.length} income entries are attached to the same ${txById.get(txId)?.vendor ?? "transaction"} record, so its deductions and withholding may count more than once.` });
    }
  }

  // Duplicate: two active, unlinked income records with the same date, amount and source.
  const seen = new Map<string, Row>();
  for (const t of incomeTx) {
    if (t.status !== "active" || t.linked_group_id) continue;
    const k = `${t.transaction_date}|${abs(t.amount).toFixed(2)}|${t.source_id ?? t.vendor ?? ""}`;
    const prev = seen.get(k);
    if (prev) {
      issues.push({ key: `dup-tx:${[prev.id, t.id].sort().join(",")}`, kind: "duplicate", recordIds: [prev.id, t.id],
        message: `Two ${t.vendor ?? "income"} records on ${t.transaction_date} for $${abs(t.amount).toFixed(2)} are both counted.` });
    } else seen.set(k, t);
  }

  // Missing: entry points at a record that no longer exists.
  for (const e of args.incomeEntries) {
    if (isHistorical(e)) continue;
    if (e.status === "merged") {
      issues.push({ key: `merged-no-canonical:${e.id}`, kind: "missing", recordIds: [e.id],
        message: `The ${e.company || "income"} entry on ${e.income_date} was merged, but the entry it was merged into is missing.` });
      continue;
    }
    if (e.linked_transaction_id && !txById.has(e.linked_transaction_id) && !args.plaidTransactionIds?.has(e.linked_transaction_id)) {
      issues.push({ key: `missing-tx:${e.id}`, kind: "missing", recordIds: [e.id],
        message: `The ${e.company || "income"} entry on ${e.income_date} is linked to a record that no longer exists, so it isn't counted.` });
    }
  }

  // Missing / conflicting: link groups.
  const groups = new Map<string, Row[]>();
  for (const t of incomeTx) {
    if (!t.linked_group_id) continue;
    const g = groups.get(t.linked_group_id) ?? [];
    g.push(t);
    groups.set(t.linked_group_id, g);
  }
  for (const [gid, members] of groups) {
    const active = members.filter((m) => m.status === "active");
    if (members.length === 1) {
      const m = members[0];
      const linkRows = (args.transactionLinks ?? []).filter((l) => l.linked_group_id === gid);
      const metadataOnly = m.status === "active" && linkRows.length > 0 &&
        linkRows.every((l) => !l.manual_transaction_id || !l.plaid_transaction_record_id || l.manual_transaction_id === l.plaid_transaction_record_id || [l.manual_transaction_id, l.plaid_transaction_record_id].every((id) => !id || id === m.id));
      if (metadataOnly) {
        issues.push({ key: `link-metadata:${gid}`, kind: "incomplete_metadata", recordIds: [m.id],
          message: `${m.vendor ?? "A record"} on ${m.transaction_date} ($${abs(m.amount).toFixed(2)}) has an incomplete link record with no partner. The payment is already counted once; only the link details are incomplete.` });
      } else {
        issues.push({ key: `missing-partner:${gid}`, kind: "missing", recordIds: [m.id],
          message: `${m.vendor ?? "A record"} on ${m.transaction_date} is marked as linked, but its partner record is missing.` });
      }
    }
    if (active.length === 0 && members.length > 0) {
      issues.push({ key: `no-survivor:${gid}`, kind: "missing", recordIds: members.map((m) => m.id),
        message: `A linked group (${members.map((m) => m.vendor).join(", ")}) has no counted record, so this income is left out.` });
    }
    if (active.length > 1) {
      issues.push({ key: `multi-survivor:${gid}`, kind: "conflicting", recordIds: active.map((m) => m.id),
        message: `A linked group has ${active.length} counted records (${active.map((m) => `$${abs(m.amount).toFixed(2)}`).join(", ")}); it should count one.` });
    }
  }

  // Conflicting: entry and its record disagree on company or date.
  for (const e of args.incomeEntries) {
    const t = e.linked_transaction_id ? txById.get(e.linked_transaction_id) : undefined;
    if (!t || e.status === "deleted" || e.status === "merged") continue;
    if (e.source_id && t.source_id && e.source_id !== t.source_id) {
      issues.push({ key: `company:${e.id}`, kind: "conflicting", recordIds: [e.id, t.id],
        message: `The ${e.company || "income"} entry is linked to a record from a different company.` });
    }
    if (e.income_date && t.transaction_date && dayDiff(e.income_date, t.transaction_date) > 31) {
      issues.push({ key: `date:${e.id}`, kind: "conflicting", recordIds: [e.id, t.id],
        message: `The ${e.company || "income"} entry (${e.income_date}) is linked to a record dated ${t.transaction_date}, more than a month apart.` });
    }
  }

  return issues;
}
