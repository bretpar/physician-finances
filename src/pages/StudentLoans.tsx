import { useMemo, useState, useEffect, useRef } from "react";
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

import { useAuth } from "@/contexts/AuthContext";
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
  // Compare other repayment plans (collapsed by default).
  const [comparePlansOpen, setComparePlansOpen] = useState(false);
  const compareRef = useRef<HTMLDivElement | null>(null);
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

  // Comparison card: AGI is the primary input for both filing scenarios.
  // Defaults come from PaycheckMD's projected AGI (not gross income).
  // Community-property allocation (if applicable) pre-fills the MFS AGIs.
  const [jointAgiInput, setJointAgiInput] = useState<string>("");
  const [borrowerMfsAgiInput, setBorrowerMfsAgiInput] = useState<string>("");
  const [spouseMfsAgiInput, setSpouseMfsAgiInput] = useState<string>("");

  // Default AGI values derived from projected income + community-property allocation.
  const defaultJointAgi = projectedAgi;
  const defaultBorrowerMfsAgi = cpAllocation
    ? cpAllocation.borrowerMfsAgi
    : Math.round(projectedAgi); // no community split → borrower keeps their AGI
  const defaultSpouseMfsAgi = cpAllocation
    ? cpAllocation.spouseMfsAgi
    : Math.max(0, Number(spouseIncome) || 0); // spouse gross ≈ spouse AGI without more data

  const effectiveJointAgi = jointAgiInput !== ""
    ? Math.max(0, Number(jointAgiInput) || 0)
    : defaultJointAgi;
  const effectiveBorrowerMfsAgi = borrowerMfsAgiInput !== ""
    ? Math.max(0, Number(borrowerMfsAgiInput) || 0)
    : defaultBorrowerMfsAgi;
  const effectiveSpouseMfsAgi = spouseMfsAgiInput !== ""
    ? Math.max(0, Number(spouseMfsAgiInput) || 0)
    : defaultSpouseMfsAgi;

  // Compare MFJ vs MFS — AGI-driven.
  // Always compute so the collapsed preview can show default MFJ/MFS values.
  const comparison = useMemo(() => {
    if (!parsedLoan.balance || parsedLoan.balance <= 0) return null;
    return compareFilingStatuses({
      userIncome: 0, // ignored — AGI overrides win
      spouseIncome: Number(spouseIncome) || 0,
      loan: parsedLoan,
      planId: selectedPlan,
      familySize: Math.max(1, familySize ?? 1),
      state,
      applyCommunityRules: isCP,
      stateTaxRatePct: settings?.personalStateTaxRate ?? 0,
      overrideJointAgi: effectiveJointAgi,
      overrideBorrowerMfsAgi: effectiveBorrowerMfsAgi,
      overrideSpouseMfsAgi: effectiveSpouseMfsAgi,
    });
  }, [spouseIncome, parsedLoan, selectedPlan, familySize, state, isCP, settings?.personalStateTaxRate, effectiveJointAgi, effectiveBorrowerMfsAgi, effectiveSpouseMfsAgi]);



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

      {/* 1. Current Repayment Plan ─────────────── */}
      <CurrentPlanCard
        estimate={estimate}
        planLabel={activeEstimate?.plan.label ?? ""}
        forgivenessMonths={activeEstimate?.forgivenessMonths ?? null}
        planId={selectedPlan}
        missingAgi={missingAgi}
        isIdrPlan={isIdrPlan}
        onChangePlan={() => {
          setComparePlansOpen(true);
          requestAnimationFrame(() => {
            compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
      />

      {/* 2. Can Filing Status Lower Your Payment? ── */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="font-semibold flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            Can Filing Status Lower Your Payment?
          </div>
          <Button
            size="sm"
            variant={comparisonOpen ? "outline" : "default"}
            onClick={() => setComparisonOpen((v) => !v)}
          >
            {comparisonOpen ? "Hide comparison" : "Compare Filing Status"}
          </Button>
        </div>

        {!comparisonOpen && (comparison ? (
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">MFJ</div>
                <div className="text-base font-semibold tabular-nums">
                  {fmtCurrency(comparison.mfj.studentLoanMonthlyPayment)}
                  <span className="text-[10px] text-muted-foreground font-normal">/mo</span>
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">MFS</div>
                <div className="text-base font-semibold tabular-nums">
                  {fmtCurrency(comparison.mfs.studentLoanMonthlyPayment)}
                  <span className="text-[10px] text-muted-foreground font-normal">/mo</span>
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Est. loan savings</div>
                <div className="text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmtCurrency(Math.abs(comparison.monthlyLoanSavings))}
                  <span className="text-[10px] text-muted-foreground font-normal">/mo</span>
                </div>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground text-center mt-2">
              Preview using default projected AGI. Open the comparison to adjust inputs.
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Complete the comparison to estimate your tax and student-loan impact.
          </div>
        ))}

        {comparisonOpen && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Defaults to projected AGI from PaycheckMD. Changes here affect this comparison only —
              your profile, Income Planner, and tax settings are not touched.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="sl-joint-agi" className="text-xs text-muted-foreground mb-1.5 block">
                  Joint AGI used (MFJ)
                </Label>
                <Input
                  id="sl-joint-agi"
                  type="number"
                  value={jointAgiInput}
                  onChange={(e) => setJointAgiInput(e.target.value)}
                  placeholder={String(Math.round(defaultJointAgi))}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Default: {fmtCurrency(defaultJointAgi)}
                </p>
              </div>
              <div>
                <Label htmlFor="sl-borrower-mfs-agi" className="text-xs text-muted-foreground mb-1.5 block">
                  Borrower AGI used (MFS)
                </Label>
                <Input
                  id="sl-borrower-mfs-agi"
                  type="number"
                  value={borrowerMfsAgiInput}
                  onChange={(e) => setBorrowerMfsAgiInput(e.target.value)}
                  placeholder={String(Math.round(defaultBorrowerMfsAgi))}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Default: {fmtCurrency(defaultBorrowerMfsAgi)}
                  {cpAllocation ? " · community-property allocation applied" : ""}
                </p>
              </div>
              <div>
                <Label htmlFor="sl-spouse-mfs-agi" className="text-xs text-muted-foreground mb-1.5 block">
                  Spouse AGI used (MFS)
                </Label>
                <Input
                  id="sl-spouse-mfs-agi"
                  type="number"
                  value={spouseMfsAgiInput}
                  onChange={(e) => setSpouseMfsAgiInput(e.target.value)}
                  placeholder={String(Math.round(defaultSpouseMfsAgi))}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Default: {fmtCurrency(defaultSpouseMfsAgi)}
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="sl-spouse-income" className="text-xs text-muted-foreground mb-1.5 block">
                Spouse projected annual income (for plans that require it)
              </Label>
              <Input
                id="sl-spouse-income"
                type="number"
                value={spouseIncome}
                onChange={(e) => setSpouseIncome(e.target.value)}
                placeholder="0"
                className="max-w-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Some IDR plans (e.g. PAYE MFJ) use household income directly. This does not change
                the AGIs above.
              </p>
            </div>

            {comparison && (() => {
              const winnerLabel =
                comparison.recommendation === "mfs"
                  ? "Married Filing Separately"
                  : "Married Filing Jointly";
              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ScenarioCard
                      title="Married Filing Jointly"
                      data={comparison.mfj}
                      taxLabel="Estimated joint taxes"
                      agiLabel="Joint AGI used"
                      highlight={comparison.recommendation === "mfj"}
                    />
                    <ScenarioCard
                      title="Married Filing Separately"
                      data={comparison.mfs}
                      taxLabel="Estimated combined MFS taxes"
                      agiLabel="Borrower AGI used"
                      highlight={comparison.recommendation === "mfs"}
                    />
                  </div>

                  <Card className="p-4 bg-primary/5 border-primary/40 space-y-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Estimated better option
                      </div>
                      <div className="text-lg font-bold">{winnerLabel}</div>
                    </div>

                    <div className="rounded-md bg-background/60 border border-border p-3 space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Monthly student loan payment
                      </div>
                      <RowLine label="MFJ" value={`${fmtCurrency(comparison.mfj.studentLoanMonthlyPayment)}/mo`} />
                      <RowLine label="MFS" value={`${fmtCurrency(comparison.mfs.studentLoanMonthlyPayment)}/mo`} />
                      <div className="border-t border-border my-1" />
                      <RowLine
                        label="Monthly loan-payment savings"
                        value={`${fmtCurrency(Math.abs(comparison.monthlyLoanSavings))}/mo`}
                        bold
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <Stat label="Loan savings/yr" value={fmtCurrency(Math.max(0, comparison.studentLoanSavings))} />
                      <Stat
                        label={comparison.additionalTaxes >= 0 ? "Added taxes/yr" : "Tax savings/yr"}
                        value={fmtCurrency(Math.abs(comparison.additionalTaxes))}
                      />
                      <Stat label="Net benefit/yr" value={fmtCurrency(comparison.netAnnualBenefit)} variant="ok" />
                      <Stat label="Net benefit/mo" value={fmtCurrency(comparison.netMonthlyBenefit)} variant="ok" />
                    </div>

                    <p className="text-[10px] text-muted-foreground">
                      Estimates only — based on federal + state tax + student loan payments.
                      {comparison.communityPropertyApplied ? " Community-property allocation applied." : ""}
                      {" "}Confirm with a tax professional before changing your filing status.
                    </p>
                  </Card>

                  <details className="rounded-md border border-border bg-background/60 p-3 text-xs">
                    <summary className="cursor-pointer font-medium">See annual comparison</summary>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-xs tabular-nums">
                        <thead>
                          <tr className="text-muted-foreground text-left">
                            <th className="font-normal py-1"></th>
                            <th className="font-normal py-1 text-right">MFJ</th>
                            <th className="font-normal py-1 text-right">MFS</th>
                          </tr>
                        </thead>
                        <tbody>
                          <BreakdownTr label="AGI used" mfj={fmtCurrency(comparison.mfj.studentLoanAgi)} mfs={fmtCurrency(comparison.mfs.studentLoanAgi)} />
                          {comparison.mfs.spouseAgi != null && (
                            <BreakdownTr label="Spouse AGI (MFS only)" mfj="—" mfs={fmtCurrency(comparison.mfs.spouseAgi)} />
                          )}
                          <BreakdownTr label="Estimated federal tax" mfj={fmtCurrency(comparison.mfj.federalTax)} mfs={fmtCurrency(comparison.mfs.federalTax)} />
                          <BreakdownTr label="Estimated state tax" mfj={fmtCurrency(comparison.mfj.stateTax)} mfs={fmtCurrency(comparison.mfs.stateTax)} />
                          <BreakdownTr
                            label="Total estimated taxes"
                            mfj={fmtCurrency(comparison.mfj.federalTax + comparison.mfj.stateTax)}
                            mfs={fmtCurrency(comparison.mfs.federalTax + comparison.mfs.stateTax)}
                          />
                          {comparison.mfs.borrowerFederalTax != null && comparison.mfs.spouseFederalTax != null && (
                            <>
                              <BreakdownTr label="  Borrower MFS federal tax" mfj="—" mfs={fmtCurrency(comparison.mfs.borrowerFederalTax)} muted />
                              <BreakdownTr label="  Spouse MFS federal tax" mfj="—" mfs={fmtCurrency(comparison.mfs.spouseFederalTax)} muted />
                            </>
                          )}
                          <BreakdownTr label="Loan payment / month" mfj={fmtCurrency(comparison.mfj.studentLoanMonthlyPayment)} mfs={fmtCurrency(comparison.mfs.studentLoanMonthlyPayment)} />
                          <BreakdownTr label="Loan payments / year" mfj={fmtCurrency(comparison.mfj.studentLoanAnnualPayment)} mfs={fmtCurrency(comparison.mfs.studentLoanAnnualPayment)} />
                          <BreakdownTr
                            label="Combined annual cost"
                            mfj={fmtCurrency(comparison.mfj.combinedAnnualCost)}
                            mfs={fmtCurrency(comparison.mfs.combinedAnnualCost)}
                            bold
                          />
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              );
            })()}
          </div>
        )}
      </Card>

      {/* 3. Loan Interest ───────────────────────── */}
      <LoanInterestCard
        estimate={estimate}
        unpaidMonthlyInterest={unpaidMonthlyInterest}
      />

      {/* 4. Confirm your information ────────────── */}
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
                  <div className="mt-2">
                    <Label htmlFor="manual-agi-input" className="sr-only">
                      Manual AGI (US dollars)
                    </Label>
                    <Input
                      id="manual-agi-input"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="e.g. 250000"
                      aria-label="Manual AGI in US dollars"
                      value={manualAgi}
                      onChange={(e) => setManualAgi(e.target.value)}
                    />
                  </div>
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

      {/* 5. Compare Other Repayment Plans ───────── */}
      <div ref={compareRef}>
        <CompareOtherPlansCard
          planEstimates={planEstimates}
          selectedPlan={selectedPlan}
          onSelectPlan={setSelectedPlan}
          missingAgi={missingAgi}
          open={comparePlansOpen}
          setOpen={setComparePlansOpen}
        />
      </div>

      {/* 6. Advanced ────────────────────────────── */}
      <details className="rounded-md border border-border bg-background p-4">
        <summary className="cursor-pointer font-medium text-sm flex items-center gap-2">
          <ChevronDown className="h-4 w-4" /> Advanced
        </summary>
        <div className="mt-3 space-y-5">
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Loan details
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Current required monthly payment ($)" value={currentPayment} onChange={setCurrentPayment} type="number" />
              <Field label="Additional monthly payment ($)" value={additionalPayment} onChange={setAdditionalPayment} type="number" />
              <Field label="Months already in repayment" value={monthsInRepayment} onChange={setMonthsInRepayment} type="number" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              These only refine your estimate — they don't change your profile or tax settings.
            </p>
          </div>

          {estimate?.detail && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Calculation details
              </div>
              <div className="space-y-1.5 text-xs">
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
            </div>
          )}
        </div>
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

function ScenarioCard({ title, data, highlight, taxLabel, agiLabel }: {
  title: string;
  data: {
    federalTax: number;
    stateTax: number;
    studentLoanAnnualPayment: number;
    studentLoanMonthlyPayment: number;
    combinedAnnualCost: number;
    studentLoanAgi: number;
  };
  highlight?: boolean;
  taxLabel: string;
  agiLabel: string;
}) {
  return (
    <Card className={`p-4 ${highlight ? "border-primary/60 ring-1 ring-primary/30" : ""}`}>
      <div className="font-semibold text-sm mb-1">{title}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Estimated loan payment
      </div>
      <div className="text-3xl font-bold tabular-nums leading-tight">
        {fmtCurrency(data.studentLoanMonthlyPayment)}
        <span className="text-xs font-normal text-muted-foreground">/month</span>
      </div>
      <div className="mt-3 space-y-1 text-sm">
        <RowLine label="Loan payments / year" value={fmtCurrency(data.studentLoanAnnualPayment)} />
        <RowLine label={agiLabel} value={fmtCurrency(data.studentLoanAgi)} />
        <RowLine label={taxLabel} value={`${fmtCurrency(data.federalTax + data.stateTax)}/yr`} />
        <div className="border-t border-border my-1" />
        <RowLine label="Combined annual cost" value={fmtCurrency(data.combinedAnnualCost)} bold />
      </div>
    </Card>
  );
}

function BreakdownTr({ label, mfj, mfs, bold, muted }: { label: string; mfj: string; mfs: string; bold?: boolean; muted?: boolean }) {
  const rowCls = `${bold ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`.trim();
  return (
    <tr className={rowCls}>
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 text-right tabular-nums">{mfj}</td>
      <td className="py-1 text-right tabular-nums">{mfs}</td>
    </tr>
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

// ────────────────────────────────────────────────────────────
// Repayment plans — progressive disclosure UI
// ────────────────────────────────────────────────────────────
type PlanEstimateEntry = {
  plan: (typeof REPAYMENT_PLAN_LIST)[number];
  est: ReturnType<typeof estimateRepayment>;
  monthsForTotal: number | null;
  totalPaid: number | null;
  forgivenessMonths: number | null;
};

function getPlanEndpointLabel(pe: PlanEstimateEntry): string {
  const family = REPAYMENT_PLANS[pe.plan.id]?.family;
  if (family === "graduated") return "10-yr term";
  const paysBefore =
    pe.forgivenessMonths != null &&
    pe.est.estimatedPayoffMonths != null &&
    pe.est.estimatedPayoffMonths < pe.forgivenessMonths;
  if (pe.forgivenessMonths != null && !paysBefore) {
    return `${Math.round(pe.forgivenessMonths / 12)}-yr forgiveness`;
  }
  if (pe.est.estimatedPayoffMonths != null) {
    return `${Math.round(pe.est.estimatedPayoffMonths / 12)}-yr payoff`;
  }
  return "—";
}

function getPlanEligibility(
  pe: PlanEstimateEntry,
  missingAgi: boolean,
): { label: string; tone: "ok" | "warn" | "muted" } {
  if (pe.est.unavailable) return { label: "Not available", tone: "muted" };
  const eligibility = pe.est.detail?.eligibility ?? "confirmed";
  const isIdr = REPAYMENT_PLANS[pe.plan.id]?.family === "idr";
  if (eligibility === "assumed" || (isIdr && missingAgi)) {
    return { label: "Needs confirmation", tone: "warn" };
  }
  return { label: "Eligible", tone: "ok" };
}

// ────────────────────────────────────────────────────────────
// Current Repayment Plan — top card
// ────────────────────────────────────────────────────────────
function CurrentPlanCard({
  estimate,
  planLabel,
  forgivenessMonths,
  planId,
  missingAgi,
  isIdrPlan,
  onChangePlan,
}: {
  estimate: ReturnType<typeof estimateRepayment> | undefined;
  planLabel: string;
  forgivenessMonths: number | null;
  planId: RepaymentPlanId;
  missingAgi: boolean;
  isIdrPlan: boolean;
  onChangePlan: () => void;
}) {
  const isGraduated = REPAYMENT_PLANS[planId]?.family === "graduated";
  const monthly = estimate?.estimatedMonthlyPayment ?? 0;
  const annual = monthly * 12;
  const eligibility = estimate?.detail?.eligibility ?? "confirmed";
  const needsConfirmation = !estimate?.unavailable && (eligibility === "assumed" || (isIdrPlan && missingAgi));

  const paysBefore =
    forgivenessMonths != null &&
    estimate?.estimatedPayoffMonths != null &&
    estimate.estimatedPayoffMonths < forgivenessMonths;
  const termLabel = isGraduated
    ? "10-year term (starting payment)"
    : forgivenessMonths != null && !paysBefore
      ? `${Math.round(forgivenessMonths / 12)}-year forgiveness`
      : estimate?.estimatedPayoffMonths != null
        ? `${fmtMonths(estimate.estimatedPayoffMonths)} payoff`
        : "—";

  const showEmpty = estimate?.unavailable || (missingAgi && isIdrPlan);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
            Current Repayment Plan
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-lg font-semibold truncate">{planLabel || "—"}</div>
            <Badge variant="outline" className="text-[10px]">Current plan</Badge>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onChangePlan} className="shrink-0">
          Change Plan
        </Button>
      </div>

      {showEmpty ? (
        <div>
          <div className="text-3xl font-bold text-muted-foreground tabular-nums">—</div>
          {estimate?.unavailable ? (
            <div className="text-xs text-muted-foreground mt-2">{estimate.unavailable.reason}</div>
          ) : (
            <Alert className="mt-3">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Income-driven plans need an annual income. Add income in your{" "}
                <Link to="/projected-income" className="underline font-medium">Income Planner</Link>,
                or open <strong>Confirm your information</strong> below.
              </AlertDescription>
            </Alert>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-[11px] text-muted-foreground">
              {isGraduated ? "Starting Monthly Payment" : "Estimated Monthly Payment"}
            </div>
            <div className="text-4xl font-bold tabular-nums leading-tight">
              {fmtCurrency(monthly)}
              <span className="text-sm text-muted-foreground font-normal">/month</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-muted-foreground">Estimated Annual Payment</div>
              <div className="text-base font-semibold tabular-nums">
                {fmtCurrency(annual)}
                <span className="text-[11px] text-muted-foreground font-normal">/year</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Term</div>
              <div className="text-base font-semibold">{termLabel}</div>
            </div>
          </div>
          {needsConfirmation && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400">
              Eligibility: Needs confirmation
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────
// Loan Interest — compact card
// ────────────────────────────────────────────────────────────
function LoanInterestCard({
  estimate,
  unpaidMonthlyInterest,
}: {
  estimate: ReturnType<typeof estimateRepayment> | undefined;
  unpaidMonthlyInterest: number;
}) {
  const [learnMore, setLearnMore] = useState(false);
  const monthlyInterest = estimate?.monthlyInterest ?? 0;
  const monthlyPayment = estimate?.estimatedMonthlyPayment ?? 0;
  const covers = !!estimate?.coversMonthlyInterest;

  return (
    <Card className="p-5 space-y-3">
      <div className="font-semibold">Loan Interest</div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Monthly interest" value={fmtCurrency(monthlyInterest)} />
        <Stat label="Current payment" value={`${fmtCurrency(monthlyPayment)}/mo`} />
        <Stat
          label="Covers interest"
          value={covers ? "Yes" : "No"}
          variant={covers ? "ok" : "warn"}
        />
        {!covers && unpaidMonthlyInterest > 0 && (
          <Stat
            label="Est. unpaid interest"
            value={`${fmtCurrency(unpaidMonthlyInterest)}/mo`}
            variant="warn"
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => setLearnMore((o) => !o)}
        className="text-xs text-primary hover:underline flex items-center gap-1"
        aria-expanded={learnMore}
      >
        <Info className="h-3 w-3" /> {learnMore ? "Hide details" : "Learn more"}
      </button>
      {learnMore && (
        <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
          <p>
            Monthly interest is calculated from your outstanding balance and interest rate.
            Changing your filing status or repayment plan does not change your interest rate
            or the monthly interest that accrues on your loan.
          </p>
          <p>
            When your monthly payment is less than the monthly interest, the unpaid portion
            typically capitalizes onto your balance under most repayment plans (some IDR plans
            provide interest subsidies — check with your servicer).
          </p>
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────
// Compare Other Repayment Plans — collapsed by default
// ────────────────────────────────────────────────────────────
function CompareOtherPlansCard({
  planEstimates,
  selectedPlan,
  onSelectPlan,
  missingAgi,
  open,
  setOpen,
}: {
  planEstimates: PlanEstimateEntry[];
  selectedPlan: RepaymentPlanId;
  onSelectPlan: (id: RepaymentPlanId) => void;
  missingAgi: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const [compareAllOpen, setCompareAllOpen] = useState(false);
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);

  const handleSelect = (id: RepaymentPlanId) => {
    onSelectPlan(id);
    setOpen(false);
  };

  // Group plans by relevance.
  const current = planEstimates.filter((p) => p.plan.id === selectedPlan);
  const idrPlans = planEstimates.filter(
    (p) => REPAYMENT_PLANS[p.plan.id]?.family === "idr" && p.plan.id !== selectedPlan,
  );
  const traditionalPlans = planEstimates.filter((p) => {
    const fam = REPAYMENT_PLANS[p.plan.id]?.family;
    return fam !== "idr" && p.plan.id !== selectedPlan;
  });

  const renderRow = (pe: PlanEstimateEntry) => {
    const isActive = pe.plan.id === selectedPlan;
    const elig = getPlanEligibility(pe, missingAgi);
    const endpoint = getPlanEndpointLabel(pe);
    const isGraduated = REPAYMENT_PLANS[pe.plan.id]?.family === "graduated";
    const secondary: string[] = [];
    if (!pe.est.unavailable) secondary.push(endpoint);
    if (elig.tone === "warn") secondary.push("Eligibility not confirmed");
    if (isGraduated) secondary.push("Full schedule not modeled");
    return (
      <button
        key={pe.plan.id}
        type="button"
        role="radio"
        aria-checked={isActive}
        onClick={() => handleSelect(pe.plan.id)}
        className={`w-full flex items-center justify-between gap-3 rounded-md border p-3 text-left min-h-[52px] transition-colors ${
          isActive
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-muted/40"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
              isActive ? "border-primary bg-primary" : "border-muted-foreground/40"
            }`}
            aria-hidden
          >
            {isActive && (
              <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={4} />
            )}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{pe.plan.label}</div>
            {secondary.length > 0 && (
              <div className="text-[11px] text-muted-foreground truncate">
                {secondary.join(" · ")}
              </div>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          {pe.est.unavailable ? (
            <div className="text-xs text-muted-foreground">N/A</div>
          ) : (
            <div className="text-sm font-semibold tabular-nums">
              {isGraduated && (
                <span className="text-[10px] text-muted-foreground font-normal">from </span>
              )}
              {fmtCurrency(pe.est.estimatedMonthlyPayment)}
              <span className="text-[10px] text-muted-foreground font-normal">/mo</span>
            </div>
          )}
        </div>
      </button>
    );
  };

  return (
    <Card className="p-5 space-y-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="font-semibold">Compare Other Repayment Plans</div>
          {!open && (
            <div className="text-xs text-muted-foreground mt-0.5">
              See estimated payments for other federal plans.
            </div>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-4" role="radiogroup" aria-label="Repayment plan">
          {current.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Current plan
              </div>
              {current.map(renderRow)}
            </div>
          )}

          {idrPlans.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Income-Driven Alternatives
              </div>
              {idrPlans.map(renderRow)}
            </div>
          )}

          {traditionalPlans.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Traditional Repayment Plans
              </div>
              {traditionalPlans.map(renderRow)}
            </div>
          )}

          <button
            type="button"
            onClick={() => setCompareAllOpen((o) => !o)}
            className="w-full text-left text-sm text-primary py-1 hover:underline"
            aria-expanded={compareAllOpen}
          >
            {compareAllOpen ? "Hide comparison table" : "Compare All Plans"}
          </button>

          {compareAllOpen && (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Plan</th>
                    <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">Monthly</th>
                    <th className="py-1.5 px-2 font-medium whitespace-nowrap">Term</th>
                    <th className="py-1.5 pl-2 font-medium whitespace-nowrap">Eligibility</th>
                  </tr>
                </thead>
                <tbody>
                  {planEstimates.map((pe) => {
                    const elig = getPlanEligibility(pe, missingAgi);
                    const isGraduated = REPAYMENT_PLANS[pe.plan.id]?.family === "graduated";
                    return (
                      <tr key={pe.plan.id} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{pe.plan.label}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
                          {pe.est.unavailable
                            ? "—"
                            : `${isGraduated ? "from " : ""}${fmtCurrency(pe.est.estimatedMonthlyPayment)}/mo`}
                        </td>
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          {pe.est.unavailable ? "—" : getPlanEndpointLabel(pe)}
                        </td>
                        <td
                          className={`py-1.5 pl-2 whitespace-nowrap ${
                            elig.tone === "warn"
                              ? "text-amber-600 dark:text-amber-400"
                              : elig.tone === "muted"
                                ? "text-muted-foreground"
                                : ""
                          }`}
                        >
                          {elig.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setLearnMoreOpen((o) => !o)}
              className="w-full flex items-center justify-between text-sm py-1 text-muted-foreground"
              aria-expanded={learnMoreOpen}
            >
              <span className="flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" /> Learn More about plans
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${learnMoreOpen ? "rotate-180" : ""}`}
              />
            </button>
            {learnMoreOpen && (
              <div className="mt-3 space-y-3">
                {planEstimates.map((pe) => (
                  <div key={pe.plan.id} className="text-xs">
                    <div className="font-semibold text-sm text-foreground">{pe.plan.label}</div>
                    <div className="text-muted-foreground mt-0.5 leading-relaxed">
                      {pe.plan.tooltip}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}


