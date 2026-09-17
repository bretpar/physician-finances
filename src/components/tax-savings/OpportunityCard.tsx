import type { ReactNode } from "react";
import { ChevronRight, Info, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Shared "Opportunity Card" presentation for Tax Savings categories.
 * Display-only: no calculations, no data access. New categories only need to
 * supply status/description/action metadata to look consistent.
 */
export type OpportunityStatus = "configured" | "not_configured" | "not_available";

export type OpportunityActionLabel = "Add" | "Set Up" | "Edit" | "Enable";

export interface OpportunityMeta {
  status: OpportunityStatus;
  /** One-line plain-language explanation of the deduction. */
  description: string;
  /** Single primary action for the category. Omitted for "Coming Soon". */
  actionLabel?: OpportunityActionLabel;
}

const formatWholeDollars = (amount: number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(amount);

/** Shared compact row for an active Tax Savings strategy. */
export function ActiveStrategyRow({
  value,
  icon: Icon,
  label,
  taxSavings,
  deductionAmount,
  marginalRatePct,
  description,
  summary,
  isOpen,
  itemRef,
  supportingContent,
  children,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  taxSavings: number;
  deductionAmount: number;
  marginalRatePct: number;
  description?: string;
  summary?: string;
  isOpen: boolean;
  itemRef?: (element: HTMLDivElement | null) => void;
  supportingContent?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      ref={itemRef}
      className="scroll-mt-4 border-b border-border px-3 last:border-b-0 data-[state=open]:bg-muted/20 sm:px-4"
    >
      <AccordionTrigger className="min-h-[52px] gap-3 py-2 hover:no-underline [&>svg]:hidden">
        <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-card-foreground">{label}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatWholeDollars(taxSavings)}
          </span>
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-3">
        <div className="space-y-3 border-t border-border/70 pt-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] text-muted-foreground">Deduction amount</p>
              <p className="text-lg font-bold tabular-nums text-card-foreground">{formatWholeDollars(deductionAmount)}</p>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`How ${label} tax savings are estimated`}>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px] space-y-1.5 text-xs leading-relaxed">
                  <p>Estimated tax savings is based on this deduction and your current marginal tax rate.</p>
                  <p className="font-semibold tabular-nums">
                    {formatWholeDollars(deductionAmount)} × {marginalRatePct.toFixed(0)}% = {formatWholeDollars(taxSavings)}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {(description || summary) && (
            <div className="space-y-1">
              {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
              {summary && <p className="text-xs font-medium text-foreground/80">{summary}</p>}
            </div>
          )}
          {supportingContent}
          <div>{children}</div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

const STATUS_STYLES: Record<OpportunityStatus, { label: string; className: string }> = {
  configured: {
    label: "Configured",
    className: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  not_configured: {
    label: "Not Configured",
    className: "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  not_available: {
    label: "Not Available",
    className: "border-transparent bg-muted text-muted-foreground",
  },
};

export function OpportunityStatusBadge({
  status,
  className,
}: {
  status: OpportunityStatus;
  className?: string;
}) {
  const s = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn("text-[11px] font-medium px-2 py-0.5", s.className, className)}>
      {s.label}
    </Badge>
  );
}

export function OpportunityHeader({
  icon: Icon,
  label,
  status,
  description,
  summary,
  comingSoon,
  amount,
  amountLabel = "Estimated deduction",
}: {
  icon: LucideIcon;
  label: string;
  status: OpportunityStatus;
  description: string;
  summary?: string;
  comingSoon?: boolean;
  /** Pre-formatted currency string shown prominently for configured categories. */
  amount?: string;
  amountLabel?: string;
}) {
  return (
    <div className="flex items-start gap-3 text-left min-w-0 w-full">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-card-foreground">{label}</p>
          {comingSoon ? (
            <Badge variant="outline" className="text-[11px] font-medium px-2 py-0.5 border-transparent bg-muted text-muted-foreground">
              Coming Soon
            </Badge>
          ) : (
            <OpportunityStatusBadge status={status} />
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {amount ? (
          <div className="pt-0.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{amountLabel}</p>
            <p className="text-lg font-bold text-card-foreground tabular-nums leading-tight">{amount}</p>
            {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
          </div>
        ) : (
          summary && <p className="text-xs font-medium text-foreground/80">{summary}</p>
        )}
      </div>
    </div>
  );
}


/** Static card used for categories that are not implemented yet. */
export function ComingSoonOpportunityCard({
  icon,
  label,
  description,
  insightTrigger,
  insightPanel,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  /** Optional "Why this matters" control rendered under the header. */
  insightTrigger?: React.ReactNode;
  /** Optional inline educational panel, shown when expanded. */
  insightPanel?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <OpportunityHeader icon={icon} label={label} status="not_available" description={description} comingSoon />
        <Button variant="outline" size="sm" disabled className="shrink-0 min-h-[44px] sm:min-h-0">
          Coming Soon
        </Button>
      </div>
      {insightTrigger && <div className="pt-1">{insightTrigger}</div>}
      {insightPanel}
    </div>
  );
}

