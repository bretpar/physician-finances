import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { toast } from "sonner";
import { clearAttemptState, getAuthErrorMessage, readAttemptState, recordFailedAttempt } from "@/lib/authProtection";

const LOGIN_ATTEMPTS_KEY = "paycheckmd-login-attempts";
const RESET_ATTEMPTS_KEY = "paycheckmd-reset-attempts";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [loginCooldownUntil, setLoginCooldownUntil] = useState(() => readAttemptState(LOGIN_ATTEMPTS_KEY).cooldownUntil);
  const [resetCooldownUntil, setResetCooldownUntil] = useState(() => readAttemptState(RESET_ATTEMPTS_KEY).cooldownUntil);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loginCooldownSeconds = Math.max(0, Math.ceil((loginCooldownUntil - now) / 1000));
  const resetCooldownSeconds = Math.max(0, Math.ceil((resetCooldownUntil - now) / 1000));

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Enter both email and password to sign in.");
      return;
    }
    if (loginCooldownSeconds > 0) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      const next = recordFailedAttempt(LOGIN_ATTEMPTS_KEY);
      setLoginCooldownUntil(next.cooldownUntil);
      toast.error(getAuthErrorMessage(error, "Invalid email or password."));
    } else {
      clearAttemptState(LOGIN_ATTEMPTS_KEY);
      navigate("/");
    }
  }

  async function handlePasswordReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email) {
      toast.error("Enter your email address first.");
      return;
    }
    if (resetCooldownSeconds > 0) return;
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);
    if (error) {
      const next = recordFailedAttempt(RESET_ATTEMPTS_KEY);
      setResetCooldownUntil(next.cooldownUntil);
      toast.error(getAuthErrorMessage(error, "If an account exists for that email, we’ll send reset instructions."));
    } else {
      clearAttemptState(RESET_ATTEMPTS_KEY);
      setResetCooldownUntil(0);
      toast.success("If an account exists for that email, we’ll send reset instructions.");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <BrandLogo className="mx-auto h-12 w-12 rounded-xl object-fill" />
          <h1 className="text-2xl font-semibold leading-none tracking-tight">Welcome to Paycheck MD</h1>
          <CardDescription>{resetMode ? "Reset your password" : "Sign in to your account to continue"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={resetMode ? handlePasswordReset : handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                data-testid="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            {!resetMode && <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  data-testid="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>}
            {!resetMode && <div className="text-right"><button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setResetMode(true)}>Forgot password?</button></div>}
            {loginCooldownSeconds > 0 && !resetMode && <p className="text-sm text-muted-foreground">Too many attempts. Please try again in {loginCooldownSeconds} seconds.</p>}
            {resetCooldownSeconds > 0 && resetMode && <p className="text-sm text-muted-foreground">Too many attempts. Please try again in {resetCooldownSeconds} seconds.</p>}
            <Button type="submit" data-testid="login-submit" className="w-full" disabled={loading || resetLoading || (!resetMode && loginCooldownSeconds > 0) || (resetMode && resetCooldownSeconds > 0)}>
              {resetMode ? (resetLoading ? "Sending…" : "Send reset link") : (loading ? "Signing in…" : "Sign In")}
            </Button>
          </form>
          {resetMode && <button type="button" className="mt-4 w-full text-center text-sm font-medium text-primary hover:underline" onClick={() => setResetMode(false)}>Back to sign in</button>}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/signup" data-testid="create-account-cta" className="text-primary hover:underline font-medium">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
