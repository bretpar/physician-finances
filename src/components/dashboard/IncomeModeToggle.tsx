import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronDown } from "lucide-react";

interface Props {
  /** Force-show even for non-w2 users when premium gating would normally hide the toggle. */
  alwaysShow?: boolean;
  className?: string;
}

export default function IncomeModeToggle({ alwaysShow = false, className }: Props) {
  const { taxMode, setTaxMode } = useTaxEstimate();
  const isPremium = isFeatureEnabled("premium_visibility");
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (!alwaysShow && !isPremium) return null;

  const projection = taxMode === "forecast";
  const labels = {
    actual: "Actual only",
    forecast: "Full year",
  } as const;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Mobile compact dropdown
  if (isMobile) {
    return (
      <div ref={ref} className={cn("relative", className)}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-lg bg-muted/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-none hover:bg-muted transition-colors"
        >
          {projection ? labels.forecast : labels.actual}
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-lg border border-border bg-popover p-1 shadow-sm">
            <button
              type="button"
              onClick={() => { setTaxMode("actual"); setOpen(false); }}
              className={cn(
                "w-full rounded-md px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors",
                !projection ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              {labels.actual}
            </button>
            <button
              type="button"
              onClick={() => { setTaxMode("forecast"); setOpen(false); }}
              className={cn(
                "w-full rounded-md px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors",
                projection ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              {labels.forecast}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Desktop compact segmented control
  return (
    <div
      ref={ref}
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted/80 p-0.5", className)}
      role="tablist"
      aria-label="Income mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={!projection}
        onClick={() => setTaxMode("actual")}
        className={cn(
          "px-2.5 py-[3px] text-[11px] font-medium rounded-md transition-colors",
          !projection ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {labels.actual}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={projection}
        onClick={() => setTaxMode("forecast")}
        className={cn(
          "px-2.5 py-[3px] text-[11px] font-medium rounded-md transition-colors",
          projection ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {labels.forecast}
      </button>
    </div>
  );
}

