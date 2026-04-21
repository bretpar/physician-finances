import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, Wallet, ChevronDown, ChevronRight } from "lucide-react";
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
import { TransactionAttachments } from "@/components/TransactionAttachments";
import { useAttachmentCounts } from "@/hooks/useAttachments";
import { usePersonalIncomeEntries, useAddPersonalIncome, useUpdatePersonalIncome, useDeletePersonalIncome, type PersonalIncomeEntry } from "@/hooks/usePersonalIncome";
import { useWithholdingRecommendation } from "@/hooks/useWithholdingRecommendation";
import { useIncomeRecommendation, type IncomeRecommendation } from "@/hooks/useIncomeRecommendation";
import { RecommendationModal } from "@/components/RecommendationModal";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { SourceEmployerCombobox, persistNewSourceIfRequested } from "@/components/SourceEmployerCombobox";
import { useCreateIncomeSource, type SourceKind } from "@/hooks/useIncomeSources";
import { useCompanies } from "@/contexts/CompanyContext";
import { normalizeFilingType, resolveAdvancedVisibility, type ToggleKey } from "@/lib/filingTypes";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { TotalFederalTaxField } from "@/components/TotalFederalTaxField";

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
  owner_healthcare: string;
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
  owner_healthcare: "",
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
  const { data: entries = [], isLoading } = usePersonalIncomeEntries();
  const { companies } = useCompanies();
  const addMutation = useAddPersonalIncome();
  const updateMutation = useUpdatePersonalIncome();
  const deleteMutation = useDeletePersonalIncome();
  const createSource = useCreateIncomeSource();
  const { getRecommendation: getWithholdingRec } = useWithholdingRecommendation();
  const { getRecommendation: getIncomeRec } = useIncomeRecommendation();
  const { data: attachmentCounts } = useAttachmentCounts();
  const { data: taxSettings } = useTaxSettings();
  const stateTaxEnabled = !!taxSettings?.stateTaxEnabled;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showSourceError, setShowSourceError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Modal 2 state
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);
  const [savedEntryTitle, setSavedEntryTitle] = useState("");
  const [currentRecommendation, setCurrentRecommendation] = useState<IncomeRecommendation | null>(null);

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
        const withheld = Number(e.federal_withholding) + Number(e.state_withholding);
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
      preTaxDeductions: num(form.deductions_pre_tax) + num(form.owner_healthcare),
      alreadyIncludedInEstimate: isEditing,
    });
  }, [grossAmount, form.income_type, form.federal_withholding, form.ss_withholding, form.medicare_withholding, form.retirement_pretax, form.deductions_pre_tax, form.owner_healthcare, getWithholdingRec, isEditing]);

  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setShowSourceError(false);
    setAdvancedOpen(false);
    setShowForm(true);
  }

  function openEdit(entry: PersonalIncomeEntry) {
    const uiType = hydrateIncomeType(entry);
    setForm({
      date: entry.income_date,
      title: entry.name,
      income_type: uiType,
      gross_amount: String(entry.gross_amount),
      net_received: "",
      cost_basis: entry.cost_basis != null ? String(entry.cost_basis) : "",
      realized_gain_loss: entry.realized_gain_loss != null ? String(entry.realized_gain_loss) : "",
      federal_withholding: String(entry.federal_withholding),
      state_withholding: String(entry.state_withholding),
      ss_withholding: String((entry as any).ss_withholding || 0),
      medicare_withholding: String((entry as any).medicare_withholding || 0),
      total_federal_payroll_taxes: String(
        Number(entry.federal_withholding || 0) +
        Number((entry as any).ss_withholding || 0) +
        Number((entry as any).medicare_withholding || 0)
      ),
      retirement_pretax: String(entry.retirement_401k),
      deductions_pre_tax: String(entry.pre_tax_deductions),
      owner_healthcare: String((entry as any).owner_healthcare || 0),
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
      Number((entry as any).owner_healthcare || 0) > 0 ||
      Number((entry as any).additional_tax_reserve || 0) > 0 ||
      !!(entry.notes && entry.notes.trim())
    );
    setShowForm(true);
  }

  function buildPayload() {
    const grossAmt = num(form.gross_amount);
    const totalWithheld = num(form.federal_withholding) + num(form.state_withholding) + num(form.ss_withholding) + num(form.medicare_withholding);
    const computedNet = grossAmt - totalWithheld - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.owner_healthcare);
    const netReceived = num(form.net_received) > 0 ? num(form.net_received) : Math.max(0, computedNet);

    // Compute the base tax estimate for the record
    const rec = getIncomeRec({
      grossIncome: grossAmt,
      incomeType: form.income_type,
      federalWithheld: num(form.federal_withholding),
      stateWithheld: num(form.state_withholding),
      retirement401k: num(form.retirement_pretax),
      preTaxDeductions: num(form.deductions_pre_tax) + num(form.owner_healthcare),
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
        federal_withholding: num(form.federal_withholding),
        taxes_withheld: num(form.federal_withholding),
        state_withholding: num(form.state_withholding),
        ss_withholding: num(form.ss_withholding),
        medicare_withholding: num(form.medicare_withholding),
        retirement_401k: num(form.retirement_pretax),
        pre_tax_deductions: num(form.deductions_pre_tax),
        owner_healthcare: num(form.owner_healthcare),
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
        onSuccess: (_, __, context) => {
          setShowForm(false);
          if (showModal2 && recommendation) {
            setSavedEntryTitle(form.title);
            setCurrentRecommendation(recommendation);
            setShowRecommendation(true);
          }
        },
      });
    }
  }

  function applyRecommendation() {
    if (currentRecommendation && currentRecommendation.recommendedAdditionalReserve > 0) {
      const latestEntry = entries[0];
      if (latestEntry) {
        updateMutation.mutate({
          id: latestEntry.id,
          additional_tax_reserve: currentRecommendation.recommendedAdditionalReserve,
        } as any);
      }
    }
    setShowRecommendation(false);
    setCurrentRecommendation(null);
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
                  {Number(entry.federal_withholding) > 0 ? fmt(Number(entry.federal_withholding)) : "—"}
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
                  const withheld = Number(entry.federal_withholding) || 0;
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

                  return (
                    <LedgerRow
                      key={entry.id}
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
                <Input type="date" value={form.date} onChange={(e) => setField("date", e.target.value)} />
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
                    placeholder={fmt(Math.max(0, grossAmount - num(form.federal_withholding) - num(form.state_withholding) - num(form.ss_withholding) - num(form.medicare_withholding) - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.owner_healthcare)))}
                    value={form.net_received}
                    onChange={(e) => setField("net_received", e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Amount deposited into your bank account after taxes and deductions</p>
                </div>
                <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
                  Estimated Net: <strong>{fmt(Math.max(0, grossAmount - num(form.federal_withholding) - num(form.state_withholding) - num(form.ss_withholding) - num(form.medicare_withholding) - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.owner_healthcare)))}</strong> based on your inputs
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

            {/* Advanced details collapsible — driven by company/filing-type toggles */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Advanced details
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-3">
                  {(showField("federal_withholding") || showField("state_withholding") || showField("ss_withholding") || showField("medicare_withholding")) && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {showField("federal_withholding") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Federal W/H</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.federal_withholding} onChange={(e) => setField("federal_withholding", e.target.value)} />
                        </div>
                      )}
                      {showField("state_withholding") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">State W/H</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.state_withholding} onChange={(e) => setField("state_withholding", e.target.value)} />
                        </div>
                      )}
                      {showField("ss_withholding") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Social Security</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.ss_withholding} onChange={(e) => setField("ss_withholding", e.target.value)} />
                        </div>
                      )}
                      {showField("medicare_withholding") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Medicare</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.medicare_withholding} onChange={(e) => setField("medicare_withholding", e.target.value)} />
                        </div>
                      )}
                    </div>
                  )}

                  {(showField("retirement_401k") || showField("owner_healthcare") || showField("pre_tax_deductions")) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {showField("retirement_401k") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Retirement / 401(k)</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.retirement_pretax} onChange={(e) => setField("retirement_pretax", e.target.value)} />
                        </div>
                      )}
                      {showField("owner_healthcare") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Health Insurance</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.owner_healthcare} onChange={(e) => setField("owner_healthcare", e.target.value)} />
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

            {/* Base estimate preview at bottom of Modal 1 */}
            {grossAmount > 0 && baseRecommendation && (
              <div className="rounded-md border border-border p-3 space-y-1 bg-background">
                <p className="text-xs font-semibold text-muted-foreground">Estimated Tax Reserve</p>
                {baseRecommendation.isOverWithheld ? (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">
                    Employer over-withheld by <strong>{fmt(Math.abs(baseRecommendation.recommendedWithholding))}</strong>
                  </p>
                ) : baseRecommendation.recommendedWithholding > 0 ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Estimated additional tax reserve: <strong>{fmt(baseRecommendation.recommendedWithholding)}</strong>
                  </p>
                ) : (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">
                    Your withholding covers the estimated tax for this paycheck.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {baseRecommendation.methodLabel} · {baseRecommendation.effectiveRate.toFixed(1)}% effective rate
                </p>
                <p className="text-[10px] text-muted-foreground italic">
                  Withholding method controlled in Settings
                </p>
              </div>
            )}

            {/* Attachments */}
            <TransactionAttachments transactionId={editingId} />

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

      {/* Modal 2: Post-Save Smart Recommendation */}
      <RecommendationModal
        open={showRecommendation}
        onClose={() => { setShowRecommendation(false); setCurrentRecommendation(null); }}
        onApplyRecommendation={applyRecommendation}
        recommendation={currentRecommendation}
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
