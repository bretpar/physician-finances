import { type Transaction } from "@/lib/mockData";
import { Badge } from "@/components/ui/badge";

interface Props {
  transactions: Transaction[];
}

export default function RecentTransactions({ transactions }: Props) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-card-foreground">Recent Transactions</h3>
      </div>
      <div className="divide-y divide-border">
        {transactions.slice(0, 8).map((tx) => (
          <div key={tx.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-card-foreground truncate">{tx.merchant}</p>
              <p className="text-xs text-muted-foreground">{tx.date} · {tx.account}</p>
            </div>
            <div className="flex items-center gap-3 ml-4">
              <Badge variant={tx.deductible ? "default" : "secondary"} className="text-xs hidden sm:inline-flex">
                {tx.category}
              </Badge>
              <span className={`text-sm font-semibold tabular-nums ${tx.amount >= 0 ? "text-success" : "text-destructive"}`}>
                {fmt(tx.amount)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
