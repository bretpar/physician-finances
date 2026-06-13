import { useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  usePersonalIncomeEntries,
  type PersonalIncomeEntry,
} from "@/hooks/usePersonalIncome";
import {
  useCreateIncomeMatchGroup,
  useIncomeMatchGroups,
  useSuggestedIncomeLinkCandidates,
} from "@/hooks/useIncomeMatching";
import { formatDateShort } from "@/lib/localDate";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  entry: PersonalIncomeEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IncomeLinkModal({ entry, open, onOpenChange }: Props) {
  const { data: allEntries = [] } = usePersonalIncomeEntries();
  const { data: matchGroups } = useIncomeMatchGroups();
  const createLink = useCreateIncomeMatchGroup();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const linkedEntryIds = useMemo(() => {
    const s = new Set<string>();
    if (!matchGroups) return s;
    for (const items of matchGroups.values()) {
      for (const it of items) s.add(it.entry.id);
    }
    return s;
  }, [matchGroups]);

  const suggestions = useSuggestedIncomeLinkCandidates(
    entry,
    allEntries as PersonalIncomeEntry[],
    linkedEntryIds,
  );

  const handleClose = (next: boolean) => {
    if (!next) setSelectedId(null);
    onOpenChange(next);
  };

  const handleLink = () => {
    if (!entry || !selectedId) return;
    createLink.mutate(
      { entryIds: [entry.id, selectedId] },
      {
        onSuccess: () => {
          toast.success("Income linked successfully. This paycheck will only be counted once.");
          setSelectedId(null);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Link to bank transaction
          </DialogTitle>
          <DialogDescription>
            Pick the imported deposit that matches{" "}
            <span className="font-medium text-foreground">
              {entry?.name || "this income entry"}
            </span>
            {entry ? ` (${formatDateShort(entry.income_date)} · ${fmt(Number(entry.gross_amount) || 0)})` : ""}.
            Linking ensures this paycheck is counted once across totals and tax estimates.
          </DialogDescription>
        </DialogHeader>

        {suggestions.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No likely matches found within ±14 days. Try adding the deposit first, or close
            this dialog and use Edit to combine manually.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-8"></th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-left font-medium">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {suggestions.slice(0, 25).map(({ entry: cand, score, reason }) => {
                  const checked = selectedId === cand.id;
                  return (
                    <tr
                      key={cand.id}
                      onClick={() => setSelectedId(cand.id)}
                      className={`cursor-pointer hover:bg-muted/30 ${checked ? "bg-primary/5" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="radio"
                          name="link-candidate"
                          checked={checked}
                          onChange={() => setSelectedId(cand.id)}
                          className="accent-primary"
                        />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {formatDateShort(cand.income_date)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground truncate max-w-[220px]">
                          {cand.name || "(No payor)"}
                        </div>
                        {cand.notes && (
                          <div className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                            {cand.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {fmt(Number(cand.gross_amount) || 0)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">
                        {cand.company || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <Badge variant={score > 70 ? "default" : "secondary"} className="w-fit text-[10px]">
                            {score > 80 ? "High match" : score > 50 ? "Likely" : "Possible"}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">{reason}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={!selectedId || createLink.isPending}
            className="gap-1.5"
          >
            <Link2 className="h-4 w-4" />
            Link transactions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
