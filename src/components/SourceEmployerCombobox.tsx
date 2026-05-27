import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  const { data: sources = [], refetch } = useIncomeSources();
  const qc = useQueryClient();
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
    const q = search.trim().toLowerCase();
    // Defensive dedupe by id in case the hook ever yields duplicates.
    const byId = new Map<string, IncomeSource>();
    for (const s of sources) if (s && s.id && !byId.has(s.id)) byId.set(s.id, s);
    const unique = Array.from(byId.values());
    // Require a usable label (name OR nickname after trim) so empty rows can never
    // break rendering of valid companies.
    const named = unique.filter((s) => {
      const n = (s.name || "").trim();
      const nick = (s.nickname || "").trim();
      return n.length > 0 || nick.length > 0;
    });
    const filtered = named.filter((s) => {
      if (!q) return true;
      const n = (s.name || "").toLowerCase();
      const nick = (s.nickname || "").toLowerCase();
      return n.includes(q) || nick.includes(q);
    });
    // Bucketing: treat w2_employer/personal as Personal; anything else (incl.
    // unknown/missing source_kind) as Business — never drop a named row.
    const personal = filtered.filter((s) => s.source_kind === "w2_employer" || s.source_kind === "personal");
    const business = filtered.filter((s) => s.source_kind !== "w2_employer" && s.source_kind !== "personal");
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[paycheck-employer-dropdown]", {
        fetched_count: sources.length,
        unique_count: unique.length,
        named_count: named.length,
        filtered_count: filtered.length,
        personal_count: personal.length,
        business_count: business.length,
        search: q,
      });
    }
    return { personalSources: personal, businessSources: business };
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
    setOtherMode(true);
    onChange({
      sourceId: null,
      otherName: otherName || search.trim() || "",
      saveAsNew: false,
      newSourceKind: null,
      linkedSource: null,
    });
    setOpen(false);
    setTimeout(() => otherInputRef.current?.focus(), 50);
  }

  function backToDropdown() {
    setOtherMode(false);
    onChange({
      sourceId: null,
      otherName: "",
      saveAsNew: false,
      newSourceKind: null,
      linkedSource: null,
    });
    setOpen(true);
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
    ? linkedSource.name || linkedSource.nickname || "Unnamed source"
    : isOther
      ? `Other: ${otherName}`
      : "Select source / employer…";
  const displaySubLabel = linkedSource && linkedSource.nickname && linkedSource.nickname !== linkedSource.name
    ? linkedSource.nickname
    : "";

  const triggerInvalid = invalid && !linkedSource && !otherName;

  if (isOther) {
    return (
      <div className="space-y-2" data-testid="paycheck-employer-other-mode">
        <Input
          ref={otherInputRef}
          data-testid="paycheck-employer-input"
          autoFocus
          placeholder="Enter employer or income source"
          value={otherName}
          onChange={(e) => setOtherName(e.target.value)}
          className={cn("h-10", invalid && !otherName && "border-destructive")}
        />
        <div className="flex items-start gap-2">
          <Checkbox
            id="save-as-source"
            checked={saveAsNew}
            onCheckedChange={(v) => setSaveAsNew(v === true)}
          />
          <Label htmlFor="save-as-source" className="text-xs text-foreground cursor-pointer leading-tight">
            Save this employer/source for future use
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
        <button
          type="button"
          onClick={backToDropdown}
          className="text-xs text-primary hover:underline"
        >
          Choose saved source instead
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            data-testid="paycheck-employer-trigger"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal h-10 text-sm",
              triggerInvalid && "border-destructive",
            )}
          >
            <span className={cn("truncate flex-1 text-left", !linkedSource && !isOther && "text-muted-foreground")}>
              <span className="truncate">{displayLabel}</span>
              {displaySubLabel && (
                <span className="ml-1.5 text-xs text-muted-foreground truncate">· {displaySubLabel}</span>
              )}
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
              data-testid="paycheck-employer-search-input"
              data-testid-alt="paycheck-employer-search"
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
                    data-testid={`paycheck-employer-option-${s.id}`}
                    data-employer-name={s.name || s.nickname || ""}
                    onClick={() => selectSource(s)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer hover:bg-muted/60",
                      sourceId === s.id && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", sourceId === s.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 min-w-0 text-left">
                      <span className="block truncate">{s.name || s.nickname || "Unnamed source"}</span>
                      {s.nickname && s.nickname !== s.name && (
                        <span className="block truncate text-[11px] text-muted-foreground">{s.nickname}</span>
                      )}
                    </span>
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
                    data-testid={`paycheck-employer-option-${s.id}`}
                    data-employer-name={s.name || s.nickname || ""}
                    onClick={() => selectSource(s)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer hover:bg-muted/60",
                      sourceId === s.id && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", sourceId === s.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 min-w-0 text-left">
                      <span className="block truncate">{s.name || s.nickname || "Unnamed source"}</span>
                      {s.nickname && s.nickname !== s.name && (
                        <span className="block truncate text-[11px] text-muted-foreground">{s.nickname}</span>
                      )}
                    </span>
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
              data-testid="paycheck-employer-other-button"
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
  // Hard guard: do nothing unless the user explicitly opted-in via the
  // "Save this employer/source for future use" checkbox AND chose a type.
  if (!selection.saveAsNew) return null;
  if (!selection.otherName.trim()) return null;
  if (!selection.newSourceKind) return null;
  const created = await createSource({
    name: selection.otherName.trim(),
    source_kind: selection.newSourceKind,
  });
  return created?.id ?? null;
}
