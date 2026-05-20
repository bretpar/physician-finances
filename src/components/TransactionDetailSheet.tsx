import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2, Link2, Unlink2, X, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type DetailField = {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
};

export type DetailSection = {
  title: string;
  fields: DetailField[];
};

export type DetailBadge = {
  label: string;
  tone?: "default" | "success" | "warning" | "muted" | "destructive";
};

export type LinkedItem = {
  id: string;
  label: string;
  amount?: number;
  date?: string;
};

export type TransactionDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  header: {
    title: string;
    subtitle?: string;
    date?: string;
    amount?: number;
    amountTone?: "income" | "expense" | "neutral";
    badges?: DetailBadge[];
  };
  sections: DetailSection[];
  linked?: {
    items: LinkedItem[];
    onUnlink?: (id: string) => void;
    onLink?: () => void;
    canLink?: boolean;
  };
  primaryActions?: React.ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  hideEdit?: boolean;
  hideDelete?: boolean;
};

const toneClass = (tone?: DetailBadge["tone"]) => {
  switch (tone) {
    case "success":
      return "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-transparent dark:bg-emerald-900/40 dark:text-emerald-300";
    case "warning":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100 border-transparent dark:bg-amber-900/40 dark:text-amber-200";
    case "muted":
      return "bg-muted text-muted-foreground hover:bg-muted border-transparent";
    case "destructive":
      return "bg-destructive/10 text-destructive hover:bg-destructive/10 border-transparent";
    default:
      return "";
  }
};

const fmtMoney = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
    : "—";

export function TransactionDetailSheet({
  open,
  onOpenChange,
  header,
  sections,
  linked,
  primaryActions,
  onEdit,
  onDelete,
  editLabel = "Edit",
  deleteLabel = "Delete",
  hideEdit,
  hideDelete,
}: TransactionDetailSheetProps) {
  const amountColor =
    header.amountTone === "income"
      ? "text-emerald-600 dark:text-emerald-400"
      : header.amountTone === "expense"
        ? "text-destructive"
        : "text-foreground";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[85%] max-w-[85%] sm:w-full sm:max-w-lg p-0 flex flex-col gap-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {header.date && <span>{header.date}</span>}
                {header.badges?.map((b, i) => (
                  <Badge key={i} variant="outline" className={cn("text-[10px] font-medium", toneClass(b.tone))}>
                    {b.label}
                  </Badge>
                ))}
              </div>
              <SheetTitle className="text-xl mt-1.5 truncate">{header.title}</SheetTitle>
              {header.subtitle && (
                <SheetDescription className="mt-0.5 truncate">{header.subtitle}</SheetDescription>
              )}
            </div>
            {typeof header.amount === "number" && (
              <div className={cn("text-2xl font-semibold tabular-nums whitespace-nowrap", amountColor)}>
                {fmtMoney(header.amount)}
              </div>
            )}
          </div>
        </SheetHeader>

        <Separator />

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {sections
            .filter((s) => s.fields.length > 0)
            .map((section) => (
              <section key={section.title} className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.title}
                </h3>
                <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                  {section.fields.map((f, i) => (
                    <React.Fragment key={i}>
                      <dt className="col-span-1 text-muted-foreground">{f.label}</dt>
                      <dd
                        className={cn(
                          "col-span-2 text-foreground break-words",
                          f.mono && "font-mono tabular-nums",
                        )}
                      >
                        {f.value ?? "—"}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              </section>
            ))}

          {linked && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Linked transactions
                </h3>
                {linked.onLink && linked.canLink !== false && (
                  <Button variant="ghost" size="sm" onClick={linked.onLink} className="h-7 gap-1 text-xs">
                    <Link2 className="h-3.5 w-3.5" />
                    Link transactions
                  </Button>
                )}
              </div>
              {linked.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No linked transactions.</p>
              ) : (
                <ul className="space-y-1.5">
                  {linked.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.label}</div>
                        {(item.date || typeof item.amount === "number") && (
                          <div className="text-xs text-muted-foreground">
                            {item.date}
                            {item.date && typeof item.amount === "number" && " · "}
                            {typeof item.amount === "number" && fmtMoney(item.amount)}
                          </div>
                        )}
                      </div>
                      {linked.onUnlink && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() => linked.onUnlink?.(item.id)}
                          aria-label="Unlink"
                        >
                          <Unlink2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {primaryActions && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </h3>
              <div className="flex flex-col gap-2">{primaryActions}</div>
            </section>
          )}
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2 px-6 py-4 bg-background">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="gap-1.5">
            <X className="h-4 w-4" />
            Close
          </Button>
          <div className="flex items-center gap-2">
            {!hideDelete && onDelete && (
              <Button variant="outline" size="sm" onClick={onDelete} className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
                {deleteLabel}
              </Button>
            )}
            {!hideEdit && onEdit && (
              <Button size="sm" onClick={onEdit} className="gap-1.5">
                <Pencil className="h-4 w-4" />
                {editLabel}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default TransactionDetailSheet;
