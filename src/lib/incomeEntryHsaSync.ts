/**
 * Canonical HSA synchronization for income_entries.
 *
 * Whenever an income_entry is created OR updated with an `hsa_contribution`
 * amount, exactly ONE payroll-type row in `hsa_contributions` must exist
 * for it (linked via `income_entries.linked_hsa_contribution_id` and
 * `hsa_contributions.income_entry_id`). This helper is the single code
 * path every insert/update site must go through.
 *
 * Rules:
 *   amount > 0, no existing linked row → INSERT
 *   amount > 0, existing linked row    → UPDATE (preserve id)
 *   amount <= 0, existing linked row   → DELETE
 *   amount <= 0, no existing row       → no-op
 *
 * Never touches manual/individual HSA rows (`created_from='manual'`) — the
 * link goes through `linked_hsa_contribution_id`, so the helper only ever
 * modifies the row whose id matches that field.
 */
import { supabase } from "@/integrations/supabase/client";
import { syncPayrollHsaForIncome } from "@/hooks/useHsaContributions";

export interface IncomeEntryHsaSyncInput {
  incomeEntryId: string;
  userId: string;
  organizationId: string | null;
  /** Raw hsa_contribution value from the income form (0 clears the row). */
  amount: number;
  contributionDate: string;
  /** Company that owns the paycheck; used for company_id on hsa row. */
  companyId: string | null;
  /**
   * Existing linked_hsa_contribution_id on the income_entry. Pass `null`
   * (or `undefined`) when the entry is brand new. When supplied, its value
   * is used as-is; the helper does NOT re-fetch it.
   */
  existingHsaId?: string | null;
}

/**
 * Sync the payroll HSA row for an income entry AND persist the resulting
 * `linked_hsa_contribution_id` back onto the income_entries row. Safe to
 * call after every income_entry insert or update. Failures are logged but
 * never thrown — HSA sync failing must not block the income save.
 *
 * Returns the linked hsa_contribution id (or null if none/deleted).
 */
export async function syncIncomeEntryHsa(
  input: IncomeEntryHsaSyncInput,
): Promise<string | null> {
  const {
    incomeEntryId,
    userId,
    organizationId,
    amount,
    contributionDate,
    companyId,
    existingHsaId = null,
  } = input;

  try {
    // Guard: if `existingHsaId` was not supplied, look it up so we never
    // create a duplicate payroll row for the same income entry.
    let resolvedExistingId = existingHsaId ?? null;
    if (resolvedExistingId === null) {
      const { data: existingRow } = await supabase
        .from("income_entries")
        .select("linked_hsa_contribution_id")
        .eq("id", incomeEntryId)
        .maybeSingle();
      resolvedExistingId =
        ((existingRow as any)?.linked_hsa_contribution_id as string | null) ?? null;

      // If the stored id no longer exists in hsa_contributions (e.g. was
      // manually deleted), we must treat this as "no existing" so the
      // sync creates a fresh row instead of updating a dead reference.
      if (resolvedExistingId) {
        const { data: hsaExists } = await supabase
          .from("hsa_contributions" as any)
          .select("id")
          .eq("id", resolvedExistingId)
          .maybeSingle();
        if (!hsaExists) resolvedExistingId = null;
      }
    }

    const linkedHsaId = await syncPayrollHsaForIncome({
      userId,
      organizationId,
      incomeEntryId,
      existingHsaId: resolvedExistingId,
      amount: Number(amount || 0),
      contributionDate,
      companyId,
    });

    if (linkedHsaId !== resolvedExistingId) {
      await supabase
        .from("income_entries")
        .update({ linked_hsa_contribution_id: linkedHsaId } as any)
        .eq("id", incomeEntryId);
    }
    return linkedHsaId;
  } catch (err) {
    console.error("[syncIncomeEntryHsa] failed", err);
    return null;
  }
}

/**
 * Delete the payroll HSA row (if any) linked to an income_entry. Call this
 * from income_entry delete paths so payroll HSA rows never dangle.
 * Manual/individual HSA rows are untouched — only the row referenced by
 * `linked_hsa_contribution_id` (which is always source_type='payroll',
 * created_from='income') is removed.
 */
