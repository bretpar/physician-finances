import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SourceEmployerCombobox } from "./SourceEmployerCombobox";
import type { IncomeSource } from "@/hooks/useIncomeSources";

const codexBusiness: IncomeSource = {
  id: "src-codex-1099",
  name: "Codex 1099 Test Business",
  nickname: "Codex (consulting)",
  source_kind: "1099_schedule_c",
  company_type: "1099_schedule_c",
};

vi.mock("@/hooks/useIncomeSources", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useIncomeSources")>(
    "@/hooks/useIncomeSources",
  );
  return {
    ...actual,
    useIncomeSources: () => ({ data: [codexBusiness] }),
    useCreateIncomeSource: () => ({ mutateAsync: vi.fn() }),
  };
});

/**
 * Tiny harness that mirrors the ProjectedIncome submit-enable rule:
 *   disabled if paycheck_amount <= 0 OR (no source_id AND no free-text name)
 */
function PlannerHarness() {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("");
  const [income, setIncome] = useState("");
  const num = (v: string) => Number(v) || 0;
  const disabled = num(income) <= 0 || (!sourceId && !otherName.trim());

  return (
    <div>
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
      <input
        aria-label="expected-income"
        value={income}
        onChange={(e) => setIncome(e.target.value)}
      />
      <button disabled={disabled}>Add Stream</button>
    </div>
  );
}

describe("SourceEmployerCombobox — 1099 business display + Planner submit", () => {
  function renderHarness() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <PlannerHarness />
      </QueryClientProvider>,
    );
  }

  it("lists existing 1099 business by primary name with nickname secondary", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("combobox"));
    // Primary line = legal/business name
    expect(screen.getByText("Codex 1099 Test Business")).toBeInTheDocument();
    // Secondary line = nickname (only when distinct from name)
    expect(screen.getByText("Codex (consulting)")).toBeInTheDocument();
  });

  it("enables Add Stream after selecting the business and entering income", () => {
    renderHarness();
    const addBtn = screen.getByRole("button", { name: /add stream/i });
    expect(addBtn).toBeDisabled();

    // Select the 1099 business.
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Codex 1099 Test Business"));

    // Selecting alone is not enough — income must be > 0 too.
    expect(addBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("expected-income"), { target: { value: "120000" } });
    expect(addBtn).toBeEnabled();
  });
});
