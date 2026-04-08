import { Briefcase, User, HelpCircle, Receipt, Calendar, TrendingDown, Building2, AlertCircle } from "lucide-react";
import StatCard from "@/components/StatCard";
import type { ExpenseSummary } from "@/hooks/useExpenseSummary";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function ExpenseSummaryWidgets(summary: ExpenseSummary) {
  const topCompanies = Object.entries(summary.byCompany)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const companyTypeSummary = Object.entries(summary.byCompanyType)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-3">
      {/* Main stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Business Expenses" value={fmt(summary.totalBusinessExpenses)} icon={Briefcase} variant="default" />
        <StatCard label="Personal Expenses" value={fmt(summary.totalPersonalExpenses)} icon={User} variant="default" trend="Excluded from tax" />
        <StatCard label="Uncategorized" value={fmt(summary.uncategorizedTotal)} icon={HelpCircle} variant="warning" trend="Needs review" />
        <StatCard label="Unassigned" value={fmt(summary.unassignedTotal)} icon={AlertCircle} variant="warning" trend="No company" />
        <StatCard label="Deductible Total" value={fmt(summary.deductibleTotal)} icon={Receipt} variant="success" />
        <StatCard label="Month-to-Date" value={fmt(summary.mtdExpenses)} icon={Calendar} variant="default" />
        <StatCard label="Year-to-Date" value={fmt(summary.ytdExpenses)} icon={TrendingDown} variant="destructive" />
        {topCompanies[0] && (
          <StatCard label={topCompanies[0][0]} value={fmt(topCompanies[0][1])} icon={Building2} variant="default" trend="Top company" />
        )}
      </div>

      {/* Company type breakdown */}
      {companyTypeSummary.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Expenses by Company Type</p>
          <div className="flex flex-wrap gap-4">
            {companyTypeSummary.map(([type, total]) => (
              <div key={type} className="text-sm">
                <span className="text-muted-foreground">{type}: </span>
                <span className="font-semibold text-card-foreground">{fmt(total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
