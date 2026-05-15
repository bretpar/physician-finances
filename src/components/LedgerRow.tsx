import { ReactNode, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  ChevronDown,
  CreditCard,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { txTone, type TxTone } from "@/lib/transactionTones";

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

const KIND_TONE: Record<LedgerRowKind, TxTone | null> = {
  income: "income",
  expense: "expense",
  transfer: "transfer",
  credit_card_payment: null, // keep purple custom
  neutral: "neutral",
};

const KIND_ICON_CLASSES: Record<LedgerRowKind, string> = {
  income: txTone("income").iconBg,
  expense: txTone("expense").iconBg,
  transfer: txTone("transfer").iconBg,
  credit_card_payment: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  neutral: txTone("neutral").iconBg,
};

export interface LedgerRowBadge {
  label: string;
  tone?: "default" | "muted" | "warning" | "info" | "success" | "expense";
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
  /** Secondary metadata revealed by tapping the expand chevron. Mobile-first. */
  expandableContent?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  /** When true, tapping the row toggles selection instead of firing onClick. */
  selectionMode?: boolean;
  /** Toggle selection (used in selection mode and from "Select for linking"). */
  onToggleSelect?: () => void;
  /** Long-press to enter selection mode (mobile). */
  onLongPress?: () => void;
}

const fmtAmount = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.abs(n));

const TONE_CLASS: Record<NonNullable<LedgerRowBadge["tone"]>, string> = {
  default: "border-border bg-background text-foreground",
  muted: "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400",
  warning:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  info: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
  expense:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400",
};

const LONG_PRESS_MS = 450;

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
  expandableContent,
  onClick,
  selected,
  className,
  selectionMode,
  onToggleSelect,
  onLongPress,
}: LedgerRowProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = icon ?? KIND_ICON[kind];
  const tone =
    amountTone ??
    (kind === "income" ? "positive" : kind === "expense" ? "negative" : "neutral");

  const amountClass =
    tone === "positive"
      ? txTone("income").amount
      : tone === "negative"
        ? txTone("expense").amount
        : kind === "transfer"
          ? txTone("transfer").amount
          : "text-foreground";

  const prefix =
    amountPrefix ?? (tone === "positive" ? "+" : tone === "negative" ? "-" : "");

  // Long-press detection (touch + mouse). Cancels on move/scroll.
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePressStart = (x: number, y: number) => {
    if (!onLongPress) return;
    longPressFired.current = false;
    startPos.current = { x, y };
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePressMove = (x: number, y: number) => {
    if (!startPos.current) return;
    const dx = Math.abs(x - startPos.current.x);
    const dy = Math.abs(y - startPos.current.y);
    if (dx > 8 || dy > 8) clearLongPress();
  };

  const handlePressEnd = () => {
    clearLongPress();
    startPos.current = null;
  };

  const handleClick = () => {
    if (longPressFired.current) {
      // The long-press handler already fired; suppress the click.
      longPressFired.current = false;
      return;
    }
    if (selectionMode && onToggleSelect) {
      onToggleSelect();
      return;
    }
    onClick?.();
  };

  return (
    <div
      className={cn(
        "w-full transition-colors",
        selected && "bg-primary/10 ring-1 ring-inset ring-primary/30",
        className,
      )}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={handleClick}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) handlePressStart(t.clientX, t.clientY);
          }}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t) handlePressMove(t.clientX, t.clientY);
          }}
          onTouchEnd={handlePressEnd}
          onTouchCancel={handlePressEnd}
          onContextMenu={(e) => {
            // Suppress the OS context menu after a long-press fires.
            if (onLongPress) e.preventDefault();
          }}
          className={cn(
            "min-w-0 flex-1 flex items-start gap-3 px-4 py-3.5 text-left transition-colors select-none",
            "hover:bg-muted/40 active:bg-muted/60",
          )}
        >
          {/* Left: icon OR selection indicator (in selection mode) */}
          {selectionMode ? (
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30 bg-background text-transparent",
              )}
              aria-hidden
            >
              <Check className="h-5 w-5" />
            </div>
          ) : (
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                KIND_ICON_CLASSES[kind],
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}

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

        {expandableContent && !selectionMode && (
          <button
            type="button"
            aria-label={expanded ? "Hide details" : "Show details"}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="shrink-0 px-3 flex items-center justify-center text-muted-foreground hover:bg-muted/40 active:bg-muted/60 transition-colors"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>
        )}
      </div>

      {expandableContent && expanded && !selectionMode && (
        <div className="px-4 pb-3 pl-[68px] text-[13px] text-muted-foreground space-y-1 bg-muted/20">
          {expandableContent}
        </div>
      )}
    </div>
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
