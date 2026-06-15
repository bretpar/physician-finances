import { useState } from "react";
import { Info, CheckCircle2, MinusCircle, AlertTriangle } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import type { SavingsRateResult } from "@/lib/savingsRateSelection";
import { getK1TreatmentMeta, type K1TaxTreatment } from "@/lib/k1TaxTreatment";

export interface TaxableBaseBreakdown {
  gross: number;
  retirement401k?: number;
  healthInsurance?: number;
  hsa?: number;
  otherPreTax?: number;
}

interface Props {
  rate: number;
  breakdown?: SavingsRateResult | null;
  taxableBase?: TaxableBaseBreakdown;
  /** Optional K-1 entity tax treatment for K-1 entries. */
  k1Treatment?: K1TaxTreatment | null;
  /** True when the linked entity is a K-1 partnership. */
  isK1?: boolean;
}

type LineStatus = "included" | "no-rate" | "off";

interface LineProps {
  label: string;
  status: LineStatus;
  detail?: string;
}

function StateLine({ label, status, detail }: LineProps) {
  let tone: string;
  let Icon = MinusCircle;
  let statusText: string;

  if (status === "included") {
    tone = "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400";
    Icon = CheckCircle2;
    statusText = "Included";
  } else if (status === "no-rate") {
    tone = "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400";
    Icon = AlertTriangle;
    statusText = "Enabled · 0% rate";
  } else {
    tone = "border-muted-foreground/20 bg-muted/40 text-muted-foreground";
    statusText = "Not included";
  }

  return (
    <div className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${tone}`}>
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div className="leading-snug flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{label}</span>
          <span className="text-[11px] opacity-90 shrink-0">{statusText}</span>
        </div>
        {detail && (
          <span className="block text-[11px] opacity-80 mt-0.5">{detail}</span>
        )}
      </div>
    </div>
  );
}

interface BodyProps {
  rate: number;
  breakdown?: SavingsRateResult | null;
  personalStatus: LineStatus;
  businessStatus: LineStatus;
  personalDetail?: string;
  businessDetail?: string;
  taxableBase?: TaxableBaseBreakdown;
  k1Treatment?: K1TaxTreatment | null;
  isK1?: boolean;
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

function TaxableBasePanel({ tb }: { tb: TaxableBaseBreakdown }) {
  const r = Math.max(0, tb.retirement401k ?? 0);
  const h = Math.max(0, tb.healthInsurance ?? 0);
  const hsa = Math.max(0, tb.hsa ?? 0);
  const other = Math.max(0, tb.otherPreTax ?? 0);
  const totalDeductions = r + h + hsa + other;
  const base = Math.max(0, tb.gross - totalDeductions);
  const Row = ({ label, value, sign = "−", tone = "muted" }: { label: string; value: number; sign?: string; tone?: "muted" | "default" }) => (
    <div className="flex justify-between gap-3">
      <span className={tone === "muted" ? "text-muted-foreground" : "text-foreground"}>{label}</span>
      <span className="tabular-nums text-foreground">{sign}{fmtUsd(value)}</span>
    </div>
  );
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Taxable base</p>
      <Row label="Gross income" value={tb.gross} sign="" tone="default" />
      <Row label="Retirement / 401(k)" value={r} />
      <Row label="Health insurance" value={h} />
      <Row label="HSA contribution" value={hsa} />
      <Row label="Other pre-tax" value={other} />
      <div className="border-t border-border my-1" />
      <div className="flex justify-between gap-3 font-semibold">
        <span className="text-foreground">Taxable base</span>
        <span className="tabular-nums text-primary">{fmtUsd(base)}</span>
      </div>
      <p className="text-[10px] text-muted-foreground pt-1 leading-snug">
        Recommended set-aside = taxable base × total tax rate.
      </p>
    </div>
  );
}

function InfoBody({ rate, breakdown, personalStatus, businessStatus, personalDetail, businessDetail, taxableBase, k1Treatment, isK1 }: BodyProps) {
  const sourceLabel = breakdown?.baseRateSource === "federalEffectiveRate"
    ? "federalEffectiveRate"
    : breakdown?.baseRateSource === "effectiveRate"
      ? "effectiveRate"
      : "manualEffectiveTaxRate";
  const components = breakdown?.components;
  const k1Meta = getK1TreatmentMeta(k1Treatment);
  const seCapped = !!components?.seSocialSecurityCapped;

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border bg-muted/40 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Total tax rate</p>
        <p className="text-3xl font-bold text-primary mt-0.5">{rate.toFixed(1)}%</p>
      </div>

      {isK1 && (
        k1Meta ? (
          <div className={`rounded-md border px-3 py-2 text-xs ${k1Meta.seTaxable ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" : "border-border bg-muted/40 text-foreground"}`}>
            <p className="font-medium">
              K-1 treatment: {k1Meta.shortLabel} — {k1Meta.seTaxable ? "SE tax included" : "SE tax not applied"}
            </p>
            <p className="text-[11px] opacity-80 mt-0.5 leading-snug">{k1Meta.description}</p>
            {k1Meta.seTaxable && seCapped && (
              <p className="text-[11px] opacity-80 mt-1 leading-snug">
                Social Security SE tax may be reduced because prior W-2 wages already count toward the annual Social Security wage base.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 px-3 py-2 text-xs flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              K-1 tax treatment is not set. Active partnership income may require self-employment tax. Please confirm whether this K-1 is active, passive, guaranteed payment, or S-corp distribution in Settings → Companies.
            </span>
          </div>
        )
      )}



      <p className="text-foreground">
        This amount is based on your total tax rate, which may include:
      </p>
      <ul className="space-y-1 text-foreground/90 list-disc pl-5">
        <li>Federal income taxes</li>
        <li>Business taxes</li>
        <li>Self-employment taxes (Social Security &amp; Medicare)</li>
        <li>Additional self-employment tax burden (1099 / K-1 income)</li>
        <li>State taxes (if enabled)</li>
      </ul>

      <div className="space-y-2">
        {taxableBase && <TaxableBasePanel tb={taxableBase} />}
        {breakdown && (
          <div className="rounded-md border bg-background px-3 py-2 text-xs text-foreground">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Base rate source</span>
              <span className="font-mono text-muted-foreground">{sourceLabel}</span>
            </div>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <div className="flex justify-between gap-3"><span>Federal base</span><span>{(components?.federal ?? 0).toFixed(2)}%</span></div>
              {(components?.selfEmployment ?? 0) > 0 || components?.seSocialSecurityCapped ? (
                <>
                  <div className="flex justify-between gap-3 pt-1">
                    <span className="font-medium text-foreground">Self-employment tax</span>
                    <span>{(components?.selfEmployment ?? 0).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between gap-3 pl-3">
                    <span>↳ SE Social Security</span>
                    <span className={components?.seSocialSecurityCapped ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>
                      {components?.seSocialSecurityCapped
                        ? "$0 · wage base reached"
                        : `${(components?.seSocialSecurity ?? 0).toFixed(2)}%`}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 pl-3">
                    <span>↳ SE Medicare</span>
                    <span>{(components?.seMedicare ?? 0).toFixed(2)}%</span>
                  </div>
                  {(components?.seAdditionalMedicare ?? 0) > 0 && (
                    <div className="flex justify-between gap-3 pl-3">
                      <span>↳ Additional Medicare (0.9%)</span>
                      <span>{(components?.seAdditionalMedicare ?? 0).toFixed(2)}%</span>
                    </div>
                  )}
                  {components?.seWageBaseDetail && (
                    <SsWageBasePanel
                      detail={components.seWageBaseDetail}
                      seSocialSecurityPct={components?.seSocialSecurity ?? 0}
                      isCapped={!!components?.seSocialSecurityCapped}
                    />
                  )}
                </>
              ) : (
                <div className="flex justify-between gap-3"><span>Self-employment tax</span><span>Not added</span></div>
              )}
              <div className="flex justify-between gap-3"><span>Business state/B&amp;O</span><span>{(components?.businessState ?? 0) > 0 ? `Added ${(components?.businessState ?? 0).toFixed(2)}%` : "Not added"}</span></div>
            </div>
          </div>
        )}
        <StateLine
          label="Personal state income tax"
          status={personalStatus}
          detail={personalDetail}
        />
        <StateLine
          label="Business state tax"
          status={businessStatus}
          detail={businessDetail}
        />
      </div>

      <p className="text-xs text-muted-foreground pt-1">
        Based on your current + planned income
      </p>
    </div>
  );
}

export function RecommendedSetAsideInfo({ rate, breakdown, taxableBase, k1Treatment, isK1 }: Props) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { data: taxSettings } = useTaxSettings();

  const personalRate = Number(taxSettings?.personalStateTaxRate || 0);
  const personalEstimate = Number(taxSettings?.personalStateTaxAnnualEstimate || 0);
  const businessRate = Number(taxSettings?.businessStateTaxRate || 0);

  const personalEnabled = !!taxSettings?.stateIncomeTaxEnabled;
  const businessEnabled = !!taxSettings?.businessStateTaxEnabled;

  const personalContributes = personalRate > 0 || personalEstimate > 0;
  const businessContributes = businessRate > 0;

  const personalStatus: LineStatus = !personalEnabled
    ? "off"
    : personalContributes
      ? "included"
      : "no-rate";

  const businessStatus: LineStatus = !businessEnabled
    ? "off"
    : businessContributes
      ? "included"
      : "no-rate";

  const personalDetail =
    personalStatus === "included"
      ? personalRate > 0
        ? `${personalRate.toFixed(2)}% rate`
        : `$${personalEstimate.toLocaleString()}/yr estimate`
      : personalStatus === "no-rate"
        ? "Set a rate in Settings → Tax Settings"
        : "Enable in Settings to include";

  const businessDetail =
    businessStatus === "included"
      ? `${businessRate.toFixed(2)}% rate`
      : businessStatus === "no-rate"
        ? "Set a rate in Settings → Tax Settings"
        : "Enable in Settings to include";

  const triggerBtn = (
    <button
      type="button"
      aria-label="How this is calculated"
      onClick={() => setOpen(true)}
      className="inline-flex items-center justify-center align-middle ml-0.5 h-6 w-6 -my-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <Info className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <>
      {isMobile ? (
        triggerBtn
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{triggerBtn}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="font-medium mb-1">How this is calculated</p>
            <p className="text-xs">
              Your total tax rate ({rate.toFixed(1)}%) blends federal, business, self-employment,
              and state taxes (if enabled). Tap for details.
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="p-0 gap-0 flex flex-col w-full sm:max-w-md max-h-[85vh] overflow-hidden
            max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0
            max-sm:max-w-full max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0
            sm:rounded-lg"
        >
          <DialogHeader className="sticky top-0 z-10 flex flex-row items-center justify-between gap-3 border-b bg-background px-4 py-3 space-y-0 text-left">
            <DialogTitle className="text-base font-semibold">How this is calculated</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4">
            <InfoBody
              rate={rate}
              breakdown={breakdown}
              personalStatus={personalStatus}
              businessStatus={businessStatus}
              personalDetail={personalDetail}
              businessDetail={businessDetail}
              taxableBase={taxableBase}
              k1Treatment={k1Treatment}
              isK1={isK1}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
