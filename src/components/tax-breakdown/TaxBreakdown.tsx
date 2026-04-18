import { useState } from "react";
import { useTaxBreakdown, type TaxBreakdownMode } from "@/hooks/useTaxBreakdown";
import SummaryCards from "./SummaryCards";
import IncomeSourceCards from "./IncomeSourceCards";
import TaxSummary from "./TaxSummary";
import MathAccordion from "./MathAccordion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  filterCompanyName?: string;
}

export default function TaxBreakdown({ filterCompanyName }: Props) {
  const [mode, setMode] = useState<TaxBreakdownMode>("actual");
  const data = useTaxBreakdown(filterCompanyName, mode);

  if (data.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading tax breakdown…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tax Breakdown</h2>
          <p className="text-sm text-muted-foreground">
            How your taxes are calculated, in plain English.{" "}
            <Badge variant="secondary" className="ml-1 text-[10px]">Estimated</Badge>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {filterCompanyName && (
            <Badge variant="outline" className="text-xs">
              Filtered: {filterCompanyName}
            </Badge>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-muted/30">
            <button
              onClick={() => setMode("actual")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                mode === "actual"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Actual Only
            </button>
            <button
              onClick={() => setMode("forecast")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                mode === "forecast"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Actual + Planned
            </button>
          </div>
        </div>
      </div>

      {mode === "forecast" && data.plannedTotalIncome > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
          <span className="font-medium">Planned income included:</span>{" "}
          <span className="tabular-nums">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(data.plannedTotalIncome)}
          </span>{" "}
          <span className="text-muted-foreground">· based on current plan assumptions</span>
        </div>
      )}

      {/* 1. Summary cards */}
      <SummaryCards
        totalIncome={data.totalGrossIncome}
        taxableIncome={data.totalTaxableIncome}
        estimatedTax={data.totalEstimatedTax}
        effectiveRate={data.effectiveRate}
        mode={mode}
      />

      {/* 2. Income source cards */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Income sources</h3>
        <IncomeSourceCards sources={data.sources} mode={mode} />
      </div>

      {/* 3. Tax summary */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Summary</h3>
        <TaxSummary data={data} />
      </div>

      {/* 4. Show calculation details */}
      <MathAccordion data={data} />

      <p className="text-xs text-muted-foreground text-center pt-2">
        These numbers are estimated based on your current inputs. They are not your final filed tax return.
      </p>
    </div>
  );
}
