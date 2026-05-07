import { useState } from "react";
import { Pencil, Trash2, CalendarRange, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useYtdCatchupEntries, useDeleteYtdCatchup, type YtdCatchupEntry } from "@/hooks/useYtdCatchup";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { YtdCatchupForm } from "./YtdCatchupForm";

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function YtdCatchupCard() {
  const { data: entries } = useYtdCatchupEntries();
  const { data: taxSettings } = useTaxSettings();
  const stateEnabled = !!taxSettings && (taxSettings as any).stateTaxEnabled !== false;
  const del = useDeleteYtdCatchup();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<YtdCatchupEntry | undefined>();

  const startNew = () => { setEditing(undefined); setOpen(true); };
  const startEdit = (e: YtdCatchupEntry) => { setEditing(e); setOpen(true); };

  const list = entries || [];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-primary" />
              YTD Catch-Up
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Year-to-date income from your most recent paystub
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={startNew}>
            <Plus className="h-4 w-4 mr-1" /> Add YTD Catch-Up
          </Button>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No YTD catch-up added. Add one if you started using PaycheckMD partway through the year.</p>
          ) : (
            <div className="space-y-3">
              {list.map((e) => (
                <div key={e.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm truncate">{e.company_name}</p>
                        <Badge variant="secondary" className="text-[10px]">YTD Catch-Up Added</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(e.period_start)} – {fmtDate(e.period_end)}</p>
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                        <div><span className="text-muted-foreground">Gross:</span> <span className="font-medium tabular-nums">{fmt(Number(e.gross_income))}</span></div>
                        <div><span className="text-muted-foreground">Federal:</span> <span className="font-medium tabular-nums">{fmt(Number(e.federal_withholding))}</span></div>
                        {stateEnabled && (
                          <div><span className="text-muted-foreground">State:</span> <span className="font-medium tabular-nums">{fmt(Number(e.state_withholding))}</span></div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(e)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => del.mutate(e.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Catch Up Your Year So Far</DialogTitle>
          </DialogHeader>
          <YtdCatchupForm initial={editing} onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
