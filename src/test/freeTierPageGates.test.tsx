import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  getFeatureDefinition,
  resolveRequiredAccess,
  roleMeetsFeatureMinimum,
} from "@/lib/featureRegistry";
import { PageAccessGate } from "@/components/PageAccessGate";
import type { StagedAccessStatus } from "@/hooks/useFeatureAccess";

const accessStatus = vi.fn<[string], StagedAccessStatus>(() => "allowed");

vi.mock("@/hooks/useFeatureAccess", () => ({
  useFeatureAccess: () => ({ accessStatus }),
}));

describe("free-tier page entitlements", () => {
  beforeEach(() => {
    accessStatus.mockReset();
    accessStatus.mockReturnValue("allowed");
  });

  it("marks Investments and Income Planner as premium pages", () => {
    for (const key of ["pageInvestments", "pageIncomePlanner"] as const) {
      expect(getFeatureDefinition(key)?.minimumRole).toBe("premium");
      expect(resolveRequiredAccess(key)).toBe("premium");
      expect(roleMeetsFeatureMinimum("free", key)).toBe(false);
      expect(roleMeetsFeatureMinimum("premium", key)).toBe(true);
    }
  });

  it("keeps Taxes, Tax Savings and Settings pages free", () => {
    for (const key of ["pageTaxes", "pageTaxSavings", "pageSettings"] as const) {
      expect(roleMeetsFeatureMinimum("free", key)).toBe(true);
    }
  });

  it("renders the locked card instead of page content when access is denied", () => {
    accessStatus.mockReturnValue("denied");
    render(
      <PageAccessGate featureKey={"pageInvestments" as never} title="Investments">
        <p>secret content</p>
      </PageAccessGate>,
    );
    expect(screen.getByTestId("page-locked-pageInvestments")).toBeInTheDocument();
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("fails safe with a loading state while access is unresolved", () => {
    accessStatus.mockReturnValue("pending");
    render(
      <PageAccessGate featureKey={"pageIncomePlanner" as never} title="Income Planner">
        <p>secret content</p>
      </PageAccessGate>,
    );
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("renders children once access is allowed", () => {
    render(
      <PageAccessGate featureKey={"pageIncomePlanner" as never} title="Income Planner">
        <p>secret content</p>
      </PageAccessGate>,
    );
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });
});
