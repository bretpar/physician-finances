import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Check, ChevronLeft, PencilLine, Building2, CalendarClock, LineChart } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTaxSettings, useUpdateTaxSettings } from "@/hooks/useTaxSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { YtdCatchupForm } from "@/components/YtdCatchupForm";

import { useYtdCatchupEntries, backfillYtdCatchupCompanies } from "@/hooks/useYtdCatchup";
import { getUserOrgId } from "@/hooks/useOrgId";
import {
  DEFAULT_ONBOARDING_SETTINGS,
  getAllowedCompanyTypes,
  incomeProfileToSources,
  incomeSourcesToHouseholdStreams,
  onboardingCompanyTypeToFilingType,
  taxRecommendationToWithholdingMethod,
  type OnboardingCompanyDraft,
  type OnboardingCompanyType,
  type OnboardingPayFrequency,
  type IncomeProfileType,
  type UserOnboardingSettings,
} from "@/lib/onboarding";

// Temporary MVP behavior: all users receive full access. Re-enable plan
// selection when paid tiers launch (was 3 with a Free vs Premium step 3).
const TOTAL_STEPS = 2;

const companyTypeLabels: Record<OnboardingCompanyType, string> = {
  w2: "W-2 Employer",
  "1099": "1099 Business",
  k1: "K-1 Partnership / S-Corp",
};

