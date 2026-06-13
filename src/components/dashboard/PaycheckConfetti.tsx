import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaycheckConfettiProps {
  userId?: string;
  /** Most recent paycheck-style entries: { id, amount, date } */
  recentIncome: { id: string; amount: number; date: string }[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const AUTO_DISMISS_MS = 6000;

export default function PaycheckConfetti({ userId, recentIncome }: PaycheckConfettiProps) {
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);
  const [total, setTotal] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId || typeof window === "undefined" || recentIncome.length === 0) return;
    const key = `dashboard:lastSeenIncome:${userId}`;
    const lastSeen = localStorage.getItem(key) || "";
    const sorted = [...recentIncome].sort((a, b) => b.date.localeCompare(a.date));
    const newest = sorted[0];
    if (!newest || newest.id === lastSeen) return;

    const lastSeenIdx = sorted.findIndex((i) => i.id === lastSeen);
    const newOnes = lastSeenIdx === -1 ? sorted.slice(0, 3) : sorted.slice(0, lastSeenIdx);
    const sum = newOnes.reduce((s, i) => s + Math.abs(i.amount), 0);
    if (sum <= 0) return;

    setTotal(sum);
    setShow(true);
    localStorage.setItem(key, newest.id);
    const t = setTimeout(() => handleClose(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, recentIncome]);

  const sparkles = useMemo(
    () =>
      Array.from({ length: 14 }).map((_, i) => ({
        id: i,
        left: 50 + (Math.random() - 0.5) * 90,
        top: 50 + (Math.random() - 0.5) * 60,
        delay: Math.random() * 0.3,
        duration: 0.9 + Math.random() * 0.8,
        size: 6 + Math.random() * 8,
      })),
    [show],
  );

  function handleClose() {
    setClosing(true);
    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 200);
  }

  function handleView() {
    handleClose();
    navigate("/personal-income");
  }

  if (!show) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4 sm:top-10"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-xl ${
          closing ? "animate-fade-out" : "animate-scale-in"
        }`}
        role="status"
      >
        {/* Soft gradient header band */}
        <div className="relative h-1.5 w-full bg-gradient-to-r from-primary/60 via-primary to-primary/60" />

        {/* Sparkle layer */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {sparkles.map((s) => (
            <span
              key={s.id}
              className="absolute rounded-full bg-primary/70"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: s.size,
                height: s.size,
                opacity: 0,
                animation: `sparkle-pop ${s.duration}s ${s.delay}s ease-out forwards`,
              }}
            />
          ))}
        </div>

        <div className="relative flex items-start gap-3 p-4 sm:p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Payday detected</h3>
              <button
                onClick={handleClose}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Your latest income{" "}
              <span className="font-medium text-foreground">+{fmt(total)}</span> was added.
              Nice work staying on top of your finances.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={handleView}>
                View income
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClose}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
