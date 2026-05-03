import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useIncomeSources,
  useCreateIncomeSource,
  SOURCE_KIND_OPTIONS,
  SOURCE_KIND_LABEL,
  type IncomeSource,
  type SourceKind,
} from "@/hooks/useIncomeSources";

export type SourceSelection =
  | { kind: "linked"; source: IncomeSource }
  | { kind: "other"; name: string; saveAsNew: boolean; newKind: SourceKind | null }
  | { kind: "empty" };

interface Props {
  /** Linked source id, when one is selected */
  sourceId: string | null;
  /** Free-text name (for "Other" or legacy unlinked rows) */
  otherName: string;
  /** Selected new-source kind when "Save as new" is checked */
  saveAsNew: boolean;
  newSourceKind: SourceKind | null;
  onChange: (next: {
    sourceId: string | null;
    otherName: string;
    saveAsNew: boolean;
    newSourceKind: SourceKind | null;
    /** The full source object when one is linked, for callers that need source_kind */
    linkedSource: IncomeSource | null;
  }) => void;
  /** Optional placeholder/error indicator */
  required?: boolean;
  invalid?: boolean;
}

const OTHER_VALUE = "__other__";

export function SourceEmployerCombobox({
  sourceId,
  otherName,
  saveAsNew,
  newSourceKind,
  onChange,
  required,
  invalid,
}: Props) {
  const { data: sources = [] } = useIncomeSources();
  const createMutation = useCreateIncomeSource();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [otherMode, setOtherMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  const isOther = otherMode || (sourceId === null && otherName.length > 0);

  // Keep otherMode in sync if a linked source becomes set externally
  useEffect(() => {
    if (sourceId) setOtherMode(false);
  }, [sourceId]);

  const linkedSource = useMemo(
    () => sources.find((s) => s.id === sourceId) || null,
    [sources, sourceId],
  );

  const { personalSources, businessSources } = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = sources.filter((s) =>
      !q || s.name.toLowerCase().includes(q) || (s.nickname || "").toLowerCase().includes(q),
    );
    return {
      personalSources: filtered.filter((s) => s.source_kind === "w2_employer" || s.source_kind === "personal"),
      businessSources: filtered.filter((s) => s.source_kind !== "w2_employer" && s.source_kind !== "personal"),
    };
  }, [sources, search]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setSearch("");
  }, [open]);

  function selectSource(s: IncomeSource) {
    onChange({
      sourceId: s.id,
      otherName: "",
      saveAsNew: false,
      newSourceKind: null,
      linkedSource: s,
    });
    setOpen(false);
  }

  function selectOther() {
    onChange({
      sourceId: null,
      otherName: otherName || (search.trim() || ""),
      saveAsNew: false,
      newSourceKind: null,
      linkedSource: null,
    });
    setOpen(false);
  }

  function setOtherName(name: string) {
    onChange({ sourceId: null, otherName: name, saveAsNew, newSourceKind, linkedSource: null });
  }

  function setSaveAsNew(checked: boolean) {
    onChange({
      sourceId: null,
      otherName,
      saveAsNew: checked,
      newSourceKind: checked ? newSourceKind : null,
      linkedSource: null,
    });
  }

  function setNewKind(kind: SourceKind) {
    onChange({ sourceId: null, otherName, saveAsNew, newSourceKind: kind, linkedSource: null });
  }

  const displayLabel = linkedSource
    ? linkedSource.nickname || linkedSource.name
    : isOther
      ? `Other: ${otherName}`
      : "Select source / employer…";

  const triggerInvalid = invalid && !linkedSource && !otherName;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal h-10 text-sm",
              triggerInvalid && "border-destructive",
            )}
          >
            <span className={cn("truncate", !linkedSource && !isOther && "text-muted-foreground")}>
              {displayLabel}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b border-border">
            <Input
              ref={inputRef}
              placeholder="Search sources / employers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto overscroll-contain p-1">
            {personalSources.length === 0 && businessSources.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No matching sources
              </p>
            )}
            {personalSources.length > 0 && (
              <>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
                  Personal / Employer Income
                </p>
                {personalSources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectSource(s)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer hover:bg-muted/60",
                      sourceId === s.id && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", sourceId === s.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 text-left truncate">{s.nickname || s.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {SOURCE_KIND_LABEL[s.source_kind] || s.source_kind}
                    </span>
                  </button>
                ))}
              </>
            )}
            {businessSources.length > 0 && (
              <>
                {personalSources.length > 0 && <div className="my-1 border-t border-border" />}
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
                  Business Income Sources
                </p>
                {businessSources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectSource(s)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer hover:bg-muted/60",
                      sourceId === s.id && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", sourceId === s.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 text-left truncate">{s.nickname || s.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {SOURCE_KIND_LABEL[s.source_kind] || s.source_kind}
                    </span>
                  </button>
                ))}
              </>
            )}
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              onClick={selectOther}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer hover:bg-muted/60",
                isOther && "bg-accent text-accent-foreground",
              )}
            >
              <Plus className="h-3.5 w-3.5 shrink-0 opacity-70" />
              Other (enter manually)
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* "Other" follow-up fields */}
      {isOther && (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Other Source / Employer Name {required && <span className="text-destructive">*</span>}
            </Label>
            <Input
              placeholder="e.g. Acme Hospital"
              value={otherName}
              onChange={(e) => setOtherName(e.target.value)}
              className={cn(invalid && !otherName && "border-destructive")}
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="save-as-source"
              checked={saveAsNew}
              onCheckedChange={(v) => setSaveAsNew(v === true)}
            />
            <Label htmlFor="save-as-source" className="text-xs text-foreground cursor-pointer leading-tight">
              Save this as a new source in Settings
            </Label>
          </div>
          {saveAsNew && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Source type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={newSourceKind || ""}
                onValueChange={(v) => setNewKind(v as SourceKind)}
              >
                <SelectTrigger className={cn("h-9", invalid && !newSourceKind && "border-destructive")}>
                  <SelectValue placeholder="Choose type…" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Helper used by callers after save: if the user opted to "Save as new source",
 * persist the new company and return its id so the caller can re-link the entry.
 */
export async function persistNewSourceIfRequested(
  selection: { otherName: string; saveAsNew: boolean; newSourceKind: SourceKind | null },
  createSource: ReturnType<typeof useCreateIncomeSource>["mutateAsync"],
): Promise<string | null> {
  if (!selection.saveAsNew || !selection.otherName.trim() || !selection.newSourceKind) return null;
  const created = await createSource({
    name: selection.otherName.trim(),
    source_kind: selection.newSourceKind,
  });
  return created?.id ?? null;
}
