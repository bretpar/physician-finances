import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/DateField";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useUpsertYtdCatchup, type YtdCatchupEntry, type YtdCatchupSourceType } from "@/hooks/useYtdCatchup";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import type { IncomeProfileType } from "@/lib/onboarding";

interface Props {
  initial?: YtdCatchupEntry;
  onSaved?: () => void;
  onCancel?: () => void;
  incomeProfileType?: IncomeProfileType;
}

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function YtdCatchupForm({ initial, onSaved, onCancel, incomeProfileType }: Props) {
  const upsert = useUpsertYtdCatchup();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: taxSettings } = useTaxSettings();
  const stateEnabled = !!taxSettings && (taxSettings as any).stateTaxEnabled !== false;

  const taxYear = new Date().getFullYear();
  const yearStart = `${taxYear}-01-01`;
  const today = new Date().toISOString().split("T")[0];

  // Determine the locked / default source type from the profile.
  const lockedSource: YtdCatchupSourceType | null =
    incomeProfileType === "w2_only" ? "w2"
    : incomeProfileType === "business_only" ? "1099_k1"
    : null;

  const [sourceType, setSourceType] = useState<YtdCatchupSourceType>(
    initial?.source_type ?? lockedSource ?? "w2"
  );

  // Keep sourceType in sync if profile locks it after mount.
  useEffect(() => {
    if (lockedSource && sourceType !== lockedSource && !initial) {
      setSourceType(lockedSource);
    }
  }, [lockedSource, initial, sourceType]);

  const [companyName, setCompanyName] = useState(initial?.company_name ?? "");
  const [periodStart, setPeriodStart] = useState(initial?.period_start ?? yearStart);
  const [periodEnd, setPeriodEnd] = useState(initial?.period_end ?? today);
  const [grossIncome, setGrossIncome] = useState(String(initial?.gross_income ?? ""));
  const [fedWh, setFedWh] = useState(String(initial?.federal_withholding ?? ""));
  const [stateWh, setStateWh] = useState(String(initial?.state_withholding ?? ""));
  const [ssWh, setSsWh] = useState(String(initial?.ss_withholding ?? ""));
  const [medWh, setMedWh] = useState(String(initial?.medicare_withholding ?? ""));
  const [showPretax, setShowPretax] = useState(true);
  const [r401k, setR401k] = useState(String(initial?.retirement_401k ?? ""));
  const [hsa, setHsa] = useState(String(initial?.hsa_contribution ?? ""));
  const [healthcare, setHealthcare] = useState(String(initial?.healthcare_premiums ?? ""));
  const [dental, setDental] = useState(String(initial?.dental_vision ?? ""));
  const [otherPretax, setOtherPretax] = useState(String(initial?.other_pretax ?? ""));
  const [showPosttax, setShowPosttax] = useState(false);
  const [postTax, setPostTax] = useState(String(initial?.post_tax_deductions ?? ""));
  const [error, setError] = useState<string | null>(null);

  const overlap = useMemo(() => {
    if (!incomeEntries?.length) return 0;
    return incomeEntries.filter((e) => e.income_date >= periodStart && e.income_date <= periodEnd).length;
  }, [incomeEntries, periodStart, periodEnd]);

  const isW2Source = sourceType === "w2";
  const is1099OnlyProfile = incomeProfileType === "business_only";
  const isW2OnlyProfile = incomeProfileType === "w2_only";
  const showSourceDropdown = !lockedSource;
  const showPretaxSection = isW2Source; // pre-tax payroll deductions only meaningful for W-2

  const description = isW2OnlyProfile
    ? "Enter your year-to-date W-2 income and taxes withheld from your most recent paystub."
    : is1099OnlyProfile
      ? "Enter your year-to-date business income. Use gross income before expenses, and enter any estimated taxes already paid."
      : "Add each income source you have earned from this year. Add W-2 paystub totals and any 1099/K-1 gross income and taxes already paid.";

  const companyLabel = isW2Source ? "Employer name" : "Company / business name";
  const companyPlaceholder = isW2Source ? "e.g. Providence" : "e.g. Consulting LLC";
  const fedLabel = isW2Source ? "Federal withheld YTD" : "Federal estimated taxes paid YTD";
  const stateLabel = isW2Source ? "State withheld YTD" : "State estimated taxes paid YTD";

  const submit = async () => {
    if (upsert.isPending) return; // guard against duplicate submits from repeated clicks
    setError(null);
    if (!companyName.trim()) {
      return setError(isW2Source ? "Enter the employer name." : "Enter the company or business name.");
    }
    if (periodEnd < periodStart) return setError("End date cannot be before start date.");
    if (grossIncome.trim() === "") return setError("Enter your total gross income year-to-date.");
    const gross = num(grossIncome);
    if (gross <= 0) return setError("Gross income must be greater than zero.");
    if (isW2Source && fedWh.trim() === "") {
      return setError("Enter federal tax withheld year-to-date (enter 0 if none).");
    }
    const negs = [fedWh, stateWh, ssWh, medWh, r401k, hsa, healthcare, dental, otherPretax, postTax].map(num);
    if (negs.some((n) => n < 0)) return setError("Withholdings and deductions cannot be negative.");

    await upsert.mutateAsync({
      id: initial?.id,
      tax_year: taxYear,
      source_type: sourceType,
      company_name: companyName.trim(),
      period_start: periodStart,
      period_end: periodEnd,
      gross_income: gross,
      federal_withholding: num(fedWh),
      state_withholding: num(stateWh),
      ss_withholding: isW2Source ? num(ssWh) : 0,
      medicare_withholding: isW2Source ? num(medWh) : 0,
      retirement_401k: isW2Source ? num(r401k) : 0,
      hsa_contribution: isW2Source ? num(hsa) : 0,
      healthcare_premiums: isW2Source ? num(healthcare) : 0,
      dental_vision: isW2Source ? num(dental) : 0,
      other_pretax: isW2Source ? num(otherPretax) : 0,
      post_tax_deductions: num(postTax),
    });
    onSaved?.();
  };

  const lockedLabel = lockedSource === "w2"
    ? "W-2 employer paystub"
    : lockedSource === "1099_k1"
      ? "1099 / K-1 business income"
      : null;

  const hiddenNote = lockedSource === "w2"
    ? "Showing W-2 paystub fields. 1099 / K-1 estimated-tax fields are hidden because you selected W-2 only."
    : lockedSource === "1099_k1"
      ? "Showing business income fields. W-2 payroll fields (Social Security, Medicare, pre-tax payroll deductions) are hidden because you selected business income only."
      : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{description}</p>

      {lockedLabel && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <p className="font-medium text-foreground">Income type: {lockedLabel}</p>
          {hiddenNote && <p className="mt-0.5 text-muted-foreground">{hiddenNote}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {showSourceDropdown && (
          <div>
            <Label>Income source type</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as YtdCatchupSourceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="w2">W-2 employer</SelectItem>
                <SelectItem value="1099_k1">1099 / K-1 company</SelectItem>
                <SelectItem value="other">Other income</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className={showSourceDropdown ? "" : "sm:col-span-2"}>
          <Label htmlFor="ytd-company-name">{companyLabel}</Label>
          <Input
            id="ytd-company-name"
            data-testid="ytd-catchup-company-name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder={companyPlaceholder}
          />
        </div>
        <div>
          <Label>Period start</Label>
          <DateField value={periodStart} onChange={setPeriodStart} />
        </div>
        <div>
          <Label>Period end</Label>
          <DateField value={periodEnd} onChange={setPeriodEnd} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ytd-gross-income">Total gross income YTD</Label>
          <Input id="ytd-gross-income" data-testid="ytd-catchup-gross-income" type="number" inputMode="decimal" value={grossIncome} onChange={(e) => setGrossIncome(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label htmlFor="ytd-fed-withheld">{fedLabel}</Label>
          <Input id="ytd-fed-withheld" data-testid="ytd-catchup-federal-withheld" type="number" inputMode="decimal" value={fedWh} onChange={(e) => setFedWh(e.target.value)} placeholder="0.00" />
        </div>
        {stateEnabled && (
          <div>
            <Label htmlFor="ytd-state-withheld">{stateLabel}</Label>
            <Input id="ytd-state-withheld" data-testid="ytd-catchup-state-withheld" type="number" inputMode="decimal" value={stateWh} onChange={(e) => setStateWh(e.target.value)} placeholder="0.00" />
          </div>
        )}
        {isW2Source && (
          <>
            <div>
              <Label htmlFor="ytd-ss-withheld">Social Security YTD <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input id="ytd-ss-withheld" data-testid="ytd-catchup-ss-withheld" type="number" inputMode="decimal" value={ssWh} onChange={(e) => setSsWh(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label htmlFor="ytd-medicare-withheld">Medicare YTD <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input id="ytd-medicare-withheld" data-testid="ytd-catchup-medicare-withheld" type="number" inputMode="decimal" value={medWh} onChange={(e) => setMedWh(e.target.value)} placeholder="0.00" />
            </div>
          </>
        )}
      </div>

      {/* Pre-tax deductions (W-2 only) */}
      {showPretaxSection && (
        <div className="rounded-lg border border-border p-3">
          <button type="button" className="flex w-full items-center justify-between text-sm font-medium" onClick={() => setShowPretax((v) => !v)}>
            <span>Pre-tax deductions YTD</span>
            {showPretax ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showPretax && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><Label>401(k) / 403(b)</Label><Input type="number" inputMode="decimal" value={r401k} onChange={(e) => setR401k(e.target.value)} placeholder="0.00" /></div>
              <div><Label>HSA</Label><Input type="number" inputMode="decimal" value={hsa} onChange={(e) => setHsa(e.target.value)} placeholder="0.00" /></div>
              <div><Label>Health insurance</Label><Input type="number" inputMode="decimal" value={healthcare} onChange={(e) => setHealthcare(e.target.value)} placeholder="0.00" /></div>
              <div><Label>Dental / vision</Label><Input type="number" inputMode="decimal" value={dental} onChange={(e) => setDental(e.target.value)} placeholder="0.00" /></div>
              <div className="sm:col-span-2"><Label>Other pre-tax</Label><Input type="number" inputMode="decimal" value={otherPretax} onChange={(e) => setOtherPretax(e.target.value)} placeholder="0.00" /></div>
            </div>
          )}
        </div>
      )}

      {/* Post-tax deductions */}
      <div className="rounded-lg border border-border p-3">
        <button type="button" className="flex w-full items-center justify-between text-sm font-medium" onClick={() => setShowPosttax((v) => !v)}>
          <span>Post-tax deductions YTD <span className="text-xs text-muted-foreground">(optional)</span></span>
          {showPosttax ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showPosttax && (
          <div className="mt-3">
            <Label>Total post-tax deductions</Label>
            <Input type="number" inputMode="decimal" value={postTax} onChange={(e) => setPostTax(e.target.value)} placeholder="0.00" />
          </div>
        )}
      </div>

      {overlap > 0 && (
        <Alert>
          <AlertDescription>
            Heads up: {overlap} existing income {overlap === 1 ? "entry falls" : "entries fall"} inside this catch-up period.
            Those may be double-counted with your YTD catch-up. Consider deleting them or shortening the period.
          </AlertDescription>
        </Alert>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={upsert.isPending}>Cancel</Button>}
        <Button type="button" onClick={submit} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : initial ? "Save changes" : "Save catch-up"}</Button>
      </div>
    </div>
  );
}
