import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

type TooltipCtx = {
  open: boolean;
  setOpen: (o: boolean) => void;
  controlled: boolean;
};
const TooltipContext = React.createContext<TooltipCtx | null>(null);

type TooltipProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;

const Tooltip = ({ open: openProp, defaultOpen, onOpenChange, children, ...props }: TooltipProps) => {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(!!defaultOpen);
  const open = isControlled ? !!openProp : internalOpen;
  const setOpen = React.useCallback(
    (o: boolean) => {
      if (!isControlled) setInternalOpen(o);
      onOpenChange?.(o);
    },
    [isControlled, onOpenChange],
  );
  const ctx = React.useMemo(() => ({ open, setOpen, controlled: true }), [open, setOpen]);
  return (
    <TooltipContext.Provider value={ctx}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen} {...props}>
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
        // Toggle on tap (touch/pen) so iPhone/iPad users can reveal tooltip content
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

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, onPointerDownOutside, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    onPointerDownOutside={onPointerDownOutside}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
