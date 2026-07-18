import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { DeductionStrategy, EnabledIncomeSources, IncomeProfileType, OnboardingSubscriptionTier, TaxRecommendationMethod } from "@/lib/onboarding";
import { SS_WAGE_BASE } from "@/lib/taxBrackets";

/**
 * Historical Social Security wage bases that shipped as auto-populated
 * defaults on `tax_settings` in previous app versions. When the persisted
 * value is one of these (and does not match the active-year base), we treat
 * it as a legacy default rather than an intentional user override and fall
 * back to the active-year `SS_WAGE_BASE`. This prevents an old row from
 * silently under-capping SE Social Security tax after the wage base rolls
 * forward. Values a user explicitly typed (e.g. 200000) are still honored.
 */
const LEGACY_SS_WAGE_CAP_DEFAULTS = new Set<number>([
  137700, // 2020
  142800, // 2021
  147000, // 2022
  160200, // 2023
  168600, // 2024 — was hard-coded as the app default and is the value the audit flagged
  176100, // 2025
]);

function resolveEffectiveSsWageCap(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return SS_WAGE_BASE;
  if (n === SS_WAGE_BASE) return n;
  if (LEGACY_SS_WAGE_CAP_DEFAULTS.has(n)) return SS_WAGE_BASE;
  return n;
}



export type WithholdingMethod = "flat_estimate" | "dynamic_actual" | "dynamic_planner";
export type W2PaycheckRecMethod = "paycheck_target" | "annual_w4";
export type QuarterlyTrackerMethod = "even" | "dynamic";
export type DeductionType = "standard" | "itemized";
export type WithholdingOverrideType = "none" | "percent" | "amount";
export type PersonalStateTaxMode = "none" | "flat_rate" | "annual_estimate";
export type BusinessStateTaxBase = "net_profit" | "gross";
export type BusinessStateTaxApplicationMode = "all_business" | "selected";

export interface HouseholdIncomeStreams {
  w2Income: boolean;
  spouseW2Income: boolean;
  additionalW2Job: boolean;
  business1099Income: boolean;
  k1PartnershipIncome: boolean;
  sCorpIncome: boolean;
  rentalIncome: boolean;
  investmentIncome: boolean;
  otherIncome: boolean;
}

export interface TaxRates {
  id?: string;
  // Core profile
  filingStatus: "single" | "married_filing_jointly";
  lastYearTax: number;
  standardDeductionOverride: number | null;
  ssWageCap: number;
  taxMode: "projected_brackets" | "manual_effective_rate";
  manualEffectiveTaxRate: number | null;
  withholdingMethod: WithholdingMethod;
  /** Controls how W-2 paycheck guidance is displayed in Personal Income. */
  w2PaycheckRecMethod: W2PaycheckRecMethod;
  // New tax profile fields
  deductionType: DeductionType;
  itemizedDeductionAmount: number;
  qualifyingChildrenCount: number;
  otherDependentsCount: number;
  withholdingOverrideType: WithholdingOverrideType;
  withholdingOverridePercent: number | null;
  withholdingOverrideAmount: number | null;
  // ─── State Tax ───
  stateIncomeTaxEnabled: boolean;
  /** Backwards-compatible alias for personal state income tax only. */
  stateTaxEnabled: boolean;
  stateOfResidence: string;
  personalStateTaxMode: PersonalStateTaxMode;
  personalStateTaxRate: number;              // percent (e.g. 4.5 = 4.5%)
  personalStateTaxAnnualEstimate: number;    // dollars
  businessStateTaxEnabled: boolean;
  businessStateTaxRate: number;              // percent
  businessStateTaxBase: BusinessStateTaxBase;
  businessStateTaxApplicationMode: BusinessStateTaxApplicationMode;
  businessStateTaxCompanyIds: string[];
  // ─── HSA ───
  hsaEnabled: boolean;
  hsaSourceCompanyId: string | null;
  /** HSA coverage type — drives the applicable annual contribution limit. */
  hsaCoverageType: "individual" | "family";
  /** Whether the user is eligible for the age-55+ catch-up contribution. */
  hsaAge55Catchup: boolean;
  // ─── Household Income Streams ───
  householdIncomeStreams: HouseholdIncomeStreams;
  // ─── Forecasting Automation ───
  /** Auto-convert future planned income into real ledger drafts on/after their date. */
  autoConvertFutureIncomeToLedger: boolean;
  /** IANA timezone (e.g. America/Los_Angeles) used to decide what "today" means for planner conversion. Null = use browser default, falling back to America/Los_Angeles. */
  timezone: string | null;
  // ─── Quarterly Tax Tracker ───
  /** How the dashboard Quarterly Tax Progress card computes each quarter's target. */
  quarterlyTrackerMethod: QuarterlyTrackerMethod;
  onboardingComplete: boolean | null;
  onboardingBannerDismissed: boolean;
  onboardingFirstName: string;
  onboardingStep: number;
  incomeProfileType: IncomeProfileType;
  enabledIncomeSources: EnabledIncomeSources;
  enabledPersonalIncomeTypes: string[];
  taxRecommendationMethod: TaxRecommendationMethod;
  flatFederalRate: number | null;
  flatStateRate: number | null;
  deductionStrategy: DeductionStrategy;
  enabledDeductionTypes: string[];
  subscriptionTier: OnboardingSubscriptionTier;
  ytdCatchupChoice: "yes" | "no" | "skip" | null;
}

