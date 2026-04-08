import { Landmark, CreditCard, PiggyBank, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const linkedAccounts = [
  { name: "Chase Business Checking", type: "checking", balance: 47250.00, icon: Landmark, last4: "4821" },
  { name: "Chase Savings", type: "savings", balance: 125000.00, icon: PiggyBank, last4: "9033" },
  { name: "Amex Business Platinum", type: "credit", balance: -3420.50, icon: CreditCard, last4: "1008" },
  { name: "Capital One Venture", type: "credit", balance: -1240.00, icon: CreditCard, last4: "7744" },
];

export default function Accounts() {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Linked Accounts</h3>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Connect Bank Account
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {linkedAccounts.map((acct) => (
          <div key={acct.last4} className="stat-card flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary shrink-0">
              <acct.icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-card-foreground">{acct.name}</p>
              <p className="text-xs text-muted-foreground capitalize">••• {acct.last4} · {acct.type}</p>
              <p className={`text-lg font-bold mt-1 ${acct.balance >= 0 ? "text-card-foreground" : "text-destructive"}`}>
                {fmt(acct.balance)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-xl p-8 text-center">
        <Landmark className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          Plaid integration will securely connect your bank accounts for automatic transaction syncing.
        </p>
        <p className="text-xs text-muted-foreground mt-1">Requires backend setup with Lovable Cloud.</p>
      </div>
    </div>
  );
}
