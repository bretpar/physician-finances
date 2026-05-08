/**
 * Global, cross-tab synced store for the "Planned Income vs Actual Only" tax mode.
 *
 * Used by useTaxEstimate so the Dashboard, Taxes tab, and any other consumer
 * always read/write the SAME mode. Persists to localStorage and broadcasts
 * across browser tabs via the `storage` event.
 */
import { useSyncExternalStore } from "react";

export type TaxMode = "actual" | "forecast";

const STORAGE_KEY = "paycheckmd:taxMode";
const DEFAULT_MODE: TaxMode = "forecast";

const isBrowser = typeof window !== "undefined";

function readFromStorage(): TaxMode {
  if (!isBrowser) return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "actual" || raw === "forecast" ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

let currentMode: TaxMode = readFromStorage();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getTaxMode(): TaxMode {
  return currentMode;
}

export function setTaxMode(mode: TaxMode) {
  if (mode === currentMode) return;
  currentMode = mode;
  if (isBrowser) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore quota/SSR errors */
    }
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Cross-tab sync — listen once at module load.
if (isBrowser) {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = e.newValue === "actual" || e.newValue === "forecast" ? e.newValue : DEFAULT_MODE;
    if (next !== currentMode) {
      currentMode = next;
      emit();
    }
  });
}

/** Subscribe to the shared mode in React. */
export function useTaxModeStore(): [TaxMode, (mode: TaxMode) => void] {
  const mode = useSyncExternalStore(subscribe, getTaxMode, () => DEFAULT_MODE);
  return [mode, setTaxMode];
}
