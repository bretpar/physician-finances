import { useMemo, useState } from "react";
import { GraduationCap, Info, Scale, AlertTriangle } from "lucide-react";


import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaxSettings, useUpdateTaxSettings } from "@/hooks/useTaxSettings";
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
import { isCommunityPropertyState, COMMUNITY_PROPERTY_STATES } from "@/lib/studentLoan/communityProperty";
import { Badge } from "@/components/ui/badge";
import { Navigate, Link } from "react-router-dom";

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

export default function StudentLoans() {
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();
  const { data: loans = [], isLoading: loansLoading } = useStudentLoans();
  const upsert = useUpsertStudentLoan();
  const del = useDeleteStudentLoan();
  const updateSettings = useUpdateTaxSettings();
  const { forecastEstimate } = useTaxEstimate() ?? { forecastEstimate: null };

  if (!settingsLoading && settings && !settings.studentLoanEstimatorEnabled) {
    return <Navigate to="/settings" replace />;
  }

  const projectedFromPlanner = Math.max(0, forecastEstimate?.totalIncome ?? 0);
  const incomeOverride = settings?.studentLoanIncomeOverride;
  const projectedAnnualIncome = incomeOverride != null && incomeOverride > 0 ? incomeOverride : projectedFromPlanner;

  const filingStatus = settings?.filingStatus ?? "single";
  const state = settings?.stateOfResidence ?? "";
  const familySize = settings?.studentLoanFamilySize ?? 1;
  const isCP = isCommunityPropertyState(state);
  const cpOverride = settings?.studentLoanCommunityPropertyOverride;
  const applyCommunityRules = cpOverride ?? isCP;

  // Single-loan MVP: use the first loan row if present.
  const loan: StudentLoanRow | null = loans[0] ?? null;

  const [draftBalance, setDraftBalance] = useState<string>("");
  const [draftRate, setDraftRate] = useState<string>("");
  const [draftPlan, setDraftPlan] = useState<RepaymentPlanId>("standard_10");
  const [draftCurrentPayment, setDraftCurrentPayment] = useState<string>("");
  const [draftAdditional, setDraftAdditional] = useState<string>("");
  const [draftMonths, setDraftMonths] = useState<string>("");

  // Sync form fields from loaded row (only once when row changes).
  useMemo(() => {
    if (loan) {
      setDraftBalance(String(loan.balance ?? ""));
      setDraftRate(String(loan.interest_rate ?? ""));
      setDraftPlan((loan.repayment_plan as RepaymentPlanId) ?? "standard_10");
      setDraftCurrentPayment(loan.current_monthly_payment != null ? String(loan.current_monthly_payment) : "");
      setDraftAdditional(loan.additional_monthly_payment != null ? String(loan.additional_monthly_payment) : "");
      setDraftMonths(loan.months_in_repayment != null ? String(loan.months_in_repayment) : "");
    }
  }, [loan?.id]);

  const [spouseIncomeInput, setSpouseIncomeInput] = useState<string>(
    settings?.studentLoanSpouseIncomeOverride != null ? String(settings.studentLoanSpouseIncomeOverride) : "",
  );
  const [comparisonOpen, setComparisonOpen] = useState(false);

  const parsedLoan = {
    balance: Number(draftBalance) || 0,
    interestRatePct: Number(draftRate) || 0,
    currentMonthlyPayment: draftCurrentPayment ? Number(draftCurrentPayment) : null,
    additionalMonthlyPayment: draftAdditional ? Number(draftAdditional) : null,
    monthsInRepayment: draftMonths ? Number(draftMonths) : null,
  };

  const aggregated = aggregateLoans([parsedLoan]);
  const estimate = useMemo(
    () =>
      estimateRepayment(aggregated, {
        filingStatus:
          filingStatus === "married_filing_jointly" ? "married_filing_jointly" : "single",
        familySize: Math.max(1, familySize ?? 1),
        annualIncome: projectedAnnualIncome,
      }, draftPlan),
    [aggregated, draftPlan, filingStatus, familySize, projectedAnnualIncome],
  );

  const currentPayment = parsedLoan.currentMonthlyPayment ?? 0;
  const monthlyDiff = estimate.estimatedMonthlyPayment - currentPayment;

  const selectedPlanFamily = REPAYMENT_PLANS[draftPlan]?.family;
  const isIdrPlan = selectedPlanFamily === "idr";
  const hasPlannerIncome = projectedFromPlanner > 0;
  const hasOverrideIncome = incomeOverride != null && incomeOverride > 0;
  const hasAnyIncome = projectedAnnualIncome > 0;
  const idrMissingIncome = isIdrPlan && !hasAnyIncome;
  const balanceInvalid = draftBalance !== "" && Number(draftBalance) < 0;
  const rateInvalid = draftRate !== "" && Number(draftRate) < 0;
  const overrideInvalid = incomeOverride != null && incomeOverride < 0;

  const spouseIncome = Number(spouseIncomeInput) || 0;

  const comparison = useMemo(() => {
    if (!comparisonOpen) return null;
    return compareFilingStatuses({
      userIncome: projectedAnnualIncome,
      spouseIncome,
      loan: parsedLoan,
      planId: draftPlan,
      familySize: Math.max(1, familySize ?? 1),
      state,
      applyCommunityRules,
      stateTaxRatePct: settings?.personalStateTaxRate ?? 0,
    });
  }, [comparisonOpen, projectedAnnualIncome, spouseIncome, parsedLoan, draftPlan, familySize, state, applyCommunityRules, settings?.personalStateTaxRate]);

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
      repayment_plan: draftPlan,
    });
  };

  const handleSaveBorrowerSettings = async (patch: {
    studentLoanFamilySize?: number | null;
    studentLoanIncomeOverride?: number | null;
    studentLoanSpouseIncomeOverride?: number | null;
    studentLoanCommunityPropertyOverride?: boolean | null;
  }) => {
    if (!settings?.id) return;
    await updateSettings.mutateAsync({ id: settings.id, ...(patch as any) });
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
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4 max-w-3xl mx-auto pb-8">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Student Loan Estimator</h1>
        </div>

        {/* Hero result card ─────────────────────────── */}
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Estimated monthly payment · {estimate.plan.label}
          </div>
          {idrMissingIncome ? (
            <>
              <div className="text-3xl font-bold text-muted-foreground">—</div>
              <Alert variant="destructive" className="mt-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs space-y-2">
                  <p>
                    <strong>We need your annual income to estimate this plan.</strong>{" "}
                    Income-driven repayment plans (PAYE, IBR, ICR, SAVE) are calculated from your
                    projected annual income, but we don't have one yet.
                  </p>
                  <p>
                    Add income in your{" "}
                    <Link to="/projected-income" className="underline font-medium">
                      Income Planner
                    </Link>
                    , or enter a projected annual income below to see an estimate. You can also
                    switch to a non-income-based plan (Standard, Extended, or Graduated) to see
                    results now.
                  </p>
                </AlertDescription>
              </Alert>
            </>
          ) : (
            <>
              <div className="text-3xl font-bold">{fmtCurrency(estimate.estimatedMonthlyPayment)}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {fmtCurrency(estimate.estimatedAnnualPayment)} per year
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
                <Stat label="Monthly interest" value={fmtCurrency(estimate.monthlyInterest)} />
                <Stat label="Annual interest" value={fmtCurrency(estimate.annualInterest)} />
                <Stat
                  label="Covers interest?"
                  value={estimate.coversMonthlyInterest ? "Yes" : "No"}
                  variant={estimate.coversMonthlyInterest ? "ok" : "warn"}
                />
                <Stat label="Est. payoff" value={fmtMonths(estimate.estimatedPayoffMonths)} />
              </div>
              {isIdrPlan && !hasPlannerIncome && hasOverrideIncome && (
                <div className="mt-3 text-[11px] text-muted-foreground flex gap-1.5">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Using your manual income override because no projected income was found in the
                  Income Planner.
                </div>
              )}
              {currentPayment > 0 && (
                <div className="mt-4 rounded-md border border-border p-3 text-sm bg-muted/30">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Current payment" value={fmtCurrency(currentPayment)} />
                    <Stat label="Estimated payment" value={fmtCurrency(estimate.estimatedMonthlyPayment)} />
                    <Stat
                      label="Monthly difference"
                      value={`${monthlyDiff >= 0 ? "+" : ""}${fmtCurrency(monthlyDiff)}`}
                      variant={monthlyDiff <= 0 ? "ok" : "warn"}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Annual difference: {monthlyDiff >= 0 ? "+" : ""}{fmtCurrency(monthlyDiff * 12)}
                  </div>
                </div>
              )}
              {estimate.notes.length > 0 && (
                <ul className="mt-3 text-xs text-muted-foreground space-y-1">
                  {estimate.notes.map((n, i) => (
                    <li key={i} className="flex gap-1.5"><Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />{n}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>


        {/* Loan information ─────────────────────────── */}
        <Card className="p-5 space-y-3">
          <div className="font-semibold flex items-center gap-2">Loan information</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Total loan balance ($)" value={draftBalance} onChange={setDraftBalance} type="number" error={balanceInvalid ? "Balance can't be negative." : undefined} />
            <Field label="Interest rate (%)" value={draftRate} onChange={setDraftRate} type="number" error={rateInvalid ? "Interest rate can't be negative." : undefined} />
            <Field label="Current required monthly payment ($, optional)" value={draftCurrentPayment} onChange={setDraftCurrentPayment} type="number" />
            <Field label="Additional monthly payment ($, optional)" value={draftAdditional} onChange={setDraftAdditional} type="number" />
            <Field label="Months already in repayment (optional)" value={draftMonths} onChange={setDraftMonths} type="number" />

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Repayment plan</Label>
              <Select value={draftPlan} onValueChange={(v) => setDraftPlan(v as RepaymentPlanId)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPAYMENT_PLAN_LIST.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>{p.label}</span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs text-xs">
                          {p.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {REPAYMENT_PLANS[draftPlan].tooltip}
              </p>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSaveLoan} disabled={upsert.isPending || balanceInvalid || rateInvalid}>
              {loan ? "Update loan" : "Save loan"}
            </Button>

            {loan && (
              <Button size="sm" variant="ghost" onClick={() => del.mutate(loan.id)} disabled={del.isPending}>
                Remove
              </Button>
            )}
          </div>
        </Card>

        {/* Borrower information ────────────────────── */}
        <Card className="p-5 space-y-3">
          <div className="font-semibold">Borrower information</div>
          {idrMissingIncome ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                No projected income found. Enter a projected annual income below, or set one up in
                your <Link to="/projected-income" className="underline font-medium">Income Planner</Link>.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Income-driven repayment plans are generally based on annual income. This calculator uses
                your projected annual income by default.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <ReadonlyRow label="Filing status" value={filingStatus === "married_filing_jointly" ? "Married Filing Jointly" : "Single"} />
            <ReadonlyRow label="State" value={state || "—"} />
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Family size</Label>
              <Input
                type="number"
                min={1}
                value={familySize ?? 1}
                onChange={(e) => handleSaveBorrowerSettings({ studentLoanFamilySize: Number(e.target.value) || 1 })}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Projected annual income{" "}
                {incomeOverride == null ? (
                  <span className="text-[10px]">
                    ({hasPlannerIncome ? "from Income Planner" : "not found in Income Planner"})
                  </span>
                ) : (
                  <span className="text-[10px]">(overridden)</span>
                )}
              </Label>
              <Input
                type="number"
                placeholder={hasPlannerIncome ? String(Math.round(projectedFromPlanner)) : "e.g. 250000"}
                value={incomeOverride ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  handleSaveBorrowerSettings({ studentLoanIncomeOverride: v });
                }}
                aria-invalid={overrideInvalid}
                className={overrideInvalid ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {overrideInvalid ? (
                <p className="text-[11px] text-destructive mt-1">Income can't be negative.</p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {hasPlannerIncome
                    ? "Overriding here won't change your Income Planner."
                    : "Enter an estimate to see income-driven repayment amounts."}
                </p>
              )}
            </div>

          </div>
        </Card>

        {/* MFJ vs MFS comparison ───────────────────── */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-2">
              <Scale className="h-4 w-4" /> Compare filing status
            </div>
            <Button size="sm" variant="outline" onClick={() => setComparisonOpen((o) => !o)}>
              {comparisonOpen ? "Hide comparison" : "Compare MFJ vs MFS"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Read-only. Running this comparison never changes your saved filing status or tax settings.
          </p>

          {comparisonOpen && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Spouse projected annual income</Label>
                  <Input
                    type="number"
                    value={spouseIncomeInput}
                    onChange={(e) => setSpouseIncomeInput(e.target.value)}
                    onBlur={() => handleSaveBorrowerSettings({
                      studentLoanSpouseIncomeOverride: spouseIncomeInput === "" ? null : Number(spouseIncomeInput),
                    })}
                  />
                </div>
                {isCP && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Apply community property income split
                    </Label>
                    <div className="flex items-center gap-2 h-10">
                      <Switch
                        checked={applyCommunityRules}
                        onCheckedChange={(v) => handleSaveBorrowerSettings({ studentLoanCommunityPropertyOverride: v })}
                      />
                      <span className="text-xs text-muted-foreground">
                        {state?.toUpperCase()} is a community property state. Default: 50/50 split.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {!isCP && (
                <p className="text-[11px] text-muted-foreground">
                  Community-property states ({COMMUNITY_PROPERTY_STATES.join(", ")}) require special MFS income
                  allocation rules. Your state is not one of them, so each spouse reports their own income.
                </p>
              )}

              {comparison && (() => {
                const winner = comparison.recommendation === "mfs" ? comparison.mfs : comparison.mfj;
                const loser = comparison.recommendation === "mfs" ? comparison.mfj : comparison.mfs;
                const winnerLabel = comparison.recommendation === "mfs" ? "Married Filing Separately" : "Married Filing Jointly";
                const loserLabel = comparison.recommendation === "mfs" ? "Married Filing Jointly" : "Married Filing Separately";
                const loanDelta = loser.studentLoanAnnualPayment - winner.studentLoanAnnualPayment;
                const taxDelta = (winner.federalTax + winner.stateTax) - (loser.federalTax + loser.stateTax);
                const drivers: { label: string; value: string; positive: boolean }[] = [];
                if (loanDelta > 0) drivers.push({ label: `Lower student loan payments (${winnerLabel})`, value: `−${fmtCurrency(loanDelta)}/yr`, positive: true });
                else if (loanDelta < 0) drivers.push({ label: `Higher student loan payments under ${winnerLabel}`, value: `+${fmtCurrency(-loanDelta)}/yr`, positive: false });
                if (taxDelta < 0) drivers.push({ label: `Higher combined taxes under ${winnerLabel}`, value: `+${fmtCurrency(-taxDelta)}/yr`, positive: false });
                else if (taxDelta > 0) drivers.push({ label: `Lower combined taxes under ${winnerLabel}`, value: `−${fmtCurrency(taxDelta)}/yr`, positive: true });
                if (comparison.communityPropertyApplied) drivers.push({ label: "Community property 50/50 income split applied", value: "MFS income adjustment", positive: true });

                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <ScenarioCard title={comparison.mfj.label} data={comparison.mfj} highlight={comparison.recommendation === "mfj"} />
                      <ScenarioCard title={comparison.mfs.label} data={comparison.mfs} highlight={comparison.recommendation === "mfs"} />
                    </div>
                    <Card className="p-4 bg-primary/5 border-primary/40 space-y-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-wide text-muted-foreground">
                            Recommended filing status
                          </span>
                          <span className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                            Estimate
                          </span>
                        </div>
                        <div className="text-xl font-bold mt-1">{winnerLabel}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Chosen because it has the lowest <strong>combined annual cost</strong>{" "}
                          (federal tax + state tax + student loan payments).
                        </div>
                      </div>

                      {/* Cost basis breakdown */}
                      <div className="rounded-md border border-border bg-background/60 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                          How the recommendation is calculated (annual, estimated)
                        </div>
                        <div className="text-xs">
                          <div className="grid grid-cols-3 gap-2 pb-1 border-b border-border font-medium text-muted-foreground">
                            <div>Cost component</div>
                            <div className="text-right">{loserLabel}</div>
                            <div className="text-right">{winnerLabel}</div>
                          </div>
                          <CostRow label="Federal tax" left={loser.federalTax} right={winner.federalTax} />
                          <CostRow label="State tax" left={loser.stateTax} right={winner.stateTax} />
                          <CostRow label="Student loan payments" left={loser.studentLoanAnnualPayment} right={winner.studentLoanAnnualPayment} />
                          <div className="grid grid-cols-3 gap-2 pt-1 mt-1 border-t border-border font-semibold">
                            <div>Combined annual cost</div>
                            <div className="text-right">{fmtCurrency(loser.combinedAnnualCost)}</div>
                            <div className="text-right text-primary">{fmtCurrency(winner.combinedAnnualCost)}</div>
                          </div>
                        </div>
                      </div>

                      {/* Net benefit */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <Stat label="Est. loan savings/yr" value={fmtCurrency(Math.max(0, comparison.studentLoanSavings))} />
                        <Stat label="Est. added taxes/yr" value={fmtCurrency(Math.max(0, comparison.additionalTaxes))} />
                        <Stat label="Net benefit/yr" value={fmtCurrency(comparison.netAnnualBenefit)} variant="ok" />
                        <Stat label="Net benefit/mo" value={fmtCurrency(comparison.netMonthlyBenefit)} variant="ok" />
                      </div>

                      {/* Key drivers */}
                      {drivers.length > 0 && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                            Key drivers
                          </div>
                          <ul className="space-y-1 text-xs">
                            {drivers.map((d, i) => (
                              <li key={i} className="flex items-start justify-between gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5">
                                <span className="flex items-start gap-1.5">
                                  <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${d.positive ? "bg-emerald-500" : "bg-amber-500"}`} />
                                  {d.label}
                                </span>
                                <span className={`font-medium tabular-nums shrink-0 ${d.positive ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                                  {d.value}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Estimate disclaimer */}
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription className="text-[11px] space-y-1">
                          <p><strong>These are estimates, not tax or legal advice.</strong> {comparison.communityPropertyNote}</p>
                          <p>
                            Assumptions: MFS federal tax is approximated using single-filer brackets;
                            state tax uses your saved personal rate ({(settings?.personalStateTaxRate ?? 0)}%);
                            income-driven loan payments use your projected annual income and family
                            size of {Math.max(1, familySize ?? 1)}. Retirement, credits, and other
                            deductions are not modeled in this comparison. Confirm with a tax
                            professional before changing your filing status.
                          </p>
                        </AlertDescription>
                      </Alert>
                    </Card>
                  </>
                );
              })()}

            </div>
          )}
        </Card>
      </div>
    </TooltipProvider>
  );
}

function Field({ label, value, onChange, type = "text", error }: { label: string; value: string; onChange: (v: string) => void; type?: string; error?: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} className={error ? "border-destructive focus-visible:ring-destructive" : undefined} />
      {error && <p className="text-[11px] text-destructive mt-1">{error}</p>}
    </div>
  );
}


function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm">{value}</div>
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

function ScenarioCard({ title, data, highlight }: { title: string; data: { federalTax: number; stateTax: number; studentLoanAnnualPayment: number; combinedAnnualCost: number; combinedMonthlyCost: number }; highlight?: boolean }) {
  return (
    <Card className={`p-4 ${highlight ? "border-primary/60 ring-1 ring-primary/30" : ""}`}>
      <div className="font-semibold text-sm mb-2">{title}</div>
      <div className="space-y-1 text-sm">
        <Row label="Federal tax" value={fmtCurrency(data.federalTax)} />
        <Row label="State tax" value={fmtCurrency(data.stateTax)} />
        <Row label="Student loan (annual)" value={fmtCurrency(data.studentLoanAnnualPayment)} />
        <div className="border-t border-border my-1" />
        <Row label="Combined annual cost" value={fmtCurrency(data.combinedAnnualCost)} bold />
        <Row label="Monthly equivalent" value={fmtCurrency(data.combinedMonthlyCost)} muted />
      </div>
    </Card>
  );
}
function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold" : ""} ${muted ? "text-muted-foreground text-xs" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CostRow({ label, left, right }: { label: string; left: number; right: number }) {
  const diff = right - left;
  const better = diff < 0;
  return (
    <div className="grid grid-cols-3 gap-2 py-1 items-center">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-right tabular-nums">{fmtCurrency(left)}</div>
      <div className={`text-right tabular-nums ${diff === 0 ? "" : better ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
        {fmtCurrency(right)}
        {diff !== 0 && (
          <span className="ml-1 text-[10px]">
            ({better ? "−" : "+"}{fmtCurrency(Math.abs(diff))})
          </span>
        )}
      </div>
    </div>
  );
}

