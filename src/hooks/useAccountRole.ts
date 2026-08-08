import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  DEFAULT_ACCOUNT_ROLE,
  getRoleAccess,
  normalizeAccountRole,
  type AccountRole,
  type RoleAccess,
} from "@/lib/roles";

/**
 * Single source of truth for the signed-in user's account role.
 * Resolved server-side (SECURITY DEFINER RPC) so the role cannot be spoofed
 * from client storage.
 */
export function useAccountRole(): RoleAccess & {
  isLoading: boolean;
  /** True only once the server has answered. Staged-release gates must wait for this. */
  isResolved: boolean;
  /** The server-resolved role, or null while unresolved. Never defaults to "free". */
  resolvedRole: AccountRole | null;
  userEmail: string | null;
} {
  const { user } = useAuth();

  const { data, isLoading, isFetched, isError } = useQuery({
    queryKey: ["account-role", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<AccountRole> => {
      const { data, error } = await supabase.rpc("get_my_account_role");
      if (error) {
        console.error("[roles] failed to load account role", error);
        throw error;
      }
      return normalizeAccountRole(data);
    },
  });

  // Signed-out users are resolved immediately as free; signed-in users are only
  // resolved once the RPC answers (success or a definitive error).
  const isResolved = !user ? true : isFetched || isError;
  const resolvedRole: AccountRole | null = !user
    ? DEFAULT_ACCOUNT_ROLE
    : data
      ? normalizeAccountRole(data)
      : isError
        ? DEFAULT_ACCOUNT_ROLE
        : null;

  return {
    ...getRoleAccess(resolvedRole),
    isLoading: !!user && !isResolved,
    isResolved,
    resolvedRole,
    userEmail: user?.email ?? null,
  };
}

