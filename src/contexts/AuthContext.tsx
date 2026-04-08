import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  organizationId: string | null;
  organizationName: string | null;
  userRole: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  organizationId: null,
  organizationName: null,
  userRole: null,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  async function loadOrgData(userId: string) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (membership) {
      setOrganizationId(membership.organization_id);
      setUserRole(membership.role);

      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", membership.organization_id)
        .single();

      if (org) setOrganizationName(org.name);
    }
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          // Use setTimeout to avoid Supabase deadlock
          setTimeout(() => loadOrgData(session.user.id), 0);
        } else {
          setOrganizationId(null);
          setOrganizationName(null);
          setUserRole(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadOrgData(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setOrganizationId(null);
    setOrganizationName(null);
    setUserRole(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, organizationId, organizationName, userRole, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
