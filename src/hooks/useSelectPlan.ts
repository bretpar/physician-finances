import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAccountRole, type AccountRole } from "@/lib/roles";
import { planRequiresCheckout, type SelectablePlan } from "@/lib/planSelection";

/**
 * Canonical self-service plan → account role update.
 *
 * Uses the secured `select_my_plan` SECURITY DEFINER RPC (never a direct
 * client-side `user_roles` write). The RPC accepts only "free" | "premium" and
 * refuses to downgrade an elevated account (premium_beta / developer), so
 * re-running onboarding cannot strip internal access.
 */
export function useSelectPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plan: SelectablePlan): Promise<AccountRole> => {
      // Future: when Premium becomes paid, checkout runs here and the role is
      // only assigned after a successful payment.
      if (planRequiresCheckout(plan)) {
        throw new Error("Checkout is not available yet.");
      }
      const { data, error } = await supabase.rpc("select_my_plan", { _plan: plan });
      if (error) throw error;
      return normalizeAccountRole(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-role"] });
    },
  });
}
