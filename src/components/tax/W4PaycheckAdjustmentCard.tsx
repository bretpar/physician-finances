import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import {
  useProjectedStreams,
  useProjectedBonuses,
  useStreamOverrides,
  usePlannerConversions,
  generateProjectedPaychecks,
  type ProjectedIncomeStream,
} from "@/hooks/useProjectedIncome";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTransactions } from "@/hooks/useTransactions";
import { getSavingsRateForIncomeBucket } from "@/lib/savingsRateSelection";
import { normalizeFilingType } from "@/lib/filingTypes";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.round(n),
  );

function formatFrequencyLabel(freq: string): string {
  switch (freq) {
    case "weekly":
      return "Weekly paycheck";
    case "biweekly":
      return "Biweekly paycheck";
    case "semimonthly":
      return "Semimonthly paycheck";
    case "monthly":
      return "Monthly paycheck";
    case "quarterly":
      return "Quarterly paycheck";
    case "annually":
      return "Annual paycheck";
    case "single":
      return "One-time paycheck";
    case "custom":
      return "Custom-interval paycheck";
    default:
      return freq ? `${freq.charAt(0).toUpperCase()}${freq.slice(1)} paycheck` : "Paycheck";
  }
}

function isW2Stream(s: ProjectedIncomeStream): boolean {
  const ft = normalizeFilingType(s.company_type);
  return ft === "w2" || ft === "scorp_w2";
}

export function defaultRemainingPaychecks(frequency: string, today: Date = new Date()): number {
  const year = today.getFullYear();
  const yearEnd = new Date(year, 11, 31);
  const msPerDay = 86_400_000;
  const daysLeft = Math.max(0, Math.ceil((yearEnd.getTime() - today.getTime()) / msPerDay));
  switch (frequency) {
    case "weekly":
      return Math.max(0, Math.floor(daysLeft / 7));
    case "biweekly":
      return Math.max(0, Math.floor(daysLeft / 14));
    case "semimonthly": {
      // Count remaining 15th and end-of-month dates
      let count = 0;
      for (let m = today.getMonth(); m <= 11; m++) {
        const mid = new Date(year, m, 15);
        const end = new Date(year, m + 1, 0);
        if (mid > today) count++;
        if (end > today) count++;
      }
      return count;
    }
    case "monthly": {
      // Count remaining month-end paydates
      let count = 0;
      for (let m = today.getMonth(); m <= 11; m++) {
        const end = new Date(year, m + 1, 0);
        if (end > today) count++;
      }
      return count;
    }
    case "quarterly": {
      const quarterEnds = [2, 5, 8, 11].map((m) => new Date(year, m + 1, 0));
      return quarterEnds.filter((d) => d > today).length;
    }
    case "annually":
    case "single":
      return 1;
    default:
      return Math.max(0, Math.floor(daysLeft / 14));
  }
}

function roundToNearest5(n: number): number {
  return Math.round(n / 5) * 5;
}

export type EmployerRow = {
  streamId: string;
  company: string;
  payFrequency: string;
  remainingPaychecks: number;
  remainingGross: number;
  expectedNormalWithholding: number;
};

export type Allocation = EmployerRow & {
  exactPerPaycheck: number;
  exactEmployerGap: number;
  step4cPerPaycheck: number;
  employerGap: number;
};

export function computeAllocations(
  employerRows: EmployerRow[],
  remainingW4Gap: number,
  totalRemainingW2Gross: number,
): Allocation[] {
  if (!employerRows || employerRows.length === 0) return [];
  const activeRows = employerRows.filter((r) => r.remainingPaychecks > 0);
  if (activeRows.length === 0) return [];
  if (!isFinite(remainingW4Gap) || remainingW4Gap <= 0) {
    return activeRows.map((r) => ({
      ...r,
      exactPerPaycheck: 0,
      exactEmployerGap: 0,
      step4cPerPaycheck: 0,
      employerGap: 0,
    }));
  }

  const base: Allocation[] = activeRows.map((r) => {
    const share =
      activeRows.length === 1
        ? 1
        : totalRemainingW2Gross > 0
          ? r.remainingGross / totalRemainingW2Gross
          : 1 / activeRows.length;
    const employerGap = remainingW4Gap * share;
    const perPaycheck = r.remainingPaychecks > 0 ? employerGap / r.remainingPaychecks : 0;
    const step4c = Math.max(0, roundToNearest5(perPaycheck));
    return {
      ...r,
      exactPerPaycheck: perPaycheck,
      exactEmployerGap: employerGap,
      step4cPerPaycheck: step4c,
      employerGap: step4c * r.remainingPaychecks,
    };
  });

  // Single safe adjustment pass: if a one-step $5 change to the best employer
  // reduces the absolute total difference, apply it. Never loop.
  const totalRounded = base.reduce((s, a) => s + a.employerGap, 0);
  const diff = remainingW4Gap - totalRounded;
  if (Math.abs(diff) >= 2.5) {
    const sorted = base
      .map((a, i) => ({ i, paychecks: a.remainingPaychecks }))
      .filter((c) => c.paychecks > 0)
      .sort((a, b) => b.paychecks - a.paychecks);
    if (sorted.length > 0) {
      const target = sorted[0].i;
      const increment = diff > 0 ? 5 : -5;
      const nextVal = base[target].step4cPerPaycheck + increment;
      if (nextVal >= 0) {
        const newTotal = totalRounded + increment * base[target].remainingPaychecks;
        if (Math.abs(remainingW4Gap - newTotal) < Math.abs(diff)) {
          base[target].step4cPerPaycheck = nextVal;
          base[target].employerGap = nextVal * base[target].remainingPaychecks;
        }
      }
    }
  }

  return base;
}

