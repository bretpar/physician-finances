import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Trash2, Pencil, ChevronDown, ChevronRight,
  DollarSign, TrendingUp, Calendar, PiggyBank, Shield,
  X, RotateCcw, CheckCircle2, AlertCircle, Link2, ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/DateField";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { useCompanies } from "@/contexts/CompanyContext";
import { TransactionDetailSheet, type DetailSection } from "@/components/TransactionDetailSheet";
import { formatDate } from "@/lib/localDate";
import { DuplicateConversionsReview } from "@/components/DuplicateConversionsReview";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTransactions } from "@/hooks/useTransactions";
import { useAddIncome } from "@/hooks/useIncome";
import { useAddPersonalIncome } from "@/hooks/usePersonalIncome";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  useProjectedStreams, useProjectedBonuses, useStreamOverrides,
  useAddStream, useUpdateStream, useDeleteStream,
  useAddBonus, useDeleteBonus, useUpdateBonus,
  useAddOverride, useDeleteOverride,
  usePlannerConversions, useConfirmSuggestedMatch,
  generateProjectedPaychecks, getProjectedTotals,
  isStreamExpired,
  type ProjectedIncomeStream, type ProjectedPaycheck, type ProjectedIncomeOverride,
} from "@/hooks/useProjectedIncome";
import {
  SourceEmployerCombobox, persistNewSourceIfRequested,
} from "@/components/SourceEmployerCombobox";
import { useCreateIncomeSource, type SourceKind } from "@/hooks/useIncomeSources";
import {
  normalizeFilingType,
  resolveAdvancedVisibility,
  toCanonicalIncomeType,
  type ToggleKey,
} from "@/lib/filingTypes";
import { ledgerForIncomeType } from "@/lib/ledgerRouting";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { filterIncomeTypeOptions, isIncomeEntryTypeDisabled } from "@/lib/householdIncomeProfile";
import { TotalFederalTaxField } from "@/components/TotalFederalTaxField";
import { getCanonicalTotalFederalPayrollTaxes } from "@/lib/federalWithholding";
import { deriveUserTypeFromIncomeStreams, getFeatureAccess } from "@/lib/entitlements";
import { subscriptionTierToEntitlementTier } from "@/lib/onboarding";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtFull = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PAY_FREQUENCIES = [
  { value: "single", label: "One-time" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

/** All UI subtypes supported across both ledgers — preserved for transfer fidelity. */
const INCOME_SUBTYPES = [
  // Personal
  { value: "w2_user", label: "W-2 Income (You)", filingType: "w2" as const },
  { value: "w2_partner", label: "W-2 Income (Partner)", filingType: "w2" as const },
  { value: "short_term_gain", label: "Short-Term Capital Gain", filingType: "other" as const },
  { value: "long_term_gain", label: "Long-Term Capital Gain", filingType: "other" as const },
  { value: "dividend", label: "Dividend", filingType: "other" as const },
  { value: "interest", label: "Interest", filingType: "other" as const },
  { value: "rental", label: "Rental Income", filingType: "other" as const },
  { value: "other_income", label: "Other Income", filingType: "other" as const },
  { value: "loss", label: "Loss", filingType: "other" as const },
  // Business
  { value: "1099_schedule_c", label: "1099 / Schedule C", filingType: "1099_schedule_c" as const },
  { value: "k1_partnership", label: "K-1 Partnership", filingType: "k1_partnership" as const },
  { value: "scorp_w2", label: "S-Corp W-2 Wages", filingType: "scorp_w2" as const },
  { value: "scorp_distribution", label: "S-Corp Distribution", filingType: "scorp_distribution" as const },
];

const VALID_SUBTYPES = new Set(INCOME_SUBTYPES.map((t) => t.value));
const subtypeMeta = (v: string) => INCOME_SUBTYPES.find((t) => t.value === v);

interface StreamForm {
  company: string;
  source_id: string | null;
  source_name: string;
  source_save_as_new: boolean;
  source_new_kind: SourceKind | null;
  ui_income_subtype: string;
  pay_frequency: string;
  custom_interval_days: string;
  start_date: string;
  end_date: string;
  paycheck_amount: string;
  taxes_withheld: string;
  federal_withholding: string;
  state_withholding: string;
  ss_withholding: string;
  medicare_withholding: string;
  total_federal_payroll_taxes: string;
  retirement_401k: string;
  healthcare_deduction: string;
  hsa_contribution: string;
  pre_tax_deductions: string;
  additional_tax_reserve: string;
  forecast_expense_per_period: string;
  forecast_expense_notes: string;
  notes: string;
  is_active: boolean;
  include_in_tax: boolean;
}

interface OverrideForm {
  paycheck_amount: string;
  taxes_withheld: string;
  retirement_401k: string;
  pre_tax_deductions: string;
  notes: string;
  new_date: string;
}

const emptyForm = (monthIdx?: number): StreamForm => {
  const now = new Date();
  const year = now.getFullYear();
  const month = monthIdx !== undefined ? monthIdx : now.getMonth();
  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-15`;
  return {
    company: "",
    source_id: null,
    source_name: "",
    source_save_as_new: false,
    source_new_kind: null,
    ui_income_subtype: "w2_user",
    pay_frequency: "biweekly",
    custom_interval_days: "14",
    start_date: dateStr,
    end_date: "",
    paycheck_amount: "",
    taxes_withheld: "",
    federal_withholding: "",
    state_withholding: "",
    ss_withholding: "",
    medicare_withholding: "",
    total_federal_payroll_taxes: "",
    retirement_401k: "",
    healthcare_deduction: "",
    hsa_contribution: "",
    pre_tax_deductions: "",
    additional_tax_reserve: "",
    forecast_expense_per_period: "",
    forecast_expense_notes: "",
    notes: "",
    is_active: true,
    include_in_tax: true,
  };
};

/** Map a saved stream's stored subtype back to a valid UI Select value. */
function hydrateSubtype(s: ProjectedIncomeStream): string {
  const ui = s.ui_income_subtype;
  if (ui && VALID_SUBTYPES.has(ui)) return ui;
  // Fallback from canonical company_type for legacy rows.
  const t = (s.company_type || "").toLowerCase().trim();
  if (t === "w2" || t === "w2_user") return "w2_user";
  if (t === "w2_partner") return "w2_partner";
  if (t === "1099" || t === "1099_schedule_c") return "1099_schedule_c";
  if (t === "k1" || t === "k1_partnership") return "k1_partnership";
  if (t === "scorp_w2") return "scorp_w2";
  if (t === "scorp_distribution") return "scorp_distribution";
  return "w2_user";
}

/** Map a SourceKind to a sensible default UI subtype when picking a new source. */
function defaultSubtypeForSourceKind(kind: SourceKind | undefined): string | null {
  if (!kind) return null;
  if (kind === "w2_employer") return "w2_user";
  if (kind === "personal") return "other_income";
  if (kind === "1099_schedule_c") return "1099_schedule_c";
  if (kind === "k1_partnership") return "k1_partnership";
  if (kind === "s_corp") return "scorp_w2";
  if (kind === "other_business") return "1099_schedule_c";
  return null;
}

export default function ProjectedIncome() {
  const navigate = useNavigate();
  const { companies } = useCompanies();
  const { data: streams, isLoading: streamsLoading } = useProjectedStreams();
  const { data: bonuses, isLoading: bonusesLoading } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { data: plannerConversions } = usePlannerConversions();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: businessTransactions } = useTransactions();
  const { data: taxSettings } = useTaxSettings();
  const { forecastEstimate, forecastDebug } = useTaxEstimate();

  const addStream = useAddStream();
  const updateStream = useUpdateStream();
  const deleteStream = useDeleteStream();
  const addOverride = useAddOverride();
  const deleteOverride = useDeleteOverride();
  const confirmSuggested = useConfirmSuggestedMatch();
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const deleteBonus = useDeleteBonus();
  const updateBonus = useUpdateBonus();
  const addIncome = useAddIncome();
  const addPersonalIncome = useAddPersonalIncome();
  const createSource = useCreateIncomeSource();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StreamForm>(emptyForm());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [detailEntry, setDetailEntry] = useState<ProjectedPaycheck | null>(null);
  const [convertTarget, setConvertTarget] = useState<ProjectedPaycheck | null>(null);
  const [convertDestination, setConvertDestination] = useState<"business" | "personal">("business");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showSourceError, setShowSourceError] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(() => {
    const current = new Date().getMonth();
    return new Set([current]);
  });
  const [showPreviousMonths, setShowPreviousMonths] = useState(false);

  // Override edit state
  const [overrideTarget, setOverrideTarget] = useState<{ streamId: string; date: string } | null>(null);
  const [overrideForm, setOverrideForm] = useState<OverrideForm>({
    paycheck_amount: "", taxes_withheld: "", retirement_401k: "", pre_tax_deductions: "", notes: "", new_date: "",
  });

  // Bonus edit state
  const [bonusEditTarget, setBonusEditTarget] = useState<{ id: string; streamId: string } | null>(null);
  const [bonusEditForm, setBonusEditForm] = useState<{ name: string; amount: string; taxes_withheld: string; scheduled_date: string }>({
    name: "", amount: "", taxes_withheld: "", scheduled_date: "",
  });
  const [bonusDeleteConfirm, setBonusDeleteConfirm] = useState<{ id: string; label: string } | null>(null);
  const [mobileActionsEntry, setMobileActionsEntry] = useState<ProjectedPaycheck | null>(null);
  const [mobileSkipConfirm, setMobileSkipConfirm] = useState<ProjectedPaycheck | null>(null);

  const num = (v: string) => parseFloat(v) || 0;
  const companyNames = useMemo(() => companies.map((c) => c.name).sort(), [companies]);
  const userType = deriveUserTypeFromIncomeStreams(taxSettings?.householdIncomeStreams);
  const isW2Only = userType === "W2_ONLY";
  const featureAccess = getFeatureAccess(userType, subscriptionTierToEntitlementTier(taxSettings?.subscriptionTier));
  const spouseW2Locked = featureAccess.spouseW2Support?.status === "locked";
  const multipleW2Locked = featureAccess.multipleW2Jobs?.status === "locked";

  // Income entries for matching (replaces the old date-only filtering)
  const incomeEntriesForMatching = useMemo(() => {
    return incomeEntries || [];
  }, [incomeEntries]);

  // Build an override lookup for finding existing override IDs
  const overrideLookup = useMemo(() => {
    const map = new Map<string, ProjectedIncomeOverride>();
    if (overrides) {
      for (const o of overrides) {
        // Index by anchor (override_date) AND by display date (new_date) when moved,
        // so ledger rows showing at the moved date can still find their override.
        map.set(`${o.stream_id}:${o.override_date}`, o);
        if (o.new_date) map.set(`${o.stream_id}:${o.new_date}`, o);
      }
    }
    return map;
  }, [overrides]);

  // Map business transactions to the matchable shape (income-typed only —
  // mirrors the bucket router in generateProjectedPaychecks).
  const businessTxsForMatching = useMemo(() => {
    if (!businessTransactions) return [];
    return businessTransactions
      .filter((t) => t.transaction_type === "income")
      .map((t) => ({
        id: t.id,
        transaction_date: t.transaction_date,
        vendor: t.vendor,
        amount: Number(t.amount),
        source_id: t.source_id,
        status: t.status,
        transaction_type: t.transaction_type,
        origin_type: (t as any).origin_type ?? null,
        origin_planner_conversion_id: (t as any).origin_planner_conversion_id ?? null,
      }));
  }, [businessTransactions]);

  const projectedPaychecks = useMemo(() => {
    if (!streams || !bonuses) return [];
    return generateProjectedPaychecks(streams, bonuses, incomeEntriesForMatching, overrides || [], plannerConversions || [], businessTxsForMatching);
  }, [streams, bonuses, incomeEntriesForMatching, overrides, plannerConversions, businessTxsForMatching]);

  const projectedTotals = useMemo(() => getProjectedTotals(projectedPaychecks), [projectedPaychecks]);

  const actualYTD = useMemo(() => {
    if (!incomeEntries) return { income: 0, withheld: 0, retirement: 0, deductions: 0 };
    const year = new Date().getFullYear();
    const ytd = incomeEntries.filter((e) => e.income_date.startsWith(String(year)));
    return {
      income: ytd.reduce((s, e) => s + Number(e.paycheck_amount), 0),
      withheld: ytd.reduce((s, e) => s + Number(e.taxes_withheld), 0),
      retirement: ytd.reduce((s, e) => s + Number(e.retirement_401k), 0),
      deductions: ytd.reduce((s, e) => s + Number(e.pre_tax_deductions), 0),
    };
  }, [incomeEntries]);

  const byMonth = useMemo(() => {
    const map = new Map<number, ProjectedPaycheck[]>();
    for (let i = 0; i < 12; i++) map.set(i, []);
    projectedPaychecks.forEach((p) => {
      const month = parseInt(p.date.split("-")[1], 10) - 1;
      map.get(month)?.push(p);
    });
    return map;
  }, [projectedPaychecks]);

  const localExpectedAnnual = actualYTD.income + projectedTotals.grossIncome;
  // Use centralized tax-engine total when available so this matches Dashboard
  // (includes investments, personal/W-2, business, and planned income).
  const expectedAnnual = forecastDebug?.totalGrossIncome ?? localExpectedAnnual;
  const projectedWithholding = actualYTD.withheld + projectedTotals.taxesWithheld;
  const projected401k = actualYTD.retirement + projectedTotals.retirement401k;
  const projectedRefund = forecastDebug ? Math.max(0, forecastDebug.countedCreditsTotal - forecastDebug.totalEstimatedTax) : 0;
  const projectedGap = forecastDebug?.remainingTaxDue ?? 0;
  const visibleIncomeSubtypes = useMemo(() =>
    filterIncomeTypeOptions(INCOME_SUBTYPES, taxSettings?.householdIncomeStreams, form.ui_income_subtype),
    [taxSettings?.householdIncomeStreams, form.ui_income_subtype],
  );
  const subtypeIsDisabled = isIncomeEntryTypeDisabled(taxSettings?.householdIncomeStreams, form.ui_income_subtype);

  const toggleMonth = (m: number) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const setField = (key: keyof StreamForm, value: string | boolean) =>
    setForm((p) => ({ ...p, [key]: value }));

  /** Resolve which advanced fields to render — driven by selected company's
   *  Settings → Advanced tax settings. Falls back to filing-type defaults
   *  derived from the chosen UI subtype when no company is linked. */
  const visibleFields = useMemo<Record<ToggleKey, boolean>>(() => {
    const company = form.source_id
      ? companies.find((c) => c.id === form.source_id)
      : undefined;
    const meta = subtypeMeta(form.ui_income_subtype);
    const filingType = company?.companyType
      ? normalizeFilingType(company.companyType)
      : (meta?.filingType ?? normalizeFilingType(form.ui_income_subtype));
    return resolveAdvancedVisibility(filingType, company?.advancedFieldVisibility);
  }, [companies, form.source_id, form.ui_income_subtype]);
  const showField = (key: ToggleKey) => !!visibleFields[key];

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(false);
    setAdvancedOpen(false);
    setShowSourceError(false);
  };

  const openAddForMonth = (monthIdx: number) => {
    setForm(emptyForm(monthIdx));
    setEditingId(null);
    setAdvancedOpen(false);
    setShowSourceError(false);
    setShowForm(true);
  };

  const startEdit = (s: ProjectedIncomeStream) => {
    const subtype = hydrateSubtype(s);
    setForm({
      company: s.company,
      source_id: s.source_id ?? null,
      source_name: s.source_id ? "" : (s.company || ""),
      source_save_as_new: false,
      source_new_kind: null,
      ui_income_subtype: subtype,
      pay_frequency: s.pay_frequency,
      custom_interval_days: String(s.custom_interval_days || 14),
      start_date: s.start_date,
      end_date: s.end_date || "",
      paycheck_amount: String(s.paycheck_amount),
      taxes_withheld: String(s.taxes_withheld),
      federal_withholding: String(s.federal_withholding || 0),
      state_withholding: String(s.state_withholding || 0),
      ss_withholding: String(s.ss_withholding || 0),
      medicare_withholding: String(s.medicare_withholding || 0),
      // Canonical Total Federal Payroll Taxes (shared wrapper).
      total_federal_payroll_taxes: String(getCanonicalTotalFederalPayrollTaxes(s as any)),
      retirement_401k: String(s.retirement_401k),
      healthcare_deduction: String(s.healthcare_deduction || 0),
      hsa_contribution: String(s.hsa_contribution || 0),
      pre_tax_deductions: String(s.pre_tax_deductions),
      additional_tax_reserve: String(s.additional_tax_reserve || 0),
      forecast_expense_per_period: String(s.forecast_expense_per_period || 0),
      forecast_expense_notes: s.forecast_expense_notes || "",
      notes: s.notes || "",
      is_active: s.is_active,
      include_in_tax: s.include_in_tax,
    });
    setEditingId(s.id);
    setAdvancedOpen(false);
    setShowSourceError(false);
    setShowForm(true);
  };

  const isOneTime = form.pay_frequency === "single";
  const isW2Subtype = form.ui_income_subtype === "w2_user" || form.ui_income_subtype === "w2_partner";

  /** Validates the Source/Employer assignment. Required for W-2 subtypes,
   *  optional otherwise (matches Personal Income behavior). */
  function validateSource(): boolean {
    if (!isW2Subtype) return true;
    if (form.source_id) return true;
    if (form.source_name.trim()) {
      if (form.source_save_as_new && !form.source_new_kind) return false;
      return true;
    }
    return false;
  }

  const handleSubmit = async () => {
    if (num(form.paycheck_amount) <= 0) return;
    // Need either a linked source or a company name (or a valid W-2 source for W-2 subtypes)
    const hasIdentity = !!form.source_id || !!form.source_name.trim() || !!form.company.trim();
    if (!hasIdentity) return;
    if (!validateSource()) {
      setShowSourceError(true);
      return;
    }

    // Persist new source ONLY when the user opted-in via the
    // "Save this employer/source for future use" checkbox.
    let payloadSourceId = form.source_id;
    if (!payloadSourceId && form.source_save_as_new && form.source_name.trim()) {
      try {
        payloadSourceId = await persistNewSourceIfRequested(
          {
            otherName: form.source_name,
            saveAsNew: form.source_save_as_new,
            newSourceKind: form.source_new_kind,
          },
          createSource.mutateAsync,
        );
      } catch {
        return;
      }
    }

    // Resolve company display name
    const linkedCompany = payloadSourceId
      ? companies.find((c) => c.id === payloadSourceId)
      : undefined;
    const companyName =
      linkedCompany?.nickname ||
      linkedCompany?.name ||
      form.source_name.trim() ||
      form.company.trim();

    // Resolve canonical company_type from the linked company's filing type,
    // falling back to the subtype's filing type. Persists 4-letter canonical
    // for back-compat with the existing tax engine routing.
    const meta = subtypeMeta(form.ui_income_subtype);
    const filingType = linkedCompany?.companyType
      ? normalizeFilingType(linkedCompany.companyType)
      : (meta?.filingType ?? normalizeFilingType(form.ui_income_subtype));
    const canonical = toCanonicalIncomeType(filingType);

    const payload: Partial<ProjectedIncomeStream> = {
      company: companyName,
      company_type: canonical, // "w2" | "1099" | "k1" | "other" — used by tax engine routing
      source_id: payloadSourceId,
      ui_income_subtype: form.ui_income_subtype,
      pay_frequency: form.pay_frequency,
      custom_interval_days: form.pay_frequency === "custom" ? num(form.custom_interval_days) : null,
      start_date: form.start_date,
      end_date: isOneTime ? null : (form.end_date || null),
      paycheck_amount: num(form.paycheck_amount),
      // CANONICAL: taxes_withheld = total federal payroll taxes
      // (federal income tax + Social Security + Medicare). Read everywhere
      // via getTotalFederalPaid(). For W-2 streams we mirror the form's
      // total_federal_payroll_taxes here. For non-W-2 we keep the form's
      // taxes_withheld field.
      taxes_withheld: showField("federal_withholding")
        ? num(form.total_federal_payroll_taxes)
        : (showField("taxes_withheld")
            ? num(form.taxes_withheld)
            : num(form.federal_withholding)),
      // federal_withholding = federal income tax COMPONENT only
      // (NOT the combined total). Combined total lives in taxes_withheld.
      federal_withholding: showField("federal_withholding") ? num(form.federal_withholding) : 0,
      state_withholding: showField("state_withholding") ? num(form.state_withholding) : 0,
      ss_withholding: showField("ss_withholding") ? num(form.ss_withholding) : 0,
      medicare_withholding: showField("medicare_withholding") ? num(form.medicare_withholding) : 0,
      retirement_401k: showField("retirement_401k") ? num(form.retirement_401k) : 0,
      healthcare_deduction: showField("healthcare_deduction") ? num(form.healthcare_deduction) : 0,
      hsa_contribution: showField("hsa_contribution") ? num(form.hsa_contribution) : 0,
      pre_tax_deductions: showField("pre_tax_deductions") ? num(form.pre_tax_deductions) : 0,
      additional_tax_reserve: showField("additional_tax_reserve")
        ? num(form.additional_tax_reserve)
        : 0,
      notes: visibleFields.notes ? form.notes : "",
      forecast_expense_per_period: (() => {
        const f = filingType;
        const isBiz = f === "1099_schedule_c" || f === "k1_partnership" || f === "scorp_distribution";
        return isBiz ? Math.max(0, num(form.forecast_expense_per_period)) : 0;
      })(),
      forecast_expense_notes: (() => {
        const f = filingType;
        const isBiz = f === "1099_schedule_c" || f === "k1_partnership" || f === "scorp_distribution";
        return isBiz ? (form.forecast_expense_notes || "").trim() : "";
      })(),
      is_active: form.is_active,
      include_in_tax: form.include_in_tax,
    };

    if (editingId) {
      updateStream.mutate({ id: editingId, ...payload }, { onSuccess: resetForm });
    } else {
      addStream.mutate(payload, { onSuccess: resetForm });
    }
  };

  // Override handlers
  const handleSkip = (entry: ProjectedPaycheck) => {
    addOverride.mutate({
      stream_id: entry.streamId,
      override_date: entry.date,
      action: "skip",
    });
  };

  const handleRestore = (entry: ProjectedPaycheck) => {
    const existing = overrideLookup.get(`${entry.streamId}:${entry.date}`);
    if (existing) {
      deleteOverride.mutate(existing.id);
    }
  };

  const openOverrideEdit = (entry: ProjectedPaycheck) => {
    const existing = overrideLookup.get(`${entry.streamId}:${entry.date}`);
    // Anchor date = the original scheduled occurrence. If this entry was already moved,
    // the anchor lives on the override row, otherwise it's the entry's own date.
    const anchorDate = existing?.override_date || entry.date;
    setOverrideForm({
      paycheck_amount: String(entry.grossAmount),
      taxes_withheld: String(entry.taxesWithheld),
      retirement_401k: String(entry.retirement401k),
      pre_tax_deductions: String(entry.preTaxDeductions),
      notes: existing?.notes || "",
      new_date: existing?.new_date || entry.date,
    });
    setOverrideTarget({ streamId: entry.streamId, date: anchorDate });
  };

  const handleOverrideSubmit = () => {
    if (!overrideTarget) return;
    const existing = overrideLookup.get(`${overrideTarget.streamId}:${overrideTarget.date}`);
    // If user picked the same date as the anchor, treat as "no move"
    const movedDate =
      overrideForm.new_date && overrideForm.new_date !== overrideTarget.date
        ? overrideForm.new_date
        : null;
    const payload = {
      stream_id: overrideTarget.streamId,
      override_date: overrideTarget.date,
      action: "modify" as const,
      paycheck_amount: num(overrideForm.paycheck_amount),
      taxes_withheld: num(overrideForm.taxes_withheld),
      retirement_401k: num(overrideForm.retirement_401k),
      pre_tax_deductions: num(overrideForm.pre_tax_deductions),
      notes: overrideForm.notes,
      new_date: movedDate,
    };
    if (existing) {
      deleteOverride.mutate(existing.id, {
        onSuccess: () => addOverride.mutate(payload),
      });
    } else {
      addOverride.mutate(payload);
    }
    setOverrideTarget(null);
  };

  const openConvert = (entry: ProjectedPaycheck) => {
    const t = (entry.streamCompanyType || "").toLowerCase();
    const isBusiness = t === "1099" || t === "k1" || t === "1099_schedule_c" || t === "k1_partnership" || t === "scorp_distribution";
    setConvertDestination(isBusiness ? "business" : "personal");
    setConvertTarget(entry);
  };

  const handleConvert = () => {
    if (!convertTarget) return;
    const entry = convertTarget;
    const dest = convertDestination;
    const notes = "Converted from planned income";

    const onSuccess = () => {
      // Mark as "skip" override so it's excluded from projections
      addOverride.mutate({
        stream_id: entry.streamId,
        override_date: entry.date,
        action: "skip",
        notes: "Converted to actual income",
      });
      setConvertTarget(null);
    };

    if (dest === "personal") {
      addPersonalIncome.mutate({
        name: entry.label,
        company: entry.label,
        income_type: entry.streamCompanyType || "w2",
        income_date: entry.date,
        gross_amount: entry.grossAmount,
        paycheck_amount: entry.grossAmount,
        taxes_withheld: entry.taxesWithheld,
        pre_tax_deductions: entry.preTaxDeductions,
        retirement_401k: entry.retirement401k,
        notes,
      } as any, { onSuccess });
    } else {
      addIncome.mutate({
        name: entry.label,
        company: entry.label,
        income_type: entry.streamCompanyType || "1099_schedule_c",
        income_date: entry.date,
        paycheck_amount: entry.grossAmount,
        deposited_amount: entry.netAmount,
        taxes_withheld: entry.taxesWithheld,
        pre_tax_deductions: entry.preTaxDeductions,
        retirement_401k: entry.retirement401k,
        notes,
        status: "received" as any,
      }, { onSuccess });
    }
  };

  const currentMonth = new Date().getMonth();

  if (streamsLoading || bonusesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{isW2Only ? "Withholding Guide" : "Income Planner"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isW2Only
            ? "Your paycheck already withholds some taxes. This guide checks whether your current and expected withholding is enough for your projected household tax bill."
            : "Plan your expected income for the year and see how it affects your tax estimate."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Expected Annual Income"
          value={fmt(expectedAnnual)}
          sublabel={forecastDebug?.totalGrossIncome != null ? "Actual + projected (all income sources)" : `${fmt(actualYTD.income)} actual + ${fmt(projectedTotals.grossIncome)} projected`}
          highlight
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Projected Remaining"
          value={fmt(projectedTotals.grossIncome)}
          sublabel={`${projectedTotals.count} upcoming payments`}
        />
        <SummaryCard
          icon={<Shield className="h-4 w-4" />}
          label="Estimated Annual Tax"
          value={fmt(forecastEstimate?.totalTaxLiability || 0)}
          sublabel="Based on actual + projected income"
        />
        <SummaryCard
          icon={<PiggyBank className="h-4 w-4" />}
          label={isW2Only ? "Federal Withholding" : "Projected Withholding"}
          value={fmt(projectedWithholding)}
          sublabel={projected401k > 0 ? `+ ${fmt(projected401k)} in 401(k)` : undefined}
        />
      </div>

      <DuplicateConversionsReview />

      {isW2Only && forecastDebug && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Household Withholding Check</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                If there is a gap, you can either update your W4 to withhold more or save the same amount yourself.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Projected Taxable Income", value: fmt(forecastDebug.totalTaxableIncome), Icon: Shield },
                { label: "Estimated Total Tax", value: fmt(forecastDebug.totalEstimatedTax), Icon: Shield },
                { label: "Expected Future Withholding", value: fmt(forecastDebug.projectedFederalWithheld + (taxSettings?.stateIncomeTaxEnabled ? forecastDebug.projectedStateWithheld : 0)), Icon: PiggyBank },
                { label: "Recommended Extra Per Paycheck", value: fmt(forecastDebug.recommendedSetAside), Icon: PiggyBank, highlight: true },
              ].map(({ label, value, Icon, highlight }) => (
                <div key={label} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-normal">{label}</span>
                  </div>
                  <p className={`mt-1 text-xl font-semibold tabular-nums ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Federal withholding so far</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{fmt(forecastDebug.actualFederalWithheld)}</p>
              </div>
              {taxSettings?.stateIncomeTaxEnabled && (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">State withholding so far</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{fmt(forecastDebug.actualStateWithheld)}</p>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {projectedGap > 0
                ? `Based on your projected household income, deductions, taxes, and current withholding, you are projected to be short by ${fmt(projectedGap)}.`
                : projectedRefund > 0
                  ? `You are projected to have a refund of about ${fmt(projectedRefund)} if your income and withholding stay on track.`
                  : "Your current withholding appears to be on track based on your projected household income, deductions, and taxes."}
            </p>
            {(spouseW2Locked || multipleW2Locked) && (
              <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Premium</span> unlocks spouse W2 tracking, multiple W2 jobs, scenario planning, and detailed withholding reports. Your existing paycheck data still stays in the household projection.
              </div>
            )}
          </CardContent>
        </Card>
      )}

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Monthly Plan</h2>
          <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Income Stream
          </Button>
        </div>

        {(() => {
          const renderMonth = (idx: number) => {
            const monthName = MONTHS[idx];
            const entries = byMonth.get(idx) || [];
            const activeEntries = entries.filter((e) => e.matchStatus === "active");
            const matchedEntries = entries.filter((e) => e.matchStatus === "matched");
            const pastDueEntries = entries.filter((e) => e.matchStatus === "past_due");
            const convertedEntries = entries.filter((e) => e.matchStatus === "converted");
            const monthTotal = activeEntries.reduce((s, e) => s + e.grossAmount, 0);
            const monthWithheld = activeEntries.reduce((s, e) => s + e.taxesWithheld, 0);
            // Simplified row count + total exclude "skipped" entries.
            const countableEntries =
              activeEntries.length +
              matchedEntries.length +
              pastDueEntries.length +
              convertedEntries.length;
            const rowTotal = entries
              .filter((e) => e.matchStatus !== "skipped")
              .reduce((s, e) => s + e.grossAmount, 0);
            const isExpanded = expandedMonths.has(idx);
            const isPast = idx < currentMonth;
            const isCurrent = idx === currentMonth;
            const countLabel = `${countableEntries} ${countableEntries === 1 ? "paycheck" : "paychecks"}`;

            return (
              <Collapsible key={idx} open={isExpanded} onOpenChange={() => toggleMonth(idx)}>
                <CollapsibleTrigger asChild>
                  <button
                    className={`w-full grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 sm:px-4 py-3 rounded-lg border transition-colors text-left ${
                      isCurrent
                        ? "border-primary/30 bg-primary/5"
                        : isPast
                        ? "border-border/50 bg-muted/30"
                        : "border-border bg-card hover:bg-accent/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-medium text-foreground truncate">{monthName}</span>
                    </div>
                    <span className="text-xs sm:text-sm text-muted-foreground text-center truncate">
                      {countableEntries > 0 ? countLabel : ""}
                    </span>
                    <span className="text-sm font-semibold text-foreground text-right whitespace-nowrap">
                      {rowTotal > 0 ? fmt(rowTotal) : ""}
                    </span>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="ml-4 mr-1 mt-1 mb-2 space-y-2">
                    {activeEntries.length > 0 && (
                      <div className="flex flex-wrap gap-4 px-3 py-2 rounded-md bg-muted/40 text-xs text-muted-foreground">
                        <span>Total: <strong className="text-foreground">{fmt(monthTotal)}</strong></span>
                        {monthWithheld > 0 && (
                          <span>Withholding: <strong className="text-foreground">{fmt(monthWithheld)}</strong></span>
                        )}
                        {activeEntries.reduce((s, e) => s + e.retirement401k, 0) > 0 && (
                          <span>401(k): <strong className="text-foreground">
                            {fmt(activeEntries.reduce((s, e) => s + e.retirement401k, 0))}
                          </strong></span>
                        )}
                      </div>
                    )}

                    {entries.map((entry, i) => {
                      const dismissKey = `${entry.streamId}:${entry.date}`;
                      const isDismissed = dismissedSuggestions.has(dismissKey);
                      const isMatched = entry.matchStatus === "matched";
                      const isSuggested = entry.matchStatus === "suggested" && !isDismissed;
                      const isPastDue = entry.matchStatus === "past_due" || (entry.matchStatus === "suggested" && isDismissed && (() => {
                        const pDate = new Date(entry.date);
                        const today = new Date(); today.setHours(0,0,0,0);
                        return pDate < today;
                      })());
                      const isSkipped = entry.matchStatus === "skipped";
                      const isActive = entry.matchStatus === "active" || (entry.matchStatus === "suggested" && isDismissed && !isPastDue);
                      const isAutoConverted = entry.matchStatus === "converted";

                      const override = overrideLookup.get(`${entry.streamId}:${entry.date}`);
                      const isOverrideConverted = isSkipped && override?.notes?.includes("Converted to actual income");
                      const isConverted = isAutoConverted || isOverrideConverted;

                      const _t = (entry.streamCompanyType || "").toLowerCase();
                      const isBizType = _t === "1099" || _t === "k1" || _t === "1099_schedule_c" || _t === "k1_partnership" || _t === "scorp_distribution";
                      const viewDestination = isBizType ? "/business-activity" : "/personal-income";
                      const viewLabel = isBizType ? "Business Activity" : "Personal Income";

                      return (
                        <div
                          key={i}
                          role="button"
                          tabIndex={0}
                          onClick={() => setDetailEntry(entry)}
                          className={`flex items-start sm:items-center justify-between gap-2 px-3 py-2.5 rounded-md border bg-card cursor-pointer hover:bg-muted/30 transition-colors ${
                            isConverted
                              ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20 opacity-70"
                              : isSkipped
                              ? "border-destructive/20 bg-destructive/5 opacity-50"
                              : isMatched
                              ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                              : isPastDue
                              ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                              : entry.isModified
                              ? "border-primary/30 bg-primary/5"
                              : "border-border/50"
                          }`}
                        >
                          <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                            <span className="text-xs text-muted-foreground w-12 shrink-0 sm:pt-0 pt-0.5">{entry.date.slice(5)}</span>
                            <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={`text-sm font-medium break-words line-clamp-2 sm:line-clamp-none sm:truncate ${isSkipped || isMatched || isConverted ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {entry.label}
                            </span>
                            {entry.type === "bonus" && (
                              <Badge variant="secondary" className="text-xs shrink-0">Bonus</Badge>
                            )}
                            {isMatched && (
                              <Badge variant="outline" className="text-xs shrink-0 border-emerald-400 text-emerald-600 dark:text-emerald-400 gap-0.5">
                                <CheckCircle2 className="h-2.5 w-2.5" /> Matched deposit
                              </Badge>
                            )}
                            {isSuggested && (
                              <Badge variant="outline" className="text-xs shrink-0 border-amber-400 text-amber-700 dark:text-amber-400 gap-0.5">
                                <AlertCircle className="h-2.5 w-2.5" /> Suggested match
                              </Badge>
                            )}
                            {isPastDue && (
                              <Badge variant="outline" className="text-xs shrink-0 border-amber-400 text-amber-600 dark:text-amber-400 gap-0.5">
                                <AlertCircle className="h-2.5 w-2.5" /> Past due
                              </Badge>
                            )}
                            {isConverted && (
                              <Badge variant="outline" className="text-xs shrink-0 border-emerald-400 text-emerald-600 dark:text-emerald-400 gap-0.5">
                                <CheckCircle2 className="h-2.5 w-2.5" /> Converted
                              </Badge>
                            )}
                            {isSkipped && !isConverted && (
                              <Badge variant="outline" className="text-xs shrink-0 border-destructive/40 text-destructive">Skipped</Badge>
                            )}
                            {entry.isModified && isActive && (
                              <Badge variant="outline" className="text-xs shrink-0 border-primary/40 text-primary">Modified</Badge>
                            )}
                            </div>
                          </div>
                          {/* Mobile: amount + single pencil that opens action sheet */}
                          <div className="flex sm:hidden items-center gap-2 shrink-0 pt-0.5">
                            <span className={`text-sm font-semibold whitespace-nowrap ${isSkipped || isMatched || isConverted ? "line-through text-muted-foreground" : isPastDue ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {fmtFull(entry.grossAmount)}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Actions"
                              onClick={(e) => { e.stopPropagation(); setMobileActionsEntry(entry); }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="hidden sm:flex items-center gap-2 shrink-0">
                            {isMatched && entry.matchedAmount != null && (
                              <>
                                <span className="text-xs text-muted-foreground">
                                  Actual: {fmtFull(entry.matchedAmount)}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs px-1.5 text-primary gap-0.5"
                                  title={`View in ${viewLabel}`}
                                  onClick={(e) => { e.stopPropagation(); navigate(viewDestination); }}
                                >
                                  <ExternalLink className="h-3 w-3" /> View
                                </Button>
                              </>
                            )}
                            {isConverted && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs px-1.5 text-emerald-600 dark:text-emerald-400 gap-0.5"
                                title={`View in ${viewLabel}`}
                                onClick={(e) => { e.stopPropagation(); navigate(viewDestination); }}
                              >
                                <ExternalLink className="h-3 w-3" /> View in {viewLabel}
                              </Button>
                            )}
                            <span className={`text-sm font-semibold ${isSkipped || isMatched || isConverted ? "line-through text-muted-foreground" : isPastDue ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {fmtFull(entry.grossAmount)}
                            </span>
                            {isSuggested && (entry.suggestedIncomeId || entry.suggestedTransactionId) && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs px-2 border-emerald-400 text-emerald-700 dark:text-emerald-400 gap-0.5"
                                  title="Confirm this projected paycheck matches the actual ledger entry"
                                  disabled={confirmSuggested.isPending}
                                  data-testid="projected-confirm-suggested"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const bucket = entry.suggestedBucket
                                      ?? (entry.suggestedTransactionId ? "business" : "personal");
                                    const ledgerId = bucket === "business"
                                      ? entry.suggestedTransactionId!
                                      : entry.suggestedIncomeId!;
                                    confirmSuggested.mutate({
                                      streamId: entry.streamId,
                                      occurrenceDate: entry.date,
                                      incomeEntryId: ledgerId,
                                      ledgerBucket: bucket,
                                    });
                                  }}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-0.5" /> Confirm
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs px-2 text-muted-foreground gap-0.5"
                                  title="Dismiss this suggested match"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDismissedSuggestions((prev) => {
                                      const next = new Set(prev);
                                      next.add(`${entry.streamId}:${entry.date}`);
                                      return next;
                                    });
                                  }}
                                >
                                  <X className="h-3 w-3 mr-0.5" /> Dismiss
                                </Button>
                              </>
                            )}
                            {isActive && entry.type === "paycheck" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs px-2"
                                  title={(() => { const t = (entry.streamCompanyType || "").toLowerCase(); return (t === "1099" || t === "k1" || t === "1099_schedule_c" || t === "k1_partnership" || t === "scorp_distribution") ? "Add to Business Activity" : "Add to Personal Income"; })()}
                                  onClick={(e) => { e.stopPropagation(); openConvert(entry); }}
                                >
                                  <Plus className="h-3 w-3 mr-0.5" />
                                  {(() => { const t = (entry.streamCompanyType || "").toLowerCase(); return (t === "1099" || t === "k1" || t === "1099_schedule_c" || t === "k1_partnership" || t === "scorp_distribution") ? "To Ledger" : "To Personal"; })()}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title="Edit this date"
                                  onClick={(e) => { e.stopPropagation(); openOverrideEdit(entry); }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-destructive"
                                  title="Skip this date"
                                  onClick={(e) => { e.stopPropagation(); handleSkip(entry); }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            {entry.type === "bonus" && entry.bonusEventId && !isMatched && !isConverted && !isSkipped && (
                              <>
                                {(isActive || isPastDue) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs px-2"
                                    title="Convert bonus to actual income"
                                    onClick={(e) => { e.stopPropagation(); openConvert(entry); }}
                                  >
                                    <Plus className="h-3 w-3 mr-0.5" /> Convert
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title="Edit bonus"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBonusEditTarget({ id: entry.bonusEventId!, streamId: entry.streamId });
                                    setBonusEditForm({
                                      name: entry.label.replace(/\s*\(.*\)\s*$/, ""),
                                      amount: String(entry.grossAmount),
                                      taxes_withheld: String(entry.taxesWithheld),
                                      scheduled_date: entry.date,
                                    });
                                  }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-destructive"
                                  title="Delete bonus"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBonusDeleteConfirm({ id: entry.bonusEventId!, label: entry.label });
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            {isPastDue && entry.type === "paycheck" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs px-2"
                                  title="Convert to actual income"
                                  onClick={(e) => { e.stopPropagation(); openConvert(entry); }}
                                >
                                  <Plus className="h-3 w-3 mr-0.5" /> Convert
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title="Edit this date"
                                  onClick={(e) => { e.stopPropagation(); openOverrideEdit(entry); }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-destructive"
                                  title="Skip — income not received"
                                  onClick={(e) => { e.stopPropagation(); handleSkip(entry); }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            {isSkipped && !isConverted && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-primary"
                                title="Restore this date"
                                onClick={(e) => { e.stopPropagation(); handleRestore(entry); }}
                              >
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                            {entry.isModified && isActive && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-muted-foreground"
                                title="Remove override (restore default)"
                                onClick={(e) => { e.stopPropagation(); handleRestore(entry); }}
                              >
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {entries.length === 0 && (
                      <p className="text-xs text-muted-foreground px-3 py-2">
                        No projected income for this month.
                      </p>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => openAddForMonth(idx)}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add income for {monthName}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          };

          const upcomingIdxs = MONTHS.map((_, i) => i).filter((i) => i >= currentMonth);
          const previousIdxs = MONTHS.map((_, i) => i).filter((i) => i < currentMonth);

          return (
            <>
              <div className="space-y-1.5">
                {upcomingIdxs.map(renderMonth)}
              </div>

              {previousIdxs.length > 0 && (
                <Collapsible open={showPreviousMonths} onOpenChange={setShowPreviousMonths} className="mt-3">
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between px-3 sm:px-4 py-2.5 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors text-left">
                      <div className="flex items-center gap-2">
                        {showPreviousMonths ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium text-muted-foreground">Previous months</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{previousIdxs.length}</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1.5 mt-1.5">
                      {previousIdxs.map(renderMonth)}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          );
        })()}
      {streams && streams.length > 0 && (() => {
        const activeStreams = streams.filter((s) => !isStreamExpired(s));
        const expiredStreams = streams.filter((s) => isStreamExpired(s));
        return (
          <>
            {activeStreams.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground">Income Streams</h2>
                <CompanyAccordion
                  streams={activeStreams}
                  onEdit={startEdit}
                  onDelete={setDeleteConfirm}
                />
              </div>
            )}
            {expiredStreams.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground text-muted-foreground">
                  Archived Streams
                </h2>
                <p className="text-xs text-muted-foreground">
                  These streams have passed their end date and no longer contribute to projections.
                </p>
                <CompanyAccordion
                  streams={expiredStreams}
                  onEdit={startEdit}
                  onDelete={setDeleteConfirm}
                  expired
                />
              </div>
            )}
          </>
        );
      })()}

      {/* Add/Edit Stream Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? (isOneTime ? "Edit One-Time Income" : "Edit Income Stream")
                : (isOneTime ? "Add One-Time Income" : "Add Income Stream")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Source / Employer — drives advanced field visibility */}
            <div className="space-y-1.5">
              <Label>
                Source / Employer
                {isW2Subtype && <span className="text-destructive"> *</span>}
              </Label>
              <SourceEmployerCombobox
                sourceId={form.source_id}
                otherName={form.source_name}
                saveAsNew={form.source_save_as_new}
                newSourceKind={form.source_new_kind}
                required={isW2Subtype}
                invalid={showSourceError}
                onChange={(next) => {
                  setForm((prev) => {
                    let nextSubtype = prev.ui_income_subtype;
                    // When linking a source on add, default the subtype from the source's kind
                    // so advanced field visibility flips immediately.
                    if (!editingId && next.linkedSource) {
                      const suggested = defaultSubtypeForSourceKind(next.linkedSource.source_kind);
                      if (suggested) nextSubtype = suggested;
                    }
                    return {
                      ...prev,
                      source_id: next.sourceId,
                      source_name: next.otherName,
                      source_save_as_new: next.saveAsNew,
                      source_new_kind: next.newSourceKind,
                      ui_income_subtype: nextSubtype,
                    };
                  });
                  if (showSourceError) setShowSourceError(false);
                }}
              />
              {showSourceError && isW2Subtype && !form.source_id && !form.source_name.trim() && (
                <p className="text-[10px] text-destructive mt-1">Pick a source or enter one under "Other".</p>
              )}
            </div>

            {/* Income subtype — preserves transfer fidelity */}
            <div className="space-y-1.5">
              <Label>Income Type</Label>
              <Select
                value={form.ui_income_subtype}
                onValueChange={(v) => setField("ui_income_subtype", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {visibleIncomeSubtypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {subtypeIsDisabled && (
                <p className="text-[10px] text-muted-foreground">
                  No longer active in your Household Income Profile — kept available for this existing entry only.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Determines whether this stream transfers to{" "}
                <strong>
                  {ledgerForIncomeType(form.ui_income_subtype) === "business"
                    ? "Business Activity"
                    : "Personal Income"}
                </strong>{" "}
                when you convert it.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Expected Income *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.paycheck_amount}
                  onChange={(e) => setField("paycheck_amount", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pay Frequency</Label>
                <Select value={form.pay_frequency} onValueChange={(v) => {
                  setField("pay_frequency", v);
                  if (v === "single") setField("end_date", "");
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAY_FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.pay_frequency === "custom" && (
              <div className="space-y-1.5">
                <Label>Custom Interval (days)</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.custom_interval_days}
                  onChange={(e) => setField("custom_interval_days", e.target.value)}
                />
              </div>
            )}

            <div className={`grid ${isOneTime ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
              <div className="space-y-1.5">
                <Label>{isOneTime ? "Date" : "Start Date"}</Label>
                <DateField
                  value={form.start_date}
                  onChange={(v) => setField("start_date", v)}
                />
              </div>
              {!isOneTime && (
                <div className="space-y-1.5">
                  <Label>End Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <DateField
                    value={form.end_date}
                    onChange={(v) => setField("end_date", v)}
                  />
                </div>
              )}
            </div>

            {/* Advanced details — driven by company / filing-type toggles */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Advanced details
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-3">
                  {/* Catch-all withholding (1099, k1, scorp_distribution, other) */}
                  {showField("taxes_withheld") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Taxes actually withheld</Label>
                      <Input
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={form.taxes_withheld}
                        onChange={(e) => setField("taxes_withheld", e.target.value)}
                      />
                    </div>
                  )}

                  {/* Simplified federal payroll tax (W-2 / S-Corp W-2) */}
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
                  {!!taxSettings?.stateIncomeTaxEnabled && showField("state_withholding") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">State tax withheld</Label>
                      <Input type="number" min="0" step="0.01" placeholder="0.00"
                        value={form.state_withholding}
                        onChange={(e) => setField("state_withholding", e.target.value)} />
                    </div>
                  )}

                  {/* Pre-tax deductions */}
                  {(showField("retirement_401k") || showField("healthcare_deduction") || showField("hsa_contribution") || showField("pre_tax_deductions")) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {showField("retirement_401k") && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">401(k) contribution</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00"
                            value={form.retirement_401k}
                            onChange={(e) => setField("retirement_401k", e.target.value)} />
                        </div>
                      )}
                      {showField("healthcare_deduction") && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Health insurance</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00"
                            value={form.healthcare_deduction}
                            onChange={(e) => setField("healthcare_deduction", e.target.value)} />
                        </div>
                      )}
                      {showField("hsa_contribution") && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">HSA contribution</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00"
                            value={form.hsa_contribution}
                            onChange={(e) => setField("hsa_contribution", e.target.value)} />
                        </div>
                      )}
                      {showField("pre_tax_deductions") && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Other pre-tax deductions</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00"
                            value={form.pre_tax_deductions}
                            onChange={(e) => setField("pre_tax_deductions", e.target.value)} />
                        </div>
                      )}
                    </div>
                  )}

                  {showField("additional_tax_reserve") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Amount you're saving for taxes</Label>
                      <Input type="number" min="0" step="0.01" placeholder="0.00"
                        value={form.additional_tax_reserve}
                        onChange={(e) => setField("additional_tax_reserve", e.target.value)} />
                    </div>
                  )}

                  {(() => {
                    const meta = subtypeMeta(form.ui_income_subtype);
                    const f = meta?.filingType ?? normalizeFilingType(form.ui_income_subtype);
                    const isBiz = f === "1099_schedule_c" || f === "k1_partnership" || f === "scorp_distribution";
                    if (!isBiz) return null;
                    const periodsPerYear = (() => {
                      switch (form.pay_frequency) {
                        case "weekly": return 52;
                        case "biweekly": return 26;
                        case "semimonthly": return 24;
                        case "monthly": return 12;
                        case "quarterly": return 4;
                        case "annual": return 1;
                        case "single": return 1;
                        case "custom": {
                          const d = num(form.custom_interval_days);
                          return d > 0 ? Math.max(1, Math.round(365 / d)) : 0;
                        }
                        default: return 0;
                      }
                    })();
                    const perPeriod = Math.max(0, num(form.forecast_expense_per_period));
                    const annualized = periodsPerYear > 0 ? perPeriod * periodsPerYear : 0;
                    return (
                      <div className="space-y-3 rounded-md border border-dashed border-border bg-muted/30 p-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">
                            Forecast business expenses (per pay period)
                          </Label>
                          <Input
                            type="number" min="0" step="0.01" placeholder="0.00"
                            value={form.forecast_expense_per_period}
                            onChange={(e) => setField("forecast_expense_per_period", e.target.value)}
                          />
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            Estimated overhead reduces projected business profit before SE tax. Leave at 0 to forecast gross receipts only. Actual expense transactions are always counted separately.
                            {annualized > 0 && (
                              <> <span className="font-medium text-foreground">≈ {fmtFull(annualized)} / yr</span> at {periodsPerYear}× per year.</>
                            )}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Assumption notes</Label>
                          <Input
                            value={form.forecast_expense_notes}
                            onChange={(e) => setField("forecast_expense_notes", e.target.value)}
                            placeholder="e.g. malpractice $X/mo + CME + supplies"
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {visibleFields.notes && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Notes</Label>
                      <Input
                        value={form.notes}
                        onChange={(e) => setField("notes", e.target.value)}
                        placeholder="Optional notes"
                      />
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {num(form.paycheck_amount) > 0 && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Est. take-home: </span>
                <span className="font-semibold text-foreground">
                  {fmtFull(Math.max(0,
                    num(form.paycheck_amount)
                    - num(form.taxes_withheld)
                    - num(form.federal_withholding)
                    - num(form.state_withholding)
                    - num(form.ss_withholding)
                    - num(form.medicare_withholding)
                    - num(form.retirement_401k)
                    - num(form.healthcare_deduction)
                    - num(form.pre_tax_deductions)
                  ))}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={
                num(form.paycheck_amount) <= 0 ||
                (!form.source_id && !form.source_name.trim() && !form.company.trim())
              }
            >
              {editingId ? "Save Changes" : (isOneTime ? "Add One-Time Income" : "Add Stream")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Stream Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Income Stream</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove the income stream and all projected paychecks. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirm) deleteStream.mutate(deleteConfirm);
                setDeleteConfirm(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override Edit Dialog */}
      <Dialog open={!!overrideTarget} onOpenChange={(open) => { if (!open) setOverrideTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Paycheck — {overrideTarget?.date}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Override the default amounts for this specific date only. The rest of the stream stays unchanged.
          </p>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <DateField
                value={overrideForm.new_date}
                onChange={(v) => setOverrideForm((p) => ({ ...p, new_date: v }))}
              />
              {overrideForm.new_date && overrideForm.new_date !== overrideTarget?.date && (
                <p className="text-xs text-muted-foreground">
                  Moved from original date {overrideTarget?.date}.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Gross Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={overrideForm.paycheck_amount}
                onChange={(e) => setOverrideForm((p) => ({ ...p, paycheck_amount: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tax Withholding</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={overrideForm.taxes_withheld}
                  onChange={(e) => setOverrideForm((p) => ({ ...p, taxes_withheld: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">401(k)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={overrideForm.retirement_401k}
                  onChange={(e) => setOverrideForm((p) => ({ ...p, retirement_401k: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Deductions</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={overrideForm.pre_tax_deductions}
                  onChange={(e) => setOverrideForm((p) => ({ ...p, pre_tax_deductions: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                value={overrideForm.notes}
                onChange={(e) => setOverrideForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="e.g. Extra shift pay"
              />
            </div>
            {num(overrideForm.paycheck_amount) > 0 && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Est. take-home: </span>
                <span className="font-semibold text-foreground">
                  {fmtFull(Math.max(0, num(overrideForm.paycheck_amount) - num(overrideForm.taxes_withheld) - num(overrideForm.retirement_401k) - num(overrideForm.pre_tax_deductions)))}
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>Cancel</Button>
            <Button onClick={handleOverrideSubmit} disabled={num(overrideForm.paycheck_amount) <= 0}>
              Save Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bonus Edit Dialog */}
      <Dialog open={!!bonusEditTarget} onOpenChange={(open) => { if (!open) setBonusEditTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Bonus</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={bonusEditForm.name}
                onChange={(e) => setBonusEditForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={bonusEditForm.amount}
                  onChange={(e) => setBonusEditForm((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tax Withholding</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={bonusEditForm.taxes_withheld}
                  onChange={(e) => setBonusEditForm((p) => ({ ...p, taxes_withheld: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <DateField
                value={bonusEditForm.scheduled_date}
                onChange={(v) => setBonusEditForm((p) => ({ ...p, scheduled_date: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBonusEditTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!bonusEditTarget) return;
                updateBonus.mutate({
                  id: bonusEditTarget.id,
                  name: bonusEditForm.name,
                  amount: num(bonusEditForm.amount),
                  taxes_withheld: num(bonusEditForm.taxes_withheld),
                  scheduled_date: bonusEditForm.scheduled_date,
                }, { onSuccess: () => setBonusEditTarget(null) });
              }}
              disabled={!bonusEditForm.scheduled_date || num(bonusEditForm.amount) <= 0}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bonus Delete Confirmation */}
      <Dialog open={!!bonusDeleteConfirm} onOpenChange={(open) => { if (!open) setBonusDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Bonus</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-medium text-foreground">{bonusDeleteConfirm?.label}</span>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBonusDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!bonusDeleteConfirm) return;
                deleteBonus.mutate(bonusDeleteConfirm.id, {
                  onSuccess: () => setBonusDeleteConfirm(null),
                });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Mobile actions bottom sheet */}
      <Sheet open={!!mobileActionsEntry} onOpenChange={(open) => { if (!open) setMobileActionsEntry(null); }}>
        <SheetContent side="bottom" className="rounded-t-xl">
          <SheetHeader className="text-left">
            <SheetTitle className="truncate">{mobileActionsEntry?.label}</SheetTitle>
            <p className="text-xs text-muted-foreground">{mobileActionsEntry?.date}</p>
          </SheetHeader>
          {mobileActionsEntry && (() => {
            const e = mobileActionsEntry;
            const m_isMatched = e.matchStatus === "matched";
            const m_isPastDue = e.matchStatus === "past_due";
            const m_isSkipped = e.matchStatus === "skipped";
            const m_isActive = e.matchStatus === "active";
            const m_isAutoConverted = e.matchStatus === "converted";
            const m_override = overrideLookup.get(`${e.streamId}:${e.date}`);
            const m_isOverrideConverted = m_isSkipped && m_override?.notes?.includes("Converted to actual income");
            const m_isConverted = m_isAutoConverted || m_isOverrideConverted;
            const m_t = (e.streamCompanyType || "").toLowerCase();
            const m_isBiz = m_t === "1099" || m_t === "k1" || m_t === "1099_schedule_c" || m_t === "k1_partnership" || m_t === "scorp_distribution";
            const m_viewDest = m_isBiz ? "/business-activity" : "/personal-income";
            const m_viewLabel = m_isBiz ? "Business Activity" : "Personal Income";
            const close = () => setMobileActionsEntry(null);
            return (
              <div className="flex flex-col gap-2 mt-4 pb-4">
                {((m_isActive && e.type === "paycheck") || (e.type === "bonus" && e.bonusEventId && (m_isActive || m_isPastDue) && !m_isMatched && !m_isConverted && !m_isSkipped) || (m_isPastDue && e.type === "paycheck")) && (
                  <Button variant="outline" className="justify-start h-12" onClick={() => { close(); openConvert(e); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    {e.type === "bonus" ? "Convert bonus to actual income" : (m_isBiz ? "Move to Business Ledger" : "Move to Personal Income")}
                  </Button>
                )}
                {((m_isActive && e.type === "paycheck") || (m_isPastDue && e.type === "paycheck")) && (
                  <Button variant="outline" className="justify-start h-12" onClick={() => { close(); openOverrideEdit(e); }}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit this date
                  </Button>
                )}
                {e.type === "bonus" && e.bonusEventId && !m_isMatched && !m_isConverted && !m_isSkipped && (
                  <Button variant="outline" className="justify-start h-12" onClick={() => {
                    close();
                    setBonusEditTarget({ id: e.bonusEventId!, streamId: e.streamId });
                    setBonusEditForm({
                      name: e.label.replace(/\s*\(.*\)\s*$/, ""),
                      amount: String(e.grossAmount),
                      taxes_withheld: String(e.taxesWithheld),
                      scheduled_date: e.date,
                    });
                  }}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit bonus
                  </Button>
                )}
                {(m_isMatched || m_isConverted) && (
                  <Button variant="outline" className="justify-start h-12" onClick={() => { close(); navigate(m_viewDest); }}>
                    <ExternalLink className="h-4 w-4 mr-2" /> View in {m_viewLabel}
                  </Button>
                )}
                {m_isSkipped && !m_isConverted && (
                  <Button variant="outline" className="justify-start h-12 text-primary" onClick={() => { close(); handleRestore(e); }}>
                    <RotateCcw className="h-4 w-4 mr-2" /> Restore this date
                  </Button>
                )}
                {e.isModified && m_isActive && (
                  <Button variant="outline" className="justify-start h-12" onClick={() => { close(); handleRestore(e); }}>
                    <RotateCcw className="h-4 w-4 mr-2" /> Reset to default
                  </Button>
                )}
                {((m_isActive || m_isPastDue) && e.type === "paycheck") && (
                  <Button variant="outline" className="justify-start h-12 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={() => { close(); setMobileSkipConfirm(e); }}>
                    <X className="h-4 w-4 mr-2" /> Delete (skip this date)
                  </Button>
                )}
                {e.type === "bonus" && e.bonusEventId && !m_isMatched && !m_isConverted && !m_isSkipped && (
                  <Button variant="outline" className="justify-start h-12 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={() => {
                    close();
                    setBonusDeleteConfirm({ id: e.bonusEventId!, label: e.label });
                  }}>
                    <X className="h-4 w-4 mr-2" /> Delete bonus
                  </Button>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      <Dialog open={!!mobileSkipConfirm} onOpenChange={(open) => { if (!open) setMobileSkipConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this income?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will skip <span className="font-medium text-foreground">{mobileSkipConfirm?.label}</span> on {mobileSkipConfirm?.date}. You can restore it later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMobileSkipConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (!mobileSkipConfirm) return;
              handleSkip(mobileSkipConfirm);
              setMobileSkipConfirm(null);
            }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!convertTarget} onOpenChange={(open) => { if (!open) setConvertTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convert to Actual Income</DialogTitle>
          </DialogHeader>
          {convertTarget && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                This will create an actual income entry and remove this planned income from active projections. Continue?
              </p>
              <div className="rounded-md bg-muted/50 px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">{convertTarget.date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Company</span>
                  <span className="font-medium">{convertTarget.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross Amount</span>
                  <span className="font-medium">{fmtFull(convertTarget.grossAmount)}</span>
                </div>
                {convertTarget.taxesWithheld > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Taxes Withheld</span>
                    <span>{fmtFull(convertTarget.taxesWithheld)}</span>
                  </div>
                )}
                {convertTarget.retirement401k > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">401(k)</span>
                    <span>{fmtFull(convertTarget.retirement401k)}</span>
                  </div>
                )}
                {convertTarget.preTaxDeductions > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pre-Tax Deductions</span>
                    <span>{fmtFull(convertTarget.preTaxDeductions)}</span>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Destination</Label>
                <Select value={convertDestination} onValueChange={(v) => setConvertDestination(v as "business" | "personal")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="business">Business Activity</SelectItem>
                    <SelectItem value="personal">Personal Income</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>Cancel</Button>
            <Button onClick={handleConvert}>
              Create Actual Income
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read-only detail card for projected paychecks */}
      {detailEntry && (() => {
        const e = detailEntry;
        const dismissKey = `${e.streamId}:${e.date}`;
        const isDismissed = dismissedSuggestions.has(dismissKey);
        const isMatched = e.matchStatus === "matched";
        const isSuggested = e.matchStatus === "suggested" && !isDismissed;
        const isSkipped = e.matchStatus === "skipped";
        const isPastDue = e.matchStatus === "past_due";
        const override = overrideLookup.get(dismissKey);
        const isOverrideConverted = isSkipped && override?.notes?.includes("Converted to actual income");
        const isConverted = e.matchStatus === "converted" || isOverrideConverted;
        const _t = (e.streamCompanyType || "").toLowerCase();
        const isBizType = _t === "1099" || _t === "k1" || _t === "1099_schedule_c" || _t === "k1_partnership" || _t === "scorp_distribution";
        const viewDestination = isBizType ? "/business-activity" : "/personal-income";
        const viewLabel = isBizType ? "Business Activity" : "Personal Income";
        const statusLabel = isConverted ? "Converted" : isMatched ? "Matched" : isSuggested ? "Suggested match" : isSkipped ? "Skipped" : isPastDue ? "Past due" : "Active";
        const statusTone = isConverted || isMatched ? "success" : isSuggested || isPastDue ? "warning" : isSkipped ? "destructive" : "default";

        const sections: DetailSection[] = [
          {
            title: "Basic details",
            fields: [
              { label: "Source", value: e.label },
              { label: "Type", value: e.type === "bonus" ? "Bonus" : "Paycheck" },
              ...(e.streamCompanyType ? [{ label: "Filing", value: e.streamCompanyType }] : []),
              { label: "Status", value: statusLabel },
              ...(isMatched && e.matchedAmount != null ? [{ label: "Actual deposit", value: fmtFull(e.matchedAmount), mono: true }] : []),
            ],
          },
          {
            title: "Tax details",
            fields: [
              { label: "Gross", value: fmtFull(e.grossAmount), mono: true },
              { label: "Net received", value: fmtFull(Math.max(0, e.grossAmount - (e.taxesWithheld || 0) - (e.retirement401k || 0))), mono: true },
              ...(e.taxesWithheld > 0 ? [{ label: "Federal", value: fmtFull(e.taxesWithheld), mono: true }] : []),
              ...(e.retirement401k > 0 ? [{ label: "401(k)", value: fmtFull(e.retirement401k), mono: true }] : []),
            ],
          },
        ];

        const primaryActions = (
          <>
            {!isConverted && !isMatched && !isSkipped && (
              <Button variant="outline" size="sm" className="justify-start" onClick={() => { setDetailEntry(null); openConvert(e); }}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Convert to ledger
              </Button>
            )}
            {(isConverted || isMatched) && (
              <Button variant="outline" size="sm" className="justify-start" onClick={() => { setDetailEntry(null); navigate(viewDestination); }}>
                <ExternalLink className="h-4 w-4 mr-2" /> Open in {viewLabel}
              </Button>
            )}
            {isSkipped ? (
              <Button variant="outline" size="sm" className="justify-start" onClick={() => { setDetailEntry(null); handleRestore(e); }}>
                <RotateCcw className="h-4 w-4 mr-2" /> Restore
              </Button>
            ) : !isConverted && (
              <Button variant="outline" size="sm" className="justify-start text-destructive" onClick={() => { setDetailEntry(null); handleSkip(e); }}>
                <X className="h-4 w-4 mr-2" /> Skip
              </Button>
            )}
          </>
        );

        return (
          <TransactionDetailSheet
            open={!!detailEntry}
            onOpenChange={(o) => { if (!o) setDetailEntry(null); }}
            header={{
              title: e.label,
              date: formatDate(e.date),
              amount: e.grossAmount,
              amountTone: isSkipped ? "neutral" : "income",
              badges: [{ label: statusLabel, tone: statusTone }],
            }}
            sections={sections}
            primaryActions={primaryActions}
            onEdit={() => { const t = e; setDetailEntry(null); openOverrideEdit(t); }}
            hideDelete
          />
        );
      })()}
    </div>
  );
}

function CompanyAccordion({
  streams,
  onEdit,
  onDelete,
  expired,
}: {
  streams: ProjectedIncomeStream[];
  onEdit: (s: ProjectedIncomeStream) => void;
  onDelete: (id: string) => void;
  expired?: boolean;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, ProjectedIncomeStream[]>();
    for (const s of streams) {
      const key = s.company || "Unnamed";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [streams]);

  const annualMultiplier = (s: ProjectedIncomeStream) => {
    switch (s.pay_frequency) {
      case "weekly": return 52;
      case "biweekly": return 26;
      case "monthly": return 12;
      case "custom": return Math.floor(365 / (s.custom_interval_days || 14));
      case "single": return 1;
      default: return 26;
    }
  };

  const nextExpectedDate = (s: ProjectedIncomeStream): Date | null => {
    if (s.pay_frequency === "single") {
      const d = new Date(s.start_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return d >= today ? d : null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = s.end_date ? new Date(s.end_date) : null;
    if (end && end < today) return null;

    let current = new Date(s.start_date);
    current.setHours(0, 0, 0, 0);
    if (current >= today) return current;

    const addDays = (d: Date, days: number) => {
      const r = new Date(d);
      r.setDate(r.getDate() + days);
      return r;
    };
    const addWeeks = (d: Date, w: number) => addDays(d, w * 7);
    const addMonths = (d: Date, m: number) => {
      const r = new Date(d);
      r.setMonth(r.getMonth() + m);
      return r;
    };

    while (current < today) {
      switch (s.pay_frequency) {
        case "weekly": current = addWeeks(current, 1); break;
        case "biweekly": current = addWeeks(current, 2); break;
        case "monthly": current = addMonths(current, 1); break;
        case "custom": current = addDays(current, s.custom_interval_days || 14); break;
        default: current = addWeeks(current, 2);
      }
      if (end && current > end) return null;
    }
    return current;
  };

  return (
    <Accordion type="multiple" className="space-y-2">
      {grouped.map(([company, companyStreams]) => {
        const monthlyTotal = companyStreams.reduce((sum, s) => {
          const annual = s.paycheck_amount * annualMultiplier(s);
          return sum + annual / 12;
        }, 0);
        const annualTotal = companyStreams.reduce((sum, s) => {
          return sum + s.paycheck_amount * annualMultiplier(s);
        }, 0);

        return (
          <AccordionItem
            key={company}
            value={company}
            className={`rounded-lg border border-border ${expired ? "opacity-60" : ""}`}
          >
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 w-full pr-4">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-foreground truncate">{company}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {companyStreams.length} {companyStreams.length === 1 ? "stream" : "streams"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground sm:ml-auto shrink-0">
                  <span>Mo: <span className="font-medium text-foreground">{fmt(monthlyTotal)}</span></span>
                  <span>Yr: <span className="font-medium text-foreground">{fmt(annualTotal)}</span></span>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="space-y-2 pt-2">
                {companyStreams.map((s) => {
                  const nextDate = nextExpectedDate(s);
                  const subtype = subtypeMeta(s.ui_income_subtype || "");
                  return (
                    <div
                      key={s.id}
                      className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-medium text-sm text-foreground">
                            {subtype?.label || s.ui_income_subtype || "Income"}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span>{PAY_FREQUENCIES.find((f) => f.value === s.pay_frequency)?.label || s.pay_frequency}</span>
                            <span className="text-success font-medium">{fmtFull(s.paycheck_amount)}</span>
                            {nextDate && (
                              <span>Next: {formatDate(nextDate)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant={s.is_active ? "default" : "secondary"} className="text-xs">
                            {s.is_active ? "Active" : "Paused"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(s)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(s.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sublabel,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/20 bg-primary/5" : ""}>
      <CardContent className="pt-4 pb-4 space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        <p className={`text-2xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>
          {value}
        </p>
        {sublabel && (
          <p className="text-xs text-muted-foreground">{sublabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

