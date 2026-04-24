import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, Wallet, ChevronDown, ChevronRight, Paperclip } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LedgerRow, MonthHeader, groupByMonth, type LedgerRowBadge } from "@/components/LedgerRow";
import { TransactionAttachments, MobileAttachmentViewer } from "@/components/TransactionAttachments";
import { useAttachmentCounts, useUploadAttachments } from "@/hooks/useAttachments";
import { DateField } from "@/components/DateField";
import { usePersonalIncomeEntries, useAddPersonalIncome, useUpdatePersonalIncome, useDeletePersonalIncome, type PersonalIncomeEntry } from "@/hooks/usePersonalIncome";
import { useWithholdingRecommendation } from "@/hooks/useWithholdingRecommendation";
import { useIncomeRecommendation } from "@/hooks/useIncomeRecommendation";
import { SimpleTaxReminderModal } from "@/components/SimpleTaxReminderModal";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { SourceEmployerCombobox, persistNewSourceIfRequested } from "@/components/SourceEmployerCombobox";
import { useCreateIncomeSource, type SourceKind } from "@/hooks/useIncomeSources";
import { useCompanies } from "@/contexts/CompanyContext";
import { normalizeFilingType, resolveAdvancedVisibility, type ToggleKey } from "@/lib/filingTypes";
import { useTaxSettings } from "@/hooks/useTaxSettings";

import { TotalFederalTaxField } from "@/components/TotalFederalTaxField";
import { getTotalFederalPaid, getCanonicalTotalFederalPayrollTaxes } from "@/lib/federalWithholding";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import { getSavingsRateForIncomeBucket } from "@/lib/savingsRateSelection";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const num = (v: string) => parseFloat(v) || 0;

const INCOME_TYPES = [
  { value: "w2_user", label: "W2 Income (You)" },
  { value: "w2_partner", label: "W2 Income (Partner)" },
  { value: "short_term_gain", label: "Short-Term Capital Gain" },
  { value: "long_term_gain", label: "Long-Term Capital Gain" },
  { value: "dividend", label: "Dividend" },
  { value: "interest", label: "Interest" },
  { value: "rental", label: "Rental Income" },
  { value: "other_income", label: "Other Income" },
  { value: "loss", label: "Loss" },
];

const VALID_UI_TYPES = new Set(INCOME_TYPES.map((t) => t.value));

const TAX_CATEGORY_MAP: Record<string, string> = {
  w2_user: "ordinary",
  w2_partner: "ordinary",
  short_term_gain: "capital_gain",
  long_term_gain: "capital_gain",
  dividend: "ordinary",
  interest: "ordinary",
  rental: "passive",
  other_income: "ordinary",
  loss: "loss",
};

/**
 * Map a saved DB income_type / ui_income_subtype back to a valid Personal
 * Income UI Select value. The DB stores canonical values like "w2", "other"
 * which don't match UI options like "w2_user". The new ui_income_subtype
 * column preserves the original selection — fall back to a sensible mapping
 * for rows saved before that column existed.
 */
function hydrateIncomeType(entry: PersonalIncomeEntry): string {
  const ui = (entry as any).ui_income_subtype as string | null | undefined;
  if (ui && VALID_UI_TYPES.has(ui)) return ui;
  const raw = (entry.income_type || "").toLowerCase();
  if (VALID_UI_TYPES.has(raw)) return raw;
  if (raw === "w2") return "w2_user";
  if (raw === "other") return "other_income";
  // Anything else falls through to a safe default so the Select never blanks out.
  return "other_income";
}

interface FormState {
  date: string;
  title: string;
  income_type: string;
  gross_amount: string;
  net_received: string;
  cost_basis: string;
  realized_gain_loss: string;
  federal_withholding: string;
  state_withholding: string;
  ss_withholding: string;
  medicare_withholding: string;
  total_federal_payroll_taxes: string;
  retirement_pretax: string;
  deductions_pre_tax: string;
  healthcare_deduction: string;
  hsa_contribution: string;
  source_name: string;
  source_id: string | null;
  source_save_as_new: boolean;
  source_new_kind: SourceKind | null;
  notes: string;
  additional_tax_reserve: string;
}

const emptyForm: FormState = {
  date: new Date().toISOString().split("T")[0],
  title: "",
  income_type: "w2_user",
  gross_amount: "",
  net_received: "",
  cost_basis: "",
  realized_gain_loss: "",
  federal_withholding: "",
  state_withholding: "",
  ss_withholding: "",
  medicare_withholding: "",
  total_federal_payroll_taxes: "",
  retirement_pretax: "",
  deductions_pre_tax: "",
  healthcare_deduction: "",
  hsa_contribution: "",
  source_name: "",
  source_id: null,
  source_save_as_new: false,
  source_new_kind: null,
  notes: "",
  additional_tax_reserve: "",
};

