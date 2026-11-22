import { type ReactNode } from "react";
import { ChevronDown, Pencil, PiggyBank, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InfoTooltip } from "@/components/ui/tooltip";
import { type RetirementRoomView } from "@/lib/retirementRoomView";
import type { PlanOpportunity } from "@/lib/retirementOpportunityEngine";
import { retirementReasonMessage } from "@/lib/retirementReasonMessages";
import { businessPlannerOpportunity, groupRowsByCompany, sumRows, type PlannerCategory, type PlannerHistoryRow } from "@/lib/retirementPlannerView";

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const PLAN_LABELS: Record<string, string> = {
  "401k": "401(k)", "403b": "403(b)", tsp: "TSP", solo_401k: "Solo 401(k)", governmental_457b: "Governmental 457(b)",
  simple_ira: "SIMPLE IRA", simple_401k: "SIMPLE 401(k)", sep_ira: "SEP IRA",
};
const SELF_EMPLOYED = new Set(["schedule_c", "partnership_k1"]);

export interface RetirementPlannerProps {
  room: RetirementRoomView;
  history: PlannerHistoryRow[];
  companyName: (companyId: string | null) => string | null;
  hasPlannerAccess: boolean;
  hasEmployerOpportunityAccess?: boolean;
  hasCapacityAccess?: boolean;
  onEditContribution?: (id: string) => void;
  onDeleteContribution?: (id: string) => void;
}

function Details({ children, label = "Details & history" }: { children: ReactNode; label?: string }) {
  return <Collapsible>
    <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="group min-h-11 gap-2 px-0 text-xs">{label}<ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
    <CollapsibleContent className="space-y-3 pb-2 pt-1">{children}</CollapsibleContent>
  </Collapsible>;
}

function Meter({ actual, scheduled = 0, available, label, limit, unknownLabel = "Plan-dependent", estimated = false }: {
  actual: number; scheduled?: number; available: number | null; label: string; limit?: number | null; unknownLabel?: string; estimated?: boolean;
}) {
  const values = [Math.max(0, actual), Math.max(0, scheduled), Math.max(0, available ?? 0)];
  const total = values.reduce((sum, n) => sum + n, 0);
  const labels = ["Contributed", "Scheduled", estimated ? "Estimated remaining" : "Remaining"];
  const colors = ["bg-primary", "bg-warning", "bg-success"];
  return <div className="space-y-2">
    {limit != null && <p className="text-xs text-muted-foreground">Annual limit <span className="font-medium text-foreground">{fmt(limit)}</span></p>}
    {available != null && <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted" role="img" aria-label={`${label}: contributed ${fmt(actual)}, scheduled ${fmt(scheduled)}, ${estimated ? "estimated " : ""}remaining ${fmt(available)}`}>
      {total > 0 && values.map((n, i) => n > 0 && <span key={labels[i]} className={colors[i]} style={{ width: `${n / Math.max(total, limit ?? 0) * 100}%` }} />)}
    </div>}
    <div className="grid grid-cols-3 gap-2">
      {labels.map((text, i) => <div key={text} className="min-w-0"><p className="flex items-start gap-1 text-[11px] leading-tight text-muted-foreground"><span className={`mt-0.5 h-2 w-2 shrink-0 rounded-sm ${colors[i]}`} />{text}</p><p className="mt-0.5 break-words text-sm font-semibold tabular-nums">{i === 2 && available == null ? unknownLabel : fmt(values[i])}</p></div>)}
    </div>
  </div>;
}

