/**
 * Deep links from tax warnings into Settings → Companies.
 *
 * `/settings?company=<id>` opens that employer directly, `&open=withholding`
 * also expands its "Tax withholding" panel, and `/settings?section=companies`
 * only reveals the Companies section (which starts collapsed).
 *
 * Kept as a pure function so the URL contract and the section's open state can
 * be tested together without mounting the whole Settings page.
 */
export interface SettingsDeepLink {
  /** Employer to open directly, or null when the link can't identify one. */
  companyId: string | null;
  /** Also expand that employer's "Tax withholding" panel. */
  openWithholding: boolean;
  /** Reveal the Companies section, which is collapsed by default. */
  openSection: boolean;
}

export function resolveSettingsDeepLink(
  params: Pick<URLSearchParams, "get">,
  companies: readonly { id: string }[],
  closedCompanyIds: ReadonlySet<string>,
): SettingsDeepLink {
  const cid = params.get("company");
  const openSection = !!cid || params.get("section") === "companies";
  if (cid && companies.some((c) => c.id === cid) && !closedCompanyIds.has(cid)) {
    return {
      companyId: cid,
      openWithholding: params.get("open") === "withholding",
      openSection,
    };
  }
  return { companyId: null, openWithholding: false, openSection };
}
