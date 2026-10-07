import { describe, it, expect, vi } from "vitest";
import { runAccountDeletion } from "../../supabase/functions/account-cleanup/deletion";

function fakeDb() {
  const rows = new Set(["income_entries", "transactions", "tax_settings", "profiles", "user_roles", "organization_members"]);
  let authFails = true;
  const critical = ["tax_settings", "profiles", "user_roles", "organization_members"];
  const steps = {
    deleteNoncritical: vi.fn(async () => { rows.delete("income_entries"); rows.delete("transactions"); return ["org-1"]; }),
    deleteAuthUser: vi.fn(async () => { if (authFails) throw new Error("timeout"); rows.add("auth_deleted"); }),
    deleteRouteCritical: vi.fn(async () => { critical.forEach((t) => rows.delete(t)); }),
  };
  return { rows, steps, critical, fixAuth: () => { authFails = false; } };
}

describe("account deletion recovery", () => {
  it("auth delete failure returns failure and keeps route-critical rows", async () => {
    const db = fakeDb();
    const r = await runAccountDeletion(db.steps);
    expect(r).toEqual({ ok: false, failedStep: "auth" });
    expect(db.steps.deleteRouteCritical).not.toHaveBeenCalled();
    db.critical.forEach((t) => expect(db.rows.has(t)).toBe(true));
  });

  it("retry after partial cleanup succeeds and then removes route-critical rows", async () => {
    const db = fakeDb();
    await runAccountDeletion(db.steps);
    db.fixAuth();
    const r = await runAccountDeletion(db.steps);
    expect(r).toEqual({ ok: true, deletedOrganizations: 1 });
    db.critical.forEach((t) => expect(db.rows.has(t)).toBe(false));
  });

  it("data-step failure never reaches auth deletion", async () => {
    const db = fakeDb();
    db.steps.deleteNoncritical.mockRejectedValueOnce(new Error("db"));
    const r = await runAccountDeletion(db.steps);
    expect(r).toEqual({ ok: false, failedStep: "data" });
    expect(db.steps.deleteAuthUser).not.toHaveBeenCalled();
  });
});
