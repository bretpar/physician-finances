/**
 * Lightweight per-browser debug flags. Toggle via the browser console:
 *   localStorage.setItem("debug.withholdingSource", "1")
 *   localStorage.removeItem("debug.withholdingSource")
 * Then refresh.
 *
 * Reads are SSR/Node-safe.
 */
function read(key: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    const v = window.localStorage.getItem(key);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export const debugFlags = {
  /** Show which field powered each entry's "federal taxes paid" total. */
  withholdingSource: () => read("debug.withholdingSource"),
};
