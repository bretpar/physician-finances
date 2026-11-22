import { useMemo, useState } from "react";
import { HandCoins } from "lucide-react";
import { SectionCard } from "@/components/settings/SectionCard";
import { useCompanies } from "@/contexts/CompanyContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  readEmployerContributionFormula,
  writeEmployerContributionFormula,
  type EmployerContributionFormula,
} from "@/lib/employerContributionFormula";
import { entityKindForCompanyType } from "@/lib/retirementCanonicalInput";
import { useRetirementSectionLink } from "@/hooks/useRetirementSectionLink";
import { cn } from "@/lib/utils";

type FormulaKind = "none" | "match" | "tiered" | "flat";

interface Draft {
  kind: FormulaKind;
  matchRatePct: string;
  matchCapPct: string;
  tier1UpToPct: string;
  tier1RatePct: string;
  tier2UpToPct: string;
  tier2RatePct: string;
  flatAmount: string;
}

const pctToFrac = (s: string): number | null => {
  const n = Number(s.replace(/[%\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
};
const moneyToNumber = (s: string): number | null => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function draftFromFormula(f: EmployerContributionFormula | null): Draft {
  const base: Draft = {
    kind: "none",
    matchRatePct: "",
    matchCapPct: "",
    tier1UpToPct: "",
    tier1RatePct: "",
    tier2UpToPct: "",
    tier2RatePct: "",
    flatAmount: "",
  };
  if (!f) return base;
  if (f.kind === "match")
    return { ...base, kind: "match", matchRatePct: String(f.matchRate * 100), matchCapPct: String(f.matchCapPct * 100) };
  if (f.kind === "flat") return { ...base, kind: "flat", flatAmount: String(f.annualAmount) };
  const [t1, t2] = f.tiers;
  return {
    ...base,
    kind: "tiered",
    tier1UpToPct: t1 ? String(t1.upToPct * 100) : "",
    tier1RatePct: t1 ? String(t1.rate * 100) : "",
    tier2UpToPct: t2 ? String(t2.upToPct * 100) : "",
    tier2RatePct: t2 ? String(t2.rate * 100) : "",
  };
}

function formulaFromDraft(d: Draft): EmployerContributionFormula | null | "invalid" {
  if (d.kind === "none") return null;
  if (d.kind === "flat") {
    const annualAmount = moneyToNumber(d.flatAmount);
    return annualAmount != null ? { kind: "flat", annualAmount } : "invalid";
  }
  if (d.kind === "match") {
    const matchRate = pctToFrac(d.matchRatePct);
    const matchCapPct = pctToFrac(d.matchCapPct);
    return matchRate != null && matchCapPct != null ? { kind: "match", matchRate, matchCapPct } : "invalid";
  }
  const t1u = pctToFrac(d.tier1UpToPct);
  const t1r = pctToFrac(d.tier1RatePct);
  if (t1u == null || t1r == null) return "invalid";
  const tiers = [{ upToPct: t1u, rate: t1r }];
  const t2u = pctToFrac(d.tier2UpToPct);
  const t2r = pctToFrac(d.tier2RatePct);
  if (t2u != null && t2r != null && t2u > t1u) tiers.push({ upToPct: t2u, rate: t2r });
  return { kind: "tiered", tiers };
}

/**
 * W-2 employer match / profit-sharing formulas. The retirement planner uses
 * the saved formula to estimate the employer contribution for the year and
 * counts that estimate toward the plan's used room. Metadata only — no income
 * or tax record changes.
 */
export function EmployerMatchSection() {
  const { companies, updateCompany, closedCompanyIds } = useCompanies();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const link = useRetirementSectionLink("employer-match");

  const employers = useMemo(
    () =>
      companies.filter((c) => {
        if (closedCompanyIds.has(c.id)) return false;
        const k = entityKindForCompanyType(c.companyType);
        return k === "w2" || k === "s_corp";
      }),
    [companies, closedCompanyIds],
  );

  const draftFor = (companyId: string): Draft =>
    drafts[companyId] ??
    draftFromFormula(
      readEmployerContributionFormula(companies.find((c) => c.id === companyId)?.advancedFieldVisibility),
    );

  const setDraft = (companyId: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [companyId]: { ...draftFor(companyId), ...patch } }));

  const save = (companyId: string) =>
    (async () => {
      const c = companies.find((x) => x.id === companyId);
      if (!c) return;
      const formula = formulaFromDraft(draftFor(companyId));
      if (formula === "invalid") {
        toast.error("Please fill in the formula fields with positive numbers.");
        return;
      }
      setBusy(true);
      try {
        await updateCompany(companyId, {
          advancedFieldVisibility: writeEmployerContributionFormula(c.advancedFieldVisibility, formula),
        });
        setDrafts((d) => {
          const next = { ...d };
          delete next[companyId];
          return next;
        });
        toast.success("Saved");
      } catch {
        toast.error("Couldn't save. Please try again.");
      } finally {
        setBusy(false);
      }
    })();

  return (
    <div id={link.anchorId}>
    <SectionCard
      open={link.open}
      onOpenChange={link.onOpenChange}
      title="Employer match formulas"
      icon={<HandCoins className="h-5 w-5" />}
      description="Record each W-2 employer's match or profit-sharing formula so the retirement planner can estimate employer contributions."
      hideActionBar
    >
      {employers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add a W-2 employer to record its match formula.</p>
      ) : (
        <div className="space-y-5" data-testid="employer-match-section">
          <p className="text-xs text-muted-foreground">
            The estimate counts toward the plan's used room, so your remaining employer contribution room reflects
            what the employer is expected to add. Find the formula in your plan documents or benefits portal.
          </p>

          {employers.map((c) => {
            const d = draftFor(c.id);
            const saved = readEmployerContributionFormula(c.advancedFieldVisibility);
            return (
              <div key={c.id} id={`${link.anchorId}-${c.id}`} className={cn("rounded-lg border border-border p-3 space-y-3", link.focusCompanyId === c.id && "border-primary")}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{c.nickname || c.name}</span>
                  <span className="text-xs text-muted-foreground">{saved ? "Formula saved" : "No formula"}</span>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Formula type</Label>
                  <Select value={d.kind} onValueChange={(v) => setDraft(c.id, { kind: v as FormulaKind })} disabled={busy}>
                    <SelectTrigger aria-label={`Formula type for ${c.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None / I don't know</SelectItem>
                      <SelectItem value="match">Match up to a percent of pay</SelectItem>
                      <SelectItem value="tiered">Tiered match (e.g. 100% of first 3%, then 50% of next 2%)</SelectItem>
                      <SelectItem value="flat">Flat dollar amount per year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {d.kind === "match" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor={`match-rate-${c.id}`}>Match rate (%)</Label>
                      <Input
                        id={`match-rate-${c.id}`}
                        inputMode="decimal"
                        placeholder="e.g. 50"
                        value={d.matchRatePct}
                        onChange={(e) => setDraft(c.id, { matchRatePct: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor={`match-cap-${c.id}`}>Up to (% of pay)</Label>
                      <Input
                        id={`match-cap-${c.id}`}
                        inputMode="decimal"
                        placeholder="e.g. 6"
                        value={d.matchCapPct}
                        onChange={(e) => setDraft(c.id, { matchCapPct: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {d.kind === "tiered" && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs" htmlFor={`t1u-${c.id}`}>First tier: up to (% of pay)</Label>
                        <Input
                          id={`t1u-${c.id}`}
                          inputMode="decimal"
                          placeholder="e.g. 3"
                          value={d.tier1UpToPct}
                          onChange={(e) => setDraft(c.id, { tier1UpToPct: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs" htmlFor={`t1r-${c.id}`}>matched at (%)</Label>
                        <Input
                          id={`t1r-${c.id}`}
                          inputMode="decimal"
                          placeholder="e.g. 100"
                          value={d.tier1RatePct}
                          onChange={(e) => setDraft(c.id, { tier1RatePct: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs" htmlFor={`t2u-${c.id}`}>Second tier: up to (% of pay, optional)</Label>
                        <Input
                          id={`t2u-${c.id}`}
                          inputMode="decimal"
                          placeholder="e.g. 5"
                          value={d.tier2UpToPct}
                          onChange={(e) => setDraft(c.id, { tier2UpToPct: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs" htmlFor={`t2r-${c.id}`}>matched at (%)</Label>
                        <Input
                          id={`t2r-${c.id}`}
                          inputMode="decimal"
                          placeholder="e.g. 50"
                          value={d.tier2RatePct}
                          onChange={(e) => setDraft(c.id, { tier2RatePct: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {d.kind === "flat" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs" htmlFor={`flat-${c.id}`}>Employer contribution per year ($)</Label>
                    <Input
                      id={`flat-${c.id}`}
                      inputMode="decimal"
                      placeholder="e.g. 2000"
                      value={d.flatAmount}
                      onChange={(e) => setDraft(c.id, { flatAmount: e.target.value })}
                    />
                  </div>
                )}

                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => save(c.id)} disabled={busy}>
                    Save formula
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
    </div>
  );
}
