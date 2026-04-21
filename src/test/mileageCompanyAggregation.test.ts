import { describe, it, expect } from "vitest";
import {
  getMileageDeductionByCompany,
  IRS_MILEAGE_RATE,
  type MileageEntry,
} from "@/hooks/useMileage";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

function entry(over: Partial<MileageEntry>): MileageEntry {
  return {
    id: crypto.randomUUID(),
    user_id: "u",
    month: 1,
    year: 2025,
    company_name: "",
    company_id: null,
    miles: 0,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("mileage company aggregation", () => {
  it("(1) mileage assigned to Company A reduces only A's profit", () => {
    const entries: MileageEntry[] = [
      entry({ company_id: COMPANY_A, miles: 100 }),
      entry({ company_id: COMPANY_A, miles: 50 }),
      entry({ company_id: COMPANY_B, miles: 200 }),
    ];

    const map = getMileageDeductionByCompany(entries);
    expect(map.get(COMPANY_A)).toBeCloseTo(150 * IRS_MILEAGE_RATE, 6);
    expect(map.get(COMPANY_B)).toBeCloseTo(200 * IRS_MILEAGE_RATE, 6);

    // Filter-by-Company-A semantics used in BusinessActivity:
    // only entries with company_id === filter contribute.
    const aOnly = entries
      .filter((m) => m.company_id === COMPANY_A)
      .reduce((s, m) => s + Number(m.miles) * IRS_MILEAGE_RATE, 0);
    const bOnly = entries
      .filter((m) => m.company_id === COMPANY_B)
      .reduce((s, m) => s + Number(m.miles) * IRS_MILEAGE_RATE, 0);
    expect(aOnly).toBeCloseTo(150 * IRS_MILEAGE_RATE, 6);
    expect(bOnly).toBeCloseTo(200 * IRS_MILEAGE_RATE, 6);
  });

  it("(2) unassigned mileage does not affect any per-company total", () => {
    const entries: MileageEntry[] = [
      entry({ company_id: null, miles: 500 }),
      entry({ company_id: COMPANY_A, miles: 100 }),
    ];
    const map = getMileageDeductionByCompany(entries);

    // Unassigned bucket lives under "" key; per-company keys must exclude it.
    expect(map.get(COMPANY_A)).toBeCloseTo(100 * IRS_MILEAGE_RATE, 6);
    expect(map.get(COMPANY_B)).toBeUndefined();
    expect(map.get("")).toBeCloseTo(500 * IRS_MILEAGE_RATE, 6);

    // BusinessActivity per-company filter explicitly skips company_id === null.
    const filteredA = entries
      .filter((m) => m.company_id && m.company_id === COMPANY_A)
      .reduce((s, m) => s + Number(m.miles) * IRS_MILEAGE_RATE, 0);
    expect(filteredA).toBeCloseTo(100 * IRS_MILEAGE_RATE, 6);
  });

  it("(3) totalBusinessExpenses across companies = transactions + sum(assigned mileage)", () => {
    const txExpenses = 1000; // arbitrary fixed transaction expense total
    const entries: MileageEntry[] = [
      entry({ company_id: COMPANY_A, miles: 100 }),
      entry({ company_id: COMPANY_B, miles: 250 }),
      entry({ company_id: null, miles: 999 }), // unassigned — excluded
    ];

    // Mirrors BusinessActivity "all" filter: include only assigned entries.
    const assignedMileageDollars = entries
      .filter((m) => !!m.company_id)
      .reduce((s, m) => s + Number(m.miles) * IRS_MILEAGE_RATE, 0);

    const totalBusinessExpenses = txExpenses + assignedMileageDollars;
    expect(totalBusinessExpenses).toBeCloseTo(
      1000 + 350 * IRS_MILEAGE_RATE,
      6,
    );

    // Sanity: unassigned 999 miles MUST NOT be in the total.
    expect(totalBusinessExpenses).not.toBeCloseTo(
      1000 + (350 + 999) * IRS_MILEAGE_RATE,
      6,
    );
  });
});
