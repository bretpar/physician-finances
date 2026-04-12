import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { addDays, addWeeks, addMonths, startOfDay, endOfYear, isAfter, isBefore, parseISO, format, isSameDay } from "date-fns";

/* ─── Types ─── */
export interface ProjectedIncomeStream {
  id: string;
  user_id: string;
  organization_id: string | null;
  company: string;
  company_type: string;
  pay_frequency: string;
  custom_interval_days: number | null;
  start_date: string;
  end_date: string | null;
  paycheck_amount: number;
  taxes_withheld: number;
  retirement_401k: number;
  pre_tax_deductions: number;
  is_active: boolean;
  include_in_tax: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectedBonusEvent {
  id: string;
  stream_id: string;
  user_id: string;
  organization_id: string | null;
  name: string;
  amount: number;
  taxes_withheld: number;
  frequency: string;
  scheduled_date: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectedPaycheck {
  date: string;
  grossAmount: number;
  taxesWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
  netAmount: number;
  type: "paycheck" | "bonus";
  label: string;
  streamId: string;
}

/* ─── Helpers ─── */

/**
 * Determine if a stream is "expired" — its end_date has passed
 * OR it's a one-time ("single") entry whose start_date has passed.
 * Expired streams should not contribute to future income projections.
 */
export function isStreamExpired(stream: ProjectedIncomeStream): boolean {
  const today = startOfDay(new Date());
  // One-time entries expire after their date
  if (stream.pay_frequency === "single") {
    const d = parseISO(stream.start_date);
    return isBefore(d, today) && !isSameDay(d, today);
  }
  // Recurring streams expire when end_date has passed
  if (stream.end_date) {
    const end = parseISO(stream.end_date);
    return isBefore(end, today) && !isSameDay(end, today);
  }
  return false;
}

/* ─── Queries ─── */
export function useProjectedStreams() {
  return useQuery({
    queryKey: ["projected_income_streams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projected_income_streams")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ProjectedIncomeStream[];
    },
  });
}

export function useProjectedBonuses(streamId?: string) {
  return useQuery({
    queryKey: ["projected_bonus_events", streamId],
    queryFn: async () => {
      let q = supabase.from("projected_bonus_events").select("*").order("scheduled_date");
      if (streamId) q = q.eq("stream_id", streamId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ProjectedBonusEvent[];
    },
  });
}

/* ─── Mutations ─── */
export function useAddStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stream: Partial<ProjectedIncomeStream>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("projected_income_streams").insert({
        user_id: user.id,
        organization_id: orgId,
        company: stream.company || "",
        company_type: stream.company_type || "W2",
        pay_frequency: stream.pay_frequency || "biweekly",
        custom_interval_days: stream.custom_interval_days || null,
        start_date: stream.start_date || new Date().toISOString().split("T")[0],
        end_date: stream.end_date || null,
        paycheck_amount: stream.paycheck_amount || 0,
        taxes_withheld: stream.taxes_withheld || 0,
        retirement_401k: stream.retirement_401k || 0,
        pre_tax_deductions: stream.pre_tax_deductions || 0,
        is_active: stream.is_active ?? true,
        include_in_tax: stream.include_in_tax ?? true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_streams"] });
      toast.success("Projected income stream created");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectedIncomeStream> & { id: string }) => {
      const { error } = await supabase
        .from("projected_income_streams")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_streams"] });
      toast.success("Income stream updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projected_income_streams")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_streams"] });
      qc.invalidateQueries({ queryKey: ["projected_bonus_events"] });
      toast.success("Income stream deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useAddBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bonus: Partial<ProjectedBonusEvent> & { stream_id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("projected_bonus_events").insert({
        stream_id: bonus.stream_id,
        user_id: user.id,
        organization_id: orgId,
        name: bonus.name || "",
        amount: bonus.amount || 0,
        taxes_withheld: bonus.taxes_withheld || 0,
        frequency: bonus.frequency || "one-time",
        scheduled_date: bonus.scheduled_date || new Date().toISOString().split("T")[0],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_bonus_events"] });
      toast.success("Bonus event added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projected_bonus_events")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_bonus_events"] });
      toast.success("Bonus event deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}

/* ─── Projection engine ─── */
function getNextDate(current: Date, frequency: string, customDays?: number | null): Date {
  switch (frequency) {
    case "weekly": return addWeeks(current, 1);
    case "biweekly": return addWeeks(current, 2);
    case "monthly": return addMonths(current, 1);
    case "custom": return addDays(current, customDays || 14);
    default: return addWeeks(current, 2);
  }
}

export function generateProjectedPaychecks(
  streams: ProjectedIncomeStream[],
  bonuses: ProjectedBonusEvent[],
  existingIncomeDates?: Set<string>
): ProjectedPaycheck[] {
  const now = startOfDay(new Date());
  const yearEnd = endOfYear(now);
  const paychecks: ProjectedPaycheck[] = [];

  for (const stream of streams) {
    if (!stream.is_active || !stream.include_in_tax) continue;
    // Skip expired streams — they should not contribute to future projections
    if (isStreamExpired(stream)) continue;

    const start = parseISO(stream.start_date);
    const end = stream.end_date ? parseISO(stream.end_date) : yearEnd;

    let current = start;
    // Advance to next future date if start is in the past
    while (isBefore(current, now)) {
      current = getNextDate(current, stream.pay_frequency, stream.custom_interval_days);
    }

    while (!isAfter(current, end) && !isAfter(current, yearEnd)) {
      const dateStr = format(current, "yyyy-MM-dd");
      // Skip if an actual income entry exists on this date (avoid duplication)
      if (!existingIncomeDates?.has(dateStr)) {
        const net = stream.paycheck_amount - stream.taxes_withheld - stream.retirement_401k - stream.pre_tax_deductions;
        paychecks.push({
          date: dateStr,
          grossAmount: stream.paycheck_amount,
          taxesWithheld: stream.taxes_withheld,
          retirement401k: stream.retirement_401k,
          preTaxDeductions: stream.pre_tax_deductions,
          netAmount: Math.max(0, net),
          type: "paycheck",
          label: stream.company,
          streamId: stream.id,
        });
      }
      current = getNextDate(current, stream.pay_frequency, stream.custom_interval_days);
    }
  }

  // Bonuses
  for (const bonus of bonuses) {
    const stream = streams.find((s) => s.id === bonus.stream_id);
    if (!stream?.is_active) continue;

    const dates: Date[] = [];
    const baseDate = parseISO(bonus.scheduled_date);

    if (bonus.frequency === "one-time") {
      if (!isBefore(baseDate, now) && !isAfter(baseDate, yearEnd)) {
        dates.push(baseDate);
      }
    } else if (bonus.frequency === "quarterly") {
      let d = baseDate;
      while (!isAfter(d, yearEnd)) {
        if (!isBefore(d, now)) dates.push(d);
        d = addMonths(d, 3);
      }
    } else if (bonus.frequency === "annual") {
      if (!isBefore(baseDate, now) && !isAfter(baseDate, yearEnd)) {
        dates.push(baseDate);
      }
    }

    for (const d of dates) {
      paychecks.push({
        date: format(d, "yyyy-MM-dd"),
        grossAmount: bonus.amount,
        taxesWithheld: bonus.taxes_withheld,
        retirement401k: 0,
        preTaxDeductions: 0,
        netAmount: Math.max(0, bonus.amount - bonus.taxes_withheld),
        type: "bonus",
        label: `${bonus.name} (${stream?.company || "Bonus"})`,
        streamId: bonus.stream_id,
      });
    }
  }

  return paychecks.sort((a, b) => a.date.localeCompare(b.date));
}

/* ─── Aggregate projected totals ─── */
export function getProjectedTotals(paychecks: ProjectedPaycheck[]) {
  return paychecks.reduce(
    (acc, p) => ({
      grossIncome: acc.grossIncome + p.grossAmount,
      taxesWithheld: acc.taxesWithheld + p.taxesWithheld,
      retirement401k: acc.retirement401k + p.retirement401k,
      preTaxDeductions: acc.preTaxDeductions + p.preTaxDeductions,
      netIncome: acc.netIncome + p.netAmount,
      count: acc.count + 1,
    }),
    { grossIncome: 0, taxesWithheld: 0, retirement401k: 0, preTaxDeductions: 0, netIncome: 0, count: 0 }
  );
}
