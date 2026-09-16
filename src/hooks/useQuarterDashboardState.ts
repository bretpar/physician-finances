/**
 * Small per-user Dashboard state for estimated-tax quarters.
 *
 * Two responsibilities only — no tax math lives here:
 *  1. `dismissed_at` — the user pressed "Done with Q3": the Dashboard payment
 *     callout for that quarter is hidden so the Dashboard moves forward. This
 *     is an acknowledgment, NOT a tax payment, and never touches tax_payments.
 *  2. `frozen_quarter_target` — snapshot of the canonical quarter target taken
 *     once the quarter's income period has closed, so later-quarter income can
 *     no longer retroactively increase a closed quarter's recommendation.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";

export interface QuarterDashboardStateRow {
  id: string;
  tax_year: number;
  quarter: number;
  dismissed_at: string | null;
  frozen_quarter_target: number | null;
}

const KEY = ["quarter_dashboard_state"];

export function useQuarterDashboardState() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quarter_dashboard_state" as any)
        .select("id, tax_year, quarter, dismissed_at, frozen_quarter_target");
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        ...r,
        frozen_quarter_target:
          r.frozen_quarter_target == null ? null : Number(r.frozen_quarter_target),
      })) as QuarterDashboardStateRow[];
    },
  });
}

export function findQuarterState(
  rows: QuarterDashboardStateRow[] | undefined,
  taxYear: number,
  quarter: number,
): QuarterDashboardStateRow | undefined {
  return (rows || []).find((r) => r.tax_year === taxYear && r.quarter === quarter);
}

async function upsertState(
  taxYear: number,
  quarter: number,
  patch: Partial<Pick<QuarterDashboardStateRow, "dismissed_at" | "frozen_quarter_target">>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const organization_id = await getUserOrgId();
  const { error } = await supabase
    .from("quarter_dashboard_state" as any)
    .upsert(
      {
        user_id: user.id,
        organization_id,
        tax_year: taxYear,
        quarter,
        ...patch,
      } as any,
      { onConflict: "user_id,tax_year,quarter" },
    );
  if (error) throw error;
}

/** "Done with Q#": hide the Dashboard payment callout for that quarter. */
export function useDismissQuarterCallout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taxYear, quarter }: { taxYear: number; quarter: number }) =>
      upsertState(taxYear, quarter, { dismissed_at: new Date().toISOString() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** One-time snapshot of a closed quarter's target. */
export function useFreezeQuarterTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taxYear,
      quarter,
      target,
    }: {
      taxYear: number;
      quarter: number;
      target: number;
    }) => upsertState(taxYear, quarter, { frozen_quarter_target: target }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
