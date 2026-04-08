import { Badge } from "@/components/ui/badge";
import type { DbTransaction } from "@/hooks/useTransactions";

interface Props {
  transactions: DbTransaction[];
}

export default function RecentTransactions({ transactions }: Props) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-card-foreground">Recent Transactions</h3>
      </div>
      {transactions.length === 0 ? (
        <div className="px-5 py-8 text-center text-muted-foreground text-sm">
          No transactions yet. Add some from the Transactions page.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {transactions.slice(0, 8).map((tx) => (
            <div key={tx.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-card-foreground truncate">{tx.vendor || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{tx.transaction_date} · {tx.account_source || "—"}</p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                <Badge variant={tx.category !== "Uncategorized" && tx.category !== "Personal" ? "default" : "secondary"} className="text-xs hidden sm:inline-flex">
                  {tx.category}
                </Badge>
                <span className={`text-sm font-semibold tabular-nums ${tx.amount >= 0 ? "text-success" : "text-destructive"}`}>
                  {fmt(tx.amount)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
