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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCompanies } from "@/contexts/CompanyContext";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useAddIncome } from "@/hooks/useIncome";
import { useAddPersonalIncome } from "@/hooks/usePersonalIncome";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  useProjectedStreams, useProjectedBonuses, useStreamOverrides,
  useAddStream, useUpdateStream, useDeleteStream,
  useAddBonus, useDeleteBonus, useUpdateBonus,
  useAddOverride, useDeleteOverride,
  usePlannerConversions,
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
  const { data: taxSettings } = useTaxSettings();
  const { forecastEstimate, forecastDebug } = useTaxEstimate();

  const addStream = useAddStream();
  const updateStream = useUpdateStream();
  const deleteStream = useDeleteStream();
  const addOverride = useAddOverride();
  const deleteOverride = useDeleteOverride();
  const deleteBonus = useDeleteBonus();
  const updateBonus = useUpdateBonus();
  const addIncome = useAddIncome();
  const addPersonalIncome = useAddPersonalIncome();
  const createSource = useCreateIncomeSource();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StreamForm>(emptyForm());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [convertTarget, setConvertTarget] = useState<ProjectedPaycheck | null>(null);
  const [convertDestination, setConvertDestination] = useState<"business" | "personal">("business");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showSourceError, setShowSourceError] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(() => {
    const current = new Date().getMonth();
    return new Set([current]);
  });

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

  const projectedPaychecks = useMemo(() => {
    if (!streams || !bonuses) return [];
    return generateProjectedPaychecks(streams, bonuses, incomeEntriesForMatching, overrides || [], plannerConversions || []);
  }, [streams, bonuses, incomeEntriesForMatching, overrides, plannerConversions]);

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

  const expectedAnnual = actualYTD.income + projectedTotals.grossIncome;
  const projectedWithholding = actualYTD.withheld + projectedTotals.taxesWithheld;
  const projected401k = actualYTD.retirement + projectedTotals.retirement401k;
  const projectedRefund = forecastDebug ? Math.max(0, forecastDebug.countedCreditsTotal - forecastDebug.totalEstimatedTax) : 0;
  const projectedGap = forecastDebug?.remainingTaxDue ?? 0;
  const visibleIncomeSubtypes = useMemo(() => {
    if (!isW2Only) return INCOME_SUBTYPES.filter((t) => {
      if ((t.value === "w2_user" || t.value === "w2_partner") && taxSettings?.enabledIncomeSources?.w2 === false) return t.value === form.ui_income_subtype;
      if (t.value === "1099_schedule_c" && taxSettings?.enabledIncomeSources?.form1099 === false) return t.value === form.ui_income_subtype;
      if (t.value === "k1_partnership" && taxSettings?.enabledIncomeSources?.k1 === false) return t.value === form.ui_income_subtype;
      return true;
    });
    return INCOME_SUBTYPES.filter((t) => t.value === "w2_user" || t.value === "w2_partner" || t.value === form.ui_income_subtype);
  }, [isW2Only, form.ui_income_subtype, taxSettings?.enabledIncomeSources]);

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

    // Persist new source if requested
    let payloadSourceId = form.source_id;
    if (!payloadSourceId && form.source_save_as_new && form.source_new_kind && form.source_name.trim()) {
      try {
        payloadSourceId = await persistNewSourceIfRequested(
          {
            otherName: form.source_name,
            saveAsNew: true,
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
          sublabel={`${fmt(actualYTD.income)} actual + ${fmt(projectedTotals.grossIncome)} projected`}
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

        <div className="space-y-1.5">
          {MONTHS.map((monthName, idx) => {
            const entries = byMonth.get(idx) || [];
            const activeEntries = entries.filter((e) => e.matchStatus === "active");
            const matchedEntries = entries.filter((e) => e.matchStatus === "matched");
            const pastDueEntries = entries.filter((e) => e.matchStatus === "past_due");
            const skippedEntries = entries.filter((e) => e.matchStatus === "skipped");
            const convertedEntries = entries.filter((e) => e.matchStatus === "converted");
            const monthTotal = activeEntries.reduce((s, e) => s + e.grossAmount, 0);
            const monthWithheld = activeEntries.reduce((s, e) => s + e.taxesWithheld, 0);
            const isExpanded = expandedMonths.has(idx);
            const isPast = idx < currentMonth;
            const isCurrent = idx === currentMonth;

            return (
              <Collapsible key={idx} open={isExpanded} onOpenChange={() => toggleMonth(idx)}>
                <CollapsibleTrigger asChild>
                  <button
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors text-left ${
                      isCurrent
                        ? "border-primary/30 bg-primary/5"
                        : isPast
                        ? "border-border/50 bg-muted/30 opacity-60"
                        : "border-border bg-card hover:bg-accent/5"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium text-foreground">{monthName}</span>
                      {activeEntries.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {activeEntries.length} upcoming
                        </Badge>
                      )}
                      {matchedEntries.length > 0 && (
                        <Badge variant="outline" className="text-xs border-emerald-400 text-emerald-600 dark:text-emerald-400">
                          {matchedEntries.length} matched
                        </Badge>
                      )}
                      {convertedEntries.length > 0 && (
                        <Badge variant="outline" className="text-xs border-emerald-400 text-emerald-600 dark:text-emerald-400">
                          {convertedEntries.length} converted
                        </Badge>
                      )}
                      {pastDueEntries.length > 0 && (
                        <Badge variant="outline" className="text-xs border-amber-400 text-amber-600 dark:text-amber-400">
                          {pastDueEntries.length} needs review
                        </Badge>
                      )}
                      {skippedEntries.length > 0 && (
                        <Badge variant="outline" className="text-xs border-muted text-muted-foreground">
                          {skippedEntries.length} skipped
                        </Badge>
                      )}
                      {isCurrent && (
                        <Badge variant="default" className="text-xs">Current</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      {monthTotal > 0 && (
                        <span className="font-semibold text-success">{fmt(monthTotal)}</span>
                      )}
                      {monthWithheld > 0 && (
                        <span className="text-muted-foreground">{fmt(monthWithheld)} tax</span>
                      )}
                    </div>
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
                      const isMatched = entry.matchStatus === "matched";
                      const isPastDue = entry.matchStatus === "past_due";
                      const isSkipped = entry.matchStatus === "skipped";
                      const isActive = entry.matchStatus === "active";
                      const isAutoConverted = entry.matchStatus === "converted";

                      // Check if this skipped entry was converted (legacy: existing override-based flow)
                      const override = overrideLookup.get(`${entry.streamId}:${entry.date}`);
                      const isOverrideConverted = isSkipped && override?.notes?.includes("Converted to actual income");
                      const isConverted = isAutoConverted || isOverrideConverted;

                      // Determine link destination for matched/converted entries
                      const _t = (entry.streamCompanyType || "").toLowerCase();
                      const isBizType = _t === "1099" || _t === "k1" || _t === "1099_schedule_c" || _t === "k1_partnership" || _t === "scorp_distribution";
                      const viewDestination = isBizType ? "/business-activity" : "/personal-income";
                      const viewLabel = isBizType ? "Business Activity" : "Personal Income";

                      return (
                        <div
                          key={i}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-md border bg-card ${
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
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs text-muted-foreground w-12 shrink-0">{entry.date.slice(5)}</span>
                            <span className={`text-sm font-medium truncate ${isSkipped || isMatched || isConverted ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {entry.label}
                            </span>
                            {entry.type === "bonus" && (
                              <Badge variant="secondary" className="text-xs shrink-0">Bonus</Badge>
                            )}
                            {isMatched && (
                              <Badge variant="outline" className="text-xs shrink-0 border-emerald-400 text-emerald-600 dark:text-emerald-400 gap-0.5">
                                <CheckCircle2 className="h-2.5 w-2.5" /> Matched
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
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Matched entry: show actual amount + link to view */}
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
                            {/* Converted entry: show link to destination ledger */}
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
                            {/* Actions for active entries */}
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
                            {/* Actions for bonus entries (active or past-due, not converted/matched/skipped) */}
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
                            {/* Restore for skipped (non-converted) entries */}
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
                            {/* Restore modified */}
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
          })}
        </div>

      {streams && streams.length > 0 && (() => {
        const activeStreams = streams.filter((s) => !isStreamExpired(s));
        const expiredStreams = streams.filter((s) => isStreamExpired(s));
        return (
          <>
            {activeStreams.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground">Income Streams</h2>
                <StreamTable
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
                <StreamTable
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
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setField("start_date", e.target.value)}
                />
              </div>
              {!isOneTime && (
                <div className="space-y-1.5">
                  <Label>End Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setField("end_date", e.target.value)}
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
              <Input
                type="date"
                value={overrideForm.new_date}
                onChange={(e) => setOverrideForm((p) => ({ ...p, new_date: e.target.value }))}
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
              <Input
                type="date"
                value={bonusEditForm.scheduled_date}
                onChange={(e) => setBonusEditForm((p) => ({ ...p, scheduled_date: e.target.value }))}
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
    </div>
  );
}

function StreamTable({
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
  return (
    <div className={`rounded-lg border border-border ${expired ? "opacity-60" : ""}`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead className="hidden sm:table-cell">Frequency</TableHead>
            <TableHead className="text-right whitespace-nowrap">Gross / Pay</TableHead>
            <TableHead className="text-right whitespace-nowrap hidden md:table-cell">Withholding</TableHead>
            <TableHead className="text-right whitespace-nowrap hidden lg:table-cell">401(k)</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            <TableHead className="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {streams.map((s) => (
            <TableRow key={s.id} className={!s.is_active ? "opacity-50" : ""}>
              <TableCell className="font-medium min-w-0"><span className="block truncate">{s.company}</span></TableCell>
              <TableCell className="text-muted-foreground text-sm hidden sm:table-cell">
                {PAY_FREQUENCIES.find((f) => f.value === s.pay_frequency)?.label || s.pay_frequency}
              </TableCell>
              <TableCell className="text-right font-medium text-success whitespace-nowrap tabular-nums">
                {fmtFull(s.paycheck_amount)}
              </TableCell>
              <TableCell className="text-right text-sm whitespace-nowrap tabular-nums hidden md:table-cell">{fmtFull(s.taxes_withheld)}</TableCell>
              <TableCell className="text-right text-sm whitespace-nowrap tabular-nums hidden lg:table-cell">{fmtFull(s.retirement_401k)}</TableCell>
              <TableCell className="hidden sm:table-cell">
                <Badge variant={expired ? "secondary" : s.is_active ? "default" : "secondary"}>
                  {expired ? "Expired" : s.is_active ? "Active" : "Paused"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1 justify-end">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(s)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(s.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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

