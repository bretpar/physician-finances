import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Eye, EyeOff, PiggyBank, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isAuthRateLimitError } from "@/lib/authProtection";
import {
  computeQuickEstimate, US_STATES, ESTIMATE_STORAGE_KEY,
  type IncomeKind, type FilingStatus, type DeductionStrategy, type QuickEstimateInput,
} from "@/lib/quickEstimate";

type Step = 1 | 2 | 3 | 4;

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const DEFAULT_INPUT: QuickEstimateInput = {
  incomeKind: "w2_plus_business",
  filingStatus: "single",
  state: "",
  w2Income: 0,
  businessIncome: 0,
  investmentIncome: 0,
  deductionStrategy: "standard",
  itemizedAmount: 0,
  retirement401k: 0,
  hsa: 0,
  otherPretax: 0,
};

function loadDraft(): { input: QuickEstimateInput; firstName: string; email: string } {
  if (typeof window === "undefined") return { input: DEFAULT_INPUT, firstName: "", email: "" };
  try {
    const raw = sessionStorage.getItem(ESTIMATE_STORAGE_KEY);
    if (!raw) return { input: DEFAULT_INPUT, firstName: "", email: "" };
    const parsed = JSON.parse(raw);
    return {
      input: { ...DEFAULT_INPUT, ...(parsed.input || {}) },
      firstName: parsed.firstName || "",
      email: parsed.email || "",
    };
  } catch { return { input: DEFAULT_INPUT, firstName: "", email: "" }; }
}

function saveDraft(input: QuickEstimateInput, firstName: string, email: string) {
  try { sessionStorage.setItem(ESTIMATE_STORAGE_KEY, JSON.stringify({ input, firstName, email })); } catch { /* ignore */ }
}

function SelectCard({ selected, title, description, onClick }: { selected: boolean; title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(
      "w-full rounded-xl border p-4 text-left transition-colors",
      selected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
    )}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
          {selected && <Check className="h-3 w-3" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-card-foreground">{title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
        </span>
      </div>
    </button>
  );
}

