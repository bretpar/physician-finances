import { describe, expect, it } from "vitest";
import { isLikelyTestAccount } from "@/lib/testAccounts";
import { applyAdminUserFilter, filterAdminUsers, type AdminUserRow } from "@/hooks/useAdminUsers";

const rows: AdminUserRow[] = [
  { userId: "1", email: "doc@clinic.com", displayName: "Real Doc", role: "free", createdAt: null, lastSignInAt: null },
  { userId: "2", email: "bp+qa@gmail.com", displayName: null, role: "premium", createdAt: null, lastSignInAt: null },
  { userId: "3", email: "bp+codex@gmail.com", displayName: null, role: "premium_beta", createdAt: null, lastSignInAt: null },
  { userId: "4", email: "dev@paycheckmd.com", displayName: "Dev", role: "developer", createdAt: null, lastSignInAt: null },
  { userId: "5", email: "e2e+abc@paycheckmd-e2e.test", displayName: null, role: "free", createdAt: null, lastSignInAt: null },
];

describe("test account indicator", () => {
  it("flags known test email patterns", () => {
    expect(isLikelyTestAccount("bp+codex@gmail.com")).toBe(true);
    expect(isLikelyTestAccount("bp+TEST@gmail.com")).toBe(true);
    expect(isLikelyTestAccount("bp+qa@gmail.com")).toBe(true);
    expect(isLikelyTestAccount("bp+lovable@gmail.com")).toBe(true);
    expect(isLikelyTestAccount("e2e+1@paycheckmd-e2e.test")).toBe(true);
  });

  it("does not flag ordinary accounts", () => {
    expect(isLikelyTestAccount("doc@clinic.com")).toBe(false);
    expect(isLikelyTestAccount("brendantparker@gmail.com")).toBe(false);
    expect(isLikelyTestAccount(null)).toBe(false);
    expect(isLikelyTestAccount("")).toBe(false);
  });
});

describe("admin user filters", () => {
  it("filters by each role", () => {
    expect(applyAdminUserFilter(rows, "all")).toHaveLength(5);
    expect(applyAdminUserFilter(rows, "free").map((r) => r.userId)).toEqual(["1", "5"]);
    expect(applyAdminUserFilter(rows, "premium").map((r) => r.userId)).toEqual(["2"]);
    expect(applyAdminUserFilter(rows, "premium_beta").map((r) => r.userId)).toEqual(["3"]);
    expect(applyAdminUserFilter(rows, "developer").map((r) => r.userId)).toEqual(["4"]);
  });

  it("filters likely test accounts only", () => {
    expect(applyAdminUserFilter(rows, "likely_test").map((r) => r.userId)).toEqual(["2", "3", "5"]);
  });

  it("composes with search without changing search behavior", () => {
    expect(applyAdminUserFilter(filterAdminUsers(rows, "codex"), "all").map((r) => r.userId)).toEqual(["3"]);
    expect(applyAdminUserFilter(filterAdminUsers(rows, "Real Doc"), "free").map((r) => r.userId)).toEqual(["1"]);
    expect(applyAdminUserFilter(filterAdminUsers(rows, "dev"), "likely_test")).toHaveLength(0);
  });
});