function Line({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{value}</span></div>;
}

function HistoryTable({ rows, showScheduled, onEdit, onDelete }: { rows: PlannerHistoryRow[]; showScheduled: boolean; onEdit?: (id: string) => void; onDelete?: (id: string) => void }) {
  const actual = rows.filter((r) => !r.scheduled);
  const scheduled = showScheduled ? rows.filter((r) => r.scheduled) : [];
  const renderRows = (list: PlannerHistoryRow[]) => list.map((r) => (
    <div key={r.key} className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:gap-2 border-b py-2 text-sm last:border-0" data-testid="retirement-history-row">
      <div className="min-w-0">
        <p className="font-medium">{r.recurringLabel ? (r.scheduled ? "Rest of year" : "Through today") : (r.date ?? "No date")}</p>
        <p className="text-xs text-muted-foreground">
          {r.funding} · {r.source === "Planner" ? "Planner paycheck" : r.source}{r.accountLabel ? ` · ${r.accountLabel}` : ""}{r.recurringLabel ? ` · repeating ${r.recurringLabel}` : ""}
        </p>
        {r.reviewNote && <p className="mt-1 text-xs text-warning" data-testid="retirement-history-review">{r.reviewNote}</p>}
        {r.possibleDuplicate && <Badge variant="outline" className="mt-1 border-warning/50 text-xs">May duplicate a paycheck entry</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-0.5">
        <span className="mr-1 font-semibold tabular-nums">{fmt(r.amount)}</span>
        {r.editableId && onEdit && <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => { if (r.editableId) onEdit(r.editableId); }} aria-label="Edit contribution"><Pencil className="h-4 w-4" /></Button>}
        {r.editableId && onDelete && <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => { if (r.editableId) onDelete(r.editableId); }} aria-label="Delete contribution"><Trash2 className="h-4 w-4" /></Button>}
      </div>
    </div>
  ));
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">Recorded</p>
        {actual.length ? renderRows(actual) : <p className="py-2 text-sm text-muted-foreground">Nothing recorded yet.</p>}
      </div>
      {scheduled.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Scheduled (not yet contributed)</p>
          {renderRows(scheduled)}
        </div>
      )}
    </div>
  );
}

function JobHistory({ groups, nameOf, showScheduled, onEdit, onDelete }: {
  groups: Map<string | null, PlannerHistoryRow[]>; nameOf: (id: string | null) => string; showScheduled: boolean;
  onEdit?: (id: string) => void; onDelete?: (id: string) => void;
}) {
  return <div className="divide-y">
    {Array.from(groups.entries()).map(([cid, rows]) => <div key={cid ?? "none"} className="py-2">
      <Line label={nameOf(cid)} value={`${fmt(sumRows(rows, false))} contributed · ${fmt(showScheduled ? sumRows(rows, true) : 0)} scheduled`} />
      <Details><HistoryTable rows={rows} showScheduled={showScheduled} onEdit={onEdit} onDelete={onDelete} /></Details>
    </div>)}
  </div>;
}

