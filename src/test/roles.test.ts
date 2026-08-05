import { describe, expect, it } from "vitest";
import {
  canAccessBeta,
  canAccessFree,
  canAccessPremium,
  getRoleAccess,
  isDeveloper,
  normalizeAccountRole,
  accountRoleToSubscriptionTier,
  type AccountRole,
} from "@/lib/roles";

const ROLES: AccountRole[] = ["free", "premium", "premium_beta", "developer"];

describe("account role hierarchy", () => {
  it("grants free content to every role", () => {
    for (const role of ROLES) expect(canAccessFree(role)).toBe(true);
  });

  it("returns expected access for all four roles", () => {
    expect(getRoleAccess("free")).toMatchObject({ canAccessPremium: false, canAccessBeta: false, isDeveloper: false });
    expect(getRoleAccess("premium")).toMatchObject({ canAccessPremium: true, canAccessBeta: false, isDeveloper: false });
    expect(getRoleAccess("premium_beta")).toMatchObject({ canAccessPremium: true, canAccessBeta: true, isDeveloper: false });
    expect(getRoleAccess("developer")).toMatchObject({ canAccessPremium: true, canAccessBeta: true, isDeveloper: true });
  });

  it("defaults unknown/missing values safely to free", () => {
    expect(normalizeAccountRole(undefined)).toBe("free");
    expect(normalizeAccountRole(null)).toBe("free");
    expect(normalizeAccountRole("wizard")).toBe("free");
    expect(canAccessPremium(undefined)).toBe(false);
    expect(isDeveloper(null)).toBe(false);
  });

  it("keeps legacy elevated roles elevated", () => {
    expect(normalizeAccountRole("super_admin")).toBe("developer");
    expect(normalizeAccountRole("admin")).toBe("developer");
  });

  it("only developers pass the developer gate", () => {
    expect(ROLES.filter(isDeveloper)).toEqual(["developer"]);
    expect(ROLES.filter(canAccessBeta)).toEqual(["premium_beta", "developer"]);
  });
});

describe("role → entitlement tier mapping", () => {
  it("grants PREMIUM to premium and above, FREE otherwise", () => {
    expect(accountRoleToSubscriptionTier("free")).toBe("FREE");
    expect(accountRoleToSubscriptionTier("premium")).toBe("PREMIUM");
    expect(accountRoleToSubscriptionTier("premium_beta")).toBe("PREMIUM");
    expect(accountRoleToSubscriptionTier("developer")).toBe("PREMIUM");
    expect(accountRoleToSubscriptionTier(undefined)).toBe("FREE");
    expect(accountRoleToSubscriptionTier("wizard" as never)).toBe("FREE");
  });
});
