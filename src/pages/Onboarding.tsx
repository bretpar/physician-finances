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
import { YtdCatchupRecap } from "@/components/YtdCatchupRecap";
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

const TOTAL_STEPS = 3;

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
  const [companyDrafts, setCompanyDrafts] = useState<OnboardingCompanyDraft[]>([]);
  const [catchupSubStep, setCatchupSubStep] = useState<"ask" | "form" | "company">("ask");
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

  const settingsId = taxSettings?.id;
  const merged = useMemo(() => taxSettings ? {
    ...draft,
    firstName: draft.firstName || taxSettings.onboardingFirstName || "",
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
    setStep(savedStep);
    sessionStorage.setItem("paycheckmd-onboarding-step", String(savedStep));
    setDraft((current) => ({
      ...current,
      firstName: current.firstName || taxSettings.onboardingFirstName || "",
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

  useEffect(() => {
    if (step !== 2) return;
    if (catchupChoice === "yes") setCatchupSubStep((s) => (s === "ask" ? "form" : s));
    else if (catchupChoice === "no" || catchupChoice === "skip") setCatchupSubStep((s) => (s === "ask" ? "company" : s));
  }, [step, catchupChoice]);

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

  // Stable marker for safe-erase completion. Rendered on the onboarding page
  // whenever ?reset=1 is present in the URL or the post-erase localStorage
  // marker is set. Used by Playwright to confirm safe-erase succeeded
  // without relying on a DOM element that may unmount during navigation.
  const safeEraseMarkerVisible = (() => {
    if (typeof window === "undefined") return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("reset") === "1") return true;
      if (window.localStorage.getItem("paycheckmd:erase-complete")) return true;
    } catch { /* ignore */ }
    return false;
  })();

  // After a safe-erase, the URL carries ?reset=1 (or localStorage marker is
  // set). In that case never short-circuit to the dashboard, even if a stale
  // taxSettings cache momentarily reports onboardingComplete=true. The fresh
  // query will reflect the reset row on next render.
  if (!authLoading && !user) return <Navigate to="/signup" replace />;
  if (user && taxSettings?.onboardingComplete === true && !safeEraseMarkerVisible) return <Navigate to="/" replace />;

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
    if (step === 2 && (catchupSubStep === "company" || catchupSubStep === "form")) {
      setCatchupSubStep("ask");
      return;
    }
    const nextStep = step - 1;
    setStep(nextStep);
    sessionStorage.setItem("paycheckmd-onboarding-step", String(nextStep));
    setCatchupSubStep("ask");
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
    const catchupDrafts: OnboardingCompanyDraft[] = ((persistedCatchups || []) as any[])
      .filter((entry) => entry.company_name)
      .map((entry) => ({
        name: String(entry.company_name || ""),
        type: entry.source_type === "w2" ? "w2" : entry.source_type === "1099_k1" ? "1099" : allowed[0],
        description: "",
        payFrequency: entry.source_type === "w2" ? ("biweekly" as const) : undefined,
        projectedAnnualGross: Number(entry.gross_income) > 0 ? Number(entry.gross_income) : null,
      }))
      .filter((company) => allowed.includes(company.type));
    const normalizedDrafts = [...catchupDrafts, ...companyDrafts]
      .map((company) => ({ ...company, name: company.name.trim(), description: company.description?.trim() || "" }))
      .filter((company) => company.name || company.description);
    const incompleteDraft = normalizedDrafts.find((company) => !company.name || !company.type);
    if (incompleteDraft) throw new Error("Add a company name or remove the unfinished company card.");
    const validDrafts = normalizedDrafts.filter((company) => company.name && allowed.includes(company.type));
    if (validDrafts.length === 0) return;
    const uniqueDrafts = Array.from(new Map(validDrafts.map((company) => [`${company.name.toLowerCase()}::${company.type}`, company])).values());
    const orgId = await getUserOrgId();
    const { data: existing, error: existingError } = await supabase
      .from("companies")
      .select("name, company_type")
      .eq("user_id", user.id);
    if (existingError) throw existingError;
    const existingKeys = new Set((existing || []).map((company: any) => `${String(company.name || "").trim().toLowerCase()}::${company.company_type}`));
    const rows = uniqueDrafts.map((company) => {
      const companyType = onboardingCompanyTypeToFilingType(company.type);
      return {
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
        include_se_tax_in_recommendation: true,
        pay_frequency: company.type === "w2" ? (company.payFrequency || "biweekly") : null,
        projected_annual_gross: company.projectedAnnualGross ?? null,
      };
    }).filter((company) => !existingKeys.has(`${company.name.toLowerCase()}::${company.company_type}`));
    if (rows.length === 0) {
      // Even when no new rows are inserted, backfill in case prior catch-ups
      // were saved before the company existed.
      try { await backfillYtdCatchupCompanies(); } catch (e) { console.warn("[onboarding] backfill ytd catch-up failed", e); }
      return;
    }
    const { error } = await supabase.from("companies").insert(rows as any);
    if (error) throw error;
    // Link any pre-existing YTD catch-up entries (saved before the company
    // existed) to the newly-created company by normalized name, and update
    // their mirror transactions so Business Activity shows the company name.
    try { await backfillYtdCatchupCompanies(); } catch (e) { console.warn("[onboarding] backfill ytd catch-up failed", e); }
  }

  async function persist(partial: Partial<UserOnboardingSettings> = {}) {
    if (!settingsId) return;
    const next = { ...merged, ...partial };
    const sources = incomeProfileToSources(next.incomeProfileType);
    await updateTaxSettings.mutateAsync({
      id: settingsId,
      onboardingComplete: next.onboardingComplete,
      onboardingFirstName: next.firstName,
      onboardingStep: next.onboardingStep,
      incomeProfileType: next.incomeProfileType,
      enabledIncomeSources: sources,
      enabledPersonalIncomeTypes: next.enabledPersonalIncomeTypes,
      householdIncomeStreams: incomeSourcesToHouseholdStreams(sources, next.enabledPersonalIncomeTypes),
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
      if (catchupSubStep === "ask") {
        if (!catchupChoice) {
          toast.error("Pick an option to continue.");
          return;
        }
        setCatchupSubStep(catchupChoice === "yes" ? "form" : "company");
        return;
      }
      if (catchupSubStep === "form") {
        // Require at least one saved YTD entry before advancing. Use a local
        // counter in addition to the query result so Continue works immediately
        // after onSaved fires, without waiting for the query cache to refresh.
        let savedCount = Math.max(existingCatchups?.length ?? 0, localSavedCatchups);
        if (savedCount === 0) {
          // Defensive: the cached query may still be loading after a reload
          // even though entries exist in the DB. Do a direct count query
          // before failing so users with persisted entries can advance.
          try {
            const { count } = await (supabase as any)
              .from("ytd_catchup_entries")
              .select("id", { count: "exact", head: true });
            savedCount = count ?? 0;
          } catch (e) {
            console.warn("[onboarding] ytd catch-up count fallback failed", e);
          }
        }
        if (savedCount === 0) {
          toast.error("Save at least one year-to-date entry, or click Back to skip.");
          return;
        }
        setEditingCatchup(null);
        setShowCatchupForm(false);
        setCatchupSubStep("company");
        return;
      }
    }
    setSaving(true);
    try {
      const nextStep = Math.min(TOTAL_STEPS, step + 1);
      if (step === 1) {
        // First name is encouraged but not required to advance — fall back to
        // auth metadata or the email local-part so brand-new signups (e.g.
        // automated flows that skip the optional name field) are not stuck on
        // Step 1. The user can update their name later in Settings.
        const metadataFirst = (user?.user_metadata as any)?.first_name as string | undefined;
        const emailLocal = user?.email ? user.email.split("@")[0] : "";
        const finalFirstName = merged.firstName.trim() || (metadataFirst?.trim() || "") || emailLocal || "Friend";
        await supabase.from("profiles").update({ first_name: finalFirstName }).eq("user_id", user!.id);
        await persist({ firstName: finalFirstName, onboardingComplete: false, onboardingStep: nextStep });
        patch({ firstName: finalFirstName });
      } else if (step === 2) {
        await createOnboardingCompanies();
        await persist({ onboardingComplete: false, onboardingStep: nextStep });
      } else if (step === 3) {
        await persist({ onboardingComplete: true, onboardingStep: TOTAL_STEPS });
        sessionStorage.removeItem("paycheckmd-onboarding-step");
        navigate("/", { replace: true });
        return;
      }
      patch({ onboardingStep: nextStep });
      sessionStorage.setItem("paycheckmd-onboarding-step", String(nextStep));
      setStep(nextStep);
    } catch (error: any) {
      toast.error(error.message || "Could not save onboarding.");
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
      {safeEraseMarkerVisible && (
        <div data-testid="safe-erase-complete-marker" className="sr-only" aria-hidden="true" />
      )}
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
                <div data-testid="onboarding-ytd-yes"><SelectCard selected={catchupChoice === "yes"} title="Yes, help me catch up" description="Enter year-to-date income and withholdings from your most recent paystub." onClick={async () => { patch({ ytdCatchupChoice: "yes" }); if (settingsId) await persist({ ytdCatchupChoice: "yes" }); setCatchupSubStep("form"); }} /></div>
                <div data-testid="onboarding-ytd-no"><SelectCard selected={catchupChoice === "no"} title="No, I’m starting fresh" description="I haven’t earned income this year yet, or I’ll only track from now on." onClick={async () => { patch({ ytdCatchupChoice: "no" }); if (settingsId) await persist({ ytdCatchupChoice: "no" }); setCatchupSubStep("company"); }} /></div>
                <div data-testid="onboarding-ytd-skip"><SelectCard selected={catchupChoice === "skip"} title="Skip for now" description="I’ll add this later from the Income tab. Continue to company/business setup." onClick={async () => {
                  if (saving) return;
                  setSaving(true);
                  try {
                    patch({ ytdCatchupChoice: "skip" });
                    if (settingsId) await persist({ ytdCatchupChoice: "skip", onboardingComplete: false });
                    setCatchupSubStep("company");
                  } catch (error: any) {
                    toast.error(error.message || "Could not save onboarding.");
                  } finally {
                    setSaving(false);
                  }
                }} /></div>
              </div>
            </div>
          )}

          {step === 2 && catchupSubStep === "form" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">{
                  merged.incomeProfileType === "w2_only" ? "Add each W-2 paystub you've received this year"
                    : merged.incomeProfileType === "business_only" ? "Add each 1099 / business income source from this year"
                    : "Add each paystub or 1099 source you've earned from this year"
                }</h1>
                <p className="mt-1 text-sm text-muted-foreground">Enter year-to-date totals so recommendations stay accurate. Add one entry per employer or company — you can add as many as you need.</p>
                {merged.incomeProfileType === "business_only" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Planned remaining-year business revenue and expenses are entered later in the Income Planner, not here. This step captures actual year-to-date income only.
                  </p>
                )}
              </div>
              <YtdCatchupRecap
                onEdit={(entry) => {
                  setEditingCatchup(entry);
                  setShowCatchupForm(true);
                  setCatchupFormKey((k) => k + 1);
                  setLastSavedName(null);
                  setTimeout(() => catchupFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                }}
                editingId={editingCatchup?.id ?? null}
              />
              {lastSavedName && !showCatchupForm && (
                <div data-testid="ytd-catchup-saved-banner" role="status" aria-live="polite" className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
                  ✓ Saved — {lastSavedName} added.
                </div>
              )}
              {showCatchupForm ? (
                <div ref={catchupFormRef} className="rounded-xl border border-border p-4">
                  {editingCatchup && (
                    <p className="text-xs text-primary mb-3">Editing {editingCatchup.company_name}. Save changes or cancel to add a new entry.</p>
                  )}
                  <YtdCatchupForm
                    key={catchupFormKey}
                    initial={editingCatchup ?? undefined}
                    incomeProfileType={merged.incomeProfileType}
                    onSaved={() => {
                      const name = editingCatchup?.company_name ?? "Entry";
                      setLastSavedName(name);
                      setEditingCatchup(null);
                      setShowCatchupForm(false);
                      setLocalSavedCatchups((n) => n + 1);
                    }}
                    onCancel={editingCatchup ? () => {
                      setEditingCatchup(null);
                      setCatchupFormKey((k) => k + 1);
                    } : undefined}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-dashed border-border p-4">
                  <p className="text-sm text-muted-foreground">
                    {existingCatchups && existingCatchups.length > 0
                      ? `${existingCatchups.length} ${existingCatchups.length === 1 ? "entry" : "entries"} saved. Add another employer or continue when you're done.`
                      : "Add your first employer or income source to get started."}
                  </p>
                  <Button
                    type="button"
                    onClick={() => {
                      setEditingCatchup(null);
                      setShowCatchupForm(true);
                      setCatchupFormKey((k) => k + 1);
                      setLastSavedName(null);
                      setTimeout(() => catchupFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                    }}
                  >
                    + Add another employer
                  </Button>
                </div>
              )}
            </div>
          )}

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
                    <div className="mt-3">
                      <Label htmlFor={`company-desc-${index}`}>Optional description or nickname</Label>
                      <Input id={`company-desc-${index}`} value={company.description || ""} onChange={(e) => updateCompanyDraft(index, { description: e.target.value })} placeholder="Optional" />
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
                        <div className="mt-3">
                          <Label htmlFor={`company-annual-gross-${index}`}>
                            Expected annual gross income <span className="text-xs text-muted-foreground">(optional)</span>
                          </Label>
                          <Input
                            id={`company-annual-gross-${index}`}
                            data-testid={`onboarding-annual-gross-${index}`}
                            type="number"
                            inputMode="decimal"
                            placeholder="e.g. 180000"
                            value={company.projectedAnnualGross ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateCompanyDraft(index, { projectedAnnualGross: v === "" ? null : Math.max(0, Number(v) || 0) });
                            }}
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            Used by Tax Overview to project remaining-year withholding. You can change this in Settings.
                          </p>
                        </div>
                      </>
                    )}
                    <div className="mt-3 flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={() => removeCompanyDraft(index)}>Remove</Button></div>
                  </div>
                ))}
                <Button type="button" variant="outline" data-testid="onboarding-add-employer-button" onClick={addCompanyDraft}>{companySetupCopy.addLabel}</Button>
                <p className="text-xs text-muted-foreground">You can add more later in Settings.</p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Choose your plan</h1>
                <p className="mt-1 text-sm text-muted-foreground">How do you want to start?</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectCard selected={merged.subscriptionTier === "free"} title="Free" description="A simple way to track income and see basic tax guidance." onClick={() => patch({ subscriptionTier: "free" })}>Basic dashboard, income tracking, tax estimate, and deduction tracking.</SelectCard>
                <SelectCard selected={merged.subscriptionTier === "premium"} title="Premium" description="Full tax planning tools for multiple income streams, business income, or complex deductions." onClick={() => patch({ subscriptionTier: "premium" })}>Full planner, W-2/1099/K-1 support, quarterly planning, advanced deductions, reports, and premium explanations.</SelectCard>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={goBack} disabled={saving || step === 1}><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
            <div className="flex items-center gap-2">
              {step === 2 && catchupSubStep === "company" && <Button type="button" variant="ghost" onClick={skipCompanyStep} disabled={saving}>Skip for now</Button>}
              <Button type="button" data-testid="onboarding-continue-button" onClick={continueStep} disabled={saving || (user && isLoading)}>{saving ? "Saving…" : step === TOTAL_STEPS ? (merged.subscriptionTier === "premium" ? "Continue with Premium" : "Start with Free") : "Continue"}</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