export function RetirementPlanner({
  room, history, companyName, hasPlannerAccess, hasEmployerOpportunityAccess = true, hasCapacityAccess = true,
  onEditContribution, onDeleteContribution,
}: RetirementPlannerProps) {
  const { engine, engineProjected } = room;
  const projected = hasPlannerAccess ? engineProjected : null;
  const projectedById = new Map((projected?.plans ?? []).map((p) => [p.planId, p]));
  const view = (p: PlanOpportunity) => projectedById.get(p.planId) ?? p;
  const visibleHistory = hasPlannerAccess ? history : history.filter((r) => r.source !== "Planner");
  const rowsOf = (category: PlannerCategory) => visibleHistory.filter((r) => r.category === category);
  const nameOf = (cid: string | null) => cid ? companyName(cid) || "Unknown company" : "Unassigned";
  const primaryPlans = engine.plans.filter((p) => p.deferralBucket === "402g" && p.earner !== "spouse");
  const spousePlans = engine.plans.filter((p) => p.deferralBucket === "402g" && p.earner === "spouse");
  const spouseCompanyIds = new Set(spousePlans.map((p) => p.companyId));
  const employeeRows = rowsOf("employee");
  const employeeGroups = groupRowsByCompany(employeeRows.filter((r) => !spouseCompanyIds.has(r.companyId)));
  const spouseGroups = groupRowsByCompany(employeeRows.filter((r) => spouseCompanyIds.has(r.companyId)));
  const employerRows = visibleHistory.filter((r) => r.category === "w2_employer" || r.category === "self_employed_employer");
  const employerPlans = engine.plans.filter((p) => p.deferralBucket !== "governmental_457b");
  const companyIds = Array.from(new Set([...employerPlans.map((p) => p.companyId), ...employerRows.map((r) => r.companyId)]));
  const actualTotal = engine.plans.reduce((sum, p) => sum + p.totalAdditions, 0) + engine.ira.combinedContributed;
  const scheduledTotal = hasPlannerAccess ? room.scheduledEmployeeTotal + room.scheduledEmployerTotal + room.scheduledIraTotal : 0;
  const reviewNotes: string[] = [];
  if (engine.plans.some((p) => view(p).capacityUnverified)) reviewNotes.push("Business ownership relationships are missing; check the affected company's details.");
  if (room.k1ClassificationUnknownCompanyIds.length) reviewNotes.push("Set the K-1 tax treatment for affected partnerships in Settings.");
  if (room.ambiguousDuplicates.length) reviewNotes.push(`${room.ambiguousDuplicates.length} possible duplicate entries between paychecks and added contributions.`);
  if (visibleHistory.some((r) => r.category !== "ira" && !r.companyId)) reviewNotes.push("Some contributions aren't linked to a company.");
  const ira = engine.ira;
  const iraFuture = projected?.ira ?? ira;
  const otherBuckets = [
    engine.governmental457b && { title: "Governmental 457(b)", bucket: engine.governmental457b, future: projected?.governmental457b },
    engine.simple && { title: "SIMPLE", bucket: engine.simple, future: projected?.simple },
  ].filter(Boolean) as { title: string; bucket: { contributed: number; limit: number; remaining: number }; future?: { contributed: number; remaining: number } | null }[];
  const historyProps = { showScheduled: hasPlannerAccess, onEdit: onEditContribution, onDelete: onDeleteContribution };

  return <div className="space-y-3" data-testid="retirement-planner">
    <header className="space-y-1" data-testid="retirement-planner-summary">
      <div className="flex items-center gap-2"><PiggyBank className="h-4 w-4 text-primary" /><h3 className="text-base font-semibold">{engine.taxYear} Retirement</h3></div>
      <p className="text-xs text-muted-foreground">{fmt(actualTotal)} contributed · {fmt(scheduledTotal)} scheduled through Dec 31</p>
    </header>

    {(primaryPlans.length > 0 || employeeGroups.size > 0) && <section className="space-y-2 border-b pb-1" data-testid="planner-employee">
      <div className="flex items-center gap-1"><h4 className="font-semibold">Employee 401(k) — All Jobs</h4><InfoTooltip className="h-8 w-8 shrink-0" label="Shared employee limit">401(k), 403(b), TSP and Solo 401(k) employee deferrals share this limit across applicable jobs. {engine.employee402g.catchUp ? `Includes ${fmt(engine.employee402g.catchUp)} age-based catch-up. ` : ""}Remaining is after scheduled contributions through December 31; it is not a tax-saving amount.</InfoTooltip></div>
      {primaryPlans.length > 0 && <Meter actual={engine.employee402g.contributed} scheduled={Math.max(0, (projected?.employee402g.contributed ?? engine.employee402g.contributed) - engine.employee402g.contributed)} available={projected?.employee402g.remaining ?? engine.employee402g.remaining} limit={engine.employee402g.limit} label="Employee 401(k) — All Jobs" />}
      <Details label="Contributions by job"><JobHistory groups={employeeGroups} nameOf={nameOf} {...historyProps} /></Details>
    </section>}

    {companyIds.length > 0 && <section className="space-y-2" data-testid="planner-employer">
      <h4 className="font-semibold">Employer Contributions</h4>
      {companyIds.map((cid) => {
        const plans = employerPlans.filter((p) => p.companyId === cid);
        const views = plans.map(view);
        const selfEmployed = plans.some((p) => SELF_EMPLOYED.has(p.entityKind));
        const opportunity = selfEmployed ? businessPlannerOpportunity(room, cid, hasPlannerAccess) : null;
        const partnership = views.some((p) => p.entityKind === "partnership_k1");
        const rows = employerRows.filter((r) => r.companyId === cid);
        const actual = plans.length ? plans.reduce((sum, p) => sum + p.employerContribution, 0) : sumRows(rows, false);
        const future = views.reduce((sum, p) => sum + p.employerContribution, 0);
        const scheduled = hasPlannerAccess ? (plans.length ? Math.max(0, future - actual) : sumRows(rows, true)) : 0;
        const estimate = views.reduce((sum, p) => sum + p.estimatedEmployerContribution, 0);
        const w2Known = views.length > 0 && views.every((p) => p.employerCapacityRemaining != null && !p.capacityUnverified);
        const allowed = hasCapacityAccess && hasEmployerOpportunityAccess;
        const capacity = allowed ? selfEmployed ? opportunity?.employer ?? null : w2Known ? views.reduce((sum, p) => sum + (p.employerCapacityRemaining ?? 0), 0) : null : null;
        const conditional = allowed ? opportunity?.employerEstimate ?? null : null;
        const status = capacity == null ? "Plan details needed" : projected || !selfEmployed ? "Estimated" : "Calculated";
        const planLabel = Array.from(new Set(plans.map((p) => PLAN_LABELS[p.planKind] ?? p.planKind))).join(" / ") || "Plan unassigned";
        const reasons = Array.from(new Set(views.flatMap((p) => p.reasons))).map(retirementReasonMessage).filter(Boolean);
        return <article key={cid ?? "none"} className="rounded-md border bg-card px-3 pb-0 pt-2" data-testid="retirement-company-card">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h5 className="min-w-0 break-words text-sm font-semibold">{nameOf(cid)} <span className="font-normal text-muted-foreground">· {planLabel}</span></h5>
            <Badge variant="outline" className="text-[10px]">{status}</Badge>
          </div>
          <div className="mb-2 mt-1 flex items-center gap-1">
            <p className="text-xs">{partnership && conditional != null ? "Conditional employer estimate" : selfEmployed ? "Additional employer contribution room" : "Employer-funded room"}: <strong className="tabular-nums">{capacity != null ? fmt(capacity) : conditional != null ? fmt(conditional) : "Plan-dependent"}</strong></p>
            <InfoTooltip className="h-8 w-8 shrink-0" label={`${nameOf(cid)} employer contribution details`}>{partnership ? "This earnings-based estimate is not personally available contribution room. Partnership sponsorship and permission for additional contributions must be confirmed; a reduced partnership payout does not change the employer funding classification." : selfEmployed ? "Room uses canonical eligible earnings and employer limits after scheduled contributions. Shared employee room is reserved first; do not add independent employee and employer maxima." : "Employer match and profit-sharing are employer-funded, not extra money you can personally deposit. Saved formulas are estimates, not recorded contributions."}</InfoTooltip>
          </div>
          <Meter actual={actual} scheduled={scheduled} available={capacity} estimated={status === "Estimated"} unknownLabel={conditional != null ? "Plan-dependent" : allowed ? "Plan-dependent" : "—"} label={`${nameOf(cid)} employer contributions`} />
          <Details>
            {opportunity && <>
              <Line label="Projected net profit" value={opportunity.projectedProfit == null ? "Unknown" : fmt(opportunity.projectedProfit)} />
              <Line label="Adjusted eligible earnings so far" value={opportunity.actual.find((p) => p.eligibleCompensation != null)?.eligibleCompensation == null ? "Unknown" : fmt(opportunity.actual.find((p) => p.eligibleCompensation != null)?.eligibleCompensation ?? 0)} />
              {projected && <Line label="Adjusted projected eligible earnings" value={opportunity.plans.find((p) => p.eligibleCompensation != null)?.eligibleCompensation == null ? "Unknown" : fmt(opportunity.plans.find((p) => p.eligibleCompensation != null)?.eligibleCompensation ?? 0)} />}
              <p className="text-xs text-muted-foreground">Eligible earnings include active Planner income net of planned business expenses and canonical compensation adjustments. Related plans share their employer allowance.</p>
              {opportunity.missingDetails.map((detail) => <p key={detail} className="text-xs text-warning">{detail}</p>)}
              {opportunity.allocationNote && <p className="text-xs text-muted-foreground">{opportunity.allocationNote}</p>}
              {conditional != null && <p className="text-xs text-muted-foreground">Earnings-based estimate uses the standard 25% nominal / 20% adjusted self-employed formula. Not available room until partnership plan terms allow it.</p>}
            </>}
            {!selfEmployed && allowed && estimate > 0 && <Line label="Expected employer contribution from saved formula (not recorded)" value={fmt(estimate)} />}
            {!selfEmployed && <p className="text-xs text-muted-foreground">Employer-funded contributions do not use your employee deferral limit and are not an extra personal tax deduction.</p>}
            {plans.map((p) => <Line key={p.planId ?? p.planKind} label={PLAN_LABELS[p.planKind] ?? p.planKind} value={`${fmt(p.employerContribution)} employer recorded`} />)}
            {reasons.map((reason) => <p key={reason} className="text-xs text-muted-foreground">{reason}</p>)}
            <HistoryTable rows={rows} {...historyProps} />
          </Details>
        </article>;
      })}
    </section>}

    {engine.spouseEmployee402g && <section className="space-y-2 border-t pt-3" data-testid="planner-spouse">
      <h4 className="text-sm font-semibold">Spouse — Employee 401(k)</h4>
      <Meter actual={engine.spouseEmployee402g.contributed} scheduled={Math.max(0, (projected?.spouseEmployee402g?.contributed ?? engine.spouseEmployee402g.contributed) - engine.spouseEmployee402g.contributed)} available={projected?.spouseEmployee402g?.remaining ?? engine.spouseEmployee402g.remaining} limit={engine.spouseEmployee402g.limit} label="Spouse — separate employee limit" />
      <Details label="Contributions by job"><JobHistory groups={spouseGroups} nameOf={nameOf} {...historyProps} /></Details>
    </section>}
    {otherBuckets.map(({ title, bucket, future }) => <section key={title} className="space-y-2 border-t pt-3">
      <h4 className="text-sm font-semibold">{title} <InfoTooltip className="h-8 w-8" label={`${title} contribution limit`}>This plan retains its applicable separate limit; it is not extra shared 401(k) capacity. Recorded employee history remains under Contributions by job.</InfoTooltip></h4>
      <Meter actual={bucket.contributed} scheduled={Math.max(0, (future?.contributed ?? bucket.contributed) - bucket.contributed)} available={future?.remaining ?? bucket.remaining} limit={bucket.limit} label={title} />
    </section>)}

    <section className="space-y-2 border-t pt-3" data-testid="planner-ira">
      <div className="flex items-center gap-1"><h4 className="text-sm font-semibold">Traditional & Roth IRA</h4><InfoTooltip className="h-8 w-8" label="IRA eligibility and tax deductions">Traditional and Roth share a separate IRA contribution limit. Having room does not mean a Traditional IRA contribution is deductible; income and workplace coverage affect eligibility. Roth contributions are never deductible.</InfoTooltip></div>
      <Meter actual={ira.combinedContributed} scheduled={hasPlannerAccess ? room.scheduledIraTotal : 0} available={iraFuture.remainingContributionRoom} limit={ira.combinedLimit ?? ira.statutoryCombinedLimit} label="Separate IRA limit" unknownLabel="Unknown" />
      <Details>
        <Line label="Traditional IRA recorded" value={fmt(ira.traditionalContributed)} />
        <Line label="Roth IRA recorded" value={fmt(ira.rothContributed)} />
        <Line label="Recorded deductible amount" value={ira.deductibilityUnknown ? "Unknown" : fmt(ira.traditionalDeductible)} />
        <Line label="Additional deductible / nondeductible allocation" value="Needs income review" />
        {!ira.deductibilityUnknown && ira.traditionalNondeductible > 0 && <Line label="Recorded nondeductible amount" value={fmt(ira.traditionalNondeductible)} />}
        {Array.from(new Set(ira.reasons)).map(retirementReasonMessage).filter(Boolean).map((reason) => <p key={reason} className="text-xs text-muted-foreground">{reason}</p>)}
        <HistoryTable rows={rowsOf("ira")} {...historyProps} />
      </Details>
    </section>
    {reviewNotes.length > 0 && <div className="border-t pt-1" data-testid="retirement-reconcile-warning"><Details label="Needs review"><div className="space-y-2 text-xs text-warning">{reviewNotes.map((note) => <p key={note}>{note}</p>)}</div></Details></div>}
  </div>;
}