const DEFAULT_RATES: TaxRates = {
  filingStatus: "single",
  lastYearTax: 0,
  standardDeductionOverride: null,
  ssWageCap: 168600,
  taxMode: "projected_brackets",
  manualEffectiveTaxRate: null,
  withholdingMethod: "dynamic_planner",
  w2PaycheckRecMethod: "annual_w4",
  deductionType: "standard",
  itemizedDeductionAmount: 0,
  qualifyingChildrenCount: 0,
  otherDependentsCount: 0,
  withholdingOverrideType: "none",
  withholdingOverridePercent: null,
  withholdingOverrideAmount: null,
  stateIncomeTaxEnabled: false,
  stateTaxEnabled: false,
  stateOfResidence: "",
  personalStateTaxMode: "none",
  personalStateTaxRate: 0,
  personalStateTaxAnnualEstimate: 0,
  businessStateTaxEnabled: false,
  businessStateTaxRate: 0,
  businessStateTaxBase: "net_profit",
  businessStateTaxApplicationMode: "all_business",
  businessStateTaxCompanyIds: [],
  hsaEnabled: false,
  hsaSourceCompanyId: null,
  hsaCoverageType: "individual",
  hsaAge55Catchup: false,
  householdIncomeStreams: {
    w2Income: true,
    spouseW2Income: true,
    additionalW2Job: true,
    business1099Income: true,
    k1PartnershipIncome: true,
    sCorpIncome: true,
    rentalIncome: true,
    investmentIncome: true,
    otherIncome: true,
  },
  autoConvertFutureIncomeToLedger: false,
  timezone: null,
  quarterlyTrackerMethod: "even",
  onboardingComplete: null,
  onboardingBannerDismissed: false,
  onboardingFirstName: "",
  onboardingStep: 1,
  incomeProfileType: "w2_plus_business",
  enabledIncomeSources: { w2: true, form1099: true, k1: true },
  enabledPersonalIncomeTypes: [],
  taxRecommendationMethod: "dynamic_planner",
  flatFederalRate: null,
  flatStateRate: null,
  deductionStrategy: "standard",
  enabledDeductionTypes: [],
  subscriptionTier: "premium",
  ytdCatchupChoice: null,
};

