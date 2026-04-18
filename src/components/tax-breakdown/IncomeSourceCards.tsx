import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, Briefcase, Wallet, TrendingUp, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { getScheduleCMeta } from "@/lib/scheduleC";
import { getFilingMeta } from "@/lib/filingTypes";
import type {
  IncomeSourceBreakdown,
  BusinessBreakdown,
  W2Breakdown,
  CapGainsBreakdown,
  OtherIncomeBreakdown,
} from "@/hooks/useTaxBreakdown";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function Row({
  label,
  value,
  bold,
  muted,
  positive,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className={cn(muted ? "text-muted-foreground" : "text-foreground")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold ? "font-semibold" : "font-medium",
          positive ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function BusinessCard({ data }: { data: BusinessBreakdown }) {
  const [open, setOpen] = useState(false);
  const meta = getFilingMeta(data.filingType);
  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Briefcase className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{data.companyName}</p>
              <Badge variant="secondary" className="mt-0.5 text-[10px] font-normal">
                {meta.label}
              </Badge>
            </div>
          </div>
          <p className="text-lg font-bold tabular-nums shrink-0">{fmt(data.profit)}</p>
        </div>

        <div className="space-y-1.5 pt-1">
          <Row label="Revenue" value={fmt(data.revenue)} muted />
          <Row label="Expenses" value={`−${fmt(data.expenses)}`} muted />
          <div className="border-t border-border pt-1.5">
            <Row label="Profit" value={fmt(data.profit)} bold />
          </div>
        </div>

        {data.expenseCategories.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between h-8 px-2 text-muted-foreground"
              onClick={() => setOpen((v) => !v)}
            >
              <span className="text-xs">
                Show expense categories ({data.expenseCategories.length})
              </span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            </Button>
            {open && (
              <div className="space-y-1.5 pt-1 pl-1">
                {data.expenseCategories.map((c) => {
                  const meta = getScheduleCMeta(c.category);
                  return (
                    <div key={c.category} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {meta.label}{" "}
                        <span className="text-xs">({c.count})</span>
                      </span>
                      <span className="tabular-nums font-medium">{fmt(c.total)}</span>
                    </div>
                  );
                })}
                <div className="border-t border-border pt-1.5 flex justify-between text-sm font-semibold">
                  <span>Total expenses</span>
                  <span className="tabular-nums">{fmt(data.expenses)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function W2Card({ data }: { data: W2Breakdown }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Wallet className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{data.companyName}</p>
              <Badge variant="secondary" className="mt-0.5 text-[10px] font-normal">W-2 Employment</Badge>
            </div>
          </div>
          <p className="text-lg font-bold tabular-nums shrink-0">{fmt(data.grossWages)}</p>
        </div>
        <div className="space-y-1.5 pt-1">
          <Row label="Gross wages" value={fmt(data.grossWages)} muted />
          <Row label="Federal tax withheld" value={`−${fmt(data.federalWithheld)}`} muted />
          {data.stateWithheld > 0 && <Row label="State tax withheld" value={`−${fmt(data.stateWithheld)}`} muted />}
          {data.preTaxDeductions > 0 && <Row label="Pre-tax deductions" value={`−${fmt(data.preTaxDeductions)}`} muted />}
          {data.retirement401k > 0 && <Row label="401(k) contribution" value={`−${fmt(data.retirement401k)}`} muted />}
          <div className="border-t border-border pt-1.5">
            <Row label="Taxable wages" value={fmt(data.taxableWages)} bold />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CapGainsCard({ data }: { data: CapGainsBreakdown }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{data.source}</p>
              <Badge variant="secondary" className="mt-0.5 text-[10px] font-normal">Capital Gains</Badge>
            </div>
          </div>
          <p className="text-lg font-bold tabular-nums shrink-0">{fmt(data.net)}</p>
        </div>
        <div className="space-y-1.5 pt-1">
          {data.shortTerm > 0 && <Row label="Short-term gains" value={fmt(data.shortTerm)} muted />}
          {data.longTerm > 0 && <Row label="Long-term gains" value={fmt(data.longTerm)} muted />}
          {data.losses > 0 && <Row label="Losses" value={`−${fmt(data.losses)}`} muted />}
          <div className="border-t border-border pt-1.5">
            <Row label="Net capital gain" value={fmt(data.net)} bold />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OtherCard({ data }: { data: OtherIncomeBreakdown }) {
  const meta = getFilingMeta(data.filingType);
  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
              <Receipt className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{data.companyName}</p>
              <Badge variant="secondary" className="mt-0.5 text-[10px] font-normal">{meta.label}</Badge>
            </div>
          </div>
          <p className="text-lg font-bold tabular-nums shrink-0">{fmt(data.grossAmount)}</p>
        </div>
        <div className="space-y-1.5 pt-1">
          <Row label="Gross amount" value={fmt(data.grossAmount)} muted />
          <div className="border-t border-border pt-1.5">
            <Row label="Taxable amount" value={fmt(data.taxableAmount)} bold />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function IncomeSourceCards({ sources }: { sources: IncomeSourceBreakdown[] }) {
  if (sources.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No income sources yet. Add income or business activity to see your breakdown.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {sources.map((s, i) => {
        if (s.kind === "business") return <BusinessCard key={i} data={s} />;
        if (s.kind === "w2") return <W2Card key={i} data={s} />;
        if (s.kind === "capital_gains") return <CapGainsCard key={i} data={s} />;
        return <OtherCard key={i} data={s} />;
      })}
    </div>
  );
}
