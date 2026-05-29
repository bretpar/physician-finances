import type { QueryClient } from "@tanstack/react-query";

export const APP_CACHE_STORAGE_PREFIXES = ["paycheckmd-", "paycheckmd:", "dashboard:", "w4."] as const;

const APP_CACHE_STORAGE_KEYS = new Set([
  "debug:taxBreakdown",
  "debug:withholding",
]);

export const SAFE_ERASE_FINANCIAL_QUERY_KEYS = [
  ["tax_settings"],
  ["transactions"],
  ["income_entries"],
  ["personal_income_entries"],
  ["ytd_catchup_entries"],
  ["income_sources"],
  ["tax_payments"],
  ["tax_savings"],
  ["investment_income_entries"],
  ["stock_transactions"],
  ["projected_income_streams"],
  ["projected_bonus_events"],
  ["projected_income_overrides"],
  ["planner_conversions"],
  ["mileage_entries"],
  ["home_office_deductions"],
  ["hsa_contributions"],
  ["retirement_contributions"],
  ["plaid_items"],
  ["plaid_accounts"],
] as const;

export function shouldClearSafeEraseStorageKey(key: string) {
  return APP_CACHE_STORAGE_KEYS.has(key) || APP_CACHE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function clearSafeEraseBrowserStorage() {
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    Object.keys(storage).forEach((key) => {
      if (shouldClearSafeEraseStorageKey(key)) storage.removeItem(key);
    });
  }
}

export async function invalidateSafeEraseQueries(queryClient: QueryClient) {
  await Promise.all(
    SAFE_ERASE_FINANCIAL_QUERY_KEYS.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey: [...queryKey] }),
    ),
  );
}