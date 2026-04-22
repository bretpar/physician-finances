import { useEffect, useState } from "react";
import { toast } from "sonner";

interface PaycheckConfettiProps {
  userId?: string;
  /** Most recent paycheck-style entries: { id, amount, date } */
  recentIncome: { id: string; amount: number; date: string }[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const CONFETTI_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--accent))",
];

export default function PaycheckConfetti({ userId, recentIncome }: PaycheckConfettiProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!userId || typeof window === "undefined" || recentIncome.length === 0) return;
    const key = `dashboard:lastSeenIncome:${userId}`;
    const lastSeen = localStorage.getItem(key) || "";
    const sorted = [...recentIncome].sort((a, b) => b.date.localeCompare(a.date));
    const newest = sorted[0];
    if (!newest || newest.id === lastSeen) return;

    // Sum of new (post-lastSeen) amounts
    const lastSeenIdx = sorted.findIndex((i) => i.id === lastSeen);
    const newOnes = lastSeenIdx === -1 ? sorted.slice(0, 3) : sorted.slice(0, lastSeenIdx);
    const total = newOnes.reduce((s, i) => s + Math.abs(i.amount), 0);
    if (total <= 0) return;

    setShow(true);
    toast.success(`🎉 You got paid! +${fmt(total)}`, { duration: 3000 });
    localStorage.setItem(key, newest.id);
    const t = setTimeout(() => setShow(false), 3000);
    return () => clearTimeout(t);
  }, [userId, recentIncome]);

  if (!show) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {Array.from({ length: 36 }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.4;
        const duration = 2 + Math.random() * 1.2;
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const size = 6 + Math.random() * 6;
        return (
          <span
            key={i}
            className="absolute top-0 rounded-sm"
            style={{
              left: `${left}%`,
              width: size,
              height: size * 0.4,
              backgroundColor: color,
              animation: `confetti-fall ${duration}s ${delay}s ease-in forwards`,
            }}
          />
        );
      })}
    </div>
  );
}
