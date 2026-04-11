import { useState, useMemo } from "react";
import { format, isPast, isAfter } from "date-fns";
import {
  DollarSign, TrendingUp, TrendingDown, ShieldCheck, AlertTriangle,
  CheckCircle2, PiggyBank, Calculator, Receipt, Clock, ExternalLink,
  Plus, Pencil, Trash2, CalendarIcon, Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useTaxSettings, useUpdateTaxSettings, type TaxRates } from "@/hooks/useTaxSettings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxSavings, useAddTaxSaving, useUpdateTaxSaving, useDeleteTaxSaving } from "@/hooks/useTaxSavings";
import { useTaxPayments, useAddTaxPayment, useUpdateTaxPayment, useDeleteTaxPayment } from "@/hooks/useTaxPayments";
import { useProjectedStreams } from "@/hooks/useProjectedIncome";
import {
  BRACKETS_SINGLE, BRACKETS_MFJ, type TaxBracket,
} from "@/lib/taxEngine";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (n: number) => `${n.toFixed(1)}%`;

const currentYear = new Date().getFullYear();
const QUARTERS = [
  { key: "Q1", label: "Q1", due: new Date(currentYear, 3, 15), dueLabel: `Apr 15, ${currentYear}` },
  { key: "Q2", label: "Q2", due: new Date(currentYear, 5, 15), dueLabel: `Jun 15, ${currentYear}` },
  { key: "Q3", label: "Q3", due: new Date(currentYear, 8, 15), dueLabel: `Sep 15, ${currentYear}` },
  { key: "Q4", label: "Q4", due: new Date(currentYear + 1, 0, 15), dueLabel: `Jan 15, ${currentYear + 1}` },
];

