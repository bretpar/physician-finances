// ============================================================================
// Qualified Business Income (§199A) deduction
// ============================================================================
// Pure functional module. Given per-entity QBI figures and the taxpayer's
// taxable income before the QBI deduction, computes the §199A deduction with:
//   • SSTB phase-out (physician-focused app defaults every eligible entity
//     to SSTB unless the caller marks it otherwise)
//   • Overall taxable-income-minus-net-capital-gain limit (20% cap)
//   • Per-entity breakdown surfaced for developer diagnostics & the
//     Tax Validation Suite
//
// NOT computed here (deliberately, until data model support is added):
//   • W-2 wages / UBIA-of-qualified-property limits above the phase-in range
//     for NON-SSTBs. Those entities currently receive the full 20% × QBI when
//     the taxpayer is above the phase-in — this is a known simplification and
//     an intentional caller-supplied override point.
// ============================================================================

import { type FilingStatus, getTaxYearConfig } from "@/lib/taxBrackets";

export interface QbiEntityInput {
  /** Stable id (company id, "aggregate", etc.). Used only for diagnostics. */
  id: string;
  /** Display label for diagnostics. */
  name: string;
  /**
   * Physician-focused app: every eligible pass-through is an SSTB by default.
   * Callers can flip this to `false` for genuinely non-SSTB entities.
   */
  isSSTB: boolean;
  /**
   * Qualified Business Income for this entity — already reduced by:
   *   ½ SE tax attributable to this entity
   *   Self-employed health-insurance attributable to this entity
   *   Self-employed retirement contributions attributable to this entity
   * Never negative; caller floors at 0.
   */
  qbi: number;
  /** W-2 wages paid by the entity (allocable share). Undefined = not supplied. */
  w2Wages?: number;
  /** Unadjusted basis of qualified property (allocable share). Undefined = not supplied. */
  ubia?: number;
  /** True when the entity is synthesized from aggregate SE income, not real per-entity data. */
  synthesized?: boolean;
}

export interface QbiEntityResult {
  input: QbiEntityInput;
  /** QBI after SSTB applicable-percentage reduction (still pre-20%). */
  qualifyingQbi: number;
  /** 20% of qualifyingQbi (pre-taxable-income cap). */
  entityDeduction: number;
  /** SSTB applicable percentage used for this entity (1 = fully eligible). */
  applicablePercentage: number;
  /** True if this entity was fully phased out (SSTB above phase-in). */
  fullyPhasedOut: boolean;
}

export interface QbiComputation {
  /** Final §199A deduction actually applied to taxable income. */
  totalDeduction: number;
  /** Sum of per-entity 20% deductions before the aggregate taxable-income cap. */
  preliminaryTotalDeduction: number;
  /** 20% × max(0, TI-before-QBI − net capital gain). */
  taxableIncomeLimit: number;
  /** True if the aggregate taxable-income cap bound the final deduction. */
  cappedByTaxableIncome: boolean;
  /** Taxable income used as the SSTB-threshold measurement point. */
  taxableIncomeBeforeQbi: number;
  /** Net capital gain (LTCG + qualified dividends) removed from the cap base. */
  netCapitalGain: number;
  /** §199A threshold for the filing status (start of phase-in). */
  threshold: number;
  /** Width of the phase-in range ($50k S / $100k MFJ). */
  phaseInRange: number;
  /** SSTB applicable percentage at the taxpayer level (1..0). */
  sstbApplicablePercentage: number;
  /** Per-entity breakdown for diagnostics. */
  perEntity: QbiEntityResult[];
  /**
   * "verified" only when every rule that applies at this income level had the
   * inputs it needs. Above the threshold the W-2 wage / UBIA limit needs
   * per-entity wages and property; an aggregate synthesized entity is never
   * fully verified there.
   */
  verification: { status: "verified" | "approximate"; missingInputs: string[] };
}

function emptyComputation(
  taxableIncomeBeforeQbi: number,
  netCapitalGain: number,
  threshold: number,
  phaseInRange: number,
  sstbApplicablePercentage: number,
): QbiComputation {
  return {
    totalDeduction: 0,
    preliminaryTotalDeduction: 0,
    taxableIncomeLimit: 0,
    cappedByTaxableIncome: false,
    taxableIncomeBeforeQbi,
    netCapitalGain,
    threshold,
    phaseInRange,
    sstbApplicablePercentage,
    perEntity: [],
    verification: { status: "verified", missingInputs: [] },
  };
}