export function useTaxSettings(enabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return useQuery({
    queryKey: ["tax_settings", userId],
    enabled: enabled && !!userId,
    queryFn: async () => {

      const { data: rows, error } = await supabase
        .from("tax_settings")
        .select("*")
        .eq("user_id", userId)
        .order("onboarding_complete", { ascending: false })
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(2);
      if (error) {
        console.error("[useTaxSettings] failed to load tax_settings", {
          userId,
          code: (error as any).code,
          message: error.message,
        });
        // Throw so ProtectedRoutes keeps the query in a loading/error state
        // rather than treating a permission failure as "onboarding incomplete".
        throw error;
      }
      const data = rows?.[0] ?? null;
      if ((rows?.length || 0) > 1) {
        console.warn("[useTaxSettings] duplicate tax_settings rows detected; using authoritative row", {
          userId,
          selectedId: (data as any)?.id,
          selectedOnboardingComplete: (data as any)?.onboarding_complete,
        });
      }
      if (!data) {
        console.warn("[useTaxSettings] no tax_settings row found, attempting recovery insert", { userId });
        // Safe fallback: create a row for this user so they're not trapped in
        // onboarding due to a missing row. We do NOT set onboarding_complete;
        // truly new users still complete onboarding normally.
        const { data: inserted, error: insertErr } = await supabase
          .from("tax_settings")
          .insert({ user_id: userId } as any)
          .select("*")
          .maybeSingle();
        if (insertErr) {
          console.error("[useTaxSettings] recovery insert failed", {
            userId,
            code: (insertErr as any).code,
            message: insertErr.message,
          });
          return DEFAULT_RATES;
        }
        console.info("[useTaxSettings] recovery insert succeeded", { userId, id: (inserted as any)?.id });
        return mapTaxSettingsRow(inserted);
      }
      console.debug("[useTaxSettings] loaded tax_settings", {
        userId,
        id: (data as any).id,
        onboarding_complete: (data as any).onboarding_complete,
      });
      return mapTaxSettingsRow(data);
    },
  });
}