function NumberField({ label, value, onChange, hint, prefix = "$" }: { label: string; value: number; onChange: (n: number) => void; hint?: string; prefix?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>
        <Input
          type="number" inputMode="decimal" min={0} className="pl-7"
          value={value === 0 ? "" : String(value)}
          placeholder="0"
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        />
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function Estimate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const initial = useMemo(loadDraft, []);
  const [step, setStep] = useState<Step>(1);
  const [input, setInput] = useState<QuickEstimateInput>(initial.input);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [email, setEmail] = useState(initial.email);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const prefillEmail = searchParams.get("email");
    if (prefillEmail) setEmail(prefillEmail);
  }, [searchParams]);

  useEffect(() => { saveDraft(input, firstName, email); }, [input, firstName, email]);

  if (user) return <Navigate to="/onboarding" replace />;

  const patch = (u: Partial<QuickEstimateInput>) => setInput((c) => ({ ...c, ...u }));
  const result = useMemo(() => computeQuickEstimate(input), [input]);
  const showW2 = input.incomeKind !== "business_only";
  const showBiz = input.incomeKind !== "w2_only";

  function next() {
    if (step === 1) {
      if (!input.incomeKind) { toast.error("Pick your income type."); return; }
    }
    if (step === 2) {
      if (!input.state) { toast.error("Select your state."); return; }
      if (showW2 && input.w2Income <= 0 && input.incomeKind === "w2_only") { toast.error("Enter your approximate W-2 income."); return; }
      if (showBiz && input.businessIncome <= 0 && input.incomeKind === "business_only") { toast.error("Enter your approximate business income."); return; }
    }
    setStep((s) => Math.min(4, s + 1) as Step);
  }

  async function handleCreateAccount() {
    if (saving) return;
    const trimmedFirst = firstName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!trimmedFirst) { toast.error("Enter your first name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { toast.error("Enter a valid email."); return; }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters."); return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail, password,
        options: { data: { first_name: trimmedFirst }, emailRedirectTo: window.location.origin },
      });
      if (error) {
        if (isAuthRateLimitError(error)) toast.error("Too many signup attempts. Please wait a few minutes.");
        else toast.error(error.message || "Could not create account.");
        return;
      }
      const identities = (data.user as any)?.identities;
      if (data.user && Array.isArray(identities) && identities.length === 0) {
        toast.error("That email is already registered. Please log in instead.");
        return;
      }
      if (!data.session) {
        toast.success("Account created. Check your email to verify, then log in to save your plan.");
        navigate("/login");
        return;
      }
      await persistEstimateToSettings(data.user!.id, input, trimmedFirst);
      sessionStorage.removeItem(ESTIMATE_STORAGE_KEY);
      navigate("/onboarding", { replace: true });
    } catch (e: any) {
      toast.error(e.message || "Could not create account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="space-y-6 p-5 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <PiggyBank className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Step {step} of 4 — quick tax estimate</p>
              <div className="mt-1 h-2 w-44 max-w-full rounded-full bg-muted">
                <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${(step / 4) * 100}%` }} />
              </div>
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">What type of income do you have?</h1>
                <p className="mt-1 text-sm text-muted-foreground">We'll tailor the estimate to your situation. No account needed yet.</p>
              </div>
              <div className="grid gap-3">
                <SelectCard selected={input.incomeKind === "w2_only"} title="W-2 only" description="Employee paycheck income with taxes withheld by payroll." onClick={() => patch({ incomeKind: "w2_only" })} />
                <SelectCard selected={input.incomeKind === "w2_plus_business"} title="W-2 + 1099/K-1" description="Paychecks plus 1099, K-1, contractor, partnership, or side income." onClick={() => patch({ incomeKind: "w2_plus_business" })} />
                <SelectCard selected={input.incomeKind === "business_only"} title="1099/K-1 only" description="Self-employed, contractor, partnership, or pass-through income only." onClick={() => patch({ incomeKind: "business_only" })} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">A few quick details</h1>
                <p className="mt-1 text-sm text-muted-foreground">Round numbers are fine — this is just a preview.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Filing status</Label>
                  <Select value={input.filingStatus} onValueChange={(v) => patch({ filingStatus: v as FilingStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single</SelectItem>
                      <SelectItem value="married_filing_jointly">Married filing jointly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>State</Label>
                  <Select value={input.state} onValueChange={(v) => patch({ state: v })}>
                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {US_STATES.map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {showW2 && (
                  <NumberField label="Approx annual W-2 income" value={input.w2Income} onChange={(n) => patch({ w2Income: n })} hint="Before taxes & deductions." />
                )}
                {showBiz && (
                  <NumberField label="Approx annual 1099/K-1/business income" value={input.businessIncome} onChange={(n) => patch({ businessIncome: n })} hint="Net of business expenses." />
                )}
                <NumberField label="Investment income (optional)" value={input.investmentIncome} onChange={(n) => patch({ investmentIncome: n })} hint="Dividends, interest, gains." />
                <div>
                  <Label>Deduction strategy</Label>
                  <Select value={input.deductionStrategy} onValueChange={(v) => patch({ deductionStrategy: v as DeductionStrategy })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard deduction</SelectItem>
                      <SelectItem value="itemized">Itemized</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {input.deductionStrategy === "itemized" && (
                  <NumberField label="Itemized deduction amount" value={input.itemizedAmount} onChange={(n) => patch({ itemizedAmount: n })} />
                )}
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium text-foreground">Pre-tax deductions (optional)</p>
                <p className="text-xs text-muted-foreground">If you contribute to any of these, add the annual amounts.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <NumberField label="401(k) / retirement" value={input.retirement401k} onChange={(n) => patch({ retirement401k: n })} />
                  <NumberField label="HSA" value={input.hsa} onChange={(n) => patch({ hsa: n })} />
                  <NumberField label="Other pre-tax" value={input.otherPretax} onChange={(n) => patch({ otherPretax: n })} />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Here's your estimate</h1>
                <p className="mt-1 text-sm text-muted-foreground">Based on the info you shared.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted-foreground">Estimated effective tax rate</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{pct(result.effectiveRate)}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <p className="text-xs text-emerald-800 dark:text-emerald-300">Recommended to set aside</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-900 dark:text-emerald-100">{fmt(result.recommendedSetAside)}</p>
                  <p className="mt-1 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">For taxes not covered by W-2 withholding.</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted-foreground">Quarterly tax reserve</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{fmt(result.quarterlyReserve)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Per quarter (4× per year).</p>
                </div>
              </div>
              <div className="rounded-lg border border-border p-4 text-sm">
                <p className="font-medium text-foreground">Breakdown</p>
                <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs text-muted-foreground">
                  <dt>Gross income</dt><dd className="text-right text-foreground">{fmt(result.grossIncome)}</dd>
                  <dt>Pre-tax deductions</dt><dd className="text-right text-foreground">−{fmt(result.pretaxDeductions)}</dd>
                  <dt>Taxable base (after std/itemized)</dt><dd className="text-right text-foreground">{fmt(result.taxableBase)}</dd>
                  <dt>Federal income tax</dt><dd className="text-right text-foreground">{fmt(result.federalTax)}</dd>
                  <dt>Self-employment tax</dt><dd className="text-right text-foreground">{fmt(result.seTax)}</dd>
                  <dt>State tax (est.)</dt><dd className="text-right text-foreground">{fmt(result.stateTax)}</dd>
                  <dt className="font-medium text-foreground">Total estimated tax</dt><dd className="text-right font-medium text-foreground">{fmt(result.totalTax)}</dd>
                </dl>
              </div>
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                This is a simplified estimate, not tax advice. The full app uses real brackets, state-specific rules, and your actual paychecks/transactions for a more precise recommendation.
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Save your plan</h1>
                <p className="mt-1 text-sm text-muted-foreground">Create an account so we keep your estimate and personalize it as you track real income.</p>
              </div>
              <div className="grid gap-4">
                <div>
                  <Label>First name</Label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Alex" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                </div>
                <div>
                  <Label>Password</Label>
                  <div className="relative">
                    <Input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" className="pr-10" />
                    <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPassword((v) => !v)}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Use at least 8 characters.</p>
                </div>
                <p className="text-xs text-muted-foreground">Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link></p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="outline" onClick={() => step === 1 ? navigate(-1) : setStep((s) => Math.max(1, s - 1) as Step)} disabled={saving}>
              <ChevronLeft className="mr-1 h-4 w-4" />Back
            </Button>
            {step < 4 ? (
              <Button onClick={next}>{step === 3 ? "Save my plan" : "Continue"}</Button>
            ) : (
              <Button onClick={handleCreateAccount} disabled={saving}>
                {saving ? "Creating account…" : "Create account and save my plan"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

async function persistEstimateToSettings(userId: string, input: QuickEstimateInput, firstName: string) {
  let settingsRow: { id: string } | null = null;
  for (let i = 0; i < 12; i++) {
    const { data } = await supabase.from("tax_settings").select("id").eq("user_id", userId).maybeSingle();
    if (data) { settingsRow = data as any; break; }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!settingsRow) return;

  const incomeProfile = input.incomeKind;
  const enabledIncomeSources = {
    w2: incomeProfile !== "business_only",
    form1099: incomeProfile !== "w2_only",
    k1: incomeProfile !== "w2_only",
  };
  const enabledDeductions: string[] = [];
  if (input.retirement401k > 0) enabledDeductions.push("retirement_401k");
  if (input.hsa > 0) enabledDeductions.push("hsa");
  if (input.otherPretax > 0) enabledDeductions.push("other");

  const payload: Record<string, unknown> = {
    onboarding_first_name: firstName,
    onboarding_complete: false,
    onboarding_step: 2,
    income_profile_type: incomeProfile,
    enabled_income_sources: enabledIncomeSources,
    filing_status: input.filingStatus,
    deduction_strategy: input.deductionStrategy,
    deduction_type: input.deductionStrategy === "itemized" ? "itemized" : "standard",
    itemized_deduction_amount: input.deductionStrategy === "itemized" ? input.itemizedAmount : 0,
    enabled_deduction_types: enabledDeductions,
    hsa_enabled: input.hsa > 0,
  };
  if (input.state) {
    payload.state_of_residence = input.state;
    payload.state_income_tax_enabled = true;
    payload.state_tax_enabled = true;
  }
  await supabase.from("tax_settings").update(payload as any).eq("id", settingsRow.id);
  await supabase.from("profiles").update({ first_name: firstName }).eq("user_id", userId);
}
