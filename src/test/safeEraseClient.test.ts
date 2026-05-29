import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  clearSafeEraseBrowserStorage,
  invalidateSafeEraseQueries,
  shouldClearSafeEraseStorageKey,
} from "@/lib/safeErase";

describe("safe erase client cleanup", () => {
  it("clears app/onboarding/dashboard cache keys but preserves auth storage", () => {
    localStorage.clear();
    sessionStorage.clear();

    localStorage.setItem("paycheckmd:taxMode", "forecast");
    localStorage.setItem("paycheckmd-household-income-profile-reviewed", "true");
    localStorage.setItem("dashboard:annual-income", "132000");
    localStorage.setItem("w4.paycheck-adjustment", "true");
    localStorage.setItem("debug:withholding", "1");
    localStorage.setItem("sb-fiqnxprhvsadcqicczkg-auth-token", "keep-auth");
    sessionStorage.setItem("paycheckmd-onboarding-step", "3");

    clearSafeEraseBrowserStorage();

    expect(localStorage.getItem("paycheckmd:taxMode")).toBeNull();
    expect(localStorage.getItem("paycheckmd-household-income-profile-reviewed")).toBeNull();
    expect(localStorage.getItem("dashboard:annual-income")).toBeNull();
    expect(localStorage.getItem("w4.paycheck-adjustment")).toBeNull();
    expect(localStorage.getItem("debug:withholding")).toBeNull();
    expect(sessionStorage.getItem("paycheckmd-onboarding-step")).toBeNull();
    expect(localStorage.getItem("sb-fiqnxprhvsadcqicczkg-auth-token")).toBe("keep-auth");
  });

  it("invalidates the financial query families that can show stale W-2/tax data", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    await invalidateSafeEraseQueries(qc);

    expect(spy).toHaveBeenCalledWith({ queryKey: ["tax_settings"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["income_entries"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["personal_income_entries"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["ytd_catchup_entries"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["transactions"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["income_sources"] });
  });

  it("classifies only app cache keys for safe erase storage cleanup", () => {
    expect(shouldClearSafeEraseStorageKey("paycheckmd:erase-complete")).toBe(true);
    expect(shouldClearSafeEraseStorageKey("paycheckmd-dashboard-prev-total")).toBe(true);
    expect(shouldClearSafeEraseStorageKey("dashboard:w2-total")).toBe(true);
    expect(shouldClearSafeEraseStorageKey("w4.adjustment.hidden")).toBe(true);
    expect(shouldClearSafeEraseStorageKey("debug:taxBreakdown")).toBe(true);
    expect(shouldClearSafeEraseStorageKey("sb-project-auth-token")).toBe(false);
  });
});