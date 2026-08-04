import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeCategoryUsage, type CategoryUsage } from "@/lib/categoryUsage";

/**
 * Reads the current user's saved expense transactions (category + date only)
 * and derives category usage stats. No new tables, no writes.
 */
export function useCategoryUsage() {
  return useQuery<CategoryUsage>({
    queryKey: ["expense_category_usage"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("category, transaction_date")
        .eq("transaction_type", "expense")
        .order("transaction_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return computeCategoryUsage(data || []);
    },
  });
}
