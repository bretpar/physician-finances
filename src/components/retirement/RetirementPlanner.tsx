import { useMemo, type ReactNode } from "react";
import { ChevronDown, Pencil, PiggyBank, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InfoTooltip } from "@/components/ui/tooltip";
import type { RetirementRoomView } from "@/lib/retirementRoomView";
import type { PlanOpportunity } from "@/lib/retirementOpportunityEngine";
import { retirementReasonMessage } from "@/lib/retirementReasonMessages";
import { groupRowsByCompany, sumRows, type PlannerCategory, type PlannerHistoryRow } from "@/lib/retirementPlannerView";

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

function Section({ title, subtitle, children, testId }: { title: string; subtitle: string; children: ReactNode; testId: string }) {
  return (
    <Collapsible asChild>
      <Card data-testid={testId}>
        <CollapsibleTrigger className="group flex min-h-[56px] w-full items-center justify-between gap-3 p-4 text-left">
          <span className="min-w-0">
            <span className="block font-semibold">{title}</span>
            <span className="block text-xs text-muted-foreground">{subtitle}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 border-t p-4">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground"><span>{label}</span><span className="tabular-nums">{fmt(used)} of {fmt(limit)}</span></div>
      <Progress value={limit > 0 ? Math.min(100, (used / limit) * 100) : 0} className="mt-1 h-2" aria-label={label} />
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
        {r.possibleDuplicate && <Badge variant="outline" className="mt-1 border-warning/50 text-xs">May duplicate a paycheck entry</Badge>}
      </div>
      <div className="flex items-center gap-0.5">
        <span className="mr-1 font-semibold tabular-nums">{fmt(r.amount)}</span>
        {r.editableId && onEdit && <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => onEdit(r.editableId!)} aria-label="Edit contribution"><Pencil className="h-4 w-4" /></Button>}
        {r.editableId && onDelete && <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => onDelete(r.editableId!)} aria-label="Delete contribution"><Trash2 className="h-4 w-4" /></Button>}
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
  const employeeProjected = projected?.employee402g.remaining ?? null;

  // Self-employed (Solo 401(k)/SEP) employer plans, one card per company.
  const sePlans = engine.plans.filter((p) => SELF_EMPLOYED.has(p.entityKind));
  const w2Plans = engine.plans.filter((p) => !SELF_EMPLOYED.has(p.entityKind) && p.deferralBucket !== "governmental_457b");
  // Verified capacity: one value per employer group (shared limits never duplicated),
  // clipped to the group's remaining annual-additions headroom; unverified excluded.
  const { verifiedSeCapacity, needsVerification } = useMemo(() => {
    const byGroup = new Map<string, number>();
    let unverified = 0;
    for (const p of sePlans) {
      const v = projectedById.get(p.planId) ?? p;
      if (v.capacityUnverified) { unverified++; continue; }
      if (v.employerCapacityRemaining == null) continue;
      const cap = Math.max(0, Math.min(v.employerCapacityRemaining, v.additionsHeadroom ?? v.employerCapacityRemaining));
      const key = v.relatedGroupKey ?? v.employerGroupKey;
      byGroup.set(key, Math.max(byGroup.get(key) ?? 0, cap));
    }
    return { verifiedSeCapacity: Array.from(byGroup.values()).reduce((a, b) => a + b, 0), needsVerification: unverified };
  }, [sePlans, projectedById]);

  const reviewNotes: string[] = [];
  if (needsVerification > 0) reviewNotes.push(`${needsVerification} self-employed ${needsVerification === 1 ? "plan needs" : "plans need"} verification before employer room can be counted`);
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
  const seCompanyIds = Array.from(new Set([...sePlans.map((p) => p.companyId), ...seRows.map((r) => r.companyId)]));

  const ira = engine.ira;
  const iraLimit = ira.combinedLimit ?? ira.statutoryCombinedLimit;
  const iraScheduled = hasPlannerAccess ? room.scheduledIraTotal : 0;
  const otherBuckets = [
    engine.governmental457b && { title: "Governmental 457(b)", b: engine.governmental457b, note: "Separate limit from your 401(k)/403(b) limit." },
    engine.simple && { title: "SIMPLE", b: engine.simple, note: "SIMPLE plans have their own annual limit." },
  ].filter(Boolean) as { title: string; b: { contributed: number; limit: number; remaining: number }; note: string }[];

  return (
    <div className="space-y-3" data-testid="retirement-planner">
      <Card data-testid="retirement-planner-summary">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2"><PiggyBank className="h-5 w-5 text-primary" /><h3 className="text-lg font-semibold">{engine.taxYear} Retirement</h3></div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Stat label="Contributed so far" value={fmt(actualTotal)} hint="Recorded through today" testId="summary-actual" />
            <Stat label="Scheduled" value={hasPlannerAccess ? fmt(scheduledTotal) : "—"} hint={`From Planner through Dec 31`} testId="summary-scheduled" />
            <Stat label="Projected year-end" value={hasPlannerAccess ? fmt(actualTotal + scheduledTotal) : fmt(actualTotal)} testId="summary-projected" />
            {primaryPlans.length > 0 && <Stat label="Employee room today" value={fmt(employeeToday)} hint="401(k)/403(b)/TSP limit" testId="summary-employee-room" />}
            {primaryPlans.length > 0 && hasPlannerAccess && employeeProjected != null && <Stat label="Room after scheduled pay" value={fmt(employeeProjected)} hint="If Planner paychecks happen" testId="summary-employee-projected" />}
            {sePlans.length > 0 && <Stat label="Solo 401(k) employer room" value={hasCapacityAccess && hasEmployerOpportunityAccess ? fmt(verifiedSeCapacity) : "—"} hint={needsVerification > 0 ? "Verified only · some need review" : "Verified only"} testId="summary-se-capacity" />}
          </div>
          <p className="text-xs text-muted-foreground">
            Room is how much more you're allowed to put in — not a tax saving by itself. Employer contributions from a W-2 job and Roth or nondeductible IRA money don't reduce your taxes.
          </p>
          {reviewNotes.length > 0 && <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="retirement-reconcile-warning">Needs review: {reviewNotes.join("; ")}.</p>}
        </CardContent>
      </Card>

      {(primaryPlans.length > 0 || spousePlans.length > 0 || employeeRows.length > 0 || otherBuckets.length > 0) && (
        <Section testId="planner-employee" title="Employee 401(k) / 403(b) / TSP" subtitle={primaryPlans.length ? `${fmt(engine.employee402g.contributed)} of ${fmt(engine.employee402g.limit)} · ${fmt(employeeToday)} left` : "Your paycheck deferrals"}>
          {primaryPlans.length > 0 && <>
            <Meter used={engine.employee402g.contributed} limit={engine.employee402g.limit} label="Recorded so far" />
            {projected && <Meter used={projected.employee402g.contributed} limit={projected.employee402g.limit} label="Projected by Dec 31" />}
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
              <Meter used={engine.spouseEmployee402g.contributed} limit={engine.spouseEmployee402g.limit} label="Spouse recorded so far" />
              <p className="text-xs text-muted-foreground">Your spouse has a separate limit: {fmt(engine.spouseEmployee402g.remaining)} left today.</p>
              {Array.from(spouseGroups.entries()).map(([cid, rows]) => <CompanyCard key={cid ?? "none"} name={nameOf(cid)} rows={rows} showScheduled={hasPlannerAccess} onEdit={onEditContribution} onDelete={onDeleteContribution} />)}
            </div>
          )}
          {otherBuckets.map(({ title, b, note }) => (
            <div key={title} className="space-y-1 border-t pt-3"><p className="text-sm font-semibold">{title}</p><Meter used={b.contributed} limit={b.limit} label={note} /><p className="text-xs text-muted-foreground">{fmt(b.remaining)} left today.</p></div>
          ))}
        </Section>
      )}

      {w2CompanyIds.length > 0 && (
        <Section testId="planner-w2-employer" title="W-2 employer contributions" subtitle={`${fmt(sumRows(w2EmployerRows, false))} recorded from employers`}>
          <p className="text-xs text-muted-foreground">Matches and profit-sharing your employer adds. They don't use up your own employee limit, and they aren't an extra deduction on your personal return.</p>
          {w2CompanyIds.map((cid) => {
            const plans = w2Plans.filter((p) => p.companyId === cid);
            const estimate = plans.reduce((s, p) => s + p.estimatedEmployerContribution, 0);
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

      {seCompanyIds.length > 0 && (
        <Section testId="planner-self-employed" title="Solo 401(k) employer contributions" subtitle={hasCapacityAccess && hasEmployerOpportunityAccess ? `${fmt(sumRows(seRows, false))} recorded · ${fmt(verifiedSeCapacity)} verified room` : `${fmt(sumRows(seRows, false))} recorded`}>
          <p className="text-xs text-muted-foreground">As your own employer, your business can add a profit-sharing contribution based on its earnings. These usually lower your taxes. Room is shown only when PaycheckMD can confirm it.</p>
          {seCompanyIds.map((cid) => {
            const plans = sePlans.filter((p) => p.companyId === cid);
            const views = plans.map(view);
            const unverified = views.some((v) => v.capacityUnverified);
            const caps = views.filter((v) => !v.capacityUnverified && v.employerCapacityRemaining != null).map((v) => Math.max(0, Math.min(v.employerCapacityRemaining!, v.additionsHeadroom ?? v.employerCapacityRemaining!)));
            const cap = caps.length ? Math.max(...caps) : null; // shared at one business — shown once
            const actualEarnings = plans.find((p) => p.eligibleCompensation != null)?.eligibleCompensation ?? null;
            const projEarnings = views.find((v) => v.eligibleCompensation != null && projectedById.has(v.planId))?.eligibleCompensation ?? null;
            const reasons = Array.from(new Set(views.flatMap((v) => v.reasons))).map(retirementReasonMessage).filter(Boolean);
            return (
              <CompanyCard key={cid ?? "none"} name={nameOf(cid)} rows={seRows.filter((r) => r.companyId === cid)} showScheduled={hasPlannerAccess}
                flag={!cid ? "Not linked to a company" : unverified ? "Needs verification" : undefined}
                onEdit={onEditContribution} onDelete={onDeleteContribution}>
                <div className="space-y-1.5">
                  <Line muted label="Eligible earnings so far" value={actualEarnings == null ? "Unknown" : fmt(actualEarnings)} />
                  {projected && <Line muted label="Projected year-end earnings" value={projEarnings == null ? "Unknown" : fmt(projEarnings)} />}
                  {hasCapacityAccess && hasEmployerOpportunityAccess && <Line label={<>Remaining employer room <InfoTooltip>Counted only when your businesses' relationship is confirmed in Settings → Related businesses and the plan type is clear.</InfoTooltip></>} value={unverified ? "Needs verification" : cap == null ? "Unknown" : fmt(cap)} />}
                  {plans.length > 1 && plans.map((p) => <Line key={p.planId ?? p.planKind} muted label={`${PLAN_LABELS[p.planKind] ?? p.planKind} plan`} value={`${fmt(p.employerContribution)} employer · ${fmt(p.employeeContribution)} employee`} />)}
                  {reasons.length > 0 && <div className="space-y-1 text-xs text-muted-foreground">{reasons.map((m) => <p key={m}>{m}</p>)}</div>}
                </div>
              </CompanyCard>
            );
          })}
        </Section>
      )}

      <Section testId="planner-ira" title="Traditional IRA" subtitle={`${fmt(ira.combinedContributed)} of ${fmt(iraLimit)} · ${ira.remainingContributionRoom == null ? "room unknown" : `${fmt(ira.remainingContributionRoom)} left`}`}>
        <Meter used={ira.combinedContributed} limit={iraLimit} label="All IRAs (Traditional + Roth)" />
        <div className="space-y-1.5">
          <Line label="Traditional IRA recorded" value={fmt(ira.traditionalContributed)} />
          {ira.rothContributed > 0 && <Line muted label="Roth IRA recorded (never deductible)" value={fmt(ira.rothContributed)} />}
          {hasPlannerAccess && iraScheduled > 0 && <Line label="Scheduled rest of year" value={fmt(iraScheduled)} />}
          <Line label="Remaining room" value={ira.remainingContributionRoom == null ? "Unknown" : fmt(ira.remainingContributionRoom)} />
          <Line label="Deductible" value={ira.deductibilityUnknown ? "Not yet known" : fmt(ira.traditionalDeductible)} />
          {!ira.deductibilityUnknown && ira.traditionalNondeductible > 0 && <Line muted label="Nondeductible" value={fmt(ira.traditionalNondeductible)} />}
        </div>
        <p className="text-xs text-muted-foreground">Having IRA room doesn't mean the contribution is deductible. If you or your spouse have a workplace plan, your income decides how much (if any) you can deduct.</p>
        {ira.reasons.length > 0 && <div className="space-y-1 text-xs text-muted-foreground">{Array.from(new Set(ira.reasons)).map(retirementReasonMessage).filter(Boolean).map((m) => <p key={m}>{m}</p>)}</div>}
        {iraRows.length > 0 && <HistoryTable rows={iraRows} showScheduled={hasPlannerAccess} onEdit={onEditContribution} onDelete={onDeleteContribution} />}
      </Section>
    </div>
  );
}
