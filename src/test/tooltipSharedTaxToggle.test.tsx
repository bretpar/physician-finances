import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  InfoTooltip,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Regression: every shared tax tooltip must toggle identically on mobile.
 *
 * Codex reproduced (390x844) that "Covered" toggled closed on a second tap but
 * "Paid" sometimes stayed open. Root cause: Radix's own Root/Trigger handlers
 * (focus in particular) re-opened the tooltip right after our tap closed it,
 * so behavior depended on whether the trigger already held focus. The primitive
 * now ignores Radix-initiated open changes on mobile.
 *
 * These tests drive MULTIPLE tooltip instances — modelled on the real Quarterly
 * Tax Progress consumers (Covered so far / Paid / Saved / Q3 tax target) — so
 * the behavior is proven to be identical across all of them.
 */
Object.defineProperty(window, "innerWidth", { writable: true, value: 390 });

const LABELS = ["Covered so far", "Paid", "Saved", "Q3 tax target"] as const;

function tap(el: Element) {
  // A real touch tap: pointerdown, then focus (this is what broke Paid), then click.
  fireEvent.pointerDown(el, { pointerType: "touch", bubbles: true });
  fireEvent.focus(el, { bubbles: true });
  fireEvent.click(el, { pointerType: "touch", bubbles: true, detail: 0 });
}

function tapOutside() {
  fireEvent.pointerDown(document.body, { pointerType: "touch", bubbles: true });
}

function QuarterlyTooltips({ onRowClick }: { onRowClick?: () => void } = {}) {
  return (
    <TooltipProvider>
      <div data-testid="row" onClick={onRowClick}>
        {LABELS.map((label) => (
          <Tooltip key={label}>
            <TooltipTrigger aria-label={`${label} info`}>{label}</TooltipTrigger>
            <TooltipContent>{`${label} explanation`}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

const isOpen = (label: string) =>
  screen.queryAllByText(`${label} explanation`).length > 0;

describe("shared tax tooltips: identical mobile toggle behavior", () => {
  it.each(LABELS)("%s opens on tap and closes on a second tap", (label) => {
    render(<QuarterlyTooltips />);
    const trigger = screen.getByLabelText(`${label} info`);
    tap(trigger);
    expect(isOpen(label)).toBe(true);
    tap(trigger);
    expect(isOpen(label)).toBe(false);
  });

  it.each(LABELS)("%s still toggles closed after repeated tap cycles", (label) => {
    render(<QuarterlyTooltips />);
    const trigger = screen.getByLabelText(`${label} info`);
    for (let i = 0; i < 3; i++) {
      tap(trigger);
      expect(isOpen(label)).toBe(true);
      tap(trigger);
      expect(isOpen(label)).toBe(false);
    }
  });

  it("only one tooltip is open at a time across all consumers", () => {
    render(<QuarterlyTooltips />);
    for (const label of LABELS) {
      tap(screen.getByLabelText(`${label} info`));
      expect(isOpen(label)).toBe(true);
      for (const other of LABELS.filter((l) => l !== label)) {
        expect(isOpen(other)).toBe(false);
      }
    }
  });

  it("tapping outside closes the open tooltip", () => {
    render(<QuarterlyTooltips />);
    tap(screen.getByLabelText("Paid info"));
    expect(isOpen("Paid")).toBe(true);
    tapOutside();
    expect(isOpen("Paid")).toBe(false);
  });

  it("interacting inside the tooltip keeps it open", () => {
    render(<QuarterlyTooltips />);
    tap(screen.getByLabelText("Saved info"));
    const body = screen.getAllByText("Saved explanation")[0];
    fireEvent.pointerDown(body, { pointerType: "touch", bubbles: true });
    expect(isOpen("Saved")).toBe(true);
  });

  it("never activates the underlying row", () => {
    const onRowClick = vi.fn();
    render(<QuarterlyTooltips onRowClick={onRowClick} />);
    tap(screen.getByLabelText("Covered so far info"));
    tap(screen.getByLabelText("Paid info"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("a focus event alone never re-opens a closed tooltip", () => {
    render(<QuarterlyTooltips />);
    const trigger = screen.getByLabelText("Paid info");
    tap(trigger);
    tap(trigger);
    expect(isOpen("Paid")).toBe(false);
    fireEvent.focus(trigger, { bubbles: true });
    fireEvent.pointerEnter(trigger, { pointerType: "touch", bubbles: true });
    expect(isOpen("Paid")).toBe(false);
  });

  it("InfoTooltip consumers share the same toggle behavior", () => {
    render(
      <>
        <InfoTooltip label="reserve info">Reserve body</InfoTooltip>
        <InfoTooltip label="payroll info">Payroll body</InfoTooltip>
      </>,
    );
    const a = screen.getByLabelText("reserve info");
    tap(a);
    expect(screen.queryAllByText("Reserve body").length).toBeGreaterThan(0);
    tap(a);
    expect(screen.queryByText("Reserve body")).not.toBeInTheDocument();
    tap(a);
    tap(screen.getByLabelText("payroll info"));
    expect(screen.queryByText("Reserve body")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Payroll body").length).toBeGreaterThan(0);
  });
});
