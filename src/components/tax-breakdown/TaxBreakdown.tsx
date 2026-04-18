import { useTaxBreakdown } from "@/hooks/useTaxBreakdown";
import SummaryCards from "./SummaryCards";
import IncomeSourceCards from "./IncomeSourceCards";
import TaxSummary from "./TaxSummary";
import MathAccordion from "./MathAccordion";
import { Badge } from "@/components/ui/badge";

interface Props {
  filterCompanyName?: string;
}

export default function TaxBreakdown({ filterCompanyName }: Props) {
  const data = useTaxBreakdown(filterCompanyName);

  if (data.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading tax breakdown…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tax Breakdown</h2>
          <p className="text-sm text-muted-foreground">
            How your taxes are calculated, in plain English.{" "}
            <Badge variant="secondary" className="ml-1 text-[10px]">Estimated</Badge>
          </p>
        </div>
        {filterCompanyName && (
          <Badge variant="outline" className="text-xs">
            Filtered: {filterCompanyName}
          </Badge>
        )}
      </div>

      {/* 1. Summary cards */}
      <SummaryCards
        totalIncome={data.totalGrossIncome}
        taxableIncome={data.totalTaxableIncome}
        estimatedTax={data.totalEstimatedTax}
        effectiveRate={data.effectiveRate}
      />

      {/* 2. Income source cards */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Income sources</h3>
        <IncomeSourceCards sources={data.sources} />
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