/**
 * Compute the §199A QBI deduction and per-entity breakdown.
 * Pure — never mutates inputs, never touches storage or global state.
 */
export function computeQbiDeduction(params: {
  entities: readonly QbiEntityInput[];
  taxableIncomeBeforeQbi: number;
  netCapitalGain: number;
  filingStatus: FilingStatus;
  taxYear?: number;
}): QbiComputation {
  const {
    entities,
    taxableIncomeBeforeQbi: rawTi,
    netCapitalGain: rawNcg,
    filingStatus,
    taxYear,
  } = params;

  const taxableIncomeBeforeQbi = Math.max(0, rawTi);
  const netCapitalGain = Math.max(0, rawNcg);

  const cfg = getTaxYearConfig(taxYear);
  const { threshold, phaseIn: phaseInRange } = cfg.qbiThresholds[filingStatus];

  // SSTB applicable percentage — depends only on filing-status TI-before-QBI.
  //   Below threshold: 1 (fully eligible)
  //   Above threshold + phaseIn: 0 (fully phased out)
  //   Within range: 1 − (TI − threshold)/phaseIn
  let sstbApplicablePercentage: number;
  if (taxableIncomeBeforeQbi <= threshold) {
    sstbApplicablePercentage = 1;
  } else if (taxableIncomeBeforeQbi >= threshold + phaseInRange) {
    sstbApplicablePercentage = 0;
  } else {
    sstbApplicablePercentage = 1 - (taxableIncomeBeforeQbi - threshold) / phaseInRange;
  }

  if (!entities.length || taxableIncomeBeforeQbi <= 0) {
    return emptyComputation(
      taxableIncomeBeforeQbi,
      netCapitalGain,
      threshold,
      phaseInRange,
      sstbApplicablePercentage,
    );
  }

  // §199A(b)(3): W-2 wage / UBIA limit phases in over the same range.
  const aboveThreshold = taxableIncomeBeforeQbi > threshold;
  const limitPhaseIn = aboveThreshold
    ? Math.min(1, (taxableIncomeBeforeQbi - threshold) / phaseInRange)
    : 0;
  const missing = new Set<string>();

  const perEntity: QbiEntityResult[] = entities.map((e) => {
    const rawQbi = Math.max(0, e.qbi);
    // §199A(d)(3): SSTB QBI, wages and UBIA all scale by the applicable percentage.
    const applicablePercentage = e.isSSTB ? sstbApplicablePercentage : 1;
    const qualifyingQbi = rawQbi * applicablePercentage;
    const tentative = qualifyingQbi * 0.2;
    let entityDeduction = tentative;
    if (e.synthesized) missing.add("per-entity business/K-1 detail (aggregate approximation used)");
    if (aboveThreshold && applicablePercentage > 0 && rawQbi > 0) {
      if (e.w2Wages == null || e.ubia == null) {
        missing.add(`W-2 wages and UBIA for ${e.name}`);
      } else {
        const wages = Math.max(0, e.w2Wages) * applicablePercentage;
        const ubia = Math.max(0, e.ubia) * applicablePercentage;
        const wageLimit = Math.max(0.5 * wages, 0.25 * wages + 0.025 * ubia);
        if (wageLimit < tentative) entityDeduction = tentative - limitPhaseIn * (tentative - wageLimit);
      }
    }
    const fullyPhasedOut = e.isSSTB && applicablePercentage === 0;
    return {
      input: e,
      qualifyingQbi,
      entityDeduction,
      applicablePercentage,
      fullyPhasedOut,
    };
  });

  const preliminaryTotalDeduction = perEntity.reduce(
    (sum, r) => sum + r.entityDeduction,
    0,
  );

  // Overall taxable-income limit: 20% × max(0, TI − net capital gain).
  const taxableIncomeLimit = 0.2 * Math.max(0, taxableIncomeBeforeQbi - netCapitalGain);

  const totalDeduction = Math.max(
    0,
    Math.min(preliminaryTotalDeduction, taxableIncomeLimit),
  );
  const cappedByTaxableIncome =
    preliminaryTotalDeduction > 0 && totalDeduction < preliminaryTotalDeduction;

  return {
    totalDeduction,
    preliminaryTotalDeduction,
    taxableIncomeLimit,
    cappedByTaxableIncome,
    taxableIncomeBeforeQbi,
    netCapitalGain,
    threshold,
    phaseInRange,
    sstbApplicablePercentage,
    perEntity,
    verification: {
      status: missing.size ? "approximate" : "verified",
      missingInputs: [...missing],
    },
  };
}
