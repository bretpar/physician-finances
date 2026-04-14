import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ArrowLeftRight,
  TrendingUp,
  Car,
  Calculator,
  Settings,
  Menu,
  X,
  LogOut,
  PiggyBank,
  Wallet,
  BarChart3,
  Landmark,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", subtitle: "" },
  { to: "/business-activity", icon: ArrowLeftRight, label: "Business Activity", subtitle: "Business income and expenses" },
  { to: "/personal-income", icon: Wallet, label: "Personal Income", subtitle: "Actual income affecting taxes" },
  { to: "/projected-income", icon: TrendingUp, label: "Income Planner", subtitle: "Future or hypothetical income" },
  { to: "/deductions", icon: Car, label: "Deductions", subtitle: "" },
  { to: "/taxes", icon: Calculator, label: "Taxes", subtitle: "Current vs forecasted tax estimates" },
  { to: "/reports", icon: BarChart3, label: "Reports", subtitle: "P&L and tax summaries" },
  { to: "/settings", icon: Settings, label: "Settings", subtitle: "" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { organizationName, signOut, user } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 bg-sidebar flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="h-9 w-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <PiggyBank className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-sidebar-primary-foreground">MedFinance</h1>
            <p className="text-xs text-sidebar-foreground truncate">{organizationName || "Physician Portal"}</p>
          </div>
          <button
            className="ml-auto lg:hidden text-sidebar-foreground"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={`sidebar-link ${
                location.pathname === item.to ? "sidebar-link-active" : "sidebar-link-inactive"
              }`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-sidebar-border space-y-3">
          <p className="text-xs text-sidebar-foreground truncate">{user?.email}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="w-full justify-start gap-2 text-sidebar-foreground hover:text-sidebar-primary-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center gap-4 px-4 py-3 border-b border-border bg-card lg:px-6">
          <button
            className="lg:hidden text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold text-foreground">
            {navItems.find((i) => i.to === location.pathname)?.label ?? "Page"}
          </h2>
        </header>
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</div>
      </main>
    </div>
  );
}
