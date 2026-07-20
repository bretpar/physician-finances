import { useMemo, useState, useEffect } from "react";
import { GraduationCap, Info, Scale, AlertTriangle, ChevronDown, Check } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { US_STATES } from "@/lib/quickEstimate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Navigate, Link } from "react-router-dom";

import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  useStudentLoans,
  useUpsertStudentLoan,
  useDeleteStudentLoan,
  type StudentLoanRow,
} from "@/hooks/useStudentLoans";
import { REPAYMENT_PLAN_LIST, REPAYMENT_PLANS, type RepaymentPlanId } from "@/lib/studentLoan/repaymentPlans";
import { estimateRepayment, aggregateLoans } from "@/lib/studentLoan/calculator";
import { compareFilingStatuses } from "@/lib/studentLoan/mfsComparison";
import {
  isCommunityPropertyState,
  allocateCommunityAgi,
} from "@/lib/studentLoan/communityProperty";
import { friendlyRegionLabel } from "@/lib/studentLoan/computePlanPayment";

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.round(n || 0),
  );
const fmtMonths = (m: number | null) => {
  if (m == null) return "—";
  const y = Math.floor(m / 12);
  const r = m % 12;
  if (y === 0) return `${r} mo`;
  if (r === 0) return `${y} yr`;
  return `${y} yr ${r} mo`;
};

function filingStatusLabel(status: string): string {
  switch (status) {
    case "married_filing_jointly": return "Married Filing Jointly";
    case "married_filing_separately": return "Married Filing Separately";
    case "single": return "Single";
    case "head_of_household": return "Head of Household";
    default: return status || "—";
  }
}

const SCENARIO_STORAGE_KEY = "student_loan_estimator_scenario_v2";
type ScenarioPrefs = {
  state?: string;
  familySize?: number;
  planId?: RepaymentPlanId;
  balance?: string;
  rate?: string;
  agiMode?: "projected" | "manual";
  manualAgi?: string;
};

