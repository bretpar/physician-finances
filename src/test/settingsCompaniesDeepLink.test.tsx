/**
 * Deep link from the missing-W-2-data warning into Settings → Companies.
 *
 * The Companies section starts collapsed, so a link that only picks an
 * employer leaves the employer and its "Tax withholding" panel hidden behind
 * the header the user was supposed to not have to find. These tests lock the
 * URL contract, the reveal, and the manual toggle.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { resolveSettingsDeepLink } from "@/lib/settingsDeepLink";
import { SectionCard } from "@/components/settings/SectionCard";
import { CompaniesSection } from "@/pages/Settings";

const { companies, closureState } = vi.hoisted(() => ({
  companies: [
    {
      id: "va-1",
      name: "Veterans Affairs",
      nickname: "",
      companyType: "w2",
      includeInTax: true,
      defaultSetasideMethod: "percentage",
      defaultSetasidePct: 25,
      notes: "",
      advancedFieldVisibility: {},
      applyBusinessStateTax: true,
      includeSETaxInRecommendation: true,
      payFrequency: "biweekly",
      remainingPaychecksOverride: null,
      employeeRole: null,
      projectedAnnualGross: null,
      expectedFederalWithholdingPerPaycheck: null,
      currentExtraW4Withholding: null,
    },
  ] as any[],
  closureState: { closedCompanyIds: new Set<string>() },
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompanies: () => ({
    companies,
    incomeCountByCompanyName: {},
    addCompany: vi.fn(),
    updateCompany: vi.fn(),
    removeCompany: vi.fn(),
    closurePeriods: [],
    closedCompanyIds: closureState.closedCompanyIds,
    closeCompany: vi.fn(),
    reopenCompany: vi.fn(),
  }),
}));

vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({ data: undefined }),
  useUpdateTaxSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useAccountRole", () => ({
  useAccountRole: () => ({ resolvedRole: "user", isLoading: false }),
}));

function renderSettings(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings${search}`]}>
      <CompaniesSection />
    </MemoryRouter>,
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("resolveSettingsDeepLink", () => {
  const closed = new Set<string>(["closed-1"]);

  it("opens the named employer and its withholding panel", () => {
    const params = new URLSearchParams("company=va-1&open=withholding");
    expect(resolveSettingsDeepLink(params, companies, closed)).toEqual({
      companyId: "va-1",
      openWithholding: true,
      openSection: true,
    });
  });

  it("reveals the section for a generic Companies link", () => {
    const params = new URLSearchParams("section=companies");
    expect(resolveSettingsDeepLink(params, companies, closed)).toEqual({
      companyId: null,
      openWithholding: false,
      openSection: true,
    });
  });

  it("never selects an unknown or closed employer, but still reveals the section", () => {
    expect(
      resolveSettingsDeepLink(new URLSearchParams("company=nope"), companies, closed),
    ).toEqual({ companyId: null, openWithholding: false, openSection: true });
    expect(
      resolveSettingsDeepLink(new URLSearchParams("company=closed-1"), companies, closed),
    ).toEqual({ companyId: null, openWithholding: false, openSection: true });
  });

  it("stays out of the way with no deep-link params", () => {
    expect(resolveSettingsDeepLink(new URLSearchParams(), companies, closed)).toEqual({
      companyId: null,
      openWithholding: false,
      openSection: false,
    });
  });
});

describe("Companies section reveal", () => {
  it("shows the employer and its withholding fields straight from the warning link", () => {
    renderSettings("?company=va-1&open=withholding");
    // Employer opened directly, with its withholding fields already expanded.
    expect(screen.getByTestId("settings-company-row")).toBeInTheDocument();
    expect(screen.getByTestId("settings-company-row-frequency-select")).toBeInTheDocument();
  });

  it("reveals the company list for a generic Companies link", () => {
    renderSettings("?section=companies");
    expect(screen.getByTestId("settings-company-card")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-company-row")).toBeNull();
  });

  it("keeps the section collapsed with no deep link, so the checks above can fail", () => {
    renderSettings("");
    expect(screen.queryByTestId("settings-company-card")).toBeNull();
    expect(screen.queryByTestId("settings-company-row")).toBeNull();
  });

  it("reveals the section but not a closed employer", () => {
    closureState.closedCompanyIds = new Set(["va-1"]);
    try {
      renderSettings("?company=va-1&open=withholding");
      expect(screen.queryByTestId("settings-company-row")).toBeNull();
      // Section is open, so the empty list and the closed-companies entry point show.
      expect(screen.getByTestId("settings-companies-add-button-empty")).toBeInTheDocument();
      expect(screen.queryByTestId("settings-company-card")).toBeNull();
    } finally {
      closureState.closedCompanyIds = new Set();
    }
  });
});

describe("SectionCard controlled open state", () => {
  function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <SectionCard
          title="Companies"
          headerTestId="trigger"
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            onOpenChange?.(next);
          }}
        >
          <span data-testid="section-content">content</span>
        </SectionCard>
        <button type="button" onClick={() => setOpen(true)}>
          reveal from a link
        </button>
      </>
    );
  }

  it("hides children while closed and reveals them when opened from outside", () => {
    render(<Harness />);
    expect(screen.queryByTestId("section-content")).toBeNull();
    fireEvent.click(screen.getByText("reveal from a link"));
    expect(screen.getByTestId("section-content")).toBeInTheDocument();
  });

  it("still opens when the user clicks the header", () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByTestId("trigger"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("section-content")).toBeInTheDocument();
  });
});
