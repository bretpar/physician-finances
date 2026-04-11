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
import Settings from "@/pages/Settings";
import Mileage from "@/pages/Mileage";
import Income from "@/pages/Income";
import ProjectedIncome from "@/pages/ProjectedIncome";
import Stocks from "@/pages/Stocks";
import Reports from "@/pages/Reports";
import Taxes from "@/pages/Taxes";
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
          <Route path="/income" element={<Income />} />
          <Route path="/mileage" element={<Mileage />} />
          <Route path="/projected-income" element={<ProjectedIncome />} />
          <Route path="/stocks" element={<Stocks />} />
          <Route path="/taxes" element={<Taxes />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          {/* Redirects for old routes */}
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
