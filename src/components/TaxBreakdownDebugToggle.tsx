import { useEffect, useState } from "react";
import { Bug } from "lucide-react";
import {
  isTaxBreakdownDebugEnabled,
  setTaxBreakdownDebugEnabled,
  subscribeTaxBreakdownDebug,
} from "@/lib/taxBreakdownDebug";

/**
 * Small developer toggle that enables console logging of resolved companyId,
 * dedupe key, and merged-source counts inside `useTaxBreakdown`.
 */
export default function TaxBreakdownDebugToggle() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isTaxBreakdownDebugEnabled());
    return subscribeTaxBreakdownDebug(setEnabled);
  }, []);

  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-primary"
        checked={enabled}
        onChange={(e) => setTaxBreakdownDebugEnabled(e.target.checked)}
      />
      <Bug className="h-3.5 w-3.5" />
      <span>Log Tax Breakdown dedupe (console)</span>
    </label>
  );
}
