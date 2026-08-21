import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DateField } from "@/components/DateField";
import { SourceEmployerCombobox } from "@/components/SourceEmployerCombobox";
import type { IncomeSource } from "@/hooks/useIncomeSources";

const employer: IncomeSource = {
  id: "src-w2",
  name: "Optum",
  nickname: null as unknown as string,
  source_kind: "w2_employer",
  company_type: "w2_employer",
} as IncomeSource;

vi.mock("@/hooks/useIncomeSources", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useIncomeSources")>(
    "@/hooks/useIncomeSources",
  );
  return {
    ...actual,
    useIncomeSources: () => ({ data: [employer], refetch: vi.fn() }),
    useCreateIncomeSource: () => ({ mutateAsync: vi.fn() }),
  };
});

/** Mirrors the Add Planned Income form: a date picker + a company combobox. */
function Harness() {
  const [date, setDate] = useState("2026-08-15");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("");
  return (
    <div>
      <DateField value={date} onChange={setDate} />
      <SourceEmployerCombobox
        sourceId={sourceId}
        otherName={otherName}
        saveAsNew={false}
        newSourceKind={null}
        onChange={(next) => {
          setSourceId(next.sourceId);
          setOtherName(next.otherName);
        }}
      />
      <output data-testid="date-value">{date}</output>
    </div>
  );
}

function renderHarness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
}

const dateTrigger = () => screen.getByRole("button", { name: /Aug \d+, 2026/ });
const companyTrigger = () => screen.getByTestId("paycheck-employer-trigger");
const calendarOpen = () => screen.queryAllByRole("grid").length > 0;
const listOpen = () => screen.queryAllByTestId(/^paycheck-employer-option-/).length > 0;

describe("Add Planned Income pickers — dismissal", () => {
  it("closes the calendar as soon as a day is picked", () => {
    renderHarness();
    fireEvent.click(dateTrigger());
    expect(calendarOpen()).toBe(true);
    fireEvent.click(screen.getByRole("gridcell", { name: "10" }));
    expect(calendarOpen()).toBe(false);
    expect(screen.getByTestId("date-value").textContent).toBe("2026-08-10");
  });

  it("re-tapping the selected day closes without clearing the value", () => {
    renderHarness();
    fireEvent.click(dateTrigger());
    fireEvent.click(screen.getByRole("gridcell", { name: "15" }));
    expect(calendarOpen()).toBe(false);
    expect(screen.getByTestId("date-value").textContent).toBe("2026-08-15");
  });

  it("Escape closes the calendar and keeps the current selection", () => {
    renderHarness();
    fireEvent.click(dateTrigger());
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(calendarOpen()).toBe(false);
    expect(screen.getByTestId("date-value").textContent).toBe("2026-08-15");
  });

  it("closes the company list immediately after choosing an employer", () => {
    renderHarness();
    fireEvent.click(companyTrigger());
    expect(listOpen()).toBe(true);
    fireEvent.click(screen.getByTestId("paycheck-employer-option-src-w2"));
    expect(listOpen()).toBe(false);
    expect(companyTrigger().textContent).toContain("Optum");
  });

  it("opening the company list closes an open calendar (one picker at a time)", () => {
    renderHarness();
    fireEvent.click(dateTrigger());
    expect(calendarOpen()).toBe(true);
    fireEvent.click(companyTrigger());
    expect(calendarOpen()).toBe(false);
    expect(listOpen()).toBe(true);
  });

  it("opening the calendar closes an open company list", () => {
    renderHarness();
    fireEvent.click(companyTrigger());
    expect(listOpen()).toBe(true);
    fireEvent.click(dateTrigger());
    expect(listOpen()).toBe(false);
    expect(calendarOpen()).toBe(true);
  });

  it("leaves no picker layer mounted once everything is closed", () => {
    renderHarness();
    fireEvent.click(dateTrigger());
    fireEvent.click(screen.getByRole("gridcell", { name: "10" }));
    expect(document.querySelectorAll("[data-radix-popper-content-wrapper]").length).toBe(0);
  });
});
