import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { CompanyProvider, useCompanies } from "@/contexts/CompanyContext";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ single: vi.fn(), update: vi.fn(), error: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ update: (payload: unknown) => { mocks.update(payload); return { eq: () => ({ select: () => ({ single: mocks.single }) }) }; } }) } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Company settings write failures", () => {
  it("rejects a failed database update so settings cannot report success", async () => {
    mocks.single.mockResolvedValue({ data: null, error: new Error("Write denied") });
    const { result } = renderHook(useCompanies, { wrapper: ({ children }: { children: ReactNode }) => <CompanyProvider>{children}</CompanyProvider> });
    await expect(result.current.updateCompany("co", { notes: "Unchanged draft" })).rejects.toThrow("Write denied");
    expect(mocks.update).toHaveBeenCalledWith({ notes: "Unchanged draft" });
  });
  it("rejects a zero-row write instead of silently losing settings", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(useCompanies, { wrapper: ({ children }: { children: ReactNode }) => <CompanyProvider>{children}</CompanyProvider> });
    await expect(result.current.updateCompany("missing", { notes: "Draft" })).rejects.toThrow("not saved");
  });
});