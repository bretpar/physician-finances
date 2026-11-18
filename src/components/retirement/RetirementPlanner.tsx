import { useMemo, type ReactNode } from "react";
import { ChevronDown, Pencil, PiggyBank, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InfoTooltip } from "@/components/ui/tooltip";
import { computeRetirementHeadline, type RetirementRoomView } from "@/lib/retirementRoomView";
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

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums sm:text-xl">{value}</p>
      {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, subtitle, children, testId, overview }: { title: string; subtitle: string; children: ReactNode; testId: string; overview?: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border py-4" data-testid={testId}>
      <div><h4 className="font-semibold">{title}</h4><p className="text-xs text-muted-foreground">{subtitle}</p></div>
      {overview}
      <Collapsible>
        <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="group gap-2 px-0">Details & history <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">{children}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function Meter({ actual, scheduled = 0, available, label, limit, unknownLabel = "Needs one detail" }: { actual: number; scheduled?: number; available: number | null; label: string; limit?: number | null; unknownLabel?: string }) {
  const values = [Math.max(0, actual), Math.max(0, scheduled), Math.max(0, available ?? 0)];
  const total = values.reduce((s, n) => s + n, 0);
  const labels = ["Contributed", "Scheduled", "Available"];
  const colors = ["bg-primary", "bg-warning", "bg-success"];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1 text-xs"><span className="font-medium">{label}</span>{limit != null && <span className="text-muted-foreground">Annual limit {fmt(limit)}</span>}</div>
      {available != null && <div className="flex h-3 w-full overflow-hidden rounded-sm bg-muted" role="img" aria-label={`${label}: contributed ${fmt(actual)}, scheduled ${fmt(scheduled)}, available ${fmt(available)}`}>
        {total > 0 && values.map((n, i) => n > 0 && <span key={labels[i]} className={colors[i]} style={{ width: `${n / total * 100}%` }} />)}
      </div>}
      <div className="grid grid-cols-3 gap-2">
        {labels.map((text, i) => <div key={text} className="min-w-0"><p className="flex items-center gap-1 text-[11px] text-muted-foreground"><span className={`h-2 w-2 shrink-0 rounded-sm ${colors[i]}`} />{text}</p><p className="text-sm font-semibold tabular-nums">{i === 2 && available == null ? unknownLabel : fmt(values[i])}</p></div>)}
      </div>
    </div>
  );
}

function Line({ label, value, muted }: { label: ReactNode; value: ReactNode; muted?: boolean }) {
  return <div className="flex items-start justify-between gap-3 text-sm"><span className={muted ? "text-muted-foreground" : ""}>{label}</span><span className="shrink-0 text-right font-medium tabular-nums">{value}</span></div>;
}

