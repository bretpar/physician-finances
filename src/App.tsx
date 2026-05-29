import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import BusinessActivity from "@/pages/BusinessActivity";
import PersonalIncome from "@/pages/PersonalIncome";
import InvestmentIncome from "@/pages/InvestmentIncome";
import Settings from "@/pages/Settings";
import Mileage from "@/pages/Mileage";
import Taxes from "@/pages/Taxes";
import Reports from "@/pages/Reports";
// Accounts page removed — consolidated into Settings
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ResetPassword from "@/pages/ResetPassword";
import Onboarding from "@/pages/Onboarding";
import { OnboardingErrorBoundary } from "@/components/OnboardingErrorBoundary";
import Estimate from "@/pages/Estimate";
import ProjectedIncome from "@/pages/ProjectedIncome";
import DebugTransactions from "@/pages/DebugTransactions";
import DataIsolationReport from "@/pages/admin/DataIsolationReport";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { data: taxSettings, isLoading: settingsLoading } = useTaxSettings(!!user);
  const safeEraseInProgress = (() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("paycheckmd:erase-complete") != null;
    } catch {
      return false;
    }
  })();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (location.pathname === "/onboarding") {
    return <OnboardingErrorBoundary><Onboarding /></OnboardingErrorBoundary>;
  }

  if (safeEraseInProgress || taxSettings?.onboardingComplete !== true) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <CompanyProvider>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/business-activity" element={<BusinessActivity />} />
          <Route path="/personal-income" element={<PersonalIncome />} />
          <Route path="/investments" element={<InvestmentIncome />} />
          <Route path="/accounts" element={<Navigate to="/settings" replace />} />
          <Route path="/projected-income" element={<ProjectedIncome />} />
          <Route path="/deductions" element={<Mileage />} />
          <Route path="/taxes" element={<Taxes />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/debug/transactions" element={<DebugTransactions />} />
          <Route path="/admin/data-isolation" element={<DataIsolationReport />} />
          {/* Legacy redirects */}
          <Route path="/transactions" element={<Navigate to="/business-activity" replace />} />
          <Route path="/income" element={<Navigate to="/personal-income" replace />} />
          <Route path="/mileage" element={<Navigate to="/deductions" replace />} />
          <Route path="/stocks" element={<Navigate to="/investments" replace />} />
          <Route path="/tax-planning" element={<Navigate to="/taxes" replace />} />
          <Route path="/tax-reserve" element={<Navigate to="/taxes" replace />} />
          <Route path="/quarterly-taxes" element={<Navigate to="/taxes" replace />} />
          <Route path="/estimated-tax" element={<Navigate to="/taxes" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppLayout>
    </CompanyProvider>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/onboarding" replace /> : <Signup />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<OnboardingErrorBoundary><Onboarding /></OnboardingErrorBoundary>} />
      <Route path="/estimate" element={<Estimate />} />
      <Route path="/*" element={user ? <ProtectedRoutes /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
