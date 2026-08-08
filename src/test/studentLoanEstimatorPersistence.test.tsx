import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const server: { studentLoanEstimatorEnabled: boolean } = { studentLoanEstimatorEnabled: false };
const mutateAsync = vi.fn(async (vars: any) => {
  if (vars.__fail) throw new Error("save failed");
  server.studentLoanEstimatorEnabled = vars.studentLoanEstimatorEnabled;
});

vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({
    data: { id: "s1", studentLoanEstimatorEnabled: server.studentLoanEstimatorEnabled },
    isLoading: false,
  }),
  useUpdateTaxSettings: () => ({ mutateAsync, mutate: mutateAsync, isPending: false }),
}));

import { StudentLoanEstimatorToggleSection } from "@/components/settings/StudentLoanEstimatorToggleSection";

async function toggle() {
  render(<StudentLoanEstimatorToggleSection bare />);
  const sw = screen.getByTestId("student-loan-estimator-switch");
  await userEvent.click(sw);
  return sw;
}

describe("Student Loan Estimator preference persistence", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    server.studentLoanEstimatorEnabled = false;
  });

  it("OFF → ON writes true to the canonical field", async () => {
    await toggle();
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: "s1", studentLoanEstimatorEnabled: true }),
      ),
    );
    expect(server.studentLoanEstimatorEnabled).toBe(true);
  });

  it("ON → OFF writes false", async () => {
    server.studentLoanEstimatorEnabled = true;
    await toggle();
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ studentLoanEstimatorEnabled: false }),
      ),
    );
    expect(server.studentLoanEstimatorEnabled).toBe(false);
  });

  it("re-reads the refetched server value (simulated re-login)", async () => {
    await toggle();
    await waitFor(() => expect(server.studentLoanEstimatorEnabled).toBe(true));
    const { unmount } = render(<StudentLoanEstimatorToggleSection bare />);
    const switches = screen.getAllByTestId("student-loan-estimator-switch");
    expect(switches[switches.length - 1].getAttribute("data-state")).toBe("checked");
    unmount();
  });

  it("does not claim success and falls back to server truth when the save fails", async () => {
    mutateAsync.mockImplementationOnce(async () => {
      throw new Error("save failed");
    });
    const sw = await toggle();
    await waitFor(() => expect(sw.getAttribute("data-state")).toBe("unchecked"));
    expect(server.studentLoanEstimatorEnabled).toBe(false);
  });
});
