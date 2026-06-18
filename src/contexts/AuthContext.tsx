import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
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

// SessionStorage keys that are scoped to a single user's in-progress
// onboarding/setup flow. These MUST be cleared whenever the authenticated
// user changes, otherwise a different account would inherit the previous
// user's draft state (and could even write to the previous user's rows via
// a stale settingsId pulled from React Query cache).
const USER_SCOPED_SESSION_KEYS = [
  "paycheckmd-onboarding-step",
  "paycheckmd-onboarding-company-drafts",
  "paycheckmd-onboarding-catchup-substep",
  "paycheckmd-onboarding-start",
  "paycheckmd-start-setup",
];

function clearUserScopedClientState() {
  try {
    for (const key of USER_SCOPED_SESSION_KEYS) {
      sessionStorage.removeItem(key);
    }
  } catch {
    /* sessionStorage may be unavailable; non-fatal */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  // Track the previously observed authenticated user id so we can detect
  // identity transitions (logout, login, account switch, token refresh that
  // changed the subject) and invalidate every user-scoped cache/state slice.
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  async function loadOrgData(userId: string) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId)
      .limit(1)
      .single();

    // Guard against race conditions: by the time this resolves the
    // authenticated user may have changed (logout/login). Only apply if it
    // still matches the user whose membership we fetched.
    if (prevUserIdRef.current !== userId) return;

    if (membership) {
      setOrganizationId(membership.organization_id);
      setUserRole(membership.role);

      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", membership.organization_id)
        .single();

      if (prevUserIdRef.current !== userId) return;
      if (org) setOrganizationName(org.name);
    }
  }

  function applyAuthChange(nextSession: Session | null) {
    const nextUserId = nextSession?.user?.id ?? null;
    const prevUserId = prevUserIdRef.current;
    const identityChanged = prevUserId !== undefined && prevUserId !== nextUserId;

    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (identityChanged) {
      console.info("[auth] identity changed — clearing user-scoped state", {
        from: prevUserId,
        to: nextUserId,
      });
      // Drop every user-scoped React Query cache so the new user can never
      // momentarily see the previous user's data (or have a stale
      // tax_settings.id reused in a mutation).
      queryClient.clear();
      clearUserScopedClientState();
      // Reset org state immediately; loadOrgData will repopulate if a new
      // user is signed in.
      setOrganizationId(null);
      setOrganizationName(null);
      setUserRole(null);
    }

    prevUserIdRef.current = nextUserId;

    if (nextSession?.user) {
      // Use setTimeout to avoid Supabase deadlock when called from inside
      // onAuthStateChange. Never await Supabase calls in the listener.
      setTimeout(() => loadOrgData(nextSession.user.id), 0);
    } else {
      setOrganizationId(null);
      setOrganizationName(null);
      setUserRole(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        applyAuthChange(nextSession);
      }
    );

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      applyAuthChange(initialSession);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    // Defensive: ensure caches and onboarding session state are wiped even
    // if the auth listener races. applyAuthChange will also fire and clear
    // again, which is harmless.
    queryClient.clear();
    clearUserScopedClientState();
    prevUserIdRef.current = null;
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
