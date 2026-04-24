import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Sparkles, Compass, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { getCurrentQuarter, getQuarterPayments, type QuarterLabel } from "@/lib/quarters";
import type { TaxPayment } from "@/hooks/useTaxPayments";
import { normalizeFilingType } from "@/lib/filingTypes";
import { getTotalFederalPaid, getTotalFederalPaidDetail, federalSourceLabel, type FederalWithholdingSource } from "@/lib/federalWithholding";
import { debugFlags, useDebugFlag } from "@/lib/debugFlags";
import { Switch } from "@/components/ui/switch";

/** Per-company current-quarter row split into paid (real withholdings) vs saved (reserves). */
export interface CompanyQuarterRow {
  key: string;
  label: string;
  paid: number;
  saved: number;
  /** Debug-only: which fields powered the `paid` total (counts per source). */
  sources?: Partial<Record<FederalWithholdingSource, number>>;
}

interface QuarterlyTrackerProps {
  annualTaxLiability: number;
  /** All tax payments — filtered internally by the displayed quarter + year. */
  payments: TaxPayment[];
  methodLabel?: string;
  /** Raw inputs — filtered by the displayed quarter window inside the tracker. */
  incomeEntries: any[];
  personalEntries: any[];
  transactions: any[];
  companies: { id: string; name: string; companyType?: string }[];
  /** "even" = annual / 4. "dynamic" = share-based on actual + planned income in this quarter. */
  quarterMethod?: "even" | "dynamic";
  /** Projected paychecks (date + grossAmount). Used only when quarterMethod="dynamic". */
  projectedPaychecks?: Array<{ date: string; grossAmount: number }>;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const Q_META: Record<1 | 2 | 3 | 4, { label: string; deadlineLabel: string }> = {
  1: { label: "Q1", deadlineLabel: "Apr 15" },
  2: { label: "Q2", deadlineLabel: "Jun 15" },
  3: { label: "Q3", deadlineLabel: "Sep 15" },
  4: { label: "Q4", deadlineLabel: "Jan 15" },
};

/** Build a quarter info object for an arbitrary (year, quarter) pair.
 *  `year` is the *owning* tax year (e.g. Q4 2026 has its deadline on Jan 15 2027).
 *  Window aligns with IRS estimated-tax periods:
 *    Q1: Jan 1  – Apr 15
 *    Q2: Apr 16 – Jun 15
 *    Q3: Jun 16 – Sep 15
 *    Q4: Sep 16 – Jan 15 (next yr)
 */
function buildQuarter(year: number, quarter: 1 | 2 | 3 | 4) {
  const meta = Q_META[quarter];
  let deadline: Date;
  let start: Date;
  if (quarter === 1) {
    deadline = new Date(year, 3, 15);
    start = new Date(year, 0, 1);
  } else if (quarter === 2) {
    deadline = new Date(year, 5, 15);
    start = new Date(year, 3, 16);
  } else if (quarter === 3) {
    deadline = new Date(year, 8, 15);
    start = new Date(year, 5, 16);
  } else {
    deadline = new Date(year + 1, 0, 15);
    start = new Date(year, 8, 16);
  }
  // exclusive upper bound = deadline + 1 day
  const end = new Date(deadline);
  end.setDate(end.getDate() + 1);
  return { quarter, year, label: meta.label, deadlineLabel: meta.deadlineLabel, deadline, start, end };
}

function stepQuarter(year: number, quarter: 1 | 2 | 3 | 4, dir: -1 | 1): { year: number; quarter: 1 | 2 | 3 | 4 } {
  let q = quarter + dir;
  let y = year;
  if (q < 1) { q = 4; y -= 1; }
  if (q > 4) { q = 1; y += 1; }
  return { year: y, quarter: q as 1 | 2 | 3 | 4 };
}

/** Owning year of the current real-world quarter (Q4 owns the start year, not deadline year). */
function currentOwningYear(): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const cur = getCurrentQuarter();
  const owningYear = cur.quarter === 4 ? cur.deadline.getFullYear() - 1 : cur.deadline.getFullYear();
  return { year: owningYear, quarter: cur.quarter as 1 | 2 | 3 | 4 };
}

