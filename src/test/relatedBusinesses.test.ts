import { describe, it, expect } from "vitest";
import { computeRetirementRoomView } from "@/lib/retirementRoomView";
import type { BusinessRelationship } from "@/lib/businessRelationships";

const rel = (r: BusinessRelationship | null) => r;
const group = (limit: number | null = null) =>
  rel({ status: "related", groupId: "g1", groupName: "My practices", sharedAnnualLimit: limit });
const mk = (id: string, r: BusinessRelationship | null) => ({
  id, name: id, companyType: "1099_schedule_c", employeeRole: "primary" as const, retirementRelationship: r,
});
const run = (a: BusinessRelationship | null, b: BusinessRelationship | null, extra: any[] = []) =>
  computeRetirementRoomView({
    taxYear: 2026,
    filingStatus: "married_filing_jointly",
    companies: [mk("a", a), mk("b", b), ...extra],
    paychecks: [],
    standalone: [],
    ira: { traditionalContributed: 0, rothContributed: 0 },
    actualNetProfitByCompany: new Map([["a", 300_000], ["b", 300_000], ["c", 50_000]]),
    includeProjection: false,
  });
const cap = (v: ReturnType<typeof run>) =>
  v.engine.plans.reduce((s, p) => s + (p.employerCapacityRemaining ?? 0), 0);

describe("related businesses", () => {
  it("unknown relationship stays unverified", () => {
    const v = run(null, null);
    expect(v.engine.plans.every((p) => p.capacityUnverified)).toBe(true);
  });

  it("businesses confirmed not related keep separate room and count in the headline", () => {
    const v = run({ status: "unrelated" }, { status: "unrelated" });
    expect(v.engine.plans.some((p) => p.capacityUnverified)).toBe(false);
    // Each business high-earning: each capped at its own §415(c) limit.
    const single = v.engine.plans[0].annualAdditionsLimit!;
    expect(cap(v)).toBeCloseTo(single * 2, 2);
    expect(v.headline.needsVerificationPlanIds).toHaveLength(0);
  });

  it("related group shares one combined annual limit", () => {
    const v = run(group(), group());
    expect(v.engine.plans.some((p) => p.capacityUnverified)).toBe(false);
    expect(cap(v)).toBeCloseTo(v.engine.plans[0].annualAdditionsLimit!, 2);
    expect(v.engine.plans.filter((p) => (p.employerCapacityRemaining ?? 0) > 0)).toHaveLength(1);
  });

  it("recorded annual total limit caps the group", () => {
    const v = run(group(50_000), group(50_000));
    expect(cap(v)).toBeCloseTo(50_000, 2);
  });

  it("a group stays unverified while another business is unknown", () => {
    const v = run(group(), group(), [mk("c", null)]);
    expect(v.engine.plans.every((p) => p.capacityUnverified)).toBe(true);
  });
});