export default function Taxes() {
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const updateSettings = useUpdateTaxSettings();
  const { estimate, isLoading: estLoading } = useTaxEstimate();
  const { data: incomeEntries = [] } = useIncomeEntries();
  const { data: savings = [] } = useTaxSavings();
  const { data: payments = [] } = useTaxPayments();
  const { data: streams = [] } = useProjectedStreams();

  const addSaving = useAddTaxSaving();
  const updateSaving = useUpdateTaxSaving();
  const deleteSaving = useDeleteTaxSaving();
  const addPayment = useAddTaxPayment();
  const updatePayment = useUpdateTaxPayment();
  const deletePayment = useDeleteTaxPayment();

  // Savings form
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [savingsEditId, setSavingsEditId] = useState<string | null>(null);
  const [savingsDate, setSavingsDate] = useState<Date>(new Date());
  const [savingsAmount, setSavingsAmount] = useState("");
  const [savingsSource, setSavingsSource] = useState("manual");
  const [savingsNotes, setSavingsNotes] = useState("");
  const [savingsDeleteId, setSavingsDeleteId] = useState<string | null>(null);

  // Payment form
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentEditId, setPaymentEditId] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentQuarter, setPaymentQuarter] = useState("Q1");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentDeleteId, setPaymentDeleteId] = useState<string | null>(null);

  const isLoading = ratesLoading || estLoading;

  const e = estimate;
  const totalSetAside = savings.reduce((s, sv) => s + Number(sv.amount), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const estimatedOwed = e?.totalTaxLiability ?? 0;
  const taxesWithheld = e?.taxesAlreadyWithheld ?? 0;
  const remainingOwed = Math.max(0, estimatedOwed - taxesWithheld);
  const taxGap = totalSetAside - remainingOwed;
  const onTrack = taxGap >= 0;

  const now = new Date();
  const monthsLeft = Math.max(1, 12 - now.getMonth());
  const monthlyTarget = remainingOwed > totalSetAside ? (remainingOwed - totalSetAside) / monthsLeft : 0;

  // Quarterly data
  const totalCovered = taxesWithheld + totalPaid;
  const stillOwed = Math.max(0, estimatedOwed - totalCovered);
  const safeHarborTarget = e?.safeHarborTarget ?? 0;
  const safeHarborMet = totalCovered >= safeHarborTarget;

  const quarterData = useMemo(() => {
    const remainingQs = QUARTERS.filter((q) => isAfter(q.due, now) || q.due.toDateString() === now.toDateString());
    const remainingCount = Math.max(1, remainingQs.length);
    const suggestedPerQ = stillOwed / remainingCount;

    return QUARTERS.map((q) => {
      const qPayments = payments.filter((p) => p.quarter === q.key);
      const paidAmount = qPayments.reduce((s, p) => s + Number(p.amount), 0);
      const recommended = suggestedPerQ;
      const remainingDue = Math.max(0, recommended - paidAmount);
      let status: "paid" | "upcoming" | "overdue" = "upcoming";
      if (paidAmount >= recommended && recommended > 0) status = "paid";
      else if (isPast(q.due) && paidAmount < recommended) status = "overdue";
      return { ...q, paidAmount, recommended, remainingDue, status };
    });
  }, [payments, stillOwed, now]);

  const nextDue = quarterData.find((q) => q.status === "upcoming" || q.status === "overdue");

  // Form helpers
  const resetSavingsForm = () => { setSavingsDate(new Date()); setSavingsAmount(""); setSavingsSource("manual"); setSavingsNotes(""); setSavingsEditId(null); };
  const resetPaymentForm = () => { setPaymentDate(new Date()); setPaymentAmount(""); setPaymentQuarter("Q1"); setPaymentNotes(""); setPaymentEditId(null); };

  const handleSavingsSubmit = () => {
    const amt = Number(savingsAmount);
    if (!amt || amt <= 0) return;
    const payload = { savings_date: format(savingsDate, "yyyy-MM-dd"), amount: amt, source: savingsSource, notes: savingsNotes };
    if (savingsEditId) {
      updateSaving.mutate({ id: savingsEditId, ...payload }, { onSuccess: () => { setSavingsOpen(false); resetSavingsForm(); } });
    } else {
      addSaving.mutate(payload, { onSuccess: () => { setSavingsOpen(false); resetSavingsForm(); } });
    }
  };

  const handlePaymentSubmit = () => {
    const amt = Number(paymentAmount);
    if (!amt || amt <= 0) return;
    const payload = { payment_date: format(paymentDate, "yyyy-MM-dd"), amount: amt, quarter: paymentQuarter, notes: paymentNotes };
    if (paymentEditId) {
      updatePayment.mutate({ id: paymentEditId, ...payload }, { onSuccess: () => { setPaymentOpen(false); resetPaymentForm(); } });
    } else {
      addPayment.mutate(payload, { onSuccess: () => { setPaymentOpen(false); resetPaymentForm(); } });
    }
  };

  const handleFilingChange = (value: string) => {
    if (!rates?.id) return;
    updateSettings.mutate({ id: rates.id, filingStatus: value as TaxRates["filingStatus"] });
  };

  const handleLastYearTax = (value: string) => {
    if (!rates?.id) return;
    updateSettings.mutate({ id: rates.id, lastYearTax: parseFloat(value) || 0 });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading tax data…</p></div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Status banner */}
      <Card className={cn("border-2", onTrack ? "border-green-500/30 bg-green-50/50 dark:bg-green-950/20" : "border-destructive/30 bg-red-50/50 dark:bg-red-950/20")}>
        <CardContent className="flex items-center gap-4 py-4">
          {onTrack ? <CheckCircle2 className="h-7 w-7 text-green-600 shrink-0" /> : <AlertTriangle className="h-7 w-7 text-destructive shrink-0" />}
          <div className="flex-1">
            <p className={cn("font-semibold", onTrack ? "text-green-700 dark:text-green-400" : "text-destructive")}>
              {onTrack ? "On track — you have enough saved for taxes" : `Under-saving by ${fmt(Math.abs(taxGap))}`}
            </p>
            {monthlyTarget > 0 && (
              <p className="text-sm text-muted-foreground">Save ~{fmt(monthlyTarget)}/month to stay on track</p>
            )}
          </div>
          {nextDue && nextDue.remainingDue > 0 && (
            <div className="text-right hidden sm:block">
              <p className="text-xs text-muted-foreground">Next quarterly payment</p>
              <p className="font-semibold">{fmt(nextDue.remainingDue)} due {nextDue.dueLabel}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Tax Overview</TabsTrigger>
          <TabsTrigger value="income">Income Inputs</TabsTrigger>
          <TabsTrigger value="engine">Tax Engine</TabsTrigger>
          <TabsTrigger value="quarterly">Quarterly Payments</TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════
            TAB 1: TAX OVERVIEW
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">YTD Income</p>
                <p className="text-xl font-bold">{fmt(e?.totalIncome ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Projected Annual</p>
                <p className="text-xl font-bold">{fmt(e?.totalIncome ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Estimated Tax</p>
                <p className="text-xl font-bold text-destructive">{fmt(estimatedOwed)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Effective Rate</p>
                <p className="text-xl font-bold">{pct(e?.effectiveRate ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Taxes Paid</p>
                <p className="text-xl font-bold text-green-600">{fmt(totalCovered)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Remaining Owed</p>
                <p className={cn("text-xl font-bold", stillOwed > 0 ? "text-destructive" : "text-green-600")}>{fmt(stillOwed)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Reserve progress */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PiggyBank className="h-4 w-4" /> Tax Reserve Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Est. Owed (after W-2)</p>
                  <p className="font-semibold">{fmt(remainingOwed)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Set Aside</p>
                  <p className="font-semibold">{fmt(totalSetAside)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Gap</p>
                  <p className={cn("font-semibold", onTrack ? "text-green-600" : "text-destructive")}>{fmt(taxGap)}</p>
                </div>
              </div>
              <Progress value={remainingOwed > 0 ? Math.min(100, (totalSetAside / remainingOwed) * 100) : 100} className="h-2" />
              {monthlyTarget > 0 && (
                <p className="text-sm text-muted-foreground">Monthly reserve recommendation: <span className="font-semibold text-foreground">{fmt(monthlyTarget)}</span></p>
              )}
              <Button variant="outline" size="sm" onClick={() => { resetSavingsForm(); setSavingsOpen(true); }}>
                <Plus className="h-3 w-3 mr-1" /> Log Tax Savings
              </Button>
            </CardContent>
          </Card>

          {/* Safe harbor */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Safe Harbor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                {safeHarborMet ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
                <span className={cn("font-medium", safeHarborMet ? "text-green-600" : "text-destructive")}>
                  {safeHarborMet ? "Safe Harbor Met" : "At Risk for Penalty"}
                </span>
              </div>
              <Progress value={safeHarborTarget > 0 ? Math.min(100, (totalCovered / safeHarborTarget) * 100) : 100} className="h-2" />
              <p className="text-xs text-muted-foreground">{fmt(totalCovered)} of {fmt(safeHarborTarget)} target</p>
            </CardContent>
          </Card>

          {/* Tax savings log */}
          {savings.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Tax Savings Log</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-[80px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savings.map((sv) => (
                      <TableRow key={sv.id}>
                        <TableCell>{format(new Date(sv.savings_date + "T00:00:00"), "MMM d, yyyy")}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(Number(sv.amount))}</TableCell>
                        <TableCell className="capitalize">{sv.source}</TableCell>
                        <TableCell className="text-muted-foreground truncate max-w-[200px]">{sv.notes}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => {
                              setSavingsEditId(sv.id);
                              setSavingsDate(new Date(sv.savings_date + "T00:00:00"));
                              setSavingsAmount(String(sv.amount));
                              setSavingsSource(sv.source);
                              setSavingsNotes(sv.notes || "");
                              setSavingsOpen(true);
                            }}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setSavingsDeleteId(sv.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 2: INCOME INPUTS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="income" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">W-2 Income (YTD)</p>
                <p className="text-2xl font-bold">{fmt(e?.w2Income ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">1099/K-1 Income (YTD)</p>
                <p className="text-2xl font-bold">{fmt(e?.seIncome ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total (incl. projected)</p>
                <p className="text-2xl font-bold">{fmt(e?.totalIncome ?? 0)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Actual income entries */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Actual Income Entries (YTD)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Paycheck</TableHead>
                    <TableHead className="text-right">Withheld</TableHead>
                    <TableHead className="text-right">401k</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incomeEntries.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No income entries — add them in the Income page</TableCell></TableRow>
                  ) : (
                    incomeEntries.slice(0, 20).map((ie) => (
                      <TableRow key={ie.id}>
                        <TableCell>{format(new Date(ie.income_date + "T00:00:00"), "MMM d")}</TableCell>
                        <TableCell>{ie.company}</TableCell>
                        <TableCell><Badge variant="outline">{ie.income_type}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{fmt(Number(ie.paycheck_amount))}</TableCell>
                        <TableCell className="text-right">{fmt(Number(ie.taxes_withheld))}</TableCell>
                        <TableCell className="text-right">{fmt(Number(ie.retirement_401k))}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Projected streams */}
          {streams.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Projected Income Streams</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead className="text-right">Per Paycheck</TableHead>
                      <TableHead>Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {streams.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.company}</TableCell>
                        <TableCell className="capitalize">{s.pay_frequency}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(Number(s.paycheck_amount))}</TableCell>
                        <TableCell>{s.is_active ? <Badge className="bg-green-100 text-green-700">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Tax rate config */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Tax Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Filing Status</Label>
                  <Select value={rates?.filingStatus || "single"} onValueChange={handleFilingChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single</SelectItem>
                      <SelectItem value="married_filing_jointly">Married Filing Jointly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Last Year's Tax</Label>
                  <Input type="number" min="0" step="100" defaultValue={rates?.lastYearTax || 0} onBlur={(ev) => handleLastYearTax(ev.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">WA B&O Rate (%)</Label>
                  <Input type="number" min="0" step="0.1" defaultValue={rates?.bnoRate ?? 1.5} disabled className="bg-muted" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 3: TAX CALCULATION ENGINE
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="engine" className="space-y-6">
          {!e ? (
            <p className="text-muted-foreground text-center py-12">Add income entries to see calculations.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Tax breakdown */}
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Tax Breakdown</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Federal Income Tax</span>
                      <span className="font-medium">{fmt(e.federalTax)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Self-Employment Tax</span>
                      <span className="font-medium">{fmt(e.seTax.total)}</span>
                    </div>
                    <div className="pl-4 space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Social Security</span><span>{fmt(e.seTax.ssTax)}</span></div>
                      <div className="flex justify-between"><span>Medicare</span><span>{fmt(e.seTax.medicareTax)}</span></div>
                      {e.seTax.additionalMedicare > 0 && (
                        <div className="flex justify-between"><span>Additional Medicare</span><span>{fmt(e.seTax.additionalMedicare)}</span></div>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">WA B&O Tax</span>
                      <span className="font-medium">{fmt(e.bnoTax)}</span>
                    </div>
                    <div className="border-t border-border pt-2 flex justify-between font-semibold">
                      <span>Total Estimated Tax</span><span>{fmt(e.totalTaxLiability)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Taxes Already Withheld</span><span>−{fmt(e.taxesAlreadyWithheld)}</span>
                    </div>
                    <div className="border-t border-border pt-2 flex justify-between font-semibold text-lg">
                      <span>Remaining Liability</span>
                      <span className={e.remainingLiability > 0 ? "text-amber-600" : "text-green-600"}>{fmt(e.remainingLiability)}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Income & deductions */}
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Income & Deductions</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Gross Income</span>
                      <span className="font-medium">{fmt(e.totalIncome)}</span>
                    </div>
                    <div className="pl-4 space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>W-2</span><span>{fmt(e.w2Income)}</span></div>
                      <div className="flex justify-between"><span>1099/K-1</span><span>{fmt(e.seIncome)}</span></div>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pre-Tax Deductions</span>
                      <span className="font-medium">−{fmt(e.preTaxDeductions)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">401k</span>
                      <span className="font-medium">−{fmt(e.retirement401k)}</span>
                    </div>
                    <div className="border-t border-border pt-2 flex justify-between font-semibold">
                      <span>AGI</span><span>{fmt(e.agi)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Standard Deduction</span>
                      <span className="font-medium">−{fmt(e.standardDeduction)}</span>
                    </div>
                    {e.businessDeductions > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Business Expenses</span>
                        <span className="font-medium">−{fmt(e.businessDeductions)}</span>
                      </div>
                    )}
                    {e.mileageDeduction > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Mileage Deduction</span>
                        <span className="font-medium">−{fmt(e.mileageDeduction)}</span>
                      </div>
                    )}
                    <div className="border-t border-border pt-2 flex justify-between font-semibold">
                      <span>Taxable Income</span><span>{fmt(e.taxableIncome)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground pt-1">
                      <span>Effective: {pct(e.effectiveRate)}</span>
                      <span>Marginal: {pct(e.marginalRate)}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Bracket table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Federal Tax Brackets ({rates?.filingStatus === "married_filing_jointly" ? "MFJ" : "Single"})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-2 text-muted-foreground font-medium">Bracket</th>
                          <th className="text-right py-2 px-2 text-muted-foreground font-medium">Rate</th>
                          <th className="text-right py-2 px-2 text-muted-foreground font-medium">Tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(rates?.filingStatus === "married_filing_jointly" ? BRACKETS_MFJ : BRACKETS_SINGLE).map((b, i) => {
                          if (e.taxableIncome <= b.min) return null;
                          const taxable = Math.min(e.taxableIncome, b.max) - b.min;
                          const tax = taxable * b.rate;
                          return (
                            <tr key={i} className="border-b border-border/50">
                              <td className="py-1.5 px-2">{fmt(b.min)} – {b.max === Infinity ? "+" : fmt(b.max)}</td>
                              <td className="py-1.5 px-2 text-right">{(b.rate * 100).toFixed(0)}%</td>
                              <td className="py-1.5 px-2 text-right font-medium">{fmt(tax)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Per-paycheck */}
              {e.recommendedSetAside > 0 && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="pt-5 pb-5 flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <PiggyBank className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Recommended per paycheck set-aside</p>
                      <p className="text-3xl font-bold text-primary">{fmt(e.recommendedSetAside)}</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 4: QUARTERLY PAYMENTS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="quarterly" className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Est. Annual Tax</p>
                <p className="text-2xl font-bold">{fmt(estimatedOwed)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Paid / Withheld</p>
                <p className="text-2xl font-bold">{fmt(totalCovered)}</p>
                <p className="text-xs text-muted-foreground">Withheld: {fmt(taxesWithheld)} · Payments: {fmt(totalPaid)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Remaining Owed</p>
                <p className={cn("text-2xl font-bold", stillOwed > 0 ? "text-destructive" : "text-green-600")}>{fmt(stillOwed)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Safe Harbor</p>
                <div className="flex items-center gap-2 mt-1">
                  {safeHarborMet ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                  <span className={cn("text-sm font-medium", safeHarborMet ? "text-green-600" : "text-destructive")}>
                    {safeHarborMet ? "Met" : "At Risk"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quarter cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quarterData.map((q) => (
              <Card key={q.key} className={cn("border-2",
                q.status === "paid" && "border-green-500/30",
                q.status === "overdue" && "border-destructive/30",
                q.status === "upcoming" && "border-border",
              )}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between">
                    <span className="text-lg font-bold">{q.label}</span>
                    {q.status === "paid" ? <CheckCircle2 className="h-5 w-5 text-green-600" /> :
                     q.status === "overdue" ? <AlertTriangle className="h-5 w-5 text-destructive" /> :
                     <Clock className="h-5 w-5 text-muted-foreground" />}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Due: {q.dueLabel}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Recommended</span><span className="font-medium">{fmt(q.recommended)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="font-medium text-green-600">{fmt(q.paidAmount)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Remaining</span><span className={cn("font-medium", q.remainingDue > 0 ? "text-destructive" : "text-green-600")}>{fmt(q.remainingDue)}</span></div>
                  </div>
                  <Badge variant="outline" className={cn("text-xs",
                    q.status === "paid" && "bg-green-100 text-green-700",
                    q.status === "overdue" && "bg-red-100 text-red-700",
                  )}>
                    {q.status === "paid" ? "Paid" : q.status === "overdue" ? "Overdue" : "Upcoming"}
                  </Badge>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => { resetPaymentForm(); setPaymentQuarter(q.key); setPaymentOpen(true); }}>
                    <Plus className="h-3 w-3 mr-1" /> Log Payment
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* IRS link */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <a href="https://www.irs.gov/payments/direct-pay" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" /> IRS Direct Pay
              </a>
            </Button>
          </div>

          {/* Payment history */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Quarter</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No payments logged yet</TableCell></TableRow>
                  ) : (
                    payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{format(new Date(p.payment_date + "T00:00:00"), "MMM d, yyyy")}</TableCell>
                        <TableCell>{p.quarter}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(Number(p.amount))}</TableCell>
                        <TableCell className="text-muted-foreground truncate max-w-[200px]">{p.notes}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => {
                              setPaymentEditId(p.id);
                              setPaymentDate(new Date(p.payment_date + "T00:00:00"));
                              setPaymentAmount(String(p.amount));
                              setPaymentQuarter(p.quarter);
                              setPaymentNotes(p.notes || "");
                              setPaymentOpen(true);
                            }}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setPaymentDeleteId(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══════ Dialogs ═══════ */}

      {/* Tax savings dialog */}
      <Dialog open={savingsOpen} onOpenChange={(v) => { if (!v) resetSavingsForm(); setSavingsOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{savingsEditId ? "Edit" : "Add"} Tax Savings</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(savingsDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={savingsDate} onSelect={(d) => d && setSavingsDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" min="0" step="0.01" value={savingsAmount} onChange={(ev) => setSavingsAmount(ev.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Source</Label>
              <Select value={savingsSource} onValueChange={setSavingsSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="stocks">Stocks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={savingsNotes} onChange={(ev) => setSavingsNotes(ev.target.value)} placeholder="Optional" />
            </div>
            <Button className="w-full" onClick={handleSavingsSubmit} disabled={addSaving.isPending || updateSaving.isPending}>
              {savingsEditId ? "Update" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tax payment dialog */}
      <Dialog open={paymentOpen} onOpenChange={(v) => { if (!v) resetPaymentForm(); setPaymentOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{paymentEditId ? "Edit" : "Log"} Tax Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(paymentDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={paymentDate} onSelect={(d) => d && setPaymentDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" min="0" step="0.01" value={paymentAmount} onChange={(ev) => setPaymentAmount(ev.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Quarter *</Label>
              <Select value={paymentQuarter} onValueChange={setPaymentQuarter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUARTERS.map((q) => <SelectItem key={q.key} value={q.key}>{q.label} — Due {q.dueLabel}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={paymentNotes} onChange={(ev) => setPaymentNotes(ev.target.value)} placeholder="Optional" />
            </div>
            <Button className="w-full" onClick={handlePaymentSubmit} disabled={addPayment.isPending || updatePayment.isPending}>
              {paymentEditId ? "Update" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirms */}
      <AlertDialog open={!!savingsDeleteId} onOpenChange={(v) => { if (!v) setSavingsDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this savings entry?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (savingsDeleteId) deleteSaving.mutate(savingsDeleteId); setSavingsDeleteId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!paymentDeleteId} onOpenChange={(v) => { if (!v) setPaymentDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this payment?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (paymentDeleteId) deletePayment.mutate(paymentDeleteId); setPaymentDeleteId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
