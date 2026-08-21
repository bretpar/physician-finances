import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { closeOtherPickers, createPickerId, registerPicker } from "@/lib/pickerCoordination";


interface DateFieldProps {
  /** ISO date string (yyyy-MM-dd) */
  value: string;
  /** Returns ISO date string (yyyy-MM-dd) or "" when cleared */
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  /** Month to display when the popover opens if `value` is empty (yyyy-MM-dd). */
  defaultMonth?: string;
}

/**
 * Date input that visually matches the standard <Input> (h-10, rounded-md, text-sm)
 * and uses a controlled shadcn Popover + Calendar that auto-closes on selection.
 */
export function DateField({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  disabled,
  id,
  defaultMonth,
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const pickerId = React.useRef(createPickerId("date")).current;
  /**
   * Timestamp of the last selection-driven close. Any reopen request that
   * arrives inside this window (stale Radix pointer/focus callback, registry
   * sync, re-render effect) is ignored so the calendar cannot pop straight
   * back open over the Income Source field.
   */
  const justClosedAt = React.useRef(0);

  // Only one picker may be open at a time.
  React.useEffect(() => registerPicker(pickerId, () => setOpen(false)), [pickerId]);

  function handleOpenChange(next: boolean) {
    if (next) {
      if (Date.now() - justClosedAt.current < 350) return;
      closeOtherPickers(pickerId);
    }
    setOpen(next);
  }

  function close() {
    justClosedAt.current = Date.now();
    // Explicit, state-driven close — never rely on the Calendar, event
    // bubbling or outside-click behavior to dismiss the popover.
    setOpen(false);
    // Deterministic focus return to the trigger, after the popover unmounts.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    });
  }


  const parsed = React.useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  const defaultMonthDate = React.useMemo(() => {
    if (parsed) return parsed;
    if (!defaultMonth) return undefined;
    const d = parse(defaultMonth, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [parsed, defaultMonth]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-start rounded-md border-input bg-background px-3 py-2 text-sm font-normal",
            !parsed && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 opacity-60" />
          {parsed ? format(parsed, "MMM d, yyyy") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[calc(100vw-1.5rem)] p-0"
        align="start"
        side="bottom"
        avoidCollisions
        collisionPadding={12}
      >
        <Calendar
          mode="single"
          selected={parsed}
          defaultMonth={defaultMonthDate}
          onSelect={(date) => {
            // react-day-picker hands back `undefined` when the already-selected
            // day is tapped again — treat that as "confirm & close", never as
            // "clear the field".
            if (date) onChange(format(date, "yyyy-MM-dd"));
            close();
          }}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

