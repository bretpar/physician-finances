import { useState, useMemo } from "react";
import { format } from "date-fns";
import {
  Plus, Pencil, Trash2, DollarSign, ShieldCheck, AlertTriangle,
  CheckCircle2, CalendarIcon, ArrowRight, Target,
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
import {
  useTaxSavings, useAddTaxSaving, useUpdateTaxSaving, useDeleteTaxSaving,
  type TaxSaving,
} from "@/hooks/useTaxSavings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function TaxReserve() {
  const { data: savings = [], isLoading } = useTaxSavings();
  const addMutation = useAddTaxSaving();
  const updateMutation = useUpdateTaxSaving();
  const deleteMutation = useDeleteTaxSaving();
  const { estimate, taxMode, actualDebug, forecastDebug } = useTaxEstimate();
  const debug = taxMode === "forecast" ? forecastDebug : actualDebug;

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form
  const [savingsDate, setSavingsDate] = useState<Date>(new Date());
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("manual");
  const [notes, setNotes] = useState("");

  const manualSavingsTotal = useMemo(() => savings.reduce((s, e) => s + Number(e.amount), 0), [savings]);
  const t = estimate?.tracking;
  // Use unified engine output: total tax owed and ALL counted credits (federal
  // W/H + state W/H + estimated payments). Same definition as Tax Overview.
  const estimatedOwed = debug?.totalEstimatedTax ?? estimate?.totalTaxLiability ?? 0;
  const taxesWithheld = debug?.countedCreditsTotal ?? 0;
  const remainingOwed = debug?.remainingTaxDue ?? Math.max(0, estimatedOwed - taxesWithheld);
  // taxSavingsSetAside in the engine = manual savings + per-entry Additional
  // Tax Reserve from personal & business income entries. Surface the unified
  // total so reserve entered on a paycheck rolls into the same "set aside" bar.
  const totalSetAside = debug?.taxSavingsSetAside ?? manualSavingsTotal;
  const taxGap = totalSetAside - remainingOwed;
  const onTrack = taxGap >= 0;

  const resetForm = () => {
    setSavingsDate(new Date());
    setAmount("");
    setSource("manual");
    setNotes("");
    setEditId(null);
  };

  const openEdit = (e: TaxSaving) => {
    setEditId(e.id);
    setSavingsDate(new Date(e.savings_date + "T00:00:00"));
    setAmount(String(e.amount));
    setSource(e.source);
    setNotes(e.notes || "");
    setOpen(true);
  };

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;

    const payload = {
      savings_date: format(savingsDate, "yyyy-MM-dd"),
      amount: amt,
      source,
      notes,
    };

    if (editId) {
      updateMutation.mutate({ id: editId, ...payload }, {
        onSuccess: () => { setOpen(false); resetForm(); },
      });
    } else {
      addMutation.mutate(payload, {
        onSuccess: () => { setOpen(false); resetForm(); },
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Time-based status banner */}
      {t && (
        <Card className={cn("border-2",
          t.status === "ahead" || t.status === "on_track"
            ? "border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20"
            : t.status === "slightly_behind"
            ? "border-amber-400/30 bg-amber-50/50 dark:bg-amber-950/20"
            : "border-red-400/30 bg-red-50/50 dark:bg-red-950/20"
        )}>
          <CardContent className="py-5 space-y-3">
            <div className="flex items-center gap-4">
              {t.status === "ahead" || t.status === "on_track" ? (
                <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
              ) : t.status === "slightly_behind" ? (
                <Target className="h-8 w-8 text-amber-500 shrink-0" />
              ) : (
                <AlertTriangle className="h-8 w-8 text-red-500 shrink-0" />
              )}
              <div>
                <p className={cn("text-lg font-semibold",
                  t.status === "ahead" || t.status === "on_track" ? "text-emerald-700 dark:text-emerald-400" :
                  t.status === "slightly_behind" ? "text-amber-700 dark:text-amber-400" :
                  "text-red-700 dark:text-red-400"
                )}>
                  {t.statusLabel}
                </p>
                <p className="text-sm text-muted-foreground">
                  Expected {fmt(t.expectedTaxToDate)} paid by day {t.daysElapsed} · You've paid {fmt(t.totalPaid)}
                </p>
              </div>
            </div>
            <Progress value={Math.min(100, t.paidVsExpectedPercent)} className="h-2.5" />
            {t.suggestedMonthlyPayment > 0 && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <ArrowRight className="h-4 w-4 text-primary" />
                To stay on track, consider saving <strong className="text-foreground">{fmt(t.suggestedMonthlyPayment)}/month</strong> going forward
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Taxes Owed</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(estimatedOwed)}</p>
            <p className="text-xs text-muted-foreground">Total annual tax liability</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">W-2 Taxes Withheld</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(taxesWithheld)}</p>
            <p className="text-xs text-muted-foreground">Already paid via paycheck</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taxes Set Aside</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(totalSetAside)}</p>
            <p className="text-xs text-muted-foreground">{savings.length} entries logged</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Safe Harbor</CardTitle>
            {t?.safeHarborMet ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
          </CardHeader>
          <CardContent>
            <p className={cn("text-sm font-semibold mb-1", t?.safeHarborMet ? "text-emerald-600" : "text-amber-600")}>
              {t?.safeHarborLabel ?? "Loading…"}
            </p>
            <Progress value={t?.safeHarborProgress ?? 0} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">
              {fmt(t?.totalPaid ?? 0)} of {fmt(t?.safeHarborTarget ?? 0)} target
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Add button */}
      <div className="flex justify-end">
        <Button onClick={() => { resetForm(); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Add Tax Savings
        </Button>
      </div>

      {/* Table */}
      <Card>
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
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : savings.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No tax savings entries yet</TableCell></TableRow>
              ) : (
                savings.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{format(new Date(e.savings_date + "T00:00:00"), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(Number(e.amount))}</TableCell>
                    <TableCell className="capitalize">{e.source}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">{e.notes}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(e)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
            <DialogTitle>{editId ? "Edit" : "Add"} Tax Savings Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !savingsDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {savingsDate ? format(savingsDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={savingsDate} onSelect={(d) => d && setSavingsDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="stocks">Stocks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(ev) => setNotes(ev.target.value)} placeholder="e.g. Q2 estimated payment" />
            </div>
            <Button className="w-full" onClick={handleSubmit} disabled={addMutation.isPending || updateMutation.isPending}>
              {editId ? "Update" : "Save"} Entry
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
