import { useMemo } from "react";
import { ChevronDown, Pencil, Trash2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  getAccountTypeLabel,
  getContributionTypeLabel,
  isIraPlan,
  type RetirementContribution,
} from "@/hooks/useRetirementContributions";

const fmt = (n: number) => n.toLocaleString("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface PaycheckContribution {
  id: string;
  income_date: string | null;
  name: string;
  company: string;
  retirement_401k?: number | null;
  employer_retirement_contribution?: number | null;
}

interface RetirementContributionDetailsProps {
  contributions: RetirementContribution[];
  paycheckEntries: PaycheckContribution[];
  companyName: (companyId: string | null) => string | null;
  annualAmount: (contribution: RetirementContribution) => number;
  onEdit: (contribution: RetirementContribution) => void;
  onDelete: (id: string) => void;
}

export function RetirementContributionDetails({
  contributions,
  paycheckEntries,
  companyName,
  annualAmount,
  onEdit,
  onDelete,
}: RetirementContributionDetailsProps) {
  const groups = useMemo(() => {
    const result = new Map<string, RetirementContribution[]>();
    for (const contribution of contributions) {
      const label = isIraPlan(contribution.account_type)
        ? getAccountTypeLabel(contribution.account_type)
        : `${companyName(contribution.company_id) || "Unassigned"} · ${getAccountTypeLabel(contribution.account_type)}`;
      result.set(label, [...(result.get(label) ?? []), contribution]);
    }
    return Array.from(result.entries());
  }, [companyName, contributions]);

  const count = contributions.length + paycheckEntries.length;

  return (
    <Collapsible asChild>
      <Card>
        <CollapsibleTrigger className="group flex min-h-[56px] w-full items-center justify-between gap-3 p-4 text-left">
          <span>
            <span className="block font-semibold">Contribution details</span>
            <span className="block text-xs text-muted-foreground">{count} {count === 1 ? "record" : "records"}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 border-t p-4">
            {count === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No retirement contributions yet.</p>}

            {groups.map(([label, rows]) => (
              <section key={label} className="space-y-2">
                <h5 className="text-xs font-semibold uppercase text-muted-foreground">{label}</h5>
                {rows.map((row) => (
                  <div key={row.id} className="flex items-start justify-between gap-3 border-b py-3 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{getAccountTypeLabel(row.account_type)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {getContributionTypeLabel(row.contribution_type)} · {row.frequency === "one_time" ? row.contribution_date : `${row.frequency.replace(/_/g, " ")} from ${row.start_date}`}
                      </p>
                      {row.frequency !== "one_time" && <p className="mt-1 text-xs text-muted-foreground">{fmt(Number(row.contribution_amount))} each · {fmt(annualAmount(row))} this year</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="mr-1 text-sm font-semibold tabular-nums">{fmt(row.frequency === "one_time" ? Number(row.contribution_amount) : annualAmount(row))}</span>
                      <Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => onEdit(row)} aria-label={`Edit ${getAccountTypeLabel(row.account_type)} contribution`}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-11 w-11 text-destructive" onClick={() => onDelete(row.id)} aria-label={`Delete ${getAccountTypeLabel(row.account_type)} contribution`}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </section>
            ))}

            {paycheckEntries.length > 0 && (
              <section className="space-y-2">
                <h5 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground"><Wallet className="h-3.5 w-3.5" /> Paycheck contributions</h5>
                {paycheckEntries.map((entry) => {
                  const employee = Number(entry.retirement_401k || 0);
                  const employer = Number(entry.employer_retirement_contribution || 0);
                  return <div key={entry.id} className="flex items-start justify-between gap-3 border-b py-3 last:border-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{entry.company || entry.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{entry.income_date} · Employee {fmt(employee)}{employer > 0 ? ` · Employer ${fmt(employer)}` : ""}</p><Badge variant="outline" className="mt-1">Recorded with paycheck</Badge></div><span className="shrink-0 text-sm font-semibold tabular-nums">{fmt(employee + employer)}</span></div>;
                })}
              </section>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}