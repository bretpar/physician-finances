/**
 * Community property state rules for MFS income allocation.
 *
 * Community property states generally require each spouse filing MFS to
 * report a share of the couple's combined community income (wages earned
 * during marriage, in most cases). Default share is 50/50 but callers can
 * override to model unusual allocations (e.g. separate-property income).
 *
 * All community-property behavior in the app MUST read from this module.
 * Do not hardcode state lists or 50/50 splits elsewhere.
 *
 * NOTE: This module NEVER writes to the tax engine, ledgers, or user
 * settings. It only returns allocated numbers for read-only estimation.
 */

export const COMMUNITY_PROPERTY_STATES = [
  "AZ", // Arizona
  "CA", // California
  "ID", // Idaho
  "LA", // Louisiana
  "NV", // Nevada
  "NM", // New Mexico
  "TX", // Texas
  "WA", // Washington
  "WI", // Wisconsin
] as const;

export type CommunityPropertyState = (typeof COMMUNITY_PROPERTY_STATES)[number];

export function isCommunityPropertyState(state: string | null | undefined): boolean {
  if (!state) return false;
  return (COMMUNITY_PROPERTY_STATES as readonly string[]).includes(state.toUpperCase());
}

// ── Legacy simple 50/50 gross-income split (used by MFJ vs MFS comparison
//    when adjustments aren't modeled). Kept for backwards compatibility.
// ────────────────────────────────────────────────────────────────────

export interface CommunityPropertySplitInput {
  userIncome: number;
  spouseIncome: number;
  applyCommunityRules: boolean;
  userShareOverride?: number | null;
}

export interface CommunityPropertySplitResult {
  userIncome: number;
  spouseIncome: number;
  applied: boolean;
  note: string;
}

export function splitIncomeForMfs(input: CommunityPropertySplitInput): CommunityPropertySplitResult {
  const total = Math.max(0, input.userIncome) + Math.max(0, input.spouseIncome);
  if (!input.applyCommunityRules) {
    return {
      userIncome: Math.max(0, input.userIncome),
      spouseIncome: Math.max(0, input.spouseIncome),
      applied: false,
      note: "Separate-property state — each spouse reports their own income.",
    };
  }
  const share =
    input.userShareOverride != null && Number.isFinite(input.userShareOverride)
      ? Math.min(1, Math.max(0, input.userShareOverride))
      : 0.5;
  return {
    userIncome: total * share,
    spouseIncome: total * (1 - share),
    applied: true,
    note:
      share === 0.5
        ? "Community property state — combined income split 50/50 for MFS."
        : `Community property state — using your custom split (you: ${(share * 100).toFixed(0)}%).`,
  };
}

// ── Full community-property AGI allocation with separate income and
//    AGI adjustments (Form 8958-style model).
//
//    Borrower MFS AGI = (community income × borrower share)
//                     + borrower separate income
//                     − borrower allocated AGI adjustments
//
//    Do NOT assume borrower AGI equals 50% of household gross income —
//    separate income and adjustments break that assumption.
// ────────────────────────────────────────────────────────────────────

export interface CommunityAgiAllocationInput {
  /** Borrower's individually earned community income (wages, SE income treated as community). */
  borrowerCommunityIncome: number;
  /** Spouse's individually earned community income. */
  spouseCommunityIncome: number;
  /** Borrower's separate-property income (inheritances, pre-marriage assets, etc.). */
  borrowerSeparateIncome?: number;
  /** Spouse's separate-property income. */
  spouseSeparateIncome?: number;
  /** Borrower's allocated above-the-line AGI adjustments (retirement, HSA, half SE tax, etc.). */
  borrowerAdjustments?: number;
  /** Spouse's allocated above-the-line AGI adjustments. */
  spouseAdjustments?: number;
  /** Fraction of community income allocated to borrower (0..1). Defaults to 0.5. */
  borrowerCommunityShare?: number;
}

export interface CommunityAgiAllocationResult {
  totalCommunityIncome: number;
  borrowerShare: number;
  spouseShare: number;
  borrowerAllocatedCommunity: number;
  spouseAllocatedCommunity: number;
  borrowerSeparateIncome: number;
  spouseSeparateIncome: number;
  borrowerAdjustments: number;
  spouseAdjustments: number;
  borrowerMfsAgi: number;
  spouseMfsAgi: number;
  note: string;
}

export function allocateCommunityAgi(input: CommunityAgiAllocationInput): CommunityAgiAllocationResult {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
  const bComm = clamp(input.borrowerCommunityIncome);
  const sComm = clamp(input.spouseCommunityIncome);
  const bSep = clamp(input.borrowerSeparateIncome ?? 0);
  const sSep = clamp(input.spouseSeparateIncome ?? 0);
  const bAdj = clamp(input.borrowerAdjustments ?? 0);
  const sAdj = clamp(input.spouseAdjustments ?? 0);
  const share =
    input.borrowerCommunityShare != null && Number.isFinite(input.borrowerCommunityShare)
      ? Math.min(1, Math.max(0, input.borrowerCommunityShare))
      : 0.5;
  const totalCommunity = bComm + sComm;
  const bAllocated = totalCommunity * share;
  const sAllocated = totalCommunity * (1 - share);
  const borrowerMfsAgi = Math.max(0, bAllocated + bSep - bAdj);
  const spouseMfsAgi = Math.max(0, sAllocated + sSep - sAdj);
  return {
    totalCommunityIncome: totalCommunity,
    borrowerShare: share,
    spouseShare: 1 - share,
    borrowerAllocatedCommunity: bAllocated,
    spouseAllocatedCommunity: sAllocated,
    borrowerSeparateIncome: bSep,
    spouseSeparateIncome: sSep,
    borrowerAdjustments: bAdj,
    spouseAdjustments: sAdj,
    borrowerMfsAgi,
    spouseMfsAgi,
    note:
      share === 0.5
        ? "Community property state — community income split 50/50, separate income and adjustments allocated to each spouse."
        : `Community property state — custom split (borrower: ${(share * 100).toFixed(0)}%).`,
  };
}
