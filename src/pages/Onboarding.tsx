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
import { useYtdCatchupEntries } from "@/hooks/useYtdCatchup";
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
  const catchupFormRef = useRef<HTMLDivElement | null>(null);

  const settingsId = taxSettings?.id;
  const merged = useMemo(() => taxSettings ? {
    ...draft,
    firstName: draft.firstName || taxSettings.onboardingFirstName || "",
    onboardingStep: taxSettings.onboardingStep || draft.onboardingStep || 1,
    incomeProfileType: draft.incomeProfileType || taxSettings.incomeProfileType,
  } : draft, [draft, taxSettings]);
  const catchupChoice = merged.ytdCatchupChoice ?? null;

  useEffect(() => {
    if (!user || isLoading || !taxSettings) return;
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

  if (!authLoading && !user) return <Navigate to="/signup" replace />;
  if (user && taxSettings?.onboardingComplete === true && !sessionStorage.getItem("paycheckmd-start-setup")) return <Navigate to="/" replace />;

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
    const normalizedDrafts = companyDrafts
      .map((company) => ({ ...company, name: company.name.trim(), description: company.description?.trim() || "" }))
      .filter((company) => company.name || company.description);
    const incompleteDraft = normalizedDrafts.find((company) => !company.name || !company.type);
    if (incompleteDraft) throw new Error("Add a company name or remove the unfinished company card.");
    const validDrafts = normalizedDrafts.filter((company) => company.name && allowed.includes(company.type));
    if (validDrafts.length === 0) return;
    const uniqueDrafts = Array.from(new Map(validDrafts.map((company) => [`${company.name.toLowerCase()}::${company.type}`, company])).values());
    const orgId = await getUserOrgId();
    const { data: existing, error: existingError } = await supabase.from("companies").select("name, company_type");
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
      };
    }).filter((company) => !existingKeys.has(`${company.name.toLowerCase()}::${company.company_type}`));
    if (rows.length === 0) return;
    const { error } = await supabase.from("companies").insert(rows as any);
    if (error) throw error;
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
        setCatchupSubStep("company");
        return;
      }
    }
    setSaving(true);
    try {
      const nextStep = Math.min(TOTAL_STEPS, step + 1);
      if (step === 1) {
        if (!merged.firstName.trim()) throw new Error("Enter your first name to continue.");
        await supabase.from("profiles").update({ first_name: merged.firstName.trim() }).eq("user_id", user!.id);
        await persist({ firstName: merged.firstName.trim(), onboardingComplete: false, onboardingStep: nextStep });
      } else if (step === 2) {
        await createOnboardingCompanies();
        await persist({ onboardingComplete: false, onboardingStep: nextStep });
      } else if (step === 3) {
        await persist({ onboardingComplete: true, onboardingStep: TOTAL_STEPS });
        sessionStorage.removeItem("paycheckmd-start-setup");
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
      <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
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
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="space-y-6 p-5 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><PiggyBank className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Step {step} of {TOTAL_STEPS}</p>
              <div className="mt-1 h-2 w-44 max-w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} /></div>
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Confirm your income setup</h1>
                <p className="mt-1 text-sm text-muted-foreground">We pre-filled this from your estimate. Adjust if needed.</p>
              </div>
              <div>
                <Label>First name</Label>
                <Input value={merged.firstName} onChange={(e) => patch({ firstName: e.target.value })} placeholder="Alex" />
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
                <SelectCard selected={catchupChoice === "yes"} title="Yes, help me catch up" description="Enter year-to-date income and withholdings from your most recent paystub." onClick={async () => { patch({ ytdCatchupChoice: "yes" }); if (settingsId) await persist({ ytdCatchupChoice: "yes" }); setCatchupSubStep("form"); }} />
                <SelectCard selected={catchupChoice === "no"} title="No, I’m starting fresh" description="I haven’t earned income this year yet, or I’ll only track from now on." onClick={async () => { patch({ ytdCatchupChoice: "no" }); if (settingsId) await persist({ ytdCatchupChoice: "no" }); setCatchupSubStep("company"); }} />
                <SelectCard selected={catchupChoice === "skip"} title="Skip for now" description="I’ll add this later from the Income tab." onClick={async () => {
                  if (saving) return;
                  setSaving(true);
                  try {
                    patch({ ytdCatchupChoice: "skip" });
                    await persist({ ytdCatchupChoice: "skip", onboardingComplete: true, onboardingStep: 3 });
                    sessionStorage.removeItem("paycheckmd-onboarding-step");
                    navigate("/", { replace: true });
                  } catch (error: any) {
                    toast.error(error.message || "Could not save onboarding.");
                  } finally {
                    setSaving(false);
                  }
                }} />
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
                <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
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
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">{companySetupCopy.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{companySetupCopy.subtitle}</p>
              </div>
              <div className="space-y-3">
                {companyDrafts.map((company, index) => (
                  <div key={index} className="rounded-lg border border-border p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_210px]">
                      <div><Label>{companySetupCopy.nameLabel}</Label><Input value={company.name} onChange={(e) => updateCompanyDraft(index, { name: e.target.value })} placeholder={companySetupCopy.namePlaceholder} /></div>
                      {allowedCompanyTypes.length > 1 && (
                        <div><Label>Type</Label><Select value={company.type} onValueChange={(value) => updateCompanyDraft(index, { type: value as OnboardingCompanyType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{allowedCompanyTypes.map((type) => <SelectItem key={type} value={type}>{companyTypeLabels[type]}</SelectItem>)}</SelectContent></Select></div>
                      )}
                    </div>
                    <div className="mt-3"><Label>Optional description or nickname</Label><Input value={company.description || ""} onChange={(e) => updateCompanyDraft(index, { description: e.target.value })} placeholder="Optional" /></div>
                    <div className="mt-3 flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={() => removeCompanyDraft(index)}>Remove</Button></div>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addCompanyDraft}>{companySetupCopy.addLabel}</Button>
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
            <Button variant="outline" onClick={goBack} disabled={saving || step === 1}><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
            <div className="flex items-center gap-2">
              {step === 2 && catchupSubStep === "company" && <Button variant="ghost" onClick={skipCompanyStep} disabled={saving}>Skip for now</Button>}
              <Button onClick={continueStep} disabled={saving || (user && isLoading)}>{saving ? "Saving…" : step === TOTAL_STEPS ? (merged.subscriptionTier === "premium" ? "Continue with Premium" : "Start with Free") : "Continue"}</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
