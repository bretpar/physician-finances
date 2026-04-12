import { useState, useMemo } from "react";
import {
  Plus, Trash2, Pencil, ChevronDown, ChevronRight,
  DollarSign, TrendingUp, Calendar, PiggyBank, Shield,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCompanies } from "@/contexts/CompanyContext";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  useProjectedStreams, useProjectedBonuses,
  useAddStream, useUpdateStream, useDeleteStream,
  useAddBonus, useDeleteBonus,
  generateProjectedPaychecks, getProjectedTotals,
  isStreamExpired,
  type ProjectedIncomeStream, type ProjectedPaycheck,
} from "@/hooks/useProjectedIncome";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtFull = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PAY_FREQUENCIES = [
  { value: "single", label: "One-time" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

interface StreamForm {
  company: string;
  pay_frequency: string;
  custom_interval_days: string;
  start_date: string;
  end_date: string;
  paycheck_amount: string;
  taxes_withheld: string;
  retirement_401k: string;
  pre_tax_deductions: string;
  is_active: boolean;
  include_in_tax: boolean;
}

const emptyForm = (monthIdx?: number): StreamForm => {
  const now = new Date();
  const year = now.getFullYear();
  const month = monthIdx !== undefined ? monthIdx : now.getMonth();
  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-15`;
  return {
    company: "",
    pay_frequency: "biweekly",
    custom_interval_days: "14",
    start_date: dateStr,
    end_date: "",
    paycheck_amount: "",
    taxes_withheld: "",
    retirement_401k: "",
    pre_tax_deductions: "",
    is_active: true,
    include_in_tax: true,
  };
};

export default function ProjectedIncome() {
  const { companies } = useCompanies();
  const { data: streams, isLoading: streamsLoading } = useProjectedStreams();
  const { data: bonuses, isLoading: bonusesLoading } = useProjectedBonuses();
  const { data: incomeEntries } = useIncomeEntries();
  const { estimate } = useTaxEstimate();

  const addStream = useAddStream();
  const updateStream = useUpdateStream();
  const deleteStream = useDeleteStream();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StreamForm>(emptyForm());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(() => {
    const current = new Date().getMonth();
    return new Set([current]);
  });

  const num = (v: string) => parseFloat(v) || 0;
  const companyNames = useMemo(() => companies.map((c) => c.name).sort(), [companies]);

  const existingDates = useMemo(() => {
    if (!incomeEntries) return new Set<string>();
    return new Set(incomeEntries.map((e) => e.income_date));
  }, [incomeEntries]);

  const projectedPaychecks = useMemo(() => {
    if (!streams || !bonuses) return [];
    return generateProjectedPaychecks(streams, bonuses, existingDates);
  }, [streams, bonuses, existingDates]);

  const projectedTotals = useMemo(() => getProjectedTotals(projectedPaychecks), [projectedPaychecks]);

  const actualYTD = useMemo(() => {
    if (!incomeEntries) return { income: 0, withheld: 0, retirement: 0, deductions: 0 };
    const year = new Date().getFullYear();
    const ytd = incomeEntries.filter((e) => e.income_date.startsWith(String(year)));
    return {
      income: ytd.reduce((s, e) => s + Number(e.paycheck_amount), 0),
      withheld: ytd.reduce((s, e) => s + Number(e.taxes_withheld), 0),
      retirement: ytd.reduce((s, e) => s + Number(e.retirement_401k), 0),
      deductions: ytd.reduce((s, e) => s + Number(e.pre_tax_deductions), 0),
    };
  }, [incomeEntries]);

  const byMonth = useMemo(() => {
    const map = new Map<number, ProjectedPaycheck[]>();
    for (let i = 0; i < 12; i++) map.set(i, []);
    projectedPaychecks.forEach((p) => {
      const month = parseInt(p.date.split("-")[1], 10) - 1;
      map.get(month)?.push(p);
    });
    return map;
  }, [projectedPaychecks]);

  const expectedAnnual = actualYTD.income + projectedTotals.grossIncome;
  const projectedWithholding = actualYTD.withheld + projectedTotals.taxesWithheld;
  const projected401k = actualYTD.retirement + projectedTotals.retirement401k;

  const toggleMonth = (m: number) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const setField = (key: keyof StreamForm, value: string | boolean) =>
    setForm((p) => ({ ...p, [key]: value }));

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(false);
  };

  const openAddForMonth = (monthIdx: number) => {
    setForm(emptyForm(monthIdx));
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (s: ProjectedIncomeStream) => {
    setForm({
      company: s.company,
      pay_frequency: s.pay_frequency,
      custom_interval_days: String(s.custom_interval_days || 14),
      start_date: s.start_date,
      end_date: s.end_date || "",
      paycheck_amount: String(s.paycheck_amount),
      taxes_withheld: String(s.taxes_withheld),
      retirement_401k: String(s.retirement_401k),
      pre_tax_deductions: String(s.pre_tax_deductions),
      is_active: s.is_active,
      include_in_tax: s.include_in_tax,
    });
    setEditingId(s.id);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.company || num(form.paycheck_amount) <= 0) return;
    const company = companies.find((c) => c.name === form.company);
    const payload: Partial<ProjectedIncomeStream> = {
      company: form.company,
      company_type: company?.companyType || "W2",
      pay_frequency: form.pay_frequency,
      custom_interval_days: form.pay_frequency === "custom" ? num(form.custom_interval_days) : null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      paycheck_amount: num(form.paycheck_amount),
      taxes_withheld: num(form.taxes_withheld),
      retirement_401k: num(form.retirement_401k),
      pre_tax_deductions: num(form.pre_tax_deductions),
      is_active: form.is_active,
      include_in_tax: form.include_in_tax,
    };
    if (editingId) {
      updateStream.mutate({ id: editingId, ...payload }, { onSuccess: resetForm });
    } else {
      addStream.mutate(payload, { onSuccess: resetForm });
    }
  };

  const currentMonth = new Date().getMonth();

  if (streamsLoading || bonusesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Income Planner</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Plan your expected income for the year and see how it affects your tax estimate.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Expected Annual Income"
          value={fmt(expectedAnnual)}
          sublabel={`${fmt(actualYTD.income)} actual + ${fmt(projectedTotals.grossIncome)} projected`}
          highlight
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Projected Remaining"
          value={fmt(projectedTotals.grossIncome)}
          sublabel={`${projectedTotals.count} upcoming payments`}
        />
        <SummaryCard
          icon={<Shield className="h-4 w-4" />}
          label="Estimated Annual Tax"
          value={fmt(estimate?.totalTaxLiability || 0)}
          sublabel="Based on projected income"
        />
        <SummaryCard
          icon={<PiggyBank className="h-4 w-4" />}
          label="Projected Withholding"
          value={fmt(projectedWithholding)}
          sublabel={projected401k > 0 ? `+ ${fmt(projected401k)} in 401(k)` : undefined}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Monthly Plan</h2>
          <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Income Stream
          </Button>
        </div>

        <div className="space-y-1.5">
          {MONTHS.map((monthName, idx) => {
            const entries = byMonth.get(idx) || [];
            const monthTotal = entries.reduce((s, e) => s + e.grossAmount, 0);
            const monthWithheld = entries.reduce((s, e) => s + e.taxesWithheld, 0);
            const isExpanded = expandedMonths.has(idx);
            const isPast = idx < currentMonth;
            const isCurrent = idx === currentMonth;

            return (
              <Collapsible key={idx} open={isExpanded} onOpenChange={() => toggleMonth(idx)}>
                <CollapsibleTrigger asChild>
                  <button
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors text-left ${
                      isCurrent
                        ? "border-primary/30 bg-primary/5"
                        : isPast
                        ? "border-border/50 bg-muted/30 opacity-60"
                        : "border-border bg-card hover:bg-accent/5"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium text-foreground">{monthName}</span>
                      {entries.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {entries.length} {entries.length === 1 ? "entry" : "entries"}
                        </Badge>
                      )}
                      {isCurrent && (
                        <Badge variant="default" className="text-xs">Current</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      {monthTotal > 0 && (
                        <span className="font-semibold text-success">{fmt(monthTotal)}</span>
                      )}
                      {monthWithheld > 0 && (
                        <span className="text-muted-foreground">{fmt(monthWithheld)} tax</span>
                      )}
                    </div>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="ml-4 mr-1 mt-1 mb-2 space-y-2">
                    {entries.length > 0 && (
                      <div className="flex flex-wrap gap-4 px-3 py-2 rounded-md bg-muted/40 text-xs text-muted-foreground">
                        <span>Total: <strong className="text-foreground">{fmt(monthTotal)}</strong></span>
                        {monthWithheld > 0 && (
                          <span>Withholding: <strong className="text-foreground">{fmt(monthWithheld)}</strong></span>
                        )}
                        {entries.reduce((s, e) => s + e.retirement401k, 0) > 0 && (
                          <span>401(k): <strong className="text-foreground">
                            {fmt(entries.reduce((s, e) => s + e.retirement401k, 0))}
                          </strong></span>
                        )}
                      </div>
                    )}

                    {entries.map((entry, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-3 py-2.5 rounded-md border border-border/50 bg-card"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-12">{entry.date.slice(5)}</span>
                          <span className="text-sm font-medium text-foreground">{entry.label}</span>
                          {entry.type === "bonus" && (
                            <Badge variant="secondary" className="text-xs">Bonus</Badge>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-success">{fmtFull(entry.grossAmount)}</span>
                      </div>
                    ))}

                    {entries.length === 0 && (
                      <p className="text-xs text-muted-foreground px-3 py-2">
                        No projected income for this month.
                      </p>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => openAddForMonth(idx)}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add income for {monthName}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </div>

      {streams && streams.length > 0 && (() => {
        const activeStreams = streams.filter((s) => !isStreamExpired(s));
        const expiredStreams = streams.filter((s) => isStreamExpired(s));
        return (
          <>
            {activeStreams.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground">Income Streams</h2>
                <StreamTable
                  streams={activeStreams}
                  onEdit={startEdit}
                  onDelete={setDeleteConfirm}
                />
              </div>
            )}
            {expiredStreams.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground text-muted-foreground">
                  Archived Streams
                </h2>
                <p className="text-xs text-muted-foreground">
                  These streams have passed their end date and no longer contribute to projections.
                </p>
                <StreamTable
                  streams={expiredStreams}
                  onEdit={startEdit}
                  onDelete={setDeleteConfirm}
                  expired
                />
              </div>
            )}
          </>
        );
      })()}

      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Income Stream" : "Add Income Stream"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Company *</Label>
              <Select value={form.company} onValueChange={(v) => setField("company", v)}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companyNames.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Expected Income *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.paycheck_amount}
                  onChange={(e) => setField("paycheck_amount", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pay Frequency</Label>
                <Select value={form.pay_frequency} onValueChange={(v) => setField("pay_frequency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAY_FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.pay_frequency === "custom" && (
              <div className="space-y-1.5">
                <Label>Custom Interval (days)</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.custom_interval_days}
                  onChange={(e) => setField("custom_interval_days", e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setField("start_date", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setField("end_date", e.target.value)}
                />
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Optional Details</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tax Withholding</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={form.taxes_withheld}
                    onChange={(e) => setField("taxes_withheld", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">401(k)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={form.retirement_401k}
                    onChange={(e) => setField("retirement_401k", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Deductions</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={form.pre_tax_deductions}
                    onChange={(e) => setField("pre_tax_deductions", e.target.value)}
                  />
                </div>
              </div>
            </div>

            {num(form.paycheck_amount) > 0 && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Est. take-home: </span>
                <span className="font-semibold text-foreground">
                  {fmtFull(Math.max(0, num(form.paycheck_amount) - num(form.taxes_withheld) - num(form.retirement_401k) - num(form.pre_tax_deductions)))}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.company || num(form.paycheck_amount) <= 0}
            >
              {editingId ? "Save Changes" : "Add Stream"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Income Stream</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove the income stream and all projected paychecks. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirm) deleteStream.mutate(deleteConfirm);
                setDeleteConfirm(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sublabel,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/20 bg-primary/5" : ""}>
      <CardContent className="pt-4 pb-4 space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        <p className={`text-2xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>
          {value}
        </p>
        {sublabel && (
          <p className="text-xs text-muted-foreground">{sublabel}</p>
        )}
      </CardContent>
    </Card>
  );
}