export default function QuarterlyTracker({
  annualTaxLiability,
  payments,
  methodLabel,
  incomeEntries,
  personalEntries,
  transactions,
  companies,
  quarterMethod = "even",
  projectedPaychecks = [],
}: QuarterlyTrackerProps) {
  const initial = useMemo(() => currentOwningYear(), []);
  const [view, setView] = useState<{ year: number; quarter: 1 | 2 | 3 | 4 }>(initial);

  const q = useMemo(() => buildQuarter(view.year, view.quarter), [view]);
  const isCurrentQuarter = view.quarter === initial.quarter && view.year === initial.year;

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // Debug: force the SELECTED quarter to behave as closed (planned income → 0,
  // status uses past-quarter branch). Scoped to the currently-viewed quarter.
  const forceClosed = useDebugFlag(debugFlags.forceQuarterClosed);

  // ── Build per-company rows for the SELECTED quarter window ──────────────
  const companyRows: CompanyQuarterRow[] = useMemo(() => {
    const inQuarter = (iso: string) => {
      const d = new Date(iso);
      return d >= q.start && d < q.end;
    };
    const companyById = new Map(companies.map((c) => [c.id, c] as const));
    const liveTxById = new Map(
      (transactions || [])
        .filter((t: any) => t.transaction_type === "income")
        .map((t: any) => [t.id, t] as const),
    );

    type Bucket = {
      label: string;
      paid: number;
      saved: number;
      sources: Partial<Record<FederalWithholdingSource, number>>;
    };
    const buckets = new Map<string, Bucket>();
    const ensure = (key: string, label: string): Bucket => {
      let row = buckets.get(key);
      if (!row) {
        row = { label, paid: 0, saved: 0, sources: {} };
        buckets.set(key, row);
      }
      return row;
    };
    const tallySource = (row: Bucket, src: FederalWithholdingSource) => {
      row.sources[src] = (row.sources[src] ?? 0) + 1;
    };
    const filingHint = (filing: string | undefined): string => {
      if (filing === "scorp_w2" || filing === "w2") return "W-2";
      if (filing === "k1_partnership") return "K-1";
      if (filing === "1099_schedule_c") return "1099";
      return "";
    };

    for (const e of incomeEntries || []) {
      if (!e.linked_transaction_id) continue;
      const tx = liveTxById.get(e.linked_transaction_id);
      if (!tx) continue;
      // Business income is bucketed by the LEDGER ENTRY DATE (income_date),
      // not the projected/planner date. Once the quarter ends, only actual
      // entries within the window contribute.
      if (!inQuarter(e.income_date)) continue;
      const fedDetail = getTotalFederalPaidDetail(e);
      const paid = fedDetail.total;
      const saved =
        Number((tx as any).actual_withholding || 0) +
        Number(e.additional_tax_reserve || 0);
      if (paid <= 0 && saved <= 0) continue;
      const company = e.source_id ? companyById.get(e.source_id) : undefined;
      const filing = normalizeFilingType(e.income_type || company?.companyType);
      const hint = filingHint(filing);
      const name = company?.name || e.company || "Unassigned";
      const key = company?.id || `name:${name.toLowerCase().trim()}`;
      const label = hint ? `${name} (${hint})` : name;
      const row = ensure(key, label);
      row.paid += paid;
      row.saved += saved;
      if (paid > 0) tallySource(row, fedDetail.source);
    }

    for (const e of personalEntries || []) {
      if (!inQuarter(e.income_date)) continue;
      const fedDetail = getTotalFederalPaidDetail(e);
      const paid = fedDetail.total;
      const saved = Number(e.additional_tax_reserve || 0);
      if (paid <= 0 && saved <= 0) continue;
      const name = (e.company || "Personal W-2").trim() || "Personal W-2";
      const key = `personal:${name.toLowerCase()}`;
      const row = ensure(key, `${name} (W-2)`);
      row.paid += paid;
      row.saved += saved;
      if (paid > 0) tallySource(row, fedDetail.source);
    }

    return Array.from(buckets.entries()).map(([key, v]) => ({
      key, label: v.label, paid: v.paid, saved: v.saved, sources: v.sources,
    }));
  }, [incomeEntries, personalEntries, transactions, companies, q.start, q.end]);

  // ── Quarter math ──────────────────────────────────────────────────────────
  const quarterlyPayments = useMemo(
    () => getQuarterPayments(payments, q.label as QuarterLabel, view.year),
    [payments, q.label, view.year],
  );

  // Quarter target — either even (annual/4) or dynamic (share of annual liability
  // proportional to this quarter's actual + planned gross income vs full-year).
  const quarterTarget = useMemo(() => {
    if (quarterMethod !== "dynamic") {
      return Math.max(0, annualTaxLiability / 4);
    }
    const inWin = (iso: string) => {
      const d = new Date(iso);
      return d >= q.start && d < q.end;
    };
    // Actual income for the year (business + personal, by income_date)
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
      const amt = Math.abs(Number(t.amount) || 0);
      if (inYear(t.transaction_date)) yearIncome += amt;
      if (inWin(t.transaction_date)) qIncome += amt;
    }
    for (const e of personalEntries || []) {
      const amt = Number(e.gross_amount || e.paycheck_amount || 0);
      if (inYear(e.income_date)) yearIncome += amt;
      if (inWin(e.income_date)) qIncome += amt;
    }
    // Add planned/projected paychecks (future occurrences). When the debug
    // "force quarter closed" flag is on, treat planned income for the SELECTED
    // quarter as $0 so the target reflects only realized income — same as a
    // truly closed quarter would. Other quarters still get their planned share.
    for (const p of projectedPaychecks || []) {
      const amt = Number(p.grossAmount || 0);
      if (inYear(p.date)) yearIncome += amt;
      if (inWin(p.date)) {
        if (!forceClosed) qIncome += amt;
      }
    }
    if (yearIncome <= 0) return 0;
    const share = qIncome / yearIncome;
    return Math.max(0, annualTaxLiability * share);
  }, [quarterMethod, annualTaxLiability, transactions, personalEntries, projectedPaychecks, q.start, q.end, view.year, forceClosed]);

  const paidFromCompanies = companyRows.reduce((s, c) => s + c.paid, 0);
  const paidThisQuarter = paidFromCompanies + quarterlyPayments;
  const rawSavedThisQuarter = companyRows.reduce((s, c) => s + c.saved, 0);
  const savedThisQuarter = Math.max(0, rawSavedThisQuarter - quarterlyPayments);
  const progressAmount = paidThisQuarter + savedThisQuarter;
  const remainingThisQuarter = Math.max(0, quarterTarget - progressAmount);

  // ── Pace math (vs today's expected, not full target) ──────────────────────
  const now = new Date();
  const totalDays = Math.max(1, (q.end.getTime() - q.start.getTime()) / 86400000);
  const elapsedDays = (now.getTime() - q.start.getTime()) / 86400000;
  // Future quarter → 0 progress; past quarter → 100%
  const quarterProgress = Math.max(0, Math.min(1, elapsedDays / totalDays));
  const isFutureQuarter = now < q.start;
  const isPastQuarter = now >= q.end;
  const expectedByNow = quarterTarget * quarterProgress;
  const paceDiff = progressAmount - expectedByNow;
  const tolerance = Math.max(expectedByNow * 0.1, 250);

  type Tone = "ok" | "ahead" | "soft" | "behind";
  let tone: Tone;
  let message: string;
  if (quarterTarget === 0) {
    tone = "ok";
    message = "No estimated tax target this quarter.";
  } else if (isFutureQuarter) {
    tone = "soft";
    message = `${q.label} hasn't started yet — nothing due today.`;
  } else if (isPastQuarter) {
    tone = progressAmount + tolerance >= quarterTarget ? "ok" : "behind";
    message = progressAmount + tolerance >= quarterTarget
      ? `${q.label} complete.`
      : `${q.label} ended ${fmt(Math.max(0, quarterTarget - progressAmount))} short.`;
  } else if (quarterProgress < 0.1) {
    tone = "soft";
    message = expectedByNow > 0 && progressAmount < expectedByNow - tolerance
      ? `Early in the quarter — aim for ${fmt(expectedByNow)} by today.`
      : "Early in the quarter — pacing toward the next deadline.";
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

  const toneStyles = {
    ok:     { ring: "border-border",                          text: "text-foreground",       accent: "text-primary",  Icon: CheckCircle2 },
    ahead:  { ring: "border-success/40 bg-success/[0.04]",    text: "text-success",          accent: "text-success",  Icon: Sparkles },
    soft:   { ring: "border-border",                          text: "text-muted-foreground", accent: "text-primary",  Icon: Compass },
    behind: { ring: "border-warning/40 bg-warning/[0.04]",    text: "text-warning",          accent: "text-warning",  Icon: Compass },
  }[tone];
  const { Icon } = toneStyles;

  // Bar percentages — capped at quarter target.
  const paidPct = quarterTarget > 0 ? Math.min(100, (paidThisQuarter / quarterTarget) * 100) : 0;
  const savedPct = Math.max(0, Math.min(100 - paidPct, quarterTarget > 0 ? (savedThisQuarter / quarterTarget) * 100 : 0));
  const expectedPct = quarterTarget > 0 ? Math.min(100, quarterProgress * 100) : 0;
  const animPaidPct = useCountUp(paidPct, 1100);
  const animSavedPct = useCountUp(savedPct, 1100);
  const animExpectedPct = useCountUp(expectedPct, 1100);

  // Prorate the estimated-payment offset across companies by their saved share.
  const offset = Math.min(rawSavedThisQuarter, quarterlyPayments);
  const sortedCompanies = [...companyRows].sort((a, b) => (b.paid + b.saved) - (a.paid + a.saved));
  const adjustedCompanyRows = sortedCompanies.map((c) => {
    const share = rawSavedThisQuarter > 0 ? c.saved / rawSavedThisQuarter : 0;
    const adjSaved = Math.max(0, c.saved - offset * share);
    return { key: c.key, label: c.label, paid: c.paid, saved: adjSaved, sources: c.sources };
  });
  const rows: Array<{
    key: string;
    label: string;
    paid: number;
    saved: number;
    sources?: Partial<Record<FederalWithholdingSource, number>>;
  }> = [
    ...adjustedCompanyRows,
    {
      key: "__quarterly_payments__",
      label: `${q.label} estimated payments`,
      paid: quarterlyPayments,
      saved: 0,
    },
  ];
  const hasAny = rows.some((r) => r.paid > 0 || r.saved > 0);

  const goPrev = () => setView(stepQuarter(view.year, view.quarter, -1));
  const goNext = () => setView(stepQuarter(view.year, view.quarter, 1));

  return (
    <Card className={cn("border-2 transition-colors relative", toneStyles.ring)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
            <Icon className={cn("h-5 w-5 shrink-0", toneStyles.accent)} />
            <span className="truncate">Quarterly Tax Progress ({q.label} {view.year})</span>
          </CardTitle>
          <span className="text-xs text-muted-foreground shrink-0">due {q.deadlineLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          Pace toward the {q.deadlineLabel} tax deadline
          {methodLabel ? ` · ${methodLabel}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pb-10">
        {/* Primary numbers — 2-up */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid + Saved QTD</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{fmt(progressAmount)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Suggested by today</p>
            <p className={cn("text-lg font-semibold tabular-nums", toneStyles.accent)}>{fmt(expectedByNow)}</p>
          </div>
        </div>

        {/* Pace bar with today's marker */}
        <div className="space-y-1.5">
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary flex">
            <div
              className="h-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${animPaidPct}%` }}
            />
            <div
              className="h-full bg-primary/40 transition-[width] duration-700 ease-out"
              style={{ width: `${animSavedPct}%` }}
            />
            {expectedPct > 0 && expectedPct < 100 && (
              <div
                className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-foreground/70 rounded-sm transition-[left] duration-700 ease-out"
                style={{ left: `${animExpectedPct}%` }}
                aria-label="Today's expected pace"
                title={`Today's pace: ${fmt(expectedByNow)}`}
              />
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" />Paid</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/40" />Saved</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-0.5 bg-foreground/70 rounded-sm" />Today</span>
          </div>
        </div>

        {/* Compact status callout */}
        <div className={cn("flex items-center gap-2 text-sm", toneStyles.text)}>
          <Icon className={cn("h-4 w-4 shrink-0", toneStyles.accent)} />
          <span className="truncate">{message}</span>
        </div>

        {/* Secondary line */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Quarter target: <span className="tabular-nums text-foreground/70">{fmt(quarterTarget)}</span></span>
          {remainingThisQuarter > 0 && (
            <span>Still to fund: <span className="tabular-nums">{fmt(remainingThisQuarter)}</span></span>
          )}
        </div>

        {/* Per-company breakdown */}
        <Collapsible open={breakdownOpen} onOpenChange={setBreakdownOpen}>
          <div className="rounded-lg border bg-card/50">
            <CollapsibleTrigger className="w-full px-3 py-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-accent/30 transition-colors rounded-lg">
              <span className="flex items-center gap-1.5 text-left">
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", breakdownOpen && "rotate-180")} />
                This quarter by company
              </span>
              <span className="text-right w-16">Paid</span>
              <span className="text-center w-3">·</span>
              <span className="text-right w-16">Saved</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-border border-t">
                {!hasAny ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    Nothing tracked yet for {q.label} {view.year}.
                  </div>
                ) : (
                  rows.map((r) => {
                    const empty = r.paid === 0 && r.saved === 0;
                    const showSrc = debugFlags.withholdingSource() && r.sources;
                    const srcSummary = showSrc
                      ? Object.entries(r.sources!)
                          .filter(([, n]) => (n ?? 0) > 0)
                          .map(([s, n]) => `${federalSourceLabel(s as FederalWithholdingSource)}×${n}`)
                          .join(", ")
                      : "";
                    return (
                      <div
                        key={r.key}
                        className="px-3 py-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 text-sm"
                      >
                        <span className={cn("truncate flex flex-col min-w-0", empty && "text-muted-foreground")}>
                          <span className="truncate">{r.label}</span>
                          {showSrc && srcSummary && (
                            <span className="text-[10px] text-muted-foreground truncate">
                              src: {srcSummary}
                            </span>
                          )}
                        </span>
                        <span className={cn("tabular-nums text-right w-16", r.paid === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                          {fmt(r.paid)}
                        </span>
                        <span className="text-muted-foreground text-center w-3">·</span>
                        <span className={cn("tabular-nums text-right w-16", r.saved === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                          {fmt(r.saved)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        <p className="text-[11px] text-muted-foreground italic">
          Saved amounts are not yet submitted tax payments.
        </p>
        {quarterMethod === "dynamic" && (
          <p className="text-[11px] text-muted-foreground">
            This quarter target is based on current + planned income for this
            quarter and may change as income changes.
          </p>
        )}

        {/* Quarter navigation affordance */}
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 text-muted-foreground">
          <button
            type="button"
            onClick={goPrev}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent/50 hover:text-foreground transition-colors"
            aria-label="Previous quarter"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {!isCurrentQuarter && (
            <span className="text-[10px] tabular-nums px-1">{q.label} {view.year}</span>
          )}
          <button
            type="button"
            onClick={goNext}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent/50 hover:text-foreground transition-colors"
            aria-label="Next quarter"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