function HistoryTable({ rows, showScheduled, onEdit, onDelete }: { rows: PlannerHistoryRow[]; showScheduled: boolean; onEdit?: (id: string) => void; onDelete?: (id: string) => void }) {
  const actual = rows.filter((r) => !r.scheduled);
  const scheduled = showScheduled ? rows.filter((r) => r.scheduled) : [];
  const renderRows = (list: PlannerHistoryRow[]) => list.map((r) => (
    <div key={r.key} className="grid grid-cols-[1fr_auto] gap-2 border-b py-2 text-sm last:border-0" data-testid="retirement-history-row">
      <div className="min-w-0">
        <p className="font-medium">{r.recurringLabel ? (r.scheduled ? "Rest of year" : "Through today") : (r.date ?? "No date")}</p>
        <p className="text-xs text-muted-foreground">
          {r.funding} · {r.source === "Planner" ? "Planner paycheck" : r.source}{r.accountLabel ? ` · ${r.accountLabel}` : ""}{r.recurringLabel ? ` · repeating ${r.recurringLabel}` : ""}
        </p>
        {r.reviewNote && <p className="mt-1 text-xs text-warning" data-testid="retirement-history-review">{r.reviewNote}</p>}
        {r.possibleDuplicate && <Badge variant="outline" className="mt-1 border-warning/50 text-xs">May duplicate a paycheck entry</Badge>}
      </div>
      <div className="flex items-center gap-0.5">
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

function CompanyCard({ name, detail, rows, children, showScheduled, onEdit, onDelete, flag }: {
  name: string; detail?: string; rows: PlannerHistoryRow[]; children?: ReactNode; showScheduled: boolean;
  onEdit?: (id: string) => void; onDelete?: (id: string) => void; flag?: string;
}) {
  const actual = sumRows(rows, false);
  const scheduled = showScheduled ? sumRows(rows, true) : 0;
  return (
    <Collapsible asChild>
      <div className="rounded-md border" data-testid="retirement-company-card">
        <CollapsibleTrigger className="group flex min-h-[48px] w-full items-center justify-between gap-3 p-3 text-left">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="block text-xs text-muted-foreground">
              {fmt(actual)} recorded{scheduled > 0 ? ` · ${fmt(scheduled)} scheduled` : ""}{detail ? ` · ${detail}` : ""}
            </span>
            {flag && <Badge variant="outline" className="mt-1 border-warning/50 text-xs">{flag}</Badge>}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t p-3">
          {children}
          <HistoryTable rows={rows} showScheduled={showScheduled} onEdit={onEdit} onDelete={onDelete} />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function RetirementPlanner({
  room, history, companyName, hasPlannerAccess, hasEmployerOpportunityAccess = true, hasCapacityAccess = true,
  onEditContribution, onDeleteContribution,
}: RetirementPlannerProps) {
  const { engine, engineProjected } = room;
  const projected = hasPlannerAccess ? engineProjected : null;
  const projectedById = useMemo(() => new Map((projected?.plans ?? []).map((p) => [p.planId, p])), [projected]);
  const view = (p: PlanOpportunity) => projectedById.get(p.planId) ?? p;
  const visibleHistory = hasPlannerAccess ? history : history.filter((r) => r.source !== "Planner");
  const rowsOf = (c: PlannerCategory) => visibleHistory.filter((r) => r.category === c);
  const nameOf = (cid: string | null) => (cid ? companyName(cid) || "Unknown company" : "Unassigned");

  // Summary — every number comes from the canonical engine.
  const actualTotal = engine.plans.reduce((s, p) => s + p.totalAdditions, 0) + engine.ira.combinedContributed;
  const scheduledTotal = hasPlannerAccess ? room.scheduledEmployeeTotal + room.scheduledEmployerTotal + room.scheduledIraTotal : 0;
  const primaryPlans = engine.plans.filter((p) => p.deferralBucket === "402g" && p.earner !== "spouse");
  const spousePlans = engine.plans.filter((p) => p.deferralBucket === "402g" && p.earner === "spouse");
  const employeeToday = engine.employee402g.remaining;
  const employeeProjected = projected?.employee402g.remaining ?? employeeToday;

  // Self-employed (Solo 401(k)/SEP) employer plans, one card per company.
  const sePlans = engine.plans.filter((p) => SELF_EMPLOYED.has(p.entityKind));
  const w2Plans = engine.plans.filter((p) => !SELF_EMPLOYED.has(p.entityKind) && p.deferralBucket !== "governmental_457b");
  // Verified capacity: one value per employer group (shared limits never duplicated),
  // clipped to the group's remaining annual-additions headroom; unverified excluded.
  const verifiedSeCapacity = useMemo(() => {
    const eligibleCompanies = new Set(sePlans.map((p) => p.companyId).filter((cid) => businessPlannerOpportunity(room, cid, hasPlannerAccess).verified));
    const actual = { ...engine, plans: sePlans.filter((p) => eligibleCompanies.has(p.companyId)) };
    const future = projected ? { ...projected, plans: projected.plans.filter((p) => eligibleCompanies.has(p.companyId)) } : null;
    return computeRetirementHeadline(actual, future).employerVerified;
  }, [engine, projected, sePlans, room, hasPlannerAccess]);
  const needsVerification = sePlans.filter((p) => view(p).capacityUnverified).length;

  const reviewNotes: string[] = [];
  if (needsVerification > 0) reviewNotes.push("business ownership relationships are missing; see the affected business below");
  if (room.k1ClassificationUnknownCompanyIds.length) reviewNotes.push(`set the K-1 tax treatment for ${room.k1ClassificationUnknownCompanyIds.length} partnership(s) in Settings`);
  if (room.ambiguousDuplicates.length) reviewNotes.push(`${room.ambiguousDuplicates.length} possible duplicate ${room.ambiguousDuplicates.length === 1 ? "entry" : "entries"} between paychecks and added contributions`);
  const unassigned = visibleHistory.filter((r) => r.category !== "ira" && !r.companyId).length;
  if (unassigned) reviewNotes.push(`${unassigned} contribution${unassigned === 1 ? " isn't" : "s aren't"} linked to a company`);

  const employeeRows = rowsOf("employee");
  const w2EmployerRows = rowsOf("w2_employer");
  const seRows = rowsOf("self_employed_employer");
  const iraRows = rowsOf("ira");
  const spouseCompanyIds = new Set(spousePlans.map((p) => p.companyId));
  const employeeGroups = groupRowsByCompany(employeeRows.filter((r) => !spouseCompanyIds.has(r.companyId)));
  const spouseGroups = groupRowsByCompany(employeeRows.filter((r) => spouseCompanyIds.has(r.companyId)));

  // W-2 employers: plans + any employer rows, grouped by company id.
  const w2CompanyIds = Array.from(new Set([...w2Plans.filter((p) => p.employerContribution > 0 || p.estimatedEmployerContribution > 0).map((p) => p.companyId), ...w2EmployerRows.map((r) => r.companyId)]));
  const seCompanyIds = Array.from(new Set([...sePlans.filter((p) => p.totalAdditions > 0 || (view(p).employerCapacityRemaining ?? 0) > 0 || view(p).capacityUnverified || (p.companyId != null && room.k1ClassificationUnknownCompanyIds.includes(p.companyId))).map((p) => p.companyId), ...seRows.map((r) => r.companyId)]));

  const ira = engine.ira;
  const iraLimit = ira.combinedLimit ?? ira.statutoryCombinedLimit;
  const iraScheduled = hasPlannerAccess ? room.scheduledIraTotal : 0;
  const iraFuture = projected?.ira ?? ira;
  const otherBuckets = [
    engine.governmental457b && { title: "Governmental 457(b)", b: engine.governmental457b, note: "Separate limit from your 401(k)/403(b) limit." },
    engine.simple && { title: "SIMPLE", b: engine.simple, note: "SIMPLE plans have their own annual limit." },
  ].filter(Boolean) as { title: string; b: { contributed: number; limit: number; remaining: number }; note: string }[];

  return (
    <div className="space-y-3" data-testid="retirement-planner">
      <div className="space-y-4 pb-2" data-testid="retirement-planner-summary">
        <div className="flex items-center gap-2"><PiggyBank className="h-5 w-5 text-primary" /><h3 className="text-lg font-semibold">{engine.taxYear} Retirement Contribution Calculator</h3></div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {(primaryPlans.length > 0 || spousePlans.length > 0) && <Stat label={primaryPlans.length ? "Employee room after scheduled pay" : "Spouse employee room after scheduled pay"} value={fmt(primaryPlans.length ? employeeProjected : (projected ?? engine).spouseEmployee402g?.remaining ?? 0)} hint="Shared across applicable jobs" testId="summary-employee-projected" />}
          {sePlans.length > 0 && <Stat label="Additional business employer room" value={hasCapacityAccess && hasEmployerOpportunityAccess ? fmt(verifiedSeCapacity) : "—"} hint="Supported plans only; shared employee room reserved first" testId="summary-se-capacity" />}
          <Stat label="IRA contribution room" value={iraFuture.remainingContributionRoom == null ? "Unknown" : fmt(iraFuture.remainingContributionRoom)} hint="Deduction depends on eligibility" />
        </div>
        <p className="text-xs text-muted-foreground">{fmt(actualTotal)} contributed · {fmt(scheduledTotal)} scheduled through Dec 31. Contribution room is not a tax-saving amount.</p>
        {reviewNotes.length > 0 && <p className="border-l-2 border-warning pl-3 text-xs" data-testid="retirement-reconcile-warning">Needs review: {reviewNotes.join("; ")}.</p>}
      </div>

      {(primaryPlans.length > 0 || spousePlans.length > 0 || employeeRows.length > 0 || otherBuckets.length > 0) && (
        <Section testId="planner-employee" title="Employee 401(k) / 403(b) / TSP" subtitle={primaryPlans.length ? `${fmt(employeeToday)} room today · one shared employee limit` : "Your paycheck deferrals"}
          overview={primaryPlans.length > 0 ? <Meter actual={engine.employee402g.contributed} scheduled={Math.max(0, (projected?.employee402g.contributed ?? engine.employee402g.contributed) - engine.employee402g.contributed)} available={employeeProjected} limit={engine.employee402g.limit} label="All your applicable jobs" /> : undefined}>
          {primaryPlans.length > 0 && <>
            <p className="text-xs text-muted-foreground">
              Everything you put in from your own paychecks — at every job, including a Solo 401(k) — shares one yearly limit.{engine.employee402g.catchUp ? ` Includes ${fmt(engine.employee402g.catchUp)} age-based catch-up.` : ""} Pre-tax amounts lower your taxable income; Roth amounts don't.
            </p>
          </>}
          <div className="space-y-2">
            {Array.from(employeeGroups.entries()).map(([cid, rows]) => (
              <CompanyCard key={cid ?? "none"} name={nameOf(cid)} rows={rows} showScheduled={hasPlannerAccess} onEdit={onEditContribution} onDelete={onDeleteContribution} flag={cid ? undefined : "Not linked to a company"} />
            ))}
          </div>
          {engine.spouseEmployee402g && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-semibold">Spouse</p>
              <Meter actual={engine.spouseEmployee402g.contributed} scheduled={Math.max(0, (projected?.spouseEmployee402g?.contributed ?? engine.spouseEmployee402g.contributed) - engine.spouseEmployee402g.contributed)} available={projected?.spouseEmployee402g?.remaining ?? engine.spouseEmployee402g.remaining} limit={engine.spouseEmployee402g.limit} label="Spouse — separate limit" />
              <p className="text-xs text-muted-foreground">Your spouse has a separate limit: {fmt(engine.spouseEmployee402g.remaining)} left today.</p>
              {Array.from(spouseGroups.entries()).map(([cid, rows]) => <CompanyCard key={cid ?? "none"} name={nameOf(cid)} rows={rows} showScheduled={hasPlannerAccess} onEdit={onEditContribution} onDelete={onDeleteContribution} />)}
            </div>
          )}
          {otherBuckets.map(({ title, b, note }) => (
            <div key={title} className="space-y-1 border-t pt-3"><p className="text-sm font-semibold">{title}</p><Meter actual={b.contributed} scheduled={Math.max(0, ((title === "SIMPLE" ? projected?.simple : projected?.governmental457b)?.contributed ?? b.contributed) - b.contributed)} available={(title === "SIMPLE" ? projected?.simple : projected?.governmental457b)?.remaining ?? b.remaining} limit={b.limit} label={note} /><p className="text-xs text-muted-foreground">{fmt(b.remaining)} left today.</p></div>
          ))}
        </Section>
      )}

      {seCompanyIds.length > 0 && (
        <section className="space-y-4 border-t border-border py-4" data-testid="planner-self-employed">
          <div><h4 className="font-semibold">Solo 401(k) & business plans</h4><p className="text-xs text-muted-foreground">Year-end room after scheduled contributions across all jobs</p></div>
          {seCompanyIds.map((cid) => {
            const opportunity = businessPlannerOpportunity(room, cid, hasPlannerAccess);
            const { actual: plans, plans: views } = opportunity;
            const employee = plans.reduce((s, p) => s + p.employeeDeferralCounted, 0);
            const employer = plans.reduce((s, p) => s + p.employerContribution, 0);
            const futureEmployee = views.reduce((s, p) => s + p.employeeDeferralCounted, 0);
            const futureEmployer = views.reduce((s, p) => s + p.employerContribution, 0);
            const actualEarnings = plans.find((p) => p.eligibleCompensation != null)?.eligibleCompensation ?? null;
            const futureEarnings = views.find((p) => p.eligibleCompensation != null)?.eligibleCompensation ?? null;
            const cap = hasCapacityAccess && hasEmployerOpportunityAccess ? opportunity.employer : null;
            const reasons = Array.from(new Set(views.flatMap((p) => p.reasons))).map(retirementReasonMessage).filter(Boolean);
            const partnership = views.some((p) => p.entityKind === "partnership_k1");
            const businessRows = [...employeeRows, ...seRows].filter((r) => r.companyId === cid);
            return <div key={cid ?? "none"} className="space-y-3 rounded-md border border-border bg-card p-3" data-testid="solo-business-result">
              <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-semibold">{nameOf(cid)}</h5><Badge variant="outline">{opportunity.status}</Badge></div>
              <Line label="Projected net profit" value={opportunity.projectedProfit == null ? "Not available" : fmt(opportunity.projectedProfit)} />
              <p className="text-xs text-muted-foreground">{partnership ? "Partnership plan" : views.some((p) => p.planKind === "solo_401k") ? "Solo 401(k) / business plans" : "Business plan"}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Meter actual={employee} scheduled={Math.max(0, futureEmployee - employee)} available={hasCapacityAccess ? opportunity.employee : null} label="Employee — additional possible" />
                <Meter actual={employer} scheduled={Math.max(0, futureEmployer - employer)} available={cap} label="Employer — additional room" />
              </div>
              {cap != null && <p className="text-sm font-semibold">You may be able to contribute an additional {fmt(cap)} as employer.</p>}
              <p className="text-xs text-muted-foreground">Any additional employee contribution uses the shared remaining limit shown above, not a new allowance. Employer room reserves that employee room first; don't add separate account maxima together.</p>
              {opportunity.missingDetails.map((detail) => <p key={detail} className="text-xs text-warning">{detail.replace("this business", nameOf(cid)).replace("the retirement plan", `${nameOf(cid)}'s retirement plan`)}</p>)}
              {partnership && hasCapacityAccess && hasEmployerOpportunityAccess && opportunity.employerEstimate != null && <p className="text-xs text-muted-foreground">Earnings-based employer estimate: {fmt(opportunity.employerEstimate)} using the standard 25% nominal / 20% adjusted self-employed formula, after recorded and scheduled contributions and shared employee room. Not available contribution room until partnership plan terms allow it.</p>}
              <Collapsible>
                <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="group gap-2 px-0">Earnings, plan details & history <ChevronDown className="h-4 w-4 group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <Line muted label="Adjusted eligible earnings so far" value={actualEarnings == null ? "Unknown" : fmt(actualEarnings)} />
                  {projected && <Line muted label="Adjusted projected year-end earnings" value={futureEarnings == null ? "Unknown" : fmt(futureEarnings)} />}
                  <p className="text-xs text-muted-foreground">Earnings include eligible active Planner income, net of planned business expenses and the retirement engine's compensation adjustments. Employer room reserves shared employee capacity first; related plans never receive a duplicate employer allowance.</p>
                  {plans.map((p) => <Line key={p.planId ?? p.planKind} muted label={PLAN_LABELS[p.planKind] ?? p.planKind} value={`${fmt(p.employeeContribution)} employee · ${fmt(p.employerContribution)} employer`} />)}
                  {opportunity.allocationNote && <p className="text-xs text-muted-foreground">{opportunity.allocationNote}</p>}
                  {reasons.map((m) => <p key={m} className="text-xs text-muted-foreground">{m}</p>)}
                  <HistoryTable rows={businessRows} showScheduled={hasPlannerAccess} onEdit={onEditContribution} onDelete={onDeleteContribution} />
                </CollapsibleContent>
              </Collapsible>
            </div>;
          })}
        </section>
      )}

      {w2CompanyIds.length > 0 && (
        <Section testId="planner-w2-employer" title="W-2 employer contributions" subtitle="Employer-funded money · not personally available contribution room"
          overview={<Meter actual={sumRows(w2EmployerRows, false)} scheduled={hasPlannerAccess ? sumRows(w2EmployerRows, true) : 0} available={null} unknownLabel="Plan-dependent" label="Employer-funded contributions" />}>
          <p className="text-xs text-muted-foreground">Matches and profit-sharing your employer adds. They don't use up your own employee limit, and they aren't an extra deduction on your personal return.</p>
          {w2CompanyIds.map((cid) => {
            const plans = w2Plans.filter((p) => p.companyId === cid);
            const estimate = plans.reduce((s, p) => s + view(p).estimatedEmployerContribution, 0);
            const known = plans.some((p) => view(p).employerCapacityRemaining != null);
            return (
              <CompanyCard key={cid ?? "none"} name={nameOf(cid)} rows={w2EmployerRows.filter((r) => r.companyId === cid)} showScheduled={hasPlannerAccess}
                detail={!hasEmployerOpportunityAccess ? undefined : estimate > 0 ? `est. ${fmt(estimate)} from your saved formula` : known ? undefined : "Depends on employer plan"}
                onEdit={onEditContribution} onDelete={onDeleteContribution} flag={cid ? undefined : "Not linked to a company"}>
                {plans.length > 1 && plans.map((p) => <Line key={p.planId ?? p.planKind} muted label={PLAN_LABELS[p.planKind] ?? p.planKind} value={`${fmt(p.employerContribution)} employer`} />)}
              </CompanyCard>
            );
          })}
        </Section>
      )}

      <Section testId="planner-ira" title="Traditional IRA" subtitle="Contribution capacity and tax deduction are separate"
        overview={<Meter actual={ira.combinedContributed} scheduled={iraScheduled} available={iraFuture.remainingContributionRoom} limit={iraLimit} label="Shared Traditional + Roth IRA limit" />}>
        <div className="space-y-1.5">
          <Line label="Traditional IRA recorded" value={fmt(ira.traditionalContributed)} />
          {ira.rothContributed > 0 && <Line muted label="Roth IRA recorded (never deductible)" value={fmt(ira.rothContributed)} />}
          {hasPlannerAccess && iraScheduled > 0 && <Line label="Scheduled rest of year" value={fmt(iraScheduled)} />}
          <Line label="Remaining room" value={iraFuture.remainingContributionRoom == null ? "Unknown" : fmt(iraFuture.remainingContributionRoom)} />
          <Line label="Current-year recorded deductible amount" value={ira.deductibilityUnknown ? "Not yet known" : fmt(ira.traditionalDeductible)} />
          <Line muted label="Additional deductible / nondeductible allocation" value="Needs income review" />
          {!ira.deductibilityUnknown && ira.traditionalNondeductible > 0 && <Line muted label="Recorded nondeductible amount" value={fmt(ira.traditionalNondeductible)} />}
        </div>
        <p className="text-xs text-muted-foreground">Having IRA room doesn't mean the contribution is deductible. If you or your spouse have a workplace plan, your income decides how much (if any) you can deduct.</p>
        {ira.reasons.length > 0 && <div className="space-y-1 text-xs text-muted-foreground">{Array.from(new Set(ira.reasons)).map(retirementReasonMessage).filter(Boolean).map((m) => <p key={m}>{m}</p>)}</div>}
        {iraRows.length > 0 && <HistoryTable rows={iraRows} showScheduled={hasPlannerAccess} onEdit={onEditContribution} onDelete={onDeleteContribution} />}
      </Section>
    </div>
  );
}
