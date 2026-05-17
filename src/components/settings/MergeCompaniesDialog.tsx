import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Merge } from "lucide-react";
import { useCompanies, type Company } from "@/contexts/CompanyContext";
import {
  countLinkedRows,
  formatMergeSummary,
  type MergeSummaryCounts,
} from "@/lib/mergeCompanies";

export default function MergeCompaniesDialog() {
  const { companies, mergeCompanies } = useCompanies();
  const [open, setOpen] = useState(false);
  const [primaryId, setPrimaryId] = useState<string>("");
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<MergeSummaryCounts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [merging, setMerging] = useState(false);

  // Reset when dialog closes.
  useEffect(() => {
    if (!open) {
      setPrimaryId("");
      setDuplicateIds(new Set());
      setCounts(null);
    }
  }, [open]);

  const primary = useMemo(
    () => companies.find((c) => c.id === primaryId) || null,
    [companies, primaryId],
  );

  // When user changes the primary, suggest duplicates that share the
  // normalized name (case/space-insensitive) but auto-select none by default.
  const suggestedDuplicates: Company[] = useMemo(() => {
    if (!primary) return [];
    const norm = (s: string) =>
      (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    const pn = norm(primary.name);
    return companies.filter((c) => c.id !== primary.id && norm(c.name) === pn);
  }, [companies, primary]);

  // Refresh counts whenever the selection changes.
  useEffect(() => {
    let cancelled = false;
    const dupes = Array.from(duplicateIds);
    if (dupes.length === 0) {
      setCounts(null);
      return;
    }
    setLoadingCounts(true);
    countLinkedRows(dupes).then((c) => {
      if (!cancelled) {
        setCounts(c);
        setLoadingCounts(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [duplicateIds]);

  const toggleDuplicate = (id: string) => {
    setDuplicateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMerge = async () => {
    if (!primary || duplicateIds.size === 0) return;
    setMerging(true);
    try {
      await mergeCompanies(primary.id, Array.from(duplicateIds));
      setOpen(false);
    } finally {
      setMerging(false);
    }
  };

  const summary =
    primary && duplicateIds.size > 0
      ? formatMergeSummary(counts ?? {}, primary.name, duplicateIds.size)
      : null;

  const selectableDuplicates = companies.filter((c) => c.id !== primaryId);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => setOpen(true)}
      >
        <Merge className="h-4 w-4" /> Merge duplicates
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Merge duplicate companies</DialogTitle>
            <DialogDescription>
              Pick the company to keep, then check any duplicate records to merge into
              it. Linked income, transactions, and projections will be repointed; the
              duplicates will be archived.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Primary company to keep</Label>
              <Select value={primaryId} onValueChange={setPrimaryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a company…" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || "(unnamed)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {primary && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Duplicates to merge into {primary.name}
                </Label>
                {suggestedDuplicates.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {suggestedDuplicates.length} likely duplicate
                    {suggestedDuplicates.length === 1 ? "" : "s"} found by name.
                  </p>
                )}
                <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {selectableDuplicates.length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground">
                      No other companies to merge.
                    </p>
                  )}
                  {selectableDuplicates.map((c) => {
                    const checked = duplicateIds.has(c.id);
                    const isSuggested = suggestedDuplicates.some((s) => s.id === c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleDuplicate(c.id)}
                        />
                        <span className="flex-1 truncate text-sm">
                          {c.name || "(unnamed)"}{" "}
                          <span className="text-xs text-muted-foreground">
                            · {c.companyType}
                          </span>
                        </span>
                        {isSuggested && (
                          <span className="text-[10px] uppercase tracking-wide text-primary">
                            match
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {summary && (
              <div className="rounded-md bg-muted/40 p-3 text-sm text-foreground">
                {loadingCounts ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Counting linked records…
                  </span>
                ) : (
                  summary
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={merging}>
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!primary || duplicateIds.size === 0 || merging || loadingCounts}
            >
              {merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Merge {duplicateIds.size > 0 ? `(${duplicateIds.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
