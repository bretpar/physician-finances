import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, Wallet, ChevronDown, ChevronRight, Paperclip, Link2, Info, X } from "lucide-react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { MoreHorizontal, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LedgerRow, MonthHeader, groupByMonth, type LedgerRowBadge } from "@/components/LedgerRow";
import { txTone } from "@/lib/transactionTones";
import { TransactionAttachments, MobileAttachmentViewer, SiblingReceiptsList } from "@/components/TransactionAttachments";
import { useIncomeMatchGroups, useCreateIncomeMatchGroup, useUnlinkIncomeMatchGroupItem, useMarkIncomeReviewed, isImportedCashIncomeRow } from "@/hooks/useIncomeMatching";
import { IncomeLinkModal } from "@/components/IncomeLinkModal";
import { CheckCircle2, Unlink } from "lucide-react";
import { useAttachmentCounts, useUploadAttachments } from "@/hooks/useAttachments";
import { DateField } from "@/components/DateField";
import { usePersonalIncomeEntries, useAddPersonalIncome, useUpdatePersonalIncome, useDeletePersonalIncome, type PersonalIncomeEntry } from "@/hooks/usePersonalIncome";
import { usePlannerConversionsFull, useProjectedStreams, useStreamOverrides } from "@/hooks/useProjectedIncome";
import { useNavigate } from "react-router-dom";
import { dedupeYtdPersonalMirrors } from "@/lib/ytdCatchupLedger";
import { useRepairYtdCatchupMirrors } from "@/hooks/useYtdCatchup";
import { useWithholdingRecommendation } from "@/hooks/useWithholdingRecommendation";
import { useIncomeRecommendation } from "@/hooks/useIncomeRecommendation";
import { formatDate, formatDateShort, formatMonthYear, getTodayLocalDateString } from "@/lib/localDate";
import { SimpleTaxReminderModal } from "@/components/SimpleTaxReminderModal";
import { isPersonalIncomeReportable } from "@/lib/personalIncomeReportability";
import { RecommendedSetAsideInfo } from "@/components/RecommendedSetAsideInfo";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { SourceEmployerCombobox, persistNewSourceIfRequested } from "@/components/SourceEmployerCombobox";
import { useCreateIncomeSource, type SourceKind } from "@/hooks/useIncomeSources";
import { useCompanies } from "@/contexts/CompanyContext";
import { normalizeFilingType, resolveAdvancedVisibility, type ToggleKey } from "@/lib/filingTypes";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { filterIncomeTypeOptions, isIncomeEntryTypeDisabled } from "@/lib/householdIncomeProfile";

import { TotalFederalTaxField } from "@/components/TotalFederalTaxField";
import { TransactionDetailSheet, type DetailSection } from "@/components/TransactionDetailSheet";
import { getTotalFederalPaid, getCanonicalTotalFederalPayrollTaxes } from "@/lib/federalWithholding";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import { getSelectedWithholdingProfileRate, type SavingsRateResult } from "@/lib/savingsRateSelection";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useCanonicalWithholding } from "@/hooks/useCanonicalWithholding";
import { useW4Calculation } from "@/hooks/useW4Calculation";
import { decideW2PaycheckRecDisplay } from "@/lib/w2PaycheckRecMethod";
import { normalizeEmployerName } from "@/components/tax/W4PaycheckAdjustmentCard";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const num = (v: string) => parseFloat(v) || 0;

const INCOME_TYPES = [
  { value: "w2_user", label: "W2 Income (You)" },
  { value: "w2_partner", label: "W2 Income (Partner)" },
  { value: "interest", label: "Interest" },
  { value: "rental", label: "Rental Income" },
  { value: "other_income", label: "Other Income" },
  { value: "loss", label: "Loss" },
];

const VALID_UI_TYPES = new Set(INCOME_TYPES.map((t) => t.value));
const LEGACY_INVESTMENT_UI_TYPES = new Set(["short_term_gain", "long_term_gain", "dividend"]);

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
  if (ui && LEGACY_INVESTMENT_UI_TYPES.has(ui)) return ui;
  const raw = (entry.income_type || "").toLowerCase();
  if (VALID_UI_TYPES.has(raw)) return raw;
  if (LEGACY_INVESTMENT_UI_TYPES.has(raw)) return raw;
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
  employer_hsa_contribution: string;
  source_name: string;
  source_id: string | null;
  source_save_as_new: boolean;
  source_new_kind: SourceKind | null;
  notes: string;
  additional_tax_reserve: string;
}

const emptyForm: FormState = {
  date: getTodayLocalDateString(),
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
  employer_hsa_contribution: "",
  source_name: "",
  source_id: null,
  source_save_as_new: false,
  source_new_kind: null,
  notes: "",
  additional_tax_reserve: "",
};

const isW2Type = (t: string) => t === "w2_user" || t === "w2_partner";

/**
 * Override W-2 ledger row ownership (w2_user / w2_partner) from the saved
 * company employee_role (Settings is the source of truth). MFJ users who
 * change a W-2 employer to Spouse in Settings expect ledger and W-4 rows
 * to reflect that everywhere — not the (potentially stale) ui_income_subtype
 * stored when the paycheck was first entered.
 */
function applyCompanyRoleOverride(
  uiType: string,
  entry: { source_id?: string | null; company?: string | null },
  companies: Array<{ id: string; name: string; companyType: string; employeeRole: "primary" | "spouse" | null }>,
): string {
  if (uiType !== "w2_user" && uiType !== "w2_partner") return uiType;
  let role: "primary" | "spouse" | null | undefined;
  if (entry.source_id) {
    const c = companies.find((c) => c.id === entry.source_id);
    role = c?.employeeRole ?? null;
  }
  if (!role && entry.company) {
    const norm = entry.company.trim().toLowerCase();
    const c = companies.find(
      (c) => c.name.trim().toLowerCase() === norm && (c.companyType === "w2" || c.companyType === "scorp_w2"),
    );
    role = c?.employeeRole ?? null;
  }
  if (role === "spouse") return "w2_partner";
  if (role === "primary") return "w2_user";
  return uiType;
}
const isStockType = (t: string) => t === "short_term_gain" || t === "long_term_gain";

const STATUS_ICON = { ahead: TrendingUp, on_track: Minus, behind: TrendingDown };
const STATUS_LABEL = { ahead: "Ahead", on_track: "On Track", behind: "Behind" };

