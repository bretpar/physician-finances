import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { PiggyBank, Lock } from "lucide-react";
import type { EmployeeRoomSummary, PlanCapacity } from "@/lib/retirementContributionRoom";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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

  return (
    <Card data-testid="retirement-room-summary">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PiggyBank className="h-4 w-4" /> {taxYear} Retirement Contribution Room
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Employee contributions</p>
            <p className="text-2xl font-bold tabular-nums">
              {fmt(employeeRoom.employeeContributionTotal)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {fmt(employeeRoom.employeeDeferralLimit)}
              </span>
            </p>
            <Progress value={employeeRoom.employeeUsedFraction * 100} className="mt-2 h-1.5" />
            <p className="mt-1 text-xs text-muted-foreground">
              {fmt(employeeRoom.employeeRemainingRoom)} remaining
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Employer contributions</p>
            <p className="text-2xl font-bold tabular-nums">{fmt(employerContributionTotal)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Counts toward plan limits — not a personal deduction
            </p>
          </div>
        </div>

        {hasPlannerAccess ? (
          <div className="flex items-center gap-2">
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
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Projected year-end capacity uses Income Planner.
          </p>
        )}

        {plans.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="py-1 text-left font-normal">Company / Plan</th>
                  <th className="py-1 text-right font-normal">Employee</th>
                  <th className="py-1 text-right font-normal">Employer</th>
                  <th className="py-1 text-right font-normal">Total</th>
                  <th className="py-1 text-right font-normal">
                    {projected ? "Projected capacity" : "Remaining capacity"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const capacity = projected ? p.planProjectedCapacity : p.planCurrentCapacity;
                  return (
                    <tr key={p.companyId || p.companyName} className="border-t">
                      <td className="py-1.5 pr-2">
                        <span className="block truncate">{p.companyName}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(p.employeeContribution)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(p.employerContribution)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {fmt(p.planContributionTotal)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {capacity == null ? (
                          <span className="text-xs text-muted-foreground">Not enough data</span>
                        ) : (
                          fmt(capacity)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {projected ? "Projected contribution room is an estimate based on your current income and Income Planner. " : ""}
          Final limits can depend on plan type, compensation, business structure, and plan rules.
          Capacity is calculated per plan and cannot be moved between plans.
        </p>
      </CardContent>
    </Card>
  );
}
