import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Check, ChevronLeft, PiggyBank } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTaxSettings, useUpdateTaxSettings } from "@/hooks/useTaxSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getUserOrgId } from "@/hooks/useOrgId";
import { clearAttemptState, getAuthErrorMessage, readAttemptState, recordFailedAttempt } from "@/lib/authProtection";
import {
  DEFAULT_ONBOARDING_SETTINGS,
  getAllowedCompanyTypes,
  incomeProfileToSources,
  incomeSourcesToHouseholdStreams,
  onboardingCompanyTypeToFilingType,
  taxRecommendationToWithholdingMethod,
  type OnboardingCompanyDraft,
  type OnboardingCompanyType,
  type DeductionStrategy,
  type IncomeProfileType,
  type OnboardingSubscriptionTier,
  type TaxRecommendationMethod,
  type UserOnboardingSettings,
} from "@/lib/onboarding";

const SIGNUP_ATTEMPTS_KEY = "paycheckmd-signup-attempts";
const DUPLICATE_EMAIL_MESSAGE = "That email is already registered. Please sign in or reset your password.";

function isDuplicateEmailError(error: unknown) {
  const message = String((error as { message?: string } | null)?.message || error || "").toLowerCase();
  return ["already", "registered", "exists", "duplicate"].some((term) => message.includes(term));
}

