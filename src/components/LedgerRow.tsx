import { ReactNode, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ChevronDown,
  CreditCard,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type LedgerRowKind =
  | "income"
  | "expense"
  | "transfer"
  | "credit_card_payment"
  | "neutral";

const KIND_ICON: Record<LedgerRowKind, LucideIcon> = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowLeftRight,
  credit_card_payment: CreditCard,
  neutral: Receipt,
};

const KIND_ICON_CLASSES: Record<LedgerRowKind, string> = {
  income: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  expense: "bg-muted text-muted-foreground",
  transfer: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  credit_card_payment: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  neutral: "bg-muted text-muted-foreground",
};

export interface LedgerRowBadge {
  label: string;
  tone?: "default" | "muted" | "warning" | "info" | "success";
}

export interface LedgerRowProps {
  kind?: LedgerRowKind;
  icon?: LucideIcon;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  date?: string | null;
  amount: number;
  amountPrefix?: string;
  amountTone?: "positive" | "negative" | "neutral";
  badges?: LedgerRowBadge[];
  rightSlot?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

const fmtAmount = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.abs(n));

const TONE_CLASS: Record<NonNullable<LedgerRowBadge["tone"]>, string> = {
  default: "border-border bg-background text-foreground",
  muted: "border-border bg-muted text-muted-foreground",
  warning:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  info: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
};

export function LedgerRow({
  kind = "expense",
  icon,
  title,
  subtitle,
  meta,
  date,
  amount,
  amountPrefix,
  amountTone,
  badges,
  rightSlot,
  onClick,
  selected,
  className,
}: LedgerRowProps) {
  const Icon = icon ?? KIND_ICON[kind];
  const tone =
    amountTone ??
    (kind === "income" ? "positive" : kind === "transfer" ? "neutral" : "neutral");

  const amountClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-destructive"
        : "text-foreground";

  const prefix =
    amountPrefix ?? (tone === "positive" ? "+" : tone === "negative" ? "-" : "");

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors",
        "hover:bg-muted/40 active:bg-muted/60",
        selected && "bg-primary/5",
        className,
      )}
    >
      {/* Left: icon */}
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
          KIND_ICON_CLASSES[kind],
        )}
      >
        <Icon className="h-5 w-5" />
      </div>

      {/* Middle: details */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[17px] font-semibold text-foreground leading-tight truncate">
          {title}
        </div>
        {subtitle && (
          <div className="text-[15px] text-muted-foreground leading-tight truncate">
            {subtitle}
          </div>
        )}
        {meta && (
          <div className="text-[13px] text-muted-foreground/80 leading-tight truncate">
            {meta}
          </div>
        )}
        {(date || (badges && badges.length > 0)) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {date && (
              <span className="text-[12px] text-muted-foreground/70 tabular-nums">
                {date}
              </span>
            )}
            {badges?.map((b, i) => (
              <span
                key={`${b.label}-${i}`}
                className={cn(
                  "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                  TONE_CLASS[b.tone ?? "muted"],
                )}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right: amount */}
      <div className="flex shrink-0 flex-col items-end gap-1 pl-2">
        <span
          className={cn(
            "text-[17px] font-semibold tabular-nums leading-tight",
            amountClass,
          )}
        >
          {prefix}
          {fmtAmount(amount)}
        </span>
        {rightSlot}
      </div>
    </button>
  );
}

export function MonthHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-6 pb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {label}
    </div>
  );
}

export function groupByMonth<T>(
  items: T[],
  getDate: (item: T) => string,
): Array<{ key: string; label: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const raw = getDate(item);
    if (!raw) continue;
    const d = new Date(raw + (raw.length === 10 ? "T00:00:00" : ""));
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, items]) => {
      const [year, month] = key.split("-").map(Number);
      const label = new Date(year, month - 1, 1).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      return { key, label, items };
    });
}
