import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, Wallet } from "lucide-react";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";

interface MoneyCardsProps {
  totalEarnedYTD: number;
  earnedThisMonth: number;
  estimatedTax: number;
  userId?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function useGrowthGlow(key: string, value: number) {
  const [glow, setGlow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storeKey = `dashboard:lastValue:${key}`;
    const prev = Number(localStorage.getItem(storeKey) || "0");
    if (Number.isFinite(value) && value > prev + 0.5) {
      setGlow(true);
      const t = setTimeout(() => setGlow(false), 2200);
      localStorage.setItem(storeKey, String(value));
      return () => clearTimeout(t);
    }
    if (Number.isFinite(value)) localStorage.setItem(storeKey, String(value));
  }, [key, value]);
  return glow;
}

export default function MoneyCards({ totalEarnedYTD, earnedThisMonth, estimatedTax, userId }: MoneyCardsProps) {
  const yourMoney = Math.max(0, totalEarnedYTD - estimatedTax);
  const earnedAnim = useCountUp(totalEarnedYTD);
  const yourMoneyAnim = useCountUp(yourMoney);

  const earnedGlow = useGrowthGlow(`${userId}:earned`, totalEarnedYTD);
  const moneyGlow = useGrowthGlow(`${userId}:money`, yourMoney);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        className={cn(
          "transition-shadow duration-500",
          earnedGlow && "shadow-[0_0_0_3px_hsl(var(--success)/0.35)]",
        )}
      >
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <TrendingUp className="h-4 w-4" />
            <span>Total Earned (YTD)</span>
          </div>
          <p className="text-3xl font-semibold tabular-nums tracking-tight">{fmt(earnedAnim)}</p>
          <p className="text-xs text-muted-foreground mt-2">
            <span className="text-success font-medium">+ {fmt(earnedThisMonth)}</span> this month
          </p>
        </CardContent>
      </Card>

      <Card
        className={cn(
          "border-primary/30 bg-primary/[0.03] transition-shadow duration-500",
          moneyGlow && "shadow-[0_0_0_3px_hsl(var(--primary)/0.35)]",
        )}
      >
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Wallet className="h-4 w-4" />
            <span>Your Money (After Tax)</span>
          </div>
          <p className="text-4xl font-bold tabular-nums tracking-tight text-primary">{fmt(yourMoneyAnim)}</p>
          <p className="text-xs text-muted-foreground mt-2">Estimated taxes: {fmt(estimatedTax)}</p>
        </CardContent>
      </Card>
    </div>
  );
}