export async function deleteLinkedPayrollHsaForIncomeEntry(
  incomeEntryId: string,
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from("income_entries")
      .select("linked_hsa_contribution_id")
      .eq("id", incomeEntryId)
      .maybeSingle();
    const linkedId = ((row as any)?.linked_hsa_contribution_id as string | null) ?? null;
    if (!linkedId) return;
    await supabase.from("hsa_contributions" as any).delete().eq("id", linkedId);
  } catch (err) {
    console.warn("[deleteLinkedPayrollHsaForIncomeEntry] skipped:", err);
  }
}

/**
 * Repair routine: find income_entries whose hsa_contribution > 0 but whose
 * linked_hsa_contribution_id is null OR points to a missing hsa_contributions
 * row, and create the payroll HSA row + patch the link. Idempotent —
 * does not create duplicates if a payroll row (matched by income_entry_id)
 * already exists.
 *
 * Runs scoped to the authenticated user via RLS.
 */
export async function backfillMissingPayrollHsaLinks(): Promise<{
  scanned: number;
  repaired: number;
  errors: number;
}> {
  const result = { scanned: 0, repaired: 0, errors: 0 };
  try {
    const { data: candidates, error } = await supabase
      .from("income_entries")
      .select(
        "id, user_id, organization_id, income_date, source_id, hsa_contribution, linked_hsa_contribution_id",
      )
      .gt("hsa_contribution", 0);
    if (error) throw error;
    const rows = (candidates || []) as any[];
    result.scanned = rows.length;
    if (rows.length === 0) return result;

    // Batch-check which linked_hsa_contribution_ids still exist.
    const linkedIds = Array.from(
      new Set(rows.map((r) => r.linked_hsa_contribution_id).filter(Boolean) as string[]),
    );
    const liveLinkedIds = new Set<string>();
    if (linkedIds.length > 0) {
      const { data: live } = await supabase
        .from("hsa_contributions" as any)
        .select("id")
        .in("id", linkedIds);
      for (const r of (live || []) as any[]) liveLinkedIds.add(r.id);
    }

    // Batch-check which income_entry_ids already have a payroll HSA row
    // (avoid duplicates even if linked_hsa_contribution_id got lost).
    const entryIds = rows.map((r) => r.id as string);
    const existingByEntry = new Map<string, string>();
    if (entryIds.length > 0) {
      const { data: existing } = await supabase
        .from("hsa_contributions" as any)
        .select("id, income_entry_id")
        .in("income_entry_id", entryIds);
      for (const r of (existing || []) as any[]) {
        if (r.income_entry_id && !existingByEntry.has(r.income_entry_id)) {
          existingByEntry.set(r.income_entry_id, r.id);
        }
      }
    }

    for (const r of rows) {
      const linkedId = r.linked_hsa_contribution_id as string | null;
      const linkAlive = linkedId ? liveLinkedIds.has(linkedId) : false;
      // Already good: link is live.
      if (linkAlive) continue;
      // A payroll row for this entry already exists, but the entry's link
      // pointer is stale/null → just repoint the entry, don't insert.
      const existingHsaForEntry = existingByEntry.get(r.id as string) || null;
      try {
        if (existingHsaForEntry) {
          await supabase
            .from("income_entries")
            .update({ linked_hsa_contribution_id: existingHsaForEntry } as any)
            .eq("id", r.id);
        } else {
          await syncIncomeEntryHsa({
            incomeEntryId: r.id,
            userId: r.user_id,
            organizationId: r.organization_id ?? null,
            amount: Number(r.hsa_contribution) || 0,
            contributionDate: r.income_date,
            companyId: r.source_id ?? null,
            existingHsaId: null, // known missing/dead
          });
        }
        result.repaired++;
      } catch (err) {
        console.warn("[backfillMissingPayrollHsaLinks] row failed", r.id, err);
        result.errors++;
      }
    }
    return result;
  } catch (err) {
    console.warn("[backfillMissingPayrollHsaLinks] scan failed:", err);
    return result;
  }
}
