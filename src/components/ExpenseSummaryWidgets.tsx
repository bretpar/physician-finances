import { Briefcase, User, HelpCircle, Receipt, Calendar, TrendingDown } from "lucide-react";
import StatCard from "@/components/StatCard";

interface Props {
  totalBusinessExpenses: number;
  totalPersonalExpenses: number;
  uncategorizedTotal: number;
  deductibleTotal: number;
  mtdExpenses: number;
  ytdExpenses: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function ExpenseSummaryWidgets({
  totalBusinessExpenses,
  totalPersonalExpenses,
  uncategorizedTotal,
  deductibleTotal,
  mtdExpenses,
  ytdExpenses,
}: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard label="Business Expenses" value={fmt(totalBusinessExpenses)} icon={Briefcase} variant="default" />
      <StatCard label="Personal Expenses" value={fmt(totalPersonalExpenses)} icon={User} variant="default" trend="Excluded from tax" />
      <StatCard label="Uncategorized" value={fmt(uncategorizedTotal)} icon={HelpCircle} variant="warning" trend="Needs review" />
      <StatCard label="Deductible Total" value={fmt(deductibleTotal)} icon={Receipt} variant="success" />
      <StatCard label="Month-to-Date" value={fmt(mtdExpenses)} icon={Calendar} variant="default" />
      <StatCard label="Year-to-Date" value={fmt(ytdExpenses)} icon={TrendingDown} variant="destructive" />
    </div>
  );
}
