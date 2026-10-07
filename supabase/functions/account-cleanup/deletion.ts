// Pure ordering for account deletion (no runtime imports so it is unit-testable).
// 1. Noncritical financial/content rows (idempotent deletes, safe to repeat).
// 2. Auth user. If this fails, route-critical rows are untouched so the user
//    stays signed in, can reach Settings, and can retry.
// 3. Route-critical rows (tax_settings, roles, membership, profile, orgs) —
//    only after auth deletion succeeded. Best effort; never flips success.
export const ACCOUNT_DELETE_FAILURE_MESSAGE =
  "We couldn't finish deleting your account. Your account is still active. Please try again.";

export interface AccountDeletionSteps {
  deleteNoncritical: () => Promise<string[]>;
  deleteAuthUser: () => Promise<void>;
  deleteRouteCritical: (ownedOrgIds: string[]) => Promise<void>;
}

export type AccountDeletionResult =
  | { ok: true; deletedOrganizations: number }
  | { ok: false; failedStep: "data" | "auth" };

export async function runAccountDeletion(steps: AccountDeletionSteps): Promise<AccountDeletionResult> {
  let orgIds: string[];
  try {
    orgIds = await steps.deleteNoncritical();
  } catch {
    return { ok: false, failedStep: "data" };
  }
  try {
    await steps.deleteAuthUser();
  } catch {
    return { ok: false, failedStep: "auth" };
  }
  try {
    await steps.deleteRouteCritical(orgIds);
  } catch {
    // Auth user is gone; leftover rows are unreachable and harmless.
  }
  return { ok: true, deletedOrganizations: orgIds.length };
}
