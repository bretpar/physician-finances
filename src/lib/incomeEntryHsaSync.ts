/**
 * Canonical HSA synchronization for income_entries.
 *
 * A W-2 paycheck can now carry TWO independent HSA amounts:
 *   • Employee (Section 125 pre-tax payroll) — reduces the employee's W-2
 *     wages upstream; linked via `income_entries.linked_hsa_contribution_id`.
 *   • Employer HSA contribution — funded by the employer, not by the
 *     employee. Linked via `income_entries.linked_employer_hsa_contribution_id`.
 *
 * For each role independently, exactly ONE hsa_contributions row must exist
 * per income_entry:
 *   amount > 0, no existing linked row → INSERT
 *   amount > 0, existing linked row    → UPDATE (preserve id)
 *   amount <= 0, existing linked row   → DELETE
 *   amount <= 0, no existing row       → no-op
 *
 * Manual/individual HSA rows (`created_from='manual'`) are never touched.
 */
import { supabase } from "@/integrations/supabase/client";
import { syncPayrollHsaForIncome } from "@/hooks/useHsaContributions";

export interface IncomeEntryHsaSyncInput {
  incomeEntryId: string;
  userId: string;
  organizationId: string | null;
  /** Raw employee hsa_contribution value from the income form (0 clears). */
  amount: number;
  /** Employer HSA amount from the income form (0 clears). Optional for callers
   *  that don't touch this field. */
  employerAmount?: number;
  contributionDate: string;
  /** Company that owns the paycheck; used for company_id on hsa row. */
  companyId: string | null;
  /**
   * Existing `linked_hsa_contribution_id` on the income_entry (employee side).
   * When omitted, the helper looks it up.
   */
  existingHsaId?: string | null;
  /**
   * Existing `linked_employer_hsa_contribution_id` on the income_entry.
   * When omitted, the helper looks it up.
   */
  existingEmployerHsaId?: string | null;
}

async function resolveExisting(
  incomeEntryId: string,
  suppliedEmployee: string | null | undefined,
  suppliedEmployer: string | null | undefined,
): Promise<{ employee: string | null; employer: string | null }> {
  const needsFetch = suppliedEmployee === undefined || suppliedEmployer === undefined;
  let employee = suppliedEmployee ?? null;
  let employer = suppliedEmployer ?? null;
  if (needsFetch) {
    const { data: row } = await supabase
      .from("income_entries")
      .select("linked_hsa_contribution_id, linked_employer_hsa_contribution_id")
      .eq("id", incomeEntryId)
      .maybeSingle();
    if (suppliedEmployee === undefined) {
      employee = ((row as any)?.linked_hsa_contribution_id as string | null) ?? null;
    }
    if (suppliedEmployer === undefined) {
      employer = ((row as any)?.linked_employer_hsa_contribution_id as string | null) ?? null;
    }
  }

  // Prune dead pointers (e.g. hsa row was deleted manually).
  const candidates = [employee, employer].filter(Boolean) as string[];
  if (candidates.length) {
    const { data: live } = await supabase
      .from("hsa_contributions" as any)
      .select("id")
      .in("id", candidates);
    const alive = new Set((live || []).map((r: any) => r.id));
    if (employee && !alive.has(employee)) employee = null;
    if (employer && !alive.has(employer)) employer = null;
  }
  return { employee, employer };
}

/**
 * Sync BOTH employee and (optionally) employer payroll HSA rows for an
 * income entry, and persist the resulting linked ids back onto the entry.
 * Safe to call after every income_entry insert or update. Failures are
 * logged but never thrown — HSA sync failing must not block the income save.
 *
 * Returns the resolved linked ids.
 */
export async function syncIncomeEntryHsa(
  input: IncomeEntryHsaSyncInput,
): Promise<{ employeeId: string | null; employerId: string | null }> {
  const {
    incomeEntryId,
    userId,
    organizationId,
    amount,
    employerAmount,
    contributionDate,
    companyId,
    existingHsaId,
    existingEmployerHsaId,
  } = input;

  try {
    const existing = await resolveExisting(incomeEntryId, existingHsaId, existingEmployerHsaId);

    const employeeId = await syncPayrollHsaForIncome({
      userId,
      organizationId,
      incomeEntryId,
      existingHsaId: existing.employee,
      amount: Number(amount || 0),
      contributionDate,
      companyId,
      role: "employee",
    });

    // Only touch employer row when the caller passed the field (undefined ==
    // "don't manage employer side this call"). 0 explicitly clears it.
    let employerId: string | null = existing.employer;
    if (employerAmount !== undefined) {
      employerId = await syncPayrollHsaForIncome({
        userId,
        organizationId,
        incomeEntryId,
        existingHsaId: existing.employer,
        amount: Number(employerAmount || 0),
        contributionDate,
        companyId,
        role: "employer",
      });
    }

    const patch: Record<string, unknown> = {};
    if (employeeId !== existing.employee) patch.linked_hsa_contribution_id = employeeId;
    if (employerAmount !== undefined && employerId !== existing.employer) {
      patch.linked_employer_hsa_contribution_id = employerId;
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from("income_entries").update(patch as any).eq("id", incomeEntryId);
    }
    return { employeeId, employerId };
  } catch (err) {
    console.error("[syncIncomeEntryHsa] failed", err);
    return { employeeId: null, employerId: null };
  }
}