function SelectCard({ selected, title, description, onClick, children }: { selected: boolean; title: string; description: string; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("w-full rounded-xl border p-4 text-left transition-colors", selected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
          {selected && <Check className="h-3 w-3" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-card-foreground">{title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
          {children && <span className="mt-3 block text-xs text-muted-foreground">{children}</span>}
        </span>
      </div>
    </button>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: taxSettings, isLoading } = useTaxSettings(!!user);
  const updateTaxSettings = useUpdateTaxSettings();
  const [step, setStep] = useState(() => Number(sessionStorage.getItem("paycheckmd-onboarding-step")) || 1);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<UserOnboardingSettings>(() => ({ ...DEFAULT_ONBOARDING_SETTINGS, onboardingComplete: false }));
  const COMPANY_DRAFTS_KEY = "paycheckmd-onboarding-company-drafts";
  const [companyDrafts, setCompanyDrafts] = useState<OnboardingCompanyDraft[]>(() => {
    try {
      if (typeof window === "undefined") return [];
      const raw = sessionStorage.getItem(COMPANY_DRAFTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OnboardingCompanyDraft[]) : [];
    } catch {
      return [];
    }
  });
  // Persist companyDrafts across re-renders / step transitions so that a
  // refetch-triggered render (or an accidental remount) cannot wipe the
  // employers the user just added — which previously caused the YTD step
  // to show "No companies yet" even after a successful continue.
  useEffect(() => {
    try {
      sessionStorage.setItem(COMPANY_DRAFTS_KEY, JSON.stringify(companyDrafts));
    } catch {
      /* sessionStorage may be unavailable; non-fatal */
    }
  }, [companyDrafts]);
  // New onboarding order: company setup first → ask about YTD catch-up →
  // (optionally) catch-up form. Kept the same sub-step identifiers so any
  // in-progress local state from prior sessions still maps correctly.
  const [catchupSubStep, setCatchupSubStep] = useState<"ask" | "form" | "company">("company");
  // When the brand-new user lands here right after signup we show a single
  // "How do you want to add income?" picker instead of the multi-step flow.
  const [showIncomeMethodPicker, setShowIncomeMethodPicker] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem("paycheckmd-onboarding-start") === "income-method",
  );
  const { data: existingCatchups } = useYtdCatchupEntries();
  const [editingCatchup, setEditingCatchup] = useState<import("@/hooks/useYtdCatchup").YtdCatchupEntry | null>(null);
  const [catchupFormKey, setCatchupFormKey] = useState(0);
  const [showCatchupForm, setShowCatchupForm] = useState(true);
  const [lastSavedName, setLastSavedName] = useState<string | null>(null);
  const [localSavedCatchups, setLocalSavedCatchups] = useState(0);
  const catchupFormRef = useRef<HTMLDivElement | null>(null);
  const filingStatusRef = useRef<UserOnboardingSettings["filingStatus"]>("single");

  const settingsId = taxSettings?.id;
  const merged = useMemo(() => taxSettings ? {
    ...draft,
    firstName: draft.firstName || taxSettings.onboardingFirstName || "",
    filingStatus: draft.filingStatus || taxSettings.filingStatus || "single",
    onboardingStep: taxSettings.onboardingStep || draft.onboardingStep || 1,
    incomeProfileType: draft.incomeProfileType || taxSettings.incomeProfileType,
  } : draft, [draft, taxSettings]);
  const catchupChoice = merged.ytdCatchupChoice ?? null;

  // Hydrate local draft/step from server ONCE on initial load. Subsequent
  // refetches (triggered by our own persist() calls) must NOT overwrite the
  // user's in-progress local state — otherwise clicking Continue can race the
  // refetch and snap the UI back to a previous step or reset the income-type
  // selection the user just made.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!user || isLoading || !taxSettings) return;
    hydratedRef.current = true;
    const savedStep = Math.min(TOTAL_STEPS, Math.max(1, taxSettings.onboardingStep || 1));
    filingStatusRef.current = taxSettings.filingStatus || "single";
    setStep(savedStep);
    sessionStorage.setItem("paycheckmd-onboarding-step", String(savedStep));
    setDraft((current) => ({
      ...current,
      firstName: current.firstName || taxSettings.onboardingFirstName || "",
      filingStatus: taxSettings.filingStatus || current.filingStatus || "single",
      onboardingStep: savedStep,
      incomeProfileType: taxSettings.incomeProfileType || current.incomeProfileType,
      enabledIncomeSources: taxSettings.enabledIncomeSources || current.enabledIncomeSources,
      enabledPersonalIncomeTypes: taxSettings.enabledPersonalIncomeTypes || current.enabledPersonalIncomeTypes,
      taxRecommendationMethod: taxSettings.taxRecommendationMethod || current.taxRecommendationMethod,
      flatFederalRate: taxSettings.flatFederalRate ?? current.flatFederalRate,
      flatStateRate: taxSettings.flatStateRate ?? current.flatStateRate,
      deductionStrategy: taxSettings.deductionStrategy || current.deductionStrategy,
      enabledDeductionTypes: taxSettings.enabledDeductionTypes || current.enabledDeductionTypes,
      subscriptionTier: taxSettings.subscriptionTier || current.subscriptionTier,
      ytdCatchupChoice: taxSettings.ytdCatchupChoice ?? current.ytdCatchupChoice ?? null,
    }));
  }, [user, isLoading, taxSettings]);

  // No auto-advance between sub-steps based on catchupChoice. The new flow
  // is driven explicitly: Continue advances company → ask → form, and the
  // "ask" SelectCards just record the choice. This prevents jumping past
  // the company setup step when the user reloads with a saved choice.

  // Auto-seed the first company draft when we land on the company sub-step so
  // the employer-name input is rendered without requiring a click on
  // "Add another...". Keeps the manual UI behavior identical when the user
  // has already added drafts.
  useEffect(() => {
    if (step !== 2) return;
    if (catchupSubStep !== "company") return;
    setCompanyDrafts((current) => {
      if (current.length > 0) return current;
      const allowed = getAllowedCompanyTypes(merged.incomeProfileType);
      const draftsFromCatchups = (existingCatchups || [])
        .filter((entry) => entry.company_name)
        .map((entry) => ({
          name: entry.company_name,
          type: entry.source_type === "w2" ? "w2" as const : entry.source_type === "1099_k1" ? "1099" as const : allowed[0],
          description: "",
          payFrequency: entry.source_type === "w2" ? "biweekly" as const : undefined,
        }))
        .filter((company) => allowed.includes(company.type));
      const unique = Array.from(new Map(draftsFromCatchups.map((company) => [`${company.name.trim().toLowerCase()}::${company.type}`, company])).values());
      return unique.length > 0 ? unique : [{ name: "", type: allowed[0], description: "" }];
    });
  }, [step, catchupSubStep, merged.incomeProfileType, existingCatchups]);

  if (!authLoading && !user) return <Navigate to="/signup" replace />;
  if (user && taxSettings?.onboardingComplete === true) return <Navigate to="/" replace />;


  const patch = (updates: Partial<UserOnboardingSettings>) => setDraft((current) => ({ ...current, ...updates }));

  const allowedCompanyTypes = getAllowedCompanyTypes(merged.incomeProfileType);
  const companySetupCopy = {
    w2_only: {
      title: "Add your employer",
      subtitle: "Add the employer that sends your W-2 paycheck. You can add more later in Settings.",
      nameLabel: "Employer name",
      namePlaceholder: "e.g. Providence",
      addLabel: "Add another W-2 employer",
    },
    w2_plus_business: {
      title: "Add your income sources",
      subtitle: "Add the employers, businesses, or partnerships you want PaycheckMD to track. You can add more later.",
      nameLabel: "Company or employer name",
      namePlaceholder: "e.g. Hospital Group or Consulting LLC",
      addLabel: "Add another income source",
    },
    business_only: {
      title: "Add your business income sources",
      subtitle: "Add the businesses, partnerships, or contractor income sources you want PaycheckMD to track. You can add more later.",
      nameLabel: "Company or business name",
      namePlaceholder: "e.g. Consulting LLC",
      addLabel: "Add another business source",
    },
  }[merged.incomeProfileType];

  const addCompanyDraft = () => setCompanyDrafts((current) => [...current, { name: "", type: allowedCompanyTypes[0], description: "" }]);
  const updateCompanyDraft = (index: number, updates: Partial<OnboardingCompanyDraft>) => setCompanyDrafts((current) => current.map((item, i) => i === index ? { ...item, ...updates } : item));
  const removeCompanyDraft = (index: number) => setCompanyDrafts((current) => current.filter((_, i) => i !== index));

  const goBack = async () => {
    if (step === 1) return;
    if (step === 2 && catchupSubStep === "form") {
      setCatchupSubStep("ask");
      return;
    }
    if (step === 2 && catchupSubStep === "ask") {
      setCatchupSubStep("company");
      return;
    }
    // step 3 → back to step 2 form/ask/company (resume where they were)
    const nextStep = step - 1;
    setStep(nextStep);
    sessionStorage.setItem("paycheckmd-onboarding-step", String(nextStep));
    patch({ onboardingStep: nextStep });
    if (settingsId) await persist({ onboardingStep: nextStep, onboardingComplete: false });
  };

  const selectIncomeProfile = (incomeProfileType: IncomeProfileType) => {
    const allowed = getAllowedCompanyTypes(incomeProfileType);
    patch({
      incomeProfileType,
      enabledIncomeSources: incomeProfileToSources(incomeProfileType),
      taxRecommendationMethod: "dynamic_actual",
      deductionStrategy: "standard",
      enabledPersonalIncomeTypes: [],
    });
    setCompanyDrafts((current) => current.map((company) => allowed.includes(company.type) ? company : { ...company, type: allowed[0] }));
  };

  const selectFilingStatus = async (filingStatus: UserOnboardingSettings["filingStatus"]) => {
    filingStatusRef.current = filingStatus;
    patch({ filingStatus });
    if (!settingsId) return;
    try {
      await updateTaxSettings.mutateAsync({ id: settingsId, filingStatus });
    } catch (e: any) {
      toast.error(e?.message || "Could not save filing status.");
    }
  };

  const skipCompanyStep = async () => {
    if (saving) return;
    setSaving(true);
    try {
      setCompanyDrafts([]);
      const nextStep = 3;
      await persist({ onboardingComplete: false, onboardingStep: nextStep });
      patch({ onboardingStep: nextStep });
      sessionStorage.setItem("paycheckmd-onboarding-step", String(nextStep));
      setStep(nextStep);
    } catch (error: any) {
      toast.error(error.message || "Could not save onboarding.");
    } finally {
      setSaving(false);
    }
  };

  async function createOnboardingCompanies() {
    if (!user) return;
    const allowed = getAllowedCompanyTypes(merged.incomeProfileType);
    const { data: persistedCatchups } = await (supabase as any)
      .from("ytd_catchup_entries")
      .select("company_name, source_type, gross_income")
      .eq("user_id", user.id);
    const normName = (s: string) => String(s || "").trim().toLowerCase();
    const catchupDrafts: OnboardingCompanyDraft[] = ((persistedCatchups || []) as any[])
      .filter((entry) => entry.company_name)
      .map((entry) => ({
        name: String(entry.company_name || ""),
        // Default catchup-derived business rows to 1099. The user's explicit
        // selection in the company setup step (k1, etc.) overrides this via
        // dedupe-by-name below — never insert both.
        type: entry.source_type === "w2" ? "w2" : entry.source_type === "1099_k1" ? "1099" : allowed[0],
        description: "",
        payFrequency: entry.source_type === "w2" ? ("biweekly" as const) : undefined,
        projectedAnnualGross: Number(entry.gross_income) > 0 ? Number(entry.gross_income) : null,
      }))
      .filter((company) => allowed.includes(company.type));

    // Build a name-keyed map. User-entered drafts take priority over
    // catch-up-derived drafts so picking "K-1" in the company step
    // reclassifies the row instead of creating a parallel 1099 record.
    const draftsByName = new Map<string, OnboardingCompanyDraft>();
    for (const cd of catchupDrafts) {
      const k = normName(cd.name);
      if (k) draftsByName.set(k, { ...cd, name: cd.name.trim() });
    }
    for (const ud of companyDrafts) {
      const trimmed = { ...ud, name: ud.name.trim(), description: ud.description?.trim() || "" };
      const k = normName(trimmed.name);
      if (!k && !trimmed.description) continue;
      if (!k) continue;
      const prior = draftsByName.get(k);
      // User draft wins on type/payFrequency/k1SeTaxable; preserve
      // projectedAnnualGross from the catch-up if the user didn't provide one.
      draftsByName.set(k, {
        ...prior,
        ...trimmed,
        projectedAnnualGross: trimmed.projectedAnnualGross ?? prior?.projectedAnnualGross ?? null,
      });
    }
    const mergedDrafts = Array.from(draftsByName.values());
    const incompleteDraft = mergedDrafts.find((company) => !company.name || !company.type);
    if (incompleteDraft) throw new Error("Add a company name or remove the unfinished company card.");
    const validDrafts = mergedDrafts.filter((company) => company.name && allowed.includes(company.type));
    if (validDrafts.length === 0) return;
    const orgId = await getUserOrgId();
    const { data: existing, error: existingError } = await supabase
      .from("companies")
      .select("id, name, company_type")
      .eq("user_id", user.id);
    if (existingError) throw existingError;
    // Dedupe against existing companies by normalized name ONLY (not name+type)
    // so a previously-created "Northwest Orthopedic Partners" as 1099 is
    // updated to k1_partnership rather than duplicated when the user
    // re-classifies it during company setup.
    const existingByName = new Map<string, any>();
    for (const c of (existing || []) as any[]) {
      const k = normName(c.name);
      if (k && !existingByName.has(k)) existingByName.set(k, c);
    }

    const toInsert: any[] = [];
    const toUpdate: Array<{ id: string; patch: any }> = [];
    for (const company of validDrafts) {
      const companyType = onboardingCompanyTypeToFilingType(company.type);
      const isK1 = company.type === "k1";
      // Active K-1 → SE tax applies. Passive → no SE tax. "Unsure" defaults
      // conservatively to NOT including SE tax in recommendations (matches
      // typical limited-partner behavior); user can flip in Settings.
      const includeSeTax = isK1
        ? company.k1SeTaxable === "active"
        : true;
      const row = {
        user_id: user.id,
        organization_id: orgId,
        name: company.name,
        nickname: company.description || company.name,
        notes: company.description || "",
        company_type: companyType,
        source_kind: company.type === "w2" ? "w2_employer" : companyType,
        include_in_tax: true,
        default_setaside_method: "recommended",
        default_setaside_pct: null,
        advanced_field_visibility: {},
        apply_business_state_tax: true,
        include_se_tax_in_recommendation: includeSeTax,
        pay_frequency: company.type === "w2" ? (company.payFrequency || "biweekly") : null,
        projected_annual_gross: company.projectedAnnualGross ?? null,
        // Persist W-2 spouse/primary ownership so the W-4 page and Personal
        // Income labels can show the correct owner. Only meaningful for W-2.
        employee_role:
          company.type === "w2" ? (company.employeeRole || "primary") : null,
      };
      const existingRow = existingByName.get(normName(company.name));
      if (existingRow) {
        // Reclassify only if changed. Always patch SE-tax flag for K-1.
        const patch: any = {};
        if (existingRow.company_type !== companyType) {
          patch.company_type = companyType;
          patch.source_kind = row.source_kind;
        }
        if (isK1) patch.include_se_tax_in_recommendation = includeSeTax;
        if (company.type === "w2") {
          // Row-scoped: persist each W-2 employer's own role independently.
          // Default to "primary" when the draft never set one so the DB
          // reflects what the UI shows (the selector defaults to You).
          patch.employee_role = company.employeeRole || "primary";
        }
        if (Object.keys(patch).length > 0) toUpdate.push({ id: existingRow.id, patch });
      } else {
        toInsert.push(row);
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("companies").insert(toInsert as any);
      if (error) throw error;
    }
    for (const u of toUpdate) {
      const { error } = await supabase.from("companies").update(u.patch as any).eq("id", u.id);
      if (error) console.warn("[onboarding] company reclassify update failed", error);
    }
    // Link YTD catch-up entries + their mirror tx/income rows to the final
    // company by normalized name (now unique per name → backfill matches
    // unambiguously and propagates the K-1 company_type onto the mirrors).
    try { await backfillYtdCatchupCompanies(); } catch (e) { console.warn("[onboarding] backfill ytd catch-up failed", e); }
  }


  async function persist(partial: Partial<UserOnboardingSettings> = {}) {
    if (!settingsId) throw new Error("Onboarding settings are still loading. Please try again in a moment.");
    const next = { ...merged, filingStatus: filingStatusRef.current, ...partial };
    const sources = incomeProfileToSources(next.incomeProfileType);
    // Dashboard Personalization defaults should reflect the income types the
    // user actually configured during onboarding (companyDrafts), not just
    // the broad income profile. Without this, picking "W-2 + business" but
    // adding only a W-2 employer (e.g. for a W-2 + investments user) would
    // turn on 1099 and K-1 sections that have no underlying companies.
    const hasW2Company = companyDrafts.some((c) => c.type === "w2" && c.name);
    const has1099Company = companyDrafts.some((c) => c.type === "1099" && c.name);
    const hasK1Company = companyDrafts.some((c) => c.type === "k1" && c.name);
    const baseStreams = incomeSourcesToHouseholdStreams(sources, next.enabledPersonalIncomeTypes);
    const householdIncomeStreams = {
      ...baseStreams,
      w2Income: sources.w2 && (hasW2Company || baseStreams.w2Income),
      business1099Income: sources.form1099 && has1099Company,
      k1PartnershipIncome: sources.k1 && hasK1Company,
    };
    await updateTaxSettings.mutateAsync({
      id: settingsId,
      filingStatus: next.filingStatus,
      onboardingComplete: next.onboardingComplete,
      onboardingFirstName: next.firstName,
      onboardingStep: next.onboardingStep,
      incomeProfileType: next.incomeProfileType,
      enabledIncomeSources: sources,
      enabledPersonalIncomeTypes: next.enabledPersonalIncomeTypes,
      householdIncomeStreams,
      taxRecommendationMethod: next.taxRecommendationMethod,
      withholdingMethod: taxRecommendationToWithholdingMethod(next.taxRecommendationMethod),
      manualEffectiveTaxRate: next.taxRecommendationMethod === "flat_rate" ? next.flatFederalRate ?? taxSettings?.manualEffectiveTaxRate ?? 20 : taxSettings?.manualEffectiveTaxRate ?? null,
      flatFederalRate: next.flatFederalRate ?? null,
      flatStateRate: next.flatStateRate ?? null,
      deductionStrategy: next.deductionStrategy,
      deductionType: next.deductionStrategy === "itemized" ? "itemized" : "standard",
      enabledDeductionTypes: next.enabledDeductionTypes,
      hsaEnabled: next.enabledDeductionTypes.includes("hsa"),
      subscriptionTier: next.subscriptionTier,
      ytdCatchupChoice: next.ytdCatchupChoice ?? null,
    });
  }

  async function continueStep() {
    if (saving) return;
    if (step === 2) {
      // New order: company setup → ask about YTD → optional YTD form.
      if (catchupSubStep === "company") {
        setSaving(true);
        try {
          await createOnboardingCompanies();
          await persist({ onboardingComplete: false, onboardingStep: 2 });
          setCatchupSubStep("ask");
        } catch (error: any) {
          console.error("[onboarding] company continue failed", error);
          toast.error(error.message || "Could not save your companies.");
        } finally {
          setSaving(false);
        }
        return;
      }
      if (catchupSubStep === "ask") {
        if (!catchupChoice) {
          toast.error("Pick an option to continue.");
          return;
        }
        if (catchupChoice === "yes") {
          setCatchupSubStep("form");
          return;
        }
        // "no" or "skip" → complete onboarding. Plan selection step removed;
        // all users get premium access by default (MVP behavior).
        await completeOnboarding();
        return;
      }
      if (catchupSubStep === "form") {
        const normName = (s: string) => String(s || "").trim().toLowerCase();
        const sourceFor = (t: OnboardingCompanyType) => t === "w2" ? "w2" : "1099_k1";
        const namedCompanies = companyDrafts.filter((c) => c.name.trim());
        const missing = namedCompanies.find(
          (c) => !(existingCatchups || []).some(
            (e) => normName(e.company_name) === normName(c.name) && e.source_type === sourceFor(c.type),
          ),
        );
        if (namedCompanies.length === 0) {
          toast.error("Add at least one company before continuing.");
          return;
        }
        if (missing) {
          toast.error(`Please save ${missing.name} YTD income before continuing.`);
          return;
        }
        setSaving(true);
        try {
          // Re-run company creation in case the user added more companies
          // from the catch-up screen; createOnboardingCompanies is idempotent.
          await createOnboardingCompanies();
          setEditingCatchup(null);
          setShowCatchupForm(false);
        } catch (error: any) {
          toast.error(error.message || "Could not save onboarding.");
          setSaving(false);
          return;
        }
        setSaving(false);
        await completeOnboarding();
        return;
      }
    }
    setSaving(true);
    try {
      const nextStep = Math.min(TOTAL_STEPS, step + 1);
      if (step === 1) {
        const metadataFirst = (user?.user_metadata as any)?.first_name as string | undefined;
        const emailLocal = user?.email ? user.email.split("@")[0] : "";
        const finalFirstName = merged.firstName.trim() || (metadataFirst?.trim() || "") || emailLocal || "Friend";
        await supabase.from("profiles").update({ first_name: finalFirstName }).eq("user_id", user!.id);
        await persist({ firstName: finalFirstName, filingStatus: merged.filingStatus, onboardingComplete: false, onboardingStep: nextStep });
        patch({ firstName: finalFirstName });
      }
      patch({ onboardingStep: nextStep });
      sessionStorage.setItem("paycheckmd-onboarding-step", String(nextStep));
      setStep(nextStep);
    } catch (error: any) {
      console.error("[onboarding] continue failed", { step, catchupSubStep, settingsId }, error);
      toast.error(error.message || "Could not save onboarding.");
    } finally {
      setSaving(false);
    }
  }

  // Temporary MVP behavior: all users receive full access (premium) on
  // onboarding completion. Re-enable plan selection when paid tiers launch.
  async function completeOnboarding() {
    if (saving) return;
    setSaving(true);
    try {
      const selectedPlan = "premium";
      console.info("[onboarding] completion:start", { settingsId, selectedPlan, ytdCatchupChoice: merged.ytdCatchupChoice });
      await persist({ onboardingComplete: true, onboardingStep: TOTAL_STEPS, subscriptionTier: selectedPlan });
      const { data: completionRow, error: completionError } = await supabase
        .from("tax_settings")
        .select("onboarding_complete, subscription_tier")
        .eq("id", settingsId)
        .maybeSingle();
      if (completionError) throw completionError;
      if (completionRow?.onboarding_complete !== true) {
        throw new Error("Onboarding completion did not save. Please try again.");
      }
      patch({ onboardingComplete: true, onboardingStep: TOTAL_STEPS, subscriptionTier: selectedPlan });
      sessionStorage.removeItem("paycheckmd-onboarding-step");
      console.info("[onboarding] completion:success", { settingsId, selectedPlan });
      navigate("/", { replace: true });
      window.setTimeout(() => {
        if (window.location.pathname.startsWith("/onboarding")) window.location.replace("/");
      }, 750);
    } catch (error: any) {
      console.error("[onboarding] completion failed", { step, catchupSubStep, settingsId }, error);
      toast.error(error.message || "Could not complete onboarding.");
    } finally {
      setSaving(false);
    }
  }


  async function chooseIncomeMethod(method: "manual" | "bank" | "ytd" | "planner") {
    if (saving) return;
    setSaving(true);
    try {
      // Mark onboarding complete so the user lands in the app and is not bounced
      // back here on every page load. They can re-run setup from Settings.
      if (settingsId) {
        await persist({ onboardingComplete: true, onboardingStep: TOTAL_STEPS });
      }
      sessionStorage.removeItem("paycheckmd-onboarding-start");
      sessionStorage.removeItem("paycheckmd-onboarding-step");
      const destination =
        method === "manual" ? "/personal-income" :
        method === "bank" ? "/settings" :
        method === "ytd" ? "/personal-income?addYtd=1" :
        "/projected-income";
      navigate(destination, { replace: true });
    } catch (error: any) {
      toast.error(error.message || "Could not save your choice.");
    } finally {
      setSaving(false);
    }
  }

  if (showIncomeMethodPicker) {
    return (
      <div data-testid="onboarding-root" className="min-h-screen bg-background px-4 py-6 sm:py-10">
        <Card className="mx-auto w-full max-w-2xl">
          <CardContent className="space-y-6 p-5 sm:p-8">
            <div className="flex items-center gap-3">
              <BrandLogo className="h-10 w-10 rounded-xl" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Welcome{merged.firstName ? `, ${merged.firstName}` : ""}</p>
                <h1 className="mt-0.5 text-2xl font-semibold text-foreground">How do you want to add income?</h1>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Pick the option that fits how you’d like to start. You can mix and match later from any tab.</p>
            <div className="grid gap-3">
              <button type="button" disabled={saving} onClick={() => chooseIncomeMethod("manual")} className={cn("w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><PencilLine className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-card-foreground">Add income manually</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Enter paychecks, 1099 payments, or distributions one at a time.</span>
                  </span>
                </div>
              </button>
              <button type="button" disabled={saving} onClick={() => chooseIncomeMethod("bank")} className={cn("w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-card-foreground">Import from a bank or payroll connection</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Connect an account so deposits and paychecks import automatically.</span>
                  </span>
                </div>
              </button>
              <button type="button" disabled={saving} onClick={() => chooseIncomeMethod("ytd")} className={cn("w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><CalendarClock className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-card-foreground">Enter year-to-date income summary</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Add totals from your most recent paystub so recommendations stay accurate.</span>
                  </span>
                </div>
              </button>
              <button type="button" disabled={saving} onClick={() => chooseIncomeMethod("planner")} className={cn("w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><LineChart className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-card-foreground">Use Income Planner to estimate future income</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Project upcoming paychecks and bonuses to plan taxes ahead of time.</span>
                  </span>
                </div>
              </button>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <Button variant="ghost" onClick={() => { setShowIncomeMethodPicker(false); sessionStorage.removeItem("paycheckmd-onboarding-start"); }} disabled={saving}>Skip and finish onboarding</Button>
              <p className="text-xs text-muted-foreground">You can change this anytime.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="onboarding-root" className="min-h-screen bg-background px-4 py-6 sm:py-10">

      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="space-y-6 p-5 sm:p-8">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-10 w-10 rounded-xl" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Step {step} of {TOTAL_STEPS}</p>
              <div className="mt-1 h-2 w-44 max-w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} /></div>
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-4" data-testid="onboarding-step-1">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Confirm your income setup</h1>
                <p className="mt-1 text-sm text-muted-foreground">We pre-filled this from your estimate. Adjust if needed.</p>
              </div>
              <div>
                <Label htmlFor="onboarding-first-name">First name <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input id="onboarding-first-name" data-testid="onboarding-first-name-input" autoComplete="given-name" value={merged.firstName} onChange={(e) => patch({ firstName: e.target.value })} placeholder="Alex" />
              </div>
              <div className="grid gap-3">
                <div data-testid="onboarding-income-type-w2"><SelectCard selected={merged.incomeProfileType === "w2_only"} title="W-2 only" description="Employee paycheck income with taxes withheld by payroll." onClick={() => selectIncomeProfile("w2_only")} /></div>
                <div data-testid="onboarding-income-type-w2-1099"><SelectCard selected={merged.incomeProfileType === "w2_plus_business"} title="W-2 + business income" description="Paychecks plus 1099, K-1, contractor, partnership, or side income." onClick={() => selectIncomeProfile("w2_plus_business")} /></div>
                <div data-testid="onboarding-income-type-1099"><SelectCard selected={merged.incomeProfileType === "business_only"} title="Business income only" description="1099, K-1, contractor, partnership, or self-employed income." onClick={() => selectIncomeProfile("business_only")} /></div>
              </div>
              <div data-testid="onboarding-filing-status">
                <Label htmlFor="onboarding-filing-status-select">Filing status</Label>
                <Select
                  value={merged.filingStatus}
                  onValueChange={(v) => selectFilingStatus(v as UserOnboardingSettings["filingStatus"])}
                >
                  <SelectTrigger id="onboarding-filing-status-select" data-testid="onboarding-filing-status-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single" data-testid="onboarding-filing-status-single">Single / Head of household</SelectItem>
                    <SelectItem value="married_filing_jointly" data-testid="onboarding-filing-status-mfj">Married Filing Jointly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">Choose Married Filing Jointly to track separate W-2s for you and your spouse.</p>
              </div>
              <p className="text-xs text-muted-foreground">You can change this later in Settings.</p>
            </div>
          )}

          {step === 2 && catchupSubStep === "ask" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Have you already earned income this year?</h1>
                <p className="mt-1 text-sm text-muted-foreground">If you started using PaycheckMD partway through the year, add your year-to-date paystub so recommendations stay accurate.</p>
              </div>
              <div className="grid gap-3">
                <div data-testid="onboarding-ytd-yes"><SelectCard selected={catchupChoice === "yes"} title="Catch up my year-to-date income" description="Enter year-to-date income and withholdings from your most recent paystub or business records." onClick={async () => { patch({ ytdCatchupChoice: "yes" }); if (settingsId) await persist({ ytdCatchupChoice: "yes" }); }} /></div>
                <div data-testid="onboarding-ytd-no"><SelectCard selected={catchupChoice === "no"} title="Start fresh from today" description="I haven’t earned income this year yet, or I’ll only track from now on." onClick={async () => { patch({ ytdCatchupChoice: "no" }); if (settingsId) await persist({ ytdCatchupChoice: "no" }); }} /></div>
                <div data-testid="onboarding-ytd-skip"><SelectCard selected={catchupChoice === "skip"} title="Skip for now" description="I’ll add this later from the Income tab." onClick={async () => { patch({ ytdCatchupChoice: "skip" }); if (settingsId) await persist({ ytdCatchupChoice: "skip" }); }} /></div>
              </div>
            </div>
          )}

          {step === 2 && catchupSubStep === "form" && (() => {
            const normName = (s: string) => String(s || "").trim().toLowerCase();
            const namedCompanies = companyDrafts.filter((c) => c.name.trim());
            const typeLabel = (t: OnboardingCompanyType) => t === "w2" ? "W-2" : t === "k1" ? "K-1" : "1099";
            const sourceFor = (t: OnboardingCompanyType) => t === "w2" ? "w2" as const : "1099_k1" as const;
            const savedFor = (c: OnboardingCompanyDraft) =>
              (existingCatchups || []).find(
                (e) => normName(e.company_name) === normName(c.name) && e.source_type === sourceFor(c.type),
              );
            return (
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-semibold text-foreground">Enter year-to-date income for each company</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Use your most recent paystub or records for each company. Save each company before continuing.</p>
                </div>
                {namedCompanies.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No companies yet. Go back to add at least one company or entity.
                  </div>
                )}
                <div className="space-y-3">
                  {namedCompanies.map((company, idx) => {
                    const saved = savedFor(company);
                    const isOpen = editingCatchup?.company_name === company.name || (!saved && editingCatchup === null && (lastSavedName !== company.name || !saved));
                    // Open by default when not saved; collapsed when saved unless explicitly editing.
                    const openCard = !saved || editingCatchup?.id === saved?.id;
                    return (
                      <div key={`${company.name}-${idx}`} className={cn("rounded-xl border", saved ? "border-success/40 bg-success/5" : "border-border bg-card")}> 
                        <div className="flex items-center justify-between gap-3 p-4">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {company.name} <span className="text-xs font-normal text-muted-foreground">— {typeLabel(company.type)}</span>
                            </p>
                            {saved ? (
                              <p className="text-xs text-success mt-0.5 flex items-center gap-1">
                                <Check className="h-3.5 w-3.5" /> Saved · Gross {`$${Number(saved.gross_income || 0).toLocaleString()}`} · Fed {`$${Number(saved.federal_withholding || 0).toLocaleString()}`}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-0.5">YTD income not saved yet.</p>
                            )}
                          </div>
                          {saved && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (editingCatchup?.id === saved.id) {
                                  setEditingCatchup(null);
                                } else {
                                  setEditingCatchup(saved);
                                  setCatchupFormKey((k) => k + 1);
                                }
                              }}
                            >
                              {editingCatchup?.id === saved.id ? "Close" : "Edit"}
                            </Button>
                          )}
                        </div>
                        {openCard && (
                          <div className="border-t border-border p-4">
                            <YtdCatchupForm
                              key={`${company.name}-${idx}-${catchupFormKey}-${saved?.id ?? "new"}`}
                              initial={saved ?? undefined}
                              incomeProfileType={merged.incomeProfileType}
                              filingStatus={merged.filingStatus}
                              lockedCompanyName={company.name}
                              lockedSourceType={sourceFor(company.type)}
                              saveLabel={`Save ${company.name} YTD`}
                              onSaved={() => {
                                setLastSavedName(company.name);
                                setEditingCatchup(null);
                                setLocalSavedCatchups((n) => n + 1);
                              }}
                              onCancel={saved ? () => setEditingCatchup(null) : undefined}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">Done with one? You can still add more.</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingCatchup(null);
                      setCatchupSubStep("company");
                    }}
                  >
                    + Add another company/entity
                  </Button>
                </div>
              </div>
            );
          })()}


          {step === 2 && catchupSubStep === "company" && (
            <div className="space-y-5" data-testid="onboarding-company-entry-step">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">{companySetupCopy.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{companySetupCopy.subtitle}</p>
              </div>
              <div className="space-y-3">
                {companyDrafts.map((company, index) => (
                  <div key={index} className="rounded-lg border border-border p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_210px]">
                      <div>
                        <Label htmlFor={`company-name-${index}`}>{companySetupCopy.nameLabel}</Label>
                        <Input id={`company-name-${index}`} data-testid={index === 0 ? "onboarding-employer-name-input" : `onboarding-employer-name-input-${index}`} data-employer-index={index} value={company.name} onChange={(e) => updateCompanyDraft(index, { name: e.target.value })} placeholder={companySetupCopy.namePlaceholder} />
                      </div>
                      {allowedCompanyTypes.length > 1 && (
                        <div>
                          <Label htmlFor={`company-type-${index}`}>Type</Label>
                          <Select value={company.type} onValueChange={(value) => updateCompanyDraft(index, { type: value as OnboardingCompanyType })}>
                            <SelectTrigger id={`company-type-${index}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{allowedCompanyTypes.map((type) => <SelectItem key={type} value={type}>{companyTypeLabels[type]}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    {company.type === "w2" && (
                      <>
                        <div className="mt-3">
                          <Label htmlFor={`company-pay-frequency-${index}`}>Pay frequency</Label>
                          <Select
                            value={company.payFrequency || "biweekly"}
                            onValueChange={(value) => updateCompanyDraft(index, { payFrequency: value as OnboardingPayFrequency })}
                          >
                            <SelectTrigger id={`company-pay-frequency-${index}`} data-testid={`onboarding-pay-frequency-${index}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="weekly" data-testid={`onboarding-pay-frequency-${index}-option-weekly`}>Weekly (every week)</SelectItem>
                              <SelectItem value="biweekly" data-testid={`onboarding-pay-frequency-${index}-option-biweekly`}>Biweekly (every 2 weeks)</SelectItem>
                              <SelectItem value="semimonthly" data-testid={`onboarding-pay-frequency-${index}-option-semimonthly`}>Semi-monthly (twice per month, e.g. 15th &amp; 30th)</SelectItem>
                              <SelectItem value="monthly" data-testid={`onboarding-pay-frequency-${index}-option-monthly`}>Monthly (once per month)</SelectItem>
                              <SelectItem value="quarterly" data-testid={`onboarding-pay-frequency-${index}-option-quarterly`}>Quarterly</SelectItem>
                              <SelectItem value="annual" data-testid={`onboarding-pay-frequency-${index}-option-annual`}>Annual</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {merged.filingStatus === "married_filing_jointly" && (
                          <div className="mt-3">
                            <Label htmlFor={`company-employee-role-${index}`}>Whose W-2 is this?</Label>
                            <Select
                              value={company.employeeRole || "primary"}
                              onValueChange={(value) => updateCompanyDraft(index, { employeeRole: value as "primary" | "spouse" })}
                            >
                              <SelectTrigger id={`company-employee-role-${index}`} data-testid={`onboarding-employee-role-${index}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="primary" data-testid={`onboarding-employee-role-${index}-option-primary`}>You</SelectItem>
                                <SelectItem value="spouse" data-testid={`onboarding-employee-role-${index}-option-spouse`}>Spouse / partner</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                          You can add projected annual income, expected paycheck amount, and expected federal withholding in Settings → W-2 Employers.
                        </p>
                      </>
                    )}
                    {company.type === "k1" && (
                      <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                        <Label className="text-xs font-semibold">Is this K-1 income subject to self-employment tax?</Label>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Active general partners are usually subject to SE tax. Limited / passive partners typically are not. If you're not sure, we'll default conservatively and flag it.
                        </p>
                        <Select
                          value={company.k1SeTaxable || ""}
                          onValueChange={(value) => updateCompanyDraft(index, { k1SeTaxable: value as any })}
                        >
                          <SelectTrigger
                            id={`company-k1-se-${index}`}
                            data-testid={`onboarding-k1-se-${index}`}
                            className="mt-2"
                          >
                            <SelectValue placeholder="Select…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active / general partner — include SE tax</SelectItem>
                            <SelectItem value="passive">Passive / limited partner — no SE tax</SelectItem>
                            <SelectItem value="unsure">Not sure — flag for review</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="mt-3 flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={() => removeCompanyDraft(index)}>Remove</Button></div>

                  </div>
                ))}
                <Button type="button" variant="outline" data-testid="onboarding-add-employer-button" onClick={addCompanyDraft}>{companySetupCopy.addLabel}</Button>
                <p className="text-xs text-muted-foreground">You can add more later in Settings.</p>
              </div>
            </div>
          )}

          {/* Temporary MVP behavior: plan selection step removed. All users
              receive full (premium) access by default. Re-enable a step-3 plan
              chooser when paid tiers launch. */}


          {(() => {
            const normName = (s: string) => String(s || "").trim().toLowerCase();
            const sourceFor = (t: OnboardingCompanyType) => t === "w2" ? "w2" : "1099_k1";
            const namedCompanies = companyDrafts.filter((c) => c.name.trim());
            const allCompaniesSaved = step === 2 && catchupSubStep === "form"
              ? namedCompanies.length > 0 && namedCompanies.every((c) =>
                  (existingCatchups || []).some(
                    (e) => normName(e.company_name) === normName(c.name) && e.source_type === sourceFor(c.type),
                  ))
              : true;
            const continueDisabled = saving || (user && isLoading) || !allCompaniesSaved;
            return (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={goBack} disabled={saving || step === 1}><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
                <div className="flex items-center gap-2">
                  {step === 2 && catchupSubStep === "company" && <Button type="button" variant="ghost" onClick={skipCompanyStep} disabled={saving}>Skip for now</Button>}
                  <Button type="button" data-testid="onboarding-continue-button" onClick={continueStep} disabled={continueDisabled}>{saving ? "Saving…" : (step === 2 && (catchupSubStep === "ask" || catchupSubStep === "form")) ? "Finish setup" : "Continue"}</Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
