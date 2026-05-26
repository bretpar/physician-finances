import { useState, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/DateField";
import { formatDate as formatDateDisplay, formatDateTime } from "@/lib/localDate";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Trash2, Building2, Landmark, RefreshCw, Loader2,
  Shield, User, Crown, Calculator, CreditCard, Unplug, Settings2,
  Lock, ChevronDown, ChevronRight, Users, UserCircle,
} from "lucide-react";
import { useCompanies, type Company } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useTaxSettings, useUpdateTaxSettings, type TaxRates, type WithholdingMethod, type QuarterlyTrackerMethod, type HouseholdIncomeStreams } from "@/hooks/useTaxSettings";
import { isPremiumFeature } from "@/lib/featureFlags";
import {
  FILING_TYPES,
  TOGGLE_OPTIONS_BY_TYPE,
  resolveAdvancedVisibility,
  type FilingType,
} from "@/lib/filingTypes";
import { ledgerForIncomeType, ledgerLabel } from "@/lib/ledgerRouting";
import {
  usePlaidItems,
  usePlaidAccounts,
  usePlaidNeedsReviewTransactions,
  useSyncTransactions,
  useDisconnectPlaidItem,
  useUpdatePlaidAccount,
  useBulkApplyAccountBusiness,
  useBackfillPlaidTransactions,
  useReviewAccounts,
} from "@/hooks/usePlaid";
import { SectionCard } from "@/components/settings/SectionCard";
import { HsaSettingsSection } from "@/components/settings/HsaSection";
import { ForecastingAutomationSection } from "@/components/settings/ForecastingAutomationSection";
import MergeCompaniesDialog from "@/components/settings/MergeCompaniesDialog";
import { DangerZoneSection } from "@/components/settings/DangerZoneSection";
import { useSectionDraft } from "@/hooks/useSectionDraft";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { cn } from "@/lib/utils";
import { classifyPersonalIncome } from "@/lib/incomeClassification";
import { useIncomeEntries } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import {
  ALL_ENTITLEMENT_FEATURES,
  deriveUserTypeFromIncomeStreams,
  getFeatureAccess,
  getUserTypeDisplayInfo,
  type FeatureKey,
} from "@/lib/entitlements";
import { getAllowedCompanyTypes, onboardingCompanyTypeToFilingType, subscriptionTierToEntitlementTier, type DeductionStrategy, type IncomeProfileType, type OnboardingSubscriptionTier } from "@/lib/onboarding";

/* ─── Types ─── */
interface Profile { firstName: string; lastName: string; email: string; }
interface OrgMember { id: string; user_id: string; role: string; email?: string; first_name?: string; last_name?: string; }

const COMPANY_TYPES = FILING_TYPES.map((t) => ({ value: t.value, label: t.label }));

const roleIcons = { owner: Crown, admin: Shield, member: User };
const roleColors = { owner: "default", admin: "secondary", member: "outline" } as const;

function isValidEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

