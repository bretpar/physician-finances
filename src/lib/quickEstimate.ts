// Lightweight federal + SE + state tax estimate used by the public /estimate flow.
// Intentionally simple — this is a marketing preview, not the tax engine.

export type FilingStatus = "single" | "married_filing_jointly";
export type IncomeKind = "w2_only" | "w2_plus_business" | "business_only";
export type DeductionStrategy = "standard" | "itemized";

export interface QuickEstimateInput {
  incomeKind: IncomeKind;
  filingStatus: FilingStatus;
  state: string;            // 2-letter; "" = unknown
  w2Income: number;
  businessIncome: number;   // 1099/K-1
  investmentIncome: number;
  deductionStrategy: DeductionStrategy;
  itemizedAmount: number;
  retirement401k: number;
  hsa: number;
  otherPretax: number;
}

export interface QuickEstimateResult {
  grossIncome: number;
  pretaxDeductions: number;
  taxableBase: number;          // after std/itemized + pretax
  federalTax: number;
  seTax: number;
  stateTax: number;
  totalTax: number;
  effectiveRate: number;        // 0..1
  recommendedSetAside: number;  // dollars to set aside annually for self-employment portion
  quarterlyReserve: number;     // recommended set-aside / 4
}

// 2024 federal brackets — close enough for a preview.
const BRACKETS_SINGLE: Array<[number, number]> = [
  [11600, 0.10], [47150, 0.12], [100525, 0.22], [191950, 0.24],
  [243725, 0.32], [609350, 0.35], [Infinity, 0.37],
];
const BRACKETS_MFJ: Array<[number, number]> = [
  [23200, 0.10], [94300, 0.12], [201050, 0.22], [383900, 0.24],
  [487450, 0.32], [731200, 0.35], [Infinity, 0.37],
];

const STD_DEDUCTION = { single: 14600, married_filing_jointly: 29200 };
const SS_WAGE_CAP_2024 = 168600;

// Rough state-level flat-ish estimates. Not precise — preview only.
const STATE_FLAT_RATES: Record<string, number> = {
  AK: 0, FL: 0, NH: 0, NV: 0, SD: 0, TN: 0, TX: 0, WA: 0, WY: 0,
  AL: 0.04, AZ: 0.025, AR: 0.044, CA: 0.08, CO: 0.044, CT: 0.055,
  DE: 0.055, GA: 0.0539, HI: 0.07, ID: 0.058, IL: 0.0495, IN: 0.0315,
  IA: 0.044, KS: 0.057, KY: 0.045, LA: 0.0425, ME: 0.0575, MD: 0.0475,
  MA: 0.05, MI: 0.0425, MN: 0.0685, MS: 0.047, MO: 0.0495, MT: 0.0575,
  NE: 0.0584, NJ: 0.0525, NM: 0.049, NY: 0.0633, NC: 0.045, ND: 0.0195,
  OH: 0.035, OK: 0.0475, OR: 0.0875, PA: 0.0307, RI: 0.0475, SC: 0.064,
  UT: 0.0465, VT: 0.066, VA: 0.0575, WV: 0.0482, WI: 0.0535, DC: 0.0675,
};

function applyBrackets(taxable: number, brackets: Array<[number, number]>) {
  if (taxable <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const [cap, rate] of brackets) {
    const slice = Math.max(0, Math.min(taxable, cap) - prev);
    tax += slice * rate;
    if (taxable <= cap) break;
    prev = cap;
  }
  return tax;
}

export function computeQuickEstimate(input: QuickEstimateInput): QuickEstimateResult {
  const grossIncome = Math.max(0, input.w2Income) + Math.max(0, input.businessIncome) + Math.max(0, input.investmentIncome);
  const pretaxDeductions = Math.max(0, input.retirement401k) + Math.max(0, input.hsa) + Math.max(0, input.otherPretax);

  // SE tax on business income (92.35% base, 15.3% combined SS+Medicare up to SS cap; Medicare-only above)
  const seBase = Math.max(0, input.businessIncome) * 0.9235;
  const ssPortion = Math.min(seBase, SS_WAGE_CAP_2024) * 0.124;
  const medicarePortion = seBase * 0.029;
  const seTax = ssPortion + medicarePortion;
  const seDeduction = seTax / 2;

  const stdOrItemized = input.deductionStrategy === "itemized"
    ? Math.max(0, input.itemizedAmount)
    : STD_DEDUCTION[input.filingStatus];

  const taxableBase = Math.max(0, grossIncome - pretaxDeductions - seDeduction - stdOrItemized);

  const brackets = input.filingStatus === "married_filing_jointly" ? BRACKETS_MFJ : BRACKETS_SINGLE;
  const federalTax = applyBrackets(taxableBase, brackets);

  const stateRate = STATE_FLAT_RATES[input.state?.toUpperCase()] ?? 0.05;
  const stateTax = Math.max(0, grossIncome - pretaxDeductions - stdOrItemized) * stateRate;

  const totalTax = federalTax + seTax + stateTax;
  const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;

  // Recommended set-aside: the portion of tax NOT covered by W-2 withholding.
  // We approximate W-2's share of total tax as (w2Income / grossIncome) of the federal+state piece,
  // and add full SE tax (always owed by the earner).
  const w2Share = grossIncome > 0 ? Math.max(0, input.w2Income) / grossIncome : 0;
  const nonWithheld = (federalTax + stateTax) * (1 - w2Share) + seTax;
  const recommendedSetAside = Math.max(0, nonWithheld);
  const quarterlyReserve = recommendedSetAside / 4;

  return {
    grossIncome, pretaxDeductions, taxableBase,
    federalTax, seTax, stateTax, totalTax, effectiveRate,
    recommendedSetAside, quarterlyReserve,
  };
}

export const US_STATES: Array<[string, string]> = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],
  ["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],
  ["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],
  ["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],
  ["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],
  ["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],
  ["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],
  ["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
];

export const ESTIMATE_STORAGE_KEY = "paycheckmd-estimate-draft";
