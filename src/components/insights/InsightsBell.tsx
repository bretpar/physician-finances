import { useState } from "react";
import { Bell } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useInsights } from "@/hooks/useInsights";
import { InsightsList } from "@/components/insights/InsightsPanel";

/** Notification bell for the top navigation. Opens the Insights list. */
export default function InsightsBell() {
  const [open, setOpen] = useState(false);
  const { insights, isReady } = useInsights();
  const actionable = insights.filter((i) => i.severity === "critical" || i.severity === "action").length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={actionable > 0 ? `Insights, ${actionable} need attention` : "Insights"}
          className="relative -mr-1 flex h-11 w-11 items-center justify-center rounded-md text-foreground"
        >
          <Bell className="h-5 w-5" />
          {isReady && actionable > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {actionable}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle>Insights</SheetTitle>
          <SheetDescription>Timely items based on your current information.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <InsightsList onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
