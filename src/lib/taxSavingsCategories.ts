/**
 * Tax Savings accordion category visibility.
 *
 * Only the income-profile-gated categories can disappear. Every other category
 * (Student Loan Interest, and any future always-available category) must stay
 * expandable — otherwise the accordion snaps back to the default category.
 */
export interface TaxSavingsVisibilityFlags {
  showMileage: boolean;
  showHomeOffice: boolean;
  showRetirement: boolean;
  showHsa: boolean;
}

export function isCategoryStillVisible(
  categoryValue: string,
  flags: TaxSavingsVisibilityFlags,
): boolean {
  const gated: Record<string, boolean> = {
    mileage: flags.showMileage,
    "home-office": flags.showHomeOffice,
    retirement: flags.showRetirement,
    hsa: flags.showHsa,
  };
  if (!(categoryValue in gated)) return true;
  return gated[categoryValue];
}
