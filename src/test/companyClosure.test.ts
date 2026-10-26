import { describe, it, expect } from "vitest";
import { closedCompanyIdsOn, isClosedOn, selectableForEntry, type ClosurePeriod } from "@/lib/companyClosure";

const periods: ClosurePeriod[] = [
  { id: "1", companyId: "a", closedOn: "2026-03-01", reopenedOn: "2026-06-01" },
  { id: "2", companyId: "b", closedOn: "2026-09-15", reopenedOn: null },
];
const companies = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("company closure", () => {
  it("closure starts on the closure date and ends on the reopen date", () => {
    expect(isClosedOn(periods, "a", "2026-02-28")).toBe(false);
    expect(isClosedOn(periods, "a", "2026-03-01")).toBe(true);
    expect(isClosedOn(periods, "a", "2026-06-01")).toBe(false);
  });

  it("an unreopened company stays closed", () => {
    expect([...closedCompanyIdsOn(periods, "2026-10-26")]).toEqual(["b"]);
  });

  it("closed companies are hidden from new-entry pickers", () => {
    const closed = closedCompanyIdsOn(periods, "2026-10-26");
    expect(selectableForEntry(companies, closed).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("an existing record keeps its closed company, and late payments can choose it", () => {
    const closed = closedCompanyIdsOn(periods, "2026-10-26");
    expect(selectableForEntry(companies, closed, { currentId: "b" }).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(selectableForEntry(companies, closed, { includeClosed: true })).toHaveLength(3);
  });
});
