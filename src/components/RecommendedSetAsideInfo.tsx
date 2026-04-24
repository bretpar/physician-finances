import { useState } from "react";
import { Info, CheckCircle2, MinusCircle, AlertTriangle } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTaxSettings } from "@/hooks/useTaxSettings";

interface Props {
  rate: number;
}

interface HintProps {
  personalOn: boolean;
  businessOn: boolean;
  personalToggledNoRate: boolean;
  businessToggledNoRate: boolean;
}

function StateInclusionHint({
  personalOn,
  businessOn,
  personalToggledNoRate,
  businessToggledNoRate,
}: HintProps) {
  const anyOn = personalOn || businessOn;
  const anyToggledNoRate = personalToggledNoRate || businessToggledNoRate;

  let tone: string;
  let Icon = MinusCircle;
  if (anyOn) {
    tone = "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400";
    Icon = CheckCircle2;
  } else if (anyToggledNoRate) {
    tone = "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400";
    Icon = AlertTriangle;
  } else {
    tone = "border-muted-foreground/20 bg-muted/40 text-muted-foreground";
  }

  let label: string;
  if (personalOn && businessOn) label = "State taxes are included (personal + business)";
  else if (personalOn) label = "State taxes are included (personal only)";
  else if (businessOn) label = "State taxes are included (business only)";
  else if (anyToggledNoRate) label = "State tax is enabled but rate is 0% — not contributing";
  else label = "State taxes are not included";

  return (
    <div className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${tone}`}>
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div className="leading-snug">
        <span className="font-medium">{label}</span>
        {!anyOn && !anyToggledNoRate && (
          <span className="block text-[11px] opacity-80 mt-0.5">
            Enable state taxes in Settings to include them in this rate.
          </span>
        )}
        {anyToggledNoRate && (
          <span className="block text-[11px] opacity-80 mt-0.5">
            Set a rate &gt; 0% in Settings → Tax Settings to include it.
          </span>
        )}
      </div>
    </div>
  );
}

function InfoBody(props: HintProps) {
  return (
    <div className="space-y-3 text-sm">
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
      <StateInclusionHint {...props} />
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

  // "Included" means toggle is ON *and* it actually contributes (rate > 0 or, for
  // personal, a flat annual estimate is set). A toggle alone with 0% is misleading.
  const personalOn = !!taxSettings?.stateTaxEnabled && (personalRate > 0 || personalEstimate > 0);
  const businessOn = !!taxSettings?.businessStateTaxEnabled && businessRate > 0;

  // Toggle on but no rate set — surface this as a warning instead of "included".
  const personalToggledNoRate = !!taxSettings?.stateTaxEnabled && !personalOn;
  const businessToggledNoRate = !!taxSettings?.businessStateTaxEnabled && !businessOn;

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
          <InfoBody personalOn={personalOn} businessOn={businessOn} />
        </DialogContent>
      </Dialog>
    </>
  );
}
