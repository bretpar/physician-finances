import { useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { SectionCard } from "@/components/settings/SectionCard";
import { useCompanies } from "@/contexts/CompanyContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { entityKindForCompanyType } from "@/lib/retirementCanonicalInput";
import { readPartnershipPlanTerms, writePartnershipPlanTerms, type PartnershipPlanTerms } from "@/lib/partnershipPlanTerms";
import { useRetirementSectionLink } from "@/hooks/useRetirementSectionLink";
import { cn } from "@/lib/utils";

const EMPTY: PartnershipPlanTerms = { sponsorship: "not_sure", additionalEmployeeDeferrals: "not_sure", additionalEmployerContributions: "not_sure", planCeiling: null };

/** Per-partnership retirement plan details. Metadata only. */
export function PartnershipPlanSection() {
  const { companies, updateCompany, closedCompanyIds } = useCompanies();
  const link = useRetirementSectionLink("partnership-plan");
  const [drafts, setDrafts] = useState<Record<string, PartnershipPlanTerms & { ceilingText?: string }>>({});
  const [busy, setBusy] = useState(false);
  const partnerships = useMemo(() => companies.filter((c) => !closedCompanyIds.has(c.id) && entityKindForCompanyType(c.companyType) === "partnership_k1"), [companies, closedCompanyIds]);
  if (partnerships.length === 0) return null;

  const draftFor = (id: string) => {
    if (drafts[id]) return drafts[id];
    const saved = readPartnershipPlanTerms(companies.find((c) => c.id === id)?.advancedFieldVisibility) ?? EMPTY;
    return { ...saved, ceilingText: saved.planCeiling ? String(saved.planCeiling) : "" };
  };
  const setDraft = (id: string, patch: Partial<PartnershipPlanTerms & { ceilingText: string }>) => setDrafts((d) => ({ ...d, [id]: { ...draftFor(id), ...patch } }));

  const save = async (id: string) => {
    const c = companies.find((x) => x.id === id);
    if (!c) return;
    const d = draftFor(id);
    const n = Number((d.ceilingText ?? "").replace(/[$,\s]/g, ""));
    const terms: PartnershipPlanTerms = { sponsorship: d.sponsorship, additionalEmployeeDeferrals: d.additionalEmployeeDeferrals, additionalEmployerContributions: d.additionalEmployerContributions, planCeiling: Number.isFinite(n) && n > 0 ? n : null };
    setBusy(true);
    try {
      await updateCompany(id, { advancedFieldVisibility: writePartnershipPlanTerms(c.advancedFieldVisibility, terms) });
      setDrafts((x) => { const next = { ...x }; delete next[id]; return next; });
      toast.success("Saved");
    } catch {
      toast.error("Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id={link.anchorId}>
      <SectionCard title="Partnership retirement plans" icon={<Landmark className="h-5 w-5" />} description="Record what your partnership's retirement plan allows so the planner knows which estimates apply." hideActionBar open={link.open} onOpenChange={link.onOpenChange}>
        <div className="space-y-4" data-testid="partnership-plan-section">
          {partnerships.map((c) => {
            const d = draftFor(c.id);
            const field = (label: string, value: string, onChange: (v: string) => void, options: [string, string][]) => (
              <div className="space-y-1.5">
                <Label className="text-xs">{label}</Label>
                <Select value={value} onValueChange={onChange} disabled={busy}>
                  <SelectTrigger aria-label={`${label} for ${c.name}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            );
            return (
              <div key={c.id} id={`${link.anchorId}-${c.id}`} className={cn("space-y-3 rounded-lg border border-border p-3", link.focusCompanyId === c.id && "border-primary")}>
                <span className="text-sm font-semibold">{c.nickname || c.name}</span>
                {field("Plan sponsorship", d.sponsorship, (v) => setDraft(c.id, { sponsorship: v as PartnershipPlanTerms["sponsorship"] }), [["partnership", "Partnership-sponsored plan"], ["independent", "Independently maintained eligible plan"], ["not_sure", "Not sure"]])}
                {field("Additional employee deferrals", d.additionalEmployeeDeferrals, (v) => setDraft(c.id, { additionalEmployeeDeferrals: v as PartnershipPlanTerms["additionalEmployeeDeferrals"] }), [["permitted", "Permitted"], ["not_permitted", "Not permitted"], ["not_sure", "Not sure"]])}
                {field("Additional employer/discretionary contributions", d.additionalEmployerContributions, (v) => setDraft(c.id, { additionalEmployerContributions: v as PartnershipPlanTerms["additionalEmployerContributions"] }), [["permitted", "Permitted under the plan"], ["partnership_determined", "Determined by partnership"], ["not_permitted", "Not permitted"], ["not_sure", "Not sure"]])}
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor={`pp-ceiling-${c.id}`}>Plan contribution ceiling from plan documents ($/yr, optional)</Label>
                  <Input id={`pp-ceiling-${c.id}`} inputMode="decimal" placeholder="e.g. 30000" value={d.ceilingText ?? ""} onChange={(e) => setDraft(c.id, { ceilingText: e.target.value })} />
                </div>
                <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => save(c.id)} disabled={busy}>Save plan details</Button></div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
