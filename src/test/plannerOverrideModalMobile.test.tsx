import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import {
  Dialog,
  DialogContent,
  DialogStickyHeader,
  DialogTitle,
  DialogBody,
  DialogStickyFooter,
} from "@/components/ui/dialog";

/**
 * Mobile ergonomics for the Income Planner → Edit Income modal:
 * sticky header, independently scrollable body, sticky footer that clears
 * the iOS safe area, viewport-bounded height, and no horizontal scroll.
 */

function Shell() {
  return (
    <Dialog open>
      <DialogContent scrollable className="sm:max-w-md">
        <DialogStickyHeader>
          <DialogTitle>Edit Income</DialogTitle>
        </DialogStickyHeader>
        <DialogBody data-testid="body">fields</DialogBody>
        <DialogStickyFooter data-testid="footer">actions</DialogStickyFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("scrollable dialog shell", () => {
  it("bounds the dialog to the visible viewport and hides overflow", () => {
    render(<Shell />);
    const content = screen.getByRole("dialog");
    expect(content.className).toContain("max-h-[calc(100dvh-3rem)]");
    expect(content.className).toContain("flex-col");
    expect(content.className).toContain("overflow-hidden");
    // Full-screen on phones only — desktop keeps the centered card.
    expect(content.className).toContain("max-sm:h-[100dvh]");
    expect(content.className).toContain("sm:max-w-md");
  });

  it("scrolls the body vertically but never horizontally", () => {
    render(<Shell />);
    const body = screen.getByTestId("body");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("overflow-x-hidden");
    expect(body.className).toContain("min-h-0");
    expect(body.className).toContain("flex-1");
  });

  it("keeps header and footer fixed and clears the iOS safe areas", () => {
    render(<Shell />);
    const footer = screen.getByTestId("footer");
    expect(footer.className).toContain("shrink-0");
    expect(footer.className).toContain("env(safe-area-inset-bottom)");
    const header = screen.getByText("Edit Income").parentElement!;
    expect(header.className).toContain("shrink-0");
    expect(header.className).toContain("env(safe-area-inset-top)");
  });

  it("keeps the close button reachable below the top safe area", () => {
    render(<Shell />);
    const close = screen.getByRole("button", { name: /close/i });
    expect(close.className).toContain("env(safe-area-inset-top)");
  });
});

describe("Income Planner Edit Income modal wiring", () => {
  const src = readFileSync("src/pages/ProjectedIncome.tsx", "utf8");
  const modal = src.slice(src.indexOf("{/* Override Edit Dialog */}"), src.indexOf("{/* Bonus Edit Dialog */}"));

  it("uses the shared scrollable shell", () => {
    expect(modal).toContain("<DialogContent scrollable");
    expect(modal).toContain("<DialogStickyHeader>");
    expect(modal).toContain("<DialogBody");
    expect(modal).toContain("<DialogStickyFooter>");
  });

  it("no longer relies on a plain non-scrolling body", () => {
    expect(modal).not.toContain('<DialogContent className="sm:max-w-md"');
    expect(modal).not.toContain("<DialogFooter>");
  });

  it("still renders the detailed breakdown inside the scrollable body", () => {
    const body = modal.slice(modal.indexOf("<DialogBody"), modal.indexOf("</DialogBody>"));
    expect(body).toContain("Add detailed tax &amp; deduction breakdown");
    expect(body).toContain("Additional Tax Reserve");
    expect(body).toContain("Est. take-home:");
  });
});
