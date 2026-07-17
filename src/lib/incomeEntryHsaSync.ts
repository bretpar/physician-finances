/**
 * Canonical HSA synchronization for income_entries.
 *
 * All linked HSA writes now go through the atomic Postgres RPC
 * `public.sync_income_hsa_atomic(...)`. That RPC runs in a single
 * transaction and enforces:
 *   • at most one `employee_payroll` row per income_entry
 *   • at most one `employer` row per income_entry
 *   • ON CONFLICT upsert so concurrent retries never duplicate rows
 *   • cascading delete of linked rows via the FK when the income_entry
 *     is removed
 *
 * Manual/individual HSA rows (`created_from='manual'`, `income_entry_id
 * IS NULL`) are never touched.
 *
 * Per-role semantics (matching the RPC):
 *   amount > 0        → upsert the row for that role
 *   amount === 0      → delete the row for that role (if any)
 *   amount undefined  → do not touch that role
 */
import { supabase } from "@/integrations/supabase/client";

export interface IncomeEntryHsaSyncInput {
  incomeEntryId: string;
  /** userId/organizationId are resolved server-side from the income entry.
   *  Kept in the interface for backward-compatible call sites; unused. */
  userId?: string;
  organizationId?: string | null;
  /** Employee (Section-125 payroll) HSA amount. 0 clears the row; undefined
   *  leaves the employee row untouched. */
  amount?: number;
  /** Employer HSA amount. 0 clears the row; undefined leaves the employer
   *  row untouched. */
  employerAmount?: number;
  /** Falls back to income_entries.income_date when omitted. */
  contributionDate?: string;
  /** Falls back to income_entries.source_id when omitted. */
  companyId?: string | null;
  /** Deprecated — the RPC resolves the current linked row from the DB. */
  existingHsaId?: string | null;
  existingEmployerHsaId?: string | null;
}

export interface IncomeEntryHsaSyncResult {
  employeeId: string | null;
  employerId: string | null;
}

/**
 * Atomic wrapper around `public.sync_income_hsa_atomic`.
 *
 * Throws on failure — callers MUST decide whether to roll back the parent
 * income_entry write. Never swallow the error silently: a successful
 * paycheck save that fails HSA sync would leave the ledger inconsistent.
 */
export async function syncIncomeEntryHsa(
  input: IncomeEntryHsaSyncInput,
): Promise<IncomeEntryHsaSyncResult> {
  const {
    incomeEntryId,
    amount,
    employerAmount,
    contributionDate,
    companyId,
  } = input;

  if (!incomeEntryId) {
    // Guard: the RPC would reject this with a 22004, but we throw earlier so
    // callers get a clear, testable error rather than a raw DB message.
    throw new Error("HSA sync failed: incomeEntryId is required");
  }

  // `undefined` → don't touch that role. `null` normalizes to don't-touch too
  // so callers can safely spread partial updates.
  const employeeArg =
    amount === undefined || amount === null ? null : Number(amount || 0);
  const employerArg =
    employerAmount === undefined || employerAmount === null
      ? null
      : Number(employerAmount || 0);

  const { data, error } = await supabase.rpc("sync_income_hsa_atomic" as any, {
    p_income_entry_id: incomeEntryId,
    p_employee_amount: employeeArg,
    p_employer_amount: employerArg,
    p_contribution_date: contributionDate ?? null,
    p_company_id: companyId ?? null,
    p_notes: null,
  });
  if (error) {
    // Surface a stable message so retry UIs can render it.
    const msg = `HSA sync failed: ${error.message || "unknown error"}`;
    throw new Error(msg);
  }

  const payload = (data || {}) as {
    employee_id?: string | null;
    employer_id?: string | null;
  };
  return {
    employeeId: payload.employee_id ?? null,
    employerId: payload.employer_id ?? null,
  };
}

/**
 * No-op kept for source compatibility. Deleting an income_entry now cascades
 * to hsa_contributions via the FK, so callers no longer need to pre-delete
 * linked rows. Left in place so existing imports don't break; callers should
 * migrate away over time.
 */
export async function deleteLinkedPayrollHsaForIncomeEntry(
  _incomeEntryId: string,
): Promise<void> {
  // Intentional no-op — ON DELETE CASCADE on hsa_contributions.income_entry_id
  // now handles removal atomically as part of the parent DELETE.
}

/**
 * Repair utility for legacy data written before the atomic RPC + FK existed.
 * Rarely needed after the constraints go live; kept for one-off cleanup.
 * Idempotent — the RPC's ON CONFLICT upserts guarantee no duplicates.
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
        "id, hsa_contribution, employer_hsa_contribution, linked_hsa_contribution_id, linked_employer_hsa_contribution_id, income_date, source_id",
      )
      .or("hsa_contribution.gt.0,employer_hsa_contribution.gt.0");
    if (error) throw error;
    const rows = (candidates || []) as any[];
    result.scanned = rows.length;
    if (rows.length === 0) return result;

    for (const r of rows) {
      const empAmount = Number(r.hsa_contribution) || 0;
      const employerAmount = Number(r.employer_hsa_contribution) || 0;
      try {
        await syncIncomeEntryHsa({
          incomeEntryId: r.id,
          amount: empAmount,
          employerAmount,
          contributionDate: r.income_date,
          companyId: r.source_id ?? null,
        });
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