/* ──────────────────────────────────────────────────────────── */
/*  Profile section                                              */
/* ──────────────────────────────────────────────────────────── */
function ProfileSection({ justSavedFlag }: { justSavedFlag: (key: string) => boolean }) {
  const { user } = useAuth();
  const [source, setSource] = useState<Profile>({ firstName: "", lastName: "", email: "" });
  const [emailError, setEmailError] = useState("");
  const [savedTick, setSavedTick] = useState(false);

  // Initial load
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setSource({
        firstName: data?.first_name || "",
        lastName: data?.last_name || "",
        email: data?.email || user.email || "",
      });
    })();
    return () => { cancelled = true; };
  }, [user]);

  const draft = useSectionDraft<Profile>({
    source,
    onSave: async (next) => {
      if (next.email && !isValidEmail(next.email)) {
        setEmailError("Please enter a valid email address");
        throw new Error("invalid email");
      }
      setEmailError("");
      if (!user) throw new Error("not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ first_name: next.firstName, last_name: next.lastName, email: next.email })
        .eq("user_id", user.id);
      if (error) {
        toast.error(error.message);
        throw error;
      }
      setSource(next);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    },
  });

  return (
    <SectionCard
      bare
      title="Personal Profile"
      description="Your name and login email."
      isDirty={draft.isDirty}
      isSaving={draft.isSaving}
      justSaved={savedTick}
      onSave={draft.save}
      onCancel={draft.cancel}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">First Name</Label>
          <Input
            value={draft.draft.firstName}
            onChange={(e) => draft.patch({ firstName: e.target.value })}
            placeholder="John"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Last Name</Label>
          <Input
            value={draft.draft.lastName}
            onChange={(e) => draft.patch({ lastName: e.target.value })}
            placeholder="Smith"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">Email Address</Label>
        <Input
          type="email"
          value={draft.draft.email}
          onChange={(e) => { draft.patch({ email: e.target.value }); if (emailError) setEmailError(""); }}
          placeholder="doctor@example.com"
          className={emailError ? "border-destructive" : ""}
        />
        {emailError && <p className="text-xs text-destructive mt-1">{emailError}</p>}
        <p className="text-xs text-muted-foreground mt-1">This will be your login identifier.</p>
      </div>
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Tax Withholding Method section                               */
/* ──────────────────────────────────────────────────────────── */
type WithholdingDraft = {
  withholdingMethod: WithholdingMethod;
  manualEffectiveTaxRate: number | null;
};

function TaxWithholdingSection() {
  const { data } = useTaxSettings();
  const { actualDebug, currentPaceDebug, currentPaceEstimate, isLoading: taxEstimateLoading } = useTaxEstimate();
  const updateMutation = useUpdateTaxSettings();
  const [savedTick, setSavedTick] = useState(false);

  const currentIncomePreview = useMemo(() => {
    const now = new Date();
    const monthsElapsed = Math.max(1, now.getMonth() + 1);
    const monthsRemaining = Math.max(0, 12 - monthsElapsed);
    const ytdIncome = Number(actualDebug?.actualIncome || 0);
    const monthlyPace = ytdIncome / monthsElapsed;
    const projectedAnnualIncome = Number(currentPaceDebug?.totalGrossIncome || currentPaceEstimate?.totalIncome || 0);
    const projectedTax = Number(currentPaceDebug?.totalEstimatedTax || currentPaceEstimate?.totalTaxLiability || 0);
    const effectiveRate = Number(currentPaceDebug?.canonicalEffectiveTaxRate || currentPaceEstimate?.effectiveRate || 0);

    return { monthsElapsed, monthsRemaining, ytdIncome, monthlyPace, projectedAnnualIncome, projectedTax, effectiveRate };
  }, [actualDebug, currentPaceDebug, currentPaceEstimate]);

  const fmtMoney = (amount: number) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount || 0);

  const fmtPercent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

  const source: WithholdingDraft = useMemo(() => ({
    withholdingMethod: data?.withholdingMethod || "dynamic_planner",
    manualEffectiveTaxRate: data?.manualEffectiveTaxRate ?? 20,
  }), [data?.withholdingMethod, data?.manualEffectiveTaxRate]);

  const draft = useSectionDraft<WithholdingDraft>({
    source,
    onSave: async (next) => {
      if (!data?.id) throw new Error("Tax settings not loaded");
      await updateMutation.mutateAsync({
        id: data.id,
        withholdingMethod: next.withholdingMethod,
        manualEffectiveTaxRate: next.withholdingMethod === "flat_estimate" ? next.manualEffectiveTaxRate : data.manualEffectiveTaxRate,
      });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    },
  });

  return (
    <SectionCard
      bare
      title="Withholding Method"
      description="How withholding recommendations are calculated across the app."
      isDirty={draft.isDirty}
      isSaving={draft.isSaving}
      justSaved={savedTick}
      onSave={draft.save}
      onCancel={draft.cancel}
    >
      <RadioGroup
        value={draft.draft.withholdingMethod}
        onValueChange={(v) => draft.patch({ withholdingMethod: v as WithholdingMethod })}
        className="space-y-3"
      >
        <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
          <RadioGroupItem value="flat_estimate" className="mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-card-foreground">Flat Rate</p>
            <p className="text-xs text-muted-foreground mt-0.5">Use the same percentage for every paycheck. Best if you want a simple, predictable rule. A good starting point is your effective tax rate from last year’s tax return.</p>
            {draft.draft.withholdingMethod === "flat_estimate" && (
              <div>
                <div className="mt-3 flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Rate (%)</Label>
                  <Input
                    type="number" step="0.1" min="0" max="100"
                    className="w-24 h-8"
                    value={draft.draft.manualEffectiveTaxRate ?? 20}
                    onChange={(e) => draft.patch({ manualEffectiveTaxRate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">Tip: You can often estimate this by looking at your prior year total tax divided by total income, or by using the effective tax rate from last year’s tax return.</p>
              </div>
            )}
          </div>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
          <RadioGroupItem value="dynamic_actual" className="mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-card-foreground">Dynamic — Based on Current Income</p>
            <p className="text-xs text-muted-foreground mt-0.5">Uses your actual income so far this year, divides it by the months elapsed, then projects that monthly pace across the remaining months of the year. This creates an estimated annual income, income tax estimate, effective rate, and SE tax estimate.</p>
            {draft.draft.withholdingMethod === "dynamic_actual" && (
              <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-card-foreground">YTD → Projected Annual</p>
                  <Badge variant="outline" className="text-[10px]">Preview</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">YTD income</p>
                    <p className="font-medium text-card-foreground">{taxEstimateLoading ? "—" : fmtMoney(currentIncomePreview.ytdIncome)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Months elapsed</p>
                    <p className="font-medium text-card-foreground">{currentIncomePreview.monthsElapsed} of 12</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Monthly pace</p>
                    <p className="font-medium text-card-foreground">{taxEstimateLoading ? "—" : fmtMoney(currentIncomePreview.monthlyPace)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Remaining months</p>
                    <p className="font-medium text-card-foreground">{currentIncomePreview.monthsRemaining}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 border-t border-border pt-3 text-xs sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">Projected annual income</p>
                    <p className="font-semibold text-card-foreground">{taxEstimateLoading ? "—" : fmtMoney(currentIncomePreview.projectedAnnualIncome)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Projected annual tax</p>
                    <p className="font-semibold text-card-foreground">{taxEstimateLoading ? "—" : fmtMoney(currentIncomePreview.projectedTax)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Effective tax rate</p>
                    <p className="font-semibold text-card-foreground">{taxEstimateLoading ? "—" : fmtPercent(currentIncomePreview.effectiveRate)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
          <RadioGroupItem value="dynamic_planner" className="mt-0.5" />
          <div>
            <p className="text-sm font-medium text-card-foreground">Dynamic — Based on Income Planner</p>
            <p className="text-xs text-muted-foreground mt-0.5">Uses your actual income so far plus planned future income from the Income Planner. Best if you already know about upcoming W-2, 1099, K-1, bonus, or other income.</p>
          </div>
        </label>
      </RadioGroup>
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Quarterly Tax Tracker Method section                         */
/* ──────────────────────────────────────────────────────────── */
type QuarterlyTrackerDraft = { quarterlyTrackerMethod: QuarterlyTrackerMethod };

function QuarterlyTrackerMethodSection() {
  const { data } = useTaxSettings();
  const updateMutation = useUpdateTaxSettings();
  const [savedTick, setSavedTick] = useState(false);
  // Future-gated: dynamic mode is built premium-ready. Today it's unlocked.
  const dynamicLocked = false; // flip to !isFeatureEnabled("quarterly_dynamic_tracker") later
  const showPremiumBadge = isPremiumFeature("dynamic_tax_recalc");

  const source: QuarterlyTrackerDraft = useMemo(
    () => ({ quarterlyTrackerMethod: data?.quarterlyTrackerMethod || "even" }),
    [data?.quarterlyTrackerMethod],
  );

  const draft = useSectionDraft<QuarterlyTrackerDraft>({
    source,
    onSave: async (next) => {
      if (!data?.id) throw new Error("Tax settings not loaded");
      await updateMutation.mutateAsync({
        id: data.id,
        ...(next as any),
      });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    },
  });

  return (
    <SectionCard
      bare
      title="Quarterly Tax Tracker Method"
      description="How the dashboard's Quarterly Tax Progress card calculates each quarter's target."
      isDirty={draft.isDirty}
      isSaving={draft.isSaving}
      justSaved={savedTick}
      onSave={draft.save}
      onCancel={draft.cancel}
    >
      <RadioGroup
        value={draft.draft.quarterlyTrackerMethod}
        onValueChange={(v) => draft.patch({ quarterlyTrackerMethod: v as QuarterlyTrackerMethod })}
        className="space-y-3"
      >
        <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
          <RadioGroupItem value="even" className="mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-card-foreground">Even quarter allocation</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each quarter target = total estimated annual tax ÷ 4. Simple and predictable.
            </p>
          </div>
        </label>
        <label
          className={cn(
            "flex items-start gap-3 rounded-lg border border-border p-4 transition-colors",
            dynamicLocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-muted/30",
          )}
        >
          <RadioGroupItem value="dynamic" className="mt-0.5" disabled={dynamicLocked} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-card-foreground">Dynamic quarter allocation</p>
              {showPremiumBadge && (
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">Premium</Badge>
              )}
              {dynamicLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Quarter target is based on actual income earned plus planned income for that
              quarter. Better fit for uneven income across the year.
            </p>
            {dynamicLocked && (
              <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs">
                Upgrade to unlock
              </Button>
            )}
          </div>
        </label>
      </RadioGroup>
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Household Income Streams section                             */
/* ──────────────────────────────────────────────────────────── */
const HOUSEHOLD_INCOME_STREAM_OPTIONS: Array<{ key: keyof HouseholdIncomeStreams; label: string; moduleLabel: string }> = [
  { key: "w2Income", label: "W2 income", moduleLabel: "W2" },
  { key: "spouseW2Income", label: "Spouse/partner W2 income", moduleLabel: "spouse/partner W2" },
  { key: "additionalW2Job", label: "Additional W2 job", moduleLabel: "additional W2 job" },
  { key: "business1099Income", label: "1099/self-employed income", moduleLabel: "1099/self-employed" },
  { key: "k1PartnershipIncome", label: "K-1 / partnership income", moduleLabel: "K-1 / partnership" },
  { key: "sCorpIncome", label: "S-corp income", moduleLabel: "S-corp" },
  { key: "rentalIncome", label: "Rental income", moduleLabel: "rental" },
  { key: "investmentIncome", label: "Investment income", moduleLabel: "investment" },
  { key: "otherIncome", label: "Other income", moduleLabel: "other" },
];

const FEATURE_LABELS: Record<FeatureKey, string> = {
  basicWithholdingGuide: "Basic withholding guide",
  advancedWithholdingGuide: "Advanced withholding guide",
  spouseW2Support: "Spouse/partner W2 support",
  multipleW2Jobs: "Multiple W2 jobs",
  businessIncomeTracking: "Business income tracking",
  businessExpenseTracking: "Business expense tracking",
  mileageDeduction: "Mileage deductions",
  homeOfficeDeduction: "Home office deductions",
  quarterlyTaxPlanner: "Quarterly tax planner",
  scenarioPlanner: "Income planner",
  reportsExport: "Report exports",
  advancedTaxOverview: "Advanced tax overview",
  premiumEducation: "Premium guidance",
  customW2BusinessSplit: "Custom W2/business split",
  detailedReports: "Detailed reports",
  basicTaxOverview: "Basic tax overview",
  basicPaycheckTracking: "Paycheck tracking",
  basic1099Tracking: "1099 tracking",
  basicTaxGapEstimate: "Basic tax gap estimate",
  basicExpenseTracking: "Basic expense tracking",
  basicTaxSavingsEstimate: "Basic tax savings estimate",
};

const TAX_EXCLUSION_CHOICES_KEY = "paycheckmd-household-income-exclusion-choices";

type EffectiveDateChoice = "today" | "month-start" | "year-start" | "custom";

interface PathwayHistoryRow {
  id: string;
  previous_user_type: string;
  new_user_type: string;
  effective_date: string;
  changed_at: string;
}

function getEffectiveDate(choice: EffectiveDateChoice, customDate: string) {
  const now = new Date();
  if (choice === "month-start") return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  if (choice === "year-start") return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  if (choice === "custom") return customDate;
  return now.toISOString().slice(0, 10);
}

function formatPathwayDate(value: string) {
  if (!value) return "—";
  return formatDateDisplay(value);
}

function hasStreamData(key: keyof HouseholdIncomeStreams, personalRows: any[] = [], businessRows: any[] = []) {
  if (key === "business1099Income") return businessRows.some((e) => ["1099", "1099_schedule_c"].includes(String(e.income_type || "")));
  if (key === "k1PartnershipIncome") return businessRows.some((e) => ["k1", "k1_partnership"].includes(String(e.income_type || "")));
  if (key === "sCorpIncome") return businessRows.some((e) => String(e.income_type || "").includes("scorp"));
  if (key === "rentalIncome") return personalRows.some((e) => classifyPersonalIncome(e) === "rental");
  if (key === "investmentIncome") return personalRows.some((e) => ["capital_gains", "loss"].includes(classifyPersonalIncome(e)));
  if (key === "otherIncome") return personalRows.some((e) => classifyPersonalIncome(e) === "ordinary");
  if (key === "spouseW2Income") return personalRows.some((e) => e.ui_income_subtype === "w2_partner");
  return personalRows.some((e) => classifyPersonalIncome(e) === "w2");
}

function personalRowsForStream(key: keyof HouseholdIncomeStreams, personalRows: any[] = []) {
  return personalRows.filter((e) => {
    const category = classifyPersonalIncome(e);
    if (key === "spouseW2Income") return e.ui_income_subtype === "w2_partner";
    if (key === "w2Income" || key === "additionalW2Job") return category === "w2";
    if (key === "rentalIncome") return category === "rental";
    if (key === "investmentIncome") return category === "capital_gains" || category === "loss";
    if (key === "otherIncome") return category === "ordinary";
    return false;
  });
}

function businessRowsForStream(key: keyof HouseholdIncomeStreams, businessRows: any[] = []) {
  return businessRows.filter((e) => {
    const incomeType = String(e.income_type || "");
    if (key === "business1099Income") return incomeType === "1099" || incomeType === "1099_schedule_c";
    if (key === "k1PartnershipIncome") return incomeType === "k1" || incomeType === "k1_partnership";
    if (key === "sCorpIncome") return incomeType.includes("scorp");
    return false;
  });
}

function HouseholdIncomeStreamsSection() {
  const { data } = useTaxSettings();
  const { user, organizationId } = useAuth();
  const updateMutation = useUpdateTaxSettings();
  const { data: businessIncomeRows = [] } = useIncomeEntries();
  const { data: personalIncomeRows = [] } = usePersonalIncomeEntries();
  const queryClient = useQueryClient();
  const [savedTick, setSavedTick] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exclusionChoices, setExclusionChoices] = useState<Record<string, "hide-only" | "hide-and-exclude">>({});
  const [effectiveDateChoice, setEffectiveDateChoice] = useState<EffectiveDateChoice>("today");
  const [customEffectiveDate, setCustomEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pathwayHistory, setPathwayHistory] = useState<PathwayHistoryRow[]>([]);

  const source: HouseholdIncomeStreams = useMemo(() => data?.householdIncomeStreams ?? {
    w2Income: true,
    spouseW2Income: true,
    additionalW2Job: true,
    business1099Income: true,
    k1PartnershipIncome: true,
    sCorpIncome: true,
    rentalIncome: true,
    investmentIncome: true,
    otherIncome: true,
  }, [data?.householdIncomeStreams]);

  const draft = useSectionDraft<HouseholdIncomeStreams>({
    source,
    onSave: async (next) => {
      if (!data?.id) throw new Error("Tax settings not loaded");
      const previousUserType = deriveUserTypeFromIncomeStreams(source);
      const nextUserType = deriveUserTypeFromIncomeStreams(next);
      await updateMutation.mutateAsync({ id: data.id, householdIncomeStreams: next });
      if (user && previousUserType !== nextUserType) {
        const effectiveDate = getEffectiveDate(effectiveDateChoice, customEffectiveDate);
        const { error } = await supabase.from("income_pathway_history").insert({
          user_id: user.id,
          organization_id: organizationId,
          changed_by_user: user.id,
          previous_user_type: previousUserType,
          new_user_type: nextUserType,
          effective_date: effectiveDate,
          active_income_stream_flags: next,
        } as any);
        if (error) throw error;
      }
      localStorage.setItem("paycheckmd-household-income-profile-reviewed", "true");
      if (Object.keys(exclusionChoices).length > 0) {
        localStorage.setItem(TAX_EXCLUSION_CHOICES_KEY, JSON.stringify(exclusionChoices));
      }
      await applyExplicitExclusions();
      await loadPathwayHistory();
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    },
  });

  const loadPathwayHistory = useCallback(async () => {
    if (!user) return;
    const { data: rows, error } = await supabase
      .from("income_pathway_history")
      .select("id, previous_user_type, new_user_type, effective_date, changed_at")
      .order("effective_date", { ascending: false })
      .order("changed_at", { ascending: false })
      .limit(8);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPathwayHistory((rows || []) as PathwayHistoryRow[]);
  }, [user]);

  useEffect(() => {
    loadPathwayHistory();
  }, [loadPathwayHistory]);

  const derivedUserType = deriveUserTypeFromIncomeStreams(draft.draft);
  const currentUserType = deriveUserTypeFromIncomeStreams(source);
  const pathwayWillChange = draft.isDirty && currentUserType !== derivedUserType;
  const pathway = getUserTypeDisplayInfo(derivedUserType);
  const featureAccess = getFeatureAccess(derivedUserType, subscriptionTierToEntitlementTier(data?.subscriptionTier));
  const visibleSections = ALL_ENTITLEMENT_FEATURES.filter((key) => featureAccess[key]?.status === "available").map((key) => FEATURE_LABELS[key]);
  const hiddenSections = ALL_ENTITLEMENT_FEATURES.filter((key) => featureAccess[key]?.status === "hidden").map((key) => FEATURE_LABELS[key]);
  const lockedSections = ALL_ENTITLEMENT_FEATURES.filter((key) => featureAccess[key]?.status === "locked").map((key) => FEATURE_LABELS[key]);
  const disabledStreamsWithData = HOUSEHOLD_INCOME_STREAM_OPTIONS.filter(
    (option) => source[option.key] && !draft.draft[option.key] && hasStreamData(option.key, personalIncomeRows, businessIncomeRows),
  );

  const applyExplicitExclusions = async () => {
    const selected = disabledStreamsWithData.filter((option) => exclusionChoices[option.key] === "hide-and-exclude");
    const personalIds = selected.flatMap((option) => personalRowsForStream(option.key, personalIncomeRows).map((row) => row.id));
    const businessIds = selected.flatMap((option) => businessRowsForStream(option.key, businessIncomeRows).map((row) => row.linked_transaction_id).filter(Boolean));

    if (personalIds.length > 0) {
      const { error } = await supabase.from("income_entries").update({ include_in_tax_estimate: false } as any).in("id", personalIds);
      if (error) throw error;
    }
    if (businessIds.length > 0) {
      const { error } = await supabase.from("transactions").update({ excluded_from_reports: true } as any).in("id", businessIds);
      if (error) throw error;
    }
    if (personalIds.length > 0 || businessIds.length > 0) {
      queryClient.invalidateQueries({ queryKey: ["personal_income_entries"] });
      queryClient.invalidateQueries({ queryKey: ["income_entries"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    }
  };

  const saveWithSafetyCheck = () => {
    if (disabledStreamsWithData.length > 0 && !disabledStreamsWithData.every((option) => exclusionChoices[option.key])) {
      setConfirmOpen(true);
      return;
    }
    draft.save();
  };

  return (
    <SectionCard
      title="Dashboard Personalization"
      icon={<Settings2 className="h-5 w-5" />}
      description="Choose the income streams your household uses so PaycheckMD can show the right dashboard sections, income pages, and tax recommendations."
      isDirty={draft.isDirty}
      isSaving={draft.isSaving}
      justSaved={savedTick}
      onSave={saveWithSafetyCheck}
      onCancel={draft.cancel}
    >
      <div className="space-y-2">
        <p className="text-sm font-medium text-card-foreground">What income does your household currently have?</p>
        <p className="text-xs text-muted-foreground">Select every income type that applies. We'll use this to personalize your dashboard and tax tools.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {HOUSEHOLD_INCOME_STREAM_OPTIONS.map((option) => (
          <div key={option.key} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <Label className="text-sm font-medium text-card-foreground" htmlFor={`household-${option.key}`}>
              {option.label}
            </Label>
            <Switch
              id={`household-${option.key}`}
              checked={draft.draft[option.key]}
              onCheckedChange={(checked) => draft.patch({ [option.key]: checked } as Partial<HouseholdIncomeStreams>)}
            />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-card-foreground">{pathway.label}</p>
          <Badge variant="outline">Derived pathway</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{pathway.explanation}</p>
      </div>
      {draft.isDirty && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-card-foreground">This will update your app experience.</p>
            <p className="text-xs text-muted-foreground mt-1">Existing data will not be deleted. Income is not excluded from tax projections unless you explicitly choose that option.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-card-foreground mb-2">Visible sections</p>
              <ul className="space-y-1 text-xs text-muted-foreground">{visibleSections.slice(0, 6).map((label) => <li key={label}>• {label}</li>)}</ul>
            </div>
            <div>
              <p className="text-xs font-medium text-card-foreground mb-2">Hidden sections</p>
              <ul className="space-y-1 text-xs text-muted-foreground">{hiddenSections.length ? hiddenSections.slice(0, 6).map((label) => <li key={label}>• {label}</li>) : <li>• None</li>}</ul>
            </div>
            <div>
              <p className="text-xs font-medium text-card-foreground mb-2">Premium features</p>
              <ul className="space-y-1 text-xs text-muted-foreground">{lockedSections.length ? lockedSections.slice(0, 6).map((label) => <li key={label}>• {label}</li>) : <li>• None</li>}</ul>
            </div>
          </div>
        </div>
      )}
      {pathwayWillChange && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-card-foreground">When did this income change start?</p>
            <p className="text-xs text-muted-foreground mt-1">This records your pathway history only. It does not split the tax year or remove prior data from the tax engine.</p>
          </div>
          <RadioGroup value={effectiveDateChoice} onValueChange={(value) => setEffectiveDateChoice(value as EffectiveDateChoice)} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-card-foreground"><RadioGroupItem value="today" />Today</label>
            <label className="flex items-center gap-2 text-sm text-card-foreground"><RadioGroupItem value="month-start" />Start of this month</label>
            <label className="flex items-center gap-2 text-sm text-card-foreground"><RadioGroupItem value="year-start" />Start of this year</label>
            <label className="flex items-center gap-2 text-sm text-card-foreground"><RadioGroupItem value="custom" />Custom date</label>
          </RadioGroup>
          {effectiveDateChoice === "custom" && (
            <div className="max-w-xs">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Effective date</Label>
              <DateField value={customEffectiveDate} onChange={setCustomEffectiveDate} />
            </div>
          )}
        </div>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm income stream changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have existing income data for one or more streams you turned off. Choose how the app should treat those records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-2">
            {disabledStreamsWithData.map((option) => (
              <div key={option.key} className="rounded-lg border border-border p-3 space-y-3">
                <p className="text-sm font-medium text-card-foreground">You have existing {option.moduleLabel} income data.</p>
                <RadioGroup
                  value={exclusionChoices[option.key] || "hide-only"}
                  onValueChange={(value) => setExclusionChoices((prev) => ({ ...prev, [option.key]: value as "hide-only" | "hide-and-exclude" }))}
                >
                  <label className="flex items-start gap-2 text-sm text-card-foreground"><RadioGroupItem value="hide-only" className="mt-0.5" />Hide tools only, keep income in tax projection.</label>
                  <label className="flex items-start gap-2 text-sm text-card-foreground"><RadioGroupItem value="hide-and-exclude" className="mt-0.5" />Hide tools and exclude income from tax projection.</label>
                </RadioGroup>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); draft.save(); }}>Save profile</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
/* ──────────────────────────────────────────────────────────── */
type OnboardingPreferencesDraft = Pick<TaxRates, "subscriptionTier">;

const DEDUCTION_LABELS: Record<string, string> = {
  retirement_401k: "401(k) / retirement contributions", healthcare_premiums: "Healthcare premiums", hsa: "HSA contributions", mileage: "Mileage",
  home_office: "Home office", business_expenses: "Business expenses", professional_expenses: "Professional expenses", charitable: "Charitable donations",
  mortgage_interest: "Mortgage interest", salt: "State and local taxes", other: "Other deductions",
};

const DEDUCTIONS_BY_PROFILE: Record<IncomeProfileType, string[]> = {
  w2_only: ["retirement_401k", "healthcare_premiums", "hsa", "charitable", "mortgage_interest", "salt", "other"],
  w2_plus_business: ["retirement_401k", "healthcare_premiums", "hsa", "mileage", "home_office", "business_expenses", "professional_expenses", "charitable", "mortgage_interest", "salt", "other"],
  business_only: ["business_expenses", "mileage", "home_office", "healthcare_premiums", "hsa", "professional_expenses", "retirement_401k", "other"],
};

function OnboardingPreferencesSection() {
  const { data } = useTaxSettings();
  const updateMutation = useUpdateTaxSettings();
  const [savedTick, setSavedTick] = useState(false);

  const source: OnboardingPreferencesDraft = useMemo(() => ({
    subscriptionTier: data?.subscriptionTier || "premium",
  }), [data]);

  const draft = useSectionDraft<OnboardingPreferencesDraft>({
    source,
    onSave: async (next) => {
      if (!data?.id) throw new Error("Tax settings not loaded");
      // Only updates subscription tier. Income type / pathway is owned by the
      // Dashboard Personalization section (householdIncomeStreams).
      await updateMutation.mutateAsync({ id: data.id, ...next });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    },
  });

  const d = draft.draft;

  return (
    <SectionCard title="Plan" icon={<Settings2 className="h-5 w-5" />} description="Manage your subscription tier. Income types are configured in Dashboard Personalization above." isDirty={draft.isDirty} isSaving={draft.isSaving} justSaved={savedTick} onSave={draft.save} onCancel={draft.cancel}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label className="text-xs text-muted-foreground mb-1.5 block">Plan status</Label><Select value={d.subscriptionTier} onValueChange={(v) => draft.patch({ subscriptionTier: v as OnboardingSubscriptionTier })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="free">Free</SelectItem><SelectItem value="premium">Premium</SelectItem></SelectContent></Select></div>
      </div>
      <Separator className="my-2" />
      <p className="text-xs text-muted-foreground">Deduction method (Standard or Itemized) is set in Tax Profile below. HSA tracking has moved to Profile & Tax Profile.</p>
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────── */
type TaxProfileDraft = Pick<TaxRates,
  | "filingStatus" | "deductionType" | "itemizedDeductionAmount"
  | "qualifyingChildrenCount" | "otherDependentsCount"
  | "withholdingOverrideType" | "withholdingOverridePercent" | "withholdingOverrideAmount"
  | "stateIncomeTaxEnabled" | "stateOfResidence" | "personalStateTaxMode"
  | "personalStateTaxRate" | "personalStateTaxAnnualEstimate"
  | "businessStateTaxEnabled" | "businessStateTaxRate"
  | "businessStateTaxBase" | "businessStateTaxApplicationMode"
  | "timezone"
>;

/** Curated IANA timezones — common US zones plus UTC fallback. "" = auto (browser, falls back to PT). */
const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "__auto__", label: "Auto-detect (browser / Pacific fallback)" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Mountain (no DST) — Phoenix" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
  { value: "UTC", label: "UTC" },
];

function TaxProfileSection() {
  const { data } = useTaxSettings();
  const updateMutation = useUpdateTaxSettings();
  const [savedTick, setSavedTick] = useState(false);

  const source: TaxProfileDraft = useMemo(() => ({
    filingStatus: data?.filingStatus || "single",
    deductionType: data?.deductionType || "standard",
    itemizedDeductionAmount: data?.itemizedDeductionAmount ?? 0,
    qualifyingChildrenCount: data?.qualifyingChildrenCount ?? 0,
    otherDependentsCount: data?.otherDependentsCount ?? 0,
    withholdingOverrideType: data?.withholdingOverrideType || "none",
    withholdingOverridePercent: data?.withholdingOverridePercent ?? null,
    withholdingOverrideAmount: data?.withholdingOverrideAmount ?? null,
    stateIncomeTaxEnabled: !!data?.stateIncomeTaxEnabled,
    stateOfResidence: data?.stateOfResidence || "",
    personalStateTaxMode: data?.personalStateTaxMode || "none",
    personalStateTaxRate: data?.personalStateTaxRate ?? 0,
    personalStateTaxAnnualEstimate: data?.personalStateTaxAnnualEstimate ?? 0,
    businessStateTaxEnabled: !!data?.businessStateTaxEnabled,
    businessStateTaxRate: data?.businessStateTaxRate ?? 0,
    businessStateTaxBase: data?.businessStateTaxBase || "net_profit",
    businessStateTaxApplicationMode: data?.businessStateTaxApplicationMode || "all_business",
    timezone: data?.timezone ?? null,
  }), [data]);

  const draft = useSectionDraft<TaxProfileDraft>({
    source,
    onSave: async (next) => {
      if (!data?.id) throw new Error("Tax settings not loaded");
      await updateMutation.mutateAsync({ id: data.id, ...next });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    },
  });

  const d = draft.draft;
  const set = draft.patch;

  return (
    <SectionCard
      bare
      title="Tax Profile"
      description="Inputs that drive the predictive tax model."
      isDirty={draft.isDirty}
      isSaving={draft.isSaving}
      justSaved={savedTick}
      onSave={draft.save}
      onCancel={draft.cancel}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Filing Status</Label>
          <Select value={d.filingStatus} onValueChange={(v) => set({ filingStatus: v as TaxRates["filingStatus"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Single</SelectItem>
              <SelectItem value="married_filing_jointly" data-testid="onboarding-filing-status-mfj">Married Filing Jointly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Deduction Type</Label>
          <Select value={d.deductionType} onValueChange={(v) => set({ deductionType: v as TaxRates["deductionType"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard Deduction</SelectItem>
              <SelectItem value="itemized">Itemized Deduction</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground mb-1.5 block">Timezone</Label>
          <Select
            value={d.timezone ?? "__auto__"}
            onValueChange={(v) => set({ timezone: v === "__auto__" ? null : v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Determines what counts as "today" for planner auto-conversion. Defaults to Pacific time when auto-detect is unavailable.
          </p>
        </div>
      </div>

      {d.deductionType === "itemized" && (
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Itemized Deduction Amount ($)</Label>
          <Input
            type="number" step="100" min="0"
            value={d.itemizedDeductionAmount}
            onChange={(e) => set({ itemizedDeductionAmount: Math.max(0, parseFloat(e.target.value) || 0) })}
            placeholder="e.g. 35000"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Qualifying Children</Label>
          <Input
            type="number" step="1" min="0"
            value={d.qualifyingChildrenCount}
            onChange={(e) => set({ qualifyingChildrenCount: Math.max(0, Math.floor(parseFloat(e.target.value) || 0)) })}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Other Dependents</Label>
          <Input
            type="number" step="1" min="0"
            value={d.otherDependentsCount}
            onChange={(e) => set({ otherDependentsCount: Math.max(0, Math.floor(parseFloat(e.target.value) || 0)) })}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Optional Withholding Target</Label>
          <p className="text-[11px] text-muted-foreground mb-2">Override the recommended set-aside output. Used for planning only.</p>
          <Select value={d.withholdingOverrideType} onValueChange={(v) => set({ withholdingOverrideType: v as TaxRates["withholdingOverrideType"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No override (use recommendation)</SelectItem>
              <SelectItem value="percent">Target withholding percent</SelectItem>
              <SelectItem value="amount">Target extra dollar amount</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {d.withholdingOverrideType === "percent" && (
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Target Withholding %</Label>
            <Input
              type="number" step="0.5" min="0" max="100"
              value={d.withholdingOverridePercent ?? ""}
              onChange={(e) => {
                const raw = parseFloat(e.target.value);
                set({ withholdingOverridePercent: isNaN(raw) ? null : Math.min(100, Math.max(0, raw)) });
              }}
              placeholder="e.g. 25"
            />
          </div>
        )}

        {d.withholdingOverrideType === "amount" && (
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Target Extra Amount ($) per pay period</Label>
            <Input
              type="number" step="50" min="0"
              value={d.withholdingOverrideAmount ?? ""}
              onChange={(e) => {
                const raw = parseFloat(e.target.value);
                set({ withholdingOverrideAmount: isNaN(raw) ? null : Math.max(0, raw) });
              }}
              placeholder="e.g. 500"
            />
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-border space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-card-foreground">Personal State Income Tax</h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">State income tax on personal income only.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Switch checked={d.stateIncomeTaxEnabled} onCheckedChange={(v) => set({ stateIncomeTaxEnabled: v })} />
            <Label className="text-xs text-muted-foreground">Enable</Label>
          </div>
        </div>

        {d.stateIncomeTaxEnabled && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">State of residence</Label>
                <Input value={d.stateOfResidence} onChange={(e) => set({ stateOfResidence: e.target.value })} placeholder="e.g. WA, CA, TX" maxLength={32} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Personal state tax mode</Label>
                <Select value={d.personalStateTaxMode} onValueChange={(v) => set({ personalStateTaxMode: v as TaxRates["personalStateTaxMode"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="flat_rate">Flat rate</SelectItem>
                    <SelectItem value="annual_estimate">Annual estimate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {d.personalStateTaxMode === "flat_rate" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Personal state tax rate (%)</Label>
                <Input type="number" step="0.1" min="0" max="100" value={d.personalStateTaxRate} onChange={(e) => set({ personalStateTaxRate: parseFloat(e.target.value) || 0 })} />
              </div>
            )}
            {d.personalStateTaxMode === "annual_estimate" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Annual state tax estimate ($)</Label>
                <Input type="number" step="100" min="0" value={d.personalStateTaxAnnualEstimate} onChange={(e) => set({ personalStateTaxAnnualEstimate: parseFloat(e.target.value) || 0 })} />
              </div>
            )}
          </>
        )}
      </div>

      <div className="pt-2 border-t border-border space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-card-foreground">Business State Tax (B&O / Franchise / Gross Receipts)</h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">Some states (like Washington) have no personal income tax but do have business taxes.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Switch checked={d.businessStateTaxEnabled} onCheckedChange={(v) => set({ businessStateTaxEnabled: v })} />
            <Label className="text-xs text-muted-foreground">Enable</Label>
          </div>
        </div>

        {d.businessStateTaxEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Rate (%)</Label>
              <Input type="number" step="0.1" min="0" max="100" value={d.businessStateTaxRate} onChange={(e) => set({ businessStateTaxRate: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Tax base</Label>
              <Select value={d.businessStateTaxBase} onValueChange={(v) => set({ businessStateTaxBase: v as TaxRates["businessStateTaxBase"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="net_profit">Net business profit</SelectItem>
                  <SelectItem value="gross">Gross business income</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Apply to</Label>
              <Select value={d.businessStateTaxApplicationMode} onValueChange={(v) => set({ businessStateTaxApplicationMode: v as TaxRates["businessStateTaxApplicationMode"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_business">All business companies</SelectItem>
                  <SelectItem value="selected">Selected companies only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {d.businessStateTaxApplicationMode === "selected" && (
              <p className="text-[11px] text-muted-foreground sm:col-span-3">
                Use each company's "Apply business state tax" toggle (in Companies → Advanced) to choose which ones are included.
              </p>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Companies section                                            */
/* ──────────────────────────────────────────────────────────── */
function CompaniesSection() {
  const { companies, incomeCountByCompanyName, addCompany, updateCompany, removeCompany } = useCompanies();
  const { data: taxSettings } = useTaxSettings();
  const [deleteCompanyId, setDeleteCompanyId] = useState<string | null>(null);

  // Single page-wide draft keyed by company id, so each company gets local edit state.
  const [drafts, setDrafts] = useState<Record<string, Partial<Company>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<Record<string, boolean>>({});
  const [advancedOpenIds, setAdvancedOpenIds] = useState<Set<string>>(new Set());
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);

  const dirtyIds = Object.keys(drafts);
  const anyDirty = dirtyIds.length > 0;
  const allowedNewCompanyTypes = useMemo(() => getAllowedCompanyTypes(taxSettings?.incomeProfileType || "w2_plus_business").map(onboardingCompanyTypeToFilingType), [taxSettings?.incomeProfileType]);
  const defaultCompanyType = allowedNewCompanyTypes[0] || "1099_schedule_c";

  function setField<K extends keyof Company>(id: string, field: K, value: Company[K]) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  }

  function isDirty(id: string) { return id in drafts; }

  function getValue<K extends keyof Company>(c: Company, field: K): Company[K] {
    const d = drafts[c.id];
    if (d && field in d) return d[field] as Company[K];
    return c[field];
  }

  async function saveCompany(c: Company) {
    if (!isDirty(c.id)) return;
    setSavingId(c.id);
    try {
      await updateCompany(c.id, drafts[c.id]);
      setDrafts((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
      setSavedFlash((p) => ({ ...p, [c.id]: true }));
      setTimeout(() => setSavedFlash((p) => { const n = { ...p }; delete n[c.id]; return n; }), 2000);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save company");
    } finally {
      setSavingId(null);
    }
  }

  function cancelCompany(id: string) {
    setDrafts((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  function executeDeleteCompany() {
    if (!deleteCompanyId) return;
    cancelCompany(deleteCompanyId);
    removeCompany(deleteCompanyId);
    setDeleteCompanyId(null);
    toast.success("Company deleted");
  }

  function handleAdd() {
    addCompany({
      name: "", nickname: "", companyType: defaultCompanyType, includeInTax: true,
      defaultSetasideMethod: "recommended", defaultSetasidePct: null, notes: "",
      advancedFieldVisibility: {}, applyBusinessStateTax: true, includeSETaxInRecommendation: true,
      payFrequency: null, remainingPaychecksOverride: null,
      employeeRole: null, projectedAnnualGross: null, expectedFederalWithholdingPerPaycheck: null,
    });
  }

  function toggleAdvanced(id: string) {
    setAdvancedOpenIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  return (
    <>
      <div data-testid="companies-section">
      <SectionCard
        title="Companies"
        icon={<Building2 className="h-5 w-5" />}
        summary={`(${companies.length})`}
        description={
          companies.length > 0
            ? `Set the filing type for each company. Currently tracking: ${companies.map((c) => c.name || "Unnamed").join(", ")}.`
            : "Set the filing type for each company."
        }
        defaultOpen={companies.length > 0}
        headerAction={
          <div className="flex items-center gap-2">
            {/* Merge duplicates UI hidden — keep logic in MergeCompaniesDialog for future re-enable. */}
            {false && companies.length > 1 && <MergeCompaniesDialog />}
            <Button data-testid="add-company-button" variant="outline" size="sm" onClick={handleAdd} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        }
        headerActionOpenOnly
        isDirty={anyDirty}
        // Section-level save bar is hidden — each company has its own.
        hideActionBar
      >
        {companies.length === 0 && (
          <div className="text-center py-8">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No companies added yet.</p>
            <Button data-testid="add-company-button-empty" onClick={handleAdd} className="mt-4 gap-2"><Plus className="h-4 w-4" /> Add Company</Button>
          </div>
        )}

        <TooltipProvider delayDuration={150}>
          <div className="space-y-3">
            {companies.map((company) => {
              const incomeCount = incomeCountByCompanyName[company.name] || 0;
              const filingTypeLocked = incomeCount > 0;
              const companyTypeOptions = company.name.trim() ? COMPANY_TYPES : COMPANY_TYPES.filter((type) => allowedNewCompanyTypes.includes(type.value));
              const advOpen = advancedOpenIds.has(company.id);
              const toggleOptions = TOGGLE_OPTIONS_BY_TYPE[getValue(company, "companyType")];
              const visibility = resolveAdvancedVisibility(
                getValue(company, "companyType"),
                getValue(company, "advancedFieldVisibility"),
              );
              const dirty = isDirty(company.id);
              const saving = savingId === company.id;
              const saved = !!savedFlash[company.id];

              return (
                <div key={company.id} className={cn(
                  "border rounded-lg p-4 space-y-3 transition-colors",
                  dirty ? "border-warning/40 bg-warning/5" : "border-border",
                )}>
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <Label className="text-xs text-muted-foreground mb-1.5 block">Company name</Label>
                        <Input
                          value={getValue(company, "name") as string}
                          onChange={(e) => setField(company.id, "name", e.target.value)}
                          placeholder="e.g. Vituity"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 mt-6 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (dirty) { setConfirmDiscardId(company.id); return; }
                          setDeleteCompanyId(company.id);
                        }}
                        aria-label="Delete company"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Label className="text-xs text-muted-foreground">Filing type</Label>
                        {filingTypeLocked && (
                          <Tooltip>
                            <TooltipTrigger asChild><Lock className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="text-xs">Locked because income transactions exist for this company.</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <Select
                        value={getValue(company, "companyType") as string}
                        onValueChange={(v) => setField(company.id, "companyType", v as FilingType)}
                        disabled={filingTypeLocked}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {companyTypeOptions.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {(() => {
                        const bucket = ledgerForIncomeType(getValue(company, "companyType"));
                        return (
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            Ledger:{" "}
                            <span className={bucket === "business" ? "text-primary font-medium" : "text-foreground font-medium"}>
                              {ledgerLabel(bucket)}
                            </span>
                          </p>
                        );
                      })()}
                    </div>
                  </div>

                  <Collapsible open={advOpen} onOpenChange={() => toggleAdvanced(company.id)}>
                    <CollapsibleTrigger asChild>
                      <button type="button" className="flex min-h-10 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                        {advOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        Advanced tax settings
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3">
                      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-5">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-foreground">Show these fields when adding income</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 pt-1">
                            {toggleOptions.map((opt) => (
                              <label key={opt.key} className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                                <Checkbox
                                  checked={visibility[opt.key]}
                                  onCheckedChange={(v) => {
                                    const next = { ...(getValue(company, "advancedFieldVisibility") || {}), [opt.key]: !!v };
                                    setField(company.id, "advancedFieldVisibility", next);
                                  }}
                                />
                                <span>{opt.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Nickname (optional)</Label>
                          <Input
                            value={getValue(company, "nickname") as string}
                            onChange={(e) => setField(company.id, "nickname", e.target.value)}
                            placeholder="Short label"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3 items-end">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1.5 block">Default tax set-aside method</Label>
                            <Select
                              value={getValue(company, "defaultSetasideMethod") as string}
                              onValueChange={(v) => setField(company.id, "defaultSetasideMethod", v as Company["defaultSetasideMethod"])}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="recommended">Use app recommendation</SelectItem>
                                <SelectItem value="flat_percentage">Flat percentage of gross</SelectItem>
                                <SelectItem value="none">No automatic set-aside</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1.5 block">Default %</Label>
                            <Input
                              type="number" step="0.1" min="0" max="100"
                              value={(getValue(company, "defaultSetasidePct") as number | null) ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setField(company.id, "defaultSetasidePct", v === "" ? null : parseFloat(v));
                              }}
                              placeholder="e.g. 25"
                              disabled={getValue(company, "defaultSetasideMethod") !== "flat_percentage"}
                            />
                          </div>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</Label>
                          <Textarea
                            value={getValue(company, "notes") as string}
                            onChange={(e) => setField(company.id, "notes", e.target.value)}
                            rows={2}
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <Switch
                            checked={getValue(company, "includeInTax") as boolean}
                            onCheckedChange={(v) => setField(company.id, "includeInTax", v)}
                          />
                          <Label className="text-xs text-muted-foreground">Include in tax projections</Label>
                        </div>

                        {ledgerForIncomeType(getValue(company, "companyType")) === "business" && (
                          <div className="space-y-4 pt-1">
                            <div className="flex items-start gap-2">
                              <Switch
                                checked={(getValue(company, "includeSETaxInRecommendation") as boolean) !== false}
                                onCheckedChange={(v) => setField(company.id, "includeSETaxInRecommendation", v)}
                              />
                              <div>
                                <Label className="text-xs text-muted-foreground">Add self-employment tax to savings recommendation</Label>
                                <p className="text-[11px] text-muted-foreground/80 mt-0.5 max-w-2xl">
                                  Turn this on if this company’s income should include self-employment tax in the recommended savings amount. Turn off for income where Social Security/Medicare is already handled, such as W-2 payroll, or for K-1/S-Corp income that is not subject to SE tax.
                                </p>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <Switch
                                checked={(getValue(company, "applyBusinessStateTax") as boolean) !== false}
                                onCheckedChange={(v) => setField(company.id, "applyBusinessStateTax", v)}
                              />
                              <div>
                                <Label className="text-xs text-muted-foreground">Apply business state tax</Label>
                                <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                                  Used when business state tax is set to "Selected companies only".
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {(() => {
                    const ft = getValue(company, "companyType") as FilingType;
                    if (ft !== "w2" && ft !== "scorp_w2") return null;
                    const freq = (getValue(company, "payFrequency") as string | null) ?? "";
                    const override = getValue(company, "remainingPaychecksOverride") as number | null;
                    return (
                      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                        <p className="text-xs font-semibold text-foreground">W-4 / paycheck settings</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1.5 block">Pay frequency</Label>
                            <Select
                              value={freq || "unset"}
                              onValueChange={(v) => setField(company.id, "payFrequency", v === "unset" ? null : v)}
                            >
                              <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unset">Not set</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                                <SelectItem value="biweekly">Biweekly</SelectItem>
                                <SelectItem value="semimonthly">Semimonthly</SelectItem>
                                <SelectItem value="monthly">Monthly</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1.5 block">Remaining paychecks this year</Label>
                            <Input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              placeholder="Auto"
                              value={override ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setField(company.id, "remainingPaychecksOverride", v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));
                              }}
                            />
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Used by the W-4 Paycheck Adjustment worksheet. Leave remaining paychecks blank to auto-detect from your paycheck history.
                        </p>
                      </div>
                    );
                  })()}

                  {(dirty || saved) && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                      {saved && !dirty && (
                        <span className="text-xs text-success mr-auto">Saved</span>
                      )}
                      {dirty && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => cancelCompany(company.id)} disabled={saving}>Cancel</Button>
                          <Button size="sm" onClick={() => saveCompany(company)} disabled={saving}>
                            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                            Save Changes
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      </SectionCard>
      </div>


      <AlertDialog open={!!deleteCompanyId} onOpenChange={(open) => !open && setDeleteCompanyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Company</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this company.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeDeleteCompany} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDiscardId} onOpenChange={(open) => !open && setConfirmDiscardId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>This company has unsaved edits. Deleting it will discard them too.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDiscardId) {
                  cancelCompany(confirmDiscardId);
                  setDeleteCompanyId(confirmDiscardId);
                }
                setConfirmDiscardId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard & Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Connected Accounts (Plaid) — redesigned                      */
/* ──────────────────────────────────────────────────────────── */
function ConnectedAccountsSection() {
  const { companies } = useCompanies();
  const { data: plaidItems = [], isLoading: plaidItemsLoading } = usePlaidItems();
  const { data: plaidAccounts = [] } = usePlaidAccounts();
  const { data: needsReviewTransactions = [] } = usePlaidNeedsReviewTransactions();
  const syncMutation = useSyncTransactions();
  const disconnectMutation = useDisconnectPlaidItem();
  const updateAccountMutation = useUpdatePlaidAccount();
  const bulkApplyMutation = useBulkApplyAccountBusiness();
  const backfillMutation = useBackfillPlaidTransactions();
  const reviewAccountsMutation = useReviewAccounts();

  const [linkLoading, setLinkLoading] = useState(false);
  const [disconnectItemId, setDisconnectItemId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [editRouting, setEditRouting] = useState<string>("needs_review");
  const [editMode, setEditMode] = useState<string>("unassigned");
  const [editCompanyId, setEditCompanyId] = useState<string>("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);

  // Post-link review modal
  const [reviewItemId, setReviewItemId] = useState<string | null>(null);
  const [reviewInstitution, setReviewInstitution] = useState<string>("");
  const [reviewPrefs, setReviewPrefs] = useState<
    Record<string, { sync_enabled: boolean; mode: string; companyId: string; routing: string }>
  >({});

  const totalAccounts = plaidAccounts.length;
  const needsReviewByAccount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of needsReviewTransactions as any[]) {
      counts[row.plaid_account_id] = (counts[row.plaid_account_id] || 0) + 1;
    }
    return counts;
  }, [needsReviewTransactions]);

  const toggleExpand = (id: string) =>
    setExpandedItems((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const handleConnectBank = async () => {
    if (linkLoading) return;
    setLinkLoading(true);
    const loadingToast = toast.loading("Opening secure bank connection…");
    try {
      const { data, error } = await supabase.functions.invoke("plaid-create-link-token");
      toast.dismiss(loadingToast);
      if (error || !data?.link_token) {
        console.error("plaid-create-link-token failed", error, data);
        toast.error(`Failed to initialize bank connection${error?.message ? `: ${error.message}` : ""}`);
        return;
      }
      if (!(window as any).Plaid) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Plaid"));
          document.head.appendChild(script);
        });
      }
      const handler = (window as any).Plaid.create({
        token: data.link_token,
        onSuccess: async (publicToken: string, metadata: any) => {
          const { data: exchangeData, error: exchangeError } = await supabase.functions.invoke("plaid-exchange-token", {
            body: { public_token: publicToken, institution_name: metadata?.institution?.name || "Bank Account", institution_id: metadata?.institution?.institution_id || "" },
          });
          if (exchangeError) { toast.error("Failed to connect account"); }
          else {
            toast.success("Bank account connected! Please review imported accounts.");
            if (exchangeData?.item_db_id) {
              setReviewItemId(exchangeData.item_db_id);
              setReviewInstitution(exchangeData.institution_name || "Bank Account");
              setTimeout(async () => {
                const { data: newAccts } = await supabase
                  .from("plaid_accounts").select("*")
                  .eq("plaid_item_id", exchangeData.item_db_id).eq("is_active", true);
                if (newAccts) {
                  const prefs: Record<string, { sync_enabled: boolean; mode: string; companyId: string; routing: string }> = {};
                  for (const a of newAccts) prefs[a.id] = { sync_enabled: true, mode: "unassigned", companyId: "", routing: "needs_review" };
                  setReviewPrefs(prefs);
                }
              }, 500);
            }
          }
        },
        onExit: () => {},
      });
      handler.open();
    } catch (e: any) {
      toast.dismiss(loadingToast);
      console.error("handleConnectBank error", e);
      toast.error(e?.message || "Failed to open bank connection");
    }
    finally { setLinkLoading(false); }
  };

  const accountTypeIcon = (type: string) => {
    if (type === "credit") return <CreditCard className="h-4 w-4" />;
    return <Building2 className="h-4 w-4" />;
  };

  const formatDate = (d: string | null) => {
    if (!d) return "Never";
    const date = new Date(d);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return formatDateDisplay(date);
  };

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return null;
    return companies.find((c) => c.id === companyId)?.name || null;
  };

  const getModeLabel = (routing: string, mode: string, companyId: string | null) => {
    if (routing === "personal") return "Personal";
    if (routing === "ignore") return "Ignored";
    if (routing === "needs_review") return "Needs Review";
    if (routing === "business") {
      if (mode === "single_business") {
        const name = getCompanyName(companyId);
        return name ? `Business · ${name}` : "Business";
      }
      if (mode === "shared") return "Business · Shared";
      return "Business";
    }
    return "Needs Review";
  };

  const getModeColor = (routing: string): "secondary" | "default" | "outline" | "destructive" => {
    if (routing === "business") return "default";
    if (routing === "personal") return "secondary";
    if (routing === "ignore") return "outline";
    return "destructive";
  };

  const openEditDialog = (acct: any) => {
    setEditingAccount(acct);
    setEditRouting(acct.account_routing || "needs_review");
    setEditMode(acct.account_business_mode || "unassigned");
    setEditCompanyId(acct.default_company_id || "");
  };

  const editAssignmentChanged = useMemo(() => {
    if (!editingAccount) return false;
    return (
      editRouting !== (editingAccount.account_routing || "needs_review") ||
      editMode !== (editingAccount.account_business_mode || "unassigned") ||
      editCompanyId !== (editingAccount.default_company_id || "")
    );
  }, [editingAccount, editRouting, editMode, editCompanyId]);

  const handleSaveAffiliation = () => {
    if (!editingAccount) return;
    updateAccountMutation.mutate({
      id: editingAccount.id,
      account_business_mode: editRouting === "business" ? editMode : "unassigned",
      default_company_id: editRouting === "business" && editMode === "single_business" && editCompanyId ? editCompanyId : null,
      account_routing: editRouting,
    }, {
      onSuccess: () => {
        const wasNeedsReview = (editingAccount.account_routing || "needs_review") === "needs_review";
        const canRouteNow = editRouting === "business" || editRouting === "personal";
        const pendingCount = needsReviewByAccount[editingAccount.plaid_account_id] || 0;
        if (wasNeedsReview && canRouteNow && pendingCount > 0) {
          backfillMutation.mutate(editingAccount.plaid_account_id);
        }
        setEditingAccount(null);
      },
    });
  };

  const handleBulkApply = () => {
    if (!editingAccount || editMode !== "single_business" || !editCompanyId) return;
    const name = getCompanyName(editCompanyId);
    if (!name) return;
    bulkApplyMutation.mutate({ accountId: editingAccount.id, companyName: name });
  };

  const handleSaveReview = async () => {
    if (!reviewItemId) return;
    const { data: accts } = await supabase.from("plaid_accounts").select("id").eq("plaid_item_id", reviewItemId).eq("is_active", true);
    if (!accts) return;
    const updates = accts.map((a) => {
      const pref = reviewPrefs[a.id] || { sync_enabled: false, mode: "unassigned", companyId: "", routing: "needs_review" };
      const routing = pref.routing;
      return {
        id: a.id,
        sync_enabled: routing !== "ignore",
        account_business_mode: routing === "business" ? pref.mode : "unassigned",
        default_company_id: routing === "business" && pref.mode === "single_business" && pref.companyId ? pref.companyId : null,
        account_routing: routing,
      };
    });
    reviewAccountsMutation.mutate(updates, {
      onSuccess: () => {
        setReviewItemId(null);
        setReviewPrefs({});
        syncMutation.mutate(reviewItemId!);
      },
    });
  };

  return (
    <>
      <SectionCard
        title="Connected Accounts"
        icon={<Landmark className="h-5 w-5" />}
        summary={plaidItems.length > 0 ? `(${plaidItems.length} institution${plaidItems.length !== 1 ? "s" : ""}, ${totalAccounts} account${totalAccounts !== 1 ? "s" : ""})` : ""}
        description="Manage linked banks. Assign each account to a destination."
        defaultOpen={false}
        headerAction={
          plaidItems.length > 0 ? (
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); syncMutation.mutate(undefined); }}
              disabled={syncMutation.isPending}
              className="gap-1.5"
            >
              {syncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="hidden sm:inline">Refresh All</span>
            </Button>
          ) : (
            <Button size="sm" onClick={handleConnectBank} disabled={linkLoading} className="gap-1.5">
              {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span className="hidden sm:inline">Connect</span>
            </Button>
          )
        }
        hideActionBar
      >
        {plaidItemsLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : plaidItems.length === 0 ? (
          <div className="text-center py-8">
            <Landmark className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Connect your bank accounts to automatically import transactions.</p>
            <Button onClick={handleConnectBank} disabled={linkLoading} className="mt-4 gap-2">
              {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Connect Your First Account
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Top action row when expanded */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {(() => {
                let latest: string | null = null;
                for (const it of plaidItems as any[]) {
                  if (!it.last_synced_at) continue;
                  if (!latest || new Date(it.last_synced_at) > new Date(latest)) latest = it.last_synced_at;
                }
                // Daily cron runs at 08:15 UTC
                const now = new Date();
                const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 15, 0));
                if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
                const nextLabel = formatDateTime(next);
                return (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Last synced: <span className="font-medium text-card-foreground">{formatDate(latest)}</span></span>
                    <span className="hidden sm:inline">·</span>
                    <span className="hidden sm:inline">Next auto-sync: <span className="font-medium text-card-foreground">{nextLabel}</span></span>
                  </div>
                );
              })()}
              <Button size="sm" onClick={handleConnectBank} disabled={linkLoading} className="gap-1.5">
                {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="hidden sm:inline">Connect New Account</span>
                <span className="sm:hidden">Connect</span>
              </Button>
            </div>
            {plaidItems.map((item) => {
              const accounts = plaidAccounts.filter((a) => a.plaid_item_id === item.id);
              const expanded = expandedItems.has(item.id);
              const itemSyncing = syncingItemId === item.id && syncMutation.isPending;
              return (
                <div key={item.id} className="rounded-lg border border-border bg-card overflow-hidden">
                  {/* Institution header — collapsed by default */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
                    aria-expanded={expanded}
                  >
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary flex-shrink-0">
                      <Landmark className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-card-foreground truncate">{item.institution_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {accounts.length} account{accounts.length !== 1 ? "s" : ""} · synced {formatDate(item.last_synced_at)}
                      </p>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform flex-shrink-0", expanded && "rotate-180")} />
                  </button>

                  {expanded && (
                    <div className="border-t border-border bg-muted/10">
                      {/* Action row — separated from header */}
                      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-card">
                        <Button
                          variant="outline" size="sm"
                          onClick={() => { setSyncingItemId(item.id); syncMutation.mutate(item.id, { onSettled: () => setSyncingItemId(null) }); }}
                          disabled={itemSyncing}
                          className="gap-1.5"
                        >
                          {itemSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          Refresh
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          onClick={() => backfillMutation.mutate(undefined)}
                          disabled={backfillMutation.isPending}
                          className="gap-1.5"
                        >
                          {backfillMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          Re-sync / Backfill
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setDisconnectItemId(item.id)}
                          className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                        >
                          <Unplug className="h-3.5 w-3.5" /> Disconnect
                        </Button>
                      </div>

                      {accounts.length > 0 && (
                        <div className="p-3 space-y-2">
                          {accounts.map((acct) => {
                            const routing = (acct as any).account_routing || "needs_review";
                            const mode = (acct as any).account_business_mode || "unassigned";
                            const companyId = (acct as any).default_company_id || null;
                            const isActive = routing === "business" || routing === "personal";
                            const pendingReviewCount = needsReviewByAccount[(acct as any).plaid_account_id] || 0;
                            return (
                              <div key={acct.id} className={cn(
                                "rounded-lg border border-border bg-card p-3",
                                !isActive && "opacity-70",
                              )}>
                                <div className="flex items-start gap-3">
                                  <div className="text-muted-foreground mt-0.5 flex-shrink-0">{accountTypeIcon(acct.account_type)}</div>
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <p className="text-sm font-medium text-card-foreground truncate">{acct.account_name}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {acct.account_type}{acct.account_subtype ? ` · ${acct.account_subtype}` : ""}
                                      {acct.account_mask ? ` ···${acct.account_mask}` : ""}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                      <Badge variant={getModeColor(routing)} className="text-[10px] h-5">
                                        {getModeLabel(routing, mode, companyId)}
                                      </Badge>
                                      {pendingReviewCount > 0 && (
                                        <Badge variant="outline" className="text-[10px] h-5">
                                          {pendingReviewCount} Needs Review
                                        </Badge>
                                      )}
                                      {acct.current_balance != null && (
                                        <span className="text-[11px] font-mono text-muted-foreground">
                                          ${Number(acct.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-8 w-8 p-0 flex-shrink-0"
                                    onClick={() => openEditDialog(acct)}
                                    aria-label="Edit assignment"
                                  >
                                    <Settings2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Disconnect dialog */}
      <AlertDialog open={!!disconnectItemId} onOpenChange={() => setDisconnectItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Bank Account?</AlertDialogTitle>
            <AlertDialogDescription>This deactivates the connection. Previously imported transactions are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (disconnectItemId) disconnectMutation.mutate(disconnectItemId); setDisconnectItemId(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit account routing dialog */}
      <Dialog open={!!editingAccount} onOpenChange={() => setEditingAccount(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Account Assignment</DialogTitle>
            <DialogDescription>Choose where transactions from this account should be routed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Transaction Destination</Label>
              <Select value={editRouting} onValueChange={(v) => { setEditRouting(v); if (v !== "business") { setEditMode("unassigned"); setEditCompanyId(""); } }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Business Activity</SelectItem>
                  <SelectItem value="personal">Personal Income / Activity</SelectItem>
                  <SelectItem value="ignore">Ignore / Do Not Sync</SelectItem>
                  <SelectItem value="needs_review">Needs Review</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {editRouting === "business" && "Transactions appear in Business Activity for profit/loss tracking."}
                {editRouting === "personal" && "Transactions appear in Personal Income. Not included in business P&L."}
                {editRouting === "ignore" && "No transactions will be imported from this account."}
                {editRouting === "needs_review" && "Transactions are imported into Needs Review until you choose a destination."}
              </p>
            </div>
            {editRouting === "business" && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Business Assignment</Label>
                  <Select value={editMode} onValueChange={setEditMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      <SelectItem value="single_business">One Specific Business</SelectItem>
                      <SelectItem value="shared">Shared / Multiple Businesses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editMode === "single_business" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Default Business</Label>
                    <Select value={editCompanyId} onValueChange={setEditCompanyId}>
                      <SelectTrigger><SelectValue placeholder="Select a business..." /></SelectTrigger>
                      <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {editMode === "single_business" && editCompanyId && (
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground mb-2">Apply this business to existing unassigned transactions from this account.</p>
                    <Button variant="outline" size="sm" onClick={handleBulkApply} disabled={bulkApplyMutation.isPending}>
                      {bulkApplyMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                      Apply to Existing Transactions
                    </Button>
                  </div>
                )}
              </>
            )}
            {editAssignmentChanged && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                <p className="text-xs text-foreground">
                  Changing this assignment may affect how imported transactions are categorized going forward.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>Cancel</Button>
            <Button
              onClick={handleSaveAffiliation}
              disabled={
                updateAccountMutation.isPending ||
                !editAssignmentChanged ||
                (editRouting === "business" && editMode === "single_business" && !editCompanyId)
              }
            >
              {updateAccountMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-link review dialog */}
      <Dialog open={!!reviewItemId} onOpenChange={(open) => { if (!open) { setReviewItemId(null); setReviewPrefs({}); } }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Imported Accounts</DialogTitle>
            <DialogDescription>
              {reviewInstitution} returned the accounts below. Choose where each account's transactions should go.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {Object.entries(reviewPrefs).length === 0 ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              (() => {
                const reviewAccounts = plaidAccounts.filter((a) => a.plaid_item_id === reviewItemId);
                return (reviewAccounts.length > 0 ? reviewAccounts : []).map((acct: any) => {
                  const pref = reviewPrefs[acct.id] || { sync_enabled: false, mode: "unassigned", companyId: "", routing: "needs_review" };
                  const routing = pref.routing;
                  return (
                    <div key={acct.id} className="rounded-lg border border-border p-4 space-y-3 bg-card">
                      <div className="flex items-center gap-3">
                        <div className="text-muted-foreground">{accountTypeIcon(acct.account_type)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-card-foreground truncate">{acct.account_name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {acct.account_type}{acct.account_subtype ? ` · ${acct.account_subtype}` : ""}
                            {acct.account_mask ? ` ···${acct.account_mask}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">Route to:</Label>
                        <Select value={routing} onValueChange={(v) => setReviewPrefs((p) => ({ ...p, [acct.id]: { ...pref, routing: v, mode: v !== "business" ? "unassigned" : pref.mode, companyId: v !== "business" ? "" : pref.companyId, sync_enabled: v !== "ignore" } }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="business">Business Activity</SelectItem>
                            <SelectItem value="personal">Personal Income / Activity</SelectItem>
                            <SelectItem value="ignore">Ignore / Do Not Sync</SelectItem>
                            <SelectItem value="needs_review">Decide Later</SelectItem>
                          </SelectContent>
                        </Select>
                        {routing === "business" && (
                          <div className="space-y-2 pl-2">
                            <Select value={pref.mode} onValueChange={(v) => setReviewPrefs((p) => ({ ...p, [acct.id]: { ...pref, mode: v, companyId: v !== "single_business" ? "" : pref.companyId } }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">No default business</SelectItem>
                                <SelectItem value="single_business">Assign to a business</SelectItem>
                                <SelectItem value="shared">Shared / Multiple</SelectItem>
                              </SelectContent>
                            </Select>
                            {pref.mode === "single_business" && (
                              <Select value={pref.companyId} onValueChange={(v) => setReviewPrefs((p) => ({ ...p, [acct.id]: { ...pref, companyId: v } }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select business..." /></SelectTrigger>
                                <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                              </Select>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewItemId(null); setReviewPrefs({}); }}>Skip</Button>
            <Button onClick={handleSaveReview} disabled={reviewAccountsMutation.isPending}>
              {reviewAccountsMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Save & Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Team section                                                 */
/* ──────────────────────────────────────────────────────────── */
function TeamSection() {
  const { organizationId, userRole, user } = useAuth();
  const isAdminOrOwner = userRole === "owner" || userRole === "admin";

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [deleteMemId, setDeleteMemId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!organizationId) return;
    setMembersLoading(true);
    const { data: memberships } = await supabase.from("organization_members").select("id, user_id, role").eq("organization_id", organizationId);
    if (!memberships) { setMembersLoading(false); return; }
    const userIds = memberships.map((m) => m.user_id);
    const { data: profiles } = await supabase.from("profiles").select("user_id, email, first_name, last_name").in("user_id", userIds);
    const profileMap = new Map(profiles?.map((p) => [p.user_id, p]) || []);
    setMembers(memberships.map((m) => ({ ...m, email: profileMap.get(m.user_id)?.email || "", first_name: profileMap.get(m.user_id)?.first_name || "", last_name: profileMap.get(m.user_id)?.last_name || "" })));
    setMembersLoading(false);
  }, [organizationId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  async function handleInvite() {
    if (!inviteEmail || !organizationId) return;
    setInviting(true);
    const { error } = await supabase.functions.invoke("invite-user", {
      body: { email: inviteEmail, firstName: inviteFirstName, lastName: inviteLastName, organizationId, role: inviteRole },
    });
    setInviting(false);
    if (error) toast.error("Failed to invite: " + error.message);
    else { toast.success(`Invite sent to ${inviteEmail}`); setShowInvite(false); setInviteEmail(""); setInviteFirstName(""); setInviteLastName(""); setInviteRole("member"); loadMembers(); }
  }

  async function handleRemoveMember() {
    if (!deleteMemId) return;
    const { error } = await supabase.from("organization_members").delete().eq("id", deleteMemId);
    if (error) toast.error(error.message); else { toast.success("Member removed"); loadMembers(); }
    setDeleteMemId(null);
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    const { error } = await supabase.from("organization_members").update({ role: newRole as "owner" | "admin" | "member" }).eq("id", memberId);
    if (error) toast.error(error.message); else { toast.success("Role updated"); loadMembers(); }
  }

  return (
    <>
      <SectionCard
        title="Team"
        icon={<Users className="h-5 w-5" />}
        summary={`(${members.length} member${members.length !== 1 ? "s" : ""})`}
        defaultOpen={false}
        headerAction={
          isAdminOrOwner && (
            <Button size="sm" onClick={() => setShowInvite(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Invite</span>
            </Button>
          )
        }
        hideActionBar
      >
        <div className="space-y-2">
          {membersLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No team members yet.</p>
          ) : members.map((member) => {
            const Icon = roleIcons[member.role as keyof typeof roleIcons] || User;
            return (
              <Card key={member.id} className="shadow-none">
                <CardContent className="flex items-center gap-3 py-3 px-3 sm:px-4">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-card-foreground truncate">
                      {member.first_name} {member.last_name}
                      {member.user_id === user?.id && <span className="text-muted-foreground ml-1">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isAdminOrOwner && member.user_id !== user?.id && member.role !== "owner" ? (
                      <Select value={member.role} onValueChange={(v) => handleRoleChange(member.id, v)}>
                        <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {userRole === "owner" && <SelectItem value="admin">Admin</SelectItem>}
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={roleColors[member.role as keyof typeof roleColors] || "outline"} className="capitalize">{member.role}</Badge>
                    )}
                    {isAdminOrOwner && member.user_id !== user?.id && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteMemId(member.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SectionCard>

      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} /></div>
              <div><Label>Last Name</Label><Input value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} /></div>
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">An invite link will be sent to this email.</p>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="member">Member</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>{inviting ? "Sending…" : "Send Invite"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteMemId} onOpenChange={(open) => !open && setDeleteMemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove Team Member</AlertDialogTitle><AlertDialogDescription>This removes them from your organization.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveMember} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Main Settings page                                           */
/* ──────────────────────────────────────────────────────────── */
export default function Settings() {
  // Track dirty flags from the few sections that share global guard.
  // We use a simple ref-based registry via window event since each section
  // owns its own draft. For the beforeunload guard, we approximate by
  // wiring a top-level dirty signal through context-less mechanism:
  // each section sets a window-level flag.
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key: string; dirty: boolean };
      setDirtyMap((m) => ({ ...m, [detail.key]: detail.dirty }));
    };
    window.addEventListener("settings:dirty" as any, handler);
    return () => window.removeEventListener("settings:dirty" as any, handler);
  }, []);
  useUnsavedChangesGuard(Object.values(dirtyMap));

  const justSavedFlag = (_key: string) => false; // reserved for future use

  return (
    <div data-testid="settings-root" className="space-y-4 max-w-3xl mx-auto pb-12">
      <SectionCard
        title="Profile & Tax Profile"
        icon={<UserCircle className="h-5 w-5" />}
        description="Your personal info and tax filing details."
        hideActionBar
      >
        <ProfileSection justSavedFlag={justSavedFlag} />
        <Separator className="my-2" />
        <TaxProfileSection />
        <Separator className="my-2" />
        <HsaSettingsSection bare />
        <Separator className="my-2" />
        <ForecastingAutomationSection bare />
      </SectionCard>

      <SectionCard
        title="Tax Withholding & Quarterly Tracker"
        icon={<Calculator className="h-5 w-5" />}
        description="Choose how withholding recommendations and quarterly targets are calculated."
        hideActionBar
      >
        <TaxWithholdingSection />
        <Separator className="my-2" />
        <QuarterlyTrackerMethodSection />
      </SectionCard>

      <OnboardingPreferencesSection />
      <HouseholdIncomeStreamsSection />
      <CompaniesSection />
      <ConnectedAccountsSection />
      <TeamSection />
      <DangerZoneSection />
    </div>
  );
}
