import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Download, Pencil, Car } from "lucide-react";
import { useMileageEntries, useMileageYTD, useAddMileageEntry, useUpdateMileageEntry, useDeleteMileageEntry, IRS_MILEAGE_RATE } from "@/hooks/useMileage";
import { useCompanies } from "@/contexts/CompanyContext";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function Mileage() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const { companies } = useCompanies();
  const { data: monthEntries = [], isLoading } = useMileageEntries(selectedMonth, selectedYear);
  const { data: ytdEntries = [] } = useMileageYTD(selectedYear);
  const addMutation = useAddMileageEntry();
  const updateMutation = useUpdateMileageEntry();
  const deleteMutation = useDeleteMileageEntry();

  // Add dialog
  const [showAdd, setShowAdd] = useState(false);
  const [addCompany, setAddCompany] = useState("");
  const [addMiles, setAddMiles] = useState("");

  // Edit dialog
  const [editId, setEditId] = useState<string | null>(null);
  const [editCompany, setEditCompany] = useState("");
  const [editMiles, setEditMiles] = useState("");

  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  // Summaries
  const monthTotalMiles = useMemo(() => monthEntries.reduce((s, e) => s + Number(e.miles), 0), [monthEntries]);
  const monthDeduction = monthTotalMiles * IRS_MILEAGE_RATE;

  const ytdTotalMiles = useMemo(() => ytdEntries.reduce((s, e) => s + Number(e.miles), 0), [ytdEntries]);
  const ytdDeduction = ytdTotalMiles * IRS_MILEAGE_RATE;

  const byCompany = useMemo(() => {
    const map: Record<string, number> = {};
    monthEntries.forEach((e) => {
      map[e.company_name] = (map[e.company_name] || 0) + Number(e.miles);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [monthEntries]);

  // Unique company names from past entries for autocomplete
  const pastCompanies = useMemo(() => {
    const set = new Set(ytdEntries.map((e) => e.company_name));
    companies.forEach((c) => set.add(c.name));
    return Array.from(set).filter(Boolean).sort();
  }, [ytdEntries, companies]);

  function handleAdd() {
    const miles = parseFloat(addMiles);
    if (!addCompany.trim() || isNaN(miles) || miles < 0) return;
    addMutation.mutate({ month: selectedMonth, year: selectedYear, company_name: addCompany.trim(), miles });
    setShowAdd(false);
    setAddCompany("");
    setAddMiles("");
  }

  function openEdit(entry: typeof monthEntries[0]) {
    setEditId(entry.id);
    setEditCompany(entry.company_name);
    setEditMiles(String(entry.miles));
  }

  function handleEdit() {
    if (!editId) return;
    const miles = parseFloat(editMiles);
    if (!editCompany.trim() || isNaN(miles) || miles < 0) return;
    updateMutation.mutate({ id: editId, company_name: editCompany.trim(), miles });
    setEditId(null);
  }

  function handleDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(deleteId);
    setDeleteId(null);
  }

  function exportCSV() {
    const headers = ["Month", "Year", "Company", "Miles", "Deduction"];
    const rows = ytdEntries.map((e) => [MONTHS[e.month - 1], e.year, e.company_name, e.miles, (Number(e.miles) * IRS_MILEAGE_RATE).toFixed(2)]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mileage_${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Monthly Miles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-card-foreground">{monthTotalMiles.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{MONTHS[selectedMonth - 1]} {selectedYear}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Monthly Deduction</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-success">{fmt(monthDeduction)}</p>
            <p className="text-xs text-muted-foreground">@ ${IRS_MILEAGE_RATE}/mile</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">YTD Miles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-card-foreground">{ytdTotalMiles.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{selectedYear}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">YTD Deduction</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-success">{fmt(ytdDeduction)}</p>
            <p className="text-xs text-muted-foreground">Business mileage deduction</p>
          </CardContent>
        </Card>
      </div>

      {/* Month/Year Selector + Actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="flex gap-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Month</Label>
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Year</Label>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" onClick={exportCSV} className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={() => setShowAdd(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Entry
          </Button>
        </div>
      </div>

      {/* By Company Breakdown */}
      {byCompany.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Miles by Company — {MONTHS[selectedMonth - 1]}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byCompany.map(([name, miles]) => (
                <div key={name} className="flex justify-between items-center text-sm">
                  <span className="text-card-foreground">{name}</span>
                  <div className="text-right">
                    <span className="font-semibold tabular-nums">{miles.toLocaleString()} mi</span>
                    <span className="text-muted-foreground ml-3 text-xs">{fmt(miles * IRS_MILEAGE_RATE)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entries Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Car className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-card-foreground">
            {monthEntries.length} entr{monthEntries.length !== 1 ? "ies" : "y"} — {MONTHS[selectedMonth - 1]} {selectedYear}
          </h3>
        </div>

        <div className="hidden sm:grid sm:grid-cols-[1fr_120px_120px_80px] gap-2 px-5 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
          <span>Company</span>
          <span className="text-right">Miles</span>
          <span className="text-right">Deduction</span>
          <span></span>
        </div>

        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-muted-foreground text-sm">Loading…</div>
          ) : monthEntries.length === 0 ? (
            <div className="px-5 py-12 text-center text-muted-foreground text-sm">No mileage entries for this month.</div>
          ) : (
            monthEntries.map((entry) => (
              <div key={entry.id} className="flex flex-col sm:grid sm:grid-cols-[1fr_120px_120px_80px] gap-1 sm:gap-2 px-5 py-3 hover:bg-muted/50 transition-colors items-center">
                <span className="text-sm font-medium text-card-foreground">{entry.company_name}</span>
                <span className="text-sm tabular-nums text-right">{Number(entry.miles).toLocaleString()}</span>
                <span className="text-sm tabular-nums text-right text-success">{fmt(Number(entry.miles) * IRS_MILEAGE_RATE)}</span>
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(entry)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(entry.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Mileage Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
              {pastCompanies.length > 0 ? (
                <Select value={addCompany} onValueChange={setAddCompany}>
                  <SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger>
                  <SelectContent>
                    {pastCompanies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={addCompany} onChange={(e) => setAddCompany(e.target.value)} placeholder="Company name" />
              )}
              {pastCompanies.length > 0 && (
                <Input className="mt-2" value={addCompany} onChange={(e) => setAddCompany(e.target.value)} placeholder="Or type a new company name" />
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Miles Driven</Label>
              <Input type="number" min="0" step="0.1" value={addMiles} onChange={(e) => setAddMiles(e.target.value)} placeholder="0" />
            </div>
            <p className="text-xs text-muted-foreground">
              For {MONTHS[selectedMonth - 1]} {selectedYear} • Deduction: {fmt((parseFloat(addMiles) || 0) * IRS_MILEAGE_RATE)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!addCompany.trim() || !(parseFloat(addMiles) >= 0)}>Add Entry</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editId} onOpenChange={(open) => !open && setEditId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Mileage Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
              <Input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Miles Driven</Label>
              <Input type="number" min="0" step="0.1" value={editMiles} onChange={(e) => setEditMiles(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
              <Button onClick={handleEdit}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Mileage Entry</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this mileage entry.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
