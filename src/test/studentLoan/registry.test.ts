import { describe, it, expect } from "vitest";
import { PLANS, listPlans, getPlan, assertPlanSelectable, REGISTRY_VERSION } from "@/lib/studentLoan/rules/plans";

describe("student loan rules registry", () => {
  it("assigns a unique id, display name, source URL, and rules version to every plan", () => {
    const ids = new Set<string>();
    for (const p of PLANS) {
      expect(p.id).toBeTruthy();
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.displayName).toBeTruthy();
      expect(p.sourceUrl).toMatch(/^https?:\/\//);
      expect(p.sourceUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.rulesVersion).toBe(REGISTRY_VERSION);
      expect(["confirmed", "pending"]).toContain(p.verification);
    }
  });

  it("includes the July 2026 landscape (RAP, Tiered Standard) and marks SAVE closed / REPAYE historical", () => {
    expect(getPlan("rap")?.status).toBe("current");
    expect(getPlan("tiered_standard")?.status).toBe("current");
    expect(getPlan("save")?.status).toBe("closed");
    expect(getPlan("repaye")?.status).toBe("historical");
    expect(getPlan("ibr_new")?.status).toBe("legacy");
    expect(getPlan("ibr_old")?.status).toBe("legacy");
    expect(getPlan("icr")?.status).toBe("legacy");
    expect(getPlan("paye")?.status).toBe("legacy");
  });

  it("listPlans() excludes closed/historical by default and includes them when asked", () => {
    const selectable = listPlans().map((p) => p.id);
    expect(selectable).not.toContain("save");
    expect(selectable).not.toContain("repaye");
    const all = listPlans({ includeUnselectable: true }).map((p) => p.id);
    expect(all).toContain("save");
    expect(all).toContain("repaye");
  });

  it("assertPlanSelectable() rejects closed and historical plans", () => {
    expect(assertPlanSelectable(getPlan("save")!, {}).ok).toBe(false);
    expect(assertPlanSelectable(getPlan("repaye")!, {}).ok).toBe(false);
  });

  it("assertPlanSelectable() rejects RAP for Parent PLUS borrowers", () => {
    const chk = assertPlanSelectable(getPlan("rap")!, { isParentPlus: true });
    expect(chk.ok).toBe(false);
    expect(chk.reasons.join(" ")).toMatch(/Parent PLUS/i);
  });

  it("assertPlanSelectable() rejects legacy IDR plans for post-2026-07-01 loans", () => {
    const chk = assertPlanSelectable(getPlan("paye")!, {
      firstDisbursementDate: "2026-08-01",
      isParentPlus: false,
    });
    expect(chk.ok).toBe(false);
  });

  it("IBR new-vs-old differ on percent and forgiveness term", () => {
    const nw = getPlan("ibr_new")!;
    const old = getPlan("ibr_old")!;
    expect(nw.idrPercent).toBe(10);
    expect(nw.forgivenessMonths).toBe(240);
    expect(old.idrPercent).toBe(15);
    expect(old.forgivenessMonths).toBe(300);
  });
});
