import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Pencil,
  Trash2,
  Link2,
  Unlink2,
  X,
  CheckCircle2,
  ChevronDown,
  ArrowRight,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type DetailField = {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  /** Render de-emphasized (used for reconciliation notes / minor values). */
  subtle?: boolean;
};

export type DetailSection = {
  title: string;
  fields: DetailField[];
  /** Wrap the section in a collapsible disclosure row. */
  collapsible?: boolean;
  /** Open state for collapsible sections (default closed). */
  defaultOpen?: boolean;
  /** Optional secondary note rendered under the fields. */
  note?: React.ReactNode;
};

export type DetailBadge = {
  label: string;
  tone?: "default" | "success" | "warning" | "muted" | "destructive";
};

export type LinkedItem = {
  id: string;
  label: string;
  amount?: number;
  date?: string;
  /** Compact status line, e.g. "Matched within $0.73". */
  status?: string;
};

/** Compact primary financial summary row. */
export type SummaryRow = {
  label: string;
  value: React.ReactNode;
  tone?: "income" | "expense" | "neutral";
  /** Larger/bolder treatment for the single most important value. */
  emphasis?: boolean;
  subtle?: boolean;
};

export type DetailStatusLevel = "ok" | "attention" | "error";

export type DetailStatus = {
  level: DetailStatusLevel;
  title: string;
  description?: string;
  ctaLabel?: string;
  onCta?: () => void;
};

export type DetailSource = {
  /** e.g. "Income Planner", "Bank import" */
  title: string;
  description?: React.ReactNode;
  ctaLabel?: string;
  onCta?: () => void;
};

export type TransactionDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  header: {
    title: string;
    subtitle?: string;
    date?: string;
    amount?: number;
    amountTone?: "income" | "expense" | "neutral";
    /** Small transaction-type chip, e.g. W-2 / 1099 / K-1 / Expense / Transfer. */
    typeChip?: string;
    badges?: DetailBadge[];
  };
  /** Compact primary financial summary (shown before everything else). */
  summary?: SummaryRow[];
  /** Canonical tax-savings status indicator (income only). */
  status?: DetailStatus;
  sections: DetailSection[];
  linked?: {
    items: LinkedItem[];
    onUnlink?: (id: string) => void;
    onLink?: () => void;
    canLink?: boolean;
  };
  /** Compact provenance/source block (Income Planner, bank import, …). */
  source?: DetailSource;
  /** Receipts / attachments UI (rendered after linked transactions). */
  receipts?: React.ReactNode;
  /** Low-priority metadata, collapsed under "More details". */
  moreDetails?: DetailSection[];
  primaryActions?: React.ReactNode;
  extraContent?: React.ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
  onMarkReviewed?: () => void;
  needsReview?: boolean;
  markReviewedPending?: boolean;
  editLabel?: string;
  deleteLabel?: string;
  hideEdit?: boolean;
  hideDelete?: boolean;
};

const toneClass = (tone?: DetailBadge["tone"]) => {
  switch (tone) {
    case "success":
      return "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-transparent dark:bg-emerald-900/40 dark:text-emerald-300";
    case "warning":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100 border-transparent dark:bg-amber-900/40 dark:text-amber-200";
    case "muted":
      return "bg-muted text-muted-foreground hover:bg-muted border-transparent";
    case "destructive":
      return "bg-destructive/10 text-destructive hover:bg-destructive/10 border-transparent";
    default:
      return "";
  }
};

const fmtMoney = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
    : "—";

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
);

