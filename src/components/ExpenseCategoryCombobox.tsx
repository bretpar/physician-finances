import { useState, useRef, useEffect, useCallback } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

const COMMON_CATEGORIES = [
  "Advertising",
  "Office expense",
  "Supplies",
  "Legal and professional services",
  "Insurance",
  "Taxes and licenses",
  "Travel",
  "Meals",
  "Utilities",
];

const ALL_CATEGORIES = [
  "Advertising",
  "Car and truck expenses",
  "Commissions and fees",
  "Contract labor",
  "Depletion",
  "Depreciation / Section 179",
  "Employee benefit programs",
  "Insurance",
  "Interest - mortgage",
  "Interest - other",
  "Legal and professional services",
  "Meals",
  "Office expense",
  "Other expenses",
  "Pension and profit-sharing plans",
  "Rent or lease - other business property",
  "Rent or lease - vehicles, machinery, equipment",
  "Repairs and maintenance",
  "Supplies",
  "Taxes and licenses",
  "Travel",
  "Utilities",
  "Wages",
];

export const EXPENSE_CATEGORIES = ALL_CATEGORIES;

/** Map legacy saved categories to current Schedule C labels */
export function mapLegacyCategory(cat: string): string {
  const map: Record<string, string> = {
    "Professional Fees": "Legal and professional services",
    "Software / Subscriptions": "Office expense",
    "Medical Equipment": "Supplies",
    "CME / Education": "Other expenses",
    "Vehicle / Mileage": "Car and truck expenses",
  };
  return map[cat] || cat;
}

interface Props {
  value: string;
  onValueChange: (value: string) => void;
}

export function ExpenseCategoryCombobox({ value, onValueChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filterCats = useCallback(
    (cats: string[]) =>
      cats.filter((c) => c.toLowerCase().includes(search.toLowerCase())),
    [search]
  );

  const isSearching = search.length > 0;

  const filteredCommon = filterCats(COMMON_CATEGORIES);
  // When not searching: show "All categories" excluding common ones to avoid dupes
  // When searching: show flat filtered results from all categories
  const filteredAll = isSearching
    ? filterCats(ALL_CATEGORIES)
    : filterCats(ALL_CATEGORIES.filter((c) => !COMMON_CATEGORIES.includes(c)));
  const allFiltered = isSearching ? filteredAll : [...filteredCommon, ...filteredAll];

  useEffect(() => {
    setHighlightIdx(0);
  }, [search]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setSearch("");
    }
  }, [open]);

  function select(cat: string) {
    onValueChange(cat);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, allFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (allFiltered[highlightIdx]) select(allFiltered[highlightIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const displayValue = value || "Select category…";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-10 text-sm"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {displayValue}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="p-2 border-b border-border" onKeyDown={handleKeyDown}>
          <Input
            ref={inputRef}
            placeholder="Search expense categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <ScrollArea className="max-h-[220px]">
          <div ref={listRef} className="p-1">
            {allFiltered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No matching categories
              </p>
            )}
            {isSearching ? (
              /* Flat filtered list when searching */
              filteredAll.map((cat, i) => (
                <button
                  key={cat}
                  data-idx={i}
                  onClick={() => select(cat)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer",
                    highlightIdx === i ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", value === cat ? "opacity-100" : "opacity-0")} />
                  {cat}
                </button>
              ))
            ) : (
              /* Sectioned view: Common + All categories */
              <>
                {filteredCommon.length > 0 && (
                  <>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
                      Common categories
                    </p>
                    {filteredCommon.map((cat, i) => (
                      <button
                        key={cat}
                        data-idx={i}
                        onClick={() => select(cat)}
                        className={cn(
                          "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer",
                          highlightIdx === i ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
                        )}
                      >
                        <Check className={cn("h-3.5 w-3.5 shrink-0", value === cat ? "opacity-100" : "opacity-0")} />
                        {cat}
                      </button>
                    ))}
                  </>
                )}
                {filteredAll.length > 0 && (
                  <>
                    {filteredCommon.length > 0 && (
                      <div className="my-1 border-t border-border" />
                    )}
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
                      All categories
                    </p>
                    {filteredAll.map((cat, j) => {
                      const idx = filteredCommon.length + j;
                      return (
                        <button
                          key={cat}
                          data-idx={idx}
                          onClick={() => select(cat)}
                          className={cn(
                            "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer",
                            highlightIdx === idx ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
                          )}
                        >
                          <Check className={cn("h-3.5 w-3.5 shrink-0", value === cat ? "opacity-100" : "opacity-0")} />
                          {cat}
                        </button>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
