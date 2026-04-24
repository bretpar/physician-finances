/**
 * Lightweight per-browser debug flags. Toggle via the browser console or via
 * the in-app debug switches (which dispatch a `debugflags` event so subscribed
 * React components re-render immediately).
 *
 *   localStorage.setItem("debug.withholdingSource", "1")
 *   localStorage.setItem("debug.forceQuarterClosed", "1")
 *
 * Reads are SSR/Node-safe.
 */
import { useSyncExternalStore } from "react";

const EVENT = "debugflags";

function read(key: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    const v = window.localStorage.getItem(key);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

function write(key: string, on: boolean) {
  try {
    if (typeof window === "undefined") return;
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* noop */
  }
}

export const debugFlags = {
  /** Show which field powered each entry's "federal taxes paid" total. */
  withholdingSource: () => read("debug.withholdingSource"),
  setWithholdingSource: (on: boolean) => write("debug.withholdingSource", on),

  /**
   * Force the currently-selected quarter in the Quarterly Tax Progress card
   * to be treated as CLOSED. Effects:
   *   - planned/projected income contribution to the dynamic quarter target = 0
   *   - status message + tone use the "past quarter" branch
   *   - "today's pace" marker / suggested-by-today behave as end-of-quarter
   * Useful for verifying end-of-quarter behavior on a future quarter.
   */
  forceQuarterClosed: () => read("debug.forceQuarterClosed"),
  setForceQuarterClosed: (on: boolean) => write("debug.forceQuarterClosed", on),
};

/** React hook: subscribe to a flag so toggling re-renders consumers. */
export function useDebugFlag(readFn: () => boolean): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => readFn(),
    () => false,
  );
}