/**
 * Delete BOTH linked payroll HSA rows (employee + employer, if any) for an
 * income_entry. Manual/individual HSA rows untouched.
 */
export async function deleteLinkedPayrollHsaForIncomeEntry(
  incomeEntryId: string,
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from("income_entries")
      .select("linked_hsa_contribution_id, linked_employer_hsa_contribution_id")
      .eq("id", incomeEntryId)
      .maybeSingle();
    const ids = [
      ((row as any)?.linked_hsa_contribution_id as string | null) ?? null,
      ((row as any)?.linked_employer_hsa_contribution_id as string | null) ?? null,
    ].filter(Boolean) as string[];
    if (ids.length === 0) return;
    await supabase.from("hsa_contributions" as any).delete().in("id", ids);
  } catch (err) {
    console.warn("[deleteLinkedPayrollHsaForIncomeEntry] skipped:", err);
  }
}

/**
 * Repair routine: find income_entries whose hsa_contribution > 0 but whose
 * linked_hsa_contribution_id is null or points to a missing row, and
 * create/repoint the employee payroll HSA row. Employer side is only touched
 * when `employer_hsa_contribution > 0` and its link is dead/missing.
 * Idempotent — never creates duplicates.
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
        "id, user_id, organization_id, income_date, source_id, hsa_contribution, employer_hsa_contribution, linked_hsa_contribution_id, linked_employer_hsa_contribution_id",
      )
      .or("hsa_contribution.gt.0,employer_hsa_contribution.gt.0");
    if (error) throw error;
    const rows = (candidates || []) as any[];
    result.scanned = rows.length;
    if (rows.length === 0) return result;

    // Validate all linked ids in a batch.
    const linkedIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.linked_hsa_contribution_id, r.linked_employer_hsa_contribution_id])
          .filter(Boolean) as string[],
      ),
    );
    const liveLinkedIds = new Set<string>();
    if (linkedIds.length > 0) {
      const { data: live } = await supabase
        .from("hsa_contributions" as any)
        .select("id")
        .in("id", linkedIds);
      for (const r of (live || []) as any[]) liveLinkedIds.add(r.id);
    }

    // Existing hsa rows grouped by (income_entry_id, role) to avoid dupes.
    const entryIds = rows.map((r) => r.id as string);
    const existingByKey = new Map<string, string>(); // key = `${entryId}:${role}`
    if (entryIds.length > 0) {
      const { data: existing } = await supabase
        .from("hsa_contributions" as any)
        .select("id, income_entry_id, linked_income_entry_role")
        .in("income_entry_id", entryIds);
      for (const r of (existing || []) as any[]) {
        const role = r.linked_income_entry_role ?? "employee";
        const key = `${r.income_entry_id}:${role}`;
        if (!existingByKey.has(key)) existingByKey.set(key, r.id);
      }
    }

    for (const r of rows) {
      const empAmount = Number(r.hsa_contribution) || 0;
      const employerAmount = Number(r.employer_hsa_contribution) || 0;

      const empLink = r.linked_hsa_contribution_id as string | null;
      const employerLink = r.linked_employer_hsa_contribution_id as string | null;
      const empAlive = empLink ? liveLinkedIds.has(empLink) : false;
      const employerAlive = employerLink ? liveLinkedIds.has(employerLink) : false;

      const empExistingRow = existingByKey.get(`${r.id}:employee`) || null;
      const employerExistingRow = existingByKey.get(`${r.id}:employer`) || null;

      const needEmployeeRepair = empAmount > 0 && !empAlive;
      const needEmployerRepair = employerAmount > 0 && !employerAlive;
      if (!needEmployeeRepair && !needEmployerRepair) continue;

      try {
        // Prefer repointing over inserting to preserve ids.
        const patch: Record<string, unknown> = {};
        let handledEmployee = false;
        let handledEmployer = false;
        if (needEmployeeRepair && empExistingRow) {
          patch.linked_hsa_contribution_id = empExistingRow;
          handledEmployee = true;
        }
        if (needEmployerRepair && employerExistingRow) {
          patch.linked_employer_hsa_contribution_id = employerExistingRow;
          handledEmployer = true;
        }
        if (Object.keys(patch).length > 0) {
          await supabase.from("income_entries").update(patch as any).eq("id", r.id);
        }
        if ((needEmployeeRepair && !handledEmployee) || (needEmployerRepair && !handledEmployer)) {
          await syncIncomeEntryHsa({
            incomeEntryId: r.id,
            userId: r.user_id,
            organizationId: r.organization_id ?? null,
            amount: empAmount,
            employerAmount,
            contributionDate: r.income_date,
            companyId: r.source_id ?? null,
            existingHsaId: handledEmployee ? empExistingRow : null,
            existingEmployerHsaId: handledEmployer ? employerExistingRow : null,
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
