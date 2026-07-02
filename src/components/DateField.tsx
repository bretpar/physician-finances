import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
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
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parsed}
          onSelect={(date) => {
            if (date) {
              onChange(format(date, "yyyy-MM-dd"));
              setOpen(false);
            } else {
              onChange("");
            }
          }}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
