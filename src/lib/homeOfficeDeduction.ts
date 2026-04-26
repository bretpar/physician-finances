import type { HomeOfficeDeduction } from "@/hooks/useHomeOfficeDeductions";

export const HOME_OFFICE_REPORT_LABEL = "Business use of home / Home office deduction";

export function getIncludedHomeOfficeByCompany(
  deductions: HomeOfficeDeduction[] | undefined | null,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const deduction of deductions || []) {
    if (!deduction.company_id || !deduction.include_in_tax_calculation || deduction.status !== "active") continue;
    const amount = Math.max(0, Number(deduction.allowed_amount || 0));
    map.set(deduction.company_id, (map.get(deduction.company_id) || 0) + amount);
  }
  return map;
}

export function getIncludedHomeOfficeTotal(deductions: HomeOfficeDeduction[] | undefined | null): number {
  return Array.from(getIncludedHomeOfficeByCompany(deductions).values()).reduce((sum, amount) => sum + amount, 0);
}