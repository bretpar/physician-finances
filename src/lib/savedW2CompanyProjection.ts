/**
 * savedW2CompanyProjection
 *
 * Computes the "future projected W-2 income" contribution from saved W-2
 * companies in Settings (Company table) that aren't already represented by
 * an active projected_income_stream. This lets Tax Overview and the W-4
 * calculator include the user's saved projected annual gross even when
 * they haven't set up an income stream.
 *
 * Pure / framework-free so it can be unit-tested in isolation.
 */
import { normalizeFilingType } from "@/lib/filingTypes";

export interface SavedW2CompanyInput {
  id: string;
  name: string;
  companyType: string;
  payFrequency: string | null;
  projectedAnnualGross: number | null;
  expectedFederalWithholdingPerPaycheck: number | null;
}

export interface SavedW2ProjectionAddon {
  /** Sum of future gross to add to projected W-2 income. */
  futureGross: number;
  /** Sum of future federal withholding to add to projected federal withholding. */
  futureFederalWithheld: number;
  perCompany: Array<{
    companyId: string;
    companyName: string;
    futureGross: number;
    futureFederalWithheld: number;
    remainingPaychecks: number;
  }>;
}

/** Lowercase + trim a company name so YTD lookups match consistently. */
export function ytdCompanyKey(name: string | null | undefined): string {
  return String(name ?? "").trim().toLowerCase();
}

export interface ComputeSavedW2ProjectionArgs {
  companies: SavedW2CompanyInput[];
  /** Source IDs (company.id) already covered by an active W-2 projected stream. */
  coveredCompanyIds: Set<string>;
  /** Map of normalized company name → YTD gross already counted elsewhere. */
  ytdGrossByCompanyKey: Map<string, number>;
  /** Returns remaining paychecks for a given frequency. */
  remainingPaychecksFor: (frequency: string | null) => number;
}

export function computeSavedW2CompanyProjectionAddon(
  args: ComputeSavedW2ProjectionArgs,
): SavedW2ProjectionAddon {
  let futureGross = 0;
  let futureFederalWithheld = 0;
  const perCompany: SavedW2ProjectionAddon["perCompany"] = [];

  for (const c of args.companies || []) {
    const ft = normalizeFilingType(c.companyType);
    if (ft !== "w2" && ft !== "scorp_w2") continue;
    if (args.coveredCompanyIds.has(c.id)) continue;

    const annual = c.projectedAnnualGross;
    const perPaycheckFed = c.expectedFederalWithholdingPerPaycheck;
    if (annual == null && perPaycheckFed == null) continue;

    const ytd = args.ytdGrossByCompanyKey.get(ytdCompanyKey(c.name)) || 0;
    const grossAddon = annual != null ? Math.max(0, annual - ytd) : 0;

    const remaining = args.remainingPaychecksFor(c.payFrequency);
    const fedAddon =
      perPaycheckFed != null && remaining > 0 ? perPaycheckFed * remaining : 0;

    if (grossAddon <= 0 && fedAddon <= 0) continue;

    futureGross += grossAddon;
    futureFederalWithheld += fedAddon;
    perCompany.push({
      companyId: c.id,
      companyName: c.name,
      futureGross: grossAddon,
      futureFederalWithheld: fedAddon,
      remainingPaychecks: remaining,
    });
  }

  return { futureGross, futureFederalWithheld, perCompany };
}
