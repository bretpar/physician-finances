import { useState } from "react";
import { Info, CheckCircle2, MinusCircle, AlertTriangle } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTaxSettings } from "@/hooks/useTaxSettings";

interface Props {
  rate: number;
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
  personalStatus: LineStatus;
  businessStatus: LineStatus;
  personalDetail?: string;
  businessDetail?: string;
}

function InfoBody({ rate, personalStatus, businessStatus, personalDetail, businessDetail }: BodyProps) {
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border bg-muted/40 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Total tax rate</p>
        <p className="text-3xl font-bold text-primary mt-0.5">{rate.toFixed(1)}%</p>
      </div>

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

export function RecommendedSetAsideInfo({ rate }: Props) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { data: taxSettings } = useTaxSettings();

  const personalRate = Number(taxSettings?.personalStateTaxRate || 0);
  const personalEstimate = Number(taxSettings?.personalStateTaxAnnualEstimate || 0);
  const businessRate = Number(taxSettings?.businessStateTaxRate || 0);

  const personalEnabled = !!taxSettings?.stateTaxEnabled;
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>How this is calculated</DialogTitle>
          </DialogHeader>
          <InfoBody
            rate={rate}
            personalStatus={personalStatus}
            businessStatus={businessStatus}
            personalDetail={personalDetail}
            businessDetail={businessDetail}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
