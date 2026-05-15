import type { DbTransaction } from "@/hooks/useTransactions";
import { txTone, resolveTxTone } from "@/lib/transactionTones";

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
                {(() => {
                  const isIncome = tx.amount > 0;
                  const isPersonal = tx.category === "Personal";
                  const isUncategorized = tx.category === "Uncategorized";
                  const cls = isUncategorized
                    ? "bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-950/30 dark:text-amber-400"
                    : isIncome
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400"
                      : isPersonal
                        ? "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/40 dark:text-slate-400"
                        : "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-400";
                  return (
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full hidden sm:inline-flex ${cls}`}>
                      {tx.category}
                    </span>
                  );
                })()}
                <span className={`text-sm font-semibold tabular-nums ${tx.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
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
