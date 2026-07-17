import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  registerTaxEstimateConsumer,
  assertNoDrift,
  __diagnosticsInternal,
} from "@/lib/taxEngineDiagnostics";
import type { TaxDebugBreakdown } from "@/lib/taxCalculationService";

function enable(on: boolean) {
  if (on) window.localStorage.setItem("debug:taxEngine", "1");
  else window.localStorage.removeItem("debug:taxEngine");
}

const stubDebug = (n: number) => ({ marker: n } as unknown as TaxDebugBreakdown);

describe("taxEngineDiagnostics", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __diagnosticsInternal.reset();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    enable(false);
    warn.mockRestore();
  });

  it("is a no-op when disabled", () => {
    enable(false);
    const d = stubDebug(1);
    registerTaxEstimateConsumer("a", "actual", d);
    registerTaxEstimateConsumer("b", "actual", stubDebug(2));
    assertNoDrift("Page", "agi", 100, 200);
    expect(warn).not.toHaveBeenCalled();
    expect(__diagnosticsInternal.snapshot("actual").consumers.length).toBe(0);
  });

  it("registers consumers when enabled", () => {
    enable(true);
    const d = stubDebug(1);
    registerTaxEstimateConsumer("consumerA", "actual", d);
    registerTaxEstimateConsumer("consumerA", "actual", d);
    expect(__diagnosticsInternal.snapshot("actual").consumers).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when two consumers hold different debug identities for the same scope", () => {
    enable(true);
    registerTaxEstimateConsumer("first", "actual", stubDebug(1));
    registerTaxEstimateConsumer("second", "actual", stubDebug(2));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/multiple debug identities/);
  });

  it("assertNoDrift only warns above tolerance", () => {
    enable(true);
    assertNoDrift("Dashboard", "agi", 100.5, 100); // within $1
    expect(warn).not.toHaveBeenCalled();
    assertNoDrift("Dashboard", "agi", 105, 100);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/drift page=Dashboard field=agi/);
  });

  it("assertNoDrift honors rate tolerance", () => {
    enable(true);
    assertNoDrift("Taxes", "effectiveRate", 24.005, 24.0, { isRate: true });
    expect(warn).not.toHaveBeenCalled();
    assertNoDrift("Taxes", "effectiveRate", 24.5, 24.0, { isRate: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
