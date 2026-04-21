import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  /** String value of the main "Total Federal Payroll Taxes" field. */
  total: string;
  onTotalChange: (value: string) => void;
  federal: string;
  onFederalChange: (value: string) => void;
  ss: string;
  onSsChange: (value: string) => void;
  medicare: string;
  onMedicareChange: (value: string) => void;
  /** Force advanced section open initially (e.g. when editing a record with breakdown). */
  defaultAdvancedOpen?: boolean;
  label?: string;
  className?: string;
}

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Simplified federal payroll tax input. Shows a single "Total Federal
 * Payroll Taxes" field by default. When the user opens the advanced
 * section and enters federal income tax / SS / Medicare, those values
 * are auto-summed into the main total (and the main field becomes
 * read-only). If all three advanced fields are cleared, the user can
 * type directly into the main total again.
 */
export function TotalFederalTaxField({
  total,
  onTotalChange,
  federal,
  onFederalChange,
  ss,
  onSsChange,
  medicare,
  onMedicareChange,
  defaultAdvancedOpen = false,
  label = "Total Federal Payroll Taxes",
  className,
}: Props) {
  const [open, setOpen] = useState(defaultAdvancedOpen);
  // Track which mode the user is in so we don't fight their input.
  const hasBreakdown =
    num(federal) > 0 || num(ss) > 0 || num(medicare) > 0;

  // Whenever any breakdown value changes, push the sum to the main total.
  const lastSumRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasBreakdown) return;
    const sum = num(federal) + num(ss) + num(medicare);
    const sumStr = sum > 0 ? sum.toFixed(2) : "";
    if (sumStr !== lastSumRef.current) {
      lastSumRef.current = sumStr;
      onTotalChange(sumStr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [federal, ss, medicare, hasBreakdown]);

  // When breakdown is cleared, free the main total for direct edits.
  useEffect(() => {
    if (!hasBreakdown) lastSumRef.current = null;
  }, [hasBreakdown]);

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger type="button" className="text-muted-foreground hover:text-foreground">
              <Info className="h-3 w-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Includes federal income tax, Social Security, and Medicare withheld from this paycheck.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Input
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        value={total}
        readOnly={hasBreakdown}
        onChange={(e) => onTotalChange(e.target.value)}
        className={hasBreakdown ? "bg-muted/40" : ""}
      />
      {hasBreakdown && (
        <p className="text-[10px] text-muted-foreground mt-1">
          Auto-calculated from breakdown below ({fmt(num(total))}).
        </p>
      )}

      <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {open ? "Hide breakdown" : "Show federal/SS/Medicare breakdown"}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-md border border-border p-3 bg-muted/20">
            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">Federal income tax</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0.00"
                value={federal}
                onChange={(e) => onFederalChange(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">Social Security</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0.00"
                value={ss}
                onChange={(e) => onSsChange(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">Medicare</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0.00"
                value={medicare}
                onChange={(e) => onMedicareChange(e.target.value)}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
