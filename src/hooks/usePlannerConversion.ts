import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { runPlannerConversionForCurrentUser } from "@/lib/plannerConversion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Read-only hook: fetch the user's current auto-convert preference.
 * Returns false until tax_settings is loaded, so consumers fail-safe to OFF.
 */
export function useAutoConvertEnabled(): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { data } = useQuery({
    queryKey: ["tax_settings", "auto_convert_flag", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_settings")
        .select("auto_convert_future_income_to_ledger")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return !!(data as any)?.auto_convert_future_income_to_ledger;
    },
  });
  return !!data;
}

/**
 * On-demand fallback: when the toggle is ON, run conversion once per app
 * session (per browser tab). The daily cron is the primary mechanism — this
 * just guarantees that an actively-using user never sees a stale planner.
 *
 * We dedupe by sessionStorage so navigating between pages doesn't re-trigger.
 */
const SESSION_KEY = "planner_conversion_last_run";

export function usePlannerConversionFallback() {
  const enabled = useAutoConvertEnabled();
  const qc = useQueryClient();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!enabled || ranRef.current) return;
    const today = new Date().toISOString().slice(0, 10);
    const last = sessionStorage.getItem(SESSION_KEY);
    if (last === today) {
      ranRef.current = true;
      return;
    }
    ranRef.current = true;
    (async () => {
      try {
        const result = await runPlannerConversionForCurrentUser();
        sessionStorage.setItem(SESSION_KEY, today);
        if (result.converted > 0) {
          toast.success(
            `${result.converted} planned ${result.converted === 1 ? "paycheck" : "paychecks"} converted to ledger drafts — please review`,
            { duration: 4500 },
          );
        }
        if (result.duplicateSkipped > 0) {
          toast.info(
            `${result.duplicateSkipped} planned ${result.duplicateSkipped === 1 ? "paycheck" : "paychecks"} flagged as possible duplicates — review/link in Income Planner`,
            { duration: 5000 },
          );
        }
        if (result.errors > 0) {
          toast.error(
            `${result.errors} planned ${result.errors === 1 ? "paycheck" : "paychecks"} failed to convert — see console for details`,
          );
        }
        if (result.converted > 0 || result.duplicateSkipped > 0) {
          qc.invalidateQueries({ queryKey: ["transactions"] });
          qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
          qc.invalidateQueries({ queryKey: ["income_entries"] });
          qc.invalidateQueries({ queryKey: ["projected_income_streams"] });
          qc.invalidateQueries({ queryKey: ["planner_conversions"] }); qc.invalidateQueries({ queryKey: ["planner_conversions_full"] });
        }
      } catch (err) {
        console.error("planner conversion fallback failed", err);
      }
    })();
  }, [enabled, qc]);
}
