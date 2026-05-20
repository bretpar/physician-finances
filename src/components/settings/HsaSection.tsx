import { useMemo, useState } from "react";
import { HeartPulse, Plus, Trash2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/DateField";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SectionCard } from "@/components/settings/SectionCard";
import { useSectionDraft } from "@/hooks/useSectionDraft";
import { useCompanies, type Company } from "@/contexts/CompanyContext";
import { useTaxSettings, useUpdateTaxSettings } from "@/hooks/useTaxSettings";
import {
  useHsaContributions,
  useAddManualHsaContribution,
  useDeleteHsaContribution,
  type HsaContribution,
} from "@/hooks/useHsaContributions";
import { normalizeFilingType } from "@/lib/filingTypes";
import { cn } from "@/lib/utils";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface HsaDraft {
  hsaEnabled: boolean;
  hsaSourceCompanyId: string | null;
}

/** Companies eligible to host payroll-level HSA inputs. */
function isPayrollEligibleCompany(c: Company): boolean {
  const ft = normalizeFilingType(c.companyType);
  return ft === "w2" || ft === "scorp_w2" || ft === "k1_partnership";
}

export function HsaSettingsSection({ bare = false }: { bare?: boolean } = {}) {
  const { data } = useTaxSettings();
  const updateMutation = useUpdateTaxSettings();
  const { companies } = useCompanies();
  const [savedTick, setSavedTick] = useState(false);

  const source: HsaDraft = useMemo(
    () => ({
      hsaEnabled: !!data?.hsaEnabled,
      hsaSourceCompanyId: data?.hsaSourceCompanyId ?? null,
    }),
    [data],
  );

  const draft = useSectionDraft<HsaDraft>({
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

  const eligible = useMemo(() => companies.filter(isPayrollEligibleCompany), [companies]);
  const selectedCompany = companies.find((c) => c.id === d.hsaSourceCompanyId) || null;
  const selectedCompanyType = selectedCompany ? normalizeFilingType(selectedCompany.companyType) : null;

  return (
    <SectionCard
      bare={bare}
      title="HSA Tracking"
      icon={<HeartPulse className="h-5 w-5" />}
      description="Track Health Savings Account contributions across paychecks and individual deposits."
      isDirty={draft.isDirty}
      isSaving={draft.isSaving}
      justSaved={savedTick}
      onSave={draft.save}
      onCancel={draft.cancel}
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Enable HSA tracking</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Show HSA inputs on income forms and the HSA contributions ledger below.
            Existing HSA history is preserved when this is off.
          </p>
        </div>
        <Switch
          checked={d.hsaEnabled}
          onCheckedChange={(v) => set({ hsaEnabled: v })}
        />
      </div>

      {d.hsaEnabled && (
        <>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Insurance source company
            </Label>
            <Select
              value={d.hsaSourceCompanyId ?? ""}
              onValueChange={(v) => set({ hsaSourceCompanyId: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a company / employer…" />
              </SelectTrigger>
              <SelectContent>
                {companies.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No companies yet. Add one in the Companies section above.
                  </div>
                )}
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || c.nickname || "Untitled"}
                    <span className="text-muted-foreground ml-1.5">
                      · {normalizeFilingType(c.companyType).replace(/_/g, " ")}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Which company / employer provides the insurance tied to this HSA?
            </p>
          </div>

          <div className="rounded-md bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed">
            W-2 and payroll-style K-1 HSA contributions are entered on paycheck entries.
            1099 HSA contributions are usually entered as <strong>individual contributions</strong>
            in the ledger below.
            {selectedCompany && selectedCompanyType === "1099_schedule_c" && (
              <span className="block mt-1.5 text-warning">
                Heads up: <strong>{selectedCompany.name}</strong> is a 1099 company. Add HSA via
                Individual Contribution rather than on the paycheck.
              </span>
            )}
            {selectedCompany && !eligible.find((e) => e.id === selectedCompany.id) && selectedCompanyType !== "1099_schedule_c" && (
              <span className="block mt-1.5 text-warning">
                <strong>{selectedCompany.name}</strong> isn&apos;t a payroll-style company. The paycheck
                HSA field will not show; use Individual Contribution instead.
              </span>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  HSA Contributions Ledger Section                         */
/* ─────────────────────────────────────────────────────────── */

function SourceChip({ source_type, company_id, companyName }: { source_type: string; company_id: string | null; companyName: (id: string | null) => string }) {
  if (source_type === "payroll") {
    const name = companyName(company_id);
    const unassigned = !company_id || name === "—";
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        <Link2 className="h-3 w-3" />
        {unassigned ? "Payroll source not assigned" : name}
      </span>
    );
  }
  const name = companyName(company_id);
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      {name === "—" || !company_id ? "Individual" : name}
    </span>
  );
}

function LinkedChip() {
  return (
    <span className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
      Linked
    </span>
  );
}

export function HsaLedgerSection() {
  const { data: settings } = useTaxSettings();
  const { companies } = useCompanies();
  const currentYear = new Date().getFullYear();
  const { data: rows = [], isLoading } = useHsaContributions(currentYear);
  const addManual = useAddManualHsaContribution();
  const del = useDeleteHsaContribution();
  const hsaEnabled = !!settings?.hsaEnabled;

  const [addOpen, setAddOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    contribution_date: new Date().toISOString().split("T")[0],
    amount: "",
    company_id: "" as string,
    notes: "",
  });

  const totals = useMemo(() => {
    const payroll = rows.filter((r) => r.source_type === "payroll").reduce((s, r) => s + Number(r.amount), 0);
    const individual = rows.filter((r) => r.source_type === "individual").reduce((s, r) => s + Number(r.amount), 0);
    return { payroll, individual, total: payroll + individual };
  }, [rows]);

  const companyName = (id: string | null) => {
    if (!id) return "—";
    const c = companies.find((c) => c.id === id);
    return c?.name || c?.nickname || "—";
  };

  const onSubmit = async () => {
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    await addManual.mutateAsync({
      contribution_date: form.contribution_date,
      amount: amt,
      company_id: form.company_id || null,
      notes: form.notes,
    });
    setAddOpen(false);
    setForm({
      contribution_date: new Date().toISOString().split("T")[0],
      amount: "",
      company_id: "",
      notes: "",
    });
  };

  return (
    <>
      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">HSA Contributions</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{currentYear} contribution year</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  Payroll <span className="font-medium text-foreground">{fmt(totals.payroll)}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  Individual <span className="font-medium text-foreground">{fmt(totals.individual)}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground font-medium">
                  Total <span>{fmt(totals.total)}</span>
                </span>
              </div>
            </div>
            {hsaEnabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddOpen(true)}
                className="shrink-0 hidden sm:inline-flex"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Individual
              </Button>
            )}
          </div>
          {hsaEnabled && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(true)}
              className="sm:hidden mt-2 w-full"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {!hsaEnabled && rows.length === 0 && (
            <p className="text-xs text-muted-foreground py-4">
              HSA tracking is off. Turn it on in Settings to start adding contributions.
            </p>
          )}

          {!hsaEnabled && rows.length > 0 && (
            <p className="text-xs text-warning py-3">
              HSA tracking is currently off. Historical contributions are shown for reference.
            </p>
          )}

          {isLoading && <p className="text-xs text-muted-foreground py-4">Loading…</p>}

          {/* Desktop table */}
          {!isLoading && rows.length > 0 && (
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1.5 px-2 font-medium">Date</th>
                    <th className="py-1.5 px-2 font-medium">Type</th>
                    <th className="py-1.5 px-2 font-medium">Source</th>
                    <th className="py-1.5 px-2 font-medium text-right">Amount</th>
                    <th className="py-1.5 px-2 font-medium w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: HsaContribution) => (
                    <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="py-1.5 px-2 tabular-nums whitespace-nowrap text-muted-foreground">{r.contribution_date}</td>
                      <td className="py-1.5 px-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          r.source_type === "payroll" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
                        )}>
                          {r.source_type === "payroll" ? (
                            <><Link2 className="h-2.5 w-2.5" /> Payroll</>
                          ) : (
                            "Individual"
                          )}
                        </span>
                      </td>
                      <td className="py-1.5 px-2">
                        <SourceChip source_type={r.source_type} company_id={r.company_id} companyName={companyName} />
                      </td>
                      <td className="py-1.5 px-2 tabular-nums text-right">
                        <span className="text-sm font-semibold text-foreground">{fmt(Number(r.amount))}</span>
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {r.source_type === "individual" ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(r.id)}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Delete contribution"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <LinkedChip />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mobile cards */}
          {!isLoading && rows.length > 0 && (
            <div className="md:hidden space-y-2 mt-2">
              {rows.map((r: HsaContribution) => (
                <div key={r.id} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{fmt(Number(r.amount))}</span>
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          r.source_type === "payroll" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
                        )}>
                          {r.source_type === "payroll" ? (
                            <><Link2 className="h-2.5 w-2.5" /> Payroll</>
                          ) : (
                            "Individual"
                          )}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">{r.contribution_date}</span>
                        <SourceChip source_type={r.source_type} company_id={r.company_id} companyName={companyName} />
                      </div>
                      {r.notes && (
                        <p className="text-[11px] text-muted-foreground mt-1.5">{r.notes}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {r.source_type === "individual" ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(r.id)}
                          className="text-muted-foreground hover:text-destructive p-1"
                          aria-label="Delete contribution"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <LinkedChip />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && rows.length === 0 && hsaEnabled && (
            <p className="text-xs text-muted-foreground py-4">
              No contributions yet for {currentYear}.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Individual HSA Contribution</DialogTitle>
            <DialogDescription>
              For deposits made directly to your HSA outside of payroll.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
              <DateField
                value={form.contribution_date}
                onChange={(v) => setForm((f) => ({ ...f, contribution_date: v }))}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Amount</Label>
              <Input
                type="number" min="0" step="0.01" placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company / Source (optional)</Label>
              <Select
                value={form.company_id}
                onValueChange={(v) => setForm((f) => ({ ...f, company_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No specific company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.nickname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={onSubmit} disabled={addManual.isPending || !(Number(form.amount) > 0)}>
              Add contribution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this HSA contribution?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes one individual HSA contribution from your ledger. It does not affect any
              linked paycheck entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmDeleteId) await del.mutateAsync(confirmDeleteId);
                setConfirmDeleteId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}