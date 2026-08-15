import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Info, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

const TooltipProvider = TooltipPrimitive.Provider;

// ---------------------------------------------------------------------------
// Global "only one tooltip open at a time" coordinator.
// Every controlled Tooltip subscribes; when one opens it broadcasts its id and
// all others close. Kept purely at the UI layer — no business logic changes.
// ---------------------------------------------------------------------------
type Listener = (openId: string | null) => void;
const openListeners = new Set<Listener>();
let currentOpenId: string | null = null;

function broadcastOpen(id: string | null) {
  currentOpenId = id;
  openListeners.forEach((l) => l(id));
}

type TooltipCtx = {
  open: boolean;
  setOpen: (o: boolean) => void;
  isMobile: boolean;
  id: string;
};
const TooltipContext = React.createContext<TooltipCtx | null>(null);

type TooltipProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;

const Tooltip = ({ open: openProp, defaultOpen, onOpenChange, children, ...props }: TooltipProps) => {
  const isMobile = useIsMobile();
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(!!defaultOpen);
  const open = isControlled ? !!openProp : internalOpen;
  const idRef = React.useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  );

  const setOpen = React.useCallback(
    (o: boolean) => {
      if (!isControlled) setInternalOpen(o);
      onOpenChange?.(o);
      if (o) broadcastOpen(idRef.current);
      else if (currentOpenId === idRef.current) broadcastOpen(null);
    },
    [isControlled, onOpenChange],
  );

  // Close when a different tooltip opens.
  React.useEffect(() => {
    const listener: Listener = (openId) => {
      if (openId !== idRef.current && open) {
        if (!isControlled) setInternalOpen(false);
        onOpenChange?.(false);
      }
    };
    openListeners.add(listener);
    return () => {
      openListeners.delete(listener);
      if (currentOpenId === idRef.current) currentOpenId = null;
    };
  }, [open, isControlled, onOpenChange]);

  const ctx = React.useMemo<TooltipCtx>(
    () => ({ open, setOpen, isMobile, id: idRef.current }),
    [open, setOpen, isMobile],
  );

  return (
    <TooltipContext.Provider value={ctx}>
      <TooltipPrimitive.Root
        open={open}
        onOpenChange={setOpen}
        // On mobile, remove hover delay entirely; tap toggles.
        delayDuration={isMobile ? 0 : props.delayDuration ?? 150}
        disableHoverableContent={isMobile ? true : props.disableHoverableContent}
        {...props}
      >
        {children}
      </TooltipPrimitive.Root>
    </TooltipContext.Provider>
  );
};

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onClick, onPointerDown, onContextMenu, onTouchStart, className, ...props }, ref) => {
  const ctx = React.useContext(TooltipContext);
  const touchRef = React.useRef(false);
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      className={cn(
        // Never let mobile browsers treat the trigger as selectable text and
        // never surface the iOS long-press callout / copy bubble.
        "select-none touch-manipulation [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] [-webkit-user-select:none]",
        className,
      )}
      onPointerDown={(e) => {
        // Toggle on tap (touch/pen) so mobile users can reveal/dismiss tooltips
        // via a single tap — never long-press or hover.
        const isTouch =
          e.pointerType === "touch" || e.pointerType === "pen" || !!ctx?.isMobile;
        touchRef.current = isTouch;
        if (ctx && isTouch) {
          e.preventDefault();
          // Don't let an underlying row/button/link react to the same tap.
          e.stopPropagation();
          ctx.setOpen(!ctx.open);
        }
        onPointerDown?.(e);
      }}
      onTouchStart={(e) => {
        // Guard against parent row handlers bound to touch events.
        e.stopPropagation();
        onTouchStart?.(e);
      }}
      onContextMenu={(e) => {
        // Long-press on iOS Safari would otherwise select / offer copy.
        if (touchRef.current) e.preventDefault();
        onContextMenu?.(e);
      }}
      onClick={(e) => {
        const pointerType = (e.nativeEvent as PointerEvent).pointerType;
        if (
          pointerType === "touch" ||
          pointerType === "pen" ||
          touchRef.current ||
          ctx?.isMobile
        ) {
          // The pointerdown handler already toggled; swallow the synthetic click
          // so nested buttons/links/rows never activate.
          e.preventDefault();
          e.stopPropagation();
          touchRef.current = false;
          onClick?.(e);
          return;
        }
        // Mouse click also toggles (desktop hover still works via Radix)
        if (ctx) ctx.setOpen(!ctx.open);
        onClick?.(e);
      }}
      {...props}
    />
  );
});
TooltipTrigger.displayName = "TooltipTrigger";


type TooltipContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
  /** Show a close (X) button — auto-shown on mobile. */
  showClose?: boolean;
};

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(
  (
    {
      className,
      sideOffset = 6,
      collisionPadding = 8,
      showClose,
      children,
      onPointerDown,
      ...props
    },
    ref,
  ) => {
    const ctx = React.useContext(TooltipContext);
    const isMobile = ctx?.isMobile ?? false;
    const shouldShowClose = showClose ?? isMobile;
    return (
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        avoidCollisions
        // Tapping / scrolling inside the tooltip must not dismiss it.
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown?.(e);
        }}
        className={cn(
          "z-50 max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          shouldShowClose && "pr-8",
          className,
        )}
        {...props}
      >

        {children}
        {shouldShowClose && ctx && (
          <button
            type="button"
            aria-label="Close"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx.setOpen(false);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx.setOpen(false);
            }}
            className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </TooltipPrimitive.Content>
    );
  },
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * Shared info-icon tooltip. Use this instead of a native `title` attribute so
 * the tap-to-open / tap-outside-to-close behavior is identical everywhere.
 */
const InfoTooltip = ({
  children,
  label = "More information",
  className,
  contentClassName,
  side,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
  contentClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
}) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex items-center justify-center align-middle text-muted-foreground hover:text-foreground",
            className,
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className={cn("max-w-[16rem] text-xs leading-relaxed", contentClassName)}>
        {children}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, InfoTooltip };
