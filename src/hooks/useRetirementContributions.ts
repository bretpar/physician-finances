import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { useMemo } from "react";

/**
 * Standalone retirement contributions (made outside the paycheck flow).
 *
 * Three orthogonal facts are recorded per row:
 *  - `account_type`  → which plan (401k, Solo 401(k), SEP IRA, IRAs, …)
 *  - `contribution_type` → who funded it (employee / employer / personal)
 *  - `company_id`    → which business the plan belongs to (null for IRAs)
 *
 * Tax treatment is deliberately narrow: only pre-tax employer/employee plan
 * money is treated as a deduction. Roth IRA is never deductible, and
 * Traditional IRA is tracked only (deductibility depends on IRA rules the tax
 * engine does not model yet).
 */

export const ACCOUNT_TYPES = [
  { value: "401k", label: "401(k)" },
  { value: "solo_401k", label: "Solo 401(k)" },
  { value: "403b", label: "403(b)" },
  { value: "457b", label: "457(b)" },
  { value: "sep_ira", label: "SEP IRA" },
  { value: "simple_ira", label: "SIMPLE IRA" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "hsa", label: "HSA (Pre-Tax)" },
] as const;

export const CONTRIBUTION_TYPES = [
  { value: "employee", label: "Employee" },
  { value: "employer", label: "Employer" },
  { value: "personal", label: "Personal" },
] as const;

export const FREQUENCIES = [
  { value: "one_time", label: "One-time" },
  { value: "per_paycheck", label: "Per Paycheck" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

/** Personal IRA plans — never tied to a company, never a 401(k) deferral. */
export const IRA_PLANS = ["traditional_ira", "roth_ira"] as const;
/** Plans sponsored by an employer or business. */
export const EMPLOYER_SPONSORED_PLANS = [
  "401k",
  "solo_401k",
  "403b",
  "457b",
  "sep_ira",
  "simple_ira",
] as const;

export const isIraPlan = (accountType: string) =>
  (IRA_PLANS as readonly string[]).includes(accountType);
export const isRothPlan = (accountType: string) => accountType === "roth_ira";
export const isTraditionalIra = (accountType: string) => accountType === "traditional_ira";
export const isEmployerSponsoredPlan = (accountType: string) =>
  (EMPLOYER_SPONSORED_PLANS as readonly string[]).includes(accountType);
/** Employee elective deferrals count against the 402(g) limit. */
export const countsTowardEmployeeDeferral = (c: {
  account_type: string;
  contribution_type?: string | null;
}) =>
  isEmployerSponsoredPlan(c.account_type) &&
  c.account_type !== "sep_ira" &&
  c.account_type !== "hsa" &&
  (c.contribution_type ?? "employee") === "employee";

export const getAccountTypeLabel = (v: string) =>
  ACCOUNT_TYPES.find((a) => a.value === v)?.label || v;
export const getContributionTypeLabel = (v?: string | null) =>
  CONTRIBUTION_TYPES.find((c) => c.value === (v || "employee"))?.label || "Employee";

export interface RetirementContribution {
  id: string;
  user_id: string;
  organization_id: string | null;
  account_type: string;
  /** employee | employer | personal. Legacy rows default to employee. */
  contribution_type: string;
  company_id: string | null;
  contribution_amount: number;
  frequency: string;
  start_date: string;
  end_date: string | null;
  employer_match: number;
  apply_to_withholding: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useRetirementContributions() {
  return useQuery({
    queryKey: ["retirement_contributions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("retirement_contributions" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data || []) as unknown as RetirementContribution[]).map((c) => ({
        ...c,
        contribution_type: c.contribution_type || "employee",
        company_id: c.company_id ?? null,
      }));
    },
  });
}

