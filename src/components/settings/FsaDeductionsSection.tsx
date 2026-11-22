import { useMemo, useState } from "react";
import { HeartPulse } from "lucide-react";
import { SectionCard } from "@/components/settings/SectionCard";
import { useCompanies } from "@/contexts/CompanyContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InfoTooltip } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { entityKindForCompanyType } from "@/lib/retirementCanonicalInput";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import {
  FSA_KINDS, FSA_LABELS, getFsaLimits, readFsaConfigs, summarizeFsa, writeFsaConfigs,
  type FsaConfigs, type FsaDeductionConfig, type FsaKind,
} from "@/lib/fsaDeductions";

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const TIPS: Record<FsaKind, string> = {
  health: "Pre-tax money for medical, dental and vision costs. Lowers federal, Social Security and Medicare wages. One employer's plan has one annual health FSA limit. Usually blocks HSA contributions.",
  dependent_care: "Pre-tax money for care of a child under 13 or a dependent who can't care for themselves, so you (and a spouse) can work. The limit is per household, including a spouse's benefits; married filing separately gets half.",
  limited_purpose: "Dental and vision only, so it can be used alongside an HSA. Shares the same health FSA limit as a Healthcare FSA at that employer — not an extra allowance.",
};

type Draft = Record<FsaKind, { enabled: boolean; perPaycheck: string; startDate: string; endDate: string; annualElection: string }>;
const toDraft = (c: FsaConfigs): Draft => Object.fromEntries(FSA_KINDS.map((k) => {
  const v = c[k];
  return [k, { enabled: !!v?.enabled, perPaycheck: v?.perPaycheck ? String(v.perPaycheck) : "", startDate: v?.startDate ?? "", endDate: v?.endDate ?? "", annualElection: v?.annualElection ? String(v.annualElection) : "" }];
})) as Draft;
const fromDraft = (d: Draft): FsaConfigs => Object.fromEntries(FSA_KINDS.map((k) => {
  const v = d[k];
  const n = (s: string) => { const x = Number(s.replace(/[$,\s]/g, "")); return Number.isFinite(x) && x > 0 ? x : null; };
  const cfg: FsaDeductionConfig = { enabled: v.enabled, perPaycheck: n(v.perPaycheck) ?? 0, startDate: v.startDate || null, endDate: v.endDate || null, annualElection: n(v.annualElection) };
  return [k, cfg];
})) as FsaConfigs;

/** Per-W-2-employer FSA payroll deductions plus a compact yearly summary. Metadata only. */
export function FsaDeductionsSection() {
  const { companies, updateCompany, closedCompanyIds } = useCompanies();
  const { data: entries } = usePersonalIncomeEntries();
  const { data: tax } = useTaxSettings();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const year = new Date().getFullYear();
  const employers = useMemo(() => companies.filter((c) => !closedCompanyIds.has(c.id) && ["w2", "s_corp"].includes(entityKindForCompanyType(c.companyType) as string)), [companies, closedCompanyIds]);
  const summary = useMemo(() => summarizeFsa({
    year,
    rows: (entries ?? []) as never,
    configsByCompany: Object.fromEntries(companies.map((c) => [c.id, readFsaConfigs(c.advancedFieldVisibility)])),
    filingStatus: (tax as { filingStatus?: string } | undefined)?.filingStatus,
    hsaEnabled: (tax as { hsaEnabled?: boolean } | undefined)?.hsaEnabled,
  }), [entries, companies, tax, year]);
  const limits = getFsaLimits(year);

  const draftFor = (id: string) => drafts[id] ?? toDraft(readFsaConfigs(companies.find((c) => c.id === id)?.advancedFieldVisibility));
  const setKind = (id: string, k: FsaKind, patch: Partial<Draft[FsaKind]>) => setDrafts((d) => { const cur = draftFor(id); return { ...d, [id]: { ...cur, [k]: { ...cur[k], ...patch } } }; });
  const save = async (id: string) => {
    const c = companies.find((x) => x.id === id);
    if (!c) return;
    setBusy(true);
    try {
      await updateCompany(id, { advancedFieldVisibility: writeFsaConfigs(c.advancedFieldVisibility, fromDraft(draftFor(id))) });
      setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
      toast.success("Saved. New paychecks will use these amounts; saved paychecks are unchanged.");
    } catch {
      toast.error("Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="FSA payroll deductions" icon={<HeartPulse className="h-5 w-5" />} description="Healthcare, Dependent Care and Limited Purpose FSA amounts taken from each W-2 paycheck." hideActionBar>
      {employers.length === 0 ? <p className="text-sm text-muted-foreground">Add a W-2 employer to set up FSA deductions.</p> : (
        <div className="space-y-4" data-testid="fsa-deductions-section">
          <div className="space-y-1 rounded-lg border border-border p-3 text-xs" data-testid="fsa-summary">
            <p className="font-semibold">{year} contributed</p>
            {summary.kinds.map((k) => (
              <div key={k.kind} className="flex flex-wrap justify-between gap-x-3">
                <span className="text-muted-foreground">{FSA_LABELS[k.kind]}</span>
                <span className="tabular-nums">{fmt(k.contributed)} of {fmt(k.election != null ? Math.min(k.election, k.limit) : k.limit)}{k.election != null ? " election" : " limit"} · {fmt(k.remaining)} left</span>
              </div>
            ))}
            <p className="text-muted-foreground">Healthcare and Limited Purpose share the remaining health FSA capacity at each employer.</p>
            {summary.limitsInferred && <p className="text-muted-foreground">IRS limits for {year} aren't published in the app yet; showing the latest known year.</p>}
            {summary.warnings.map((w) => <p key={w} className="text-warning">{w}</p>)}
          </div>
          {employers.map((c) => {
            const d = draftFor(c.id);
            return (
              <div key={c.id} className="space-y-3 rounded-lg border border-border p-3">
                <span className="text-sm font-semibold">{c.nickname || c.name}</span>
                {FSA_KINDS.map((k) => (
                  <div key={k} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex items-center gap-1 text-xs">{FSA_LABELS[k]}
                        <InfoTooltip label={`About ${FSA_LABELS[k]}`}>{TIPS[k]} {year} limit: {fmt(k === "dependent_care" ? limits.dependentCare : limits.health)}{k === "dependent_care" ? ` (${fmt(limits.dependentCareMfs)} married filing separately)` : ""}.</InfoTooltip>
                      </Label>
                      <Switch checked={d[k].enabled} onCheckedChange={(v) => setKind(c.id, k, { enabled: v })} disabled={busy} aria-label={`${FSA_LABELS[k]} for ${c.name}`} />
                    </div>
                    {d[k].enabled && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Per paycheck ($)</Label><Input inputMode="decimal" value={d[k].perPaycheck} onChange={(e) => setKind(c.id, k, { perPaycheck: e.target.value })} /></div>
                        <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Annual election ($, optional)</Label><Input inputMode="decimal" value={d[k].annualElection} onChange={(e) => setKind(c.id, k, { annualElection: e.target.value })} /></div>
                        <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Starts</Label><Input type="date" value={d[k].startDate} onChange={(e) => setKind(c.id, k, { startDate: e.target.value })} /></div>
                        <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Ends (optional)</Label><Input type="date" value={d[k].endDate} onChange={(e) => setKind(c.id, k, { endDate: e.target.value })} /></div>
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => save(c.id)} disabled={busy}>Save FSA settings</Button></div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
