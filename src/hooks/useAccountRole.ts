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
export function useAccountRole(): RoleAccess & { isLoading: boolean; userEmail: string | null } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["account-role", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AccountRole> => {
      const { data, error } = await supabase.rpc("get_my_account_role");
      if (error) {
        console.error("[roles] failed to load account role", error);
        return DEFAULT_ACCOUNT_ROLE;
      }
      return normalizeAccountRole(data);
    },
  });

  return {
    ...getRoleAccess(data),
    isLoading: !!user && isLoading,
    userEmail: user?.email ?? null,
  };
}
