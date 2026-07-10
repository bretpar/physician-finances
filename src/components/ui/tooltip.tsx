import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "lucide-react";

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
>(({ onClick, onPointerDown, ...props }, ref) => {
  const ctx = React.useContext(TooltipContext);
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      onPointerDown={(e) => {
        // Toggle on tap (touch/pen) so mobile users can reveal/dismiss tooltips
        // via a single tap — never long-press or hover.
        if (ctx && (e.pointerType === "touch" || e.pointerType === "pen")) {
          e.preventDefault();
          ctx.setOpen(!ctx.open);
        }
        onPointerDown?.(e);
      }}
      onClick={(e) => {
        // Mouse click also toggles (desktop hover still works via Radix)
        if (ctx && (e.nativeEvent as PointerEvent).pointerType === "mouse") {
          ctx.setOpen(!ctx.open);
        }
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
    { className, sideOffset = 6, collisionPadding = 8, showClose, children, ...props },
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

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
