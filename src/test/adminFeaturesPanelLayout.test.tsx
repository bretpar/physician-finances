/**
 * Lightweight UI snapshot tests for the Admin → Features panel.
 *
 * Guards the *presentation contract* only (no entitlement behavior):
 *   1) Collapsed view renders exactly one row per page group and no child rows.
 *   2) Expanded view renders subgroup headers plus their child rows.
 *   3) Mobile breakpoints: rows wrap instead of overflowing (flex-wrap on
 *      mobile, flex-nowrap from sm up) and selects keep a fixed tap width.
 *   4) Subgroup indentation never regresses (subgroup list keeps its pl-*).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FeaturesPanel from "@/pages/admin/FeaturesPanel";
import { FEATURE_REGISTRY, groupChildrenByAdminGroup, groupFeaturesByPage } from "@/lib/featureRegistry";

vi.mock("@/hooks/useFeatureOverrides", () => ({
  useFeatureOverrides: () => ({ overrides: {}, isLoading: false, isResolved: true }),
  useSetFeatureOverride: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const groups = groupFeaturesByPage(FEATURE_REGISTRY);
const bigGroup = groups.find((g) => g.children.length > 3)!;

const expand = (title: string) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`Expand ${title}`, "i") }));

describe("Admin Features panel layout", () => {
  it("collapsed view shows one row per page group and no child rows", () => {
    render(<FeaturesPanel />);
    expect(screen.getAllByTestId("feature-group")).toHaveLength(groups.length);
    expect(screen.queryAllByTestId(/^feature-row-/)).toHaveLength(0);
    // Every page group is reachable by its collapsed toggle.
    for (const g of groups) {
      expect(screen.getByRole("button", { name: new RegExp(`Expand ${g.title}`, "i") })).toBeInTheDocument();
    }
  });

  it("expanded view renders subgroup headers and their child rows", () => {
    render(<FeaturesPanel />);
    expand(bigGroup.title);

    const children = screen.getByTestId(`feature-group-children-${bigGroup.id}`);
    const subgroups = groupChildrenByAdminGroup(bigGroup.children);
    for (const sub of subgroups) {
      expect(screen.getByTestId(`feature-subgroup-${sub.title}`)).toBeInTheDocument();
      for (const f of sub.features) {
        expect(screen.getByTestId(`feature-row-${f.key}`)).toBeInTheDocument();
      }
    }
    expect(children.querySelectorAll('[data-testid^="feature-row-"]')).toHaveLength(bigGroup.children.length);
  });

  it("subgroup indentation never regresses", () => {
    render(<FeaturesPanel />);
    expand(bigGroup.title);
    const sub = groupChildrenByAdminGroup(bigGroup.children)[0];
    const list = screen.getByTestId(`feature-subgroup-${sub.title}`).querySelector("ul")!;
    expect(list.className).toMatch(/\bpl-\d/);
    expect(list.className).toContain("divide-y");
  });

  it("rows stay mobile-safe: wrap on small widths, single line from sm up", () => {
    render(<FeaturesPanel />);
    expand(bigGroup.title);

    const pageRow = screen.getAllByTestId("feature-group")[0].firstElementChild as HTMLElement;
    expect(pageRow.className).toContain("flex-wrap");
    expect(pageRow.className).toContain("sm:flex-nowrap");

    const childRow = screen.getByTestId(`feature-row-${bigGroup.children[0].key}`);
    expect(childRow.className).toContain("flex-wrap");
    expect(childRow.className).toContain("sm:flex-nowrap");

    // Long keys/descriptions must be clamped/truncated so nothing overflows x.
    expect(childRow.querySelector(".truncate")).toBeTruthy();
    expect(childRow.querySelector(".line-clamp-2")).toBeTruthy();
  });

  it("access selects keep a consistent fixed-width tap target", () => {
    render(<FeaturesPanel />);
    expand(bigGroup.title);
    const trigger = screen.getByLabelText(`Required access for ${bigGroup.children[0].name}`);
    expect(trigger.className).toContain("w-[136px]");
    expect(trigger.className).toContain("h-9");
  });

  it("collapsing a group removes its child rows again", () => {
    render(<FeaturesPanel />);
    expand(bigGroup.title);
    expect(screen.getByTestId(`feature-group-children-${bigGroup.id}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Collapse ${bigGroup.title}`, "i") }));
    expect(screen.queryByTestId(`feature-group-children-${bigGroup.id}`)).not.toBeInTheDocument();
  });
});
