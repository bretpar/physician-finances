import { useState, useMemo, useEffect } from "react";
import { ExpenseCategoryCombobox, mapLegacyCategory } from "@/components/ExpenseCategoryCombobox";
import { useTransactions, useDeleteTransaction, useAddTransaction, useUpdateTransaction, useBulkUpdateTransactions, useBulkDeleteTransactions, TRANSFER_SUBTYPES, type DbTransaction } from "@/hooks/useTransactions";
import { dedupeYtdBusinessMirrors } from "@/lib/ytdCatchupLedger";
import { useAddIncome, useUpdateIncome, type IncomeEntry } from "@/hooks/useIncome";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";
import { useQueryClient } from "@tanstack/react-query";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { isIncomeEntryTypeAllowed, isIncomeEntryTypeDisabled } from "@/lib/householdIncomeProfile";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useWithholdingRecommendation } from "@/hooks/useWithholdingRecommendation";
import { useIncomeRecommendation } from "@/hooks/useIncomeRecommendation";
import { SimpleTaxReminderModal } from "@/components/SimpleTaxReminderModal";
import { isFeatureEnabled } from "@/lib/featureFlags";
import {
  useCreateMatchGroup,
  useUnlinkMatchGroup,
  useUnlinkMatchGroupItem,
  useMatchGroups,
} from "@/hooks/useTransactionMatching";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Plus, Trash2, Download, MoreHorizontal, Pencil, DollarSign, Link2, Unlink, AlertCircle, Building2, Tag, EyeOff, CheckCircle2, ArrowLeftRight, ChevronDown, ChevronRight, Receipt, Lock, Paperclip, Info } from "lucide-react";
import { LedgerRow, MonthHeader, groupByMonth, type LedgerRowBadge } from "@/components/LedgerRow";
import { TransactionAttachments, MobileAttachmentViewer, SiblingReceiptsList } from "@/components/TransactionAttachments";
import { mapToScheduleC, SCHEDULE_C_CATEGORIES } from "@/lib/scheduleC";
import { useMileageYTD, getIrsMileageRate } from "@/hooks/useMileage";
import { useAttachmentCounts, useUploadAttachments } from "@/hooks/useAttachments";
import { getCanonicalTotalFederalPayrollTaxes } from "@/lib/federalWithholding";
import { syncIncomeEntryHsa } from "@/lib/incomeEntryHsaSync";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { computeBusinessSummary } from "@/lib/businessSummary";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RecommendedSetAsideInfo } from "@/components/RecommendedSetAsideInfo";
import { txTone } from "@/lib/transactionTones";
import { useCompanies } from "@/contexts/CompanyContext";
import { TotalFederalTaxField } from "@/components/TotalFederalTaxField";
import { TransactionDetailSheet, type DetailSection } from "@/components/TransactionDetailSheet";
import { formatDate, formatDateShort } from "@/lib/localDate";
import { DateField } from "@/components/DateField";
import {
  getFilingMeta,
  isW2FilingType,
  normalizeFilingType,
  toCanonicalIncomeType,
  ADVANCED_FIELDS_BY_TYPE,
  resolveAdvancedVisibility,
  type FilingType,
  type IncomeFieldKey,
  type ToggleKey,
} from "@/lib/filingTypes";
import { toast } from "sonner";
import { resolveNetReceived } from "@/lib/netReceivedPrecedence";


const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const num = (v: string) => parseFloat(v) || 0;
const UNASSIGNED_COMPANY_VALUE = "__unassigned__";

function isInterestIncomeTransaction(tx: Pick<DbTransaction, "transaction_type" | "vendor" | "category">): boolean {
  if (tx.transaction_type !== "income") return false;
  const text = `${tx.vendor || ""} ${tx.category || ""}`.toLowerCase();
  return /\binterest\b/.test(text);
}

function isUnassignedOrAutoAssignedInterest(tx: DbTransaction): boolean {
  if (!isInterestIncomeTransaction(tx)) return false;
  if (!tx.source_id) return true;
  return (tx.source_type || "manual") === "plaid" && !tx.user_edited;
}

/* ───── Income Form State ───── */
interface IncomeFormState {
  date: string;
  name: string;
  company: string;
  income_type: string;
  gross_amount: string;
  // Advanced (subset shown based on filing type)
  net_received: string;
  taxes_withheld: string;
  federal_withholding: string;
  state_withholding: string;
  ss_withholding: string;
  medicare_withholding: string;
  total_federal_payroll_taxes: string;
  pre_tax_deductions: string;
  retirement_401k: string;
  healthcare_deduction: string;
  hsa_contribution: string;
  actual_withholding: string;
  additional_tax_reserve: string;
  notes: string;
}

const emptyIncomeForm: IncomeFormState = {
  date: new Date().toISOString().split("T")[0],
  name: "",
  company: "",
  income_type: "1099_schedule_c",
  gross_amount: "",
  net_received: "",
  taxes_withheld: "",
  federal_withholding: "",
  state_withholding: "",
  ss_withholding: "",
  medicare_withholding: "",
  total_federal_payroll_taxes: "",
  pre_tax_deductions: "",
  retirement_401k: "",
  healthcare_deduction: "",
  hsa_contribution: "",
  actual_withholding: "",
  additional_tax_reserve: "",
  notes: "",
};

/** Reset advanced fields that don't apply to the new filing type. */
function resetIrrelevantAdvancedFields(form: IncomeFormState, newType: FilingType): IncomeFormState {
  const allowed = new Set<IncomeFieldKey>(ADVANCED_FIELDS_BY_TYPE[newType]);
  const cleared: Partial<IncomeFormState> = {};
  const allKeys: IncomeFieldKey[] = [
    "net_received","taxes_withheld","federal_withholding","state_withholding",
    "ss_withholding","medicare_withholding","pre_tax_deductions","retirement_401k",
    "healthcare_deduction","hsa_contribution","actual_withholding","additional_tax_reserve",
  ];
  for (const k of allKeys) {
    if (!allowed.has(k)) (cleared as any)[k] = "";
  }
  return { ...form, ...cleared };
}

/* ───── Expense Form State ───── */
interface ExpenseFormState {
  date: string;
  name: string;
  company: string;
  amount: string;
  category: string;
  schedule_c_category: string;
  notes: string;
  is_transfer: boolean;
  transfer_subtype: string;
}

const emptyExpenseForm: ExpenseFormState = {
  date: new Date().toISOString().split("T")[0],
  name: "",
  company: "",
  amount: "",
  category: "",
  schedule_c_category: "",
  notes: "",
  is_transfer: false,
  transfer_subtype: "",
};

