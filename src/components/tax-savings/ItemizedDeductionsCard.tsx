import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useTaxSettings, useUpdateTaxSettings } from "@/hooks/useTaxSettings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { computeItemizedDeductions, selectDeduction } from "@/lib/saltDeduction";
import type { FilingStatus } from "@/lib/taxBrackets";

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
/** A dollar field is invalid only when the user typed a negative number. */
const isNegative = (v: string) => {
  const t = (v ?? "").trim();
  if (t === "") return false;
  const n = parseFloat(t);
  return Number.isFinite(n) && n < 0;
};
const DOLLAR_FIELDS = [
  "propertyTax",
  "personalPropertyTax",
  "stateIncomeTaxManual",
  "salesTaxBase",
  "salesTaxLargePurchases",
  "mortgageInterest",
  "mortgageBalance",
  "saltCapOverride",
  "otherItemizedDeductions",
] as const;

interface FormState {
  propertyTax: string;
  stateIncomeTaxMode: "estimate" | "manual";
  stateIncomeTaxManual: string;
  salesTaxBase: string;
  salesTaxLargePurchases: string;
  personalPropertyTax: string;
  forceSalesTaxElection: boolean;
  saltCapOverride: string;
  otherItemizedDeductions: string;
  mortgageInterest: string;
  mortgageBalance: string;
}

/**
 * Developer MVP: SALT + itemized deduction entry.
 * All math comes from `@/lib/saltDeduction` — never re-implement the cap or
 * phase-down here, and never duplicate the standard-vs-itemized comparison.
 */