export default function W4PaycheckAdjustmentCard() {
  const { actualEstimate, currentPaceEstimate, forecastEstimate, forecastDebug, actualDebug } = useTaxEstimate();
  const { data: settings } = useTaxSettings();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { data: plannerConversions } = usePlannerConversions();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: transactions } = useTransactions();

  const [showHow, setShowHow] = useState(false);

  const businessRateSel = getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "1099",
    taxSettings: settings,
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
    includeSETaxInRecommendation: true,
  });
  const businessReserveRate = businessRateSel.rate; // % expected on future 1099/business income

  const todayStr = new Date().toISOString().split("T")[0];

  // Build projected paychecks with full match/override context, then filter to
  // FUTURE, W-2, unconverted/unmatched/active occurrences.
  const allProjected = useMemo(
    () =>
      generateProjectedPaychecks(
        streams || [],
        bonuses || [],
        incomeEntries || [],
        overrides || [],
        plannerConversions || [],
        (transactions || []).map((t) => ({
          id: t.id,
          transaction_date: t.transaction_date,
          vendor: t.vendor || "",
          amount: Number(t.amount) || 0,
          source_id: (t as any).source_id ?? null,
          status: t.status,
          transaction_type: t.transaction_type,
        })),
      ),
    [streams, bonuses, incomeEntries, overrides, plannerConversions, transactions],
  );

  // Per-employer rollup for active W-2 streams
  const employerRows = useMemo(() => {
    const w2Streams = (streams || []).filter((s) => s.is_active && isW2Stream(s));
    const byStream = new Map<
      string,
      {
        streamId: string;
        company: string;
        payFrequency: string;
        remainingPaychecks: number;
        remainingGross: number;
        expectedNormalWithholding: number;
      }
    >();

    for (const s of w2Streams) {
      byStream.set(s.id, {
        streamId: s.id,
        company: s.company,
        payFrequency: s.pay_frequency,
        remainingPaychecks: 0,
        remainingGross: 0,
        expectedNormalWithholding: 0,
      });
    }

    for (const p of allProjected) {
      const row = byStream.get(p.streamId);
      if (!row) continue;
      if (p.isSkipped) continue;
      if (p.date <= todayStr) continue;
      // Skip occurrences that already have a real ledger entry
      if (p.matchStatus === "matched" || p.matchStatus === "converted") continue;
      row.remainingPaychecks += 1;
      row.remainingGross += Number(p.grossAmount || 0);
      row.expectedNormalWithholding +=
        Number(p.taxesWithheld || 0); // stream-level taxes_withheld (fed+state aggregate)
    }

    return Array.from(byStream.values()).filter((r) => r.remainingPaychecks > 0);
  }, [streams, allProjected, todayStr]);

  // Future business gross = planner (forecast) gross business − actual gross business
  const futureBusinessGross = Math.max(
    0,
    Number(forecastDebug?.grossBusinessIncome ?? 0) - Number(actualDebug?.grossBusinessIncome ?? 0),
  );
  const plannedFutureBusinessReserves = futureBusinessGross * (businessReserveRate / 100);

  const projectedTotalTax = Number(forecastDebug?.totalEstimatedTax ?? 0);
  const taxesAlreadyWithheld =
    Number(forecastDebug?.actualFederalWithheld ?? 0) +
    Number(forecastDebug?.actualStateWithheld ?? 0);
  const actualTaxSavedOrPaid = Number(forecastDebug?.taxSavingsSetAside ?? 0);
  const estPaymentsAlreadyMade = Number(forecastDebug?.estimatedPaymentsMade ?? 0);
  const expectedFutureNormalW2Withholding =
    Number(forecastDebug?.projectedFederalWithheld ?? 0) +
    Number(forecastDebug?.projectedStateWithheld ?? 0);

  const remainingW4Gap = Math.max(
    0,
    projectedTotalTax -
      taxesAlreadyWithheld -
      actualTaxSavedOrPaid -
      estPaymentsAlreadyMade -
      expectedFutureNormalW2Withholding -
      plannedFutureBusinessReserves,
  );

  // Allocate gap across employers proportionally to remaining gross W-2 income.
  // If only one employer, the entire gap goes to it.
  const totalRemainingW2Gross = employerRows.reduce((s, r) => s + r.remainingGross, 0);


  const allocations = useMemo(
    () => computeAllocations(employerRows, remainingW4Gap, totalRemainingW2Gross),
    [employerRows, totalRemainingW2Gross, remainingW4Gap],
  );

  const totalExtraThroughYearEnd = allocations.reduce(
    (s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks,
    0,
  );

  // Hide card entirely if user has no W-2 streams at all — nothing to recommend.
  if (employerRows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">W-4 Paycheck Adjustment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/40 p-3">
          <p className="text-sm font-medium text-foreground">Recommended plan</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Based on your current income and projected income, if you continue saving{" "}
            <span className="font-semibold text-foreground">{businessReserveRate.toFixed(1)}%</span>{" "}
            from future 1099/business income, here is what to enter on your W-4.
          </p>
        </div>

        {remainingW4Gap <= 0 ? (
          <p className="text-sm text-foreground">
            You're projected to be fully covered by current withholding, payments, and planned reserves. No
            extra W-4 Step 4(c) withholding is needed right now.
          </p>
        ) : (
          <>
            <p className="text-sm text-foreground">
              For your W-2 jobs, enter the following extra withholding amounts in Form W-4 Step 4(c):
            </p>

            <div className="divide-y divide-border rounded-md border border-border">
              {allocations.map((a) => (
                <div key={a.streamId} className="flex items-center justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{a.company}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFrequencyLabel(a.payFrequency)} · {a.remainingPaychecks} remaining
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold tabular-nums text-primary">
                      Enter {fmt(a.step4cPerPaycheck)}
                    </p>
                    <p className="text-xs text-muted-foreground">in Step 4(c)</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-sm text-muted-foreground">
              Total extra W-2 withholding planned through year-end:{" "}
              <span className="font-semibold text-foreground">{fmt(totalExtraThroughYearEnd)}</span>
            </p>
          </>
        )}

        <Collapsible open={showHow} onOpenChange={setShowHow}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground gap-1 px-0">
              <ChevronDown className={cn("h-4 w-4 transition-transform", showHow && "rotate-180")} />
              Show how this was calculated
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-1 rounded-md border border-border p-3 text-sm">
              <Row label="Projected total tax" value={fmt(projectedTotalTax)} />
              <Row
                label="Already withheld / saved / paid"
                value={fmt(taxesAlreadyWithheld + actualTaxSavedOrPaid + estPaymentsAlreadyMade)}
              />
              <Row
                label="Expected future normal W-2 withholding"
                value={fmt(expectedFutureNormalW2Withholding)}
              />
              <Row
                label={`Planned future 1099/business reserves (${businessReserveRate.toFixed(1)}%)`}
                value={fmt(plannedFutureBusinessReserves)}
              />
              <div className="my-1 border-t border-border" />
              <Row label="Remaining W-4 gap" value={fmt(remainingW4Gap)} bold />

              {allocations.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">Per employer breakdown</p>
                  {allocations.map((a) => (
                    <div
                      key={a.streamId}
                      className="rounded-md bg-muted/40 p-2 space-y-1"
                    >
                      <p className="text-xs font-medium text-foreground">{a.company}</p>
                      <RowSmall
                        label="Expected normal W-2 withholding (projected)"
                        value={fmt(a.expectedNormalWithholding)}
                      />
                      <RowSmall
                        label="Allocated share of remaining gap"
                        value={fmt(a.employerGap)}
                      />
                      <RowSmall
                        label="Step 4(c) per paycheck"
                        value={fmt(a.step4cPerPaycheck)}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 text-xs text-muted-foreground">
                Allocated across {allocations.length} W-2 job{allocations.length === 1 ? "" : "s"} by
                remaining paycheck schedule and remaining gross W-2 income.
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <p className="text-xs text-muted-foreground">
          This is an estimate based on your current income, projected income, withholding method, and
          saved/paid tax entries. Confirm changes with your payroll system or the IRS withholding
          estimator.
        </p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={cn("text-muted-foreground", bold && "text-foreground font-medium")}>{label}</span>
      <span className={cn("tabular-nums", bold ? "font-semibold text-foreground" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function RowSmall({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
