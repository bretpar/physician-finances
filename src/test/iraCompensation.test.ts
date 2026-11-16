import { describe, it, expect } from "vitest";
import { eligibleIraW2Wages } from "@/lib/iraCompensation";

const pay = (companyId: string | null, wages = 100000, scheduled = false) => [{ companyId, wages, scheduled }];
const cos = [
  { id: "w2", companyType: "w2" },
  { id: "sw2", companyType: "scorp_w2" },
  { id: "dist", companyType: "scorp_distribution" },
  { id: "k1", companyType: "k1_partnership" },
  { id: "c", companyType: "1099_schedule_c" },
  { id: "none", companyType: null },
];

describe("IRA eligible W-2 wages", () => {
  it("passive K-1 entry → $0", () => expect(eligibleIraW2Wages(pay("k1"), cos)).toBe(0));
  it("S-corp distribution → $0", () => expect(eligibleIraW2Wages(pay("dist"), cos)).toBe(0));
  it("W-2 → $100,000", () => expect(eligibleIraW2Wages(pay("w2"), cos)).toBe(100000));
  it("S-corp W-2 wages → $100,000", () => expect(eligibleIraW2Wages(pay("sw2"), cos)).toBe(100000));
  it("Schedule C not counted as wages (profit path handles it)", () => expect(eligibleIraW2Wages(pay("c"), cos)).toBe(0));
  it("missing classification or company → $0", () => {
    expect(eligibleIraW2Wages(pay("none"), cos)).toBe(0);
    expect(eligibleIraW2Wages(pay(null), cos)).toBe(0);
  });
  it("scheduled paychecks excluded", () => expect(eligibleIraW2Wages(pay("w2", 100000, true), cos)).toBe(0));
});