function readScenarioPrefs(): ScenarioPrefs {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(SCENARIO_STORAGE_KEY) || "{}") as ScenarioPrefs; }
  catch { return {}; }
}
function writeScenarioPrefs(patch: Partial<ScenarioPrefs>) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...readScenarioPrefs(), ...patch };
    window.localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export default function StudentLoans() {
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();
  const { data: loans = [], isLoading: loansLoading } = useStudentLoans();
  const upsert = useUpsertStudentLoan();
  const del = useDeleteStudentLoan();
  const { forecastEstimate } = useTaxEstimate() ?? { forecastEstimate: null };

  if (!settingsLoading && settings && !settings.studentLoanEstimatorEnabled) {
    return <Navigate to="/settings" replace />;
  }

  const projectedTotalIncome = Math.max(0, forecastEstimate?.totalIncome ?? 0);
  const projectedAgi = Math.max(0, forecastEstimate?.agi ?? 0);

  const savedFilingStatus = settings?.filingStatus ?? "single";
  const savedProfileState = settings?.stateOfResidence ?? "";
  const savedFamilySize = settings?.studentLoanFamilySize ?? 1;

  const loan: StudentLoanRow | null = loans[0] ?? null;
  const initPrefs = useMemo(readScenarioPrefs, []);

  // Core (default) inputs — only 5 the user sees.
  const [balance, setBalance] = useState<string>(
    initPrefs.balance ?? (loan?.balance != null ? String(loan.balance) : "")
  );
  const [rate, setRate] = useState<string>(
    initPrefs.rate ?? (loan?.interest_rate != null ? String(loan.interest_rate) : "")
  );
  const [familySize, setFamilySize] = useState<number>(
    Math.max(1, Math.floor(initPrefs.familySize ?? savedFamilySize ?? 1))
  );
  const [state, setState] = useState<string>(initPrefs.state ?? savedProfileState ?? "");
  const [selectedPlan, setSelectedPlan] = useState<RepaymentPlanId>(
    initPrefs.planId ?? (loan?.repayment_plan as RepaymentPlanId) ?? "standard_10"
  );

  // Load-from-saved-loan side effect (once when a row appears).
  useEffect(() => {
    if (!loan) return;
    if (initPrefs.balance == null) setBalance(String(loan.balance ?? ""));
    if (initPrefs.rate == null) setRate(String(loan.interest_rate ?? ""));
    if (initPrefs.planId == null && loan.repayment_plan) setSelectedPlan(loan.repayment_plan as RepaymentPlanId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan?.id]);

  // AGI source (ephemeral — never persisted to tax settings).
  const [agiMode, setAgiMode] = useState<"projected" | "manual">(initPrefs.agiMode ?? "projected");
  const [manualAgi, setManualAgi] = useState<string>(initPrefs.manualAgi ?? "");
  const [agiPopoverOpen, setAgiPopoverOpen] = useState(false);

  // Advanced loan fields (collapsed).
  const [currentPayment, setCurrentPayment] = useState<string>(
    loan?.current_monthly_payment != null ? String(loan.current_monthly_payment) : ""
  );
  const [additionalPayment, setAdditionalPayment] = useState<string>(
    loan?.additional_monthly_payment != null ? String(loan.additional_monthly_payment) : ""
  );
  const [monthsInRepayment, setMonthsInRepayment] = useState<string>(
    loan?.months_in_repayment != null ? String(loan.months_in_repayment) : ""
  );

  useEffect(() => {
    if (!loan) return;
    setCurrentPayment(loan.current_monthly_payment != null ? String(loan.current_monthly_payment) : "");
    setAdditionalPayment(loan.additional_monthly_payment != null ? String(loan.additional_monthly_payment) : "");
    setMonthsInRepayment(loan.months_in_repayment != null ? String(loan.months_in_repayment) : "");
  }, [loan?.id]);

  // Persist ephemeral scenario prefs.
  useEffect(() => {
    writeScenarioPrefs({
      state, familySize, planId: selectedPlan, balance, rate, agiMode, manualAgi,
    });
  }, [state, familySize, selectedPlan, balance, rate, agiMode, manualAgi]);

  // Comparison sandbox (opened on demand).
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const savedSpouseIncome = settings?.studentLoanSpouseIncomeOverride;
  const [spouseIncome, setSpouseIncome] = useState<string>(
    savedSpouseIncome != null ? String(savedSpouseIncome) : ""
  );

  // Community-property "review allocation" (advanced, hidden by default).
  const isCP = isCommunityPropertyState(state);
  const isMfs = (savedFilingStatus as string) === "married_filing_separately";
  const cpAutoApplies = isMfs && isCP;
  const [cpReviewOpen, setCpReviewOpen] = useState(false);
  const [cpBorrowerCommunity, setCpBorrowerCommunity] = useState<string>("");
  const [cpSpouseCommunity, setCpSpouseCommunity] = useState<string>("");
  const [cpBorrowerSeparate, setCpBorrowerSeparate] = useState<string>("");
  const [cpSpouseSeparate, setCpSpouseSeparate] = useState<string>("");
  const [cpBorrowerAdj, setCpBorrowerAdj] = useState<string>("");
  const [cpBorrowerSharePct, setCpBorrowerSharePct] = useState<string>("50");

  // Resolve the AGI actually used for IDR plans.
  const cpAllocation = useMemo(() => {
    if (!cpAutoApplies) return null;
    const bComm = cpBorrowerCommunity !== "" ? Number(cpBorrowerCommunity) : projectedTotalIncome;
    return allocateCommunityAgi({
      borrowerCommunityIncome: bComm,
      spouseCommunityIncome: Number(cpSpouseCommunity) || 0,
      borrowerSeparateIncome: Number(cpBorrowerSeparate) || 0,
      spouseSeparateIncome: Number(cpSpouseSeparate) || 0,
      borrowerAdjustments: Number(cpBorrowerAdj) || 0,
      spouseAdjustments: 0,
      borrowerCommunityShare: Math.min(1, Math.max(0, (Number(cpBorrowerSharePct) || 50) / 100)),
    });
  }, [cpAutoApplies, cpBorrowerCommunity, cpSpouseCommunity, cpBorrowerSeparate, cpSpouseSeparate, cpBorrowerAdj, cpBorrowerSharePct, projectedTotalIncome]);

  let studentLoanAgi = projectedAgi;
  let agiSourceLabel = "Projected AGI from PaycheckMD";
  if (agiMode === "manual" && manualAgi !== "" && Number(manualAgi) >= 0) {
    studentLoanAgi = Number(manualAgi);
    agiSourceLabel = "Manual estimate";
  } else if (cpAllocation) {
    studentLoanAgi = cpAllocation.borrowerMfsAgi;
    agiSourceLabel = "Community-property-adjusted MFS AGI";
  }

  const parsedLoan = {
    balance: Number(balance) || 0,
    interestRatePct: Number(rate) || 0,
    currentMonthlyPayment: currentPayment ? Number(currentPayment) : null,
    additionalMonthlyPayment: additionalPayment ? Number(additionalPayment) : null,
    monthsInRepayment: monthsInRepayment ? Number(monthsInRepayment) : null,
  };
  const aggregated = aggregateLoans([parsedLoan]);

  const borrower = useMemo(() => {
    const fs = savedFilingStatus as string;
    const filing = (fs === "married_filing_jointly"
      ? "married_filing_jointly"
      : fs === "married_filing_separately"
        ? "married_filing_separately"
        : "single") as "single" | "married_filing_jointly" | "married_filing_separately";
    // Region drives the poverty guideline. UI shows the state selector but
    // the engine needs the mapped PovertyRegion (AK/HI/contiguous).
    const region =
      state === "AK" ? "alaska" : state === "HI" ? "hawaii" : "contiguous_48_dc";
    return {
      filingStatus: filing,
      familySize: Math.max(1, familySize ?? 1),
      annualIncome: studentLoanAgi,
      region: region as "alaska" | "hawaii" | "contiguous_48_dc",
    };
  }, [savedFilingStatus, familySize, studentLoanAgi, state]);

  // Compute estimates for ALL enrollable plans, sorted by monthly payment.
  const planEstimates = useMemo(() => {
    return REPAYMENT_PLAN_LIST.map((p) => {
      const est = estimateRepayment(aggregated, borrower, p.id);
      const forgivenessMonths = p.forgivenessYears ? p.forgivenessYears * 12 : null;
      // For IDR, mathematical payoff might exceed the forgiveness horizon
      // — cap Total Paid so we never show "pays off in 40 yr" for a plan
      // whose remainder is forgiven at 20/25/30 yr.
      let endpointMonths = est.estimatedPayoffMonths;
      if (forgivenessMonths != null) {
        endpointMonths = endpointMonths != null
          ? Math.min(endpointMonths, forgivenessMonths)
          : forgivenessMonths;
      }
      const totalPaid = endpointMonths != null ? est.estimatedMonthlyPayment * endpointMonths : null;
      return { plan: p, est, monthsForTotal: endpointMonths, totalPaid, forgivenessMonths };
    }).sort((a, b) => {
      const av = a.est.unavailable ? Number.POSITIVE_INFINITY : a.est.estimatedMonthlyPayment;
      const bv = b.est.unavailable ? Number.POSITIVE_INFINITY : b.est.estimatedMonthlyPayment;
      return av - bv;
    });
  }, [aggregated, borrower]);

  const lowestMonthlyId = planEstimates.find((p) => !p.est.unavailable && (p.est.detail?.eligibility ?? "confirmed") === "confirmed")?.plan.id;
  const fastestPayoffId = planEstimates
    .filter((p) => !p.est.unavailable && p.est.estimatedPayoffMonths != null && (p.est.detail?.eligibility ?? "confirmed") === "confirmed")
    .sort((a, b) => (a.est.estimatedPayoffMonths! - b.est.estimatedPayoffMonths!))[0]?.plan.id;

  const activeEstimate = planEstimates.find((p) => p.plan.id === selectedPlan) ?? planEstimates[0];
  const estimate = activeEstimate?.est;

  // Validation
  const balanceInvalid = balance !== "" && Number(balance) < 0;
  const rateInvalid = rate !== "" && Number(rate) < 0;
  const missingAgi = studentLoanAgi <= 0;
  const isIdrPlan = REPAYMENT_PLANS[selectedPlan]?.family === "idr";

  const currentMonthly = parsedLoan.currentMonthlyPayment ?? 0;
  const unpaidMonthlyInterest = Math.max(
    0,
    (estimate?.monthlyInterest ?? 0) - (estimate?.estimatedMonthlyPayment ?? 0),
  );

  // Comparison card: borrower income is separate from spouse income to
  // prevent double-counting. The MFJ scenario is (borrower + spouse), never
  // (household + spouse).
  const [borrowerIncomeInput, setBorrowerIncomeInput] = useState<string>("");
  const effectiveBorrowerIncome = borrowerIncomeInput !== ""
    ? Math.max(0, Number(borrowerIncomeInput) || 0)
    : projectedTotalIncome;

  // Compare MFJ vs MFS
  const comparison = useMemo(() => {
    if (!comparisonOpen) return null;
    return compareFilingStatuses({
      userIncome: effectiveBorrowerIncome,
      spouseIncome: Number(spouseIncome) || 0,
      loan: parsedLoan,
      planId: selectedPlan,
      familySize: Math.max(1, familySize ?? 1),
      state,
      applyCommunityRules: isCP,
      stateTaxRatePct: settings?.personalStateTaxRate ?? 0,
    });
  }, [comparisonOpen, effectiveBorrowerIncome, spouseIncome, parsedLoan, selectedPlan, familySize, state, isCP, settings?.personalStateTaxRate]);

  const handleSaveLoan = async () => {
    await upsert.mutateAsync({
      id: loan?.id,
      name: "Primary loan",
      loan_type: "federal",
      balance: parsedLoan.balance,
      interest_rate: parsedLoan.interestRatePct,
      current_monthly_payment: parsedLoan.currentMonthlyPayment,
      additional_monthly_payment: parsedLoan.additionalMonthlyPayment,
      months_in_repayment: parsedLoan.monthsInRepayment,
      repayment_plan: selectedPlan,
    });
  };

  if (settingsLoading || loansLoading) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-8">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-semibold">Student Loan Estimator</h1>
      </div>

      {/* 1. Result summary ─────────────────────────── */}
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
          Estimated monthly payment · {estimate?.plan.label}
        </div>
        {estimate?.unavailable ? (
          <>
            <div className="text-3xl font-bold text-muted-foreground">—</div>
            <div className="text-xs text-muted-foreground mt-2">{estimate.unavailable.reason}</div>
          </>
        ) : missingAgi && isIdrPlan ? (
          <>
            <div className="text-3xl font-bold text-muted-foreground">—</div>
            <Alert className="mt-3">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Income-driven plans need an annual income. Add income in your{" "}
                <Link to="/projected-income" className="underline font-medium">Income Planner</Link>,
                or tap <strong>Change</strong> below to enter one.
              </AlertDescription>
            </Alert>
          </>
        ) : (
          <>
            <div className="text-3xl font-bold">{fmtCurrency(estimate?.estimatedMonthlyPayment ?? 0)}</div>
            <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
              <Stat label="Annual payment" value={fmtCurrency(estimate?.estimatedAnnualPayment ?? 0)} />
              <Stat label="Monthly interest" value={fmtCurrency(estimate?.monthlyInterest ?? 0)} />
              <Stat
                label="Covers interest?"
                value={estimate?.coversMonthlyInterest ? "Yes" : "No"}
                variant={estimate?.coversMonthlyInterest ? "ok" : "warn"}
              />
              <Stat
                label={activeEstimate?.forgivenessMonths != null &&
                  (estimate?.estimatedPayoffMonths == null || estimate.estimatedPayoffMonths >= activeEstimate.forgivenessMonths)
                  ? "Est. forgiveness"
                  : (REPAYMENT_PLANS[selectedPlan]?.family === "graduated" ? "Full schedule" : "Est. payoff")}
                value={
                  REPAYMENT_PLANS[selectedPlan]?.family === "graduated"
                    ? "Not modeled"
                    : activeEstimate?.forgivenessMonths != null &&
                      (estimate?.estimatedPayoffMonths == null || estimate.estimatedPayoffMonths >= activeEstimate.forgivenessMonths)
                      ? fmtMonths(activeEstimate.forgivenessMonths)
                      : fmtMonths(estimate?.estimatedPayoffMonths ?? null)
                }
              />
            </div>
            {!estimate?.coversMonthlyInterest && unpaidMonthlyInterest > 0 && (
              <div className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                <strong>Estimated unpaid interest:</strong> {fmtCurrency(unpaidMonthlyInterest)}/mo added to your balance.
              </div>
            )}
            {REPAYMENT_PLANS[selectedPlan]?.family === "graduated" && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Amount shown is the <strong>estimated starting payment</strong>. Graduated schedules
                step up roughly every 2 years; the full schedule is not modeled here.
              </div>
            )}
            {estimate?.detail?.eligibility === "assumed" && (
              <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                Estimate shown; <strong>eligibility not confirmed</strong> — add loan disbursement
                date and borrower type under Advanced loan details to confirm.
              </div>
            )}
            {currentMonthly > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                Current required payment: {fmtCurrency(currentMonthly)} ·{" "}
                Difference: {fmtCurrency((estimate?.estimatedMonthlyPayment ?? 0) - currentMonthly)}/mo
              </div>
            )}
          </>
        )}

        {/* How was this calculated? (collapsed) */}
        {estimate?.detail && (
          <details className="mt-4 rounded-md border border-border bg-background/60 p-3 text-xs">
            <summary className="cursor-pointer font-medium">How was this calculated?</summary>
            <div className="mt-2 space-y-2">
              <BreakdownRow label="AGI used" value={fmtCurrency(studentLoanAgi)} />
              <BreakdownRow label="AGI source" value={agiSourceLabel} />
              <BreakdownRow label="Filing status" value={filingStatusLabel(borrower.filingStatus)} />
              <BreakdownRow label="Family size" value={String(familySize)} />
              {estimate.detail.breakdown.povertyGuideline != null && (
                <>
                  <BreakdownRow label={`Poverty guideline (${estimate.detail.breakdown.povertyYear})`} value={fmtCurrency(estimate.detail.breakdown.povertyGuideline)} />
                  <BreakdownRow label="Region" value={friendlyRegionLabel((state as any) === "AK" ? "alaska" : (state as any) === "HI" ? "hawaii" : "contiguous_48_dc")} />
                </>
              )}
              {estimate.detail.breakdown.discretionaryIncome != null && (
                <BreakdownRow label="Discretionary income" value={fmtCurrency(estimate.detail.breakdown.discretionaryIncome)} />
              )}
              {estimate.detail.breakdown.percentApplied != null && (
                <BreakdownRow label="Payment percentage" value={`${estimate.detail.breakdown.percentApplied}%`} />
              )}
              {estimate.detail.breakdown.capMonthly != null && (
                <BreakdownRow label="Standard payment cap" value={fmtCurrency(estimate.detail.breakdown.capMonthly)} />
              )}
              <BreakdownRow label="Final monthly payment" value={fmtCurrency(estimate.estimatedMonthlyPayment)} bold />
              {cpAllocation && (
                <BreakdownRow label="Community-property treatment" value="Applied (50/50 default)" />
              )}
              <div className="pt-2 mt-2 border-t border-border text-[10px] text-muted-foreground">
                Rules {estimate.detail.rulesVersion} · updated {estimate.detail.sourceUpdatedAt} ·{" "}
                <a href={estimate.detail.sourceUrl} target="_blank" rel="noreferrer" className="underline">source</a>
              </div>
            </div>
          </details>
        )}
      </Card>

      {/* 2. Confirm your information ─────────────── */}
      <Card className="p-5 space-y-4">
        <div className="font-semibold">Confirm your information</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="sl-balance" label="Total federal loan balance ($)" value={balance} onChange={setBalance} type="number" error={balanceInvalid ? "Balance can't be negative." : undefined} />
          <Field id="sl-rate" label="Average interest rate (%)" value={rate} onChange={setRate} type="number" error={rateInvalid ? "Rate can't be negative." : undefined} />
          <div>
            <Label htmlFor="sl-family-size" className="text-xs text-muted-foreground mb-1.5 block">Family size</Label>
            <Input
              id="sl-family-size"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={familySize}
              onChange={(e) => setFamilySize(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <Label htmlFor="sl-state" className="text-xs text-muted-foreground mb-1.5 block">State</Label>
            <Select value={state || undefined} onValueChange={setState}>
              <SelectTrigger id="sl-state" aria-label="State"><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {US_STATES.map(([code, name]) => (
                  <SelectItem key={code} value={code}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="sl-plan" className="text-xs text-muted-foreground mb-1.5 block">Current repayment plan</Label>
            <Select value={selectedPlan} onValueChange={(v) => setSelectedPlan(v as RepaymentPlanId)}>
              <SelectTrigger id="sl-plan" aria-label="Current repayment plan"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPAYMENT_PLAN_LIST.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>


        {/* Income used — read-only summary with Change popover */}
        <div className="rounded-md border border-border bg-muted/20 p-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Income used</div>
            <div className="text-sm font-semibold truncate">
              {fmtCurrency(studentLoanAgi)}{" "}
              <span className="text-xs font-normal text-muted-foreground">· {agiSourceLabel.toLowerCase()}</span>
            </div>
          </div>
          <Popover open={agiPopoverOpen} onOpenChange={setAgiPopoverOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="shrink-0">Change</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <button
                type="button"
                onClick={() => { setAgiMode("projected"); setAgiPopoverOpen(false); }}
                className={`w-full text-left rounded-md border p-2 text-xs ${agiMode === "projected" ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className="font-medium flex items-center gap-1.5">
                  {agiMode === "projected" && <Check className="h-3.5 w-3.5" />}
                  Use projected AGI from PaycheckMD
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{fmtCurrency(projectedAgi)}</div>
              </button>
              <div>
                <button
                  type="button"
                  onClick={() => setAgiMode("manual")}
                  className={`w-full text-left rounded-md border p-2 text-xs ${agiMode === "manual" ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="font-medium flex items-center gap-1.5">
                    {agiMode === "manual" && <Check className="h-3.5 w-3.5" />}
                    Enter a different AGI
                  </div>
                </button>
                {agiMode === "manual" && (
                  <Input
                    className="mt-2"
                    type="number"
                    placeholder="e.g. 250000"
                    value={manualAgi}
                    onChange={(e) => setManualAgi(e.target.value)}
                  />
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Used only for this estimator. Not saved to your profile.
              </p>
            </PopoverContent>
          </Popover>
        </div>

        {/* Community-property notice (compact) */}
        {cpAutoApplies && (
          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
            <div className="flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="flex-1">
                Community-property income allocation is applied automatically for your MFS filing in{" "}
                {state}. This affects only this estimator.
                <button
                  type="button"
                  onClick={() => setCpReviewOpen((v) => !v)}
                  className="ml-1 underline font-medium"
                >
                  {cpReviewOpen ? "Hide" : "Review income allocation"}
                </button>
              </div>
            </div>
            {cpReviewOpen && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Borrower earned income" value={cpBorrowerCommunity} onChange={setCpBorrowerCommunity} type="number" />
                  <Field label="Spouse earned income" value={cpSpouseCommunity} onChange={setCpSpouseCommunity} type="number" />
                  <Field label="Borrower separate income" value={cpBorrowerSeparate} onChange={setCpBorrowerSeparate} type="number" />
                  <Field label="Spouse separate income" value={cpSpouseSeparate} onChange={setCpSpouseSeparate} type="number" />
                  <Field label="Borrower AGI adjustments" value={cpBorrowerAdj} onChange={setCpBorrowerAdj} type="number" />
                  <Field label="Borrower share %" value={cpBorrowerSharePct} onChange={setCpBorrowerSharePct} type="number" />
                </div>
                {cpAllocation && (
                  <div className="text-[11px] text-muted-foreground">
                    Borrower MFS AGI: <span className="font-semibold text-foreground">{fmtCurrency(cpAllocation.borrowerMfsAgi)}</span>
                    {" · "}Spouse MFS AGI: {fmtCurrency(cpAllocation.spouseMfsAgi)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSaveLoan} disabled={upsert.isPending || balanceInvalid || rateInvalid}>
            {loan ? "Update saved loan" : "Save loan"}
          </Button>
          {loan && (
            <Button size="sm" variant="ghost" onClick={() => del.mutate(loan.id)} disabled={del.isPending}>
              Remove
            </Button>
          )}
        </div>
      </Card>

      {/* 3. Your repayment options ────────────────── */}
      <Card className="p-5 space-y-3">
        <div className="font-semibold">Your repayment options</div>
        <p className="text-xs text-muted-foreground">
          Estimates for all supported plans, ordered by lowest monthly payment. Tap a plan to make it active.
        </p>
        <div className="space-y-2">
          {planEstimates.map(({ plan, est, monthsForTotal, totalPaid, forgivenessMonths }) => {
            const isActive = plan.id === selectedPlan;
            const isCurrentSaved = loan?.repayment_plan === plan.id;
            const isLowest = plan.id === lowestMonthlyId;
            const isFastest = plan.id === fastestPayoffId;
            const unavailable = !!est.unavailable;
            const idrMissing = REPAYMENT_PLANS[plan.id]?.family === "idr" && missingAgi;
            const eligibility = est.detail?.eligibility ?? "confirmed";
            const isGraduated = REPAYMENT_PLANS[plan.id]?.family === "graduated";
            const paysBeforeForgiveness =
              forgivenessMonths != null &&
              est.estimatedPayoffMonths != null &&
              est.estimatedPayoffMonths < forgivenessMonths;
            const endpointLabel = isGraduated
              ? "Starting payment"
              : forgivenessMonths != null && !paysBeforeForgiveness
                ? `${Math.round(forgivenessMonths / 12)}-yr forgiveness`
                : est.estimatedPayoffMonths != null
                  ? `Paid off in ${fmtMonths(est.estimatedPayoffMonths)}`
                  : "—";
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlan(plan.id)}
                className={`w-full text-left rounded-md border p-3 transition-colors ${
                  isActive ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-sm">{plan.label}</span>
                      {isCurrentSaved && <Badge variant="outline" className="text-[9px]">Current plan</Badge>}
                      {isLowest && !unavailable && <Badge className="text-[9px]">Lowest monthly</Badge>}
                      {isFastest && !unavailable && <Badge variant="secondary" className="text-[9px]">Pays off fastest</Badge>}
                      {!unavailable && eligibility === "assumed" && (
                        <Badge variant="outline" className="text-[9px] border-amber-500 text-amber-700 dark:text-amber-400">Eligibility not confirmed</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">{plan.tooltip}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {unavailable ? (
                      <div className="text-xs text-muted-foreground">Not available</div>
                    ) : (
                      <>
                        <div className="text-lg font-bold tabular-nums">{fmtCurrency(est.estimatedMonthlyPayment)}<span className="text-[10px] text-muted-foreground font-normal">/mo</span></div>
                        <div className="text-[10px] text-muted-foreground">{endpointLabel}</div>
                        {!isGraduated && totalPaid != null && (
                          <div className="text-[10px] text-muted-foreground">
                            Total ≈ {fmtCurrency(totalPaid)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {idrMissing && !unavailable && (
                  <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                    Estimate shown; eligibility not confirmed (income needed).
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* 4. Compare MFJ vs MFS ────────────────────── */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold flex items-center gap-2">
            <Scale className="h-4 w-4" /> Filing status comparison
          </div>
          <Button size="sm" variant="outline" onClick={() => setComparisonOpen((v) => !v)}>
            {comparisonOpen ? "Hide comparison" : "Compare MFJ vs MFS"}
          </Button>
        </div>
        {comparisonOpen && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sl-borrower-income" className="text-xs text-muted-foreground mb-1.5 block">
                  Your projected annual income (borrower)
                </Label>
                <Input
                  id="sl-borrower-income"
                  type="number"
                  value={borrowerIncomeInput}
                  onChange={(e) => setBorrowerIncomeInput(e.target.value)}
                  placeholder={String(Math.round(projectedTotalIncome))}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Defaults to your projected income from PaycheckMD ({fmtCurrency(projectedTotalIncome)}).
                </p>
              </div>
              <div>
                <Label htmlFor="sl-spouse-income" className="text-xs text-muted-foreground mb-1.5 block">
                  Spouse projected annual income
                </Label>
                <Input
                  id="sl-spouse-income"
                  type="number"
                  value={spouseIncome}
                  onChange={(e) => setSpouseIncome(e.target.value)}
                  placeholder="0"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Household MFJ income = borrower + spouse. Editing here does not change your profile.
                </p>
              </div>
            </div>


            {comparison && (() => {
              const winner = comparison.recommendation === "mfs" ? comparison.mfs : comparison.mfj;
              const winnerLabel = comparison.recommendation === "mfs" ? "Married Filing Separately" : "Married Filing Jointly";
              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ScenarioCard title={comparison.mfj.label} data={comparison.mfj} highlight={comparison.recommendation === "mfj"} />
                    <ScenarioCard title={comparison.mfs.label} data={comparison.mfs} highlight={comparison.recommendation === "mfs"} />
                  </div>
                  <Card className="p-4 bg-primary/5 border-primary/40 space-y-2">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Estimated better option
                    </div>
                    <div className="text-lg font-bold">{winnerLabel}</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <Stat label="Loan savings/yr" value={fmtCurrency(Math.max(0, comparison.studentLoanSavings))} />
                      <Stat label="Added taxes/yr" value={fmtCurrency(Math.max(0, comparison.additionalTaxes))} />
                      <Stat label="Net benefit/yr" value={fmtCurrency(comparison.netAnnualBenefit)} variant="ok" />
                      <Stat label="Net benefit/mo" value={fmtCurrency(comparison.netMonthlyBenefit)} variant="ok" />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Estimates only — based on federal + state tax + student loan payments.
                      {comparison.communityPropertyApplied ? " Community-property allocation applied." : ""}
                      {" "}Confirm with a tax professional before changing your filing status.
                    </p>
                  </Card>
                </>
              );
            })()}
          </div>
        )}
      </Card>

      {/* 5. Advanced loan details ─────────────────── */}
      <details className="rounded-md border border-border bg-background p-4">
        <summary className="cursor-pointer font-medium text-sm flex items-center gap-2">
          <ChevronDown className="h-4 w-4" /> Advanced loan details
        </summary>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Current required monthly payment ($)" value={currentPayment} onChange={setCurrentPayment} type="number" />
          <Field label="Additional monthly payment ($)" value={additionalPayment} onChange={setAdditionalPayment} type="number" />
          <Field label="Months already in repayment" value={monthsInRepayment} onChange={setMonthsInRepayment} type="number" />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          These only refine your estimate — they don't change your profile or tax settings.
        </p>
      </details>
    </div>
  );
}

// ── UI primitives ────────────────────────────────────
function Field({ id, label, value, onChange, type = "text", error }: { id?: string; label: string; value: string; onChange: (v: string) => void; type?: string; error?: string }) {
  const autoId = id ?? label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return (
    <div>
      <Label htmlFor={autoId} className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      <Input id={autoId} type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} className={error ? "border-destructive focus-visible:ring-destructive" : undefined} />
      {error && <p className="text-[11px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

function Stat({ label, value, variant }: { label: string; value: string; variant?: "ok" | "warn" }) {
  const color = variant === "ok" ? "text-emerald-600 dark:text-emerald-400" : variant === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function ScenarioCard({ title, data, highlight }: {
  title: string;
  data: { federalTax: number; stateTax: number; studentLoanAnnualPayment: number; combinedAnnualCost: number; combinedMonthlyCost: number };
  highlight?: boolean;
}) {
  return (
    <Card className={`p-4 ${highlight ? "border-primary/60 ring-1 ring-primary/30" : ""}`}>
      <div className="font-semibold text-sm mb-2">{title}</div>
      <div className="space-y-1 text-sm">
        <RowLine label="Estimated taxes" value={fmtCurrency(data.federalTax + data.stateTax)} />
        <RowLine label="Student loan payments" value={fmtCurrency(data.studentLoanAnnualPayment)} />
        <div className="border-t border-border my-1" />
        <RowLine label="Combined annual cost" value={fmtCurrency(data.combinedAnnualCost)} bold />
      </div>
    </Card>
  );
}
function RowLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function BreakdownRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
