import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IncomeLinkIssuesBanner, actionableLinkIssues } from "@/components/IncomeLinkIssuesBanner";
import type { LinkIssue } from "@/lib/incomeLinkValidation";

const meta: LinkIssue = { key: "link-metadata:g", kind: "incomplete_metadata", recordIds: ["t"], message: "WWEP on 2026-09-08 ($10080.00) has an incomplete link record." };
const dup: LinkIssue = { key: "dup-entries:t", kind: "duplicate", recordIds: ["t", "a", "b"], message: "2 income entries are attached to the same record." };
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("tax-page link warning", () => {
  it("metadata-only notice: no red banner and no review link", () => {
    const { container } = wrap(<IncomeLinkIssuesBanner issues={[meta]} />);
    expect(container.textContent).toBe("");
    expect(actionableLinkIssues([meta])).toEqual([]);
  });
  it("metadata notice still visible in Diagnostics, without a review link", () => {
    wrap(<IncomeLinkIssuesBanner issues={[meta]} context="export" showMetadata />);
    expect(screen.getByText(/no effect on taxes/)).toBeTruthy();
    expect(screen.queryByText("Review and confirm fixes")).toBeNull();
  });
  it("actionable issue keeps the red banner and review link; metadata is not counted in it", () => {
    wrap(<IncomeLinkIssuesBanner issues={[meta, dup]} />);
    expect(screen.getByText("1 income link issue may affect this estimate")).toBeTruthy();
    expect(screen.getByText("Review and confirm fixes")).toBeTruthy();
    expect(screen.queryByText(/WWEP/)).toBeNull();
  });
});
