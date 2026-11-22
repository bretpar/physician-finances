import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FsaDeductionsSection } from "@/components/settings/FsaDeductionsSection";

const mocks = vi.hoisted(() => ({ update: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/contexts/CompanyContext", () => ({ useCompanies: () => ({ companies: [{ id: "co", name: "Employer", companyType: "w2", advancedFieldVisibility: { other_metadata: true, fsa_deductions: { health: { enabled: true, perPaycheck: 100 } } } }], closedCompanyIds: new Set(), updateCompany: mocks.update }) }));
vi.mock("@/hooks/usePersonalIncome", () => ({ usePersonalIncomeEntries: () => ({ data: [] }) }));
vi.mock("@/hooks/useTaxSettings", () => ({ useTaxSettings: () => ({ data: { filingStatus: "single" } }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/components/settings/SectionCard", () => ({ SectionCard: ({ children }: { children: React.ReactNode }) => <section>{children}</section> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("FSA failed-save protection", () => {
  it("retains the draft and other metadata until confirmed persistence", async () => {
    mocks.update.mockRejectedValueOnce(new Error("Database unavailable")).mockResolvedValueOnce(undefined);
    render(<FsaDeductionsSection />);
    const amount = screen.getByDisplayValue("100");
    fireEvent.change(amount, { target: { value: "125" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
    expect((amount as HTMLInputElement).value).toBe("125");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[1][1].advancedFieldVisibility).toMatchObject({ other_metadata: true, fsa_deductions: { health: { perPaycheck: 125 } } });
  });
});