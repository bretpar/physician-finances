import { useEffect } from "react";

/**
 * Browser-level beforeunload guard. Shows the native "leave site?" prompt
 * if any tracked section is dirty.
 *
 * Pass an array of dirty flags. Hook is active whenever ANY are true.
 */
export function useUnsavedChangesGuard(dirtyFlags: boolean[]) {
  const anyDirty = dirtyFlags.some(Boolean);
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message and show their own, but
      // returnValue must be set for the prompt to appear.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);
}