function isValidEmailFormat(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const personalOptions = [
  ["investment", "Investments"], ["interest", "Interest income"], ["dividend", "Dividend income"],
  ["capital_gains", "Capital gains"], ["rental", "Rental income"], ["retirement", "Retirement income"], ["other", "Other income"],
];

const companyTypeLabels: Record<OnboardingCompanyType, string> = {
  w2: "W-2 Employer",
  "1099": "1099 Business",
  k1: "K-1 Partnership / S-Corp",
};

const deductionLabels: Record<string, string> = {
  retirement_401k: "401(k) / retirement contributions", healthcare_premiums: "Healthcare premiums", hsa: "HSA contributions",
  mileage: "Mileage", home_office: "Home office", business_expenses: "Business expenses", professional_expenses: "Professional expenses",
  charitable: "Charitable donations", mortgage_interest: "Mortgage interest", salt: "State and local taxes", other: "Other deductions",
};

const deductionOptionsByProfile: Record<IncomeProfileType, string[]> = {
  w2_only: ["retirement_401k", "healthcare_premiums", "hsa", "charitable", "mortgage_interest", "salt", "other"],
  w2_plus_business: ["retirement_401k", "healthcare_premiums", "hsa", "mileage", "home_office", "business_expenses", "professional_expenses", "charitable", "mortgage_interest", "salt", "other"],
  business_only: ["business_expenses", "mileage", "home_office", "healthcare_premiums", "hsa", "professional_expenses", "retirement_401k", "other"],
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
  const { user } = useAuth();
  const { data: taxSettings, isLoading } = useTaxSettings(!!user);
  const updateTaxSettings = useUpdateTaxSettings();
  const [step, setStep] = useState(() => Number(sessionStorage.getItem("paycheckmd-onboarding-step")) || 1);
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [signupCooldownUntil, setSignupCooldownUntil] = useState(() => readAttemptState(SIGNUP_ATTEMPTS_KEY).cooldownUntil);
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState<UserOnboardingSettings>(() => ({ ...DEFAULT_ONBOARDING_SETTINGS, onboardingComplete: false }));
  const [companyDrafts, setCompanyDrafts] = useState<OnboardingCompanyDraft[]>([]);

  const settingsId = taxSettings?.id;
  const merged = useMemo(() => taxSettings ? {
    ...draft,
    firstName: draft.firstName || taxSettings.onboardingFirstName || "",
    onboardingStep: taxSettings.onboardingStep || draft.onboardingStep || 1,
    incomeProfileType: draft.incomeProfileType || taxSettings.incomeProfileType,
  } : draft, [draft, taxSettings]);

  useEffect(() => {
    if (!user || isLoading || !taxSettings) return;
    const savedStep = Math.min(6, Math.max(1, taxSettings.onboardingStep || 1));
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
    }));
  }, [user, isLoading, taxSettings]);

  useEffect(() => {
    if (!user && step !== 1) {
      setStep(1);
      sessionStorage.setItem("paycheckmd-onboarding-step", "1");
      patch({ onboardingStep: 1 });
    }
  }, [user, step]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const signupCooldownSeconds = Math.max(0, Math.ceil((signupCooldownUntil - now) / 1000));

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
    if (step === 1) {
      navigate("/login");
      return;
    }
    const nextStep = step - 1;
    setStep(nextStep);
    sessionStorage.setItem("paycheckmd-onboarding-step", String(nextStep));
    patch({ onboardingStep: nextStep });
    if (settingsId) await persist({ onboardingStep: nextStep, onboardingComplete: false });
  };
  const selectIncomeProfile = (incomeProfileType: IncomeProfileType) => {
    const allowed = getAllowedCompanyTypes(incomeProfileType);
    patch({ incomeProfileType, enabledIncomeSources: incomeProfileToSources(incomeProfileType) });
    setCompanyDrafts((current) => current.map((company) => allowed.includes(company.type) ? company : { ...company, type: allowed[0] }));
  };

  async function createOnboardingCompanies() {
    if (!user) return;
    const allowed = getAllowedCompanyTypes(merged.incomeProfileType);
    const normalizedDrafts = companyDrafts
      .map((company) => ({ ...company, name: company.name.trim(), description: company.description?.trim() || "" }))
      .filter((company) => company.name || company.description);
    const incompleteDraft = normalizedDrafts.find((company) => !company.name || !company.type);
    if (incompleteDraft) throw new Error("Add a company name or remove the unfinished company card.");
    const validDrafts = normalizedDrafts
      .filter((company) => company.name && allowed.includes(company.type));
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
    });
  }

  async function continueStep() {
    if (saving || (step === 1 && !user && signupCooldownSeconds > 0)) return;
    setSaving(true);
    try {
      const nextStep = Math.min(6, step + 1);
      if (step === 1) {
        if (!merged.firstName.trim()) throw new Error("Enter your first name to continue.");
        if (!user) {
          const normalizedEmail = email.trim();
          if (!normalizedEmail) throw new Error("Enter your email to continue.");
          if (!isValidEmailFormat(normalizedEmail)) throw new Error("Enter a valid email address.");
          if (!password) throw new Error("Enter a password to continue.");
          if (password.length < 6) throw new Error("Use a stronger password with at least 6 characters.");
          if (companyWebsite.trim()) throw new Error("Signup could not be completed. Please try again.");
          const { data: existingCheck, error: existingError } = await supabase.functions.invoke("onboarding-signup", { body: { email: normalizedEmail } });
          if (existingError) throw existingError;
          if (existingCheck?.exists) throw new Error(DUPLICATE_EMAIL_MESSAGE);
          const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password, options: { data: { first_name: merged.firstName.trim() }, emailRedirectTo: window.location.origin } });
          if (error) throw error;
          if (!data.session) {
            toast.success("Account created. Please sign in to continue.");
            return;
          }
          await supabase.from("profiles").update({ first_name: merged.firstName.trim() }).eq("user_id", data.user?.id);
          await supabase.from("tax_settings").update({ onboarding_first_name: merged.firstName.trim(), onboarding_complete: false, onboarding_step: nextStep } as any).eq("user_id", data.user?.id);
          clearAttemptState(SIGNUP_ATTEMPTS_KEY);
          setSignupCooldownUntil(0);
        } else {
          await supabase.from("profiles").update({ first_name: merged.firstName.trim() }).eq("user_id", user.id);
          await persist({ firstName: merged.firstName.trim(), onboardingComplete: false, onboardingStep: nextStep });
        }
      } else if (step === 6) {
        await createOnboardingCompanies();
        await persist({ onboardingComplete: true, onboardingStep: 6 });
        sessionStorage.removeItem("paycheckmd-start-setup");
        sessionStorage.removeItem("paycheckmd-onboarding-step");
        navigate("/", { replace: true });
        return;
      } else {
        await persist({ onboardingComplete: false, onboardingStep: nextStep });
      }
      patch({ onboardingStep: nextStep });
      sessionStorage.setItem("paycheckmd-onboarding-step", String(nextStep));
      setStep(nextStep);
    } catch (error: any) {
      if (step === 1 && !user) {
        const message = String(error?.message || "");
        const isInputError = message.startsWith("Enter your first name") || message.startsWith("Enter your email") || message.startsWith("Enter a valid email") || message.startsWith("Enter a password") || message.startsWith("Use a stronger password");
        const isDuplicateError = message === DUPLICATE_EMAIL_MESSAGE || isDuplicateEmailError(error);
        if (!isInputError && !isDuplicateError) {
          const next = recordFailedAttempt(SIGNUP_ATTEMPTS_KEY);
          setSignupCooldownUntil(next.cooldownUntil);
        }
        toast.error(isInputError ? message : isDuplicateError ? DUPLICATE_EMAIL_MESSAGE : getAuthErrorMessage(error, "Signup could not be completed. Please try again."));
      } else {
        toast.error(error.message || "Could not save onboarding.");
      }
    } finally {
      setSaving(false);
    }
  }

  const deductions = deductionOptionsByProfile[merged.incomeProfileType];

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="space-y-6 p-5 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><PiggyBank className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Step {step} of 6</p><div className="mt-1 h-2 w-44 max-w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(step / 6) * 100}%` }} /></div></div>
          </div>

          {step === 1 && <div className="space-y-4"><div><h1 className="text-2xl font-semibold text-foreground">Create your account</h1><p className="mt-1 text-sm text-muted-foreground">Let’s personalize your PaycheckMD dashboard so you only see what applies to you.</p></div><div className="grid gap-4"><div><Label>First name</Label><Input value={merged.firstName} onChange={(e) => patch({ firstName: e.target.value })} placeholder="Alex" /></div>{!user && <><div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></div><div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></div><Input aria-hidden="true" className="sr-only" name="companyWebsite" value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />{signupCooldownSeconds > 0 && <p className="text-sm text-muted-foreground">Too many signup attempts. Please wait before trying again.</p>}<p className="text-sm text-muted-foreground">Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link></p></>}</div></div>}

          {step === 2 && <div className="space-y-4"><div><h1 className="text-2xl font-semibold text-foreground">Choose your income setup</h1><p className="mt-1 text-sm text-muted-foreground">What best describes your income?</p></div><div className="grid gap-3"><SelectCard selected={merged.incomeProfileType === "w2_only"} title="W-2 Only" description="I receive employee paychecks with taxes withheld by payroll." onClick={() => selectIncomeProfile("w2_only")}>Focuses on paychecks, withholding, and W-2 deductions.</SelectCard><SelectCard selected={merged.incomeProfileType === "w2_plus_business"} title="W-2 + 1099/K-1" description="I have employee income plus business, contractor, partnership, or side income." onClick={() => selectIncomeProfile("w2_plus_business")}>Keeps business activity, expenses, quarterly tools, and planner visible.</SelectCard><SelectCard selected={merged.incomeProfileType === "business_only"} title="1099/K-1 Only" description="I mainly earn income through business, contractor, partnership, or self-employed work." onClick={() => selectIncomeProfile("business_only")}>Hides payroll sections by default without deleting prior W-2 data.</SelectCard></div></div>}

          {step === 3 && <div className="space-y-5"><div><h1 className="text-2xl font-semibold text-foreground">{companySetupCopy.title}</h1><p className="mt-1 text-sm text-muted-foreground">{companySetupCopy.subtitle}</p></div><div className="space-y-3">{companyDrafts.map((company, index) => <div key={index} className="rounded-lg border border-border p-4"><div className="grid gap-3 sm:grid-cols-[1fr_210px]"><div><Label>{companySetupCopy.nameLabel}</Label><Input value={company.name} onChange={(e) => updateCompanyDraft(index, { name: e.target.value })} placeholder={companySetupCopy.namePlaceholder} /></div><div><Label>Type</Label><Select value={company.type} onValueChange={(value) => updateCompanyDraft(index, { type: value as OnboardingCompanyType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{allowedCompanyTypes.map((type) => <SelectItem key={type} value={type}>{companyTypeLabels[type]}</SelectItem>)}</SelectContent></Select></div></div><div className="mt-3"><Label>Optional description or nickname</Label><Input value={company.description || ""} onChange={(e) => updateCompanyDraft(index, { description: e.target.value })} placeholder="Optional" /></div><div className="mt-3 flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={() => removeCompanyDraft(index)}>Remove</Button></div></div>)}<Button type="button" variant="outline" onClick={addCompanyDraft}>{companySetupCopy.addLabel}</Button><p className="text-xs text-muted-foreground">You can add this later in Settings.</p></div><div className="border-t border-border pt-5"><div><h2 className="text-base font-semibold text-foreground">Other personal income sources</h2><p className="mt-1 text-sm text-muted-foreground">Do you have any other income sources you want to track?</p></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{personalOptions.map(([value, label]) => <label key={value} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"><Checkbox checked={merged.enabledPersonalIncomeTypes.includes(value)} onCheckedChange={(checked) => patch({ enabledPersonalIncomeTypes: checked ? [...merged.enabledPersonalIncomeTypes, value] : merged.enabledPersonalIncomeTypes.filter((v) => v !== value) })} />{label}</label>)}<label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"><Checkbox checked={merged.enabledPersonalIncomeTypes.length === 0} onCheckedChange={() => patch({ enabledPersonalIncomeTypes: [] })} />None right now</label></div></div></div>}

          {step === 4 && <div className="space-y-4"><div><h1 className="text-2xl font-semibold text-foreground">Choose your tax estimate style</h1><p className="mt-1 text-sm text-muted-foreground">How should PaycheckMD estimate your tax recommendations?</p></div><div className="grid gap-3"><SelectCard selected={merged.taxRecommendationMethod === "flat_rate"} title="Flat Rate" description="Use the same fixed percentage for every paycheck or income entry." onClick={() => patch({ taxRecommendationMethod: "flat_rate" })}>A common starting point is the effective tax rate from your prior-year tax return.</SelectCard>{merged.taxRecommendationMethod === "flat_rate" && <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2"><div><Label>Federal flat rate percentage</Label><Input type="number" min="0" max="100" step="0.1" value={merged.flatFederalRate ?? ""} onChange={(e) => patch({ flatFederalRate: Number(e.target.value) })} /></div>{taxSettings?.stateIncomeTaxEnabled && <div><Label>State flat rate percentage</Label><Input type="number" min="0" max="100" step="0.1" value={merged.flatStateRate ?? ""} onChange={(e) => patch({ flatStateRate: Number(e.target.value) })} /></div>}</div>}<SelectCard selected={merged.taxRecommendationMethod === "dynamic_actual"} title="Dynamic — Based on Current Income" description="Estimate annual income using what you have already earned this year." onClick={() => patch({ taxRecommendationMethod: "dynamic_actual" })}>Uses actual income and deductions entered to date, not planned future income.</SelectCard><SelectCard selected={merged.taxRecommendationMethod === "dynamic_planner"} title="Dynamic — Based on Income Planner" description="Use your actual income plus planned future income to estimate your full-year tax picture." onClick={() => patch({ taxRecommendationMethod: "dynamic_planner" })}>Best when income varies or future paychecks and contracts are known.</SelectCard></div></div>}

          {step === 5 && <div className="space-y-5"><div><h1 className="text-2xl font-semibold text-foreground">Choose deductions to track</h1><p className="mt-1 text-sm text-muted-foreground">Which deductions should PaycheckMD help you track?</p></div><div><p className="mb-3 text-sm font-medium">Do you usually take the standard deduction or itemize deductions?</p><RadioGroup value={merged.deductionStrategy} onValueChange={(v) => patch({ deductionStrategy: v as DeductionStrategy })} className="grid gap-2 sm:grid-cols-3"><label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm"><RadioGroupItem value="standard" />Standard deduction</label><label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm"><RadioGroupItem value="itemized" />Itemized deductions</label><label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm"><RadioGroupItem value="not_sure" />Not sure</label></RadioGroup></div><div className="grid gap-3 sm:grid-cols-2">{deductions.map((value) => <label key={value} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"><Checkbox checked={merged.enabledDeductionTypes.includes(value)} onCheckedChange={(checked) => patch({ enabledDeductionTypes: checked ? [...merged.enabledDeductionTypes, value] : merged.enabledDeductionTypes.filter((v) => v !== value) })} />{deductionLabels[value]}</label>)}</div></div>}

          {step === 6 && <div className="space-y-4"><div><h1 className="text-2xl font-semibold text-foreground">Choose your plan</h1><p className="mt-1 text-sm text-muted-foreground">How do you want to start?</p></div><div className="grid gap-3 sm:grid-cols-2"><SelectCard selected={merged.subscriptionTier === "free"} title="Free" description="A simple way to track income and see basic tax guidance." onClick={() => patch({ subscriptionTier: "free" })}>Basic dashboard, income tracking, tax estimate, deduction tracking, and limited planner access.</SelectCard><SelectCard selected={merged.subscriptionTier === "premium"} title="Premium" description="Full tax planning tools for multiple income streams, business income, or complex deductions." onClick={() => patch({ subscriptionTier: "premium" })}>Full planner, W-2/1099/K-1 support, quarterly planning, advanced deductions, reports, and premium explanations.</SelectCard></div></div>}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="outline" onClick={goBack} disabled={saving}><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
            <Button onClick={continueStep} disabled={saving || (user && isLoading) || (step === 1 && !user && signupCooldownSeconds > 0)}>{saving ? "Saving…" : step === 6 ? (merged.subscriptionTier === "premium" ? "Continue with Premium" : "Start with Free") : "Continue"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}