export default function Transactions() {
  const { companies } = useCompanies();
  const queryClient = useQueryClient();
  const { data: rawTransactions = [], isLoading } = useTransactions();
  // CANONICAL: collapse duplicate YTD catch-up mirror transactions so each
  // catch-up event renders exactly once in the business ledger.
  const transactions = useMemo(
    () => dedupeYtdBusinessMirrors(rawTransactions as unknown as Array<DbTransaction & { origin_ytd_catchup_id?: string | null; created_at?: string | null }>) as unknown as DbTransaction[],
    [rawTransactions],
  );
  const deleteMutation = useDeleteTransaction();
  const addMutation = useAddTransaction();
  const updateMutation = useUpdateTransaction();
  const bulkUpdateMutation = useBulkUpdateTransactions();
  const bulkDeleteMutation = useBulkDeleteTransactions();
  const createMatchGroup = useCreateMatchGroup();
  const unlinkMatchGroup = useUnlinkMatchGroup();
  const unlinkMatchGroupItem = useUnlinkMatchGroupItem();
  const { data: matchGroupsMap } = useMatchGroups();
  const addIncomeMutation = useAddIncome();
  const updateIncomeMutation = useUpdateIncome();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: taxSettings } = useTaxSettings();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<"all" | "manual" | "plaid" | "merged">("all");
  const [filterReview, setFilterReview] = useState<"all" | "needs_review">("all");
  const [filterPlanner, setFilterPlanner] = useState<"all" | "from_planner">("all");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  // Account transfers are excluded from all business calculations already
  // (see summaryStats CANONICAL EXCLUSION). This toggle is purely a
  // visibility / export-scope control. Default ON so the ledger view
  // matches the totals out of the box.
  const [hideTransfers, setHideTransfers] = useState<boolean>(true);

  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCompany, setBulkCompany] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [showBulkCategory, setShowBulkCategory] = useState(false);

  // Mobile linking selection mode (long-press on a row to enter).
  // No cap — user can select any 2+ transactions of any type to link together.
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

  // Attachment counts per transaction (for paperclip badges)
  const { data: attachmentCounts } = useAttachmentCounts();

  // Match-suggestion engine removed — linking is now manual long-press multi-select only.

  // ─── Income modal state ───
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [incomeForm, setIncomeForm] = useState<IncomeFormState>(emptyIncomeForm);
  const [editingIncomeTxId, setEditingIncomeTxId] = useState<string | null>(null);
  const [editingIncomeEntryId, setEditingIncomeEntryId] = useState<string | null>(null);
  const [editingIncomeWasUnassigned, setEditingIncomeWasUnassigned] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingIncomeAttachments, setPendingIncomeAttachments] = useState<File[]>([]);

  // ─── Expense modal state ───
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(emptyExpenseForm);
  const [editingExpenseTxId, setEditingExpenseTxId] = useState<string | null>(null);
  const [pendingExpenseAttachments, setPendingExpenseAttachments] = useState<File[]>([]);

  // Mobile in-ledger receipt viewer
  const [mobileViewerTxId, setMobileViewerTxId] = useState<string | null>(null);
  const [detailTx, setDetailTx] = useState<DbTransaction | null>(null);
  const uploadAttachments = useUploadAttachments();

  // Delete
  const [deleteTxId, setDeleteTxId] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Per-transaction tax-savings reminder state
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [savedEntryTitle, setSavedEntryTitle] = useState("");
  const [reminderRecommended, setReminderRecommended] = useState(0);
  const [reminderActualSaved, setReminderActualSaved] = useState(0);

  const { getRecommendation: getIncomeRec } = useIncomeRecommendation();

  const isEditingIncome = !!editingIncomeTxId;
  const isEditingExpense = !!editingExpenseTxId;

  /**
   * Currently-loaded linked income entry (when editing). Used to:
   *  - Preserve saved values for fields that are now toggled OFF in Settings
   *    (so saving doesn't silently zero them out).
   *  - Surface "previously saved but currently hidden" fields in the Edit form.
   */
  const [linkedEntry, setLinkedEntry] = useState<IncomeEntry | null>(null);

  // Business Activity: use companies.id as the canonical business/entity selector.
  // Filter out non-W2 companies whose filing type isn't enabled in the
  // Household Income Profile. The currently-selected company (when editing)
  // is always preserved so the form doesn't break.
  const householdStreams = taxSettings?.householdIncomeStreams;
  const businessCompanies = useMemo(() =>
    companies.filter((c) => {
      if (isW2FilingType(c.companyType)) return false;
      const ft = normalizeFilingType(c.companyType);
      return isIncomeEntryTypeAllowed(householdStreams, ft) || c.id === incomeForm.company;
    }),
  [companies, householdStreams, incomeForm.company]);

  const companyById = useMemo(() =>
    new Map(companies.map((c) => [c.id, c] as const)),
  [companies]);

  const getCompanyByFormValue = (value: string) => {
    if (!value || value === UNASSIGNED_COMPANY_VALUE) return undefined;
    const byId = companyById.get(value);
    if (byId) return byId;
    const matches = companies.filter((c) => c.name === value);
    return matches.length === 1 ? matches[0] : undefined;
  };

  const getTransactionCompanyLabel = (tx: DbTransaction) => {
    if (!tx.source_id) return "Unassigned";
    const company = companyById.get(tx.source_id);
    return company ? company.name : "Unassigned";
  };

  const getCompanyType = (value: string): FilingType =>
    normalizeFilingType(getCompanyByFormValue(value)?.companyType);

  /**
   * Resolved per-company toggle visibility for the currently-selected
   * company in the income form. Used to decide which advanced fields render.
   * Falls back to filing-type defaults if the company has no saved overrides.
   */
  const visibleFields = useMemo<Record<ToggleKey, boolean>>(() => {
    const company = getCompanyByFormValue(incomeForm.company);
    const filingType = normalizeFilingType(
      incomeForm.income_type || company?.companyType || "1099_schedule_c"
    );
    return resolveAdvancedVisibility(filingType, company?.advancedFieldVisibility);
  }, [companies, incomeForm.company, incomeForm.income_type]);

  /** True when at least one advanced toggle is enabled for this company. */
  const hasAnyAdvancedField = useMemo(
    () => Object.values(visibleFields).some(Boolean),
    [visibleFields],
  );

  /**
   * Map of fields that are toggled OFF for this company but still have a
   * non-zero saved value on the existing transaction. We render them in the
   * Edit form (with a small "Hidden in new entries" note) so the user can
   * view or clear prior data on purpose without losing it.
   */
  const legacyFields = useMemo<Partial<Record<ToggleKey, true>>>(() => {
    if (!isEditingIncome) return {};
    const editingTx = editingIncomeTxId
      ? transactions.find((t) => t.id === editingIncomeTxId)
      : null;
    const out: Partial<Record<ToggleKey, true>> = {};
    const checks: Array<[ToggleKey, number]> = [
      ["net_received", linkedEntry?.deposited_amount || 0],
      ["taxes_withheld", linkedEntry?.taxes_withheld || 0],
      ["pre_tax_deductions", linkedEntry?.pre_tax_deductions || 0],
      ["retirement_401k", linkedEntry?.retirement_401k || 0],
      ["healthcare_deduction", (linkedEntry as any)?.healthcare_deduction || 0],
      ["federal_withholding", (linkedEntry as any)?.federal_withholding || 0],
      ["state_withholding", (linkedEntry as any)?.state_withholding || 0],
      ["additional_tax_reserve", (linkedEntry as any)?.additional_tax_reserve || 0],
      // actual_withholding lives on the transaction row, not income_entries
      ["actual_withholding", (editingTx as any)?.actual_withholding || 0],
    ];
    for (const [key, val] of checks) {
      if (val > 0 && !visibleFields[key]) out[key] = true;
    }
    return out;
  }, [isEditingIncome, editingIncomeTxId, transactions, linkedEntry, visibleFields]);

  /** Should a given field render in the form? Toggle on OR has a legacy saved value. */
  const showField = (key: ToggleKey) => visibleFields[key] || !!legacyFields[key];

  /** Subtle inline note rendered next to a field that's only shown due to legacy saved data. */
  const LegacyNote = ({ field }: { field: ToggleKey }) =>
    legacyFields[field] ? (
      <span className="ml-1 text-[10px] font-normal italic text-muted-foreground">(Previously saved value)</span>
    ) : null;

  const incomeByLinkedTx = useMemo(() => {
    const map = new Map<string, IncomeEntry>();
    if (!incomeEntries) return map;
    for (const ie of incomeEntries) {
      if (ie.linked_transaction_id) map.set(ie.linked_transaction_id, ie);
    }
    return map;
  }, [incomeEntries]);




  // Filtered list.
  // Note: useTransactions() already filters status='active' server-side, so
  // duplicate / merged / archived rows are excluded from the ledger and totals.
  // Company filter uses the canonical companies.id stored on transactions.source_id
  // (NOT the denormalized text in `entity`). This is the single source of truth
  // for which business a transaction belongs to.
  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const txType = (t.transaction_type || "expense");
      // Hide account transfers when the toggle is on — but never hide
      // them if the user explicitly picked the Transfer tab (they're
      // trying to look at exactly these rows).
      if (hideTransfers && txType === "transfer" && filterType !== "transfer") return false;
      if (search && !t.vendor.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterType !== "all" && txType !== filterType) return false;
      if (filterCompany !== "all" && (t.source_id || "") !== filterCompany) return false;
      if (filterSource !== "all" && (t.source_type || "manual") !== filterSource) return false;
      if (filterReview === "needs_review" && !t.needs_review) return false;
      if (filterPlanner === "from_planner" && (t as any).origin_type !== "planner_converted") return false;
      if (filterDateFrom && t.transaction_date < filterDateFrom) return false;
      if (filterDateTo && t.transaction_date > filterDateTo) return false;
      return true;
    });
  }, [transactions, search, filterType, filterCompany, filterSource, filterReview, filterPlanner, filterDateFrom, filterDateTo, hideTransfers]);

  const needsReviewCount = useMemo(() =>
    transactions.filter((t) => t.needs_review).length
  , [transactions]);

  const legacyExpenseReviewQueue = useMemo(() =>
    transactions.filter((t) =>
      t.transaction_type === "expense" &&
      !t.source_id &&
      !t.excluded_from_reports
    ),
  [transactions]);

  const unassignedInterestReviewQueue = useMemo(() =>
    transactions.filter((t) =>
      isUnassignedOrAutoAssignedInterest(t) &&
      !t.excluded_from_reports
    ),
  [transactions]);

  const assignLegacyExpense = (transactionId: string, companyId: string) => {
    const company = companyById.get(companyId);
    if (!company) return;
    updateMutation.mutate({
      id: transactionId,
      entity: company.name,
      source_id: company.id,
      company_type: company.companyType,
      needs_review: false,
    } as any);
  };

  const markInterestIncomeForReview = (transactionId: string) => {
    updateMutation.mutate({
      id: transactionId,
      entity: "Unassigned",
      source_id: null,
      company_type: "other_income",
      category: "Interest Income",
      needs_review: true,
      excluded_from_reports: true,
    } as any);
  };

  // Company filter: list non-W2 companies by id (canonical) with name as label.
  const companyFilterOptions = useMemo(() => {
    return companies
      .filter((c) => !isW2FilingType(c.companyType))
      .map((c) => ({ id: c.id, name: c.name, companyType: c.companyType }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [companies]);

  const activeFilterCount = useMemo(() => [
    filterCompany !== "all",
    filterSource !== "all",
    filterReview !== "all",
    filterPlanner !== "all",
    !!filterDateFrom || !!filterDateTo,
  ].filter(Boolean).length, [filterCompany, filterSource, filterReview, filterPlanner, filterDateFrom, filterDateTo]);

  const clearAdvancedFilters = () => {
    setFilterCompany("all");
    setFilterSource("all");
    setFilterReview("all");
    setFilterPlanner("all");
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  // --- Smart withholding recommendation engine ---
  const { getRecommendation } = useWithholdingRecommendation();
  const grossIncome = num(incomeForm.gross_amount);
  const selectedIncomeCompany = useMemo(
    () => getCompanyByFormValue(incomeForm.company),
    [companies, incomeForm.company],
  );
  const selectedExpenseCompany = useMemo(
    () => getCompanyByFormValue(expenseForm.company),
    [companies, expenseForm.company],
  );
  const incomeNeedsCompanyReview = isEditingIncome && editingIncomeWasUnassigned && !selectedIncomeCompany;
  const canEditIncomeCompany = !isEditingIncome || editingIncomeWasUnassigned;

  useEffect(() => {
    const ambiguousLegacyExpenseIds = transactions
      .filter((t) =>
        t.transaction_type === "expense" &&
        !t.source_id &&
        t.entity &&
        t.entity !== "Unassigned" &&
        companies.filter((c) => c.name === t.entity).length > 1 &&
        !t.needs_review
      )
      .map((t) => t.id);
    if (ambiguousLegacyExpenseIds.length > 0) {
      bulkUpdateMutation.mutate({
        ids: ambiguousLegacyExpenseIds,
        updates: { needs_review: true } as any,
      });
    }
  }, [transactions, companies, bulkUpdateMutation]);
  const k1TreatmentForEntry = useMemo(() => {
    const ft = normalizeFilingType(incomeForm.income_type);
    if (ft !== "k1_partnership") return null;
    return selectedIncomeCompany?.k1TaxTreatment ?? null;
  }, [incomeForm.income_type, selectedIncomeCompany]);
  const isSelfEmploymentTaxableOverride = useMemo<boolean | null | undefined>(() => {
    const ft = normalizeFilingType(incomeForm.income_type);
    if (ft !== "k1_partnership") return undefined;
    if (k1TreatmentForEntry === "active_partnership" || k1TreatmentForEntry === "guaranteed_payments") return true;
    if (k1TreatmentForEntry === "passive" || k1TreatmentForEntry === "scorp_distribution") return false;
    return undefined;
  }, [incomeForm.income_type, k1TreatmentForEntry]);
  const recommendation = useMemo(() => {
    if (grossIncome <= 0) return null;
    return getRecommendation({
      grossIncome,
      incomeType: incomeForm.income_type,
      taxesAlreadyWithheld: num(incomeForm.taxes_withheld),
      retirement401k: num(incomeForm.retirement_401k),
      preTaxDeductions: num(incomeForm.pre_tax_deductions) + num(incomeForm.healthcare_deduction) + num(incomeForm.hsa_contribution),
      alreadyIncludedInEstimate: isEditingIncome,
      companyId: selectedIncomeCompany?.id ?? null,
      applyBusinessStateTax: selectedIncomeCompany?.applyBusinessStateTax ?? true,
      includeSETaxInRecommendation: selectedIncomeCompany?.includeSETaxInRecommendation ?? true,
      isSelfEmploymentTaxable: isSelfEmploymentTaxableOverride,
    });
  }, [grossIncome, incomeForm.income_type, incomeForm.taxes_withheld, incomeForm.retirement_401k, incomeForm.pre_tax_deductions, incomeForm.healthcare_deduction, incomeForm.hsa_contribution, getRecommendation, isEditingIncome, selectedIncomeCompany, isSelfEmploymentTaxableOverride]);
  const recommendedWithholding = recommendation?.recommendedWithholding ?? 0;

  const calculatedNet = useMemo(() => {
    if (grossIncome <= 0) return 0;
    return Math.max(0, grossIncome - num(incomeForm.taxes_withheld) - num(incomeForm.pre_tax_deductions) - num(incomeForm.retirement_401k) - num(incomeForm.healthcare_deduction) - num(incomeForm.hsa_contribution));
  }, [grossIncome, incomeForm.taxes_withheld, incomeForm.pre_tax_deductions, incomeForm.retirement_401k, incomeForm.healthcare_deduction, incomeForm.hsa_contribution]);

  // ─── Open Income Add ───
  function openAddIncome() {
    setIncomeForm(emptyIncomeForm);
    setEditingIncomeTxId(null);
    setEditingIncomeEntryId(null);
    setEditingIncomeWasUnassigned(false);
    setLinkedEntry(null);
    setAdvancedOpen(false);
    setPendingIncomeAttachments([]);
    setShowIncomeForm(true);
  }

  // ─── Open Expense Add ───
  function openAddExpense() {
    setExpenseForm(emptyExpenseForm);
    setEditingExpenseTxId(null);
    setPendingExpenseAttachments([]);
    setShowExpenseForm(true);
  }

  // ─── Open Edit (routes to correct modal) ───
  function openEdit(tx: DbTransaction) {
    const txType = (tx.transaction_type || "expense") as string;
    const linked = txType === "income" ? incomeByLinkedTx.get(tx.id) : null;

    // Resolve Net Received from a linked Plaid/imported sibling when present,
    // so older planner/manual rows without a populated `deposited_amount` still
    // hydrate the actual bank deposit into the form.
    const linkedGroupItems = tx.linked_group_id ? matchGroupsMap?.get(tx.linked_group_id) : undefined;
    const linkedSiblings = (linkedGroupItems || []).filter((it) => it.transaction.id !== tx.id);
    const grossForCmp = Math.abs(Number(tx.amount) || 0);
    const plaidSibling = txType === "income" ? (linkedSiblings.find((it) => {
      const t: any = it.transaction;
      if ((tx as any).linked_plaid_transaction_id && t.id === (tx as any).linked_plaid_transaction_id) return true;
      if (t.source_type === "plaid" || t.source_type === "merged") return true;
      if ((it as any).source === "imported") return true;
      return false;
    }) || linkedSiblings.find((it) => {
      const amt = Math.abs(Number(it.transaction.amount) || 0);
      return amt > 0 && Math.abs(amt - grossForCmp) > 0.5;
    })) : undefined;
    const siblingAmt = plaidSibling ? Math.abs(Number(plaidSibling.transaction.amount) || 0) : 0;
    const linkedPlaidAmt = Math.abs(Number((tx as any).linked_plaid_amount) || 0);
    // Treat a deposited_amount that exactly equals gross as a planner placeholder,
    // not as a real bank deposit (planner conversion writes gross there by default).
    const lGrossForNet = linked ? Number(linked.paycheck_amount) || 0 : Math.abs(Number(tx.amount) || 0);
    const lDepRaw = Number(linked?.deposited_amount) || 0;
    const lDepUsable = lDepRaw > 0 && Math.abs(lDepRaw - lGrossForNet) > 0.5 ? lDepRaw : 0;
    const lFedH = linked ? getCanonicalTotalFederalPayrollTaxes(linked as any) : 0;
    const lCalcNet = linked
      ? Math.max(
          0,
          lGrossForNet
            - lFedH
            - (Number((linked as any).state_withholding) || 0)
            - (Number(linked.pre_tax_deductions) || 0)
            - (Number(linked.retirement_401k) || 0)
            - (Number((linked as any).hsa_contribution) || 0)
            - (Number((linked as any).healthcare_deduction) || 0)
            - (Number((linked as any).other_deductions) || 0),
        )
      : 0;
    // Precedence:
    //   1) Explicit user-saved deposited_amount on the linked income_entry
    //      (source of truth — must beat any imported Plaid amount so a manual
    //      correction is never overwritten on reopen).
    //   2) Linked Plaid/imported sibling cash amount (initial fallback when
    //      no saved deposited_amount exists yet).
    //   3) Denormalized linked_plaid_amount on the canonical row.
    //   4) Calculated take-home from gross − withholding − deductions.
    const netReceivedHydrate =
      lDepUsable > 0 ? lDepUsable
      : siblingAmt > 0 ? siblingAmt
      : linkedPlaidAmt > 0 ? linkedPlaidAmt
      : lCalcNet > 0 && lCalcNet < lGrossForNet ? lCalcNet
      : 0;

    if (txType === "income") {
      setIncomeForm({
        date: tx.transaction_date,
        name: tx.vendor,
        company: (linked as any)?.source_id || tx.source_id || UNASSIGNED_COMPANY_VALUE,
        income_type: normalizeFilingType(linked?.income_type || tx.company_type || (isInterestIncomeTransaction(tx) ? "other_income" : "1099_schedule_c")),
        gross_amount: linked ? String(linked.paycheck_amount) : String(tx.amount),
        net_received: netReceivedHydrate > 0 ? String(netReceivedHydrate) : "",
        taxes_withheld: linked ? String(linked.taxes_withheld) : "",
        pre_tax_deductions: linked ? String(linked.pre_tax_deductions) : "",
        retirement_401k: linked ? String(linked.retirement_401k) : "",
        healthcare_deduction: linked ? String((linked as any).healthcare_deduction || 0) : "",
        hsa_contribution: linked ? String((linked as any).hsa_contribution || 0) : "",
        federal_withholding: linked ? String((linked as any).federal_withholding || 0) : "",
        state_withholding: linked ? String((linked as any).state_withholding || 0) : "",
        ss_withholding: linked ? String((linked as any).ss_withholding || 0) : "",
        medicare_withholding: linked ? String((linked as any).medicare_withholding || 0) : "",
        // Canonical Total Federal Payroll Taxes (shared wrapper).
        total_federal_payroll_taxes: linked
          ? String(getCanonicalTotalFederalPayrollTaxes(linked as any))
          : "",
        actual_withholding: String((tx as any).actual_withholding || ""),
        additional_tax_reserve: linked ? String((linked as any).additional_tax_reserve || 0) : "0",
        notes: tx.notes || "",
      });
      setEditingIncomeTxId(tx.id);
      setEditingIncomeEntryId(linked?.id || null);
      setEditingIncomeWasUnassigned(!((linked as any)?.source_id || tx.source_id));
      setLinkedEntry(linked || null);
      setAdvancedOpen(false);
      setShowIncomeForm(true);
    } else {
      setExpenseForm({
        date: tx.transaction_date,
        name: tx.vendor,
        company: tx.source_id || (companies.filter((c) => c.name === tx.entity).length === 1 ? companies.find((c) => c.name === tx.entity)?.id || "" : ""),
        amount: String(Math.abs(tx.amount)),
        category: tx.category,
        schedule_c_category: (tx as any).schedule_c_category || "",
        notes: tx.notes || "",
        is_transfer: txType === "transfer",
        transfer_subtype: tx.transfer_subtype || "",
      });
      setEditingExpenseTxId(tx.id);
      setShowExpenseForm(true);
    }
  }

  // ─── Save Income ───
  function saveIncome() {
    if (!incomeForm.name.trim() || !incomeForm.date) return;
    if (grossIncome <= 0) { toast.error("Gross amount is required"); return; }

    const paycheckAmt = grossIncome;
    /**
     * Hidden-field preservation: when an advanced field is currently toggled
     * OFF and not surfaced as a legacy field, fall back to the saved value
     * from the linked income entry instead of treating empty input as 0.
     * This prevents toggle changes from silently zeroing historical data.
     */
    const preserve = (key: ToggleKey, current: number, savedVal: number) =>
      showField(key) ? current : (linkedEntry ? savedVal : current);

    const depositedAmt = preserve("net_received", num(incomeForm.net_received), linkedEntry?.deposited_amount || 0);
    // Canonical "Total Federal Payroll Taxes" = federal income tax + SS + Medicare.
    // For W-2 / S-Corp W-2 forms (where total_federal_payroll_taxes is shown),
    // this is the source of truth and is stored in `taxes_withheld`.
    // For non-W-2 forms (1099/K-1) the form's `taxes_withheld` field is shown
    // and used directly.
    const totalFederal = num(incomeForm.total_federal_payroll_taxes);
    const isW2Form = showField("federal_withholding");
    const taxWithheld = isW2Form
      ? totalFederal
      : preserve("taxes_withheld", num(incomeForm.taxes_withheld), linkedEntry?.taxes_withheld || 0);
    const preTaxDed = preserve("pre_tax_deductions", num(incomeForm.pre_tax_deductions), linkedEntry?.pre_tax_deductions || 0);
    const retirement = preserve("retirement_401k", num(incomeForm.retirement_401k), linkedEntry?.retirement_401k || 0);
    const healthcare = preserve("healthcare_deduction", num(incomeForm.healthcare_deduction), (linkedEntry as any)?.healthcare_deduction || 0);
    const hsa = preserve("hsa_contribution", num(incomeForm.hsa_contribution), (linkedEntry as any)?.hsa_contribution || 0);
    // federal_withholding stores the federal income tax COMPONENT only
    // (NOT the combined total). The combined total lives in taxes_withheld
    // and is read everywhere via getTotalFederalPaid().
    const fedWH = preserve("federal_withholding", num(incomeForm.federal_withholding), (linkedEntry as any)?.federal_withholding || 0);
    const stateWH = preserve("state_withholding", num(incomeForm.state_withholding), (linkedEntry as any)?.state_withholding || 0);
    const applicableStateWH = taxSettings?.businessStateTaxEnabled ? stateWH : 0;
    const ssWH = preserve("ss_withholding", num(incomeForm.ss_withholding), (linkedEntry as any)?.ss_withholding || 0);
    const medicareWH = preserve("medicare_withholding", num(incomeForm.medicare_withholding), (linkedEntry as any)?.medicare_withholding || 0);
    const companyName = selectedIncomeCompany?.name || "Unassigned";
    const companyType = selectedIncomeCompany?.companyType || incomeForm.income_type || getCompanyType(incomeForm.company);
    const isUnassignedReviewedIncome = isEditingIncome && editingIncomeWasUnassigned && !selectedIncomeCompany;
    const isUnassignedInterestIncome = !selectedIncomeCompany && /\binterest\b/i.test(`${incomeForm.name} ${incomeForm.notes}`);

    // Gross income is the source of truth for revenue/tax totals.
    // Deposited (net) amount is stored separately on income_entries for matching/cashflow.
    const txAmount = paycheckAmt;

    if (isEditingIncome) {
      const oldTx = transactions.find(t => t.id === editingIncomeTxId);
      console.log("[saveIncome] Editing transaction", {
        id: editingIncomeTxId,
        oldAmount: oldTx?.amount,
        newAmount: txAmount,
        grossIncome: paycheckAmt,
        netReceived: depositedAmt,
        source_type: oldTx?.source_type,
      });

      updateMutation.mutate({
        id: editingIncomeTxId!,
        transaction_date: incomeForm.date,
        vendor: incomeForm.name,
        amount: txAmount,
        category: "Income",
        entity: companyName,
        company_type: companyType,
        source_id: selectedIncomeCompany?.id || null,
        needs_review: isUnassignedReviewedIncome || isUnassignedInterestIncome,
        excluded_from_reports: selectedIncomeCompany ? false : (isUnassignedReviewedIncome || isUnassignedInterestIncome ? true : (oldTx?.excluded_from_reports ?? false)),
        notes: incomeForm.notes,
        actual_withholding: num(incomeForm.actual_withholding),
        withholding_saved: num(incomeForm.actual_withholding) > 0,
        recommended_withholding: recommendedWithholding,
      } as any, {
        onSuccess: (data) => {
          console.log("[saveIncome] Update succeeded", data);
          // Now update the linked income entry if present
          // Keep taxes_withheld as employer-only; actual_withholding is saved separately on the transaction
          const effectiveWithheld = taxWithheld;
          const rec = getIncomeRec({
            grossIncome: paycheckAmt,
            incomeType: companyType,
            federalWithheld: effectiveWithheld,
            stateWithheld: applicableStateWH,
            retirement401k: retirement,
            preTaxDeductions: preTaxDed,
            companyId: selectedIncomeCompany?.id ?? null,
            applyBusinessStateTax: selectedIncomeCompany?.applyBusinessStateTax ?? true,
            includeSETaxInRecommendation: selectedIncomeCompany?.includeSETaxInRecommendation ?? true,
          });
          if (editingIncomeEntryId) {
            updateIncomeMutation.mutate({
              id: editingIncomeEntryId,
              name: incomeForm.name,
              company: companyName,
              source_id: selectedIncomeCompany?.id || null,
              income_type: companyType,
              income_date: incomeForm.date,
              paycheck_amount: paycheckAmt,
              deposited_amount: depositedAmt,
              taxes_withheld: effectiveWithheld,
              pre_tax_deductions: preTaxDed,
              retirement_401k: retirement,
              healthcare_deduction: healthcare,
              hsa_contribution: hsa,
              federal_withholding: fedWH,
              state_withholding: stateWH,
              ss_withholding: ssWH,
              medicare_withholding: medicareWH,
              notes: incomeForm.notes,
              additional_tax_reserve: num(incomeForm.additional_tax_reserve),
              base_tax_estimate: rec?.baseTaxEstimate || 0,
              dynamic_tax_recommendation: rec?.dynamicTaxRecommendation || 0,
              quarterly_adjustment_amount: rec?.quarterlyAdjustmentAmount || 0,
              recommendation_status: rec?.recommendationStatus || "on_track",
            } as any);
          } else {
            // No income_entry exists yet (e.g. imported Plaid tx) — create one
            (async () => {
              try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const orgId = await getUserOrgId();
                const { data: created, error } = await supabase.from("income_entries").insert({
                  user_id: user.id,
                  organization_id: orgId,
                  name: incomeForm.name,
                  company: companyName,
              source_id: selectedIncomeCompany?.id || null,
                  income_type: toCanonicalIncomeType(companyType),
                  income_date: incomeForm.date,
                  paycheck_amount: paycheckAmt,
                  deposited_amount: depositedAmt,
                  taxes_withheld: effectiveWithheld,
                  pre_tax_deductions: preTaxDed,
                  retirement_401k: retirement,
                  healthcare_deduction: healthcare,
              hsa_contribution: hsa,
                  federal_withholding: fedWH,
                  state_withholding: stateWH,
                  ss_withholding: ssWH,
                  medicare_withholding: medicareWH,
                  notes: incomeForm.notes,
                  status: "received",
                  linked_transaction_id: editingIncomeTxId,
                  additional_tax_reserve: num(incomeForm.additional_tax_reserve),
                  base_tax_estimate: rec?.baseTaxEstimate || 0,
                  dynamic_tax_recommendation: rec?.dynamicTaxRecommendation || 0,
                  quarterly_adjustment_amount: rec?.quarterlyAdjustmentAmount || 0,
                  recommendation_status: rec?.recommendationStatus || "on_track",
                } as any).select("id").single();
                if (error) {
                  console.error("[saveIncome] Failed to create income_entry", error);
                  toast.error("Saved transaction but failed to save detailed fields");
                } else {
                  console.log("[saveIncome] Created new income_entry for tx", editingIncomeTxId);
                  // Canonical payroll HSA sync — matches useAddIncome path
                  // so an HSA amount entered from the Business Activity
                  // editor always produces a payroll HSA ledger row.
                  const newIeId = (created as { id: string } | null)?.id;
                  if (newIeId && Number(hsa || 0) > 0) {
                    await syncIncomeEntryHsa({
                      incomeEntryId: newIeId,
                      userId: user.id,
                      organizationId: orgId,
                      amount: Number(hsa || 0),
                      contributionDate: incomeForm.date,
                      companyId: selectedIncomeCompany?.id || null,
                      existingHsaId: null,
                    });
                  }
                  queryClient.invalidateQueries({ queryKey: ["income_entries"] });
                  queryClient.invalidateQueries({ queryKey: ["hsa_contributions"] });
                }
              } catch (e) {
                console.error("[saveIncome] Error creating income_entry", e);
              }
            })();
          }
          setShowIncomeForm(false);
          setIncomeForm(emptyIncomeForm);
          setEditingIncomeTxId(null);
          setEditingIncomeEntryId(null);
        },
        onError: (err) => {
          console.error("[saveIncome] Update failed", err);
          toast.error("Failed to save: " + err.message);
        },
      });
      return; // Don't close modal yet — onSuccess handles it
    } else {
      const rec = getIncomeRec({
        grossIncome: paycheckAmt,
        incomeType: companyType,
        federalWithheld: taxWithheld,
        stateWithheld: applicableStateWH,
        retirement401k: retirement,
        preTaxDeductions: preTaxDed,
        companyId: selectedIncomeCompany?.id ?? null,
        applyBusinessStateTax: selectedIncomeCompany?.applyBusinessStateTax ?? true,
        includeSETaxInRecommendation: selectedIncomeCompany?.includeSETaxInRecommendation ?? true,
      });

      const payload: Partial<IncomeEntry> = {
        name: incomeForm.name,
        company: companyName,
        source_id: selectedIncomeCompany?.id || null,
        income_type: companyType,
        income_date: incomeForm.date,
        paycheck_amount: paycheckAmt,
        deposited_amount: depositedAmt,
        taxes_withheld: taxWithheld,
        pre_tax_deductions: preTaxDed,
        retirement_401k: retirement,
        healthcare_deduction: healthcare,
              hsa_contribution: hsa,
        federal_withholding: fedWH,
        state_withholding: stateWH,
        ss_withholding: ssWH,
        medicare_withholding: medicareWH,
        notes: incomeForm.notes,
        base_tax_estimate: rec?.baseTaxEstimate || 0,
        dynamic_tax_recommendation: rec?.dynamicTaxRecommendation || 0,
        quarterly_adjustment_amount: rec?.quarterlyAdjustmentAmount || 0,
        additional_tax_reserve: num(incomeForm.additional_tax_reserve),
        recommendation_status: rec?.recommendationStatus || "on_track",
        // Pass the canonical visible recommendation through so useAddIncome
        // preserves it on the transaction row (avoids legacy 35% overwrite).
        recommended_withholding: recommendedWithholding,
        // "Amount you're saving for taxes" — voluntary reserve stored on the
        // transaction row so it flows into Tax Overview "Saved/reserved but
        // not paid" via buildQuarterRecommendation (tx.actual_withholding).
        actual_withholding: num(incomeForm.actual_withholding),
      } as any;

      const showModal2 = isFeatureEnabled("recommendation_modal");

      addIncomeMutation.mutate(payload, {
        onSuccess: (result) => {
          // Flush any locally staged receipts to the new transaction.
          const newTxId = (result as { transactionId?: string | null } | undefined)?.transactionId || null;
          if (newTxId && pendingIncomeAttachments.length > 0) {
            uploadAttachments.mutate({
              transactionId: newTxId,
              companyId: selectedIncomeCompany?.id || null,
              files: pendingIncomeAttachments,
            });
          }
          setPendingIncomeAttachments([]);
          if (showModal2 && rec) {
            // Per-transaction reminder: nudge only if saved < 90% of rec.
            const recommended = Math.max(0, rec.baseTaxEstimate || 0);
            const actualSaved =
              taxWithheld +
              applicableStateWH +
              num(incomeForm.ss_withholding) +
              num(incomeForm.medicare_withholding) +
              num(incomeForm.additional_tax_reserve) +
              num(incomeForm.actual_withholding);
            if (recommended > 0 && actualSaved < recommended * 0.9) {
              setSavedEntryTitle(incomeForm.name);
              setReminderRecommended(recommended);
              setReminderActualSaved(actualSaved);
              setShowRecommendation(true);
            }
          }
        },
      });
    }

    setShowIncomeForm(false);
    setIncomeForm(emptyIncomeForm);
    setEditingIncomeTxId(null);
    setEditingIncomeEntryId(null);
    setPendingIncomeAttachments([]);
  }

  // ─── Save Expense / Transfer ───
  function saveExpense() {
    if (!expenseForm.name.trim() || !expenseForm.date) return;
    const amount = num(expenseForm.amount);
    if (amount === 0) return;
    if (!expenseForm.is_transfer && !selectedExpenseCompany) { toast.error("Please select a company"); return; }
    const scheduleCMapping = expenseForm.is_transfer ? null : mapToScheduleC(expenseForm.category);
    const hasScheduleCMapping = !!scheduleCMapping && SCHEDULE_C_CATEGORIES.some((c) => c.value === scheduleCMapping);
    if (!expenseForm.is_transfer && (!expenseForm.category || !hasScheduleCMapping)) {
      toast.error("Please choose a valid Schedule C category before saving");
      return;
    }

    const flushAttachmentsTo = (newTxId: string) => {
      if (pendingExpenseAttachments.length === 0) return;
      uploadAttachments.mutate({
        transactionId: newTxId,
        companyId: selectedExpenseCompany?.id || null,
        files: pendingExpenseAttachments,
      });
    };

    if (expenseForm.is_transfer) {
      if (isEditingExpense) {
        updateMutation.mutate({
          id: editingExpenseTxId!,
          transaction_date: expenseForm.date,
          vendor: expenseForm.name,
          amount,
          category: "Transfer",
          notes: expenseForm.notes,
          transaction_type: "transfer",
          transfer_subtype: expenseForm.transfer_subtype || null,
          entity: selectedExpenseCompany?.name || "Unassigned",
          source_id: selectedExpenseCompany?.id || null,
          company_type: selectedExpenseCompany?.companyType || "",
          excluded_from_reports: true,
        } as any);
      } else {
        addMutation.mutate({
          transaction_date: expenseForm.date,
          vendor: expenseForm.name,
          amount,
          category: "Transfer",
          notes: expenseForm.notes,
          transaction_type: "transfer",
          transfer_subtype: expenseForm.transfer_subtype || null,
          entity: selectedExpenseCompany?.name || "Unassigned",
          source_id: selectedExpenseCompany?.id || null,
          company_type: selectedExpenseCompany?.companyType || "",
          excluded_from_reports: true,
        } as any, {
          onSuccess: (data) => {
            const id = (data as { id?: string } | undefined)?.id;
            if (id) flushAttachmentsTo(id);
          },
        });
      }
    } else {
      if (isEditingExpense) {
        updateMutation.mutate({
          id: editingExpenseTxId!,
          transaction_date: expenseForm.date,
          vendor: expenseForm.name,
          amount,
          category: expenseForm.category,
          schedule_c_category: scheduleCMapping,
          notes: expenseForm.notes,
          entity: selectedExpenseCompany?.name || "Unassigned",
          source_id: selectedExpenseCompany?.id || null,
          company_type: selectedExpenseCompany?.companyType || "",
          needs_review: false,
        } as any);
      } else {
        addMutation.mutate({
          transaction_date: expenseForm.date,
          vendor: expenseForm.name,
          amount,
          category: expenseForm.category,
          schedule_c_category: scheduleCMapping,
          notes: expenseForm.notes,
          transaction_type: "expense",
          entity: selectedExpenseCompany?.name || "Unassigned",
          source_id: selectedExpenseCompany?.id || null,
          company_type: selectedExpenseCompany?.companyType || "",
          needs_review: false,
        } as any, {
          onSuccess: (data) => {
            const id = (data as { id?: string } | undefined)?.id;
            if (id) flushAttachmentsTo(id);
          },
        });
      }
    }

    setShowExpenseForm(false);
    setExpenseForm(emptyExpenseForm);
    setEditingExpenseTxId(null);
    setPendingExpenseAttachments([]);
  }

  function confirmDelete(id: string) { setDeleteTxId(id); }
  function executeDelete() {
    if (!deleteTxId) return;
    deleteMutation.mutate(deleteTxId);
    setDeleteTxId(null);
    if (editingIncomeTxId === deleteTxId) { setShowIncomeForm(false); setEditingIncomeTxId(null); }
    if (editingExpenseTxId === deleteTxId) { setShowExpenseForm(false); setEditingExpenseTxId(null); }
  }

  function exportCSV() {
    const headers = ["Date", "Transaction", "Amount", "Net Received", "Type", "Category"];
    const rows = filtered.map((t) => {
      const type = (t.transaction_type || "expense");
      const isIncomeTx = type === "income";
      const gross = Math.abs(Number(t.amount) || 0);
      const displayAmt = type === "expense" ? -gross : gross;
      const typeLabel = type === "income" ? "Income" : type === "transfer" ? "Transfer" : "Expense";

      // Net Received precedence — resolved via the shared helper so CSV
      // exports stay in lockstep with the edit modal and transaction detail.
      // Only meaningful for income rows; expenses/transfers get "" so tax
      // math never sees a spurious value in downstream consumers.
      let netReceivedCol: string | number = "";
      if (isIncomeTx) {
        const linked = incomeByLinkedTx.get(t.id);
        const groupItems = t.linked_group_id ? matchGroupsMap?.get(t.linked_group_id) : undefined;
        const siblings = (groupItems || []).filter((it) => it.transaction.id !== t.id);
        const linkedPlaidAmt = Math.abs(Number((t as any).linked_plaid_amount) || 0);
        const plaidSibling =
          siblings.find((it) => {
            const st: any = it.transaction;
            if ((t as any).linked_plaid_transaction_id && st.id === (t as any).linked_plaid_transaction_id) return true;
            if (st.source_type === "plaid") return true;
            if (st.source_type === "merged") return true;
            if ((it as any).source === "imported") return true;
            return false;
          }) ||
          siblings.find((it) => {
            const amt = Math.abs(Number(it.transaction.amount) || 0);
            return amt > 0 && Math.abs(amt - gross) > 0.5;
          });
        const siblingAmt = plaidSibling ? Math.abs(Number(plaidSibling.transaction.amount) || 0) : 0;

        if (linked) {
          const lGross = Number(linked.paycheck_amount) || 0;
          const lFed = getCanonicalTotalFederalPayrollTaxes(linked as any);
          const lState = Number((linked as any).state_withholding) || 0;
          const lPreTax = Number(linked.pre_tax_deductions) || 0;
          const l401 = Number(linked.retirement_401k) || 0;
          const lHsa = Number((linked as any).hsa_contribution) || 0;
          const lHealth = Number((linked as any).healthcare_deduction) || 0;
          const lOther = Number((linked as any).other_deductions) || 0;
          const calcNet = Math.max(0, lGross - lFed - lState - lPreTax - l401 - lHsa - lHealth - lOther);
          netReceivedCol = resolveNetReceived({
            gross: lGross,
            savedDeposited: (linked as any).deposited_amount,
            siblingAmount: siblingAmt,
            linkedPlaidAmount: linkedPlaidAmt,
            calculatedNet: calcNet,
          });
        } else {
          netReceivedCol = resolveNetReceived({
            gross,
            siblingAmount: siblingAmt,
            linkedPlaidAmount: linkedPlaidAmt,
          });
        }
      }

      return [t.transaction_date, t.vendor, displayAmt, netReceivedCol, typeLabel, t.category];
    });
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  }


  const { data: ytdMileage = [] } = useMileageYTD(new Date().getFullYear());

  const summaryStats = useMemo(() => {
    // CANONICAL EXCLUSION: personal / excluded / transfer rows never count
    // toward business revenue or deductible business expense. Unassigned or
    // auto-assigned (Plaid, un-edited) bank interest is also excluded — it
    // only counts as business income when the user explicitly assigns it.
    // W-2 income is never business activity.
    //
    // BUSINESS ACTIVITY SCOPE: includes 1099 / Schedule C business income
    // AND active K-1 partnership business income. Both flow through here
    // because they are the operating business activity for a physician
    // (sole proprietorship + partnership distributions). Passive interest,
    // personal items, transfers, and W-2 wages are excluded.
    //
    // Canonical math lives in `computeBusinessSummary` so Dashboard and
    // Business Activity cannot drift on Revenue / Deductions / Profit.
    const shared = computeBusinessSummary({
      transactions: filtered,
      mileageEntries: ytdMileage,
      companies,
      companyFilter: filterCompany,
    });
    // Owner deductions from K-1 income entries (reduce taxable income, not profit)
    const ownerDeds = (incomeEntries || [])
      .filter((e) =>
        normalizeFilingType(e.income_type) === "k1_partnership" &&
        !!e.source_id &&
        companyById.has(e.source_id) &&
        (filterCompany === "all" || e.source_id === filterCompany)
      )
      .reduce((s, e) => s + Number((e as any).healthcare_deduction || 0) + Number(e.retirement_401k || 0) + Number(e.pre_tax_deductions || 0), 0);
    return {
      revenue: shared.revenue,
      expenses: shared.deductions,
      txExpenses: shared.txExpenses,
      mileageDeduction: shared.mileageDeduction,
      profit: shared.profit,
      ownerDeductions: ownerDeds,
    };
  }, [filtered, incomeEntries, ytdMileage, filterCompany, companyById, companies]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4 max-w-4xl w-full mx-auto min-w-0">
      {/* Header row — Export moved into Filters & Export accordion */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-foreground">Business Activity</h1>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={openAddIncome} className="gap-1.5 w-full sm:w-auto" data-testid="ba-add-income">
            <DollarSign className="h-3.5 w-3.5" /> Add Income
          </Button>

          <Button size="sm" onClick={openAddExpense} className="gap-1.5 w-full sm:w-auto">
            <Receipt className="h-3.5 w-3.5" /> Add Expense
          </Button>
        </div>
      </div>

      {/* Primary focus: Business Profit hero card */}
      <div className="rounded-xl border border-border bg-card p-6 sm:p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">Business Profit</p>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground/80">Revenue − Deductions</p>
        <p className={`mt-3 text-4xl sm:text-5xl font-bold tracking-tight ${summaryStats.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
          {fmt(summaryStats.profit)}
        </p>
      </div>

      {/* Revenue + Deductions row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Business Revenue</p>
          <p className="text-lg sm:text-xl font-bold text-card-foreground">{fmt(summaryStats.revenue)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs font-medium text-muted-foreground">Deductions</p>
            {summaryStats.mileageDeduction > 0 && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="Deduction details" className="text-muted-foreground hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    Includes <span className="font-medium">{fmt(summaryStats.mileageDeduction)}</span> mileage deduction.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <p className="text-lg sm:text-xl font-bold text-card-foreground">{fmt(summaryStats.expenses)}</p>
        </div>
      </div>



      <Collapsible open={showMobileFilters} onOpenChange={setShowMobileFilters}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-left transition-colors hover:bg-accent/30"
          >
            <span className="text-sm font-medium text-foreground">
              Filters &amp; Export
              {activeFilterCount > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">· {activeFilterCount} active</span>
              )}
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showMobileFilters ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {filterCompany !== "all" && <Badge variant="secondary" className="gap-1 text-[11px]">{companyById.get(filterCompany)?.name || "Company"}<button onClick={() => setFilterCompany("all")} className="ml-0.5">×</button></Badge>}
            {filterType !== "all" && <Badge variant="secondary" className="gap-1 text-[11px] capitalize">{filterType}<button onClick={() => setFilterType("all")} className="ml-0.5">×</button></Badge>}
            {filterSource !== "all" && <Badge variant="secondary" className="gap-1 text-[11px]">{filterSource === "plaid" ? "Imported" : filterSource === "merged" ? "Linked" : "Manual"}<button onClick={() => setFilterSource("all")} className="ml-0.5">×</button></Badge>}
            {filterReview !== "all" && <Badge variant="secondary" className="gap-1 text-[11px]">Needs Review<button onClick={() => setFilterReview("all")} className="ml-0.5">×</button></Badge>}
            {filterPlanner !== "all" && <Badge variant="secondary" className="gap-1 text-[11px]">From Planner<button onClick={() => setFilterPlanner("all")} className="ml-0.5">×</button></Badge>}
            {(filterDateFrom || filterDateTo) && <Badge variant="secondary" className="gap-1 text-[11px]">{filterDateFrom || "Start"}–{filterDateTo || "End"}<button onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); }} className="ml-0.5">×</button></Badge>}
            
          </div>
        )}

        <CollapsibleContent>
          <div className="mt-2 rounded-lg border border-border bg-card p-4 space-y-4">
            {/* Search bar — at the top of the Filters & Export section */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search transactions…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Transaction type</Label>
              <div className="flex gap-1 rounded-lg border border-border p-0.5 bg-muted/30 w-full sm:w-fit">
                {(["all", "income", "expense", "transfer"] as const).map((tab) => {
                  const active = filterType === tab;
                  const activeTone =
                    tab === "income"
                      ? `${txTone("income").pill} shadow-sm`
                      : tab === "expense"
                        ? `${txTone("expense").pill} shadow-sm`
                        : tab === "transfer"
                          ? `${txTone("transfer").pill} shadow-sm`
                          : "bg-background text-foreground shadow-sm";
                  return (
                    <button
                      key={tab}
                      onClick={() => setFilterType(tab)}
                      className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                        active ? activeTone : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab === "all" ? "All" : tab === "income" ? "Income" : tab === "expense" ? "Expenses" : "Transfers"}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Company / business</Label>
                <Select value={filterCompany} onValueChange={setFilterCompany}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All Companies" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {companyFilterOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Source</Label>
                <Select value={filterSource} onValueChange={(v) => setFilterSource(v as any)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All Sources" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="plaid">Imported</SelectItem>
                    <SelectItem value="merged">Linked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date range</Label>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                <DateField value={filterDateFrom} onChange={setFilterDateFrom} />
                <span className="text-xs text-muted-foreground">to</span>
                <DateField value={filterDateTo} onChange={setFilterDateTo} />
              </div>
            </div>

            <div className="space-y-2.5">
              {needsReviewCount > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="flt-needs-review" className="text-xs text-muted-foreground">Needs review only ({needsReviewCount})</Label>
                  <Switch id="flt-needs-review" checked={filterReview === "needs_review"} onCheckedChange={(v) => setFilterReview(v ? "needs_review" : "all")} />
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="flt-from-planner" className="text-xs text-muted-foreground">From Planner only</Label>
                <Switch id="flt-from-planner" checked={filterPlanner === "from_planner"} onCheckedChange={(v) => setFilterPlanner(v ? "from_planner" : "all")} />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="flt-hide-transfers" className="text-xs text-muted-foreground">Hide account transfers</Label>
                  <Switch
                    id="flt-hide-transfers"
                    data-testid="flt-hide-transfers"
                    checked={hideTransfers}
                    onCheckedChange={(v) => setHideTransfers(!!v)}
                  />
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  Account transfers move money between accounts and do not affect business profit or tax calculations.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-border">
              <Button variant="ghost" size="sm" className="sm:flex-1" onClick={clearAdvancedFilters}>
                Clear filters
              </Button>
              <Button variant="outline" size="sm" className="sm:flex-1 gap-1.5" onClick={exportCSV}>
                <Download className="h-3.5 w-3.5" /> Export Data
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Bulk Actions Bar (desktop). On mobile we use the dedicated selection bar below. */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-30 hidden sm:flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 shadow-sm">
          <span className="text-sm font-medium text-foreground whitespace-nowrap">{selectedIds.size} selected</span>
          <div className="flex gap-2 flex-wrap flex-1">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { needs_review: false } as any });
              setSelectedIds(new Set());
            }}>
              <CheckCircle2 className="h-3 w-3" /> Mark Reviewed
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowBulkCategory(true)}>
              <Tag className="h-3 w-3" /> Categorize
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive hover:text-destructive border-destructive/30" onClick={() => setShowBulkDeleteConfirm(true)}>
              <Trash2 className="h-3 w-3" /> Delete
            </Button>
            <Select value={bulkCompany} onValueChange={(v) => {
              const company = companyById.get(v);
              if (!company) return;
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { entity: company.name, source_id: company.id, company_type: company.companyType, needs_review: false } as any });
              setBulkCompany("");
              setSelectedIds(new Set());
            }}>
              <SelectTrigger className="w-[160px] h-7 text-xs">
                <SelectValue placeholder="Assign Company" />
              </SelectTrigger>
              <SelectContent>
                {businessCompanies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({getFilingMeta(c.companyType).shortLabel})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { excluded_from_reports: true, needs_review: false } as any });
              setSelectedIds(new Set());
            }}>
              <EyeOff className="h-3 w-3" /> Exclude
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { transaction_type: "transfer", transfer_subtype: "account_transfer", category: "Transfer", excluded_from_reports: true, needs_review: false } as any });
              setSelectedIds(new Set());
            }}>
              <ArrowLeftRight className="h-3 w-3" /> Transfer
            </Button>
            {selectedIds.size >= 2 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={createMatchGroup.isPending}
                onClick={() => {
                  createMatchGroup.mutate(
                    { transactionIds: [...selectedIds] },
                    { onSuccess: () => setSelectedIds(new Set()) },
                  );
                }}
              >
                <Link2 className="h-3 w-3" /> Link {selectedIds.size}
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs whitespace-nowrap" onClick={() => setSelectedIds(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      {legacyExpenseReviewQueue.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex flex-col gap-1 border-b border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-card-foreground">Needs Review: assign legacy expenses</h2>
              <p className="text-xs text-muted-foreground">
                These expenses do not have a company ID yet. Assign each one to the exact entity/tax type.
              </p>
            </div>
            <Badge variant="outline" className="w-fit text-xs">{legacyExpenseReviewQueue.length} item{legacyExpenseReviewQueue.length === 1 ? "" : "s"}</Badge>
          </div>
          <div className="divide-y divide-border">
            {legacyExpenseReviewQueue.map((tx) => (
              <div key={tx.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[90px_1fr_110px_260px] sm:items-center">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDateShort(tx.transaction_date)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-card-foreground">{tx.vendor || "Legacy expense"}</p>
                  <p className="truncate text-xs text-muted-foreground">Current label: {getTransactionCompanyLabel(tx)}</p>
                </div>
                <span className="text-sm font-semibold text-card-foreground tabular-nums sm:text-right">-{fmt(Math.abs(tx.amount))}</span>
                <Select onValueChange={(companyId) => assignLegacyExpense(tx.id, companyId)} disabled={updateMutation.isPending}>
                  <SelectTrigger className="h-9 w-full text-xs">
                    <SelectValue placeholder="Assign entity / tax type" />
                  </SelectTrigger>
                  <SelectContent>
                    {businessCompanies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name} — {getFilingMeta(company.companyType).shortLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      {unassignedInterestReviewQueue.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex flex-col gap-1 border-b border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-card-foreground">Needs Review: interest income</h2>
              <p className="text-xs text-muted-foreground">
                Bank interest is taxable interest by default and is excluded from business profit unless you explicitly assign it.
              </p>
            </div>
            <Badge variant="outline" className="w-fit text-xs">{unassignedInterestReviewQueue.length} item{unassignedInterestReviewQueue.length === 1 ? "" : "s"}</Badge>
          </div>
          <div className="divide-y divide-border">
            {unassignedInterestReviewQueue.map((tx) => (
              <div key={tx.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[90px_1fr_110px_140px] sm:items-center">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDateShort(tx.transaction_date)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-card-foreground">{tx.vendor || "Interest income"}</p>
                  <p className="truncate text-xs text-muted-foreground">Current company: {getTransactionCompanyLabel(tx)}</p>
                </div>
                <span className="text-sm font-semibold text-card-foreground tabular-nums sm:text-right">{fmt(Math.abs(tx.amount))}</span>
                <Button variant="outline" size="sm" onClick={() => markInterestIncomeForReview(tx.id)} disabled={updateMutation.isPending}>
                  Mark Review
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Banking-style table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Mobile Select All — only when actively in selection mode */}
        {mobileSelectionMode && (
          <div className="flex sm:hidden items-center justify-between gap-2 px-4 py-2 border-b border-border bg-primary/5">
            <span className="text-xs font-medium text-foreground">
              Selecting transactions to link
            </span>
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={exitMobileSelection}
            >
              Done
            </button>
          </div>
        )}
        {/* Table header */}
        <div className="hidden sm:grid sm:grid-cols-[28px_85px_1fr_85px_100px_65px_65px_95px_36px] gap-2 px-4 py-2.5 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wide items-center">
          <Checkbox
            checked={selectedIds.size === filtered.length && filtered.length > 0 ? true : selectedIds.size > 0 ? "indeterminate" : false}
            onCheckedChange={() => {
              if (selectedIds.size === filtered.length) setSelectedIds(new Set());
              else setSelectedIds(new Set(filtered.map((t) => t.id)));
            }}
          />
          <span>Date</span>
          <span>Transaction</span>
          <span>Company</span>
          <span className="text-right">Amount</span>
          <span className="text-center">Type</span>
          <span className="text-center">Source</span>
          <span>Category</span>
          <span></span>
        </div>

        {/* Desktop rows */}
        <div className="hidden sm:block divide-y divide-border">
          {filtered.map((tx) => {
            const type = (tx.transaction_type || "expense") as string;
            const isIncomeTx = type === "income";
            const isTransferTx = type === "transfer";
            const transferLabel = isTransferTx && tx.transfer_subtype
              ? TRANSFER_SUBTYPES.find((s) => s.value === tx.transfer_subtype)?.label || "Transfer"
              : "Transfer";
            const displayAmount = isIncomeTx ? Math.abs(tx.amount) : isTransferTx ? Math.abs(tx.amount) : -Math.abs(tx.amount);
            const source = tx.source_type || "manual";
            const isSelected = selectedIds.has(tx.id);

            return (
              <div key={tx.id}>
              <div
                className={`grid grid-cols-[28px_85px_1fr_85px_100px_65px_65px_95px_36px] gap-2 px-4 py-3 hover:bg-muted/30 transition-colors items-center cursor-pointer ${
                  tx.needs_review ? "bg-amber-50/30 dark:bg-amber-950/10" : ""
                } ${isSelected ? "bg-primary/5" : ""}`}
                onClick={() => setDetailTx(tx)}
              >
                <Checkbox
                  checked={isSelected}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedIds);
                    if (checked) next.add(tx.id); else next.delete(tx.id);
                    setSelectedIds(next);
                  }}
                />
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatDateShort(tx.transaction_date)}
                </span>
                <div className="truncate">
                  <span className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                    {tx.vendor}
                    {(attachmentCounts?.get(tx.id) ?? 0) > 0 && (
                      <span title={`${attachmentCounts!.get(tx.id)} attachment${attachmentCounts!.get(tx.id)! > 1 ? "s" : ""}`} className="inline-flex items-center gap-0.5 text-muted-foreground">
                        <Paperclip className="h-3 w-3" />
                        <span className="text-[10px] tabular-nums">{attachmentCounts!.get(tx.id)}</span>
                      </span>
                    )}
                    {tx.needs_review && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-400 text-amber-600 dark:text-amber-400">Review</Badge>
                    )}
                    {tx.excluded_from_reports && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted text-muted-foreground">Excluded</Badge>
                    )}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground truncate">
                  {getTransactionCompanyLabel(tx)}
                </span>
                <span className={`text-sm font-semibold tabular-nums text-right ${isIncomeTx ? txTone("income").amount : isTransferTx ? txTone("transfer").amount : txTone("expense").amount}`}>
                  {isIncomeTx ? "+" : isTransferTx ? "" : "-"}{fmt(Math.abs(displayAmount))}
                </span>
                <span className="text-center">
                  {(() => {
                    const t = isIncomeTx ? txTone("income") : isTransferTx ? txTone("transfer") : txTone("expense");
                    return (
                      <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${t.pill}`}>
                        {isIncomeTx ? "Income" : isTransferTx ? transferLabel : "Expense"}
                      </span>
                    );
                  })()}
                </span>
                <span className="text-center">
                  {source === "plaid" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">Imported</Badge>
                  )}
                  {source === "merged" && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-0 gap-0.5">
                      <Link2 className="h-2.5 w-2.5" />Linked
                    </Badge>
                  )}
                  {source === "manual" && (
                    <span className="text-[10px] text-muted-foreground">Manual</span>
                  )}
                </span>
                {(() => {
                  const catLabel = mapLegacyCategory(tx.category) || "Uncategorized";
                  const isUncategorized = !isIncomeTx && !isTransferTx && (!tx.category || catLabel === "Uncategorized");
                  return isUncategorized ? (
                    <span className="truncate">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400">
                        Uncategorized
                      </Badge>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground truncate">{catLabel}</span>
                  );
                })()}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(tx)}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => confirmDelete(tx.id)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {/* match suggestion banner removed — use long-press multi-select instead */}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-16 text-center text-muted-foreground text-sm">
              No transactions yet. Click "+ Add Income" or "+ Add Expense" to get started.
            </div>
          )}
        </div>

        {/* Mobile rows — grouped by month */}
        <div className="sm:hidden">
          {groupByMonth(filtered, (t) => t.transaction_date).map((group) => (
            <div key={group.key}>
              <MonthHeader label={group.label} />
              <div className="divide-y divide-border">
                {group.items.map((tx) => {
                  const type = (tx.transaction_type || "expense") as string;
                  const isIncomeTx = type === "income";
                  const isTransferTx = type === "transfer";
                  const transferLabel = isTransferTx && tx.transfer_subtype
                    ? TRANSFER_SUBTYPES.find((s) => s.value === tx.transfer_subtype)?.label || "Transfer"
                    : "Transfer";
                  const displayAmount = isIncomeTx
                    ? Math.abs(tx.amount)
                    : isTransferTx
                      ? Math.abs(tx.amount)
                      : -Math.abs(tx.amount);
                  const source = tx.source_type || "manual";
                  const kind = isIncomeTx ? "income" : isTransferTx ? "transfer" : "expense";
                  const dateStr = formatDate(tx.transaction_date);
                  // Primary badges (kept visible): type for transfers, review state
                  const badges: LedgerRowBadge[] = [];
                  if (isTransferTx) badges.push({ label: transferLabel, tone: "muted" });
                  else badges.push({ label: isIncomeTx ? "Income" : "Expense", tone: isIncomeTx ? "success" : "expense" });
                  if (tx.needs_review) badges.push({ label: "Review", tone: "warning" });
                  if ((tx as any).origin_type === "planner_converted") badges.push({ label: "From Planner", tone: "info" });
                  const isCatchupOrigin = (tx as any).origin_type === "ytd_catchup";
                  if (isCatchupOrigin) badges.push({ label: "YTD catch-up", tone: "info" });
                  const linkedGroupItems = tx.linked_group_id ? matchGroupsMap?.get(tx.linked_group_id) : undefined;
                  const linkedSiblings = (linkedGroupItems || []).filter((it) => it.transaction.id !== tx.id);
                  

                  // Secondary metadata (behind expand toggle)
                  const attCount = attachmentCounts?.get(tx.id) ?? 0;
                  const categoryLabel = isIncomeTx ? "Income" : mapLegacyCategory(tx.category) || "Uncategorized";
                  const linked = incomeByLinkedTx.get(tx.id);
                  const deposited = Number(linked?.deposited_amount || 0);
                  const showDeposited = isIncomeTx && deposited > 0 && Math.abs(deposited - Math.abs(tx.amount)) > 0.5;

                  const isMobileSelected = mobileSelectedOrder.includes(tx.id);

                  const expandableContent = (
                    <>
                      <div className="flex justify-between gap-3"><span>Category</span><span className="text-right truncate">{categoryLabel === "Uncategorized" && !isIncomeTx ? (<Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400">Uncategorized</Badge>) : (<span className="text-foreground">{categoryLabel}</span>)}</span></div>
                      <div className="flex justify-between gap-3"><span>Company</span><span className="text-foreground text-right truncate">{getTransactionCompanyLabel(tx)}</span></div>
                      {(tx as { schedule_c_category?: string | null }).schedule_c_category && (
                        <div className="flex justify-between gap-3"><span>Schedule C</span><span className="text-foreground text-right truncate">{(tx as { schedule_c_category?: string | null }).schedule_c_category}</span></div>
                      )}
                      <div className="flex justify-between gap-3"><span>Source</span><span className="text-foreground text-right truncate">{source === "merged" ? "Linked (manual + bank)" : source}</span></div>
                      {tx.account_source && (
                        <div className="flex justify-between gap-3"><span>Account</span><span className="text-foreground text-right truncate">{tx.account_source}</span></div>
                      )}
                      {attCount > 0 && (
                        <div className="flex justify-between gap-3"><span>Attachments</span><span className="text-foreground text-right">📎 {attCount}</span></div>
                      )}
                      {showDeposited && (
                        <div className="flex justify-between gap-3"><span>Deposited</span><span className="text-foreground text-right tabular-nums">{fmt(deposited)}</span></div>
                      )}
                      {tx.excluded_from_reports && (
                        <div className="flex justify-between gap-3"><span>Status</span><span className="text-foreground text-right">Excluded from reports</span></div>
                      )}
                      {tx.notes && (
                        <div className="pt-1"><div className="text-muted-foreground/80 mb-0.5">Notes</div><div className="text-foreground whitespace-pre-wrap break-words">{tx.notes}</div></div>
                      )}
                      <div className="pt-2 flex flex-wrap gap-2">
                        {attCount > 0 && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/40 active:bg-muted/60"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMobileViewerTxId(tx.id);
                            }}
                          >
                            <Paperclip className="h-3 w-3" /> View Receipt{attCount > 1 ? `s (${attCount})` : ""}
                          </button>
                        )}
                        {linkedSiblings.length === 0 && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/40 active:bg-muted/60"
                            onClick={(e) => {
                              e.stopPropagation();
                              enterMobileSelectionWith(tx.id);
                            }}
                          >
                            <Link2 className="h-3 w-3" /> Select for linking
                          </button>
                        )}
                      </div>
                      {linkedSiblings.length > 0 && (
                        <Collapsible className="-mx-4 mt-3 border-t border-blue-200/50 dark:border-blue-900/30 bg-blue-50/60 dark:bg-blue-950/20">
                          <CollapsibleTrigger
                            onClick={(e) => e.stopPropagation()}
                            className="group w-full px-4 py-2.5 flex items-center justify-between gap-2 text-[12px] font-medium text-blue-900 dark:text-blue-200 hover:bg-blue-100/40 dark:hover:bg-blue-900/20"
                          >
                            <span className="flex items-center gap-1.5">
                              <Link2 className="h-3 w-3 shrink-0" />
                              Linked transactions ({linkedSiblings.length})
                            </span>
                            <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                          </CollapsibleTrigger>
                          <CollapsibleContent className="px-4 pb-3 space-y-1.5">
                            {linkedSiblings.map((it) => {
                              const lt = it.transaction;
                              const ltType = (lt.transaction_type || "expense") as string;
                              const ltDate = formatDateShort(lt.transaction_date);
                              const ltCategory = ltType === "income" ? "Income" : ltType === "transfer" ? "Transfer" : (mapLegacyCategory(lt.category) || "Uncategorized");
                              return (
                                <div key={it.itemId} className="flex items-start gap-2 text-[12px]">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-foreground truncate">{lt.vendor || "(No payee)"}</div>
                                    <div className="text-muted-foreground">
                                      {ltDate} · {fmt(Math.abs(lt.amount))} · {ltCategory}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-[11px]"
                                    disabled={unlinkMatchGroupItem.isPending}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (tx.linked_group_id) {
                                        unlinkMatchGroupItem.mutate({ itemId: it.itemId, groupId: tx.linked_group_id });
                                      }
                                    }}
                                  >
                                    Unlink
                                  </Button>
                                </div>
                              );
                            })}
                            <div className="pt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/40 active:bg-muted/60"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  enterMobileSelectionWith(tx.id);
                                }}
                              >
                                <Link2 className="h-3 w-3" /> Link More
                              </button>
                              <button
                                type="button"
                                disabled={unlinkMatchGroup.isPending}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (tx.linked_group_id) unlinkMatchGroup.mutate(tx.linked_group_id);
                                }}
                              >
                                <Unlink className="h-3 w-3" /> Unlink All
                              </button>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </>
                  );

                  return (
                    <LedgerRow
                      key={tx.id}
                      kind={kind}
                      title={tx.vendor || "(No payee)"}
                      subtitle={null}
                      meta={null}
                      date={dateStr}
                      amount={displayAmount}
                      amountTone={isIncomeTx ? "positive" : isTransferTx ? "neutral" : "negative"}
                      amountPrefix={isIncomeTx ? "+" : isTransferTx ? "" : "-"}
                      badges={badges}
                      expandableContent={expandableContent}
                      selected={mobileSelectionMode ? isMobileSelected : selectedIds.has(tx.id)}
                      selectionMode={mobileSelectionMode}
                      onToggleSelect={() => toggleMobileSelect(tx.id)}
                      onLongPress={() => enterMobileSelectionWith(tx.id)}
                      onClick={() => {
                        if (isCatchupOrigin) {
                          toast.info("Edit this row on the Income page (YTD catch-up).");
                          return;
                        }
                        setDetailTx(tx);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-16 text-center text-muted-foreground text-sm">
              No transactions yet. Tap "+ Add Income" or "+ Add Expense" to get started.
            </div>
          )}
        </div>
      </div>

      {/* Mobile selection action bar — only visible in selection mode */}
      {mobileSelectionMode && (() => {
        const count = mobileSelectedOrder.length;
        const canLink = count >= 2;
        const helper = count === 0
          ? "Tap a transaction to select it"
          : count === 1
            ? "Select one more to link"
            : `${count} transactions ready to link`;

        return (
          <div className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
            <div className="px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.75rem)] flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{count} selected</div>
                <div className="text-[11px] text-muted-foreground truncate">{helper}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-sm"
                onClick={exitMobileSelection}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-9 text-sm gap-1.5"
                disabled={!canLink || createMatchGroup.isPending}
                onClick={() => {
                  if (!canLink) return;
                  createMatchGroup.mutate(
                    { transactionIds: [...mobileSelectedOrder] },
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

      {/* Spacer so the last row isn't hidden behind the sticky mobile selection bar */}
      {mobileSelectionMode && <div className="sm:hidden h-20" aria-hidden />}

      {/* Mobile in-ledger receipt viewer */}
      <MobileAttachmentViewer
        transactionId={mobileViewerTxId}
        open={!!mobileViewerTxId}
        onClose={() => setMobileViewerTxId(null)}
      />

      {/* ═══════ ADD INCOME MODAL ═══════ */}
      <Dialog open={showIncomeForm} onOpenChange={(open) => { if (!open) { setShowIncomeForm(false); setEditingIncomeTxId(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{isEditingIncome ? "Edit Income" : "Add Income"}</DialogTitle>
            <DialogDescription className="sr-only">
              {isEditingIncome ? "Edit details for this business income entry." : "Add a new business income entry, including amount, date, company, and tax withholdings."}
            </DialogDescription>
          </DialogHeader>
          <TooltipProvider delayDuration={150}>
          <div className="space-y-4">
            {incomeNeedsCompanyReview && (
              <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-100">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Review Needed</p>
                    <p className="mt-0.5 text-xs">This income is unassigned and excluded from business totals. Select a company below to confirm it is business income.</p>
                  </div>
                </div>
              </div>
            )}
            {/* Core fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                <DateField value={incomeForm.date} onChange={(v) => setIncomeForm((f) => ({ ...f, date: v }))} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Merchant / Payer</Label>
                <Input
                  placeholder="e.g. ED Shift Pay"
                  value={incomeForm.name}
                  onChange={(e) => setIncomeForm((f) => ({ ...f, name: e.target.value }))}
                  data-testid="ba-income-name"
                />
              </div>

            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
                <Select
                  value={incomeForm.company}
                  disabled={!canEditIncomeCompany}
                  onValueChange={(v) => {
                    if (!canEditIncomeCompany) return;
                    // Switching company → reset advanced fields so incompatible
                    // unsaved values don't leak across filing types.
                    setIncomeForm((f) => ({
                      ...f,
                      company: v,
                      income_type: getCompanyType(v),
                      net_received: "",
                      taxes_withheld: "",
                      pre_tax_deductions: "",
                      retirement_401k: "",
                      healthcare_deduction: "",
                      hsa_contribution: "",
                      federal_withholding: "",
                      state_withholding: "",
                      ss_withholding: "",
                      medicare_withholding: "",
                      actual_withholding: "",
                      additional_tax_reserve: "0",
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={isEditingIncome ? "Unassigned" : "Select company"} />
                    {isEditingIncome && !canEditIncomeCompany && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Lock className="h-3 w-3 ml-1 text-muted-foreground inline-block" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">Company is locked after saving. To move this income, delete it and create a new transaction.</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {incomeForm.company === UNASSIGNED_COMPANY_VALUE && (
                      <SelectItem value={UNASSIGNED_COMPANY_VALUE}>Unassigned</SelectItem>
                    )}
                    {businessCompanies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({getFilingMeta(c.companyType).shortLabel})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {incomeNeedsCompanyReview && (
                  <p className="mt-1 text-[10px] text-muted-foreground">Unassigned — review needed before this counts as business income.</p>
                )}
                {isIncomeEntryTypeDisabled(householdStreams, normalizeFilingType(incomeForm.income_type)) && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    No longer active in your Household Income Profile — kept available for this existing entry only.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Gross Amount *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={incomeForm.gross_amount}
                  onChange={(e) => setIncomeForm((f) => ({ ...f, gross_amount: e.target.value }))}
                  placeholder="0.00"
                  data-testid="ba-income-gross"
                />

                <p className="text-[10px] text-muted-foreground mt-1">Total income before taxes or deductions</p>
              </div>
            </div>

            {/* Recommended to Set Aside */}
            {grossIncome > 0 && recommendation && !recommendation.isOverWithheld && recommendedWithholding > 0 && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Recommended to set aside</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Based on your total tax rate ({recommendation.effectiveRate.toFixed(1)}%){" "}
                    <RecommendedSetAsideInfo
                      rate={recommendation.effectiveRate}
                      breakdown={recommendation.rateBreakdown}
                      taxableBase={{
                        gross: grossIncome,
                        retirement401k: num(incomeForm.retirement_401k),
                        healthInsurance: num(incomeForm.healthcare_deduction),
                        hsa: num(incomeForm.hsa_contribution),
                        otherPreTax: num(incomeForm.pre_tax_deductions),
                      }}
                      k1Treatment={k1TreatmentForEntry}
                      isK1={normalizeFilingType(incomeForm.income_type) === "k1_partnership"}
                    />
                  </p>
                </div>
                <span className="text-lg font-bold text-primary whitespace-nowrap">{fmt(recommendedWithholding)}</span>
              </div>
            )}
            {grossIncome > 0 && recommendation && recommendation.isOverWithheld && (
              <div className="rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 p-3">
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  Employer over-withheld by <strong>{fmt(Math.abs(recommendedWithholding))}</strong> — consider adjusting your W-4.
                </p>
              </div>
            )}

            {/* Simplified federal payroll tax + optional state withholding */}
            {showField("federal_withholding") && (
              <TotalFederalTaxField
                total={incomeForm.total_federal_payroll_taxes}
                onTotalChange={(v) => setIncomeForm((f) => ({ ...f, total_federal_payroll_taxes: v }))}
                federal={incomeForm.federal_withholding}
                onFederalChange={(v) => setIncomeForm((f) => ({ ...f, federal_withholding: v }))}
                ss={incomeForm.ss_withholding}
                onSsChange={(v) => setIncomeForm((f) => ({ ...f, ss_withholding: v }))}
                medicare={incomeForm.medicare_withholding}
                onMedicareChange={(v) => setIncomeForm((f) => ({ ...f, medicare_withholding: v }))}
                collapseKey={editingIncomeTxId || showIncomeForm}
              />
            )}

            {!!taxSettings?.businessStateTaxEnabled && showField("state_withholding") && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">State tax withheld</Label>
                <Input
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={incomeForm.state_withholding}
                  onChange={(e) => setIncomeForm((f) => ({ ...f, state_withholding: e.target.value }))}
                />
              </div>
            )}

            {/* Advanced details (collapsible) — fields driven by per-company toggles */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button data-testid="ba-income-advanced-toggle" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-1">

                  {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Advanced details
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-3">
                  {!hasAnyAdvancedField && (
                    <p className="text-xs text-muted-foreground italic">
                      No advanced fields enabled for this income type. Adjust toggles in Settings → Companies → Advanced tax settings.
                    </p>
                  )}

                  {Object.keys(legacyFields).length > 0 && (
                    <p className="text-[10px] text-muted-foreground italic border-l-2 border-muted-foreground/40 pl-2">
                      Some fields below are <strong>hidden in new entries</strong>, but shown here because this transaction has a saved value. Clear a value to remove it; toggle changes won't erase historical data.
                    </p>
                  )}

                  {showField("net_received") && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Net Received<LegacyNote field="net_received" /></Label>
                      <Input type="number" min="0" step="0.01" placeholder={grossIncome > 0 ? fmt(calculatedNet) : "0.00"} value={incomeForm.net_received} onChange={(e) => setIncomeForm((f) => ({ ...f, net_received: e.target.value }))} data-testid="ba-income-net-received" />
                      <p className="text-[10px] text-muted-foreground mt-1">Amount deposited into your bank account</p>
                    </div>
                  )}
                  {showField("net_received") && grossIncome > 0 && (
                    <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
                      Estimated Net: <strong>{fmt(calculatedNet)}</strong> based on your inputs
                    </p>
                  )}

                  {showField("taxes_withheld") && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div><Label className="text-xs text-muted-foreground mb-1.5 block">Taxes Withheld<LegacyNote field="taxes_withheld" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.taxes_withheld} onChange={(e) => setIncomeForm((f) => ({ ...f, taxes_withheld: e.target.value }))} placeholder="0.00" /></div>
                    </div>
                  )}

                  {(showField("retirement_401k") || showField("healthcare_deduction") || showField("hsa_contribution") || showField("pre_tax_deductions")) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {showField("retirement_401k") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">{normalizeFilingType(incomeForm.income_type) === "1099_schedule_c" ? "Solo 401(k) / retirement contribution" : "Retirement / 401(k)"}<LegacyNote field="retirement_401k" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.retirement_401k} onChange={(e) => setIncomeForm((f) => ({ ...f, retirement_401k: e.target.value }))} placeholder="0.00" /></div>)}
                      {showField("healthcare_deduction") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">Health Insurance<LegacyNote field="healthcare_deduction" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.healthcare_deduction} onChange={(e) => setIncomeForm((f) => ({ ...f, healthcare_deduction: e.target.value }))} placeholder="0.00" /></div>)}
                      {showField("hsa_contribution") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">HSA Contribution<LegacyNote field="hsa_contribution" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.hsa_contribution} onChange={(e) => setIncomeForm((f) => ({ ...f, hsa_contribution: e.target.value }))} placeholder="0.00" /></div>)}
                      {showField("pre_tax_deductions") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">Other Pre-Tax<LegacyNote field="pre_tax_deductions" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.pre_tax_deductions} onChange={(e) => setIncomeForm((f) => ({ ...f, pre_tax_deductions: e.target.value }))} placeholder="0.00" /></div>)}
                    </div>
                  )}

                  {showField("actual_withholding") && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">
                        Amount you're saving for taxes<LegacyNote field="actual_withholding" />
                      </Label>
                      <p className="text-[10px] text-muted-foreground mb-1">
                        {recommendedWithholding > 0
                          ? `Recommended: ${fmt(recommendedWithholding)}. Tracked as a reserve only. This is not counted as taxes paid until you make an IRS or state tax payment.`
                          : "Tracked as a reserve only. This is not counted as taxes paid until you make an IRS or state tax payment."}
                      </p>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={recommendedWithholding > 0 ? fmt(recommendedWithholding) : "0.00"}
                        value={incomeForm.actual_withholding === "0" ? "" : incomeForm.actual_withholding}
                        onChange={(e) => setIncomeForm((f) => ({ ...f, actual_withholding: e.target.value }))}
                      />
                    </div>
                  )}

                  {showField("additional_tax_reserve") && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">
                        Additional tax reserve<LegacyNote field="additional_tax_reserve" />
                      </Label>
                      <p className="text-[10px] text-muted-foreground mb-1">Optional extra amount to set aside beyond the recommendation</p>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={incomeForm.additional_tax_reserve === "0" ? "" : incomeForm.additional_tax_reserve}
                        onChange={(e) => setIncomeForm((f) => ({ ...f, additional_tax_reserve: e.target.value }))}
                      />
                    </div>
                  )}

                  {visibleFields.notes && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                      <Input placeholder="Optional" value={incomeForm.notes} onChange={(e) => setIncomeForm((f) => ({ ...f, notes: e.target.value }))} />
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>



            <p className="text-[10px] text-muted-foreground italic">
              Withholding method controlled in Settings
            </p>

            {/* Attachments */}
            <TransactionAttachments
              transactionId={editingIncomeTxId}
              companyId={selectedIncomeCompany?.id || null}
              pendingFiles={editingIncomeTxId ? undefined : pendingIncomeAttachments}
              onPendingFilesChange={editingIncomeTxId ? undefined : setPendingIncomeAttachments}
            />

            {/* Actions */}
            <div className="flex justify-between">
              {isEditingIncome ? (
                <Button variant="destructive" size="sm" onClick={() => confirmDelete(editingIncomeTxId!)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowIncomeForm(false)}>Cancel</Button>
                <Button onClick={saveIncome} disabled={!incomeForm.name.trim() || !incomeForm.date || grossIncome <= 0} data-testid="ba-income-save">
                  {isEditingIncome ? "Save" : "Add Income"}
                </Button>

              </div>
            </div>
          </div>
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      {/* ═══════ ADD EXPENSE MODAL ═══════ */}
      <Dialog open={showExpenseForm} onOpenChange={(open) => { if (!open) { setShowExpenseForm(false); setEditingExpenseTxId(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{isEditingExpense ? "Edit Expense" : "Add Expense"}</DialogTitle>
            <DialogDescription className="sr-only">
              {isEditingExpense ? "Edit details for this business expense." : "Add a new business expense, including amount, date, category, and company."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Transfer toggle */}
            <div className="flex items-center gap-3">
              <Switch
                checked={expenseForm.is_transfer}
                onCheckedChange={(v) => setExpenseForm((f) => ({ ...f, is_transfer: v, category: v ? "Transfer" : f.category }))}
                id="transfer-toggle"
              />
              <Label htmlFor="transfer-toggle" className="text-sm cursor-pointer">
                This is a transfer
              </Label>
            </div>
            {expenseForm.is_transfer && (
              <p className="text-[11px] text-muted-foreground -mt-2">
                Transfers move money between accounts and are excluded from income/expense reports and tax calculations.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                <DateField value={expenseForm.date} onChange={(v) => setExpenseForm((f) => ({ ...f, date: v }))} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Merchant / Name</Label>
                <Input
                  placeholder="e.g. Amazon"
                  value={expenseForm.name}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{expenseForm.is_transfer ? "Company (optional)" : "Company *"}</Label>
                <Select value={expenseForm.company} onValueChange={(v) => setExpenseForm((f) => ({ ...f, company: v }))}>
                  <SelectTrigger><SelectValue placeholder={expenseForm.is_transfer ? "None" : "Select company"} /></SelectTrigger>
                  <SelectContent>
                    {expenseForm.is_transfer && <SelectItem value="Unassigned">None</SelectItem>}
                    {businessCompanies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({getFilingMeta(c.companyType).shortLabel})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Amount</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={expenseForm.amount} onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
            </div>

            {!expenseForm.is_transfer && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
                <ExpenseCategoryCombobox value={expenseForm.category} onValueChange={(v) => setExpenseForm((f) => ({ ...f, category: v, schedule_c_category: mapToScheduleC(v) }))} />
              </div>
            )}

            {expenseForm.is_transfer && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Transfer Type</Label>
                <Select value={expenseForm.transfer_subtype} onValueChange={(v) => setExpenseForm((f) => ({ ...f, transfer_subtype: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {TRANSFER_SUBTYPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
              <Input placeholder="Optional" value={expenseForm.notes} onChange={(e) => setExpenseForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Attachments */}
            <TransactionAttachments
              transactionId={editingExpenseTxId}
              companyId={selectedExpenseCompany?.id || null}
              pendingFiles={editingExpenseTxId ? undefined : pendingExpenseAttachments}
              onPendingFilesChange={editingExpenseTxId ? undefined : setPendingExpenseAttachments}
            />

            {/* Actions */}
            <div className="flex justify-between">
              {isEditingExpense ? (
                <Button variant="destructive" size="sm" onClick={() => confirmDelete(editingExpenseTxId!)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowExpenseForm(false)}>Cancel</Button>
                <Button onClick={saveExpense} disabled={!expenseForm.name.trim() || !expenseForm.date || num(expenseForm.amount) === 0}>
                  {isEditingExpense ? "Save" : expenseForm.is_transfer ? "Add Transfer" : "Add Expense"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTxId} onOpenChange={(open) => !open && setDeleteTxId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transaction</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this transaction.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Transaction{selectedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected transactions. Any linked income entries will be unlinked but not deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                bulkDeleteMutation.mutate([...selectedIds], {
                  onSuccess: () => {
                    setSelectedIds(new Set());
                    setShowBulkDeleteConfirm(false);
                  },
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Per-transaction tax-savings reminder */}
      <SimpleTaxReminderModal
        open={showRecommendation}
        onClose={() => setShowRecommendation(false)}
        onApply={() => {
          const additional = Math.max(0, reminderRecommended - reminderActualSaved);
          if (additional > 0 && incomeEntries?.length) {
            const latestEntry = incomeEntries[0];
            if (latestEntry) {
              const currentReserve = Number((latestEntry as any).additional_tax_reserve || 0);
              updateIncomeMutation.mutate({
                id: latestEntry.id,
                additional_tax_reserve: Math.round((currentReserve + additional) * 100) / 100,
              } as any);
            }
          }
          setShowRecommendation(false);
        }}
        recommendedSavings={reminderRecommended}
        actualSaved={reminderActualSaved}
        entryTitle={savedEntryTitle}
      />

      {/* Bulk Category Assignment Dialog */}
      <Dialog open={showBulkCategory} onOpenChange={setShowBulkCategory}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Category to {selectedIds.size} transactions</DialogTitle>
            <DialogDescription className="sr-only">Choose a category to apply to all selected transactions.</DialogDescription>
          </DialogHeader>
          <ExpenseCategoryCombobox
            value={bulkCategory}
            onValueChange={setBulkCategory}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkCategory(false)}>Cancel</Button>
            <Button
              disabled={!bulkCategory}
              onClick={() => {
                bulkUpdateMutation.mutate({
                  ids: [...selectedIds],
                  updates: { category: bulkCategory, needs_review: false } as any,
                });
                setSelectedIds(new Set());
                setBulkCategory("");
                setShowBulkCategory(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read-only detail card */}
      {detailTx && (() => {
        const tx = detailTx;
        const txType = (tx.transaction_type || "expense") as string;
        const isIncomeTx = txType === "income";
        const isTransferTx = txType === "transfer";
        const linked = isIncomeTx ? incomeByLinkedTx.get(tx.id) : null;
        const linkedGroupItems = tx.linked_group_id ? matchGroupsMap?.get(tx.linked_group_id) : undefined;
        const linkedSiblings = (linkedGroupItems || []).filter((it) => it.transaction.id !== tx.id);
        const source = tx.source_type || "manual";
        const catLabel = isIncomeTx ? "Income" : isTransferTx ? "Transfer" : (mapLegacyCategory(tx.category) || "");
        const companyLabel = getTransactionCompanyLabel(tx);
        const hasCompany = !!companyLabel && companyLabel !== "—" && companyLabel !== "Unassigned";
        const hasCategory = !!catLabel && catLabel !== "Uncategorized";
        const hasAccount = !!tx.account_source && tx.account_source !== "—";
        const sections: DetailSection[] = [
          {
            title: "Basic details",
            fields: [
              { label: "Vendor", value: tx.vendor || "—" },
              ...(hasCompany ? [{ label: "Company", value: companyLabel }] : []),
              ...(hasCategory ? [{ label: "Category", value: catLabel }] : []),
              ...((tx as any).schedule_c_category ? [{ label: "Schedule C", value: (tx as any).schedule_c_category as string }] : []),
              ...(hasAccount ? [{ label: "Account", value: tx.account_source! }] : []),
              ...(tx.notes ? [{ label: "Notes", value: tx.notes }] : []),
            ],
          },
        ];
        // Compute linked Plaid/imported sibling once, so it applies whether or
        // not this canonical income transaction has a linked income_entries row.
        const lLinkedPlaidAmt = Math.abs(Number((tx as any).linked_plaid_amount) || 0);
        const grossForSiblingCompare = Math.abs(Number(tx.amount) || 0);
        const plaidSibling = isIncomeTx ? (linkedSiblings.find((it) => {
          const t: any = it.transaction;
          if ((tx as any).linked_plaid_transaction_id && t.id === (tx as any).linked_plaid_transaction_id) return true;
          if (t.source_type === "plaid") return true;
          if (t.source_type === "merged") return true;
          if ((it as any).source === "imported") return true;
          return false;
        }) || linkedSiblings.find((it) => {
          const amt = Math.abs(Number(it.transaction.amount) || 0);
          return amt > 0 && Math.abs(amt - grossForSiblingCompare) > 0.5;
        })) : undefined;
        const lSiblingAmt = plaidSibling ? Math.abs(Number(plaidSibling.transaction.amount) || 0) : 0;

        if (linked) {
          const lGross = Number(linked.paycheck_amount) || 0;
          const lFed = getCanonicalTotalFederalPayrollTaxes(linked as any);
          const lState = Number((linked as any).state_withholding) || 0;
          const lPreTax = Number(linked.pre_tax_deductions) || 0;
          const l401 = Number(linked.retirement_401k) || 0;
          const lHsa = Number((linked as any).hsa_contribution) || 0;
          const lHealth = Number((linked as any).healthcare_deduction) || 0;
          const lOther = Number((linked as any).other_deductions) || 0;
          const lReserve = Number((linked as any).additional_tax_reserve) || 0;
          // Net Received precedence — resolved via the shared helper so the
          // edit modal, transaction detail, CSV export, and reports stay in
          // lockstep. See src/lib/netReceivedPrecedence.ts for the rules.
          const calcNet = Math.max(0, lGross - lFed - lState - lPreTax - l401 - lHsa - lHealth - lOther);
          const lNet = resolveNetReceived({
            gross: lGross,
            savedDeposited: (linked as any).deposited_amount,
            siblingAmount: lSiblingAmt,
            linkedPlaidAmount: lLinkedPlaidAmt,
            calculatedNet: calcNet,
          });

          sections.push({
            title: "Tax details",
            fields: [
              { label: "Gross", value: fmt(lGross), mono: true },
              { label: "Net received", value: fmt(lNet), mono: true },
              ...(lFed > 0 ? [{ label: "Federal withheld", value: fmt(lFed), mono: true }] : []),
              ...(lState > 0 ? [{ label: "State withheld", value: fmt(lState), mono: true }] : []),
              ...(lPreTax > 0 ? [{ label: "Pre-tax", value: fmt(lPreTax), mono: true }] : []),
              ...(l401 > 0 ? [{ label: "401(k)", value: fmt(l401), mono: true }] : []),
              ...(lHsa > 0 ? [{ label: "HSA", value: fmt(lHsa), mono: true }] : []),
              ...(lHealth > 0 ? [{ label: "Healthcare", value: fmt(lHealth), mono: true }] : []),
              ...(lOther > 0 ? [{ label: "Other deductions", value: fmt(lOther), mono: true }] : []),
              ...(lReserve > 0 ? [{ label: "Amount saved for taxes", value: fmt(lReserve), mono: true }] : []),
            ],
          });
        } else if (isIncomeTx) {
          // No linked income_entries row — still resolve Net Received through
          // the shared helper so an imported Plaid sibling (or denormalized
          // linked_plaid_amount) shows the actual bank deposit.
          const gAmt = Math.abs(Number(tx.amount) || 0);
          const nAmt = resolveNetReceived({
            gross: gAmt,
            siblingAmount: lSiblingAmt,
            linkedPlaidAmount: lLinkedPlaidAmt,
          });
          sections.push({
            title: "Tax details",
            fields: [
              { label: "Gross", value: fmt(gAmt), mono: true },
              { label: "Net received", value: fmt(nAmt), mono: true },
            ],
          });
        }

        const badges = [];
        if (tx.needs_review) badges.push({ label: "Review", tone: "warning" as const });
        if ((tx as any).origin_type === "planner_converted") badges.push({ label: "From Planner", tone: "success" as const });
        if (source === "plaid") badges.push({ label: "Imported", tone: "muted" as const });
        else if (source === "merged") badges.push({ label: "Linked", tone: "default" as const });
        else badges.push({ label: "Manual", tone: "muted" as const });
        if (linked) badges.push({ label: "Matched", tone: "success" as const });
        return (
          <TransactionDetailSheet
            open={!!detailTx}
            onOpenChange={(o) => { if (!o) setDetailTx(null); }}
            header={{
              title: tx.vendor || "(No payee)",
              subtitle: getTransactionCompanyLabel(tx),
              date: formatDate(tx.transaction_date),
              amount: Math.abs(Number(tx.amount) || 0),
              amountTone: isIncomeTx ? "income" : isTransferTx ? "neutral" : "expense",
              badges,
            }}
            sections={sections}
            extraContent={
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Receipts
                </h3>
                <TransactionAttachments
                  transactionId={tx.id}
                  companyId={(tx as any).source_id || null}
                  label="Receipts"
                />
                {linkedSiblings.length > 0 && (
                  <div className="space-y-2">
                    {linkedSiblings.map((it) => (
                      <SiblingReceiptsList
                        key={it.transaction.id}
                        transactionId={it.transaction.id}
                        label={it.transaction.vendor || "(No payee)"}
                      />
                    ))}
                  </div>
                )}
              </section>
            }
            linked={{
              items: linkedSiblings.map((it) => ({
                id: it.itemId,
                label: it.transaction.vendor || "(No payee)",
                amount: Math.abs(it.transaction.amount),
                date: formatDateShort(it.transaction.transaction_date),
              })),
              onUnlink: tx.linked_group_id
                ? (itemId) => unlinkMatchGroupItem.mutate({ itemId, groupId: tx.linked_group_id! })
                : undefined,
              onLink: () => { setDetailTx(null); enterMobileSelectionWith(tx.id); },
            }}
            onEdit={() => { const t = tx; setDetailTx(null); openEdit(t); }}
            onDelete={() => { setDetailTx(null); confirmDelete(tx.id); }}
            needsReview={!!tx.needs_review}
            markReviewedPending={updateMutation.isPending}
            onMarkReviewed={() => {
              updateMutation.mutate(
                { id: tx.id, needs_review: false } as any,
                {
                  onSuccess: () => {
                    setDetailTx((curr) => (curr && curr.id === tx.id ? { ...curr, needs_review: false } : curr));
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