export function useAddRetirementContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<RetirementContribution>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const accountType = entry.account_type || "401k";
      const { error } = await supabase.from("retirement_contributions" as any).insert({
        user_id: user.id,
        organization_id: orgId,
        account_type: accountType,
        contribution_type: entry.contribution_type || "employee",
        company_id: isIraPlan(accountType) ? null : entry.company_id || null,
        contribution_amount: entry.contribution_amount || 0,
        frequency: entry.frequency || "one_time",
        start_date: entry.start_date || new Date().toISOString().split("T")[0],
        end_date: entry.end_date || null,
        employer_match: entry.employer_match || 0,
        apply_to_withholding: entry.apply_to_withholding ?? true,
        notes: entry.notes || "",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retirement_contributions"] });
      toast.success("Contribution added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateRetirementContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<RetirementContribution> & { id: string }) => {
      const patch: any = { ...updates };
      if (patch.account_type && isIraPlan(patch.account_type)) patch.company_id = null;
      const { error } = await supabase
        .from("retirement_contributions" as any)
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retirement_contributions"] });
      toast.success("Contribution updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteRetirementContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("retirement_contributions" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retirement_contributions"] });
      toast.success("Contribution deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}

export interface AnnualizedContributions {
  /** Every standalone contribution, annualized only when recurring. */
  total: number;
  /** Amount treated as a pre-tax deduction (Roth and Traditional IRA excluded). */
  deductibleTotal: number;
  /** Employee-funded plan contributions (excludes IRAs). */
  employeeTotal: number;
  /** Employer-funded plan contributions. */
  employerTotal: number;
  /** Employee elective deferrals counting against the 402(g) limit. */
  employeeDeferralTotal: number;
  traditionalIraTotal: number;
  rothIraTotal: number;
  /** Deductible amount flagged as affecting withholding. */
  withholding: number;
  projectionOnly: number;
  perPaycheck: number;
  /** Plan contributions grouped by company id (IRAs excluded). */
  byCompany: Map<string, { employee: number; employer: number }>;
}

/**
 * Annualize recurring contributions; one-time contributions keep their exact
 * amount (never multiplied into a per-paycheck series).
 */
export function annualizeContributionAmount(c: {
  contribution_amount: number | string;
  frequency: string;
}): { annual: number; perPaycheck: number } {
  const amt = Number(c.contribution_amount) || 0;
  switch (c.frequency) {
    case "one_time":
      return { annual: amt, perPaycheck: 0 };
    case "per_paycheck":
      return { annual: amt * 26, perPaycheck: amt };
    case "monthly":
      return { annual: amt * 12, perPaycheck: amt / 2 };
    case "yearly":
      return { annual: amt, perPaycheck: amt / 26 };
    default:
      return { annual: amt * 12, perPaycheck: amt / 12 };
  }
}

export function useAnnualizedContributions(
  contributions: RetirementContribution[] | undefined,
): AnnualizedContributions {
  return useMemo(() => {
    const empty: AnnualizedContributions = {
      total: 0, deductibleTotal: 0, employeeTotal: 0, employerTotal: 0,
      employeeDeferralTotal: 0, traditionalIraTotal: 0, rothIraTotal: 0,
      withholding: 0, projectionOnly: 0, perPaycheck: 0, byCompany: new Map(),
    };
    if (!contributions || contributions.length === 0) return empty;

    const today = new Date().toISOString().split("T")[0];
    const out: AnnualizedContributions = { ...empty, byCompany: new Map() };

    for (const c of contributions) {
      // One-time contributions are historical facts and always count.
      const recurring = c.frequency !== "one_time";
      if (recurring && c.end_date && c.end_date < today) continue;
      if (recurring && c.start_date > today) continue;

      const { annual, perPaycheck } = annualizeContributionAmount(c);
      const type = c.contribution_type || "employee";

      out.total += annual;
      out.perPaycheck += perPaycheck;

      if (isRothPlan(c.account_type)) {
        // Roth never reduces AGI and is never a pre-tax deduction.
        out.rothIraTotal += annual;
        continue;
      }
      if (isTraditionalIra(c.account_type)) {
        // Tracking only — deductibility depends on IRA rules not modeled here.
        out.traditionalIraTotal += annual;
        continue;
      }

      // Pre-tax employer/employee plan money.
      out.deductibleTotal += annual;
      if (c.apply_to_withholding) out.withholding += annual;
      else out.projectionOnly += annual;

      if (type === "employer") out.employerTotal += annual;
      else out.employeeTotal += annual;

      if (countsTowardEmployeeDeferral(c)) out.employeeDeferralTotal += annual;

      if (c.company_id) {
        const rec = out.byCompany.get(c.company_id) || { employee: 0, employer: 0 };
        if (type === "employer") rec.employer += annual;
        else rec.employee += annual;
        out.byCompany.set(c.company_id, rec);
      }
    }

    return out;
  }, [contributions]);
}
