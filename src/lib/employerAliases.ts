/**
 * Narrow, reusable employer-alias hints for personal income match SUGGESTIONS.
 *
 * An alias only ever yields a "possible" employer match — it never assigns an
 * employer, never auto-links, and never feeds automatic conversion/dedup.
 * Payroll processors like DFAS pay many federal employers, so a DFAS deposit
 * is only a *possible* match for a federal employer name, never a confirmed one.
 */

interface PayorAlias {
  /** Normalized payor pattern found in the bank description. */
  payor: RegExp;
  /** Employer-name patterns this payor may pay on behalf of. */
  possibleEmployers: RegExp[];
  label: string;
}

const PAYOR_ALIASES: PayorAlias[] = [
  {
    payor: /\bDFAS\b/i,
    possibleEmployers: [
      /veterans?\s+affairs/i,
      /\bVA\b/,
      /\bVAMC\b/i,
      /department\s+of\s+defense|\bDOD\b/i,
      /\b(army|navy|air\s+force|marine|military|federal)\b/i,
    ],
    label: "DFAS pays federal employers",
  },
];

/** Returns a short reason when `payorText` is a known payor that may pay `employerName`. */
export function possibleEmployerAlias(
  payorText: string | null | undefined,
  employerName: string | null | undefined,
): string | null {
  const payor = String(payorText || "");
  const employer = String(employerName || "");
  if (!payor || !employer) return null;
  for (const a of PAYOR_ALIASES) {
    if (a.payor.test(payor) && a.possibleEmployers.some((re) => re.test(employer))) {
      return `possible employer (${a.label})`;
    }
  }
  return null;
}