function mapTaxSettingsRow(data: any): TaxRates {
  if (!data) return DEFAULT_RATES;
  const d = data as any;
  return {
    id: data.id,
    filingStatus: (data.filing_status as TaxRates["filingStatus"]) || "single",
    lastYearTax: Number(data.last_year_tax) || 0,
    standardDeductionOverride: data.standard_deduction_override != null ? Number(data.standard_deduction_override) : null,
    ssWageCap: Number(data.ss_wage_cap) || 168600,
    taxMode: (d.tax_mode as TaxRates["taxMode"]) || "projected_brackets",
    manualEffectiveTaxRate: d.manual_effective_tax_rate != null ? Number(d.manual_effective_tax_rate) : null,
    withholdingMethod: (d.withholding_method as WithholdingMethod) || "dynamic_planner",
    w2PaycheckRecMethod: (d.w2_paycheck_rec_method as W2PaycheckRecMethod) || "annual_w4",
    deductionType: (d.deduction_type as DeductionType) || "standard",
    itemizedDeductionAmount: Number(d.itemized_deduction_amount) || 0,
    qualifyingChildrenCount: Number(d.qualifying_children_count) || 0,
    otherDependentsCount: Number(d.other_dependents_count) || 0,
    withholdingOverrideType: (d.withholding_override_type as WithholdingOverrideType) || "none",
    withholdingOverridePercent: d.withholding_override_percent != null ? Number(d.withholding_override_percent) : null,
    withholdingOverrideAmount: d.withholding_override_amount != null ? Number(d.withholding_override_amount) : null,
    stateIncomeTaxEnabled: !!(d.state_income_tax_enabled ?? d.state_tax_enabled),
    stateTaxEnabled: !!(d.state_income_tax_enabled ?? d.state_tax_enabled),
    stateOfResidence: (d.state_of_residence as string) || "",
    personalStateTaxMode: (d.personal_state_tax_mode as PersonalStateTaxMode) || "none",
    personalStateTaxRate: Number(d.personal_state_tax_rate) || 0,
    personalStateTaxAnnualEstimate: Number(d.personal_state_tax_annual_estimate) || 0,
    businessStateTaxEnabled: !!d.business_state_tax_enabled,
    businessStateTaxRate: Number(d.business_state_tax_rate) || 0,
    businessStateTaxBase: (d.business_state_tax_base as BusinessStateTaxBase) || "net_profit",
    businessStateTaxApplicationMode: (d.business_state_tax_application_mode as BusinessStateTaxApplicationMode) || "all_business",
    businessStateTaxCompanyIds: Array.isArray(d.business_state_tax_company_ids) ? (d.business_state_tax_company_ids as string[]) : [],
    hsaEnabled: !!d.hsa_enabled,
    hsaSourceCompanyId: (d.hsa_source_company_id as string | null) ?? null,
    hsaCoverageType: (d.hsa_coverage_type as "individual" | "family") || "individual",
    hsaAge55Catchup: !!d.hsa_age55_catchup,
    householdIncomeStreams: {
      w2Income: d.household_w2_income_enabled ?? true,
      spouseW2Income: d.household_spouse_w2_income_enabled ?? true,
      additionalW2Job: d.household_additional_w2_job_enabled ?? true,
      business1099Income: d.household_business_1099_income_enabled ?? true,
      k1PartnershipIncome: d.household_k1_partnership_income_enabled ?? true,
      sCorpIncome: d.household_scorp_income_enabled ?? true,
      rentalIncome: d.household_rental_income_enabled ?? true,
      investmentIncome: d.household_investment_income_enabled ?? true,
      otherIncome: d.household_other_income_enabled ?? true,
    },
    autoConvertFutureIncomeToLedger: !!d.auto_convert_future_income_to_ledger,
    timezone: (d.timezone as string | null) ?? null,
    quarterlyTrackerMethod: (d.quarterly_tracker_method as QuarterlyTrackerMethod) || "even",
    onboardingComplete: d.onboarding_complete ?? null,
    onboardingBannerDismissed: !!d.onboarding_banner_dismissed,
    onboardingFirstName: (d.onboarding_first_name as string) || "",
    onboardingStep: Math.min(6, Math.max(1, Number(d.onboarding_step) || 1)),
    incomeProfileType: (d.income_profile_type as IncomeProfileType) || "w2_plus_business",
    enabledIncomeSources: {
      w2: !!(d.enabled_income_sources?.w2 ?? true),
      form1099: !!(d.enabled_income_sources?.form1099 ?? true),
      k1: !!(d.enabled_income_sources?.k1 ?? true),
    },
    enabledPersonalIncomeTypes: Array.isArray(d.enabled_personal_income_types) ? d.enabled_personal_income_types : [],
    taxRecommendationMethod: (d.tax_recommendation_method as TaxRecommendationMethod) || ((d.withholding_method === "flat_estimate" ? "flat_rate" : d.withholding_method) as TaxRecommendationMethod) || "dynamic_planner",
    flatFederalRate: d.flat_federal_rate != null ? Number(d.flat_federal_rate) : (d.manual_effective_tax_rate != null ? Number(d.manual_effective_tax_rate) : null),
    flatStateRate: d.flat_state_rate != null ? Number(d.flat_state_rate) : null,
    deductionStrategy: (d.deduction_strategy as DeductionStrategy) || ((d.deduction_type === "itemized" ? "itemized" : "standard") as DeductionStrategy),
    enabledDeductionTypes: Array.isArray(d.enabled_deduction_types) ? d.enabled_deduction_types : [],
    subscriptionTier: (d.subscription_tier as OnboardingSubscriptionTier) || "premium",
    ytdCatchupChoice: (d.ytd_catchup_choice as TaxRates["ytdCatchupChoice"]) ?? null,
  } as TaxRates;
}

