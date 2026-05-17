import { supabase } from "@/integrations/supabase/client";

/**
 * Tables that reference a company by id. Each entry is `[table, column]`.
 * Used by the merge tool to repoint duplicates at the primary company id.
 */
export const COMPANY_REFERENCE_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["projected_income_streams", "source_id"],
  ["income_entries", "source_id"],
  ["transactions", "source_id"],
  ["transaction_attachments", "company_id"],
  ["home_office_deductions", "company_id"],
  ["hsa_contributions", "company_id"],
  ["mileage_entries", "company_id"],
  ["ytd_catchup_entries", "company_id"],
  ["plaid_accounts", "default_company_id"],
  ["tax_settings", "hsa_source_company_id"],
] as const;

/**
 * Array/JSON columns containing one or more company ids. These cannot use a
 * simple `.update().in()` repoint — we fetch, rewrite the array, and write
 * back per row.
 */
export const COMPANY_ARRAY_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["tax_settings", "business_state_tax_company_ids"],
] as const;

export type MergeSummaryCounts = Record<string, number>;

/**
 * Pure helper: produce a confirmation sentence from row counts.
 * Exported for testing.
 */
export function formatMergeSummary(
  counts: MergeSummaryCounts,
  primaryName: string,
  duplicateCount: number,
): string {
  const parts: string[] = [];
  const labels: Record<string, [string, string]> = {
    projected_income_streams: ["income stream", "income streams"],
    income_entries: ["income entry", "income entries"],
    transactions: ["transaction", "transactions"],
    transaction_attachments: ["receipt/attachment", "receipts/attachments"],
    home_office_deductions: ["home office deduction", "home office deductions"],
    hsa_contributions: ["HSA contribution", "HSA contributions"],
    mileage_entries: ["mileage entry", "mileage entries"],
    ytd_catchup_entries: ["YTD catch-up entry", "YTD catch-up entries"],
    plaid_accounts: ["linked bank account", "linked bank accounts"],
    tax_settings: ["tax setting reference", "tax setting references"],
  };
  for (const [table] of COMPANY_REFERENCE_COLUMNS) {
    const n = counts[table] ?? 0;
    if (n > 0) {
      const [singular, plural] = labels[table] ?? [table, table];
      parts.push(`${n} ${n === 1 ? singular : plural}`);
    }
  }
  const dupLabel = `${duplicateCount} duplicate record${duplicateCount === 1 ? "" : "s"}`;
  if (parts.length === 0) {
    return `This will archive ${dupLabel} into ${primaryName}. No linked records need to move.`;
  }
  return `This will move ${parts.join(", ")} from ${dupLabel} into ${primaryName}.`;
}

/**
 * Count rows in each company-linked table that currently point at any of
 * the duplicate company ids. Used for the confirmation dialog.
 */
export async function countLinkedRows(
  duplicateIds: string[],
): Promise<MergeSummaryCounts> {
  const counts: MergeSummaryCounts = {};
  if (duplicateIds.length === 0) return counts;
  for (const [table, column] of COMPANY_REFERENCE_COLUMNS) {
    const { count, error } = await supabase
      .from(table as any)
      .select("id", { count: "exact", head: true })
      .in(column, duplicateIds);
    if (error) {
      // Treat missing-column / permission errors as zero — non-fatal.
      counts[table] = 0;
      continue;
    }
    counts[table] = count ?? 0;
  }
  return counts;
}

/**
 * Repoint every company-linked row from any of `duplicateIds` to
 * `primaryId`, then archive the duplicate company rows.
 */
export async function mergeCompanies(params: {
  primaryId: string;
  primaryName: string;
  duplicateIds: string[];
}): Promise<void> {
  const { primaryId, primaryName, duplicateIds } = params;
  if (!primaryId) throw new Error("Missing primary company id");
  const dupes = duplicateIds.filter((id) => id && id !== primaryId);
  if (dupes.length === 0) return;

  // 1. Repoint scalar linked rows.
  for (const [table, column] of COMPANY_REFERENCE_COLUMNS) {
    const { error } = await supabase
      .from(table as any)
      .update({ [column]: primaryId } as any)
      .in(column, dupes);
    if (error) {
      // Skip tables where the user has no rows / no access; merge should
      // still proceed for the rest.
      // eslint-disable-next-line no-console
      console.warn(`[mergeCompanies] repoint ${table}.${column} failed:`, error.message);
    }
  }

  // 1b. Repoint array/JSON columns containing company id lists.
  for (const [table, column] of COMPANY_ARRAY_COLUMNS) {
    const { data: rows, error: fetchErr } = await supabase
      .from(table as any)
      .select(`id, ${column}`)
      .overlaps(column, dupes);
    if (fetchErr) {
      // eslint-disable-next-line no-console
      console.warn(`[mergeCompanies] fetch ${table}.${column} failed:`, fetchErr.message);
      continue;
    }
    for (const row of (rows ?? []) as Array<Record<string, any>>) {
      const current: string[] = Array.isArray(row[column]) ? row[column] : [];
      const rewritten = Array.from(
        new Set(current.map((id) => (dupes.includes(id) ? primaryId : id))),
      );
      const { error: updErr } = await supabase
        .from(table as any)
        .update({ [column]: rewritten } as any)
        .eq("id", row.id);
      if (updErr) {
        // eslint-disable-next-line no-console
        console.warn(`[mergeCompanies] update ${table}.${column} row ${row.id} failed:`, updErr.message);
      }
    }
  }


  // 2. Archive duplicate company rows. Rename them so any legacy lookup
  //    by name surfaces the merge instead of looking like a real employer.
  const archivedName = `Merged into ${primaryName}`;
  const { error: archiveErr } = await supabase
    .from("companies")
    .update({
      archived_at: new Date().toISOString(),
      merged_into_company_id: primaryId,
      name: archivedName,
      include_in_tax: false,
    } as any)
    .in("id", dupes);
  if (archiveErr) throw new Error(archiveErr.message);
}
