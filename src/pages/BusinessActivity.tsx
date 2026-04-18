import { useState, useMemo } from "react";
import { ExpenseCategoryCombobox, mapLegacyCategory } from "@/components/ExpenseCategoryCombobox";
import { useTransactions, useDeleteTransaction, useAddTransaction, useUpdateTransaction, useBulkUpdateTransactions, useBulkDeleteTransactions, TRANSFER_SUBTYPES, type DbTransaction } from "@/hooks/useTransactions";
import { useAddIncome, useUpdateIncome, type IncomeEntry } from "@/hooks/useIncome";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";
import { useQueryClient } from "@tanstack/react-query";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useWithholdingRecommendation } from "@/hooks/useWithholdingRecommendation";
import { useIncomeRecommendation, type IncomeRecommendation } from "@/hooks/useIncomeRecommendation";
import { RecommendationModal } from "@/components/RecommendationModal";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { useSuggestedMatches, useLinkTransactions } from "@/hooks/useTransactionMatching";
import SuggestedMatches from "@/components/SuggestedMatches";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Plus, Trash2, Download, MoreHorizontal, Pencil, DollarSign, Link2, Unlink, AlertCircle, Building2, Tag, EyeOff, CheckCircle2, ArrowLeftRight, ChevronDown, ChevronRight, Receipt, Lock } from "lucide-react";
import { LedgerRow, MonthHeader, groupByMonth, type LedgerRowBadge } from "@/components/LedgerRow";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompanies } from "@/contexts/CompanyContext";
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

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const num = (v: string) => parseFloat(v) || 0;

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
  pre_tax_deductions: string;
  retirement_401k: string;
  owner_healthcare: string;
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
  pre_tax_deductions: "",
  retirement_401k: "",
  owner_healthcare: "",
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
    "owner_healthcare","actual_withholding","additional_tax_reserve",
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
  notes: "",
  is_transfer: false,
  transfer_subtype: "",
};

