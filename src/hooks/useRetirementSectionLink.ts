import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCompanies } from "@/contexts/CompanyContext";
import { resolveSettingsDeepLink, type RetirementSettingsSection } from "@/lib/settingsDeepLink";

/**
 * Lets an existing Settings section open itself (and scroll into view) when the
 * Retirement planner links to it. A later header click wins over the URL.
 */
export function useRetirementSectionLink(section: RetirementSettingsSection) {
  const [params] = useSearchParams();
  const { companies, closedCompanyIds } = useCompanies();
  const link = useMemo(() => resolveSettingsDeepLink(params, companies, closedCompanyIds), [params, companies, closedCompanyIds]);
  const targeted = link.retirementSection === section;
  const [toggled, setToggled] = useState<boolean | null>(null);
  const anchorId = `settings-${section}`;
  useEffect(() => {
    if (!targeted) return;
    const t = setTimeout(() => {
      const el = (link.focusCompanyId && document.getElementById(`${anchorId}-${link.focusCompanyId}`)) || document.getElementById(anchorId);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);
  }, [targeted, link.focusCompanyId, anchorId]);
  return {
    anchorId,
    open: toggled ?? targeted,
    onOpenChange: setToggled,
    focusCompanyId: targeted ? link.focusCompanyId : null,
  };
}
