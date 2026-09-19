import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InfoTooltip } from "@/components/ui/tooltip";
import { ChevronDown, PiggyBank } from "lucide-react";
import type { RetirementRoomView } from "@/lib/retirementRoomView";
import { retirementReasonMessage } from "@/lib/retirementReasonMessages";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const PLAN_LABELS: Record<string, string> = {
  "401k": "401(k)",
  "403b": "403(b)",
  tsp: "TSP",
  solo_401k: "Solo 401(k)",
  governmental_457b: "Governmental 457(b)",
  simple_ira: "SIMPLE IRA",
  simple_401k: "SIMPLE 401(k)",
  sep_ira: "SEP IRA",
};

export interface RetirementRoomSummaryProps {
  room: RetirementRoomView;
  hasPlannerAccess: boolean;
  hasEmployerOpportunityAccess?: boolean;
  hasCapacityAccess?: boolean;
}

const BucketCard = ({ title, contributed, limit, remaining, description, catchUp, children, testId }: {
  title: string; contributed: number; limit: number; remaining: number; description: string;
  catchUp?: number; children?: React.ReactNode; testId?: string;
}) => (
  <Collapsible asChild>
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{title}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {fmt(contributed)} <span className="text-sm font-normal text-muted-foreground">of {fmt(limit)}</span>
            </p>
          </div>
          {children && <CollapsibleTrigger className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`Show ${title} details`}><ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" /></CollapsibleTrigger>}
        </div>
        <Progress value={limit > 0 ? Math.min(100, contributed / limit * 100) : 0} className="mt-3 h-2" />
        <p className="mt-2 text-sm"><span className="font-semibold tabular-nums">{fmt(remaining)}</span> remaining</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {!!catchUp && <p className="mt-1 text-xs text-muted-foreground">Includes {fmt(catchUp)} {catchUp > 8_000 ? "age 60–63" : "age 50+"} catch-up</p>}
        {children && <CollapsibleContent className="mt-4 border-t pt-3">{children}</CollapsibleContent>}
      </CardContent>
    </Card>
  </Collapsible>
);

