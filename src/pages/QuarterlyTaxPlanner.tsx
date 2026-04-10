import { useState, useMemo } from "react";
import { format, isPast, isAfter } from "date-fns";
import {
  Plus, Pencil, Trash2, DollarSign, CalendarIcon, CheckCircle2,
  AlertTriangle, Clock, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useTaxPayments, useAddTaxPayment, useUpdateTaxPayment, useDeleteTaxPayment } from "@/hooks/useTaxPayments";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const currentYear = new Date().getFullYear();

const QUARTERS = [
  { key: "Q1", label: "Q1", due: new Date(currentYear, 3, 15), dueLabel: `Apr 15, ${currentYear}` },
  { key: "Q2", label: "Q2", due: new Date(currentYear, 5, 15), dueLabel: `Jun 15, ${currentYear}` },
  { key: "Q3", label: "Q3", due: new Date(currentYear, 8, 15), dueLabel: `Sep 15, ${currentYear}` },
  { key: "Q4", label: "Q4", due: new Date(currentYear + 1, 0, 15), dueLabel: `Jan 15, ${currentYear + 1}` },
];

type QuarterStatus = "paid" | "upcoming" | "overdue";

export default function QuarterlyTaxPlanner() {
  const { data: payments = [], isLoading } = useTaxPayments();
  const addMutation = useAddTaxPayment();
  const updateMutation = useUpdateTaxPayment();
  const deleteMutation = useDeleteTaxPayment();
  const { estimate } = useTaxEstimate();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [amount, setAmount] = useState("");
  const [quarter, setQuarter] = useState("Q1");
  const [notes, setNotes] = useState("");

  const totalEstTax = estimate?.totalTaxLiability ?? 0;
  const taxesWithheld = estimate?.taxesAlreadyWithheld ?? 0;
  const remainingLiability = estimate?.remainingLiability ?? 0;
  const safeHarborTarget = estimate?.safeHarborTarget ?? 0;

  const totalPaid = useMemo(() => payments.reduce((s, p) => s + Number(p.amount), 0), [payments]);
  const totalCovered = taxesWithheld + totalPaid;
  const stillOwed = Math.max(0, totalEstTax - totalCovered);

  // Safe harbor
  const safeHarborMet = totalCovered >= safeHarborTarget;
  const safeHarborProgress = safeHarborTarget > 0 ? Math.min(100, (totalCovered / safeHarborTarget) * 100) : 100;

  // Per-quarter calculations
  const now = new Date();
  const quarterData = useMemo(() => {
    const remainingQs = QUARTERS.filter((q) => isAfter(q.due, now) || q.due.toDateString() === now.toDateString());
    const remainingCount = Math.max(1, remainingQs.length);
    const suggestedPerQ = stillOwed / remainingCount;

    return QUARTERS.map((q) => {
      const qPayments = payments.filter((p) => p.quarter === q.key);
      const paidAmount = qPayments.reduce((s, p) => s + Number(p.amount), 0);
      const recommended = suggestedPerQ;
      const remainingDue = Math.max(0, recommended - paidAmount);

      let status: QuarterStatus = "upcoming";
      if (paidAmount >= recommended && recommended > 0) {
        status = "paid";
      } else if (isPast(q.due) && paidAmount < recommended) {
        status = "overdue";
      }

      return { ...q, paidAmount, recommended, remainingDue, status, payments: qPayments };
    });
  }, [payments, stillOwed, now]);

  // Next due
  const nextDue = quarterData.find((q) => q.status === "upcoming" || q.status === "overdue");

  const resetForm = () => {
    setPaymentDate(new Date());
    setAmount("");
    setQuarter("Q1");
    setNotes("");
    setEditId(null);
  };

  const openEditPayment = (p: { id: string; payment_date: string; amount: number; quarter: string; notes: string | null }) => {
    setEditId(p.id);
    setPaymentDate(new Date(p.payment_date + "T00:00:00"));
    setAmount(String(p.amount));
    setQuarter(p.quarter);
    setNotes(p.notes || "");
    setOpen(true);
  };

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    const payload = {
      payment_date: format(paymentDate, "yyyy-MM-dd"),
      amount: amt,
      quarter,
      notes,
    };
    if (editId) {
      updateMutation.mutate({ id: editId, ...payload }, { onSuccess: () => { setOpen(false); resetForm(); } });
    } else {
      addMutation.mutate(payload, { onSuccess: () => { setOpen(false); resetForm(); } });
    }
  };

  const statusIcon = (s: QuarterStatus) => {
    if (s === "paid") return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    if (s === "overdue") return <AlertTriangle className="h-5 w-5 text-destructive" />;
    return <Clock className="h-5 w-5 text-muted-foreground" />;
  };

  const statusLabel = (s: QuarterStatus) => {
    if (s === "paid") return "Paid";
    if (s === "overdue") return "Overdue";
    return "Upcoming";
  };

  return (
    <div className="space-y-6">
      {/* Alert banner */}
      {nextDue && nextDue.status === "overdue" && (
        <Card className="border-2 border-destructive/30 bg-red-50/50 dark:bg-red-950/20">
          <CardContent className="flex items-center gap-4 py-4">
            <AlertTriangle className="h-7 w-7 text-destructive shrink-0" />
            <div>
              <p className="font-semibold text-destructive">
                Overdue: You need to pay {fmt(nextDue.remainingDue)} for {nextDue.label} (was due {nextDue.dueLabel})
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {nextDue && nextDue.status === "upcoming" && nextDue.remainingDue > 0 && (
        <Card className="border-2 border-primary/30">
          <CardContent className="flex items-center gap-4 py-4">
            <Clock className="h-7 w-7 text-primary shrink-0" />
            <div>
              <p className="font-semibold text-foreground">
                Next payment: {fmt(nextDue.remainingDue)} due {nextDue.dueLabel} ({nextDue.label})
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Annual Tax</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(totalEstTax)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Paid / Withheld</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(totalCovered)}</p>
            <p className="text-xs text-muted-foreground">W-2 withheld: {fmt(taxesWithheld)} · Payments: {fmt(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Remaining Owed</CardTitle>
            {stillOwed > 0 ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
          </CardHeader>
          <CardContent>
            <p className={cn("text-2xl font-bold", stillOwed > 0 ? "text-destructive" : "text-green-600")}>{fmt(stillOwed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Safe Harbor</CardTitle>
            {safeHarborMet ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
          </CardHeader>
          <CardContent>
            <p className={cn("text-sm font-semibold mb-1", safeHarborMet ? "text-green-600" : "text-destructive")}>
              {safeHarborMet ? "Safe Harbor Met" : "At Risk for Penalty"}
            </p>
            <Progress value={safeHarborProgress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">{fmt(totalCovered)} of {fmt(safeHarborTarget)} target</p>
          </CardContent>
        </Card>
      </div>

      {/* Quarterly cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {quarterData.map((q) => (
          <Card key={q.key} className={cn(
            "border-2",
            q.status === "paid" && "border-green-500/30",
            q.status === "overdue" && "border-destructive/30",
            q.status === "upcoming" && "border-border",
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                <span className="text-lg font-bold">{q.label}</span>
                {statusIcon(q.status)}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Due: {q.dueLabel}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recommended</span>
                  <span className="font-medium">{fmt(q.recommended)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="font-medium text-green-600">{fmt(q.paidAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className={cn("font-medium", q.remainingDue > 0 ? "text-destructive" : "text-green-600")}>{fmt(q.remainingDue)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  q.status === "paid" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                  q.status === "overdue" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                  q.status === "upcoming" && "bg-muted text-muted-foreground",
                )}>
                  {statusLabel(q.status)}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => { resetForm(); setQuarter(q.key); setOpen(true); }}
              >
                <Plus className="h-3 w-3 mr-1" /> Log Payment
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* IRS Direct Pay link */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <a href="https://www.irs.gov/payments/direct-pay" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" /> IRS Direct Pay
          </a>
        </Button>
      </div>

      {/* Payment log table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment History</CardTitle>
        </CardHeader>
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
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : payments.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payments logged yet</TableCell></TableRow>
              ) : (
                payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{format(new Date(p.payment_date + "T00:00:00"), "MMM d, yyyy")}</TableCell>
                    <TableCell>{p.quarter}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(Number(p.amount))}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">{p.notes}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditPayment(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit" : "Log"} Tax Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !paymentDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {paymentDate ? format(paymentDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={paymentDate} onSelect={(d) => d && setPaymentDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Quarter *</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUARTERS.map((q) => (
                    <SelectItem key={q.key} value={q.key}>{q.label} — Due {q.dueLabel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. IRS Direct Pay confirmation" />
            </div>
            <Button className="w-full" onClick={handleSubmit} disabled={addMutation.isPending || updateMutation.isPending}>
              {editId ? "Update" : "Save"} Payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