export default function Transactions() {
  const { companies } = useCompanies();
  const queryClient = useQueryClient();
  const { data: transactions = [], isLoading } = useTransactions();
  const deleteMutation = useDeleteTransaction();
  const addMutation = useAddTransaction();
  const updateMutation = useUpdateTransaction();
  const bulkUpdateMutation = useBulkUpdateTransactions();
  const bulkDeleteMutation = useBulkDeleteTransactions();
  const linkMutation = useLinkTransactions();
  const addIncomeMutation = useAddIncome();
  const updateIncomeMutation = useUpdateIncome();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: taxSettings } = useTaxSettings();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<"all" | "manual" | "plaid" | "merged">("all");
  const [filterReview, setFilterReview] = useState<"all" | "needs_review">("all");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  const [hideLinkedDupes, setHideLinkedDupes] = useState(true);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCompany, setBulkCompany] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [showBulkCategory, setShowBulkCategory] = useState(false);

  // Suggested matches (pass income entries for net-amount matching)
  const suggestions = useSuggestedMatches(transactions, incomeEntries);

  // ─── Income modal state ───
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [incomeForm, setIncomeForm] = useState<IncomeFormState>(emptyIncomeForm);
  const [editingIncomeTxId, setEditingIncomeTxId] = useState<string | null>(null);
  const [editingIncomeEntryId, setEditingIncomeEntryId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // ─── Expense modal state ───
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(emptyExpenseForm);
  const [editingExpenseTxId, setEditingExpenseTxId] = useState<string | null>(null);

  // Delete
  const [deleteTxId, setDeleteTxId] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Recommendation modal (Modal 2) state
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [savedEntryTitle, setSavedEntryTitle] = useState("");
  const [currentRecommendation, setCurrentRecommendation] = useState<IncomeRecommendation | null>(null);

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

  // Business Activity: only show non-W2 companies (1099, K-1, S-Corp, Other)
  const allCompanyNames = useMemo(() => {
    return [...new Set(
      companies.filter((c) => !isW2FilingType(c.companyType)).map((c) => c.name)
    )].sort();
  }, [companies]);

  const getCompanyType = (name: string): FilingType =>
    normalizeFilingType(companies.find((c) => c.name === name)?.companyType);

  /**
   * Resolved per-company toggle visibility for the currently-selected
   * company in the income form. Used to decide which advanced fields render.
   * Falls back to filing-type defaults if the company has no saved overrides.
   */
  const visibleFields = useMemo<Record<ToggleKey, boolean>>(() => {
    const company = companies.find((c) => c.name === incomeForm.company);
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
      ["owner_healthcare", (linkedEntry as any)?.owner_healthcare || 0],
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




  // Filtered list
  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (search && !t.vendor.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterType !== "all" && (t.transaction_type || "expense") !== filterType) return false;
      if (filterCompany !== "all" && t.entity !== filterCompany) return false;
      if (filterSource !== "all" && (t.source_type || "manual") !== filterSource) return false;
      if (filterReview === "needs_review" && !t.needs_review) return false;
      if (filterDateFrom && t.transaction_date < filterDateFrom) return false;
      if (filterDateTo && t.transaction_date > filterDateTo) return false;
      if (hideLinkedDupes && t.match_status === "linked" && t.is_deleted) return false;
      return true;
    });
  }, [transactions, search, filterType, filterCompany, filterSource, filterReview, filterDateFrom, filterDateTo, hideLinkedDupes]);

  const needsReviewCount = useMemo(() =>
    transactions.filter((t) => t.needs_review && !t.is_deleted).length
  , [transactions]);

  const companyFilterOptions = useMemo(() => {
    const names = new Set(transactions.map((t) => t.entity).filter(Boolean));
    return [...names].sort();
  }, [transactions]);

  // --- Smart withholding recommendation engine ---
  const { getRecommendation } = useWithholdingRecommendation();
  const grossIncome = num(incomeForm.gross_amount);
  const recommendation = useMemo(() => {
    if (grossIncome <= 0) return null;
    return getRecommendation({
      grossIncome,
      incomeType: incomeForm.income_type,
      taxesAlreadyWithheld: num(incomeForm.taxes_withheld),
      retirement401k: num(incomeForm.retirement_401k),
      preTaxDeductions: num(incomeForm.pre_tax_deductions),
      alreadyIncludedInEstimate: isEditingIncome,
    });
  }, [grossIncome, incomeForm.income_type, incomeForm.taxes_withheld, incomeForm.retirement_401k, incomeForm.pre_tax_deductions, getRecommendation, isEditingIncome]);
  const recommendedWithholding = recommendation?.recommendedWithholding ?? 0;

  const calculatedNet = useMemo(() => {
    if (grossIncome <= 0) return 0;
    return Math.max(0, grossIncome - num(incomeForm.taxes_withheld) - num(incomeForm.pre_tax_deductions) - num(incomeForm.retirement_401k) - num(incomeForm.owner_healthcare));
  }, [grossIncome, incomeForm.taxes_withheld, incomeForm.pre_tax_deductions, incomeForm.retirement_401k, incomeForm.owner_healthcare]);

  // ─── Open Income Add ───
  function openAddIncome() {
    setIncomeForm(emptyIncomeForm);
    setEditingIncomeTxId(null);
    setEditingIncomeEntryId(null);
    setLinkedEntry(null);
    setAdvancedOpen(false);
    setShowIncomeForm(true);
  }

  // ─── Open Expense Add ───
  function openAddExpense() {
    setExpenseForm(emptyExpenseForm);
    setEditingExpenseTxId(null);
    setShowExpenseForm(true);
  }

  // ─── Open Edit (routes to correct modal) ───
  function openEdit(tx: DbTransaction) {
    const txType = (tx.transaction_type || "expense") as string;
    const linked = txType === "income" ? incomeByLinkedTx.get(tx.id) : null;

    if (txType === "income") {
      setIncomeForm({
        date: tx.transaction_date,
        name: tx.vendor,
        company: linked?.company || tx.entity || "",
        income_type: normalizeFilingType(linked?.income_type || tx.company_type || "1099_schedule_c"),
        gross_amount: linked ? String(linked.paycheck_amount) : String(tx.amount),
        net_received: linked && linked.deposited_amount ? String(linked.deposited_amount) : "",
        taxes_withheld: linked ? String(linked.taxes_withheld) : "",
        pre_tax_deductions: linked ? String(linked.pre_tax_deductions) : "",
        retirement_401k: linked ? String(linked.retirement_401k) : "",
        owner_healthcare: linked ? String((linked as any).owner_healthcare || 0) : "",
        federal_withholding: linked ? String((linked as any).federal_withholding || 0) : "",
        state_withholding: linked ? String((linked as any).state_withholding || 0) : "",
        ss_withholding: linked ? String((linked as any).ss_withholding || 0) : "",
        medicare_withholding: linked ? String((linked as any).medicare_withholding || 0) : "",
        actual_withholding: String((tx as any).actual_withholding || ""),
        additional_tax_reserve: linked ? String((linked as any).additional_tax_reserve || 0) : "0",
        notes: tx.notes || "",
      });
      setEditingIncomeTxId(tx.id);
      setEditingIncomeEntryId(linked?.id || null);
      setLinkedEntry(linked || null);
      // Auto-expand Advanced when any saved advanced value exists
      const hasAdvanced =
        linked &&
        (linked.taxes_withheld > 0 ||
          linked.pre_tax_deductions > 0 ||
          linked.retirement_401k > 0 ||
          linked.deposited_amount > 0 ||
          (linked as any).owner_healthcare > 0 ||
          (linked as any).federal_withholding > 0 ||
          (linked as any).state_withholding > 0 ||
          (linked as any).additional_tax_reserve > 0 ||
          ((tx as any).actual_withholding || 0) > 0);
      setAdvancedOpen(!!hasAdvanced);
      setShowIncomeForm(true);
    } else {
      setExpenseForm({
        date: tx.transaction_date,
        name: tx.vendor,
        company: tx.entity || "",
        amount: String(Math.abs(tx.amount)),
        category: tx.category,
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
    const taxWithheld = preserve("taxes_withheld", num(incomeForm.taxes_withheld), linkedEntry?.taxes_withheld || 0);
    const preTaxDed = preserve("pre_tax_deductions", num(incomeForm.pre_tax_deductions), linkedEntry?.pre_tax_deductions || 0);
    const retirement = preserve("retirement_401k", num(incomeForm.retirement_401k), linkedEntry?.retirement_401k || 0);
    const healthcare = preserve("owner_healthcare", num(incomeForm.owner_healthcare), (linkedEntry as any)?.owner_healthcare || 0);
    const companyType = incomeForm.income_type || getCompanyType(incomeForm.company);

    // Determine the correct amount for the transactions table:
    // If user entered Net Received, use that; otherwise use Gross Income.
    const txAmount = depositedAmt > 0 ? depositedAmt : paycheckAmt;

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
        entity: incomeForm.company || "Unassigned",
        company_type: companyType,
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
            stateWithheld: 0,
            retirement401k: retirement,
            preTaxDeductions: preTaxDed,
          });
          if (editingIncomeEntryId) {
            updateIncomeMutation.mutate({
              id: editingIncomeEntryId,
              name: incomeForm.name,
              company: incomeForm.company,
              income_type: companyType,
              income_date: incomeForm.date,
              paycheck_amount: paycheckAmt,
              deposited_amount: depositedAmt,
              taxes_withheld: effectiveWithheld,
              pre_tax_deductions: preTaxDed,
              retirement_401k: retirement,
              owner_healthcare: healthcare,
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
                const { error } = await supabase.from("income_entries").insert({
                  user_id: user.id,
                  organization_id: orgId,
                  name: incomeForm.name,
                  company: incomeForm.company,
                  income_type: toCanonicalIncomeType(companyType),
                  income_date: incomeForm.date,
                  paycheck_amount: paycheckAmt,
                  deposited_amount: depositedAmt,
                  taxes_withheld: effectiveWithheld,
                  pre_tax_deductions: preTaxDed,
                  retirement_401k: retirement,
                  owner_healthcare: healthcare,
                  notes: incomeForm.notes,
                  status: "received",
                  linked_transaction_id: editingIncomeTxId,
                  additional_tax_reserve: num(incomeForm.additional_tax_reserve),
                  base_tax_estimate: rec?.baseTaxEstimate || 0,
                  dynamic_tax_recommendation: rec?.dynamicTaxRecommendation || 0,
                  quarterly_adjustment_amount: rec?.quarterlyAdjustmentAmount || 0,
                  recommendation_status: rec?.recommendationStatus || "on_track",
                } as any);
                if (error) {
                  console.error("[saveIncome] Failed to create income_entry", error);
                  toast.error("Saved transaction but failed to save detailed fields");
                } else {
                  console.log("[saveIncome] Created new income_entry for tx", editingIncomeTxId);
                  queryClient.invalidateQueries({ queryKey: ["income_entries"] });
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
        stateWithheld: 0,
        retirement401k: retirement,
        preTaxDeductions: preTaxDed,
      });

      const payload: Partial<IncomeEntry> = {
        name: incomeForm.name,
        company: incomeForm.company,
        income_type: companyType,
        income_date: incomeForm.date,
        paycheck_amount: paycheckAmt,
        deposited_amount: depositedAmt,
        taxes_withheld: taxWithheld,
        pre_tax_deductions: preTaxDed,
        retirement_401k: retirement,
        owner_healthcare: healthcare,
        notes: incomeForm.notes,
        base_tax_estimate: rec?.baseTaxEstimate || 0,
        dynamic_tax_recommendation: rec?.dynamicTaxRecommendation || 0,
        quarterly_adjustment_amount: rec?.quarterlyAdjustmentAmount || 0,
        additional_tax_reserve: num(incomeForm.additional_tax_reserve),
        recommendation_status: rec?.recommendationStatus || "on_track",
      } as any;

      const showModal2 = isFeatureEnabled("recommendation_modal");

      addIncomeMutation.mutate(payload, {
        onSuccess: () => {
          if (showModal2 && rec) {
            setSavedEntryTitle(incomeForm.name);
            setCurrentRecommendation(rec);
            setShowRecommendation(true);
          }
        },
      });
    }

    setShowIncomeForm(false);
    setIncomeForm(emptyIncomeForm);
    setEditingIncomeTxId(null);
    setEditingIncomeEntryId(null);
  }

  // ─── Save Expense / Transfer ───
  function saveExpense() {
    if (!expenseForm.name.trim() || !expenseForm.date) return;
    const amount = num(expenseForm.amount);
    if (amount === 0) return;
    if (!expenseForm.is_transfer && !expenseForm.company) { toast.error("Please select a company"); return; }

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
          entity: expenseForm.company || "Unassigned",
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
          entity: expenseForm.company || "Unassigned",
          excluded_from_reports: true,
        } as any);
      }
    } else {
      if (isEditingExpense) {
        updateMutation.mutate({
          id: editingExpenseTxId!,
          transaction_date: expenseForm.date,
          vendor: expenseForm.name,
          amount,
          category: expenseForm.category,
          notes: expenseForm.notes,
          entity: expenseForm.company || "Unassigned",
        } as any);
      } else {
        addMutation.mutate({
          transaction_date: expenseForm.date,
          vendor: expenseForm.name,
          amount,
          category: expenseForm.category,
          notes: expenseForm.notes,
          transaction_type: "expense",
          entity: expenseForm.company || "Unassigned",
        });
      }
    }

    setShowExpenseForm(false);
    setExpenseForm(emptyExpenseForm);
    setEditingExpenseTxId(null);
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
    const headers = ["Date", "Transaction", "Amount", "Type", "Category"];
    const rows = filtered.map((t) => {
      const type = (t.transaction_type || "expense");
      const displayAmt = type === "expense" ? -Math.abs(t.amount) : Math.abs(t.amount);
      const typeLabel = type === "income" ? "Income" : type === "transfer" ? "Transfer" : "Expense";
      return [t.transaction_date, t.vendor, displayAmt, typeLabel, t.category];
    });
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const summaryStats = useMemo(() => {
    const revenue = filtered
      .filter((t) => t.transaction_type === "income" && !t.is_deleted)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const expenses = filtered
      .filter((t) => t.transaction_type === "expense" && !t.is_deleted)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    // Owner deductions from K-1 income entries (reduce taxable income, not profit)
    const ownerDeds = (incomeEntries || [])
      .filter((e) => normalizeFilingType(e.income_type) === "k1_partnership")
      .reduce((s, e) => s + Number((e as any).owner_healthcare || 0) + Number(e.retirement_401k || 0) + Number(e.pre_tax_deductions || 0), 0);
    return { revenue, expenses, profit: revenue - expenses, ownerDeductions: ownerDeds };
  }, [filtered, incomeEntries]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Business Activity</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={openAddExpense} className="gap-1.5">
            <Receipt className="h-3.5 w-3.5" /> Add Expense
          </Button>
          <Button size="sm" onClick={openAddIncome} className="gap-1.5">
            <DollarSign className="h-3.5 w-3.5" /> Add Income
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Total Business Revenue</p>
          <p className="text-xl font-bold text-card-foreground">{fmt(summaryStats.revenue)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Total Business Expenses</p>
          <p className="text-xl font-bold text-card-foreground">{fmt(summaryStats.expenses)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Business Profit</p>
          <p className={`text-xl font-bold ${summaryStats.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
            {fmt(summaryStats.profit)}
          </p>
        </div>
      </div>

      {/* Owner deductions summary (K-1 only) */}
      {summaryStats.ownerDeductions > 0 && (
        <div className="rounded-lg border border-border bg-accent/30 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-foreground">Owner Deductions / K-1 Adjustments</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Healthcare, retirement, & pre-tax deductions — reduce taxable income, not business profit</p>
            </div>
            <p className="text-lg font-bold text-foreground">{fmt(summaryStats.ownerDeductions)}</p>
          </div>
        </div>
      )}

      {/* Search + filter tabs */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search transactions…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
            {(["all", "income", "expense", "transfer"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterType(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                  filterType === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "all" ? "All" : tab === "income" ? "Income" : tab === "expense" ? "Expenses" : "Transfers"}
              </button>
            ))}
          </div>
        </div>
        {/* Company + date range filters */}
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap items-center">
          <Select value={filterCompany} onValueChange={setFilterCompany}>
            <SelectTrigger className="w-full sm:w-[180px] h-8 text-xs">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companyFilterOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterSource} onValueChange={(v) => setFilterSource(v as any)}>
            <SelectTrigger className="w-full sm:w-[150px] h-8 text-xs">
              <SelectValue placeholder="All Sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="plaid">Imported</SelectItem>
              <SelectItem value="merged">Linked</SelectItem>
            </SelectContent>
          </Select>
          {needsReviewCount > 0 && (
            <Button
              variant={filterReview === "needs_review" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setFilterReview(filterReview === "needs_review" ? "all" : "needs_review")}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              Needs Review ({needsReviewCount})
            </Button>
          )}
          <div className="flex gap-2 items-center">
            <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-8 text-xs w-[130px]" placeholder="From" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="h-8 text-xs w-[130px]" placeholder="To" />
            {(filterDateFrom || filterDateTo || filterCompany !== "all" || filterSource !== "all" || filterReview !== "all") && (
              <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => { setFilterCompany("all"); setFilterSource("all"); setFilterReview("all"); setFilterDateFrom(""); setFilterDateTo(""); }}>
                Clear
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Switch checked={hideLinkedDupes} onCheckedChange={setHideLinkedDupes} id="hide-dupes" />
            <Label htmlFor="hide-dupes" className="text-xs text-muted-foreground cursor-pointer">Hide linked duplicates</Label>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-30 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 shadow-sm">
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
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { entity: v, needs_review: false } as any });
              setBulkCompany("");
              setSelectedIds(new Set());
            }}>
              <SelectTrigger className="w-[160px] h-7 text-xs">
                <SelectValue placeholder="Assign Company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
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
            {selectedIds.size === 2 && (() => {
              const [id1, id2] = [...selectedIds];
              const tx1 = filtered.find((t) => t.id === id1);
              const tx2 = filtered.find((t) => t.id === id2);
              if (!tx1 || !tx2) return null;
              const src1 = tx1.source_type || "manual";
              const src2 = tx2.source_type || "manual";
              const oneManual = (src1 === "manual" && (src2 === "plaid" || src2 === "merged")) || (src2 === "manual" && (src1 === "plaid" || src1 === "merged"));
              const manualTx = src1 === "manual" ? tx1 : tx2;
              const plaidTx = src1 === "manual" ? tx2 : tx1;
              if (oneManual) {
                return (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
                    linkMutation.mutate({ manualTxId: manualTx.id, plaidTxId: plaidTx.id }, {
                      onSuccess: () => setSelectedIds(new Set()),
                    });
                  }} disabled={linkMutation.isPending}>
                    <Link2 className="h-3 w-3" /> Link Transactions
                  </Button>
                );
              }
              return (
                <span className="text-xs text-muted-foreground italic">Select one manual + one imported to link</span>
              );
            })()}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs whitespace-nowrap" onClick={() => setSelectedIds(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      {/* Suggested Matches */}
      <SuggestedMatches suggestions={suggestions} />

      {/* Banking-style table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Mobile Select All */}
        <div className="flex sm:hidden items-center gap-2 px-4 py-2 border-b border-border bg-muted/40">
          <Checkbox
            checked={selectedIds.size === filtered.length && filtered.length > 0 ? true : selectedIds.size > 0 ? "indeterminate" : false}
            onCheckedChange={() => {
              if (selectedIds.size === filtered.length) setSelectedIds(new Set());
              else setSelectedIds(new Set(filtered.map((t) => t.id)));
            }}
          />
          <span className="text-xs font-medium text-muted-foreground">Select All ({filtered.length})</span>
        </div>
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
              <div
                key={tx.id}
                className={`grid grid-cols-[28px_85px_1fr_85px_100px_65px_65px_95px_36px] gap-2 px-4 py-3 hover:bg-muted/30 transition-colors items-center ${
                  tx.needs_review ? "bg-amber-50/30 dark:bg-amber-950/10" : ""
                } ${isSelected ? "bg-primary/5" : ""}`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedIds);
                    if (checked) next.add(tx.id); else next.delete(tx.id);
                    setSelectedIds(next);
                  }}
                />
                <span className="text-sm text-muted-foreground tabular-nums">
                  {new Date(tx.transaction_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <div className="truncate">
                  <span className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                    {tx.vendor}
                    {tx.needs_review && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-400 text-amber-600 dark:text-amber-400">Review</Badge>
                    )}
                    {tx.excluded_from_reports && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted text-muted-foreground">Excluded</Badge>
                    )}
                  </span>
                  {isIncomeTx && tx.recommended_withholding > 0 && (
                    <span className="text-[10px] text-muted-foreground">Set aside: {fmt(tx.recommended_withholding)}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground truncate">
                  {tx.entity || "Unassigned"}
                </span>
                <span className={`text-sm font-semibold tabular-nums text-right ${isIncomeTx ? "text-emerald-600 dark:text-emerald-400" : isTransferTx ? "text-blue-600 dark:text-blue-400" : "text-foreground"}`}>
                  {isIncomeTx ? "+" : isTransferTx ? "" : ""}{fmt(displayAmount)}
                </span>
                <span className="text-center">
                  <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    isIncomeTx
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : isTransferTx
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {isIncomeTx ? "Income" : isTransferTx ? transferLabel : "Expense"}
                  </span>
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
                <span className="text-xs text-muted-foreground truncate">
                  {mapLegacyCategory(tx.category)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
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
                  const dateStr = new Date(tx.transaction_date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "numeric",
                    day: "numeric",
                    year: "2-digit",
                  });
                  const badges: LedgerRowBadge[] = [];
                  if (tx.needs_review) badges.push({ label: "Review", tone: "warning" });
                  if (tx.excluded_from_reports) badges.push({ label: "Excluded", tone: "muted" });
                  if (source === "merged") badges.push({ label: "Linked", tone: "info" });
                  if (isTransferTx) badges.push({ label: transferLabel, tone: "info" });

                  const subtitle = isIncomeTx ? "Income" : mapLegacyCategory(tx.category) || "Uncategorized";
                  const meta = tx.entity ? tx.entity : null;

                  return (
                    <LedgerRow
                      key={tx.id}
                      kind={kind}
                      title={tx.vendor || "(No payee)"}
                      subtitle={subtitle}
                      meta={meta}
                      date={dateStr}
                      amount={displayAmount}
                      amountTone={isIncomeTx ? "positive" : isTransferTx ? "neutral" : "neutral"}
                      amountPrefix={isIncomeTx ? "+" : isTransferTx ? "" : "-"}
                      badges={badges}
                      selected={selectedIds.has(tx.id)}
                      onClick={() => openEdit(tx)}
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

      {/* ═══════ ADD INCOME MODAL ═══════ */}
      <Dialog open={showIncomeForm} onOpenChange={(open) => { if (!open) { setShowIncomeForm(false); setEditingIncomeTxId(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{isEditingIncome ? "Edit Income" : "Add Income"}</DialogTitle>
          </DialogHeader>
          <TooltipProvider delayDuration={150}>
          <div className="space-y-4">
            {/* Core fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                <Input type="date" value={incomeForm.date} onChange={(e) => setIncomeForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Merchant / Payer</Label>
                <Input
                  placeholder="e.g. ED Shift Pay"
                  value={incomeForm.name}
                  onChange={(e) => setIncomeForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
                <Select
                  value={incomeForm.company}
                  disabled={isEditingIncome}
                  onValueChange={(v) => {
                    if (isEditingIncome) return;
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
                      owner_healthcare: "",
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
                    <SelectValue placeholder="Select company" />
                    {isEditingIncome && (
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
                    {allCompanyNames.map((c) => (
                      <SelectItem key={c} value={c}>{c} ({getCompanyType(c)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                />
                <p className="text-[10px] text-muted-foreground mt-1">Total income before taxes or deductions</p>
              </div>
            </div>

            {/* Recommended to Set Aside */}
            {grossIncome > 0 && recommendation && !recommendation.isOverWithheld && recommendedWithholding > 0 && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Recommended to set aside</p>
                  <p className="text-[11px] text-muted-foreground">{recommendation.methodLabel} · {recommendation.effectiveRate.toFixed(1)}% effective rate</p>
                </div>
                <span className="text-lg font-bold text-primary">{fmt(recommendedWithholding)}</span>
              </div>
            )}
            {grossIncome > 0 && recommendation && recommendation.isOverWithheld && (
              <div className="rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 p-3">
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  Employer over-withheld by <strong>{fmt(Math.abs(recommendedWithholding))}</strong> — consider adjusting your W-4.
                </p>
              </div>
            )}

            {/* Advanced details (collapsible) — fields driven by per-company toggles */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-1">
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
                      <Input type="number" min="0" step="0.01" placeholder={grossIncome > 0 ? fmt(calculatedNet) : "0.00"} value={incomeForm.net_received} onChange={(e) => setIncomeForm((f) => ({ ...f, net_received: e.target.value }))} />
                      <p className="text-[10px] text-muted-foreground mt-1">Amount deposited into your bank account</p>
                    </div>
                  )}
                  {showField("net_received") && grossIncome > 0 && (
                    <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
                      Estimated Net: <strong>{fmt(calculatedNet)}</strong> based on your inputs
                    </p>
                  )}

                  {(showField("taxes_withheld") || showField("federal_withholding") || showField("state_withholding") || showField("ss_withholding") || showField("medicare_withholding")) && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {showField("taxes_withheld") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">Taxes Withheld<LegacyNote field="taxes_withheld" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.taxes_withheld} onChange={(e) => setIncomeForm((f) => ({ ...f, taxes_withheld: e.target.value }))} placeholder="0.00" /></div>)}
                      {showField("federal_withholding") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">Federal W/H<LegacyNote field="federal_withholding" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.federal_withholding} onChange={(e) => setIncomeForm((f) => ({ ...f, federal_withholding: e.target.value }))} placeholder="0.00" /></div>)}
                      {showField("state_withholding") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">State W/H<LegacyNote field="state_withholding" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.state_withholding} onChange={(e) => setIncomeForm((f) => ({ ...f, state_withholding: e.target.value }))} placeholder="0.00" /></div>)}
                      {showField("ss_withholding") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">Social Security<LegacyNote field="ss_withholding" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.ss_withholding} onChange={(e) => setIncomeForm((f) => ({ ...f, ss_withholding: e.target.value }))} placeholder="0.00" /></div>)}
                      {showField("medicare_withholding") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">Medicare<LegacyNote field="medicare_withholding" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.medicare_withholding} onChange={(e) => setIncomeForm((f) => ({ ...f, medicare_withholding: e.target.value }))} placeholder="0.00" /></div>)}
                    </div>
                  )}

                  {(showField("retirement_401k") || showField("owner_healthcare") || showField("pre_tax_deductions")) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {showField("retirement_401k") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">Retirement / 401(k)<LegacyNote field="retirement_401k" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.retirement_401k} onChange={(e) => setIncomeForm((f) => ({ ...f, retirement_401k: e.target.value }))} placeholder="0.00" /></div>)}
                      {showField("owner_healthcare") && (<div><Label className="text-xs text-muted-foreground mb-1.5 block">Health Insurance<LegacyNote field="owner_healthcare" /></Label><Input type="number" min="0" step="0.01" value={incomeForm.owner_healthcare} onChange={(e) => setIncomeForm((f) => ({ ...f, owner_healthcare: e.target.value }))} placeholder="0.00" /></div>)}
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

            {!advancedOpen && showField("notes") && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                <Input placeholder="Optional" value={incomeForm.notes} onChange={(e) => setIncomeForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            )}


            <p className="text-[10px] text-muted-foreground italic">
              Withholding method controlled in Settings
            </p>

            {/* Actions */}
            <div className="flex justify-between">
              {isEditingIncome ? (
                <Button variant="destructive" size="sm" onClick={() => confirmDelete(editingIncomeTxId!)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowIncomeForm(false)}>Cancel</Button>
                <Button onClick={saveIncome} disabled={!incomeForm.name.trim() || !incomeForm.date || grossIncome <= 0}>
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
                <Input type="date" value={expenseForm.date} onChange={(e) => setExpenseForm((f) => ({ ...f, date: e.target.value }))} />
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
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.name}>{c.name} ({c.companyType})</SelectItem>
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
                <ExpenseCategoryCombobox value={expenseForm.category} onValueChange={(v) => setExpenseForm((f) => ({ ...f, category: v }))} />
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

      {/* Smart Recommendation Modal (Modal 2) */}
      <RecommendationModal
        open={showRecommendation}
        onClose={() => { setShowRecommendation(false); setCurrentRecommendation(null); }}
        onApplyRecommendation={() => {
          if (currentRecommendation && currentRecommendation.recommendedAdditionalReserve > 0 && incomeEntries?.length) {
            const latestEntry = incomeEntries[0];
            if (latestEntry) {
              updateIncomeMutation.mutate({
                id: latestEntry.id,
                additional_tax_reserve: currentRecommendation.recommendedAdditionalReserve,
              } as any);
            }
          }
          setShowRecommendation(false);
          setCurrentRecommendation(null);
        }}
        recommendation={currentRecommendation}
        entryTitle={savedEntryTitle}
      />

      {/* Bulk Category Assignment Dialog */}
      <Dialog open={showBulkCategory} onOpenChange={setShowBulkCategory}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Category to {selectedIds.size} transactions</DialogTitle>
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
    </div>
  );
}
