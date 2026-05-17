import { supabase } from "@/integrations/supabase/client";

/**
 * Tables that reference a company by id. Each entry is `[table, column]`.
 * Used by the merge tool to repoint duplicates at the primary company id.
 */
export const COMPANY_REFERENCE_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["projected_income_streams", "source_id"],
  ["income_entries", "source_id"],
  ["transactions", "source_id"],
  ["home_office_deductions", "company_id"],
  ["hsa_contributions", "company_id"],
  ["mileage_entries", "company_id"],
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
  const labels: Record<string, string> = {
    projected_income_streams: "income stream",
    income_entries: "income entry",
    transactions: "transaction",
    home_office_deductions: "home office deduction",
    hsa_contributions: "HSA contribution",
    mileage_entries: "mileage entry",
  };
  for (const [table] of COMPANY_REFERENCE_COLUMNS) {
    const n = counts[table] ?? 0;
    if (n > 0) {
      const label = labels[table] ?? table;
      parts.push(`${n} ${label}${n === 1 ? "" : "s"}`);
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

  // 1. Repoint linked rows.
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
