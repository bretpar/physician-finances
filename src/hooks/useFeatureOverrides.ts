import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isFeatureAccessLevel, type FeatureAccessLevel, type FeatureOverrideMap } from "@/lib/featureRegistry";

export const FEATURE_OVERRIDES_QUERY_KEY = ["feature-access-overrides"] as const;

const EMPTY: FeatureOverrideMap = {};

/**
 * Single cached query for ALL Admin feature-access overrides.
 *
 * One shared query key means every gated component reads from the same cache
 * entry — no per-component fetching. If the query fails or a key is missing,
 * callers fall back to the code-defined defaults in featureRegistry.ts.
 */
export function useFeatureOverrides(): { overrides: FeatureOverrideMap; isLoading: boolean; isResolved: boolean } {
  const { user } = useAuth();

  const { data, isLoading, isFetched, isError } = useQuery({
    queryKey: FEATURE_OVERRIDES_QUERY_KEY,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<FeatureOverrideMap> => {
      const { data, error } = await supabase.from("feature_access_overrides").select("feature_key, access_level");
      if (error) throw error;
      const map: FeatureOverrideMap = {};
      for (const row of data ?? []) {
        if (isFeatureAccessLevel(row.access_level)) map[row.feature_key] = row.access_level;
      }
      return map;
    },
  });

  return {
    overrides: data ?? EMPTY,
    isLoading: !!user && isLoading,
    isResolved: !user ? true : isFetched || isError,
  };
}

/** Developer-only write. RLS denies non-developers server-side. */
export function useSetFeatureOverride() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ featureKey, accessLevel }: { featureKey: string; accessLevel: FeatureAccessLevel | null }) => {
      if (accessLevel === null) {
        const { error } = await supabase.from("feature_access_overrides").delete().eq("feature_key", featureKey);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("feature_access_overrides").upsert(
        {
          feature_key: featureKey,
          access_level: accessLevel,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        },
        { onConflict: "feature_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FEATURE_OVERRIDES_QUERY_KEY });
    },
  });
}
