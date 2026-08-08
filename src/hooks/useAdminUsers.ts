import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAccountRole, type AccountRole } from "@/lib/roles";

export interface AdminUserRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: AccountRole;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export function useAdminUsers(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-users"],
    enabled,
    queryFn: async (): Promise<AdminUserRow[]> => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        userId: row.user_id as string,
        email: (row.email as string) ?? "",
        displayName: (row.display_name as string) ?? null,
        role: normalizeAccountRole(row.account_role),
        createdAt: (row.created_at as string) ?? null,
        lastSignInAt: (row.last_sign_in_at as string) ?? null,
      }));
    },
  });
}

export function useUpdateAccountRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AccountRole }) => {
      const { error } = await supabase.rpc("admin_set_account_role", {
        _user_id: userId,
        _role: role,
      });
      if (error) throw error;
      return role;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["account-role"] });
    },
  });
}

/** Filters by email or display name (case-insensitive). */
export function filterAdminUsers(users: AdminUserRow[], search: string): AdminUserRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return users;
  return users.filter(
    (u) => u.email.toLowerCase().includes(q) || (u.displayName ?? "").toLowerCase().includes(q),
  );
}

export type AdminUserFilter = "all" | AccountRole | "likely_test";

/** Role / test-account filter applied on top of the search filter. */
export function applyAdminUserFilter(users: AdminUserRow[], filter: AdminUserFilter): AdminUserRow[] {
  if (filter === "all") return users;
  if (filter === "likely_test") return users.filter((u) => isLikelyTestAccount(u.email));
  return users.filter((u) => u.role === filter);
}

export interface BulkDeleteResult {
  ok: boolean;
  deleted: string[];
  skipped: Array<{ user_id: string; reason: string }>;
  failed: Array<{ user_id: string; error: string }>;
  orphaned_tables: string[];
}

/**
 * Bulk account deletion. Privileged work happens entirely in the
 * `admin-delete-users` edge function, which re-verifies developer status.
 */
export function useBulkDeleteUsers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userIds: string[]): Promise<BulkDeleteResult> => {
      const { data, error } = await supabase.functions.invoke("admin-delete-users", {
        body: { user_ids: userIds },
      });
      if (error) throw error;
      const result = data as BulkDeleteResult;
      if (!result?.deleted) throw new Error("Unexpected response from delete service");
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}
