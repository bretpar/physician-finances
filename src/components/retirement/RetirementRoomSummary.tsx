import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PiggyBank, Lock, Info, TrendingUp, AlertTriangle } from "lucide-react";
import type { EmployeeRoomSummary, PlanCapacity } from "@/lib/retirementContributionRoom";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const PLAN_TYPE_LABELS: Record<string, string> = {
  w2: "W-2 employer plan",
  "1099_schedule_c": "Self-employed plan",
  k1: "Partnership / K-1 plan",
  s_corp: "S-corp plan",
};

const planTypeLabel = (t?: string | null) => (t ? PLAN_TYPE_LABELS[t] ?? null : null);

export interface RetirementRoomSummaryProps {
  taxYear: number;
  employeeRoom: EmployeeRoomSummary;
  employerContributionTotal: number;
  plans: PlanCapacity[];
  /** Centralized Income Planner access (scenarioPlanner). */
  hasPlannerAccess: boolean;
}

export function RetirementRoomSummary({
  taxYear,
  employeeRoom,
  employerContributionTotal,
  plans,
  hasPlannerAccess,
}: RetirementRoomSummaryProps) {
  const [basis, setBasis] = useState<"ytd" | "projected">("ytd");
  const projected = hasPlannerAccess && basis === "projected";

  const overLimitBy = Math.max(
    0,
    employeeRoom.employeeContributionTotal - employeeRoom.employeeDeferralLimit,
  );

  // Extra capacity that projected income could unlock, using only plans where
  // both figures are computable. Read-only comparison of validated values.
  const projectedUpside = plans.reduce((sum, p) => {
    if (p.planProjectedCapacity == null || p.planCurrentCapacity == null) return sum;
    return sum + Math.max(0, p.planProjectedCapacity - p.planCurrentCapacity);
  }, 0);

  return (
    <Card data-testid="retirement-room-summary">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <PiggyBank className="h-4 w-4" /> {taxYear} Retirement Contribution Room
          </CardTitle>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                aria-label="How contribution room works"
              >
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 text-xs space-y-2">
              <p>
                Employee elective-deferral room generally follows you as an individual across all
                applicable plans — one shared annual limit.
              </p>
              <p>
                Employer / plan capacity depends on each specific company: compensation, plan type,
                and business structure. Capacity is not transferable between plans.
              </p>
              <p>Projected capacity uses your Income Planner estimates and is not a guarantee.</p>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Employee — primary */}
        <div data-testid="employee-room">
          <p className="text-xs text-muted-foreground">Employee contributions</p>
          <p className="text-3xl font-bold tabular-nums">
            {fmt(employeeRoom.employeeContributionTotal)}{" "}
            <span className="text-base font-normal text-muted-foreground">
              of {fmt(employeeRoom.employeeDeferralLimit)}
            </span>
          </p>
          <Progress value={employeeRoom.employeeUsedFraction * 100} className="mt-2 h-2" />
          <p className="mt-1.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {fmt(employeeRoom.employeeRemainingRoom)}
            </span>{" "}
            remaining
          </p>
          {overLimitBy > 0 && (
            <p
              data-testid="employee-over-limit"
              className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Employee contributions exceed the current annual limit by {fmt(overLimitBy)}.
            </p>
          )}
        </div>

        {/* Basis toggle */}
        {hasPlannerAccess ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Based on:</span>
            <div className="inline-flex rounded-md border p-0.5">
              <Button
                size="sm"
                variant={basis === "ytd" ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setBasis("ytd")}
              >
                Current YTD
              </Button>
              <Button
                size="sm"
                variant={basis === "projected" ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setBasis("projected")}
              >
                Projected year end
              </Button>
            </div>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            See how future income could change your retirement contribution room with Income Planner.
          </p>
        )}

        {/* Projected opportunity insight */}
        {hasPlannerAccess && projectedUpside > 0 && (
          <div
            data-testid="projected-opportunity"
            className="rounded-lg border bg-muted/40 p-3 text-sm"
          >
            <p className="flex items-center gap-1.5 font-medium">
              <TrendingUp className="h-3.5 w-3.5" /> Projected opportunity
            </p>
            <p className="mt-1 text-muted-foreground">
              Based on your planned income, you may have approximately{" "}
              <span className="font-medium text-foreground tabular-nums">
                {fmt(projectedUpside)}
              </span>{" "}
              more contribution capacity by year end. This is an estimate.
            </p>
          </div>
        )}

        {/* Employer total */}
        <div>
          <p className="text-xs text-muted-foreground">Employer contributions</p>
          <p className="text-2xl font-bold tabular-nums">{fmt(employerContributionTotal)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Counts toward plan limits — not a personal deduction
          </p>
        </div>

        {/* Per company / plan cards */}
        {plans.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Capacity by company / plan</p>
            {plans.map((p) => {
              const label = planTypeLabel(p.planType);
              const capacity = projected ? p.planProjectedCapacity : p.planCurrentCapacity;
              return (
                <div
                  key={p.companyId || p.companyName}
                  data-testid="plan-capacity-card"
                  className="rounded-lg border p-3"
                >
                  <p className="truncate text-sm font-medium">{p.companyName}</p>
                  {label && <p className="text-xs text-muted-foreground">{label}</p>}

                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-muted-foreground">Employee contributions</dt>
                      <dd className="tabular-nums">{fmt(p.employeeContribution)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-muted-foreground">Employer contributions</dt>
                      <dd className="tabular-nums">{fmt(p.employerContribution)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t pt-1">
                      <dt className="text-muted-foreground">Total contributed</dt>
                      <dd className="font-medium tabular-nums">{fmt(p.planContributionTotal)}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <dt className="text-muted-foreground">
                        {projected ? "Projected year-end capacity" : "Current available capacity"}
                      </dt>
                      <dd className="text-right">
                        {capacity == null ? (
                          <span className="text-xs text-muted-foreground">
                            Contribution capacity unavailable
                          </span>
                        ) : (
                          <span className="font-medium tabular-nums">{fmt(capacity)}</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {capacity == null && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      More plan or compensation information is needed to estimate this limit.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Final limits can depend on plan type, compensation, business structure, and plan rules.
          Capacity is calculated per plan and cannot be moved between plans.
        </p>
      </CardContent>
    </Card>
  );
}
