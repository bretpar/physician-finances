import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import BusinessActivity from "@/pages/BusinessActivity";
import PersonalIncome from "@/pages/PersonalIncome";
import Settings from "@/pages/Settings";
import Mileage from "@/pages/Mileage";
import Taxes from "@/pages/Taxes";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ProjectedIncome from "@/pages/ProjectedIncome";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();

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

  return (
    <CompanyProvider>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/business-activity" element={<BusinessActivity />} />
          <Route path="/personal-income" element={<PersonalIncome />} />
          <Route path="/projected-income" element={<ProjectedIncome />} />
          <Route path="/deductions" element={<Mileage />} />
          <Route path="/taxes" element={<Taxes />} />
          <Route path="/settings" element={<Settings />} />
          {/* Legacy redirects */}
          <Route path="/transactions" element={<Navigate to="/business-activity" replace />} />
          <Route path="/income" element={<Navigate to="/personal-income" replace />} />
          <Route path="/mileage" element={<Navigate to="/deductions" replace />} />
          <Route path="/stocks" element={<Navigate to="/" replace />} />
          <Route path="/reports" element={<Navigate to="/" replace />} />
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
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <Signup />} />
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
