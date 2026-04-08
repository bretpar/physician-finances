import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Transactions from "@/pages/Transactions";
import TaxPlanning from "@/pages/TaxPlanning";
import Accounts from "@/pages/Accounts";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Mileage from "@/pages/Mileage";
import Team from "@/pages/Team";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
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
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/tax-planning" element={<TaxPlanning />} />
          <Route path="/mileage" element={<Mileage />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppLayout>
    </CompanyProvider>
  );
}

function AuthRoutes() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
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
