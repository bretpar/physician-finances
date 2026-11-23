/**
 * Deep links from tax warnings into Settings.
 *
 * `/settings?company=<id>` opens that employer directly, `&open=withholding`
 * also expands its "Tax withholding" panel, and `/settings?section=companies`
 * only reveals the Companies section (which starts collapsed).
 * Retirement links use `?section=employer-match|related-businesses|partnership-plan`
 * (optionally `&company=<id>` to name the company to focus) and reveal that
 * existing section only.
 *
 * Kept as a pure function so the URL contract and the section's open state can
 * be tested together without mounting the whole Settings page.
 */
export const RETIREMENT_SETTINGS_SECTIONS = ["employer-match", "related-businesses", "partnership-plan"] as const;
export type RetirementSettingsSection = (typeof RETIREMENT_SETTINGS_SECTIONS)[number];

export interface SettingsDeepLink {
  /** Employer to open directly, or null when the link can't identify one. */
  companyId: string | null;
  /** Also expand that employer's "Tax withholding" panel. */
  openWithholding: boolean;
  /** Reveal the Companies section, which is collapsed by default. */
  openSection: boolean;
  /** Retirement settings section to reveal instead of Companies. */
  retirementSection: RetirementSettingsSection | null;
  /** Company to highlight inside the retirement section. */
  focusCompanyId: string | null;
}

export function settingsLink(section: RetirementSettingsSection | "companies" | null, companyId?: string | null): string {
  const p = new URLSearchParams();
  if (section) p.set("section", section);
  if (companyId) p.set("company", companyId);
  return `/settings?${p.toString()}`;
}

export function resolveSettingsDeepLink(
  params: Pick<URLSearchParams, "get">,
  companies: readonly { id: string }[],
  closedCompanyIds: ReadonlySet<string>,
): SettingsDeepLink {
  const cid = params.get("company");
  const section = params.get("section");
  const retirementSection = (RETIREMENT_SETTINGS_SECTIONS as readonly string[]).includes(section ?? "") ? (section as RetirementSettingsSection) : null;
  const known = !!cid && companies.some((c) => c.id === cid) && !closedCompanyIds.has(cid);
  if (retirementSection) {
    return { companyId: null, openWithholding: false, openSection: false, retirementSection, focusCompanyId: known ? cid : null };
  }
  const openSection = !!cid || section === "companies";
  if (known) {
    return { companyId: cid, openWithholding: params.get("open") === "withholding", openSection, retirementSection: null, focusCompanyId: null };
  }
  return { companyId: null, openWithholding: false, openSection, retirementSection: null, focusCompanyId: null };
}

export type SettingsGroup = "companies" | "preferences" | "tax" | "account" | "help";
export const SETTINGS_GROUPS: readonly SettingsGroup[] = ["companies", "preferences", "tax", "account", "help"];

/**
 * Which Settings group a URL opens. Company/section deep links always land in
 * Companies & Employment so the linked editor is on screen; `?group=` picks a
 * group explicitly; otherwise the landing list shows (null).
 */
export function settingsGroupForParams(params: URLSearchParams): SettingsGroup | null {
  if (params.get("company") || params.get("section")) return "companies";
  const g = params.get("group");
  return (SETTINGS_GROUPS as readonly string[]).includes(g ?? "") ? (g as SettingsGroup) : null;
}
