/**
 * Shared tone-to-color mapping for transactions and ledger rows.
 *
 * Rules:
 *  - income   → emerald (positive, prominent)
 *  - expense  → rose    (real, important, calmer than destructive red)
 *  - transfer → slate   (neutral bookkeeping movement)
 *  - planned  → muted + dashed (lighter, forecasted)
 *  - blue     → reserved for linking, matching, imported, info, primary actions
 *  - personal → slate   (personal/non-business, deprioritized in business views)
 *  - uncategorized → amber warning
 */

export type TxTone =
  | "income"
  | "expense"
  | "transfer"
  | "planned"
  | "personal"
  | "uncategorized"
  | "info"
  | "neutral";

export interface TxToneClasses {
  /** Icon container (rounded circle) background + foreground. */
  iconBg: string;
  /** Amount text color. */
  amount: string;
  /** Pill / badge: bg + text + border. */
  pill: string;
  /** Optional border accent (for cards/rows). */
  border: string;
}

const TONES: Record<TxTone, TxToneClasses> = {
  income: {
    iconBg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    amount: "text-emerald-600 dark:text-emerald-400",
    pill: "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
    border: "border-emerald-200 dark:border-emerald-800",
  },
  expense: {
    iconBg: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    amount: "text-rose-600 dark:text-rose-400",
    pill: "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900",
    border: "border-rose-200 dark:border-rose-900",
  },
  transfer: {
    iconBg: "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-400",
    amount: "text-slate-500 dark:text-slate-400",
    pill: "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
    border: "border-slate-200 dark:border-slate-700",
  },
  planned: {
    // Planned = lighter opacity + dashed border. Neutral hue, never gray-as-expense.
    iconBg: "bg-muted text-muted-foreground opacity-80",
    amount: "text-muted-foreground",
    pill: "bg-background text-muted-foreground border border-dashed border-muted-foreground/40",
    border: "border-dashed border-muted-foreground/40",
  },
  personal: {
    iconBg: "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-400",
    amount: "text-slate-500 dark:text-slate-400",
    pill: "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
    border: "border-slate-200 dark:border-slate-700",
  },
  uncategorized: {
    iconBg: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    amount: "text-amber-700 dark:text-amber-400",
    pill: "bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700",
    border: "border-amber-300 dark:border-amber-700",
  },
  // Reserved for linking, matching, imported, info, primary actions.
  info: {
    iconBg: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    amount: "text-blue-600 dark:text-blue-400",
    pill: "bg-blue-50 text-blue-700 border border-blue-300 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
    border: "border-blue-300 dark:border-blue-800",
  },
  neutral: {
    iconBg: "bg-muted text-muted-foreground",
    amount: "text-foreground",
    pill: "bg-muted text-muted-foreground border border-border",
    border: "border-border",
  },
};

/** Return the full class set for a tone. */
export function txTone(tone: TxTone): TxToneClasses {
  return TONES[tone];
}

/** Resolve a transaction's tone from common shape `{ transaction_type, category, planned? }`. */
export function resolveTxTone(tx: {
  transaction_type?: string | null;
  category?: string | null;
  planned?: boolean | null;
}): TxTone {
  if (tx.planned) return "planned";
  const t = (tx.transaction_type || "").toLowerCase();
  if (t === "income") return "income";
  if (t === "transfer") return "transfer";
  if ((tx.category || "") === "Personal") return "personal";
  if (!tx.category || tx.category === "Uncategorized") return "uncategorized";
  return "expense";
}