function FieldList({ fields }: { fields: DetailField[] }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
      {fields.map((f, i) => (
        <React.Fragment key={i}>
          <dt className={cn("col-span-1 text-muted-foreground", f.subtle && "text-muted-foreground/80")}>
            {f.label}
          </dt>
          <dd
            className={cn(
              "col-span-2 break-words",
              f.subtle ? "text-muted-foreground" : "text-foreground",
              f.mono && "font-mono tabular-nums",
            )}
          >
            {f.value ?? "—"}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function CollapsibleSection({
  title,
  defaultOpen,
  testId,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2.5 text-left text-sm font-medium min-h-[44px] hover:bg-muted/50 transition-colors"
        >
          <span>{title}</span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pt-3 pb-1 space-y-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const statusStyles: Record<DetailStatusLevel, { box: string; icon: React.ElementType; iconClass: string }> = {
  ok: {
    box: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20",
    icon: CheckCircle2,
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
  attention: {
    box: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20",
    icon: AlertTriangle,
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  error: {
    box: "border-destructive/30 bg-destructive/5",
    icon: AlertCircle,
    iconClass: "text-destructive",
  },
};

function StatusBlock({ status }: { status: DetailStatus }) {
  const s = statusStyles[status.level];
  const Icon = s.icon;
  return (
    <div
      data-testid="tx-detail-status"
      data-status-level={status.level}
      className={cn("rounded-lg border px-3 py-2.5", s.box)}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", s.iconClass)} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">{status.title}</p>
          {status.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{status.description}</p>
          )}
          {status.ctaLabel && status.onCta && (
            <button
              type="button"
              onClick={status.onCta}
              data-testid="tx-detail-status-cta"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline pt-0.5"
            >
              {status.ctaLabel}
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TransactionDetailSheet({
  open,
  onOpenChange,
  header,
  summary,
  status,
  sections,
  linked,
  source,
  receipts,
  moreDetails,
  primaryActions,
  extraContent,
  onEdit,
  onDelete,
  onMarkReviewed,
  needsReview,
  markReviewedPending,
  editLabel = "Edit",
  deleteLabel = "Delete",
  hideEdit,
  hideDelete,
}: TransactionDetailSheetProps) {
  const amountColor =
    header.amountTone === "income"
      ? "text-emerald-600 dark:text-emerald-400"
      : header.amountTone === "expense"
        ? "text-destructive"
        : "text-foreground";

  // Never repeat the same source/employer name twice.
  const subtitle =
    header.subtitle && header.subtitle.trim() && header.subtitle.trim() !== header.title.trim()
      ? header.subtitle
      : undefined;

  const visibleSections = sections.filter((s) => s.fields.length > 0 || s.note);
  const visibleMore = (moreDetails || []).filter((s) => s.fields.length > 0 || s.note);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[85%] max-w-[85%] sm:w-full sm:max-w-lg p-0 flex flex-col gap-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {header.date && <span>{header.date}</span>}
                {header.typeChip && (
                  <Badge variant="outline" className="text-[10px] font-semibold" data-testid="tx-detail-type-chip">
                    {header.typeChip}
                  </Badge>
                )}
              </div>
              <SheetTitle className="text-xl mt-1.5 truncate">{header.title}</SheetTitle>
              {subtitle && <SheetDescription className="mt-0.5 truncate">{subtitle}</SheetDescription>}
            </div>
            {typeof header.amount === "number" && (
              <div className={cn("text-2xl font-semibold tabular-nums whitespace-nowrap", amountColor)}>
                {fmtMoney(header.amount)}
              </div>
            )}
          </div>
          {!!header.badges?.length && (
            <div className="flex flex-wrap items-center gap-1.5">
              {header.badges.map((b, i) => (
                <Badge key={i} variant="outline" className={cn("text-[10px] font-medium", toneClass(b.tone))}>
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
        </SheetHeader>

        <Separator />

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!!summary?.length && (
            <div className="space-y-1.5" data-testid="tx-detail-summary">
              {summary.map((row, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3">
                  <span
                    className={cn(
                      "text-sm",
                      row.subtle ? "text-muted-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {row.label}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums text-right",
                      row.emphasis ? "text-base font-semibold" : "text-sm font-medium",
                      row.subtle && "text-xs font-normal text-muted-foreground",
                      row.tone === "income" && !row.subtle && "text-emerald-600 dark:text-emerald-400",
                      row.tone === "expense" && !row.subtle && "text-destructive",
                    )}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {status && <StatusBlock status={status} />}

          {visibleSections.map((section) =>
            section.collapsible ? (
              <CollapsibleSection
                key={section.title}
                title={section.title}
                defaultOpen={section.defaultOpen}
                testId="tx-detail-section-toggle"
              >
                <FieldList fields={section.fields} />
                {section.note}
              </CollapsibleSection>
            ) : (
              <section key={section.title} className="space-y-2.5">
                <SectionHeading>{section.title}</SectionHeading>
                <FieldList fields={section.fields} />
                {section.note}
              </section>
            ),
          )}

          {extraContent}

          {linked && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <SectionHeading>Linked transactions</SectionHeading>
                {linked.onLink && linked.canLink !== false && (
                  <Button variant="ghost" size="sm" onClick={linked.onLink} className="h-7 gap-1 text-xs">
                    <Link2 className="h-3.5 w-3.5" />
                    Link transactions
                  </Button>
                )}
              </div>
              {linked.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No linked transactions.</p>
              ) : (
                <ul className="space-y-1.5">
                  {linked.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.label}</div>
                        {(item.date || typeof item.amount === "number") && (
                          <div className="text-xs text-muted-foreground">
                            {item.date}
                            {item.date && typeof item.amount === "number" && " · "}
                            {typeof item.amount === "number" && fmtMoney(item.amount)}
                          </div>
                        )}
                        {item.status && (
                          <div className="text-xs text-muted-foreground/90 mt-0.5">{item.status}</div>
                        )}
                      </div>
                      {linked.onUnlink && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() => linked.onUnlink?.(item.id)}
                          aria-label="Unlink"
                        >
                          <Unlink2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {source && (
            <section className="space-y-1.5" data-testid="tx-detail-source">
              <SectionHeading>{source.title}</SectionHeading>
              {source.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">{source.description}</p>
              )}
              {source.ctaLabel && source.onCta && (
                <button
                  type="button"
                  onClick={source.onCta}
                  data-testid="tx-detail-source-cta"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {source.ctaLabel}
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </section>
          )}

          {receipts && (
            <section className="space-y-2.5" data-testid="tx-detail-receipts">
              <SectionHeading>Receipts</SectionHeading>
              {receipts}
            </section>
          )}

          {visibleMore.length > 0 && (
            <CollapsibleSection title="More details" testId="tx-detail-more-toggle">
              {visibleMore.map((s) => (
                <div key={s.title} className="space-y-2">
                  {visibleMore.length > 1 && <SectionHeading>{s.title}</SectionHeading>}
                  <FieldList fields={s.fields} />
                  {s.note}
                </div>
              ))}
            </CollapsibleSection>
          )}

          {primaryActions && (
            <section className="space-y-2.5">
              <SectionHeading>Actions</SectionHeading>
              <div className="flex flex-col gap-2">{primaryActions}</div>
            </section>
          )}
        </div>

        <Separator />

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+36px)] sm:pb-4 bg-background">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="gap-1.5 min-h-[48px] sm:min-h-0"
          >
            <X className="h-4 w-4" />
            Close
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            {onMarkReviewed && needsReview && (
              <Button
                variant="outline"
                size="sm"
                onClick={onMarkReviewed}
                disabled={markReviewedPending}
                className="gap-1.5 min-h-[48px] sm:min-h-0 border-amber-400 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
              >
                <CheckCircle2 className="h-4 w-4" />
                Mark as reviewed
              </Button>
            )}
            {!hideDelete && onDelete && (
              <Button variant="outline" size="sm" onClick={onDelete} className="gap-1.5 min-h-[48px] sm:min-h-0 text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
                {deleteLabel}
              </Button>
            )}
            {!hideEdit && onEdit && (
              <Button size="sm" onClick={onEdit} className="gap-1.5 min-h-[48px] sm:min-h-0" data-testid="tx-detail-edit">
                <Pencil className="h-4 w-4" />
                {editLabel}
              </Button>
            )}


          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default TransactionDetailSheet;
