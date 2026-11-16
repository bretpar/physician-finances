import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAccountRole } from "@/hooks/useAccountRole";

/**
 * Same boundary as /admin: the server-resolved account role (get_my_account_role
 * RPC via useAccountRole) must be "developer". Renders nothing of the child
 * until that answer arrives; client storage never grants access.
 */
export function DeveloperRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isDeveloper, isResolved } = useAccountRole();
  if (loading || (user && !isResolved)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isDeveloper) return <Navigate to="/" replace />;
  return <>{children}</>;
}