const isW2Type = (t: string) => t === "w2_user" || t === "w2_partner";
const isStockType = (t: string) => t === "short_term_gain" || t === "long_term_gain";

const STATUS_ICON = { ahead: TrendingUp, on_track: Minus, behind: TrendingDown };
const STATUS_LABEL = { ahead: "Ahead", on_track: "On Track", behind: "Behind" };

export default function PersonalIncome() {
  const { data: rawEntries = [], isLoading } = usePersonalIncomeEntries();
  const { companies } = useCompanies();
  const [filterReview, setFilterReview] = useState<"all" | "needs_review">("all");
  const [filterPlanner, setFilterPlanner] = useState<"all" | "from_planner">("all");
  const entries = useMemo(() => {
    return rawEntries.filter((e: any) => {
      if (filterReview === "needs_review" && !e.needs_review && e.origin_type !== "planner_converted") return false;
      if (filterPlanner === "from_planner" && e.origin_type !== "planner_converted") return false;
      return true;
    });
  }, [rawEntries, filterReview, filterPlanner]);
  const fromPlannerCount = useMemo(
    () => rawEntries.filter((e: any) => e.origin_type === "planner_converted").length,
    [rawEntries],
  );
  const addMutation = useAddPersonalIncome();
  const updateMutation = useUpdatePersonalIncome();
  const deleteMutation = useDeletePersonalIncome();
  const createSource = useCreateIncomeSource();
  const { getRecommendation: getWithholdingRec } = useWithholdingRecommendation();
  const { getRecommendation: getIncomeRec } = useIncomeRecommendation();
  const { data: attachmentCounts } = useAttachmentCounts();
  const { data: taxSettings } = useTaxSettings();
  const { actualEstimate, forecastEstimate } = useTaxEstimate();
  const stateIncomeTaxEnabled = !!taxSettings?.stateIncomeTaxEnabled;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showSourceError, setShowSourceError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [mobileViewerEntryId, setMobileViewerEntryId] = useState<string | null>(null);
  const uploadAttachments = useUploadAttachments();

  // Per-transaction tax-savings reminder state
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);
  const [savedEntryTitle, setSavedEntryTitle] = useState("");
  const [reminderRecommended, setReminderRecommended] = useState(0);
  const [reminderActualSaved, setReminderActualSaved] = useState(0);

  const isEditing = !!editingId;
  const setField = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /**
   * Resolve which advanced fields to render. Driven by the selected company's
   * Settings → Advanced tax settings toggles. When no company is linked
   * (e.g. non-W2 personal entries don't show the source picker), fall back to
   * the filing-type defaults derived from the UI income type.
   */
  const visibleFields = useMemo<Record<ToggleKey, boolean>>(() => {
    const company = form.source_id
      ? companies.find((c) => c.id === form.source_id)
      : undefined;
    // Map UI income type → filing type. W-2 personal income → "w2" filing type.
    const filingType = normalizeFilingType(
      isW2Type(form.income_type) ? "w2" : form.income_type,
    );
    return resolveAdvancedVisibility(filingType, company?.advancedFieldVisibility);
  }, [companies, form.source_id, form.income_type]);

  const showField = (key: ToggleKey) => !!visibleFields[key];

  // Summary stats
  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => {
        const amt = Number(e.gross_amount);
        // Federal total via shared helper + state (kept here so the summary
        // card still reflects "all taxes withheld"); the dashboard tracker is
        // federal-only.
        const withheld = getTotalFederalPaid(e as any) + Number(e.state_withholding || 0);
        return {
          totalIncome: acc.totalIncome + (e.income_type === "loss" ? -Math.abs(amt) : amt),
          totalWithheld: acc.totalWithheld + withheld,
          w2Income: acc.w2Income + (isW2Type(hydrateIncomeType(e)) ? amt : 0),
          capitalGains: acc.capitalGains + (isStockType(hydrateIncomeType(e)) ? amt : 0),
          passiveIncome: acc.passiveIncome + (hydrateIncomeType(e) === "rental" ? amt : 0),
        };
      },
      { totalIncome: 0, totalWithheld: 0, w2Income: 0, capitalGains: 0, passiveIncome: 0 }
    );
  }, [entries]);

  // Base withholding recommendation for Modal 1
  const grossAmount = num(form.gross_amount);
  const baseRecommendation = useMemo(() => {
    if (grossAmount <= 0) return null;
    const incType = isW2Type(form.income_type) ? "W2" : "1099";
    return getWithholdingRec({
      grossIncome: grossAmount,
      incomeType: incType,
      taxesAlreadyWithheld: num(form.federal_withholding) + num(form.ss_withholding) + num(form.medicare_withholding),
      retirement401k: num(form.retirement_pretax),
      preTaxDeductions: num(form.deductions_pre_tax) + num(form.healthcare_deduction),
      alreadyIncludedInEstimate: isEditing,
    });
  }, [grossAmount, form.income_type, form.federal_withholding, form.ss_withholding, form.medicare_withholding, form.retirement_pretax, form.deductions_pre_tax, form.healthcare_deduction, getWithholdingRec, isEditing]);

  // ── Per-paycheck profile-based savings guide ────────────────────────────
  // Simple paycheck-only calculation: uses the user's selected tax profile
  // effective rate (NOT annual remaining tax / quarterly catch-up). Lives in
  // calculatePaycheckProfileSavings so the math stays consistent and isolated
  // from the annual recommendation engine in useWithholdingRecommendation.
  const paycheckSavings = useMemo(() => {
    if (grossAmount <= 0 || !taxSettings) return null;

    // 1. Resolve effective rate via the shared bucket-aware selector.
    //    Personal Income card → federal income tax profile rate only.
    //    Payroll and state withholdings reduce the recommendation below.
    const rateSel = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: form.income_type,
      taxSettings,
      actualEstimate,
      forecastEstimate,
    });
    const method = rateSel.method;
    const effectiveRate = rateSel.rate;

    // 2. Eligible pre-tax deductions for this paycheck.
    const eligibleDeductions =
      num(form.retirement_pretax) +
      num(form.deductions_pre_tax) +
      num(form.healthcare_deduction) +
      num(form.hsa_contribution);

    // 3. Canonical Total Federal Payroll Taxes (no double-count of splits).
    const totalFederalPayrollTaxes = getCanonicalTotalFederalPayrollTaxes({
      total_federal_payroll_taxes: form.total_federal_payroll_taxes,
      federal_withholding: num(form.federal_withholding),
      ss_withholding: num(form.ss_withholding),
      medicare_withholding: num(form.medicare_withholding),
    });

    const stateEnabled = !!taxSettings.stateIncomeTaxEnabled;
    const stateAlreadyWithheld = stateEnabled ? num(form.state_withholding) : 0;

    const result = calculatePaycheckProfileSavings({
      grossPaycheckIncome: grossAmount,
      eligiblePreTaxDeductions: eligibleDeductions,
      selectedProfileEffectiveTaxRate: effectiveRate,
      totalFederalPayrollTaxes,
      stateWithholdingIfEnabled: stateAlreadyWithheld,
    });

    const methodLabel =
      method === "flat_estimate"
        ? `Flat ${effectiveRate.toFixed(1)}% estimate`
        : method === "dynamic_planner"
        ? "Based on actual + planned income"
        : "Based on combined actual income";

    return { ...result, methodLabel };
  }, [
    grossAmount,
    form.income_type,
    form.retirement_pretax,
    form.healthcare_deduction,
    form.deductions_pre_tax,
    form.hsa_contribution,
    form.federal_withholding,
    form.ss_withholding,
    form.medicare_withholding,
    form.total_federal_payroll_taxes,
    form.state_withholding,
    taxSettings,
    actualEstimate,
    forecastEstimate,
  ]);



  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setShowSourceError(false);
    setAdvancedOpen(false);
    setPendingAttachments([]);
    setShowForm(true);
  }

  function openEdit(entry: PersonalIncomeEntry) {
    const uiType = hydrateIncomeType(entry);
    setForm({
      date: entry.income_date,
      title: entry.name,
      income_type: uiType,
      gross_amount: String(entry.gross_amount),
      net_received: (entry as any).deposited_amount != null ? String((entry as any).deposited_amount) : "",
      cost_basis: entry.cost_basis != null ? String(entry.cost_basis) : "",
      realized_gain_loss: entry.realized_gain_loss != null ? String(entry.realized_gain_loss) : "",
      federal_withholding: String(entry.federal_withholding),
      state_withholding: String(entry.state_withholding),
      ss_withholding: String((entry as any).ss_withholding || 0),
      medicare_withholding: String((entry as any).medicare_withholding || 0),
      // Canonical Total Federal Payroll Taxes (shared wrapper handles
      // taxes_withheld → split-fields fallback for legacy rows).
      total_federal_payroll_taxes: String(getCanonicalTotalFederalPayrollTaxes(entry as any)),
      retirement_pretax: String(entry.retirement_401k),
      deductions_pre_tax: String(entry.pre_tax_deductions),
      healthcare_deduction: String((entry as any).healthcare_deduction || 0),
      hsa_contribution: String((entry as any).hsa_contribution || 0),
      source_name: entry.company,
      source_id: (entry as any).source_id ?? null,
      source_save_as_new: false,
      source_new_kind: null,
      notes: entry.notes || "",
      additional_tax_reserve: String((entry as any).additional_tax_reserve || 0),
    });
    setEditingId(entry.id);
    setShowSourceError(false);
    setAdvancedOpen(
      Number(entry.federal_withholding) > 0 ||
      Number(entry.state_withholding) > 0 ||
      Number((entry as any).ss_withholding || 0) > 0 ||
      Number((entry as any).medicare_withholding || 0) > 0 ||
      Number(entry.retirement_401k) > 0 ||
      Number(entry.pre_tax_deductions) > 0 ||
      Number((entry as any).healthcare_deduction || 0) > 0 ||
      Number((entry as any).hsa_contribution || 0) > 0 ||
      Number((entry as any).additional_tax_reserve || 0) > 0 ||
      !!(entry.notes && entry.notes.trim())
    );
    setPendingAttachments([]);
    setShowForm(true);
  }

  function buildPayload() {
    const grossAmt = num(form.gross_amount);
    // Canonical "Total Federal Payroll Taxes" — federal income tax + SS + Medicare.
    // (Auto-summed from breakdown when present in the input.)
    const totalFederal = num(form.total_federal_payroll_taxes);
    // Split components — preserved separately so reports / breakdowns stay accurate.
    const fedIncomeTaxOnly = num(form.federal_withholding);
    const ssOnly = num(form.ss_withholding);
    const medicareOnly = num(form.medicare_withholding);
    const stateW = stateIncomeTaxEnabled ? num(form.state_withholding) : 0;
    const totalWithheld = totalFederal + stateW;
    const computedNet = grossAmt - totalWithheld - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.healthcare_deduction);
    const netReceived = num(form.net_received) > 0 ? num(form.net_received) : Math.max(0, computedNet);

    // Compute the base tax estimate for the record using the canonical total.
    const rec = getIncomeRec({
      grossIncome: grossAmt,
      incomeType: form.income_type,
      federalWithheld: totalFederal,
      stateWithheld: stateW,
      retirement401k: num(form.retirement_pretax),
      preTaxDeductions: num(form.deductions_pre_tax) + num(form.healthcare_deduction),
    });

    return {
      payload: {
        name: form.title,
        income_date: form.date,
        income_type: form.income_type,
        ui_income_subtype: form.income_type,
        company: form.source_name,
        source_id: form.source_id,
        source_bucket: "personal" as const,
        tax_category: TAX_CATEGORY_MAP[form.income_type] || "ordinary",
        gross_amount: grossAmt,
        paycheck_amount: grossAmt,
        deposited_amount: netReceived,
        cost_basis: isStockType(form.income_type) ? num(form.cost_basis) : null,
        realized_gain_loss: isStockType(form.income_type) ? num(form.realized_gain_loss) : null,
        // CANONICAL: taxes_withheld = total federal payroll taxes
        // (federal income tax + Social Security + Medicare). This is the
        // single value all read paths consume via getTotalFederalPaid().
        taxes_withheld: totalFederal,
        // Federal income tax COMPONENT only (NOT the combined total).
        // If the user only entered the single total field, store 0 here —
        // getTotalFederalPaid() will fall back to taxes_withheld.
        federal_withholding: fedIncomeTaxOnly,
        ss_withholding: ssOnly,
        medicare_withholding: medicareOnly,
        state_withholding: stateW,
        retirement_401k: num(form.retirement_pretax),
        pre_tax_deductions: num(form.deductions_pre_tax),
        healthcare_deduction: num(form.healthcare_deduction),
        hsa_contribution: num(form.hsa_contribution),
        is_actual: true,
        include_in_tax_estimate: true,
        include_in_cash_flow: false,
        notes: form.notes,
        status: "received",
        base_tax_estimate: rec?.baseTaxEstimate || 0,
        dynamic_tax_recommendation: rec?.dynamicTaxRecommendation || 0,
        quarterly_adjustment_amount: rec?.quarterlyAdjustmentAmount || 0,
        additional_tax_reserve: num(form.additional_tax_reserve),
        recommendation_status: rec?.recommendationStatus || "on_track",
      },
      recommendation: rec,
    };
  }

  /** Validates the Source/Employer assignment. Returns true if OK. */
  function validateSource(): boolean {
    // Source/Employer is only required for W2 income types.
    if (!isW2Type(form.income_type)) return true;
    if (form.source_id) return true;
    if (form.source_name.trim()) {
      if (form.source_save_as_new && !form.source_new_kind) return false;
      return true;
    }
    return false;
  }

  async function saveForm() {
    if (!form.title.trim() || !form.date || num(form.gross_amount) <= 0) return;
    if (!validateSource()) {
      setShowSourceError(true);
      return;
    }
    setShowSourceError(false);

    let payloadSourceId = form.source_id;
    if (!payloadSourceId && form.source_save_as_new && form.source_new_kind && form.source_name.trim()) {
      try {
        const newId = await persistNewSourceIfRequested(
          {
            otherName: form.source_name,
            saveAsNew: true,
            newSourceKind: form.source_new_kind,
          },
          createSource.mutateAsync,
        );
        payloadSourceId = newId;
      } catch {
        return;
      }
    }

    const { payload, recommendation } = buildPayload();
    // Resolve company name: when a source is linked, the combobox clears
    // source_name, so we must look up the linked company's name. Falls back
    // to the manually-entered "Other" name for unlinked entries.
    const linkedCompany = payloadSourceId
      ? companies.find((c) => c.id === payloadSourceId)
      : undefined;
    const resolvedCompanyName =
      linkedCompany?.nickname?.trim() ||
      linkedCompany?.name?.trim() ||
      form.source_name.trim();
    const finalPayload = {
      ...payload,
      company: resolvedCompanyName,
      source_id: payloadSourceId,
    };
    const showModal2 = isFeatureEnabled("recommendation_modal") && !isEditing;

    if (isEditing) {
      updateMutation.mutate({ id: editingId!, ...finalPayload } as any, {
        onSuccess: () => { setShowForm(false); setEditingId(null); },
      });
    } else {
      addMutation.mutate(finalPayload as any, {
        onSuccess: (result) => {
          const newId = (result as { id?: string } | null)?.id || null;
          if (newId && pendingAttachments.length > 0) {
            uploadAttachments.mutate({
              transactionId: newId,
              companyId: payloadSourceId || null,
              files: pendingAttachments,
            });
          }
          setPendingAttachments([]);
          setShowForm(false);
          if (showModal2 && recommendation) {
            // Per-transaction reminder: compare amount saved on THIS entry
            // against the per-transaction recommended savings (baseTaxEstimate).
            const recommended = Math.max(0, recommendation.baseTaxEstimate || 0);
            const actualSaved =
              num(form.federal_withholding) +
              num(form.state_withholding) +
              num(form.ss_withholding) +
              num(form.medicare_withholding) +
              num(form.additional_tax_reserve);
            // Only nudge when meaningfully behind (< 90% of recommended).
            if (recommended > 0 && actualSaved < recommended * 0.9) {
              setSavedEntryTitle(form.title);
              setReminderRecommended(recommended);
              setReminderActualSaved(actualSaved);
              setShowRecommendation(true);
            }
          }
        },
      });
    }
  }

  function applyRecommendation() {
    const additional = Math.max(0, reminderRecommended - reminderActualSaved);
    if (additional > 0) {
      const latestEntry = entries[0];
      if (latestEntry) {
        const currentReserve = Number((latestEntry as any).additional_tax_reserve || 0);
        updateMutation.mutate({
          id: latestEntry.id,
          additional_tax_reserve: Math.round((currentReserve + additional) * 100) / 100,
        } as any);
      }
    }
    setShowRecommendation(false);
  }

  function confirmDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(deleteId);
    setDeleteId(null);
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">Personal & External Income</h1>
            <p className="text-xs text-muted-foreground">Actual non-business income affecting your taxes</p>
          </div>
        </div>
        <Button size="sm" onClick={openAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-xs text-muted-foreground">Total Personal Income</p>
          <p className="text-lg font-bold">{fmt(totals.totalIncome)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-xs text-muted-foreground">W2 Income</p>
          <p className="text-lg font-bold">{fmt(totals.w2Income)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-xs text-muted-foreground">Capital Gains</p>
          <p className="text-lg font-bold">{fmt(totals.capitalGains)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-xs text-muted-foreground">Passive Income</p>
          <p className="text-lg font-bold">{fmt(totals.passiveIncome)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-xs text-muted-foreground">Taxes Withheld</p>
          <p className="text-lg font-bold text-emerald-600">{fmt(totals.totalWithheld)}</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      {(fromPlannerCount > 0 || filterReview !== "all" || filterPlanner !== "all") && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={filterReview === "needs_review" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setFilterReview(filterReview === "needs_review" ? "all" : "needs_review")}
          >
            Needs Review
          </Button>
          {fromPlannerCount > 0 && (
            <Button
              variant={filterPlanner === "from_planner" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setFilterPlanner(filterPlanner === "from_planner" ? "all" : "from_planner")}
            >
              From Planner ({fromPlannerCount})
            </Button>
          )}
          {(filterReview !== "all" || filterPlanner !== "all") && (
            <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => { setFilterReview("all"); setFilterPlanner("all"); }}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Entries table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="hidden sm:grid sm:grid-cols-[90px_1fr_100px_100px_120px_80px_40px] gap-2 px-4 py-2.5 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span>Date</span>
          <span>Description</span>
          <span>Type</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Withheld</span>
          <span className="text-right">Reserve</span>
          <span></span>
        </div>

        {/* Desktop rows */}
        <div className="hidden sm:block divide-y divide-border">
          {entries.map((entry) => {
            const uiType = hydrateIncomeType(entry);
            const typeLabel = INCOME_TYPES.find((t) => t.value === uiType)?.label || uiType;
            const isLoss = uiType === "loss";
            const reserve = Number((entry as any).additional_tax_reserve || 0);
            const status = ((entry as any).recommendation_status || "on_track") as keyof typeof STATUS_ICON;
            const StIcon = STATUS_ICON[status] || Minus;
            return (
              <div key={entry.id} className="grid grid-cols-[90px_1fr_100px_100px_120px_80px_40px] gap-2 px-4 py-3 hover:bg-muted/30 transition-colors items-center">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {new Date(entry.income_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground truncate block">{entry.name}</span>
                  {entry.company && <span className="text-xs text-muted-foreground">{entry.company}</span>}
                  {entry.notes?.includes("Converted from planned income") && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">From Income Planner</span>
                  )}
                </div>
                <Badge variant="secondary" className="text-[10px] w-fit">{typeLabel}</Badge>
                <span className={`text-sm font-semibold tabular-nums text-right ${isLoss ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {isLoss ? "-" : "+"}{fmt(Math.abs(Number(entry.gross_amount)))}
                </span>
                <span className="text-sm tabular-nums text-right text-muted-foreground">
                  {(() => {
                    const withheld = getTotalFederalPaid(entry as any);
                    return withheld > 0 ? fmt(withheld) : "—";
                  })()}
                </span>
                <span className="text-sm tabular-nums text-right text-muted-foreground flex items-center justify-end gap-1">
                  {reserve > 0 ? (
                    <>
                      <StIcon className="h-3 w-3" />
                      {fmt(reserve)}
                    </>
                  ) : "—"}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(entry)}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteId(entry.id)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
          {entries.length === 0 && (
            <div className="px-4 py-16 text-center text-muted-foreground text-sm">
              No personal income entries yet. Click "Add" to get started.
            </div>
          )}
        </div>

        {/* Mobile rows — grouped by month */}
        <div className="sm:hidden">
          {groupByMonth(entries, (e) => e.income_date).map((group) => (
            <div key={group.key}>
              <MonthHeader label={group.label} />
              <div className="divide-y divide-border">
                {group.items.map((entry) => {
                  const uiType = hydrateIncomeType(entry);
                  const typeLabel =
                    INCOME_TYPES.find((t) => t.value === uiType)?.label ||
                    uiType;
                  const isLoss = uiType === "loss";
                  // Use the same canonical federal total the dashboard tracker
                  // shows so the ledger and Quarterly Tax Progress agree.
                  const withheld = getTotalFederalPaid(entry as any);
                  const reserve = Number((entry as any).additional_tax_reserve || 0);
                  const dateStr = new Date(entry.income_date + "T00:00:00").toLocaleDateString(
                    "en-US",
                    { month: "numeric", day: "numeric", year: "2-digit" },
                  );
                  const badges: LedgerRowBadge[] = [];
                  const attCount = attachmentCounts?.get(entry.id) ?? 0;
                  if (attCount > 0) badges.push({ label: `📎 ${attCount}`, tone: "muted" });
                  if (withheld > 0) badges.push({ label: `Withheld ${fmt(withheld)}`, tone: "muted" });
                  if (reserve > 0) badges.push({ label: `Reserve ${fmt(reserve)}`, tone: "info" });
                  if ((entry as any).origin_type === "planner_converted") {
                    badges.push({ label: "From Planner", tone: "info" });
                    badges.push({ label: "Review", tone: "warning" });
                  }

                  return (
                    <div key={entry.id}>
                      <LedgerRow
                        kind={isLoss ? "neutral" : "income"}
                        title={entry.name || "(No payor)"}
                        subtitle={typeLabel}
                        meta={entry.company || null}
                        date={dateStr}
                        amount={Number(entry.gross_amount) || 0}
                        amountTone={isLoss ? "negative" : "positive"}
                        amountPrefix={isLoss ? "-" : "+"}
                        badges={badges}
                        onClick={() => openEdit(entry)}
                      />
                      {attCount > 0 && (
                        <div className="px-4 pb-3 -mt-1">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/40 active:bg-muted/60"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMobileViewerEntryId(entry.id);
                            }}
                          >
                            <Paperclip className="h-3 w-3" /> View Receipt{attCount > 1 ? `s (${attCount})` : ""}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="px-4 py-16 text-center text-muted-foreground text-sm">
              No personal income entries yet. Tap "Add" to get started.
            </div>
          )}
        </div>
      </div>

      {/* Modal 1: Add/Edit Income Entry */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditingId(null); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Income Entry" : "Add Personal Income"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                <DateField value={form.date} onChange={(v) => setField("date", v)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Income Type</Label>
                <Select value={form.income_type} onValueChange={(v) => setField("income_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCOME_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isW2Type(form.income_type) && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  Source / Employer <span className="text-destructive">*</span>
                </Label>
                <SourceEmployerCombobox
                  sourceId={form.source_id}
                  otherName={form.source_name}
                  saveAsNew={form.source_save_as_new}
                  newSourceKind={form.source_new_kind}
                  required
                  invalid={showSourceError}
                  onChange={(next) => {
                    setForm((prev) => {
                      let nextIncomeType = prev.income_type;
                      if (!isEditing && next.linkedSource) {
                        const k = next.linkedSource.source_kind;
                        if (k === "w2_employer" && !isW2Type(prev.income_type)) {
                          nextIncomeType = "w2_user";
                        }
                      }
                      return {
                        ...prev,
                        source_id: next.sourceId,
                        source_name: next.otherName,
                        source_save_as_new: next.saveAsNew,
                        source_new_kind: next.newSourceKind,
                        income_type: nextIncomeType,
                      };
                    });
                    if (showSourceError) setShowSourceError(false);
                  }}
                />
                {showSourceError && !form.source_id && !form.source_name.trim() && (
                  <p className="text-[10px] text-destructive mt-1">Pick a source or enter one under "Other".</p>
                )}
                {showSourceError && form.source_save_as_new && !form.source_new_kind && (
                  <p className="text-[10px] text-destructive mt-1">Choose a source type to save it.</p>
                )}
              </div>
            )}

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Title / Description</Label>
              <Input placeholder="e.g. March Paycheck" value={form.title} onChange={(e) => setField("title", e.target.value)} />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Gross Income *</Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.gross_amount} onChange={(e) => setField("gross_amount", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Total income before taxes or deductions</p>
            </div>

            {/* Net Received + Estimated Net */}
            {grossAmount > 0 && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Net Received (Optional)</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    placeholder={fmt(Math.max(0, grossAmount - num(form.federal_withholding) - num(form.state_withholding) - num(form.ss_withholding) - num(form.medicare_withholding) - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.healthcare_deduction)))}
                    value={form.net_received}
                    onChange={(e) => setField("net_received", e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Amount deposited into your bank account after taxes and deductions</p>
                </div>
                <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
                  Estimated Net: <strong>{fmt(Math.max(0, grossAmount - num(form.federal_withholding) - num(form.state_withholding) - num(form.ss_withholding) - num(form.medicare_withholding) - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.healthcare_deduction)))}</strong> based on your inputs
                </p>
              </div>
            )}

            {/* Stock-specific fields */}
            {isStockType(form.income_type) && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 bg-muted/20">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Cost Basis</Label>
                  <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.cost_basis} onChange={(e) => setField("cost_basis", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Realized Gain/Loss</Label>
                  <Input type="number" step="0.01" placeholder="0.00" value={form.realized_gain_loss} onChange={(e) => setField("realized_gain_loss", e.target.value)} />
                </div>
              </div>
            )}

            {/* Simplified federal payroll tax + optional state withholding */}
            {showField("federal_withholding") && (
              <TotalFederalTaxField
                total={form.total_federal_payroll_taxes}
                onTotalChange={(v) => setField("total_federal_payroll_taxes", v)}
                federal={form.federal_withholding}
                onFederalChange={(v) => setField("federal_withholding", v)}
                ss={form.ss_withholding}
                onSsChange={(v) => setField("ss_withholding", v)}
                medicare={form.medicare_withholding}
                onMedicareChange={(v) => setField("medicare_withholding", v)}
                defaultAdvancedOpen={
                  num(form.federal_withholding) > 0 ||
                  num(form.ss_withholding) > 0 ||
                  num(form.medicare_withholding) > 0
                }
              />
            )}

            {stateIncomeTaxEnabled && showField("state_withholding") && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">State tax withheld</Label>
                <Input
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={form.state_withholding}
                  onChange={(e) => setField("state_withholding", e.target.value)}
                />
              </div>
            )}

            {/* Advanced details collapsible — driven by company/filing-type toggles */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Advanced details
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-3">
                  {/* Federal/state/SS/Medicare moved out into the
                      simplified TotalFederalTaxField above. */}

                  {(showField("retirement_401k") || showField("healthcare_deduction") || showField("hsa_contribution") || showField("pre_tax_deductions")) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {showField("retirement_401k") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Retirement / 401(k)</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.retirement_pretax} onChange={(e) => setField("retirement_pretax", e.target.value)} />
                        </div>
                      )}
                      {showField("healthcare_deduction") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Health Insurance</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.healthcare_deduction} onChange={(e) => setField("healthcare_deduction", e.target.value)} />
                        </div>
                      )}
                      {showField("hsa_contribution") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">HSA Contribution</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.hsa_contribution} onChange={(e) => setField("hsa_contribution", e.target.value)} />
                        </div>
                      )}
                      {showField("pre_tax_deductions") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Other Pre-Tax</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.deductions_pre_tax} onChange={(e) => setField("deductions_pre_tax", e.target.value)} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Additional tax reserve field on edit */}
                  {isEditing && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Additional Tax Reserve</Label>
                      <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.additional_tax_reserve} onChange={(e) => setField("additional_tax_reserve", e.target.value)} />
                      <p className="text-[10px] text-muted-foreground mt-1">Extra amount set aside beyond actual withholding</p>
                    </div>
                  )}

                  {visibleFields.notes && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                      <Input placeholder="Optional" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Per-paycheck profile-based savings guide — uses the SELECTED
                tax profile effective rate (NOT annual remaining tax). */}
            {grossAmount > 0 && paycheckSavings && (() => {
              const diff = paycheckSavings.withholdingDifference;
              const status = paycheckSavings.status;
              const isUnder = status === "under_withheld";
              const isOver = status === "over_withheld";
              const absAmount = Math.round(Math.abs(diff));
              const amountDisplay = `$${absAmount.toLocaleString()}`;
              const ratePct = paycheckSavings.effectiveRateUsed;
              const rateDisplay = `${ratePct.toFixed(1)}%`;

              const primary = isOver
                ? `You're ahead by ${amountDisplay}`
                : isUnder
                ? `Save ${amountDisplay} more this paycheck`
                : "You're on track";
              const secondary = isOver
                ? `No additional savings needed this paycheck • Based on effective tax rate of ${rateDisplay}`
                : isUnder
                ? `To stay on track • Based on effective tax rate of ${rateDisplay}`
                : `Withholding matches your target • Based on effective tax rate of ${rateDisplay}`;
              const rightLabel = isOver ? "Over-withheld" : isUnder ? "Under-saving" : "On track";
              const rightColor = isOver
                ? "text-emerald-600 dark:text-emerald-400"
                : isUnder
                ? "text-orange-600 dark:text-orange-400"
                : "text-muted-foreground";

              return (
                <div className="rounded-md border border-border p-3 sm:p-4 bg-background space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Paycheck tax savings guide</p>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-base sm:text-lg font-semibold text-foreground leading-snug">
                        {primary}
                      </p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                        {secondary}
                      </p>
                    </div>
                    <div className="flex sm:flex-col items-baseline sm:items-end gap-2 sm:gap-0.5 shrink-0">
                      <p className={`text-2xl sm:text-3xl font-bold tabular-nums whitespace-nowrap ${rightColor}`}>
                        {amountDisplay}
                      </p>
                      <p className={`text-[10px] sm:text-xs font-medium uppercase tracking-wide ${rightColor} opacity-80`}>
                        {rightLabel}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}


            {/* Attachments */}
            <TransactionAttachments
              transactionId={editingId}
              pendingFiles={editingId ? undefined : pendingAttachments}
              onPendingFilesChange={editingId ? undefined : setPendingAttachments}
            />

            <div className="flex justify-between">
              {isEditing ? (
                <Button variant="destructive" size="sm" onClick={() => { setDeleteId(editingId!); setShowForm(false); }}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button onClick={saveForm} disabled={!form.title.trim() || !form.date}>
                  {isEditing ? "Save" : "Save Income"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mobile in-ledger receipt viewer */}
      <MobileAttachmentViewer
        transactionId={mobileViewerEntryId}
        open={!!mobileViewerEntryId}
        onClose={() => setMobileViewerEntryId(null)}
      />

      {/* Per-transaction tax-savings reminder */}
      <SimpleTaxReminderModal
        open={showRecommendation}
        onClose={() => setShowRecommendation(false)}
        onApply={applyRecommendation}
        recommendedSavings={reminderRecommended}
        actualSaved={reminderActualSaved}
        entryTitle={savedEntryTitle}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Income Entry</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this income entry.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
