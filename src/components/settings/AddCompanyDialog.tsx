import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useCompanies } from "@/contexts/CompanyContext";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import type { FilingType } from "@/lib/filingTypes";
import {
  K1_TAX_TREATMENT_OPTIONS,
  K1_TAX_TREATMENT_DEFAULT,
  type K1TaxTreatment,
} from "@/lib/k1TaxTreatment";

interface AddCompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type IncomeTypeOption = "w2" | "1099_schedule_c" | "k1_partnership" | "other_business" | "other";

const INCOME_TYPE_OPTIONS: { value: IncomeTypeOption; label: string }[] = [
  { value: "w2", label: "W-2" },
  { value: "1099_schedule_c", label: "1099" },
  { value: "k1_partnership", label: "K-1" },
  { value: "other_business", label: "Business" },
  { value: "other", label: "Other" },
];

const FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "semimonthly", label: "Semimonthly" },
  { value: "monthly", label: "Monthly" },
  { value: "irregular", label: "Irregular / Locums / Per-diem" },
];

function toFilingType(t: IncomeTypeOption): FilingType {
  if (t === "other_business") return "other";
  return t as FilingType;
}

export function AddCompanyDialog({ open, onOpenChange }: AddCompanyDialogProps) {
  const { addCompany } = useCompanies();
  const { data: taxSettings } = useTaxSettings();
  const isMFJ = taxSettings?.filingStatus === "married_filing_jointly";

  const [name, setName] = useState("");
  const [incomeType, setIncomeType] = useState<IncomeTypeOption>("w2");
  const [role, setRole] = useState<"primary" | "spouse">("primary");
  const [frequency, setFrequency] = useState<string>("biweekly");
  const [remainingPaychecks, setRemainingPaychecks] = useState<string>("");
  const [projectedGross, setProjectedGross] = useState<string>("");
  const [expectedWithholding, setExpectedWithholding] = useState<string>("");
  const [k1Treatment, setK1Treatment] = useState<K1TaxTreatment>(K1_TAX_TREATMENT_DEFAULT);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showW4Fields, setShowW4Fields] = useState(false);

  const isW2 = incomeType === "w2";
  const isIrregular = isW2 && frequency === "irregular";
  const isK1 = incomeType === "k1_partnership";

  function resetAndClose() {
    setName("");
    setIncomeType("w2");
    setRole("primary");
    setFrequency("biweekly");
    setRemainingPaychecks("");
    setProjectedGross("");
    setExpectedWithholding("");
    setK1Treatment(K1_TAX_TREATMENT_DEFAULT);
    setNameError(null);
    onOpenChange(false);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Company name is required.");
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      await addCompany({
        name: trimmed,
        nickname: "",
        companyType: toFilingType(incomeType),
        includeInTax: true,
        defaultSetasideMethod: "recommended",
        defaultSetasidePct: null,
        notes: "",
        advancedFieldVisibility: {},
        applyBusinessStateTax: true,
        includeSETaxInRecommendation: true,
        payFrequency: isW2 ? frequency : null,
        remainingPaychecksOverride:
          isW2 && remainingPaychecks.trim() !== ""
            ? Number(remainingPaychecks)
            : null,
        employeeRole: role,
        projectedAnnualGross:
          projectedGross.trim() !== "" ? Number(projectedGross) : null,
        expectedFederalWithholdingPerPaycheck:
          isW2 && expectedWithholding.trim() !== ""
            ? Number(expectedWithholding)
            : null,
        k1TaxTreatment: isK1 ? k1Treatment : null,
      });
      resetAndClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to add company");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : resetAndClose())}>
      <DialogContent
        data-testid="settings-company-modal"
        className="max-w-lg w-[calc(100vw-24px)] sm:w-full p-0 gap-0 max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden"
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle>Add Company</DialogTitle>
          <DialogDescription>
            Create an employer or income source so paychecks and tax estimates can be organized correctly.
          </DialogDescription>
        </DialogHeader>

        <form
          data-testid="settings-company-form"
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-3 sm:space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Company / employer name
              </Label>
              <Input
                data-testid="settings-company-name-input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="e.g. W2 Primary Hospital"
                autoFocus
              />
              {nameError && (
                <p data-testid="settings-company-name-error" className="text-xs text-destructive mt-1">{nameError}</p>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Income type</Label>
              <Select value={incomeType} onValueChange={(v) => setIncomeType(v as IncomeTypeOption)}>
                <SelectTrigger data-testid="settings-company-income-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCOME_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isK1 && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  K-1 tax treatment
                </Label>
                <Select value={k1Treatment} onValueChange={(v) => setK1Treatment(v as K1TaxTreatment)}>
                  <SelectTrigger data-testid="settings-company-k1-treatment-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {K1_TAX_TREATMENT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/80 mt-1 leading-snug">
                  {K1_TAX_TREATMENT_OPTIONS.find((o) => o.value === k1Treatment)?.description}
                </p>
              </div>
            )}


            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Employee role{isMFJ ? "" : " (defaults to You)"}
              </Label>
              <Select value={role} onValueChange={(v) => setRole(v as "primary" | "spouse")}>
                <SelectTrigger data-testid="settings-company-role-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">You</SelectItem>
                  <SelectItem value="spouse">Spouse</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className={isW2 ? "" : "opacity-60"}>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Pay frequency</Label>
              <Select value={frequency} onValueChange={setFrequency} disabled={!isW2}>
                <SelectTrigger data-testid="settings-company-frequency-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isW2 && frequency === "irregular" && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Use this for W-2 locums, moonlighting, per-diem, or shift-based jobs where paychecks are entered manually instead of on a fixed schedule.
                </p>
              )}
            </div>


            <div className={isW2 ? "" : "opacity-60"}>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Remaining paychecks this year
              </Label>
              <Input
                data-testid="settings-company-remaining-paychecks-input"
                type="number"
                inputMode="numeric"
                value={remainingPaychecks}
                onChange={(e) => setRemainingPaychecks(e.target.value)}
                placeholder="Auto"
                disabled={!isW2}
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Projected annual gross income (optional)
              </Label>
              <Input
                data-testid="settings-company-projected-annual-gross-input"
                type="number"
                inputMode="decimal"
                value={projectedGross}
                onChange={(e) => setProjectedGross(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className={isW2 ? "" : "opacity-60"}>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Expected federal withholding per paycheck (optional)
              </Label>
              <Input
                data-testid="settings-company-expected-federal-withholding-input"
                type="number"
                inputMode="decimal"
                value={expectedWithholding}
                onChange={(e) => setExpectedWithholding(e.target.value)}
                placeholder="0"
                disabled={!isW2}
              />
            </div>
          </div>

          <DialogFooter className="px-5 py-3 border-t bg-background shrink-0 flex-row justify-end gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              data-testid="settings-company-cancel-button"
              onClick={resetAndClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="settings-company-save-button"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Company"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default AddCompanyDialog;
