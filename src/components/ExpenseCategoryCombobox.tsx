import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { SCHEDULE_C_CATEGORIES } from "@/lib/scheduleC";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCategoryUsage } from "@/hooks/useCategoryUsage";
import { sortCategoriesByUsage, frequentlyUsedCategories } from "@/lib/categoryUsage";

const COMMON_CATEGORIES = [
  "Advertising",
  "Office expense",
  "Supplies",
  "Legal and professional fees",
  "Insurance",
  "Taxes and licenses",
  "Travel",
  "Meals",
  "Utilities",
];

const ALL_CATEGORIES = SCHEDULE_C_CATEGORIES.map((category) => category.label);

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

interface ListProps {
  value: string;
  search: string;
  setSearch: (s: string) => void;
  onSelect: (cat: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  listRef: React.RefObject<HTMLDivElement>;
  highlightIdx: number;
  sections: Array<{ title: string | null; items: string[] }>;
  flat: string[];
  mobile?: boolean;
}

function CategoryOption({
  cat,
  idx,
  highlighted,
  selected,
  onSelect,
  mobile,
}: {
  cat: string;
  idx: number;
  highlighted: boolean;
  selected: boolean;
  onSelect: (c: string) => void;
  mobile?: boolean;
}) {
  return (
    <button
      type="button"
      data-idx={idx}
      onClick={() => onSelect(cat)}
      className={cn(
        "w-full flex items-center gap-2 rounded-md px-2 text-sm transition-colors cursor-pointer text-left",
        mobile ? "min-h-[44px] py-2.5" : "py-1.5",
        highlighted ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      {cat}
    </button>
  );
}

function CategoryList({
  value,
  search,
  setSearch,
  onSelect,
  onKeyDown,
  inputRef,
  listRef,
  highlightIdx,
  sections,
  flat,
  mobile,
}: ListProps) {
  let running = 0;
  return (
    <>
      <div className="p-2 border-b border-border shrink-0" onKeyDown={onKeyDown}>
        <Input
          ref={inputRef}
          placeholder="Search expense categories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn("text-sm", mobile ? "h-11" : "h-8")}
          autoComplete="off"
        />
      </div>
      <div
        className={cn(
          "overflow-y-auto overscroll-contain",
          mobile ? "flex-1 min-h-0" : "max-h-[240px]",
        )}
        style={{ pointerEvents: "auto", WebkitOverflowScrolling: "touch" }}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div ref={listRef} className="p-1 pb-2">
          {flat.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No matching categories
            </p>
          )}
          {sections.map((section, si) => {
            const start = running;
            running += section.items.length;
            if (section.items.length === 0) return null;
            return (
              <div key={section.title ?? `s${si}`}>
                {si > 0 && <div className="my-1 border-t border-border" />}
                {section.title && (
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
                    {section.title}
                  </p>
                )}
                {section.items.map((cat, i) => (
                  <CategoryOption
                    key={`${section.title}-${cat}`}
                    cat={cat}
                    idx={start + i}
                    highlighted={highlightIdx === start + i}
                    selected={value === cat}
                    onSelect={onSelect}
                    mobile={mobile}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Tracks the visual viewport so the mobile sheet stays anchored above the keyboard. */
function useVisualViewport(active: boolean) {
  const [rect, setRect] = useState({ top: 0, height: 0 });
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const update = () => {
      if (vv) setRect({ top: vv.offsetTop, height: vv.height });
      else setRect({ top: 0, height: window.innerHeight });
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [active]);
  return rect;
}

export function ExpenseCategoryCombobox({ value, onValueChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { data: usage } = useCategoryUsage();
  const viewport = useVisualViewport(open && isMobile);

  const orderedAll = useMemo(() => sortCategoriesByUsage(ALL_CATEGORIES, usage), [usage]);
  const frequent = useMemo(() => frequentlyUsedCategories(ALL_CATEGORIES, usage), [usage]);

  const filterCats = useCallback(
    (cats: string[]) => cats.filter((c) => c.toLowerCase().includes(search.toLowerCase())),
    [search],
  );

  const isSearching = search.length > 0;

  const sections = useMemo(() => {
    if (isSearching) {
      // Prefix matches first, then substring matches — usage order within each group.
      const q = search.toLowerCase();
      const matches = orderedAll.filter((c) => c.toLowerCase().includes(q));
      const prefix = matches.filter((c) => c.toLowerCase().startsWith(q));
      const rest = matches.filter((c) => !c.toLowerCase().startsWith(q));
      return [{ title: null as string | null, items: [...prefix, ...rest] }];
    }
    const out: Array<{ title: string | null; items: string[] }> = [];
    if (frequent.length) out.push({ title: "Frequently used", items: frequent });
    const common = filterCats(COMMON_CATEGORIES).filter((c) => !frequent.includes(c));
    if (common.length) out.push({ title: "Common categories", items: common });
    const used = new Set([...frequent, ...common]);
    out.push({ title: "All categories", items: orderedAll.filter((c) => !used.has(c)) });
    return out;
  }, [isSearching, search, orderedAll, frequent, filterCats]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

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

  // Lock background scrolling while the mobile sheet is open.
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  const select = useCallback(
    (cat: string) => {
      onValueChange(cat);
      inputRef.current?.blur();
      setOpen(false);
    },
    [onValueChange],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[highlightIdx]) select(flat[highlightIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Keyboard-driven highlight scrolling only (never force-scroll while browsing).
  useEffect(() => {
    if (!listRef.current || highlightIdx === 0) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const displayValue = value || "Select category…";

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      onClick={isMobile ? () => setOpen((o) => !o) : undefined}
      className={cn("w-full justify-between font-normal text-sm", isMobile ? "h-11" : "h-10")}
    >
      <span className={cn("truncate", !value && "text-muted-foreground")}>{displayValue}</span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  const listProps: ListProps = {
    value,
    search,
    setSearch,
    onSelect: select,
    onKeyDown: handleKeyDown,
    inputRef,
    listRef,
    highlightIdx,
    sections,
    flat,
  };

  if (isMobile) {
    return (
      <>
        {trigger}
        {open &&
          createPortal(
            <div
              className="fixed left-0 z-[70] w-full flex flex-col justify-end"
              style={{ top: viewport.top, height: viewport.height || undefined }}
            >
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => setOpen(false)}
                aria-hidden
              />
              <div
                className="relative flex flex-col min-h-0 max-h-full bg-popover text-popover-foreground rounded-t-xl border-t border-border shadow-lg"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                onTouchMove={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-3 pt-3 pb-1 shrink-0">
                  <p className="text-sm font-medium">Category</p>
                  <button
                    type="button"
                    aria-label="Close"
                    className="h-9 w-9 -mr-2 flex items-center justify-center text-muted-foreground"
                    onClick={() => setOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <CategoryList {...listProps} mobile />
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <CategoryList {...listProps} />
      </PopoverContent>
    </Popover>
  );
}
