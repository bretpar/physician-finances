import { normalizeFilingType } from "@/lib/filingTypes";

/** True only for a company explicitly classified as W-2 or S-corp W-2 wages.
 *  Missing company or missing classification is conservatively NOT eligible. */
export function isEligibleW2WageCompany(companyType: string | null | undefined): boolean {
  if (!companyType || !companyType.trim()) return false;
  const ft = normalizeFilingType(companyType);
  return ft === "w2" || ft === "scorp_w2";
}

/** IRA-eligible W-2 wage compensation from recorded (non-scheduled) paychecks. */
export function eligibleIraW2Wages(
  paychecks: { companyId: string | null; wages: number | string | null; scheduled?: boolean }[],
  companies: { id: string; companyType?: string | null }[],
): number {
  let total = 0;
  for (const p of paychecks) {
    if (p.scheduled) continue;
    const co = companies.find((c) => c.id === p.companyId);
    if (!co || !isEligibleW2WageCompany(co.companyType)) continue;
    total += Number(p.wages) || 0;
  }
  return total;
}