export function ItemizedDeductionsCard() {
  const { data: taxSettings } = useTaxSettings();
  const updateTaxSettings = useUpdateTaxSettings();
  const { estimate } = useTaxEstimate();

  const [form, setForm] = useState<FormState>({
    propertyTax: "",
    stateIncomeTaxMode: "estimate",
    stateIncomeTaxManual: "",
    salesTaxBase: "",
    salesTaxLargePurchases: "",
    personalPropertyTax: "",
    forceSalesTaxElection: false,
    saltCapOverride: "",
    otherItemizedDeductions: "",
    mortgageInterest: "",
    mortgageBalance: "",
  });

  useEffect(() => {
    if (!taxSettings) return;
    const s = taxSettings as any;
    setForm({
      propertyTax: s.saltPropertyTax ? String(s.saltPropertyTax) : "",
      stateIncomeTaxMode: s.saltStateIncomeTaxMode === "manual" ? "manual" : "estimate",
      stateIncomeTaxManual: s.saltStateIncomeTaxManual ? String(s.saltStateIncomeTaxManual) : "",
      salesTaxBase: s.saltSalesTaxBase ? String(s.saltSalesTaxBase) : "",
      salesTaxLargePurchases: s.saltSalesTaxLargePurchases ? String(s.saltSalesTaxLargePurchases) : "",
      personalPropertyTax: s.saltPersonalPropertyTax ? String(s.saltPersonalPropertyTax) : "",
      forceSalesTaxElection: !!s.saltForceSalesTaxElection,
      saltCapOverride: s.saltCapOverride != null ? String(s.saltCapOverride) : "",
      otherItemizedDeductions: s.itemizedOtherDeductions ? String(s.itemizedOtherDeductions) : "",
      mortgageInterest: s.itemizedMortgageInterest ? String(s.itemizedMortgageInterest) : "",
      mortgageBalance: s.itemizedMortgageBalance != null ? String(s.itemizedMortgageBalance) : "",
    });
  }, [taxSettings]);

  const filingStatus = ((taxSettings?.filingStatus as FilingStatus) || "single") as FilingStatus;
  const enabled = !!(taxSettings as any)?.itemizedDeductionsEnabled;
  const savedStateEstimate = Number(taxSettings?.personalStateTaxAnnualEstimate || 0);
  const stateWithheldEstimate = Number(estimate?.stateWithheld || 0);
  const stateIncomeTaxEstimate = savedStateEstimate > 0 ? savedStateEstimate : stateWithheldEstimate;
  const magi = Math.max(0, Number(estimate?.agi || 0));

  // Live preview from the current (unsaved) form values.
  const preview = computeItemizedDeductions({
    propertyTax: num(form.propertyTax),
    stateIncomeTaxMode: form.stateIncomeTaxMode,
    stateIncomeTaxEstimate,
    stateIncomeTaxManual: num(form.stateIncomeTaxManual),
    salesTaxBase: num(form.salesTaxBase),
    salesTaxLargePurchases: num(form.salesTaxLargePurchases),
    personalPropertyTax: num(form.personalPropertyTax),
    forceSalesTaxElection: form.forceSalesTaxElection,
    saltCapOverride: form.saltCapOverride.trim() === "" ? null : num(form.saltCapOverride),
    otherItemizedDeductions: num(form.otherItemizedDeductions),
    mortgageInterest: num(form.mortgageInterest),
    mortgageBalance: form.mortgageBalance.trim() === "" ? null : num(form.mortgageBalance),
    filingStatus,
    magi,
  });
  const selection = selectDeduction({
    filingStatus,
    itemizedTotal: preview.totalItemized,
    standardDeductionOverride: taxSettings?.standardDeductionOverride ?? null,
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Negative dollar amounts are never valid. We surface an inline error and
  // block saving instead of silently persisting 0 for what the user sees.
  const invalidFields = DOLLAR_FIELDS.filter((k) => isNegative(form[k] as string));
  const hasInvalid = invalidFields.length > 0;

  const save = (extra: Record<string, unknown> = {}) => {
    if (!taxSettings?.id) return;
    if (hasInvalid) return;
    updateTaxSettings.mutate({
      id: taxSettings.id,
      saltPropertyTax: num(form.propertyTax),
      saltStateIncomeTaxMode: form.stateIncomeTaxMode,
      saltStateIncomeTaxManual: num(form.stateIncomeTaxManual),
      saltSalesTaxBase: num(form.salesTaxBase),
      saltSalesTaxLargePurchases: num(form.salesTaxLargePurchases),
      saltPersonalPropertyTax: num(form.personalPropertyTax),
      saltForceSalesTaxElection: form.forceSalesTaxElection,
      saltCapOverride: form.saltCapOverride.trim() === "" ? null : num(form.saltCapOverride),
      itemizedOtherDeductions: num(form.otherItemizedDeductions),
      itemizedMortgageInterest: num(form.mortgageInterest),
      itemizedMortgageBalance: form.mortgageBalance.trim() === "" ? null : num(form.mortgageBalance),
      ...extra,
    } as any);
  };

  const field = (id: keyof FormState, label: string, hint?: string) => {
    const invalid = isNegative(form[id] as string);
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`itemized-${id}`}>{label}</Label>
        <Input
          id={`itemized-${id}`}
          data-testid={`itemized-${id}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `itemized-${id}-error` : undefined}
          className="min-h-[44px]"
          value={form[id] as string}
          onChange={(e) => set(id, e.target.value as FormState[typeof id])}
        />
        {invalid && (
          <p
            id={`itemized-${id}-error`}
            role="alert"
            data-testid={`itemized-${id}-error`}
            className="text-xs text-destructive"
          >
            Enter 0 or a positive amount.
          </p>
        )}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-5" data-testid="itemized-deductions-card">
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
        <div>
          <p className="text-sm font-medium">Use itemized deductions</p>
          <p className="text-xs text-muted-foreground">
            When on, your tax estimate applies the greater of your standard deduction and your itemized total.
          </p>
        </div>
        <Switch
          id="itemized-enabled-toggle"
          data-testid="itemized-enabled-toggle"
          aria-label="Use itemized deductions"
          checked={enabled}
          disabled={!taxSettings?.id || updateTaxSettings.isPending || hasInvalid}
          onCheckedChange={(v) => save({ itemizedDeductionsEnabled: v })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("propertyTax", "Property taxes ($)", "Real-estate taxes paid on your home(s).")}
        {field("personalPropertyTax", "Personal property tax ($)", "Value-based vehicle registration, etc.")}
      </div>

      <div className="space-y-2">
        <Label>State income or sales tax</Label>
        <RadioGroup
          value={form.stateIncomeTaxMode}
          onValueChange={(v) => set("stateIncomeTaxMode", v === "manual" ? "manual" : "estimate")}
          className="flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="estimate" id="salt-mode-estimate" />
            <Label htmlFor="salt-mode-estimate" className="font-normal">
              Use my estimated state income tax ({fmt(stateIncomeTaxEstimate)})
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="manual" id="salt-mode-manual" />
            <Label htmlFor="salt-mode-manual" className="font-normal">Enter state income tax manually</Label>
          </div>
        </RadioGroup>
        {form.stateIncomeTaxMode === "manual" && field("stateIncomeTaxManual", "State income tax paid ($)")}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("salesTaxBase", "State & local sales tax ($)", "Table estimate or actual general sales tax.")}
        {field("salesTaxLargePurchases", "Sales tax on large purchases ($)", "Car, boat, or major home materials.")}
      </div>

      <div className="space-y-3" data-testid="itemized-mortgage-section">
        <div>
          <p className="text-sm font-medium">Mortgage interest</p>
          <p className="text-xs text-muted-foreground">
            Qualified home mortgage interest from your Form 1098. Interest above the{" "}
            {fmt(preview.mortgageDebtLimit)} acquisition-debt limit is prorated automatically.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("mortgageInterest", "Mortgage interest paid ($)", "Box 1 of your Form 1098.")}
          {field("mortgageBalance", "Average mortgage balance ($)", "Optional — only needed if your loan exceeds the debt limit.")}
        </div>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm font-medium">
          Advanced overrides
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Always elect sales tax</p>
              <p className="text-xs text-muted-foreground">
                By default we use whichever is larger — state income tax or sales tax.
              </p>
            </div>
            <Switch
              id="itemized-force-sales-tax"
              data-testid="itemized-force-sales-tax"
              aria-label="Always elect sales tax"
              checked={form.forceSalesTaxElection}
              onCheckedChange={(v) => set("forceSalesTaxElection", v)}
            />
          </div>
          {field("saltCapOverride", "SALT cap override ($)", "Leave blank to use the 2026 cap and phase-down.")}
          {field("otherItemizedDeductions", "Other itemized deductions ($)", "Charitable giving, etc. (mortgage interest is entered above).")}
        </CollapsibleContent>
      </Collapsible>

      <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5" data-testid="itemized-summary">
        <Row label="State tax elected" value={`${fmt(preview.electedStateTaxAmount)} (${preview.electedStateTaxType === "sales" ? "sales tax" : "income tax"})`} />
        <Row label="SALT before cap" value={fmt(preview.saltBeforeCap)} />
        <Row label="SALT cap applied" value={fmt(preview.effectiveCap)} />
        {preview.phaseDownAmount > 0 && (
          <Row label="Cap reduced by income phase-down" value={`− ${fmt(preview.phaseDownAmount)}`} />
        )}
        <Row label="SALT deduction allowed" value={fmt(preview.saltDeduction)} strong />
        {preview.saltDisallowed > 0 && (
          <Row label="SALT lost to the cap" value={fmt(preview.saltDisallowed)} />
        )}
        <Row label="Mortgage interest deductible" value={fmt(preview.mortgageInterestDeductible)} />
        {preview.mortgageInterestDisallowed > 0 && (
          <Row label="Mortgage interest over the debt limit" value={`− ${fmt(preview.mortgageInterestDisallowed)}`} />
        )}
        <Row label="Other itemized deductions" value={fmt(preview.otherItemizedDeductions)} />
        <Row label="Total itemized" value={fmt(preview.totalItemized)} strong />
        <Row label="Standard deduction" value={fmt(selection.standardDeduction)} />
        <p className="pt-1 text-xs text-muted-foreground" data-testid="itemized-decision">
          {selection.deductionType === "itemized"
            ? `Itemizing wins by ${fmt(selection.itemizingBenefit)} — we'll apply ${fmt(selection.deductionApplied)}.`
            : `Your standard deduction of ${fmt(selection.standardDeduction)} is larger, so we'll use that.`}
        </p>
      </div>

      {hasInvalid && (
        <p role="alert" data-testid="itemized-validation-summary" className="text-sm text-destructive">
          Fix the highlighted amounts before saving — negative values aren't allowed.
        </p>
      )}

      <Button
        className="w-full sm:w-auto min-h-[44px]"
        data-testid="itemized-save"
        disabled={updateTaxSettings.isPending || !taxSettings?.id || hasInvalid}
        onClick={() => save()}
      >
        Save Itemized Deductions
      </Button>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "font-medium tabular-nums"}>{value}</span>
    </div>
  );
}
