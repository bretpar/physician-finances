/**
 * Community property state rules for MFS income allocation.
 *
 * Community property states generally require each spouse filing MFS to
 * report 50% of the couple's combined community income (wages earned
 * during marriage, in most cases). This has significant consequences for
 * Married Filing Separately student loan strategies, because splitting
 * income can raise the lower earner's AGI while lowering the higher
 * earner's — which changes IDR payment math.
 *
 * All community-property behavior in the app MUST read from this module.
 * Do not hardcode state lists or 50/50 splits elsewhere.
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

export interface CommunityPropertySplitInput {
  userIncome: number;
  spouseIncome: number;
  /** When true, allocate 50/50 (community property MFS default). */
  applyCommunityRules: boolean;
  /**
   * Optional explicit user share (0..1). When provided, overrides the
   * default 50/50 split (e.g. to model separate-property income). Only
   * used when `applyCommunityRules` is true.
   */
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
