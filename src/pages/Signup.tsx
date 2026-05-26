import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, PiggyBank } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isAuthRateLimitError } from "@/lib/authProtection";

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const prefill = searchParams.get("email");
    if (prefill) setEmail(prefill);
  }, [searchParams]);

  if (user) return <Navigate to="/onboarding" replace />;

  async function handleCreateAccount() {
    if (saving) return;
    const trimmedFirst = firstName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Enter a valid email."); return;
    }
    if (!password || password.length < 6) {
      toast.error("Password must be at least 6 characters."); return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: trimmedFirst ? { first_name: trimmedFirst } : {},
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        if (isAuthRateLimitError(error)) toast.error("Too many signup attempts. Please wait a few minutes.");
        else toast.error(error.message || "Could not create account.");
        return;
      }
      const identities = (data.user as any)?.identities;
      if (data.user && Array.isArray(identities) && identities.length === 0) {
        toast.error("That email is already registered. Please log in instead.");
        return;
      }
      if (!data.session) {
        toast.success("Account created. Please log in to continue.");
        navigate("/login");
        return;
      }
      sessionStorage.setItem("paycheckmd-onboarding-start", "income-method");
      navigate("/onboarding", { replace: true });
    } catch (e: any) {
      toast.error(e?.message || "Could not create account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <Card className="mx-auto w-full max-w-md">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <PiggyBank className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
              <p className="text-xs text-muted-foreground">Track income, taxes, and withholding in one place.</p>
            </div>
          </div>

          <form
            className="grid gap-4"
            onSubmit={(e) => { e.preventDefault(); handleCreateAccount(); }}
          >
            <div>
              <Label htmlFor="signup-first-name">First name (optional)</Label>
              <Input
                id="signup-first-name"
                data-testid="signup-first-name"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Alex"
              />
            </div>
            <div>
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                data-testid="signup-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <Label htmlFor="signup-password">Password</Label>
              <div className="relative">
                <Input
                  id="signup-password"
                  data-testid="signup-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              data-testid="signup-submit"
              disabled={saving}
            >
              {saving ? "Creating account…" : "Create Account"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link>
          </p>
          <p className="text-xs text-muted-foreground">
            Want a quick tax estimate first?{" "}
            <Link to="/estimate" className="font-medium text-primary hover:underline">Try the estimator</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
