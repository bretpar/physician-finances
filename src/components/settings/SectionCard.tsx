import { ReactNode, useEffect, useId, useState } from "react";
import { ChevronDown, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SectionCardProps {
  /** Visible section title. */
  title: string;
  /** Optional icon shown to the left of the title. */
  icon?: ReactNode;
  /** Subtitle / summary count e.g. "Companies (4)" — appears next to title. */
  summary?: string;
  /** Longer description shown under title. */
  description?: string;
  /** Action element rendered in the header (e.g. an "Add" button). */
  headerAction?: ReactNode;
  /** Whether section is collapsible. Defaults true. */
  collapsible?: boolean;
  /** Initial open state. Defaults false so sections start collapsed. */
  defaultOpen?: boolean;
  /** Whether the section currently has unsaved edits. */
  isDirty?: boolean;
  /** Whether a save is in flight. */
  isSaving?: boolean;
  /** Show "Saved" confirmation flash. */
  justSaved?: boolean;
  /** Save handler — only rendered if provided. */
  onSave?: () => void;
  /** Cancel handler — only rendered if provided. */
  onCancel?: () => void;
  /** Hide the action bar even when dirty (e.g. read-only sections). */
  hideActionBar?: boolean;
  /** Render without outer card chrome (for nesting inside another SectionCard). */
  bare?: boolean;
  children: ReactNode;
}

export function SectionCard({
  title,
  icon,
  summary,
  description,
  headerAction,
  collapsible = true,
  defaultOpen = false,
  isDirty = false,
  isSaving = false,
  justSaved = false,
  onSave,
  onCancel,
  hideActionBar = false,
  bare = false,
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [confirmCollapse, setConfirmCollapse] = useState(false);
  const dirtyKey = useId();

  // Broadcast dirty state to a top-level guard.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("settings:dirty", { detail: { key: dirtyKey, dirty: isDirty } }));
    return () => {
      window.dispatchEvent(new CustomEvent("settings:dirty", { detail: { key: dirtyKey, dirty: false } }));
    };
  }, [dirtyKey, isDirty]);

  const toggle = () => {
    if (!collapsible) return;
    if (open && isDirty) {
      setConfirmCollapse(true);
      return;
    }
    setOpen((o) => !o);
  };

  const showActionBar = !hideActionBar && isDirty && (onSave || onCancel);

  if (bare) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="mt-0.5 text-primary flex-shrink-0" aria-hidden>
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-card-foreground">{title}</h4>
              {isDirty && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                  <AlertCircle className="h-3 w-3" /> Unsaved
                </span>
              )}
              {justSaved && !isDirty && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                  <Check className="h-3 w-3" /> Saved
                </span>
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
        </div>
        <div className="space-y-5">{children}</div>
        {showActionBar && (
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            {onCancel && (
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
                Cancel
              </Button>
            )}
            {onSave && (
              <Button size="sm" onClick={onSave} disabled={isSaving || !isDirty}>
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Save Changes
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="glass-card rounded-xl overflow-hidden">
      <header
        className={cn(
          "flex items-start gap-3 p-5 sm:p-6",
          collapsible && "cursor-pointer select-none",
        )}
        onClick={collapsible ? toggle : undefined}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? open : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
      >
        {icon && (
          <div className="mt-0.5 text-primary flex-shrink-0" aria-hidden>
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-card-foreground truncate">
              {title}
            </h3>
            {summary && (
              <span className="text-xs text-muted-foreground">{summary}</span>
            )}
            {isDirty && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                <AlertCircle className="h-3 w-3" /> Unsaved
              </span>
            )}
            {justSaved && !isDirty && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        <div
          className="flex items-center gap-2 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {headerAction}
          {collapsible && (
            <button
              type="button"
              aria-label={open ? "Collapse section" : "Expand section"}
              onClick={toggle}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          )}
        </div>
      </header>

      {open && (
        <div className="px-5 sm:px-6 pb-5 sm:pb-6 space-y-5">{children}</div>
      )}

      {open && showActionBar && (
        <div className="sticky bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 px-5 sm:px-6 py-3 flex items-center justify-end gap-2">
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
          )}
          {onSave && (
            <Button size="sm" onClick={onSave} disabled={isSaving || !isDirty}>
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save Changes
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={confirmCollapse} onOpenChange={setConfirmCollapse}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits in <strong>{title}</strong>. Collapsing this
              section will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onCancel?.();
                setConfirmCollapse(false);
                setOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
