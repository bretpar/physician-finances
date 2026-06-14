import { useState, useRef, useEffect } from "react";
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
  
  Wallet,
  BarChart3,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { usePlannerConversionFallback } from "@/hooks/usePlannerConversion";
import { useTaxSettings, type HouseholdIncomeStreams } from "@/hooks/useTaxSettings";
import {
  deriveUserTypeFromIncomeStreams,
  getFeatureAccess,
  type FeatureKey,
} from "@/lib/entitlements";
import { subscriptionTierToEntitlementTier } from "@/lib/onboarding";

type NavItem = {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  w2OnlyLabel?: string;
  subtitle: string;
  module?: "business" | "investment";
  featureKey?: FeatureKey;
  w2OnlyFeatureKey?: FeatureKey;
};

const navItems: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", subtitle: "" },
  { to: "/business-activity", icon: ArrowLeftRight, label: "Business Activity", subtitle: "Business income and expenses", module: "business", featureKey: "businessIncomeTracking" },
  { to: "/personal-income", icon: Wallet, label: "Personal Income", w2OnlyLabel: "Paychecks", subtitle: "Actual income affecting taxes", featureKey: "basicPaycheckTracking" },
  { to: "/projected-income", icon: TrendingUp, label: "Income Planner", w2OnlyLabel: "Withholding Guide", subtitle: "Future or hypothetical income", featureKey: "scenarioPlanner", w2OnlyFeatureKey: "basicWithholdingGuide" },
  { to: "/investments", icon: BarChart3, label: "Investments", subtitle: "Stock and investment activity", module: "investment" },
  { to: "/deductions", icon: Car, label: "Deductions", subtitle: "", featureKey: "mileageDeduction" },
  { to: "/taxes", icon: Calculator, label: "Taxes", w2OnlyLabel: "Tax Overview", subtitle: "Current vs forecasted tax estimates", featureKey: "advancedTaxOverview", w2OnlyFeatureKey: "basicTaxOverview" },
  { to: "/reports", icon: BarChart3, label: "Reports", subtitle: "P&L and tax summaries", featureKey: "detailedReports" },
  { to: "/settings", icon: Settings, label: "Settings", subtitle: "" },
];

function hasBusinessIncomeStream(streams?: HouseholdIncomeStreams) {
  if (!streams) return true;
  return streams.business1099Income || streams.k1PartnershipIncome || streams.sCorpIncome;
}

function hasInvestmentIncomeStream(streams?: HouseholdIncomeStreams) {
  if (!streams) return true;
  return streams.investmentIncome;
}

function hasOnlyW2IncomeStreams(streams?: HouseholdIncomeStreams) {
  if (!streams) return false;
  const hasW2 = streams.w2Income || streams.spouseW2Income || streams.additionalW2Job;
  const hasNonW2 = streams.business1099Income || streams.k1PartnershipIncome || streams.sCorpIncome || streams.rentalIncome || streams.investmentIncome || streams.otherIncome;
  return hasW2 && !hasNonW2;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { organizationName, signOut, user } = useAuth();
  const { data: taxSettings } = useTaxSettings();
  const householdStreams = taxSettings?.householdIncomeStreams;
  const showBusinessNav = hasBusinessIncomeStream(householdStreams);
  const showInvestmentNav = hasInvestmentIncomeStream(householdStreams);
  const useW2OnlyLabels = hasOnlyW2IncomeStreams(householdStreams);
  const userType = deriveUserTypeFromIncomeStreams(householdStreams);
  const featureAccess = getFeatureAccess(userType, subscriptionTierToEntitlementTier(taxSettings?.subscriptionTier));
  const visibleNavItems = navItems.filter((item) => {
    if (item.module === "business") return showBusinessNav;
    if (item.module === "investment") return showInvestmentNav;
    return true;
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 4);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-convert planned income → ledger drafts (no-op if Settings toggle is OFF)
  usePlannerConversionFallback();

  return (
    <div className="flex h-dvh overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-[60] w-60 bg-sidebar flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <BrandLogo className="h-9 w-9 rounded-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-sidebar-primary-foreground">Paycheck MD</h1>
            <p className="text-xs text-sidebar-foreground truncate">{organizationName || "Physician Portal"}</p>
          </div>
          <button
            aria-label="Close menu"
            className="ml-auto lg:hidden text-sidebar-foreground"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={`sidebar-link ${
                location.pathname === item.to ? "sidebar-link-active" : "sidebar-link-inactive"
              }`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{useW2OnlyLabels && item.w2OnlyLabel ? item.w2OnlyLabel : item.label}</span>
              {(() => {
                const key = useW2OnlyLabels && item.w2OnlyFeatureKey ? item.w2OnlyFeatureKey : item.featureKey;
                return key && featureAccess[key]?.status === "locked";
              })() && (
                <span className="rounded-sm border border-sidebar-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal text-sidebar-foreground">
                  Premium
                </span>
              )}
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

      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
        <header
          className={`fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:static lg:z-auto lg:bg-card lg:backdrop-blur-0 lg:px-6 h-12 lg:h-14 box-content lg:box-border transition-shadow duration-300 ${
            scrolled ? "shadow-[0_2px_8px_rgba(0,0,0,0.06)]" : "shadow-none"
          }`}
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <button
            className="lg:hidden text-foreground -ml-1 p-1"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h2 className="text-base lg:text-lg font-semibold text-foreground leading-tight min-w-0 flex-1 break-words">
            {(() => {
              const item = navItems.find((i) => i.to === location.pathname);
              return item ? (useW2OnlyLabels && item.w2OnlyLabel ? item.w2OnlyLabel : item.label) : "Page";
            })()}
          </h2>
        </header>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 lg:px-6 lg:py-6 min-w-0"
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 3rem + 0.5rem)",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
          }}
        >
          <div className="lg:pt-0">{children}</div>
        </div>
      </main>
    </div>
  );
}