export function RetirementRoomSummary({
  room,
  hasPlannerAccess,
  hasEmployerOpportunityAccess = true,
  hasCapacityAccess = true,
}: RetirementRoomSummaryProps) {
  const { engine, engineProjected } = room;
  const projectedById = new Map((engineProjected?.plans ?? []).map((plan) => [plan.planId, plan]));
  const totalContributed = engine.plans.reduce((sum, plan) => sum + plan.totalAdditions, 0) + engine.ira.combinedContributed;
  const employerPlans = engine.plans.filter((plan) => plan.deferralBucket !== "governmental_457b");
  const knownEmployerOpportunity = employerPlans.reduce((sum, plan) => {
    const projected = hasPlannerAccess ? projectedById.get(plan.planId)?.employerCapacityRemaining : null;
    const capacity = projected ?? plan.employerCapacityRemaining;
    return sum + (capacity ?? 0);
  }, 0);
  const unknownEmployerCount = employerPlans.filter((plan) => {
    const projected = hasPlannerAccess ? projectedById.get(plan.planId)?.employerCapacityRemaining : null;
    return (projected ?? plan.employerCapacityRemaining) == null && plan.reasons.includes("unknown_plan_data");
  }).length;
  const bucketPlans = (bucket: "402g" | "governmental_457b" | "simple") => engine.plans.filter((p) => p.deferralBucket === bucket);
  // SIMPLE deferrals also consume the shared employee ceiling. Count that
  // overlapping room once in the overview, while retaining both bucket cards.
  const sharedEmployeeOpportunity = bucketPlans("402g").length > 0
    ? engine.employee402g.remaining
    : (engine.simple?.remaining ?? 0);
  const additionalOpportunity = sharedEmployeeOpportunity + (engine.governmental457b?.remaining ?? 0) +
    (engine.ira.remainingContributionRoom ?? 0) + knownEmployerOpportunity;
  const reasonLines = (reasons: typeof engine.employee402g.reasons) => Array.from(new Set(reasons)).map(retirementReasonMessage);

  return (
    <div className="space-y-4" data-testid="retirement-room-summary">
      <section className="border-b pb-4">
        <div className="flex items-center gap-2"><PiggyBank className="h-5 w-5 text-primary" /><h3 className="text-lg font-semibold">{engine.taxYear} Retirement</h3></div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div><p className="text-xs text-muted-foreground">Total contributed</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmt(totalContributed)}</p></div>
          <div><p className="text-xs text-muted-foreground">Additional contribution opportunity</p><p className="mt-1 text-2xl font-bold tabular-nums">{hasCapacityAccess ? fmt(additionalOpportunity) : "—"}</p></div>
        </div>
        {unknownEmployerCount > 0 && <p className="mt-3 text-xs text-muted-foreground">Additional employer opportunity may be available for {unknownEmployerCount} {unknownEmployerCount === 1 ? "plan" : "plans"}.</p>}
      </section>

      <BucketCard title="Employee retirement" contributed={engine.employee402g.contributed} limit={engine.employee402g.limit} remaining={engine.employee402g.remaining} catchUp={engine.employee402g.catchUp} description="Shared across your eligible 401(k), 403(b), and Solo 401(k) employee contributions." testId="employee-room">
        <div className="space-y-2">{bucketPlans("402g").map((plan) => <div key={plan.planId ?? plan.companyName} className="flex justify-between gap-3 text-sm"><span>{plan.companyName} {PLAN_LABELS[plan.planKind]}</span><span className="shrink-0 font-medium tabular-nums">{fmt(plan.employeeContribution)}</span></div>)}</div>
      </BucketCard>

      {engine.governmental457b && <BucketCard title="Governmental 457(b)" contributed={engine.governmental457b.contributed} limit={engine.governmental457b.limit} remaining={engine.governmental457b.remaining} catchUp={engine.governmental457b.catchUp} description="This plan has a separate contribution limit from your 401(k)/403(b) employee limit.">
        <div className="space-y-2">{bucketPlans("governmental_457b").map((plan) => <div key={plan.planId ?? plan.companyName} className="flex justify-between text-sm"><span>{plan.companyName}</span><span className="font-medium tabular-nums">{fmt(plan.employeeContribution)}</span></div>)}</div>
      </BucketCard>}

      {engine.simple && <BucketCard title="SIMPLE" contributed={engine.simple.contributed} limit={engine.simple.limit} remaining={engine.simple.remaining} catchUp={engine.simple.catchUp} description="SIMPLE plans use their own annual contribution limit.">
        <div className="space-y-2">{bucketPlans("simple").map((plan) => <div key={plan.planId ?? plan.companyName} className="flex justify-between text-sm"><span>{plan.companyName} {PLAN_LABELS[plan.planKind]}</span><span className="font-medium tabular-nums">{fmt(plan.employeeContribution)}</span></div>)}</div>
      </BucketCard>}

      {employerPlans.length > 0 && <section className="space-y-2"><h4 className="text-sm font-semibold">Employer retirement opportunity</h4>{employerPlans.map((plan) => {
        const projectedPlan = hasPlannerAccess ? projectedById.get(plan.planId) : undefined;
        const capacity = projectedPlan?.employerCapacityRemaining ?? plan.employerCapacityRemaining;
        const isProjected = !!projectedPlan && projectedPlan.employerCapacityRemaining != null;
        return <Collapsible key={plan.planId ?? `${plan.companyName}-${plan.planKind}`} asChild><Card data-testid="plan-capacity-card"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{plan.companyName}</p><p className="text-xs text-muted-foreground">{PLAN_LABELS[plan.planKind]} · Employer</p><p className="mt-2 text-sm"><span className="font-semibold tabular-nums">{fmt(plan.employerContribution)}</span> contributed</p>{hasCapacityAccess && hasEmployerOpportunityAccess && (capacity == null ? <p className="mt-1 text-sm text-muted-foreground">Additional employer contribution depends on your employer's plan. <InfoTooltip>PaycheckMD knows the IRS ceiling, but your employer's match or profit-sharing formula determines what can actually be added.</InfoTooltip></p> : <p className="mt-1 text-sm"><span className="font-semibold tabular-nums">Up to {fmt(capacity)} additional</span></p>)}{isProjected && <p className="mt-1 text-xs text-muted-foreground">Based on projected {engine.taxYear} business profit</p>}</div><CollapsibleTrigger className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`Show ${plan.companyName} details`}><ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" /></CollapsibleTrigger></div><CollapsibleContent className="mt-4 border-t pt-3"><dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">Current allowable employer contribution</dt><dd>{plan.employerCapacityRemaining == null ? "Unknown" : fmt(plan.employerContribution + plan.employerCapacityRemaining)}</dd></div>{projectedPlan && <div className="flex justify-between"><dt className="text-muted-foreground">Projected year-end allowable contribution</dt><dd>{projectedPlan.employerCapacityRemaining == null ? "Unknown" : fmt(projectedPlan.employerContribution + projectedPlan.employerCapacityRemaining)}</dd></div>}<div className="flex justify-between"><dt className="text-muted-foreground">Current eligible compensation</dt><dd>{plan.eligibleCompensation == null ? "Unknown" : fmt(plan.eligibleCompensation)}</dd></div>{projectedPlan && <div className="flex justify-between"><dt className="text-muted-foreground">Projected eligible compensation</dt><dd>{projectedPlan.eligibleCompensation == null ? "Unknown" : fmt(projectedPlan.eligibleCompensation)}</dd></div>}<div className="flex justify-between"><dt className="text-muted-foreground">Total plan additions</dt><dd>{fmt(plan.totalAdditions)}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Plan ceiling</dt><dd>{plan.annualAdditionsLimit == null ? "Unknown" : fmt(plan.annualAdditionsLimit)}</dd></div></dl><div className="mt-3 space-y-1 text-xs text-muted-foreground">{reasonLines(plan.reasons).map((message) => <p key={message}>{message}</p>)}</div></CollapsibleContent></CardContent></Card></Collapsible>;
      })}</section>}

      <Collapsible asChild><Card data-testid="ira-room"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">IRA</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmt(engine.ira.combinedContributed)} <span className="text-sm font-normal text-muted-foreground">of {fmt(engine.ira.combinedLimit ?? engine.ira.statutoryCombinedLimit)}</span></p><p className="mt-1 text-sm"><span className="font-semibold tabular-nums">{engine.ira.remainingContributionRoom == null ? "Unknown" : fmt(engine.ira.remainingContributionRoom)}</span> remaining</p></div><CollapsibleTrigger className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Show IRA details"><ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" /></CollapsibleTrigger></div><div className="mt-4 space-y-2 border-t pt-3 text-sm"><div className="flex justify-between"><span>Traditional IRA</span><span className="font-medium tabular-nums">{fmt(engine.ira.traditionalContributed)} contributed</span></div><div className="flex justify-between"><span>Roth IRA</span><span className="font-medium tabular-nums">{fmt(engine.ira.rothContributed)} contributed</span></div><div className="flex items-start justify-between gap-3"><span>Tax deductible <InfoTooltip>Traditional IRA contributions may be fully deductible, partially deductible, or nondeductible depending on income and workplace retirement-plan coverage.</InfoTooltip></span><span className="text-right font-medium">{engine.ira.deductibilityUnknown ? "Eligibility needs your income estimate" : fmt(engine.ira.traditionalDeductible)}</span></div></div><CollapsibleContent className="mt-3 border-t pt-3 text-sm"><p><span className="text-muted-foreground">Direct Roth contribution eligibility: </span>{engine.ira.rothEligibilityUnknown ? "Eligibility needs your income estimate" : engine.ira.rothAllowed === 0 ? "Not eligible" : (engine.ira.rothAllowed ?? 0) < (engine.ira.combinedLimit ?? engine.ira.statutoryCombinedLimit) ? "Partially eligible" : "Eligible"}</p>{engine.ira.rothRemaining != null && <p className="mt-1 text-muted-foreground">Remaining direct Roth amount: {fmt(engine.ira.rothRemaining)}</p>}<div className="mt-2 space-y-1 text-xs text-muted-foreground">{reasonLines(engine.ira.reasons).map((message) => <p key={message}>{message}</p>)}</div></CollapsibleContent></CardContent></Card></Collapsible>
    </div>
  );
}
