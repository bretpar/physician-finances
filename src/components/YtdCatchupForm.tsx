import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useUpsertYtdCatchup, type YtdCatchupEntry, type YtdCatchupSourceType } from "@/hooks/useYtdCatchup";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";

interface Props {
  initial?: YtdCatchupEntry;
  onSaved?: () => void;
  onCancel?: () => void;
}

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function YtdCatchupForm({ initial, onSaved, onCancel }: Props) {
  const upsert = useUpsertYtdCatchup();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: taxSettings } = useTaxSettings();
  const stateEnabled = !!taxSettings && (taxSettings as any).stateTaxEnabled !== false;

  const taxYear = new Date().getFullYear();
  const yearStart = `${taxYear}-01-01`;
  const today = new Date().toISOString().split("T")[0];

  const [sourceType, setSourceType] = useState<YtdCatchupSourceType>(initial?.source_type ?? "w2");
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

  const submit = async () => {
    setError(null);
    if (!companyName.trim()) return setError("Enter the employer or company name.");
    if (periodEnd < periodStart) return setError("End date cannot be before start date.");
    const gross = num(grossIncome);
    if (gross < 0) return setError("Gross income cannot be negative.");
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
      ss_withholding: num(ssWh),
      medicare_withholding: num(medWh),
      retirement_401k: num(r401k),
      hsa_contribution: num(hsa),
      healthcare_premiums: num(healthcare),
      dental_vision: num(dental),
      other_pretax: num(otherPretax),
      post_tax_deductions: num(postTax),
    });
    onSaved?.();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Most people do not start using PaycheckMD on January 1. Add your year-to-date income and tax
        withholdings so your recommendations are accurate for the rest of the year. You can usually
        find this information on your most recent paystub.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
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
        <div>
          <Label>Company / employer name</Label>
          <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Providence" />
        </div>
        <div>
          <Label>Period start</Label>
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div>
          <Label>Period end</Label>
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label>Total gross income YTD</Label>
          <Input type="number" inputMode="decimal" value={grossIncome} onChange={(e) => setGrossIncome(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>Federal withheld YTD</Label>
          <Input type="number" inputMode="decimal" value={fedWh} onChange={(e) => setFedWh(e.target.value)} placeholder="0.00" />
        </div>
        {stateEnabled && (
          <div>
            <Label>State withheld YTD</Label>
            <Input type="number" inputMode="decimal" value={stateWh} onChange={(e) => setStateWh(e.target.value)} placeholder="0.00" />
          </div>
        )}
        {sourceType === "w2" && (
          <>
            <div>
              <Label>Social Security YTD <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input type="number" inputMode="decimal" value={ssWh} onChange={(e) => setSsWh(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Medicare YTD <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input type="number" inputMode="decimal" value={medWh} onChange={(e) => setMedWh(e.target.value)} placeholder="0.00" />
            </div>
          </>
        )}
      </div>

      {/* Pre-tax deductions */}
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
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={upsert.isPending}>Cancel</Button>}
        <Button onClick={submit} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : initial ? "Save changes" : "Save catch-up"}</Button>
      </div>
    </div>
  );
}
