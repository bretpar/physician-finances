import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown, DollarSign, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import {
  useStockTransactions,
  useAddStockTransaction,
  useUpdateStockTransaction,
  useDeleteStockTransaction,
  calculateStockTax,
  type StockTransaction,
} from "@/hooks/useStocks";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function Stocks() {
  const { data: transactions = [], isLoading } = useStockTransactions();
  const addMutation = useAddStockTransaction();
  const updateMutation = useUpdateStockTransaction();
  const deleteMutation = useDeleteStockTransaction();
  const { estimate } = useTaxEstimate();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [taxPopup, setTaxPopup] = useState<{ show: boolean; amount: number }>({ show: false, amount: 0 });

  // Form state
  const [saleDate, setSaleDate] = useState<Date>(new Date());
  const [totalSaleAmount, setTotalSaleAmount] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [gainLossOverride, setGainLossOverride] = useState("");
  const [saleType, setSaleType] = useState("short_term");

  const computedGainLoss = (Number(totalSaleAmount) || 0) - (Number(costBasis) || 0);
  const gainLoss = gainLossOverride !== "" ? Number(gainLossOverride) : computedGainLoss;

  // Summary calculations
  const summary = useMemo(() => {
    const totalSales = transactions.reduce((s, t) => s + Number(t.total_sale_amount), 0);
    const totalCost = transactions.reduce((s, t) => s + Number(t.cost_basis), 0);
    const totalGainLoss = transactions.reduce((s, t) => s + Number(t.gain_loss), 0);
    const totalEstTax = transactions.reduce((s, t) => s + Number(t.estimated_tax), 0);
    return { totalSales, totalCost, totalGainLoss, totalEstTax };
  }, [transactions]);

  const resetForm = () => {
    setSaleDate(new Date());
    setTotalSaleAmount("");
    setCostBasis("");
    setGainLossOverride("");
    setSaleType("short_term");
    setEditId(null);
  };

  const openEdit = (tx: StockTransaction) => {
    setEditId(tx.id);
    setSaleDate(new Date(tx.sale_date + "T00:00:00"));
    setTotalSaleAmount(String(tx.total_sale_amount));
    setCostBasis(String(tx.cost_basis));
    setGainLossOverride(String(tx.gain_loss));
    setSaleType(tx.sale_type);
    setOpen(true);
  };

  const handleSubmit = () => {
    const saleAmt = Number(totalSaleAmount) || 0;
    const basis = Number(costBasis) || 0;
    if (!saleAmt || !basis) return;

    const marginalRate = estimate?.effectiveRate ? estimate.effectiveRate / 100 : 0.32;
    const totalIncomeWithGain = (estimate?.totalIncome || 0) + (gainLoss > 0 ? gainLoss : 0);
    const estTax = calculateStockTax(gainLoss, saleType, totalIncomeWithGain, marginalRate);

    const payload = {
      sale_date: format(saleDate, "yyyy-MM-dd"),
      total_sale_amount: saleAmt,
      cost_basis: basis,
      gain_loss: gainLoss,
      sale_type: saleType,
      estimated_tax: Math.round(estTax * 100) / 100,
    };

    if (editId) {
      updateMutation.mutate({ id: editId, ...payload }, {
        onSuccess: () => { setOpen(false); resetForm(); },
      });
    } else {
      addMutation.mutate(payload, {
        onSuccess: () => {
          setOpen(false);
          resetForm();
          if (estTax > 0) {
            setTaxPopup({ show: true, amount: Math.round(estTax * 100) / 100 });
          }
        },
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Sales YTD</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(summary.totalSales)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Cost Basis</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(summary.totalCost)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Gains/Losses</CardTitle>
            {summary.totalGainLoss >= 0 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
          </CardHeader>
          <CardContent>
            <p className={cn("text-2xl font-bold", summary.totalGainLoss >= 0 ? "text-green-600" : "text-destructive")}>
              {fmt(summary.totalGainLoss)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Taxes on Stocks</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(summary.totalEstTax)}</p></CardContent>
        </Card>
      </div>

      {/* Add button */}
      <div className="flex justify-end">
        <Button onClick={() => { resetForm(); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Add Transaction
        </Button>
      </div>

      {/* Transactions table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Sale Amount</TableHead>
                <TableHead className="text-right">Cost Basis</TableHead>
                <TableHead className="text-right">Gain/Loss</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Est. Tax</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : transactions.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No stock transactions yet</TableCell></TableRow>
              ) : (
                transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>{format(new Date(tx.sale_date + "T00:00:00"), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right">{fmt(Number(tx.total_sale_amount))}</TableCell>
                    <TableCell className="text-right">{fmt(Number(tx.cost_basis))}</TableCell>
                    <TableCell className={cn("text-right font-medium", Number(tx.gain_loss) >= 0 ? "text-green-600" : "text-destructive")}>
                      {fmt(Number(tx.gain_loss))}
                    </TableCell>
                    <TableCell>{tx.sale_type === "long_term" ? "Long-Term" : "Short-Term"}</TableCell>
                    <TableCell className="text-right">{fmt(Number(tx.estimated_tax))}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(tx)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(tx.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
            <DialogTitle>{editId ? "Edit" : "Add"} Stock Transaction</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !saleDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {saleDate ? format(saleDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={saleDate} onSelect={(d) => d && setSaleDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Total Sale Amount *</Label>
              <Input type="number" min="0" value={totalSaleAmount} onChange={(e) => setTotalSaleAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Cost Basis *</Label>
              <Input type="number" min="0" value={costBasis} onChange={(e) => setCostBasis(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Gain / Loss (auto-calculated, override if needed)</Label>
              <Input
                type="number"
                value={gainLossOverride !== "" ? gainLossOverride : String(computedGainLoss)}
                onChange={(e) => setGainLossOverride(e.target.value)}
                className={cn(gainLoss >= 0 ? "text-green-600" : "text-destructive")}
              />
            </div>
            <div>
              <Label>Sale Type *</Label>
              <Select value={saleType} onValueChange={setSaleType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="long_term">Long-Term (held &gt; 1 year)</SelectItem>
                  <SelectItem value="short_term">Short-Term (held ≤ 1 year)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleSubmit} disabled={addMutation.isPending || updateMutation.isPending}>
              {editId ? "Update" : "Save"} Transaction
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
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

      {/* Tax recommendation popup */}
      <AlertDialog open={taxPopup.show} onOpenChange={(v) => setTaxPopup({ ...taxPopup, show: v })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tax Recommendation</AlertDialogTitle>
            <AlertDialogDescription>
              Based on your current projected income and this transaction, you should set aside <span className="font-bold text-foreground">{fmt(taxPopup.amount)}</span> for taxes from this sale.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