export default function PersonalIncome() {
  // Idempotent repair: restore any YTD catch-up rows whose ledger mirror
  // was lost to a previous timeout. Safe no-op when everything is intact.
  useRepairYtdCatchupMirrors();
  const { data: rawEntriesUnsafe = [], isLoading } = usePersonalIncomeEntries();
  const { companies } = useCompanies();
  const [filterReview, setFilterReview] = useState<"all" | "needs_review">("all");
  const [filterPlanner, setFilterPlanner] = useState<"all" | "from_planner">("all");
  // CANONICAL: defensive dedupe so a transient sync hiccup or replication lag
  // can never render two semantic income events for the same YTD catch-up.
  const rawEntries = useMemo<PersonalIncomeEntry[]>(
    () => dedupeYtdPersonalMirrors(rawEntriesUnsafe as unknown as Array<PersonalIncomeEntry & { linked_ytd_catchup_id?: string | null; created_at?: string | null }>) as unknown as PersonalIncomeEntry[],
    [rawEntriesUnsafe],
  );
  const entries = useMemo(() => {
    return rawEntries.filter((e: any) => {
      if (filterReview === "needs_review" && !e.needs_review) return false;
      if (filterPlanner === "from_planner" && e.origin_type !== "planner_converted") return false;
      return true;
    });
  }, [rawEntries, filterReview, filterPlanner]);
  const fromPlannerCount = useMemo(
    () => rawEntries.filter((e: any) => e.origin_type === "planner_converted").length,
    [rawEntries],
  );
  const addMutation = useAddPersonalIncome();
  const navigate = useNavigate();
  const { data: plannerConversionsFull } = usePlannerConversionsFull();
  const { data: projectedStreams } = useProjectedStreams();
  const { data: streamOverrides } = useStreamOverrides();
  const plannerConversionsById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof plannerConversionsFull>[number]>();
    for (const c of plannerConversionsFull || []) map.set(c.id, c);
    return map;
  }, [plannerConversionsFull]);
  const streamById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof projectedStreams>[number]>();
    for (const s of projectedStreams || []) map.set(s.id, s);
    return map;
  }, [projectedStreams]);
  const overrideByStreamDate = useMemo(() => {
    const map = new Map<string, NonNullable<typeof streamOverrides>[number]>();
    for (const o of streamOverrides || []) {
      map.set(`${o.stream_id}:${o.override_date}`, o);
      if (o.new_date) map.set(`${o.stream_id}:${o.new_date}`, o);
    }
    return map;
  }, [streamOverrides]);
  const updateMutation = useUpdatePersonalIncome();
  const deleteMutation = useDeletePersonalIncome();
  const createSource = useCreateIncomeSource();
  const { getRecommendation: getWithholdingRec } = useWithholdingRecommendation();
  const { getRecommendation: getIncomeRec } = useIncomeRecommendation();
  const { data: attachmentCounts } = useAttachmentCounts();
  const { data: taxSettings } = useTaxSettings();
  const { actualEstimate, currentPaceEstimate, forecastEstimate } = useTaxEstimate();
  const needsReviewCount = useMemo(
    () => rawEntries.filter((e: any) => e.needs_review).length,
    [rawEntries],
  );
  const stateIncomeTaxEnabled = !!taxSettings?.stateIncomeTaxEnabled;
  const w2RecMethod = taxSettings?.w2PaycheckRecMethod || "annual_w4";
  const w4Calc = useW4Calculation();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showSourceError, setShowSourceError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [mobileViewerEntryId, setMobileViewerEntryId] = useState<string | null>(null);
  const [detailEntry, setDetailEntry] = useState<PersonalIncomeEntry | null>(null);
  const [taxesWithheldOpen, setTaxesWithheldOpen] = useState(false);
  const uploadAttachments = useUploadAttachments();

  // ─── Mobile multi-select / linking ───
  const { data: incomeMatchGroups } = useIncomeMatchGroups();
  const createIncomeMatchGroup = useCreateIncomeMatchGroup();
  const unlinkIncomeMatchItem = useUnlinkIncomeMatchGroupItem();
  const markReviewed = useMarkIncomeReviewed();
  const [linkModalEntry, setLinkModalEntry] = useState<PersonalIncomeEntry | null>(null);

  // Map: entry.id -> { groupId, partnerCount }
  const linkedEntryMap = useMemo(() => {
    const m = new Map<string, { groupId: string; count: number }>();
    if (!incomeMatchGroups) return m;
    for (const [groupId, items] of incomeMatchGroups.entries()) {
      for (const it of items) m.set(it.entry.id, { groupId, count: items.length });
    }
    return m;
  }, [incomeMatchGroups]);
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);
  const [mobileSelectedOrder, setMobileSelectedOrder] = useState<string[]>([]);
  const exitMobileSelection = () => {
    setMobileSelectionMode(false);
    setMobileSelectedOrder([]);
  };
  const toggleMobileSelect = (id: string) => {
    setMobileSelectedOrder((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };
  const enterMobileSelectionWith = (id: string) => {
    setMobileSelectionMode(true);
    setMobileSelectedOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  // Per-transaction tax-savings reminder state
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);
  const [savedEntryTitle, setSavedEntryTitle] = useState("");
  const [savedEntryAt, setSavedEntryAt] = useState<string | null>(null);
  const [savedEntryMode, setSavedEntryMode] = useState<"create" | "update" | null>(null);
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

  // CANONICAL withholding total — sourced from the unified tax engine so this
  // matches Tax Overview and the Withholding Guide exactly. Do NOT re-aggregate
  // federal_withholding / taxes_withheld here. See src/lib/canonicalWithholding.ts.
  const canonicalWithholding = useCanonicalWithholding("PersonalIncome");

  // Summary stats. The "Taxes Withheld" card is derived from the SAME visible/
  // active canonical Personal Income entries shown in the ledger — NOT from
  // useCanonicalWithholding() which spans personal+business+projected and
  // caused page-level drift ($1,869 vs $1,262) with the W-2 breakdown.
  const totals = useMemo(() => {
    // Exclude shadow rows (unlinked imported Plaid cash-confirmation) from
    // aggregate totals so they don't double-count against the canonical
    // planner/manual paycheck. They remain visible in the ledger below.
    const reportableEntries = entries.filter((e) =>
      isPersonalIncomeReportable(e as any),
    );
    const stats = reportableEntries.reduce(
      (acc, e) => {
        const amt = Number(e.gross_amount);
        const isW2 = isW2Type(hydrateIncomeType(e));
        // Canonical federal payroll total (handles taxes_withheld precedence;
        // avoids double-counting split federal/ss/medicare fields).
        const rowFedTotal = isW2 ? getTotalFederalPaid(e) : 0;
        const rowStateW = isW2 ? Number(e.state_withholding || 0) : 0;
        return {
          totalIncome: acc.totalIncome + (e.income_type === "loss" ? -Math.abs(amt) : amt),
          w2Income: acc.w2Income + (isW2 ? amt : 0),
          capitalGains: acc.capitalGains + (isStockType(hydrateIncomeType(e)) ? amt : 0),
          passiveIncome: acc.passiveIncome + (hydrateIncomeType(e) === "rental" ? amt : 0),
          w2FederalWH: acc.w2FederalWH + (isW2 ? Number(e.federal_withholding || 0) : 0),
          w2SsWH: acc.w2SsWH + (isW2 ? Number(e.ss_withholding || 0) : 0),
          w2MedicareWH: acc.w2MedicareWH + (isW2 ? Number(e.medicare_withholding || 0) : 0),
          w2FedTotal: acc.w2FedTotal + rowFedTotal,
          w2StateWH: acc.w2StateWH + rowStateW,
        };
      },
      { totalIncome: 0, w2Income: 0, capitalGains: 0, passiveIncome: 0, w2FederalWH: 0, w2SsWH: 0, w2MedicareWH: 0, w2FedTotal: 0, w2StateWH: 0 }
    );
    return {
      ...stats,
      w2PayrollTaxTotal: stats.w2FederalWH + stats.w2SsWH + stats.w2MedicareWH,
      totalWithheld: stateIncomeTaxEnabled
        ? stats.w2FedTotal + stats.w2StateWH
        : stats.w2FedTotal,
    };
  }, [entries, stateIncomeTaxEnabled]);


  // Base withholding recommendation for Modal 1
  const grossAmount = num(form.gross_amount);
  const baseRecommendation = useMemo(() => {
    if (grossAmount <= 0) return null;
    return getWithholdingRec({
      grossIncome: grossAmount,
      incomeType: isW2Type(form.income_type) ? "w2" : form.income_type,
      incomeBucket: "personal",
      taxesAlreadyWithheld:
        getCanonicalTotalFederalPayrollTaxes({
          total_federal_payroll_taxes: form.total_federal_payroll_taxes,
          federal_withholding: num(form.federal_withholding),
          ss_withholding: num(form.ss_withholding),
          medicare_withholding: num(form.medicare_withholding),
        }) + (stateIncomeTaxEnabled ? num(form.state_withholding) : 0),
      retirement401k: num(form.retirement_pretax),
      preTaxDeductions: num(form.deductions_pre_tax) + num(form.healthcare_deduction) + num(form.hsa_contribution),
      alreadyIncludedInEstimate: isEditing,
    });
  }, [grossAmount, form.income_type, form.total_federal_payroll_taxes, form.federal_withholding, form.ss_withholding, form.medicare_withholding, form.state_withholding, form.retirement_pretax, form.deductions_pre_tax, form.healthcare_deduction, form.hsa_contribution, stateIncomeTaxEnabled, getWithholdingRec, isEditing]);

  // ── Per-paycheck profile-based savings guide ────────────────────────────
  // Simple paycheck-only calculation: uses the user's selected tax profile
  // effective rate (NOT annual remaining tax / quarterly catch-up). Lives in
  // calculatePaycheckProfileSavings so the math stays consistent and isolated
  // from the annual recommendation engine in useWithholdingRecommendation.
  const paycheckSavings = useMemo(() => {
    if (grossAmount <= 0 || !taxSettings) return null;

    // 1. Resolve the selected withholding profile directly for W-2 paychecks.
    //    Flat mode uses the manual rate; dynamic modes use the same all-inclusive
    //    canonical effective rate shown on the Tax page. Business income keeps
    //    using the bucket-aware selector elsewhere so SE/B&O add-ons stay separate.
    const selectedProfile = getSelectedWithholdingProfileRate({
      taxSettings,
      actualEstimate,
      currentPaceEstimate,
      forecastEstimate,
    });
    const method = selectedProfile.methodUsed;
    const effectiveRate =
      method === "flat_estimate"
        ? selectedProfile.federalProfileRate
        : selectedProfile.canonicalEffectiveTaxRate;

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

    const result = calculatePaycheckProfileSavings({
      grossPaycheckIncome: grossAmount,
      eligiblePreTaxDeductions: eligibleDeductions,
      selectedProfileEffectiveTaxRate: effectiveRate,
      totalFederalPayrollTaxes,
      stateWithholdingIfEnabled: stateIncomeTaxEnabled ? num(form.state_withholding) : 0,
      // Live form value — the paycheck guide updates immediately when the
      // user types in the Additional Tax Reserve field for this entry.
      // This reserve applies ONLY to this entry and is not actual withholding.
      additionalTaxReserveForThisEntry: num(form.additional_tax_reserve),
    });

    const methodLabel = selectedProfile.label;

    const rateBreakdown: SavingsRateResult = {
      rate: effectiveRate,
      components: {
        federal: effectiveRate,
        employeeSocialSecurity: 0,
        employeeMedicare: 0,
        selfEmployment: 0,
        seSocialSecurity: 0,
        seMedicare: 0,
        seAdditionalMedicare: 0,
        seSocialSecurityCapped: false,
        personalState: 0,
        businessState: 0,
      },
      method,
      baseRateSource: method === "flat_estimate" ? "manualEffectiveTaxRate" : "effectiveRate",
      label: methodLabel,
    };

    return { ...result, methodLabel, rateBreakdown };
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
    form.additional_tax_reserve,
    stateIncomeTaxEnabled,
    taxSettings,
    actualEstimate,
    currentPaceEstimate,
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
    if ((entry as any).linked_ytd_catchup_id) {
      // Use sonner directly so we don't need to wire navigate here.
      import("sonner").then(({ toast }) => {
        toast.info("This is a YTD Catch-Up Entry. Edit it from Income → YTD Catch-Up section.");
      });
      return;
    }
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
      employer_hsa_contribution: String((entry as any).employer_hsa_contribution || 0),
      source_name: entry.company,
      source_id: (entry as any).source_id ?? null,
      source_save_as_new: false,
      source_new_kind: null,
      notes: entry.notes || "",
      additional_tax_reserve: String((entry as any).additional_tax_reserve || 0),
    });
    setEditingId(entry.id);
    setShowSourceError(false);
    setAdvancedOpen(false);
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
    const computedNet = grossAmt - totalWithheld - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.healthcare_deduction) - num(form.hsa_contribution);
    const netReceived = num(form.net_received) > 0 ? num(form.net_received) : Math.max(0, computedNet);

    // Compute the base tax estimate for the record using the canonical total.
    const rec = getIncomeRec({
      grossIncome: grossAmt,
      incomeType: form.income_type,
      incomeBucket: "personal",
      federalWithheld: totalFederal,
      stateWithheld: stateW,
      retirement401k: num(form.retirement_pretax),
      preTaxDeductions: num(form.deductions_pre_tax) + num(form.healthcare_deduction) + num(form.hsa_contribution),
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
        employer_hsa_contribution: num(form.employer_hsa_contribution),
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
    // Only persist a new company/source when the user explicitly opted-in via
    // the "Save this employer/source for future use" checkbox. Manual "Other"
    // entries without the checkbox are stored on the income row only.
    if (!payloadSourceId && form.source_save_as_new && form.source_name.trim()) {
      try {
        const newId = await persistNewSourceIfRequested(
          {
            otherName: form.source_name,
            saveAsNew: form.source_save_as_new,
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
      const editId = editingId!;
      updateMutation.mutate({ id: editId, ...finalPayload } as any, {
        onSuccess: () => {
          // Explicit success signal for automated audits — the ledger refetch
          // has already completed (see useUpdatePersonalIncome.onSuccess).
          setSavedEntryId(editId);
          setSavedEntryTitle(form.title);
          setSavedEntryAt(new Date().toISOString());
          setSavedEntryMode("update");
          setShowForm(false);
          setEditingId(null);
        },
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
          // Explicit success signal — newId is guaranteed and the ledger has
          // already been refetched (see useAddPersonalIncome.onSuccess).
          setSavedEntryId(newId);
          setSavedEntryTitle(form.title);
          setSavedEntryAt(new Date().toISOString());
          setSavedEntryMode("create");
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

  // Detect a strict W-2-only household — drives copy on this page so users
  // who never opted into 1099/K-1/S-corp/business income don't see business
  // language. Mixed-income users retain the original copy and full inputs.
  const streams = taxSettings?.householdIncomeStreams;
  const isW2OnlyHousehold = !!(
    streams &&
    (streams.w2Income || streams.spouseW2Income || streams.additionalW2Job) &&
    !streams.business1099Income &&
    !streams.k1PartnershipIncome &&
    !streams.sCorpIncome
  );

  return (
    <div
      className="space-y-4 max-w-4xl mx-auto"
      data-testid="personal-income-page"
      data-household-type={isW2OnlyHousehold ? "w2_only" : "mixed"}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {isW2OnlyHousehold ? "W-2 Paychecks" : "Personal Income"}
            </h1>
            <p className="text-xs text-muted-foreground" data-testid="personal-income-subtitle">
              {isW2OnlyHousehold
                ? "Your W-2 paychecks and payroll withholding"
                : "Actual non-business income affecting your taxes"}
            </p>
          </div>
        </div>
        <Button data-testid="add-paycheck-button" size="sm" onClick={openAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> {isW2OnlyHousehold ? "Add Paycheck" : "Add"}
        </Button>
      </div>

      {/* Primary focus: Total Personal Income hero card */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 sm:p-8 text-center shadow-sm">
        <p className="text-[11px] sm:text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {isW2OnlyHousehold ? "Total W-2 Income" : "Total Personal Income"}
        </p>
        <p className="mt-0.5 sm:mt-3 text-2xl sm:text-5xl font-bold tracking-tight text-foreground leading-tight">
          {fmt(totals.totalIncome)}
        </p>
      </div>

      {/* W2 + Taxes Withheld row — compact on mobile */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-card px-3 py-2 sm:p-4">
          <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5 truncate">W2 Income</p>
          <p className="text-sm sm:text-xl font-bold text-card-foreground truncate">{fmt(totals.w2Income)}</p>
        </div>
        <Popover open={taxesWithheldOpen} onOpenChange={setTaxesWithheldOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="rounded-lg border border-border bg-card px-3 py-2 sm:p-4 text-left w-full"
              aria-label="Taxes Withheld breakdown"
            >
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
                  Taxes Withheld
                </p>
                {totals.w2PayrollTaxTotal > 0 && (
                  <Info className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                )}
              </div>
              <p className="text-sm sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 truncate">{fmt(totals.totalWithheld)}</p>
            </button>
          </PopoverTrigger>
          {totals.w2PayrollTaxTotal > 0 && (
            <PopoverContent
              side="bottom"
              align="center"
              sideOffset={6}
              className="w-[18rem] sm:w-80 p-0"
            >
              <div className="p-3 sm:p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    W-2 Taxes Withheld
                  </p>
                  <button
                    type="button"
                    onClick={() => setTaxesWithheldOpen(false)}
                    className="rounded p-1 hover:bg-muted -mr-1 -mt-1"
                    aria-label="Close breakdown"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Federal Income Tax</span>
                    <span
                      className="text-sm font-semibold text-card-foreground"
                      data-testid="w2-federal-withheld"
                    >
                      {fmt(totals.w2FederalWH)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Social Security</span>
                    <span
                      className="text-sm font-semibold text-card-foreground"
                      data-testid="w2-ss-withheld"
                    >
                      {fmt(totals.w2SsWH)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Medicare</span>
                    <span
                      className="text-sm font-semibold text-card-foreground"
                      data-testid="w2-medicare-withheld"
                    >
                      {fmt(totals.w2MedicareWH)}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground leading-snug border-t border-border pt-2">
                  Quarterly estimated tax recommendations only use federal income tax withholding as a payment credit.
                </p>
              </div>
            </PopoverContent>
          )}
        </Popover>
      </div>


      {/* Filters */}
      {(fromPlannerCount > 0 || needsReviewCount > 0 || filterReview !== "all" || filterPlanner !== "all") && (
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
      {/* Explicit post-save success marker for automated audits. Hidden from
          users but stable in the DOM. The presence of `data-entry-id` (with
          the new row already present in the ledger) confirms that the save
          flow completed AND the ledger refetch settled. */}
      {savedEntryId && (
        <div
          data-testid="paycheck-save-success"
          data-entry-id={savedEntryId}
          data-entry-title={savedEntryTitle}
          data-entry-mode={savedEntryMode ?? ""}
          data-saved-at={savedEntryAt ?? ""}
          data-ledger-count={entries.length}
          className="sr-only"
          aria-hidden="true"
        />
      )}

      <div data-testid="paychecks-ledger" data-ledger-count={entries.length} className="rounded-xl border border-border bg-card overflow-hidden">
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
            const uiType = applyCompanyRoleOverride(hydrateIncomeType(entry), entry as any, companies);
            const typeLabel = INCOME_TYPES.find((t) => t.value === uiType)?.label || uiType;
            const isLoss = uiType === "loss";
            const reserve = Number((entry as any).additional_tax_reserve || 0);
            const status = ((entry as any).recommendation_status || "on_track") as keyof typeof STATUS_ICON;
            const StIcon = STATUS_ICON[status] || Minus;
            return (
              <div
                key={entry.id}
                data-testid="paycheck-row"
                data-paycheck-id={entry.id}
                data-company-id={entry.source_id ?? ""}
                data-employer={entry.company ?? ""}
                data-income-type={entry.income_type}
                data-ui-income-subtype={uiType}
                data-gross={Number(entry.gross_amount) || 0}
                className="grid grid-cols-[90px_1fr_100px_100px_120px_80px_40px] gap-2 px-4 py-3 hover:bg-muted/30 transition-colors items-center cursor-pointer"
                onClick={() => setDetailEntry(entry)}
              >
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatDateShort(entry.income_date)}
                </span>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground truncate block flex items-center gap-1.5 flex-wrap">
                    {entry.name}
                    {(entry as any).linked_ytd_catchup_id && (
                      <span className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                        YTD
                      </span>
                    )}
                    {linkedEntryMap.has(entry.id) && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        <Link2 className="h-2.5 w-2.5" /> Linked
                      </span>
                    )}
                    {(entry as any).needs_review && !linkedEntryMap.has(entry.id) && (
                      <span className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        Needs Review
                      </span>
                    )}
                    {!(entry as any).needs_review && (entry as any).reviewed_at && (entry as any).origin_type === "planner_converted" && !linkedEntryMap.has(entry.id) && (
                      <span className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Reviewed
                      </span>
                    )}
                  </span>
                  {entry.company && <span className="text-xs text-muted-foreground">{entry.company}</span>}
                  {(entry as any).linked_ytd_catchup_id && (
                    <span className="text-[10px] text-primary block">
                      Setup income through {formatMonthYear(entry.income_date)}
                    </span>
                  )}
                  {(entry as any).origin_type === "planner_converted" && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">From Income Planner</span>
                  )}
                </div>
                <span className={`inline-flex w-fit text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  isLoss ? txTone("transfer").pill : txTone("income").pill
                }`}>{typeLabel}</span>
                <span className={`text-sm font-semibold tabular-nums text-right ${isLoss ? txTone("expense").amount : txTone("income").amount}`}>
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
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => openEdit(entry)}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    {linkedEntryMap.has(entry.id) ? (
                      <DropdownMenuItem
                        onClick={() => {
                          const info = linkedEntryMap.get(entry.id);
                          if (info) unlinkIncomeMatchItem.mutate({ itemId: entry.id, groupId: info.groupId });
                        }}
                      >
                        <Unlink className="h-4 w-4 mr-2" /> Unlink transaction
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => setLinkModalEntry(entry)}>
                        <Link2 className="h-4 w-4 mr-2" /> Link to bank transaction
                      </DropdownMenuItem>
                    )}
                    {(entry as any).needs_review && (
                      <DropdownMenuItem onClick={() => markReviewed.mutate(entry.id)}>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Mark as reviewed
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        if ((entry as any).linked_ytd_catchup_id) {
                          import("sonner").then(({ toast }) => {
                            toast.info("Delete this from Income → YTD Catch-Up. That removes it from every screen.");
                          });
                          return;
                        }
                        setDeleteId(entry.id);
                      }}
                      className="text-destructive focus:text-destructive"
                    >
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
                  const uiType = applyCompanyRoleOverride(hydrateIncomeType(entry), entry as any, companies);
                  const typeLabel =
                    INCOME_TYPES.find((t) => t.value === uiType)?.label ||
                    uiType;
                  const isLoss = uiType === "loss";
                  // Use the same canonical federal total the dashboard tracker
                  // shows so the ledger and Quarterly Tax Progress agree.
                  const withheld = getTotalFederalPaid(entry as any);
                  const reserve = Number((entry as any).additional_tax_reserve || 0);
                  const dateStr = formatDate(entry.income_date);
                  const badges: LedgerRowBadge[] = [];
                  if (linkedEntryMap.has(entry.id)) {
                    badges.push({ label: "Linked", tone: "success" });
                  } else if ((entry as any).needs_review) {
                    badges.push({ label: "Needs Review", tone: "warning" });
                  } else if ((entry as any).reviewed_at && (entry as any).origin_type === "planner_converted") {
                    badges.push({ label: "Reviewed", tone: "muted" });
                  }
                  const isMobileSelected = mobileSelectedOrder.includes(entry.id);

                  return (
                    <div
                      key={entry.id}
                      data-testid="paycheck-row"
                      data-paycheck-id={entry.id}
                      data-company-id={entry.source_id ?? ""}
                      data-employer={entry.company ?? ""}
                      data-income-type={entry.income_type}
                      data-ui-income-subtype={uiType}
                      data-gross={Number(entry.gross_amount) || 0}
                    >
                      <LedgerRow
                        kind={isLoss ? "neutral" : "income"}
                        title={entry.name || "(No payor)"}
                        subtitle={(entry as any).linked_ytd_catchup_id
                          ? `Setup income through ${formatMonthYear(entry.income_date)}`
                          : typeLabel}
                        meta={entry.company || null}
                        date={dateStr}
                        amount={Number(entry.gross_amount) || 0}
                        amountTone={isLoss ? "negative" : "positive"}
                        amountPrefix={isLoss ? "-" : "+"}
                        badges={badges}
                        selected={mobileSelectionMode ? isMobileSelected : false}
                        selectionMode={mobileSelectionMode}
                        onToggleSelect={() => toggleMobileSelect(entry.id)}
                        onLongPress={() => enterMobileSelectionWith(entry.id)}
                        onClick={() => setDetailEntry(entry)}
                      />
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

      {/* Mobile selection action bar — only visible in selection mode */}
      {mobileSelectionMode && (() => {
        const count = mobileSelectedOrder.length;
        const canLink = count >= 2;
        const helper = count === 0
          ? "Tap an entry to select it"
          : count === 1
            ? "Select one more to link"
            : `${count} entries ready to link`;
        return (
          <div className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
            <div className="px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.75rem)] flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{count} selected</div>
                <div className="text-[11px] text-muted-foreground truncate">{helper}</div>
              </div>
              <Button variant="ghost" size="sm" className="h-9 text-sm" onClick={exitMobileSelection}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-9 text-sm gap-1.5"
                disabled={!canLink || createIncomeMatchGroup.isPending}
                onClick={() => {
                  if (!canLink) return;
                  createIncomeMatchGroup.mutate(
                    { entryIds: [...mobileSelectedOrder] },
                    { onSuccess: () => exitMobileSelection() },
                  );
                }}
              >
                <Link2 className="h-4 w-4" /> Link
              </Button>
            </div>
          </div>
        );
      })()}
      {mobileSelectionMode && <div className="sm:hidden h-20" aria-hidden />}

      {/* Modal 1: Add/Edit Income Entry */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditingId(null); } }}>
        <DialogContent data-testid="paycheck-form-modal" className="max-w-lg max-h-[85vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Income Entry" : "Add Personal Income"}</DialogTitle>
            <DialogDescription className="sr-only">
              {isEditing ? "Edit details for this personal income entry." : "Add a personal income entry, including date, type, amount, and any tax withholdings."}
            </DialogDescription>
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
                  <SelectTrigger data-testid="paycheck-income-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {filterIncomeTypeOptions(INCOME_TYPES, taxSettings?.householdIncomeStreams, form.income_type).map((t) => {
                      // Map W-2 user/partner to friendly primary/spouse aliases for E2E selectors.
                      const alias = t.value === "w2_user" ? "primary" : t.value === "w2_partner" ? "spouse" : t.value;
                      return (
                        <SelectItem
                          key={t.value}
                          value={t.value}
                          data-testid={`paycheck-income-type-option-${alias}`}
                          data-testid-value={`paycheck-income-type-option-${t.value}`}
                        >
                          {t.label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {isIncomeEntryTypeDisabled(taxSettings?.householdIncomeStreams, form.income_type) && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    <Badge variant="outline" className="mr-1">No longer active in profile</Badge>
                    Kept available so you can edit this existing entry.
                  </p>
                )}
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
              <Input data-testid="paycheck-title-input" placeholder="e.g. March Paycheck" value={form.title} onChange={(e) => setField("title", e.target.value)} />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Gross Income *</Label>
              <Input data-testid="paycheck-gross-input" type="number" min="0" step="0.01" placeholder="0.00" value={form.gross_amount} onChange={(e) => setField("gross_amount", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Total income before taxes or deductions</p>
            </div>

            {/* Net Received + Estimated Net */}
            {grossAmount > 0 && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Net Received (Optional)</Label>
                  <Input
                    data-testid="paycheck-net-input"
                    type="number" min="0" step="0.01"
                    placeholder={fmt(Math.max(0, grossAmount - num(form.federal_withholding) - num(form.state_withholding) - num(form.ss_withholding) - num(form.medicare_withholding) - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.healthcare_deduction) - num(form.hsa_contribution)))}
                    value={form.net_received}
                    onChange={(e) => setField("net_received", e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Amount deposited into your bank account after taxes and deductions</p>
                </div>
                <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
                  Estimated Net: <strong>{fmt(Math.max(0, grossAmount - num(form.federal_withholding) - num(form.state_withholding) - num(form.ss_withholding) - num(form.medicare_withholding) - num(form.deductions_pre_tax) - num(form.retirement_pretax) - num(form.healthcare_deduction) - num(form.hsa_contribution)))}</strong> based on your inputs
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
                collapseKey={editingId || showForm}
              />
            )}

            {stateIncomeTaxEnabled && showField("state_withholding") && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">State tax withheld</Label>
                <Input
                  data-testid="paycheck-state-withholding-input"
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
                          <Input data-testid="paycheck-401k-input" type="number" min="0" step="0.01" placeholder="0.00" value={form.retirement_pretax} onChange={(e) => setField("retirement_pretax", e.target.value)} />
                        </div>
                      )}
                      {showField("healthcare_deduction") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Health Insurance</Label>
                          <Input data-testid="paycheck-health-insurance-input" type="number" min="0" step="0.01" placeholder="0.00" value={form.healthcare_deduction} onChange={(e) => setField("healthcare_deduction", e.target.value)} />
                        </div>
                      )}
                      {showField("hsa_contribution") && (
                        <div>
                          <Label
                            className="text-xs text-muted-foreground mb-1.5 block"
                            title="Your pre-tax HSA contribution deducted from this paycheck (Section 125). Reduces your W-2 wages."
                          >
                            HSA — Employee (pre-tax)
                          </Label>
                          <Input
                            data-testid="paycheck-hsa-input"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={form.hsa_contribution}
                            onChange={(e) => setField("hsa_contribution", e.target.value)}
                          />
                        </div>
                      )}
                      {showField("hsa_contribution") && (
                        <div>
                          <Label
                            className="text-xs text-muted-foreground mb-1.5 block"
                            title="Employer HSA contribution funded by your employer. Not part of your take-home pay. Counts toward the annual HSA limit but is not an additional deduction."
                          >
                            HSA — Employer contribution
                          </Label>
                          <Input
                            data-testid="paycheck-employer-hsa-input"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={form.employer_hsa_contribution}
                            onChange={(e) => setField("employer_hsa_contribution", e.target.value)}
                          />
                        </div>
                      )}
                      {showField("pre_tax_deductions") && (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Other Pre-Tax</Label>
                          <Input data-testid="paycheck-pretax-other-input" type="number" min="0" step="0.01" placeholder="0.00" value={form.deductions_pre_tax} onChange={(e) => setField("deductions_pre_tax", e.target.value)} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Additional tax reserve — extra money the user is setting
                      aside for taxes for THIS specific paycheck only. Not
                      counted as actual federal/state/SS/Medicare withholding,
                      and does not spread across other paychecks. Available on
                      add and edit so the live paycheck guide reflects it. */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Additional Tax Reserve</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.additional_tax_reserve} onChange={(e) => setField("additional_tax_reserve", e.target.value)} />
                    <p className="text-[10px] text-muted-foreground mt-1">Extra money you set aside for taxes on this paycheck. Not actual withholding.</p>
                  </div>

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
              const isW2 = isW2Type(form.income_type);

              // Annual W-4 method (W-2 only): replace per-paycheck target with
              // W-4 gap messaging that references the W-4 Calculator tab.
              if (isW2 && w2RecMethod === "annual_w4") {
                // Match this paycheck's employer to a W-4 allocation row to
                // surface the per-paycheck extra recommended for that employer.
                const employerName =
                  companies.find((c) => c.id === form.source_id)?.name ||
                  form.source_name ||
                  "";
                const employerKey = `emp:${normalizeEmployerName(employerName)}|w2`;
                const alloc = w4Calc.allocations.find(
                  (a) => a.streamId === employerKey,
                );
                const fallbackPerPaycheck =
                  w4Calc.allocations.length > 0
                    ? w4Calc.totalExtraThroughYearEnd /
                      Math.max(
                        1,
                        w4Calc.allocations.reduce((s, a) => s + a.remainingPaychecks, 0),
                      )
                    : 0;
                const extraPerPaycheck = alloc
                  ? alloc.step4cPerPaycheck
                  : fallbackPerPaycheck;

                const display = decideW2PaycheckRecDisplay({
                  method: "annual_w4",
                  isW2: true,
                  signedAnnualGap: w4Calc.signedAnnualGap,
                  extraPerPaycheck,
                });
                if (!display) return null;
                const rightColor =
                  display.mode === "w4_extra_needed"
                    ? "text-orange-600 dark:text-orange-400"
                    : "text-emerald-600 dark:text-emerald-400";
                return (
                  <div
                    className="rounded-md border border-border p-3 sm:p-4 bg-background space-y-2"
                    data-testid="w2-rec-w4-mode"
                    data-w2-rec-mode={display.mode}
                  >
                    <p className="text-xs font-semibold text-muted-foreground">{display.heading}</p>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-base sm:text-lg font-semibold text-foreground leading-snug">
                          {display.primary}
                        </p>
                        <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                          {display.secondary}
                        </p>
                      </div>
                      {display.amount != null && (
                        <div className="flex sm:flex-col items-baseline sm:items-end gap-2 sm:gap-0.5 shrink-0">
                          <p className={`text-2xl sm:text-3xl font-bold tabular-nums whitespace-nowrap ${rightColor}`}>
                            ${display.amount.toLocaleString()}
                          </p>
                          <p className={`text-[10px] sm:text-xs font-medium uppercase tracking-wide ${rightColor} opacity-80`}>
                            {display.rightLabel}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // Legacy: paycheck_target (W-2) and all non-W-2 income.
              const reserveApplied = paycheckSavings.additionalTaxReserveApplied;
              const payrollWithheld = paycheckSavings.totalPayrollTaxesWithheld;
              const target = paycheckSavings.paycheckTaxTarget;
              const diff = paycheckSavings.withholdingDifference;
              const status = paycheckSavings.status;
              const isUnder = status === "under_withheld";
              const isOver = status === "over_withheld";
              const payrollOver = payrollWithheld > target;
              const isReserveDrivenOver = isOver && !payrollOver;
              const absAmount = Math.round(Math.abs(diff));
              const amountDisplay = `$${absAmount.toLocaleString()}`;
              const ratePct = paycheckSavings.effectiveRateUsed;
              const rateDisplay = `${ratePct.toFixed(1)}%`;

              const reserveNote =
                reserveApplied > 0
                  ? ` • Includes $${Math.round(reserveApplied).toLocaleString()} additional tax reserve (not actual withholding)`
                  : "";

              const underPrimary = isW2
                ? `Extra needed for this paycheck: ${amountDisplay}`
                : `Recommended to set aside: ${amountDisplay}`;
              const onTrackPrimary = isW2
                ? "Paycheck tax target met"
                : "Tax reserve on track";

              const primary = isOver
                ? isReserveDrivenOver
                  ? `You're ahead by ${amountDisplay} (payroll + reserve surplus)`
                  : `You're ahead by ${amountDisplay}`
                : isUnder
                ? underPrimary
                : onTrackPrimary;
              const secondary = isOver
                ? isReserveDrivenOver
                  ? `Your payroll withholding plus your additional tax reserve exceed this paycheck's tax target. Actual payroll withholding alone is not over • Based on effective tax rate of ${rateDisplay}${reserveNote}`
                  : `Payroll withholding alone exceeds this paycheck's tax target • Based on effective tax rate of ${rateDisplay}${reserveNote}`
                : isUnder
                ? isW2
                  ? `Per-paycheck target = gross × ${rateDisplay} − withholding − amount already saved${reserveNote}`
                  : `Recommended tax reserve based on effective tax rate of ${rateDisplay}${reserveNote}`
                : `Withholding matches your target • Based on effective tax rate of ${rateDisplay}${reserveNote}`;
              const rightLabel = isOver
                ? isReserveDrivenOver
                  ? "Over-withheld (payroll + reserve)"
                  : "Over-withheld (payroll)"
                : isUnder
                ? isW2 ? "Extra needed" : "Recommended reserve"
                : "On track";
              const rightColor = isOver
                ? "text-emerald-600 dark:text-emerald-400"
                : isUnder
                ? "text-orange-600 dark:text-orange-400"
                : "text-muted-foreground";

              return (
                <div
                  className="rounded-md border border-border p-3 sm:p-4 bg-background space-y-2"
                  data-testid="w2-rec-paycheck-target-mode"
                >
                  <p className="text-xs font-semibold text-muted-foreground">
                    {isW2 ? "Paycheck tax target" : "Recommended tax reserve"}
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-base sm:text-lg font-semibold text-foreground leading-snug">
                        {primary}
                      </p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                        {secondary}
                        <RecommendedSetAsideInfo
                          rate={ratePct}
                          breakdown={paycheckSavings.rateBreakdown}
                          taxableBase={{
                            gross: grossAmount,
                            retirement401k: num(form.retirement_pretax),
                            healthInsurance: num(form.healthcare_deduction),
                            hsa: num(form.hsa_contribution),
                            otherPreTax: num(form.deductions_pre_tax),
                          }}
                        />
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
                <Button data-testid="paycheck-delete-button" variant="destructive" size="sm" onClick={() => { setDeleteId(editingId!); setShowForm(false); }}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button data-testid="paycheck-cancel-button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button
                  data-testid="paycheck-save-button"
                  onClick={saveForm}
                  disabled={!form.title.trim() || !form.date || num(form.gross_amount) <= 0 || (isW2Type(form.income_type) && !form.source_id && !form.source_name.trim())}
                >
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

      {/* Link to bank transaction modal */}
      <IncomeLinkModal
        entry={linkModalEntry}
        open={!!linkModalEntry}
        onOpenChange={(open) => { if (!open) setLinkModalEntry(null); }}
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

      {/* Read-only detail card */}
      {detailEntry && (() => {
        const e = detailEntry;
        const uiType = applyCompanyRoleOverride(hydrateIncomeType(e), e as any, companies);
        const typeLabel = INCOME_TYPES.find((t) => t.value === uiType)?.label || uiType;
        const isLoss = uiType === "loss";
        const gross = Number(e.gross_amount) || 0;
        const withheld = getTotalFederalPaid(e as any);
        const reserve = Number((e as any).additional_tax_reserve || 0);
        const stateW = Number(e.state_withholding || 0);
        const preTax = Number((e as any).pre_tax_deductions || 0);
        const ret401k = Number((e as any).retirement_401k || 0);
        const hsa = Number((e as any).hsa_contribution || 0);
        const healthcare = Number((e as any).healthcare_deduction || 0);
        const otherDed = Number((e as any).other_deductions || 0);
        const netExplicit = (e as any).net_amount;
        const hasExplicitNet = netExplicit != null && netExplicit !== "";
        const netReceived = hasExplicitNet
          ? Number(netExplicit) || 0
          : gross - withheld - stateW - preTax - ret401k - hsa - healthcare - otherDed;
        const isYtd = !!(e as any).linked_ytd_catchup_id;
        const fromPlanner = (e as any).origin_type === "planner_converted";
        const plannerConvId = (e as any).origin_planner_conversion_id as string | null | undefined;
        const plannerConv = plannerConvId ? plannerConversionsById.get(plannerConvId) : undefined;
        const plannerStream = plannerConv?.stream_id ? streamById.get(plannerConv.stream_id) : undefined;
        const plannerOverride =
          plannerConv?.stream_id && plannerConv?.occurrence_date
            ? overrideByStreamDate.get(`${plannerConv.stream_id}:${plannerConv.occurrence_date}`)
            : undefined;
        const plannerOccurrenceKind: "normal" | "modified" | "moved" | "skipped" | null = plannerOverride
          ? plannerOverride.action === "skip"
            ? "skipped"
            : plannerOverride.new_date && plannerOverride.new_date !== plannerOverride.override_date
              ? "moved"
              : "modified"
          : plannerConv
            ? "normal"
            : null;
        const linkedGroupId = e.id
          ? Array.from(incomeMatchGroups?.entries?.() || []).find(([, items]) =>
              items.some((it) => it.entry.id === e.id),
            )?.[0]
          : undefined;
        const linkedSiblings = (linkedGroupId ? incomeMatchGroups?.get(linkedGroupId) || [] : []).filter(
          (it) => it.entry.id !== e.id,
        );
        // Pick the best imported/Plaid sibling to surface a confirmed bank
        // deposit amount alongside payroll net. Canonical payroll fields are
        // never overwritten — this is display-only.
        const hasPayrollFields = (en: any) =>
          (Number(en.federal_withholding || 0) +
            Number(en.state_withholding || 0) +
            Number(en.ss_withholding || 0) +
            Number(en.medicare_withholding || 0) +
            Number(en.pre_tax_deductions || 0) +
            Number(en.retirement_401k || 0) +
            Number(en.healthcare_deduction || 0) +
            Number(en.hsa_contribution || 0) +
            Number(en.additional_tax_reserve || 0)) > 0;
        const siblingDeposit = (en: any) =>
          Number(en.deposited_amount ?? en.gross_amount ?? en.paycheck_amount ?? 0) || 0;
        const importedSibling =
          linkedSiblings.find((it) => isImportedCashIncomeRow(it.entry)) ||
          (linkedSiblings.length === 1 &&
          !hasPayrollFields(linkedSiblings[0].entry) &&
          siblingDeposit(linkedSiblings[0].entry) > 0
            ? linkedSiblings[0]
            : null);
        const bankDeposit = importedSibling ? siblingDeposit(importedSibling.entry) : null;
        const depositVariance = bankDeposit != null ? bankDeposit - netReceived : null;
        const sections: DetailSection[] = [
          {
            title: "Basic details",
            fields: [
              { label: "Type", value: typeLabel },
              ...(e.company ? [{ label: "Source", value: e.company }] : []),
              ...(e.notes ? [{ label: "Notes", value: e.notes }] : []),
            ],
          },
          {
            title: "Tax details",
            fields: [
              { label: "Gross", value: fmt(gross), mono: true },
              {
                label: "Net received",
                value: fmt(bankDeposit != null ? bankDeposit : netReceived),
                mono: true,
              },
              ...(bankDeposit != null && depositVariance != null && Math.abs(depositVariance) >= 0.01
                ? [
                    { label: "Calculated payroll net", value: fmt(netReceived), mono: true },
                    {
                      label: "Deposit variance",
                      value: `${depositVariance >= 0 ? "+" : "−"}${fmt(Math.abs(depositVariance))}`,
                      mono: true,
                    },
                  ]
                : []),
              ...(withheld > 0 ? [{ label: "Federal paid", value: fmt(withheld), mono: true }] : []),
              ...(stateIncomeTaxEnabled && stateW > 0 ? [{ label: "State withheld", value: fmt(stateW), mono: true }] : []),
              ...(preTax > 0 ? [{ label: "Pre-tax", value: fmt(preTax), mono: true }] : []),
              ...(ret401k > 0 ? [{ label: "401(k)", value: fmt(ret401k), mono: true }] : []),
              ...(hsa > 0 ? [{ label: "HSA", value: fmt(hsa), mono: true }] : []),
              ...(healthcare > 0 ? [{ label: "Healthcare", value: fmt(healthcare), mono: true }] : []),
              ...(otherDed > 0 ? [{ label: "Other deductions", value: fmt(otherDed), mono: true }] : []),
              ...(reserve > 0 ? [{ label: "Amount saved for taxes", value: fmt(reserve), mono: true }] : []),
            ],
          },
        ];
        if (fromPlanner) {
          const kindLabel: Record<string, string> = {
            normal: "Normal scheduled paycheck",
            modified: "Modified (amount or withholdings edited)",
            moved: "Moved to a different date",
            skipped: "Marked skipped in planner",
          };
          sections.push({
            title: "Source: Income Planner",
            fields: [
              { label: "Created from", value: "Converted from Income Planner" },
              ...(plannerStream?.company
                ? [{ label: "Stream", value: plannerStream.company }]
                : []),
              ...(plannerConv?.occurrence_date
                ? [{ label: "Planned occurrence date", value: formatDate(plannerConv.occurrence_date) }]
                : []),
              ...(plannerOccurrenceKind
                ? [{ label: "Occurrence type", value: kindLabel[plannerOccurrenceKind] }]
                : []),
              ...(plannerConv?.status && plannerConv.status !== "converted"
                ? [{ label: "Conversion status", value: plannerConv.status.replace(/_/g, " ") }]
                : []),
            ],
          });
        }

        return (
          <TransactionDetailSheet
            open={!!detailEntry}
            onOpenChange={(o) => { if (!o) setDetailEntry(null); }}
            header={{
              title: e.name || "(No payor)",
              subtitle: e.company || undefined,
              date: formatDate(e.income_date),
              amount: Number(e.gross_amount) || 0,
              amountTone: isLoss ? "expense" : "income",
              badges: [
                ...((e as any).needs_review ? [{ label: "Review", tone: "warning" as const }] : []),
                ...(isYtd ? [{ label: "YTD Catch-Up", tone: "muted" as const }] : []),
                ...(fromPlanner ? [{ label: "Created from Income Planner", tone: "success" as const }] : []),
                ...(withheld > 0 ? [{ label: `Withheld ${fmt(withheld)}`, tone: "muted" as const }] : []),
                ...(reserve > 0 ? [{ label: `Reserve ${fmt(reserve)}`, tone: "default" as const }] : []),
              ],
            }}
            sections={sections}
            extraContent={
              <section className="space-y-3">
                {fromPlanner && plannerConv && (
                  <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2.5 space-y-2">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      This entry was auto-created from an Income Planner paycheck
                      {plannerStream?.company ? ` for ${plannerStream.company}` : ""}
                      {plannerConv.occurrence_date ? ` scheduled ${formatDate(plannerConv.occurrence_date)}` : ""}.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => {
                        if (!plannerConv.stream_id) {
                          navigate("/projected-income");
                          return;
                        }
                        navigate(
                          `/projected-income?highlight=${encodeURIComponent(
                            `${plannerConv.stream_id}:${plannerConv.occurrence_date}`,
                          )}`,
                        );
                      }}
                    >
                      <Link2 className="h-3 w-3" /> View in Income Planner
                    </Button>
                  </div>
                )}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receipts</h3>
                <TransactionAttachments
                  transactionId={e.id}
                  companyId={(e as any).source_id || null}
                  label="Receipts"
                />
                {linkedSiblings.length > 0 && (
                  <div className="space-y-2">
                    {linkedSiblings.map((it) => (
                      <SiblingReceiptsList
                        key={it.entry.id}
                        transactionId={it.entry.id}
                        label={it.entry.name || "(No payor)"}
                      />
                    ))}
                  </div>
                )}
              </section>
            }
            linked={{
              items: linkedSiblings.map((it) => {
                const imported =
                  isImportedCashIncomeRow(it.entry) ||
                  (importedSibling?.entry.id === it.entry.id);
                const deposit = siblingDeposit(it.entry);
                const acct =
                  (it.entry as any).account_source ||
                  (it.entry as any).source_name ||
                  (it.entry as any).company ||
                  null;
                const dateStr = formatDateShort(it.entry.income_date);
                return {
                  id: it.itemId,
                  label: imported
                    ? `${it.entry.name || "(No payor)"} — Bank deposit`
                    : it.entry.name || "(No payor)",
                  amount: imported ? deposit : Number(it.entry.gross_amount) || 0,
                  date: imported && acct ? `${acct} · ${dateStr}` : dateStr,
                };
              }),

              onUnlink: linkedGroupId
                ? (itemId) => unlinkIncomeMatchItem.mutate({ itemId, groupId: linkedGroupId })
                : undefined,
              onLink: () => {
                const target = e;
                setDetailEntry(null);
                // Open the Plaid candidate picker. Defer one tick so the
                // detail drawer's close animation doesn't swallow the
                // dialog open event.
                setTimeout(() => setLinkModalEntry(target), 0);
              },
            }}
            onEdit={() => { const target = e; setDetailEntry(null); openEdit(target); }}
            onDelete={isYtd ? undefined : () => { setDeleteId(e.id); setDetailEntry(null); }}
            needsReview={!!(e as any).needs_review}
            markReviewedPending={updateMutation.isPending}
            onMarkReviewed={() => {
              updateMutation.mutate(
                { id: e.id, needs_review: false } as any,
                {
                  onSuccess: () => {
                    setDetailEntry((curr) =>
                      curr && curr.id === e.id ? ({ ...curr, needs_review: false } as any) : curr,
                    );
                  },
                },
              );
            }}
          />
        );
      })()}
    </div>
  );
}
