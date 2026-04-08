import { useState, useMemo } from "react";
import { mockTransactions, categories, accounts, entities, type Transaction } from "@/lib/mockData";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Search, SlidersHorizontal } from "lucide-react";

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>(mockTransactions);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterDeductible, setFilterDeductible] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editMemo, setEditMemo] = useState("");

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (search && !t.merchant.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterCategory !== "all" && t.category !== filterCategory) return false;
      if (filterAccount !== "all" && t.account !== filterAccount) return false;
      if (filterEntity !== "all" && t.entity !== filterEntity) return false;
      if (filterDeductible === "yes" && !t.deductible) return false;
      if (filterDeductible === "no" && t.deductible) return false;
      return true;
    });
  }, [transactions, search, filterCategory, filterAccount, filterEntity, filterDeductible]);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  function openEdit(tx: Transaction) {
    setEditTx(tx);
    setEditCategory(tx.category);
    setEditMemo(tx.memo);
  }

  function saveEdit() {
    if (!editTx) return;
    setTransactions((prev) =>
      prev.map((t) => (t.id === editTx.id ? { ...t, category: editCategory, memo: editMemo } : t))
    );
    setEditTx(null);
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Search & filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transactions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
        </Button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 glass-card rounded-xl p-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Account</Label>
            <Select value={filterAccount} onValueChange={setFilterAccount}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Entity</Label>
            <Select value={filterEntity} onValueChange={setFilterEntity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Deductible</Label>
            <Select value={filterDeductible} onValueChange={setFilterDeductible}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="yes">Deductible</SelectItem>
                <SelectItem value="no">Personal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Transaction list */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-card-foreground">
            {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
          </h3>
        </div>
        <div className="divide-y divide-border">
          {filtered.map((tx) => (
            <button
              key={tx.id}
              onClick={() => openEdit(tx)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-card-foreground truncate">{tx.merchant}</p>
                <p className="text-xs text-muted-foreground">{tx.date} · {tx.account} · {tx.entity}</p>
                {tx.memo && <p className="text-xs text-muted-foreground italic mt-0.5">{tx.memo}</p>}
              </div>
              <div className="flex items-center gap-3 ml-4 shrink-0">
                <Badge variant={tx.deductible ? "default" : "secondary"} className="text-xs hidden sm:inline-flex">
                  {tx.category}
                </Badge>
                <span className={`text-sm font-semibold tabular-nums ${tx.amount >= 0 ? "text-success" : "text-destructive"}`}>
                  {fmt(tx.amount)}
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-5 py-12 text-center text-muted-foreground text-sm">No transactions found.</div>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editTx} onOpenChange={(open) => !open && setEditTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Transaction</DialogTitle>
          </DialogHeader>
          {editTx && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground">{editTx.merchant}</p>
                <p className="text-xs text-muted-foreground">{editTx.date} · {fmt(editTx.amount)}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                <Textarea value={editMemo} onChange={(e) => setEditMemo(e.target.value)} rows={3} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditTx(null)}>Cancel</Button>
                <Button onClick={saveEdit}>Save</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
