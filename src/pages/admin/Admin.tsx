import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccountRole } from "@/hooks/useAccountRole";
import { ACCOUNT_ROLE_LABEL } from "@/lib/roles";

export default function Admin() {
  const { role, isDeveloper, isLoading, userEmail } = useAccountRole();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // Security is enforced here, not by hiding the nav link.
  if (!isDeveloper) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">PaycheckMD Admin</h1>
        <p className="text-sm text-muted-foreground">User and feature management will be available here.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signed-in account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{userEmail || "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium">{ACCOUNT_ROLE_LABEL[role]}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
