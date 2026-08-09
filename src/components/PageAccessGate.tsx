import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import type { FeatureKey } from "@/lib/entitlements";

interface PageAccessGateProps {
  /** Page-level registry key (e.g. "pageIncomePlanner"). */
  featureKey: FeatureKey;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Route/render boundary for page-level entitlements. Direct URL access must not
 * bypass a page gate, so every Premium page is wrapped with this instead of
 * relying on sidebar visibility. Unresolved access fails safe (loading, never
 * content).
 */
export function PageAccessGate({ featureKey, title, description, children }: PageAccessGateProps) {
  const { accessStatus } = useFeatureAccess();
  const status = accessStatus(featureKey);

  if (status === "pending") {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (status === "allowed") return <>{children}</>;

  return (
    <div className="max-w-2xl mx-auto py-10">
      <Card data-testid={`page-locked-${featureKey}`}>
        <CardContent className="p-6 space-y-2 text-center">
          <Lock className="mx-auto h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {description ?? "This is a Premium feature. Upgrade to unlock it."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
