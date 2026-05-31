import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/DateField";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useUpsertYtdCatchup, type YtdCatchupEntry, type YtdCatchupOwnerPerson, type YtdCatchupSourceType } from "@/hooks/useYtdCatchup";
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
  const isMfj = (taxSettings as any)?.filingStatus === "married_filing_jointly";
  const [ownerPerson, setOwnerPerson] = useState<YtdCatchupOwnerPerson>(
    (initial?.owner_person as YtdCatchupOwnerPerson) ?? "taxpayer",
  );
  const [periodStart, setPeriodStart] = useState(initial?.period_start ?? yearStart);
  const [periodEnd, setPeriodEnd] = useState(initial?.period_end ?? today);
  const [grossIncome, setGrossIncome] = useState(String(initial?.gross_income ?? ""));
  const [businessExpenses, setBusinessExpenses] = useState(String(initial?.business_expenses ?? ""));

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

  const [localSaving, setLocalSaving] = useState(false);
  const isSaving = upsert.isPending || localSaving;

  const submit = async () => {
    if (isSaving) return; // guard against duplicate submits
    const trimmedName = companyName.trim();
    // Breadcrumb: confirms which entry's save handler fired. The companion
    // END_YTD_SAVE log below proves mutateAsync actually ran for every
    // employer (not just the first), so the multi-W-2 YTD bug can't
    // silently regress without showing up in console output.
    console.info(`BEGIN_YTD_SAVE ${trimmedName || "(unnamed)"}`, {
      sourceType,
      gross: grossIncome,
      isEdit: !!initial,
    });
    setError(null);
    if (!trimmedName) {
      console.info(`END_YTD_SAVE ${trimmedName || "(unnamed)"} validation:missing_company`);
      return setError(isW2Source ? "Enter the employer name." : "Enter the company or business name.");
    }
    if (periodEnd < periodStart) {
      console.info(`END_YTD_SAVE ${trimmedName} validation:bad_period`);
      return setError("End date cannot be before start date.");
    }
    if (grossIncome.trim() === "") {
      console.info(`END_YTD_SAVE ${trimmedName} validation:missing_gross`);
      return setError("Enter your total gross income year-to-date.");
    }
    const gross = num(grossIncome);
    if (gross <= 0) {
      console.info(`END_YTD_SAVE ${trimmedName} validation:zero_gross`);
      return setError("Gross income must be greater than zero.");
    }
    if (isW2Source && fedWh.trim() === "") {
      console.info(`END_YTD_SAVE ${trimmedName} validation:missing_fed`);
      return setError("Enter federal tax withheld year-to-date (enter 0 if none).");
    }
    const negs = [fedWh, stateWh, ssWh, medWh, r401k, hsa, healthcare, dental, otherPretax, postTax].map(num);
    if (negs.some((n) => n < 0)) {
      console.info(`END_YTD_SAVE ${trimmedName} validation:negative`);
      return setError("Withholdings and deductions cannot be negative.");
    }

    setLocalSaving(true);
    try {
      // Outer safety timeout — guarantees the button re-enables even if
      // the underlying mutation/promise somehow never settles. The
      // mutation itself enforces tighter per-step timeouts and surfaces
      // the failing step in its error message.
      await Promise.race([
        upsert.mutateAsync({
          id: initial?.id,
          tax_year: taxYear,
          source_type: sourceType,
          owner_person: isW2Source && isMfj ? ownerPerson : "taxpayer",
          company_name: trimmedName,
          period_start: periodStart,
          period_end: periodEnd,
          gross_income: gross,
          business_expenses: sourceType === "1099_k1" ? Math.max(0, num(businessExpenses)) : 0,
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
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Save timed out. Please check your connection and try again.")), 30000),
        ),
      ]);
      console.info(`END_YTD_SAVE ${trimmedName} ok`);
      onSaved?.();
    } catch (e: any) {
      const msg = e?.message || "Could not save catch-up entry. Please try again.";
      console.error(`END_YTD_SAVE ${trimmedName} error`, e);
      setError(msg);
    } finally {
      setLocalSaving(false);
    }
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
        {isW2Source && isMfj && (
          <div className="sm:col-span-2">
            <Label>Whose W-2 is this?</Label>
            <Select value={ownerPerson} onValueChange={(v) => setOwnerPerson(v as YtdCatchupOwnerPerson)}>
              <SelectTrigger data-testid="ytd-catchup-owner-person-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="taxpayer" data-testid="ytd-catchup-owner-person-taxpayer">You (Taxpayer)</SelectItem>
                <SelectItem value="spouse" data-testid="ytd-catchup-owner-person-spouse">Spouse</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Period start</Label>
          <DateField value={periodStart} onChange={setPeriodStart} />
        </div>
        <div>
          <Label>Period end</Label>
          <DateField value={periodEnd} onChange={setPeriodEnd} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ytd-gross-income">{sourceType === "1099_k1" ? "Total gross business revenue YTD" : "Total gross income YTD"}</Label>
          <Input id="ytd-gross-income" data-testid="ytd-catchup-gross-income" type="number" inputMode="decimal" value={grossIncome} onChange={(e) => setGrossIncome(e.target.value)} placeholder="0.00" />
        </div>
        {sourceType === "1099_k1" && (
          <>
            <div className="sm:col-span-2">
              <Label htmlFor="ytd-business-expenses">YTD business expenses</Label>
              <Input
                id="ytd-business-expenses"
                data-testid="ytd-catchup-business-expenses"
                type="number"
                inputMode="decimal"
                value={businessExpenses}
                onChange={(e) => setBusinessExpenses(e.target.value)}
                placeholder="0.00"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Deductible business expenses already incurred this year (mileage, supplies, fees, etc.).
              </p>
            </div>
            <div className="sm:col-span-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">YTD net business profit</span>
                <span data-testid="ytd-catchup-net-profit" className="font-semibold text-foreground">
                  {(Math.max(0, num(grossIncome) - num(businessExpenses))).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Gross revenue minus business expenses. Tax estimates use this net profit, not gross revenue.
              </p>
            </div>
          </>
        )}

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

      {error && <p data-testid="ytd-catchup-error" role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>Cancel</Button>}
        <Button type="button" data-testid="ytd-catchup-save" onClick={submit} disabled={isSaving}>{isSaving ? "Saving…" : initial ? "Save changes" : "Save catch-up"}</Button>
      </div>
    </div>
  );
}
