import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * UI-only behavior tests for the shared tooltip primitive.
 * No business logic is involved.
 */
function tap(el: Element) {
  fireEvent.pointerDown(el, { pointerType: "touch", bubbles: true });
  fireEvent.click(el, { pointerType: "touch", bubbles: true, detail: 0 });
}

function Harness({ onRowClick }: { onRowClick?: () => void }) {
  return (
    <TooltipProvider>
      <div onClick={onRowClick} data-testid="row">
        <Tooltip>
          <TooltipTrigger aria-label="info-a">A</TooltipTrigger>
          <TooltipContent>Tooltip A body</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger aria-label="info-b">B</TooltipTrigger>
          <TooltipContent>Tooltip B body</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

describe("shared tooltip: mobile tap behavior", () => {
  it("opens on a single tap", () => {
    render(<Harness />);
    tap(screen.getByLabelText("info-a"));
    expect(screen.getAllByText("Tooltip A body").length).toBeGreaterThan(0);
  });

  it("tapping the same trigger again closes it", () => {
    render(<Harness />);
    const trigger = screen.getByLabelText("info-a");
    tap(trigger);
    expect(screen.getAllByText("Tooltip A body").length).toBeGreaterThan(0);
    tap(trigger);
    expect(screen.queryByText("Tooltip A body")).not.toBeInTheDocument();
  });

  it("opening another tooltip closes the previous one", () => {
    render(<Harness />);
    tap(screen.getByLabelText("info-a"));
    tap(screen.getByLabelText("info-b"));
    expect(screen.queryByText("Tooltip A body")).not.toBeInTheDocument();
    expect(screen.getAllByText("Tooltip B body").length).toBeGreaterThan(0);
  });

  it("does not activate the underlying row on tap", () => {
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} />);
    tap(screen.getByLabelText("info-a"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("marks the trigger as non-selectable for touch browsers", () => {
    render(<Harness />);
    const cls = screen.getByLabelText("info-a").className;
    expect(cls).toContain("select-none");
    expect(cls).toContain("touch-callout");
  });
});
