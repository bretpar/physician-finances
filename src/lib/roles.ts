/**
 * Centralized account-role model for PaycheckMD.
 *
 * A user has exactly ONE account-level role, resolved server-side by the
 * `get_my_account_role()` database function (which reads the existing
 * `user_roles` table and maps legacy admin/super_admin rows to `developer`).
 *
 * Never compare roles inline in components — use the helpers here or the
 * `useAccountRole()` hook.
 */

export type AccountRole = "free" | "premium" | "premium_beta" | "developer";

export const DEFAULT_ACCOUNT_ROLE: AccountRole = "free";

/** Higher number = more access. Hierarchy is strictly ordered. */
const ROLE_RANK: Record<AccountRole, number> = {
  free: 0,
  premium: 1,
  premium_beta: 2,
  developer: 3,
};

export const ACCOUNT_ROLE_LABEL: Record<AccountRole, string> = {
  free: "Free",
  premium: "Premium",
  premium_beta: "Premium Beta",
  developer: "Developer",
};

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === "string" && value in ROLE_RANK;
}

/** Coerce any unknown/legacy value to a safe role. */
export function normalizeAccountRole(value: unknown): AccountRole {
  if (isAccountRole(value)) return value;
  // Legacy elevated roles keep their elevated access.
  if (value === "super_admin" || value === "admin") return "developer";
  return DEFAULT_ACCOUNT_ROLE;
}

export function hasAtLeastRole(role: AccountRole | null | undefined, required: AccountRole): boolean {
  if (!isAccountRole(role)) return required === "free";
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export function canAccessFree(role: AccountRole | null | undefined): boolean {
  return hasAtLeastRole(role, "free");
}

export function canAccessPremium(role: AccountRole | null | undefined): boolean {
  return hasAtLeastRole(role, "premium");
}

export function canAccessBeta(role: AccountRole | null | undefined): boolean {
  return hasAtLeastRole(role, "premium_beta");
}

export function isDeveloper(role: AccountRole | null | undefined): boolean {
  return hasAtLeastRole(role, "developer");
}

export interface RoleAccess {
  role: AccountRole;
  canAccessFree: boolean;
  canAccessPremium: boolean;
  canAccessBeta: boolean;
  isDeveloper: boolean;
}

export function getRoleAccess(role: AccountRole | null | undefined): RoleAccess {
  const normalized = normalizeAccountRole(role);
  return {
    role: normalized,
    canAccessFree: canAccessFree(normalized),
    canAccessPremium: canAccessPremium(normalized),
    canAccessBeta: canAccessBeta(normalized),
    isDeveloper: isDeveloper(normalized),
  };
}
