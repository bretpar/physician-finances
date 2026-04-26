import { useMemo, useState } from "react";
import { getQuarterPayments, type QuarterLabel } from "@/lib/quarters";
import type { TaxPayment } from "@/hooks/useTaxPayments";
import { normalizeFilingType } from "@/lib/filingTypes";
import { getTotalFederalPaid } from "@/lib/federalWithholding";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";

export interface CompanyQuarterRow {
  key: string;
  label: string;
  paid: number;
  saved: number;
}

export type QuarterView = { year: number; quarter: 1 | 2 | 3 | 4 };
export type QuarterTone = "ok" | "ahead" | "soft" | "behind";

export interface QuarterlyEstimatorInput {
  annualTaxLiability: number;
  payments: TaxPayment[];
  incomeEntries: any[];
  personalEntries: any[];
  transactions: any[];
  companies: { id: string; name: string; companyType?: string }[];
  quarterMethod?: "even" | "dynamic";
  projectedPaychecks?: Array<{ date: string; grossAmount: number }>;
  initialView?: QuarterView;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const Q_META: Record<1 | 2 | 3 | 4, { label: QuarterLabel; deadlineLabel: string }> = {
  1: { label: "Q1", deadlineLabel: "Apr 15" },
  2: { label: "Q2", deadlineLabel: "Jun 15" },
  3: { label: "Q3", deadlineLabel: "Sep 15" },
  4: { label: "Q4", deadlineLabel: "Jan 15" },
};

export function buildEstimatorQuarter(year: number, quarter: 1 | 2 | 3 | 4) {
  const meta = Q_META[quarter];
  let start: Date;
  let end: Date;
  let deadline: Date;
  if (quarter === 1) {
    start = new Date(year, 0, 1);
    end = new Date(year, 3, 1);
    deadline = new Date(year, 3, 15);
  } else if (quarter === 2) {
    start = new Date(year, 3, 1);
    end = new Date(year, 6, 1);
    deadline = new Date(year, 5, 15);
  } else if (quarter === 3) {
    start = new Date(year, 6, 1);
    end = new Date(year, 9, 1);
    deadline = new Date(year, 8, 15);
  } else {
    start = new Date(year, 9, 1);
    end = new Date(year + 1, 0, 1);
    deadline = new Date(year + 1, 0, 15);
  }
  return { quarter, year, label: meta.label, deadlineLabel: meta.deadlineLabel, deadline, start, end };
}

export function stepEstimatorQuarter(year: number, quarter: 1 | 2 | 3 | 4, dir: -1 | 1): QuarterView {
  let q = quarter + dir;
  let y = year;
  if (q < 1) { q = 4; y -= 1; }
  if (q > 4) { q = 1; y += 1; }
  return { year: y, quarter: q as 1 | 2 | 3 | 4 };
}

export function getCurrentEstimatorQuarter(now: Date = new Date()): QuarterView {
  return { year: now.getFullYear(), quarter: (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4 };
}

export function useQuarterlyEstimator({
  annualTaxLiability,
  payments,
  incomeEntries,
  personalEntries,
  transactions,
  companies,
  quarterMethod = "even",
  projectedPaychecks = [],
  initialView,
}: QuarterlyEstimatorInput) {
  const initial = useMemo(() => initialView ?? getCurrentEstimatorQuarter(), [initialView]);
  const [view, setView] = useState<QuarterView>(initial);
  const q = useMemo(() => buildEstimatorQuarter(view.year, view.quarter), [view]);
  const isCurrentQuarter = view.quarter === initial.quarter && view.year === initial.year;

  const companyRows: CompanyQuarterRow[] = useMemo(() => {
    const inQuarter = (iso: string) => {
      const d = new Date(iso);
      return d >= q.start && d < q.end;
    };
    const companyById = new Map(companies.map((c) => [c.id, c] as const));
    const liveTxById = new Map(
      (transactions || [])
        .filter((t: any) => t.transaction_type === "income" && !isExcludedFromBusiness(t))
        .map((t: any) => [t.id, t] as const),
    );
    const buckets = new Map<string, { label: string; paid: number; saved: number }>();
    const ensure = (key: string, label: string) => {
      let row = buckets.get(key);
      if (!row) {
        row = { label, paid: 0, saved: 0 };
        buckets.set(key, row);
      }
      return row;
    };
    const filingHint = (filing: string | undefined): string => {
      if (filing === "scorp_w2" || filing === "w2") return "W-2";
      if (filing === "k1_partnership") return "K-1";
      if (filing === "1099_schedule_c") return "1099";
      return "";
    };

    for (const entry of incomeEntries || []) {
      if (!entry.linked_transaction_id) continue;
      const tx = liveTxById.get(entry.linked_transaction_id);
      if (!tx || !inQuarter(entry.income_date)) continue;
      const paid = getTotalFederalPaid(entry);
      const saved = Number((tx as any).actual_withholding || 0) + Number(entry.additional_tax_reserve || 0);
      if (paid <= 0 && saved <= 0) continue;
      const company = entry.source_id ? companyById.get(entry.source_id) : undefined;
      const filing = normalizeFilingType(entry.income_type || company?.companyType);
      const hint = filingHint(filing);
      const name = company?.name || entry.company || "Unassigned";
      const key = company?.id || `name:${name.toLowerCase().trim()}`;
      const row = ensure(key, hint ? `${name} (${hint})` : name);
      row.paid += paid;
      row.saved += saved;
    }

    for (const entry of personalEntries || []) {
      if (!inQuarter(entry.income_date)) continue;
      const paid = getTotalFederalPaid(entry);
      const saved = Number(entry.additional_tax_reserve || 0);
      if (paid <= 0 && saved <= 0) continue;
      const name = (entry.company || "Personal W-2").trim() || "Personal W-2";
      const row = ensure(`personal:${name.toLowerCase()}`, `${name} (W-2)`);
      row.paid += paid;
      row.saved += saved;
    }

    return Array.from(buckets.entries()).map(([key, value]) => ({ key, ...value }));
  }, [incomeEntries, personalEntries, transactions, companies, q.start, q.end]);

  const quarterlyPayments = useMemo(
    () => getQuarterPayments(payments, q.label, view.year),
    [payments, q.label, view.year],
  );

  const quarterTarget = useMemo(() => {
    if (quarterMethod !== "dynamic") return Math.max(0, annualTaxLiability / 4);
    const inWin = (iso: string) => {
      const d = new Date(iso);
      return d >= q.start && d < q.end;
    };
    const yearStart = new Date(view.year, 0, 1);
    const yearEnd = new Date(view.year + 1, 0, 1);
    const inYear = (iso: string) => {
      const d = new Date(iso);
      return d >= yearStart && d < yearEnd;
    };
    let qIncome = 0;
    let yearIncome = 0;
    for (const t of transactions || []) {
      if (t.transaction_type !== "income") continue;
      const amount = Math.abs(Number(t.amount) || 0);
      if (inYear(t.transaction_date)) yearIncome += amount;
      if (inWin(t.transaction_date)) qIncome += amount;
    }
    for (const entry of personalEntries || []) {
      const amount = Number(entry.gross_amount || entry.paycheck_amount || 0);
      if (inYear(entry.income_date)) yearIncome += amount;
      if (inWin(entry.income_date)) qIncome += amount;
    }
    for (const paycheck of projectedPaychecks || []) {
      const amount = Number(paycheck.grossAmount || 0);
      if (inYear(paycheck.date)) yearIncome += amount;
      if (inWin(paycheck.date)) qIncome += amount;
    }
    return yearIncome > 0 ? Math.max(0, annualTaxLiability * (qIncome / yearIncome)) : 0;
  }, [quarterMethod, annualTaxLiability, transactions, personalEntries, projectedPaychecks, q.start, q.end, view.year]);

  const paidFromCompanies = companyRows.reduce((sum, row) => sum + row.paid, 0);
  const paidThisQuarter = paidFromCompanies + quarterlyPayments;
  const rawSavedThisQuarter = companyRows.reduce((sum, row) => sum + row.saved, 0);
  const savedThisQuarter = Math.max(0, rawSavedThisQuarter - quarterlyPayments);
  const progressAmount = paidThisQuarter + savedThisQuarter;
  const remainingThisQuarter = Math.max(0, quarterTarget - progressAmount);

  const now = new Date();
  const totalDays = Math.max(1, (q.end.getTime() - q.start.getTime()) / 86400000);
  const elapsedDays = (now.getTime() - q.start.getTime()) / 86400000;
  const quarterProgress = Math.max(0, Math.min(1, elapsedDays / totalDays));
  const isFutureQuarter = now < q.start;
  const isPastQuarter = now >= q.end;
  const expectedByNow = quarterTarget * quarterProgress;
  const paceDiff = progressAmount - expectedByNow;
  const tolerance = Math.max(expectedByNow * 0.1, 250);

  let tone: QuarterTone;
  let message: string;
  if (quarterTarget === 0) {
    tone = "ok";
    message = "No estimated tax target this quarter.";
  } else if (isFutureQuarter) {
    tone = "soft";
    message = `${q.label} hasn't started yet — nothing due today.`;
  } else if (isPastQuarter) {
    tone = progressAmount + tolerance >= quarterTarget ? "ok" : "behind";
    message = progressAmount + tolerance >= quarterTarget ? `${q.label} complete.` : `${q.label} ended ${fmt(Math.max(0, quarterTarget - progressAmount))} short.`;
  } else if (quarterProgress < 0.1) {
    tone = "soft";
    message = expectedByNow > 0 && progressAmount < expectedByNow - tolerance ? `Early in the quarter — aim for ${fmt(expectedByNow)} by today.` : "Early in the quarter — pacing toward the next deadline.";
  } else if (paceDiff >= tolerance) {
    tone = "ahead";
    message = `Ahead of pace by ${fmt(paceDiff)}`;
  } else if (Math.abs(paceDiff) < tolerance) {
    tone = "ok";
    message = "On pace for this point in the quarter";
  } else if (paceDiff > -tolerance * 2) {
    tone = "soft";
    message = `A little behind — set aside ${fmt(-paceDiff)} more`;
  } else {
    tone = "behind";
    message = `To stay on pace, save ${fmt(-paceDiff)} more`;
  }

  const paidPct = quarterTarget > 0 ? Math.min(100, (paidThisQuarter / quarterTarget) * 100) : 0;
  const savedPct = Math.max(0, Math.min(100 - paidPct, quarterTarget > 0 ? (savedThisQuarter / quarterTarget) * 100 : 0));
  const expectedPct = quarterTarget > 0 ? Math.min(100, quarterProgress * 100) : 0;

  const offset = Math.min(rawSavedThisQuarter, quarterlyPayments);
  const adjustedCompanyRows = [...companyRows]
    .sort((a, b) => (b.paid + b.saved) - (a.paid + a.saved))
    .map((row) => {
      const share = rawSavedThisQuarter > 0 ? row.saved / rawSavedThisQuarter : 0;
      return { ...row, saved: Math.max(0, row.saved - offset * share) };
    });
  const rows = [
    ...adjustedCompanyRows,
    { key: "__quarterly_payments__", label: `${q.label} estimated payments`, paid: quarterlyPayments, saved: 0 },
  ];

  return {
    view,
    setView,
    q,
    isCurrentQuarter,
    companyRows,
    quarterlyPayments,
    quarterTarget,
    paidThisQuarter,
    rawSavedThisQuarter,
    savedThisQuarter,
    progressAmount,
    remainingThisQuarter,
    quarterProgress,
    expectedByNow,
    paceDiff,
    tone,
    message,
    paidPct,
    savedPct,
    expectedPct,
    rows,
    hasAny: rows.some((row) => row.paid > 0 || row.saved > 0),
    goPrev: () => setView(stepEstimatorQuarter(view.year, view.quarter, -1)),
    goNext: () => setView(stepEstimatorQuarter(view.year, view.quarter, 1)),
  };
}
