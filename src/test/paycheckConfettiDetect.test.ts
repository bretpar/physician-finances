import { describe, it, expect } from "vitest";
import { detectNewIncome, type NewIncomeCandidate } from "@/components/dashboard/PaycheckConfetti";

const row = (id: string, createdAt: string, source: "personal" | "business" = "personal", date = "2026-01-01"): NewIncomeCandidate =>
  ({ id, amount: 1000, date, createdAt, source });

describe("detectNewIncome", () => {
  const hist = [row("a", "2026-09-01T00:00:00Z"), row("b", "2026-09-10T00:00:00Z")];
  it("never fires on first load / missing baseline", () => {
    const r = detectNewIncome(hist, null);
    expect(r.fresh).toEqual([]);
    expect(r.nextBaseline).toBe("2026-09-10T00:00:00.000Z");
  });
  it("ignores reordering of existing records", () => {
    expect(detectNewIncome([...hist].reverse(), "2026-09-10T00:00:00.000Z").fresh).toEqual([]);
  });
  it("fires for a newly created row even with an old income date", () => {
    const r = detectNewIncome([...hist, row("c", "2026-09-20T00:00:00Z", "business", "2025-03-01")], "2026-09-10T00:00:00.000Z");
    expect(r.fresh.map((f) => f.id)).toEqual(["c"]);
    expect(r.fresh[0].source).toBe("business");
  });
  it("returns every new row in a batch", () => {
    const r = detectNewIncome([...hist, row("c", "2026-09-20T00:00:00Z"), row("d", "2026-09-20T00:00:01Z")], "2026-09-10T00:00:00.000Z");
    expect(r.fresh.map((f) => f.id)).toEqual(["d", "c"]);
  });
});
