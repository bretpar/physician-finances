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
import { useInsightNotifications } from "@/hooks/useInsightNotifications";
import { NotificationsList } from "@/components/insights/InsightsPanel";

/**
 * Notification center trigger. The red badge means "something new" only:
 * opening the sheet marks everything currently listed as viewed, which clears
 * the badge while keeping the items available in the list.
 */
export default function InsightsBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, isReady, markRead } = useInsightNotifications();

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) markRead();
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          data-testid="insights-bell"
          data-unread={isReady ? unreadCount : 0}
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} new` : "Notifications"}
          className="relative -mr-1 flex h-11 w-11 items-center justify-center rounded-md text-foreground"
        >
          <Bell className="h-5 w-5" />
          {isReady && unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>
            Recommendations, deadlines and insights based on your current information.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <NotificationsList
            notifications={notifications}
            isReady={isReady}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