export function useUpdateTaxSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<TaxRates> & { id: string }) => {
      const { id, ...rest } = settings;
      const cacheUpdates = { ...rest };
      const payload: Record<string, unknown> = {};
      if (rest.filingStatus !== undefined) payload.filing_status = rest.filingStatus;
      if (rest.lastYearTax !== undefined) payload.last_year_tax = rest.lastYearTax;
      if (rest.standardDeductionOverride !== undefined) payload.standard_deduction_override = rest.standardDeductionOverride;
      if (rest.ssWageCap !== undefined) payload.ss_wage_cap = rest.ssWageCap;
      if (rest.withholdingMethod !== undefined) payload.withholding_method = rest.withholdingMethod;
      if (rest.w2PaycheckRecMethod !== undefined) payload.w2_paycheck_rec_method = rest.w2PaycheckRecMethod;
      if (rest.manualEffectiveTaxRate !== undefined) payload.manual_effective_tax_rate = rest.manualEffectiveTaxRate;
      if (rest.deductionType !== undefined) payload.deduction_type = rest.deductionType;
      if (rest.itemizedDeductionAmount !== undefined) payload.itemized_deduction_amount = rest.itemizedDeductionAmount;
      if (rest.qualifyingChildrenCount !== undefined) payload.qualifying_children_count = rest.qualifyingChildrenCount;
      if (rest.otherDependentsCount !== undefined) payload.other_dependents_count = rest.otherDependentsCount;
      if (rest.withholdingOverrideType !== undefined) payload.withholding_override_type = rest.withholdingOverrideType;
      if (rest.withholdingOverridePercent !== undefined) payload.withholding_override_percent = rest.withholdingOverridePercent;
      if (rest.withholdingOverrideAmount !== undefined) payload.withholding_override_amount = rest.withholdingOverrideAmount;
      if (rest.stateIncomeTaxEnabled !== undefined) {
        payload.state_income_tax_enabled = rest.stateIncomeTaxEnabled;
      }
      if (rest.stateTaxEnabled !== undefined) {
        payload.state_income_tax_enabled = rest.stateTaxEnabled;
        payload.state_tax_enabled = rest.stateTaxEnabled;
      }
      if (rest.stateOfResidence !== undefined) payload.state_of_residence = rest.stateOfResidence;
      if (rest.personalStateTaxMode !== undefined) payload.personal_state_tax_mode = rest.personalStateTaxMode;
      if (rest.personalStateTaxRate !== undefined) payload.personal_state_tax_rate = rest.personalStateTaxRate;
      if (rest.personalStateTaxAnnualEstimate !== undefined) payload.personal_state_tax_annual_estimate = rest.personalStateTaxAnnualEstimate;
      if (rest.businessStateTaxEnabled !== undefined) payload.business_state_tax_enabled = rest.businessStateTaxEnabled;
      if (rest.businessStateTaxRate !== undefined) payload.business_state_tax_rate = rest.businessStateTaxRate;
      if (rest.businessStateTaxBase !== undefined) payload.business_state_tax_base = rest.businessStateTaxBase;
      if (rest.businessStateTaxApplicationMode !== undefined) payload.business_state_tax_application_mode = rest.businessStateTaxApplicationMode;
      if (rest.businessStateTaxCompanyIds !== undefined) payload.business_state_tax_company_ids = rest.businessStateTaxCompanyIds;
      if (rest.hsaEnabled !== undefined) payload.hsa_enabled = rest.hsaEnabled;
      if (rest.hsaSourceCompanyId !== undefined) payload.hsa_source_company_id = rest.hsaSourceCompanyId;
      if ((rest as any).hsaCoverageType !== undefined) payload.hsa_coverage_type = (rest as any).hsaCoverageType;
      if ((rest as any).hsaAge55Catchup !== undefined) payload.hsa_age55_catchup = (rest as any).hsaAge55Catchup;
      if (rest.householdIncomeStreams !== undefined) {
        payload.household_w2_income_enabled = rest.householdIncomeStreams.w2Income;
        payload.household_spouse_w2_income_enabled = rest.householdIncomeStreams.spouseW2Income;
        payload.household_additional_w2_job_enabled = rest.householdIncomeStreams.additionalW2Job;
        payload.household_business_1099_income_enabled = rest.householdIncomeStreams.business1099Income;
        payload.household_k1_partnership_income_enabled = rest.householdIncomeStreams.k1PartnershipIncome;
        payload.household_scorp_income_enabled = rest.householdIncomeStreams.sCorpIncome;
        payload.household_rental_income_enabled = rest.householdIncomeStreams.rentalIncome;
        payload.household_investment_income_enabled = rest.householdIncomeStreams.investmentIncome;
        payload.household_other_income_enabled = rest.householdIncomeStreams.otherIncome;
      }
      if (rest.autoConvertFutureIncomeToLedger !== undefined) payload.auto_convert_future_income_to_ledger = rest.autoConvertFutureIncomeToLedger;
      if (rest.timezone !== undefined) payload.timezone = rest.timezone;
      if ((rest as any).quarterlyTrackerMethod !== undefined) payload.quarterly_tracker_method = (rest as any).quarterlyTrackerMethod;
      if (rest.onboardingComplete === true) payload.onboarding_complete = true;
      if (rest.onboardingComplete === false) {
        console.warn("[useUpdateTaxSettings] ignored attempt to reset onboarding_complete to false", { id });
        delete cacheUpdates.onboardingComplete;
      }
      if (rest.onboardingBannerDismissed !== undefined) payload.onboarding_banner_dismissed = rest.onboardingBannerDismissed;
      if (rest.onboardingFirstName !== undefined) payload.onboarding_first_name = rest.onboardingFirstName;
      if (rest.onboardingStep !== undefined) payload.onboarding_step = rest.onboardingStep;
      if (rest.incomeProfileType !== undefined) payload.income_profile_type = rest.incomeProfileType;
      if (rest.enabledIncomeSources !== undefined) payload.enabled_income_sources = rest.enabledIncomeSources;
      if (rest.enabledPersonalIncomeTypes !== undefined) payload.enabled_personal_income_types = rest.enabledPersonalIncomeTypes;
      if (rest.taxRecommendationMethod !== undefined) payload.tax_recommendation_method = rest.taxRecommendationMethod;
      if (rest.flatFederalRate !== undefined) payload.flat_federal_rate = rest.flatFederalRate;
      if (rest.flatStateRate !== undefined) payload.flat_state_rate = rest.flatStateRate;
      if (rest.deductionStrategy !== undefined) payload.deduction_strategy = rest.deductionStrategy;
      if (rest.enabledDeductionTypes !== undefined) payload.enabled_deduction_types = rest.enabledDeductionTypes;
      if (rest.subscriptionTier !== undefined) payload.subscription_tier = rest.subscriptionTier;
      if (rest.ytdCatchupChoice !== undefined) payload.ytd_catchup_choice = rest.ytdCatchupChoice;

      // SECURITY: Always scope the update by the current auth user as well
      // as the row id. RLS already enforces this server-side, but adding
      // `.eq("user_id", auth.uid)` ensures a stale `id` from a previous
      // user's cache cannot accidentally rewrite the wrong account's row.
      const { data: authData } = await supabase.auth.getUser();
      const authUid = authData?.user?.id ?? null;
      if (!authUid) {
        throw new Error("You are signed out. Please sign in again.");
      }
      if ("onboarding_complete" in payload) {
        console.info("[useUpdateTaxSettings] writing onboarding_complete", {
          id,
          authUid,
          onboarding_complete: payload.onboarding_complete,
        });
      }
      const { error, data: updated } = await supabase
        .from("tax_settings")
        .update(payload as any)
        .eq("id", id)
        .eq("user_id", authUid)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updated) {
        console.error("[useUpdateTaxSettings] update affected no row — likely cross-user id", { id, authUid });
        throw new Error("Could not save settings. Please reload and try again.");
      }
      return cacheUpdates;
    },
    onSuccess: async (updates) => {
      qc.setQueriesData<TaxRates>(
        {
          predicate: (query) => Array.isArray(query.queryKey)
            && query.queryKey[0] === "tax_settings"
            && query.queryKey.length === 2
            && typeof query.queryKey[1] === "string",
        },
        (current) => current ? { ...current, ...updates } : current,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tax_settings"] }),
        qc.refetchQueries({ queryKey: ["tax_settings"] }),
        qc.invalidateQueries({ queryKey: ["tax_settings", "auto_convert_flag"] }),
      ]);
      toast.success("Tax settings saved", { duration: 1500 });
    },
    onError: (e) => toast.error(e.message),
  });
}
