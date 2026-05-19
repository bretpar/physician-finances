import { useState } from "react";
import type { DbTransaction } from "@/hooks/useTransactions";
import { txTone, resolveTxTone } from "@/lib/transactionTones";
import { TransactionDetailSheet, type DetailSection } from "@/components/TransactionDetailSheet";
import { useNavigate } from "react-router-dom";
import { formatDate } from "@/lib/localDate";

interface Props {
  transactions: DbTransaction[];
}

export default function RecentTransactions({ transactions }: Props) {
  const navigate = useNavigate();
  const [detailTx, setDetailTx] = useState<DbTransaction | null>(null);
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
            <button
              type="button"
              key={tx.id}
              onClick={() => setDetailTx(tx)}
              className="w-full text-left flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-card-foreground truncate">{tx.vendor || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{formatDate(tx.transaction_date)} · {tx.account_source || "—"}</p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                {(() => {
                  const tone = resolveTxTone({
                    transaction_type: tx.amount > 0 ? "income" : "expense",
                    category: tx.category,
                  });
                  return (
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full hidden sm:inline-flex ${txTone(tone).pill}`}>
                      {tx.category}
                    </span>
                  );
                })()}
                <span className={`text-sm font-semibold tabular-nums ${tx.amount >= 0 ? txTone("income").amount : txTone("expense").amount}`}>
                  {fmt(tx.amount)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detailTx && (() => {
        const tx = detailTx;
        const isIncome = tx.amount >= 0;
        const gross = Math.abs(tx.amount);
        const sections: DetailSection[] = [
          {
            title: "Basic details",
            fields: [
              { label: "Vendor", value: tx.vendor || "Unknown" },
              ...(tx.category ? [{ label: "Category", value: tx.category }] : []),
              ...(tx.account_source ? [{ label: "Account", value: tx.account_source }] : []),
              ...(tx.notes ? [{ label: "Notes", value: tx.notes }] : []),
            ],
          },
          {
            title: "Amount",
            fields: [
              { label: "Gross", value: fmt(gross), mono: true },
              ...(isIncome ? [{ label: "Net received", value: fmt(gross), mono: true }] : []),
            ],
          },
        ];
        return (
          <TransactionDetailSheet
            open={!!detailTx}
            onOpenChange={(o) => { if (!o) setDetailTx(null); }}
            header={{
              title: tx.vendor || "Unknown",
              date: formatDate(tx.transaction_date),
              amount: Math.abs(tx.amount),
              amountTone: isIncome ? "income" : "expense",
            }}
            sections={sections}
            onEdit={() => { setDetailTx(null); navigate("/business-activity"); }}
            editLabel="Open in ledger"
            hideDelete
          />
        );
      })()}
    </div>
  );
}
