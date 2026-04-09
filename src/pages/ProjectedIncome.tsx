import { useState, useMemo } from "react";
import {
  Plus, Trash2, Pencil, CalendarDays, DollarSign, TrendingUp,
  Pause, Play, Gift, ChevronDown, ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCompanies } from "@/contexts/CompanyContext";
import { useIncomeEntries } from "@/hooks/useIncome";
import {
  useProjectedStreams, useProjectedBonuses,
  useAddStream, useUpdateStream, useDeleteStream,
  useAddBonus, useDeleteBonus,
  generateProjectedPaychecks, getProjectedTotals,
  type ProjectedIncomeStream,
} from "@/hooks/useProjectedIncome";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const PAY_FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom Interval" },
];

const BONUS_FREQUENCIES = [
  { value: "one-time", label: "One-time" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
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

const emptyStreamForm: StreamForm = {
  company: "",
  pay_frequency: "biweekly",
  custom_interval_days: "14",
  start_date: new Date().toISOString().split("T")[0],
  end_date: "",
  paycheck_amount: "",
  taxes_withheld: "",
  retirement_401k: "",
  pre_tax_deductions: "",
  is_active: true,
  include_in_tax: true,
};

interface BonusForm {
  name: string;
  amount: string;
  taxes_withheld: string;
  frequency: string;
  scheduled_date: string;
}

const emptyBonusForm: BonusForm = {
  name: "",
  amount: "",
  taxes_withheld: "",
  frequency: "one-time",
  scheduled_date: new Date().toISOString().split("T")[0],
};

export default function ProjectedIncome() {
  const { companies } = useCompanies();
  const { data: streams, isLoading: streamsLoading } = useProjectedStreams();
  const { data: bonuses, isLoading: bonusesLoading } = useProjectedBonuses();
  const { data: incomeEntries } = useIncomeEntries();

  const addStream = useAddStream();
  const updateStream = useUpdateStream();
  const deleteStream = useDeleteStream();
  const addBonus = useAddBonus();
  const deleteBonus = useDeleteBonus();

  const [showStreamForm, setShowStreamForm] = useState(false);
  const [editingStreamId, setEditingStreamId] = useState<string | null>(null);
  const [streamForm, setStreamForm] = useState<StreamForm>(emptyStreamForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedStream, setExpandedStream] = useState<string | null>(null);
  const [showBonusForm, setShowBonusForm] = useState<string | null>(null);
  const [bonusForm, setBonusForm] = useState<BonusForm>(emptyBonusForm);

  const num = (v: string) => parseFloat(v) || 0;

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
    if (!incomeEntries) return { income: 0, withheld: 0 };
    const year = new Date().getFullYear();
    const ytd = incomeEntries.filter((e) => e.income_date.startsWith(String(year)));
    return {
      income: ytd.reduce((s, e) => s + Number(e.paycheck_amount), 0),
      withheld: ytd.reduce((s, e) => s + Number(e.taxes_withheld), 0),
    };
  }, [incomeEntries]);

  const companyNames = useMemo(() => companies.map((c) => c.name).sort(), [companies]);

  const deposited = num(streamForm.paycheck_amount) - num(streamForm.taxes_withheld) - num(streamForm.retirement_401k) - num(streamForm.pre_tax_deductions);

  const setStreamField = (key: keyof StreamForm, value: string | boolean) =>
    setStreamForm((p) => ({ ...p, [key]: value }));

  const resetStreamForm = () => {
    setStreamForm(emptyStreamForm);
    setEditingStreamId(null);
    setShowStreamForm(false);
  };

  const handleStreamSubmit = () => {
    if (!streamForm.company) return;
    if (num(streamForm.paycheck_amount) <= 0) return;

    const company = companies.find((c) => c.name === streamForm.company);
    const payload: Partial<ProjectedIncomeStream> = {
      company: streamForm.company,
      company_type: company?.companyType || "W2",
      pay_frequency: streamForm.pay_frequency,
      custom_interval_days: streamForm.pay_frequency === "custom" ? num(streamForm.custom_interval_days) : null,
      start_date: streamForm.start_date,
      end_date: streamForm.end_date || null,
      paycheck_amount: num(streamForm.paycheck_amount),
      taxes_withheld: num(streamForm.taxes_withheld),
      retirement_401k: num(streamForm.retirement_401k),
      pre_tax_deductions: num(streamForm.pre_tax_deductions),
      is_active: streamForm.is_active,
      include_in_tax: streamForm.include_in_tax,
    };

    if (editingStreamId) {
      updateStream.mutate({ id: editingStreamId, ...payload }, { onSuccess: resetStreamForm });
    } else {
      addStream.mutate(payload, { onSuccess: resetStreamForm });
    }
  };

  const startEditStream = (s: ProjectedIncomeStream) => {
    setStreamForm({
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
    setEditingStreamId(s.id);
    setShowStreamForm(true);
  };

  const handleBonusSubmit = (streamId: string) => {
    if (!bonusForm.name || num(bonusForm.amount) <= 0) return;
    addBonus.mutate({
      stream_id: streamId,
      name: bonusForm.name,
      amount: num(bonusForm.amount),
      taxes_withheld: num(bonusForm.taxes_withheld),
      frequency: bonusForm.frequency,
      scheduled_date: bonusForm.scheduled_date,
    }, {
      onSuccess: () => {
        setBonusForm(emptyBonusForm);
        setShowBonusForm(null);
      },
    });
  };

  const isLoading = streamsLoading || bonusesLoading;

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading…</p></div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Actual Income YTD</p>
            <p className="text-2xl font-bold text-foreground">{fmt(actualYTD.income)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Projected Remaining</p>
            <p className="text-2xl font-bold text-foreground">{fmt(projectedTotals.grossIncome)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Total Expected Annual</p>
            <p className="text-2xl font-bold text-primary">{fmt(actualYTD.income + projectedTotals.grossIncome)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Projected Paychecks</p>
            <p className="text-2xl font-bold text-foreground">{projectedTotals.count}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Income Streams</h3>
        <Button onClick={() => { resetStreamForm(); setShowStreamForm(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Income Stream
        </Button>
      </div>

      {showStreamForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editingStreamId ? "Edit Income Stream" : "New Projected Income Stream"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Company *</Label>
                <Select value={streamForm.company} onValueChange={(v) => setStreamField("company", v)}>
                  <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companyNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Pay Frequency *</Label>
                <Select value={streamForm.pay_frequency} onValueChange={(v) => setStreamField("pay_frequency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAY_FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {streamForm.pay_frequency === "custom" && (
                <div className="space-y-1.5">
                  <Label>Interval (days)</Label>
                  <Input type="number" min="1" value={streamForm.custom_interval_days} onChange={(e) => setStreamField("custom_interval_days", e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Start Date *</Label>
                <Input type="date" value={streamForm.start_date} onChange={(e) => setStreamField("start_date", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date (blank = ongoing)</Label>
                <Input type="date" value={streamForm.end_date} onChange={(e) => setStreamField("end_date", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Total Paycheck (Gross) *</Label>
                <Input type="number" min="0" step="0.01" value={streamForm.paycheck_amount} onChange={(e) => setStreamField("paycheck_amount", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Taxes Withheld</Label>
                <Input type="number" min="0" step="0.01" value={streamForm.taxes_withheld} onChange={(e) => setStreamField("taxes_withheld", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>401k Contribution</Label>
                <Input type="number" min="0" step="0.01" value={streamForm.retirement_401k} onChange={(e) => setStreamField("retirement_401k", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Pre-Tax Deductions</Label>
                <Input type="number" min="0" step="0.01" value={streamForm.pre_tax_deductions} onChange={(e) => setStreamField("pre_tax_deductions", e.target.value)} />
              </div>
            </div>

            <div className="mt-3 p-3 rounded-md bg-muted/50 text-sm">
              <span className="text-muted-foreground">Estimated Deposited Amount: </span>
              <span className="font-semibold text-foreground">{fmt(Math.max(0, deposited))}</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={streamForm.is_active} onCheckedChange={(v) => setStreamField("is_active", v)} />
                <Label>Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={streamForm.include_in_tax} onCheckedChange={(v) => setStreamField("include_in_tax", v)} />
                <Label>Include in Tax Projections</Label>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button onClick={handleStreamSubmit} disabled={!streamForm.company || num(streamForm.paycheck_amount) <= 0}>
                {editingStreamId ? "Save Changes" : "Create Stream"}
              </Button>
              <Button variant="outline" onClick={resetStreamForm}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(!streams || streams.length === 0) && !showStreamForm && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No projected income streams yet. Click "Add Income Stream" to get started.
          </CardContent>
        </Card>
      )}

      {streams?.map((stream) => {
        const streamBonuses = (bonuses || []).filter((b) => b.stream_id === stream.id);
        const isExpanded = expandedStream === stream.id;
        const streamPaychecks = projectedPaychecks.filter((p) => p.streamId === stream.id);

        return (
          <Card key={stream.id} className={!stream.is_active ? "opacity-60" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">{stream.company}</CardTitle>
                  <Badge variant="outline">{stream.company_type}</Badge>
                  <Badge variant={stream.is_active ? "default" : "secondary"}>
                    {stream.is_active ? "Active" : "Paused"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => updateStream.mutate({ id: stream.id, is_active: !stream.is_active })}>
                    {stream.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => startEditStream(stream)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteConfirm(stream.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setExpandedStream(isExpanded ? null : stream.id)}>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-1">
                <span>{PAY_FREQUENCIES.find((f) => f.value === stream.pay_frequency)?.label || stream.pay_frequency}</span>
                <span>{fmt(stream.paycheck_amount)} gross</span>
                <span>{fmt(stream.taxes_withheld)} withheld</span>
                <span>{streamPaychecks.length} upcoming</span>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-foreground">Bonus / Extra Pay Events</h4>
                  <Button size="sm" variant="outline" onClick={() => { setBonusForm(emptyBonusForm); setShowBonusForm(stream.id); }}>
                    <Gift className="h-3 w-3 mr-1" /> Add Bonus
                  </Button>
                </div>

                {showBonusForm === stream.id && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-md border border-border bg-muted/30">
                    <div className="space-y-1">
                      <Label className="text-xs">Bonus Name *</Label>
                      <Input placeholder="e.g. Quarterly Bonus" value={bonusForm.name} onChange={(e) => setBonusForm((p) => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Amount *</Label>
                      <Input type="number" min="0" step="0.01" value={bonusForm.amount} onChange={(e) => setBonusForm((p) => ({ ...p, amount: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Taxes Withheld</Label>
                      <Input type="number" min="0" step="0.01" value={bonusForm.taxes_withheld} onChange={(e) => setBonusForm((p) => ({ ...p, taxes_withheld: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Frequency</Label>
                      <Select value={bonusForm.frequency} onValueChange={(v) => setBonusForm((p) => ({ ...p, frequency: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {BONUS_FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" value={bonusForm.scheduled_date} onChange={(e) => setBonusForm((p) => ({ ...p, scheduled_date: e.target.value }))} />
                    </div>
                    <div className="flex items-end gap-2">
                      <Button size="sm" onClick={() => handleBonusSubmit(stream.id)}>Add</Button>
                      <Button size="sm" variant="outline" onClick={() => setShowBonusForm(null)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {streamBonuses.length > 0 && (
                  <div className="space-y-1">
                    {streamBonuses.map((b) => (
                      <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 text-sm">
                        <span>{b.name} — {fmt(b.amount)} ({b.frequency})</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteBonus.mutate(b.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium text-foreground mb-2">Upcoming Projected Paychecks</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Withheld</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {streamPaychecks.slice(0, 12).map((p, i) => (
                          <TableRow key={i}>
                            <TableCell className="whitespace-nowrap">{p.date}</TableCell>
                            <TableCell>
                              <Badge variant={p.type === "bonus" ? "secondary" : "outline"}>
                                {p.type === "bonus" ? "Bonus" : "Projected"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">{fmt(p.grossAmount)}</TableCell>
                            <TableCell className="text-right">{fmt(p.taxesWithheld)}</TableCell>
                            <TableCell className="text-right">{fmt(p.netAmount)}</TableCell>
                          </TableRow>
                        ))}
                        {streamPaychecks.length > 12 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground text-sm">
                              + {streamPaychecks.length - 12} more paychecks
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Income Stream</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will delete the income stream and all associated bonus events. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { deleteConfirm && deleteStream.mutate(deleteConfirm); setDeleteConfirm(null); }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
