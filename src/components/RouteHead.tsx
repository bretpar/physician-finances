import { Helmet } from "react-helmet-async";
import { useLocation, matchPath } from "react-router-dom";

const BASE = "https://app.paycheckmd.com";

type Meta = { title: string; description: string; type?: "website" | "article" };

// Titles kept under 60 chars including " | Paycheck MD" suffix.
// Descriptions 50–160 chars.
const ROUTE_META: Array<{ pattern: string; meta: Meta }> = [
  {
    pattern: "/",
    meta: {
      title: "Tax Planning for Doctors | Paycheck MD",
      description:
        "Tax planning for doctors: track W-2 and 1099 income, estimate federal, state, and self-employment tax, and stay ahead of quarterly payments.",
    },
  },
  {
    pattern: "/login",
    meta: {
      title: "Sign In | Paycheck MD",
      description:
        "Sign in to Paycheck MD to track physician income, withholding, and estimated tax payments.",
    },
  },
  {
    pattern: "/signup",
    meta: {
      title: "Create Account | Paycheck MD",
      description:
        "Create a Paycheck MD account to plan physician taxes across W-2 and 1099 income with confidence.",
    },
  },
  {
    pattern: "/reset-password",
    meta: {
      title: "Reset Password | Paycheck MD",
      description: "Reset your Paycheck MD password to regain access to your physician tax dashboard.",
    },
  },
  {
    pattern: "/onboarding",
    meta: {
      title: "Onboarding | Paycheck MD",
      description:
        "Set up your physician income sources, withholding, and tax preferences to personalize Paycheck MD.",
    },
  },
  {
    pattern: "/business-activity",
    meta: {
      title: "Business Activity | Paycheck MD",
      description:
        "Track 1099 and business income, expenses, and deductions in one place to plan self-employment taxes accurately.",
    },
  },
  {
    pattern: "/personal-income",
    meta: {
      title: "Personal Income | Paycheck MD",
      description:
        "Log W-2 paychecks, withholding, and pre-tax deductions for accurate tax planning across all your employers.",
    },
  },
  {
    pattern: "/investments",
    meta: {
      title: "Investment Income | Paycheck MD",
      description:
        "Track dividends, interest, and capital gains so investment income is reflected in your physician tax estimates.",
    },
  },
  {
    pattern: "/projected-income",
    meta: {
      title: "Income Planner | Paycheck MD",
      description:
        "Project future paychecks and 1099 work to forecast taxes, withholding gaps, and quarterly payment needs.",
    },
  },
  {
    pattern: "/deductions",
    meta: {
      title: "Tax Savings | Paycheck MD",
      description:
        "Capture mileage, home office, and other deductible expenses to lower your taxable physician income.",
    },
  },
  {
    pattern: "/taxes",
    meta: {
      title: "Tax Overview | Paycheck MD",
      description:
        "See current vs forecasted federal, state, and self-employment taxes with quarterly payment guidance.",
    },
  },
  {
    pattern: "/reports",
    meta: {
      title: "Reports | Paycheck MD",
      description:
        "P&L, income summaries, and tax reports for physicians — export-ready views of your financial year.",
    },
  },
  {
    pattern: "/settings",
    meta: {
      title: "Settings | Paycheck MD",
      description:
        "Manage filing status, employers, tax preferences, connected accounts, and notifications for Paycheck MD.",
    },
  },
  {
    pattern: "/accounts",
    meta: {
      title: "Accounts | Paycheck MD",
      description: "Manage linked bank and payroll accounts powering your Paycheck MD tax estimates.",
    },
  },
  {
    pattern: "/estimate",
    meta: {
      title: "Free Physician Tax Estimate | Paycheck MD",
      description:
        "Free quick tax estimator for physicians with W-2 and 1099 income — see federal, state, and SE taxes in minutes.",
    },
  },
  {
    pattern: "/student-loans",
    meta: {
      title: "Student Loan Estimator | Paycheck MD",
      description:
        "Estimate IDR payments, interest growth, and MFJ vs MFS trade-offs on physician student loans, including community-property states.",
    },
  },
  {
    pattern: "/blog/1099-tax-deductions",
    meta: {
      title: "1099 Tax Deductions Guide for Freelancers | Paycheck MD",
      description:
        "Complete guide to 1099 tax deductions: home office, mileage, health insurance, retirement, QBI, and more.",
      type: "article",
    },
  },
  {
    pattern: "/blog/physician-scorp-vs-sole-proprietorship",
    meta: {
      title: "Physician S-Corp vs Sole Proprietorship Guide | Paycheck MD",
      description:
        "Compare S-Corp and sole proprietorship taxes for physicians: reasonable salary rules, FICA savings, QBI, and compliance costs.",
      type: "article",
    },
  },
  {
    pattern: "/blog/locum-tenens-tax-guide",
    meta: {
      title: "Locum Tenens Tax Guide for Physicians | Paycheck MD",
      description:
        "Locum tenens taxes explained: multi-state filing, travel and lodging deductions, quarterly estimates, and S-Corp vs sole proprietor.",
      type: "article",
    },
  },
  {
    pattern: "/diagnostics/build",
    meta: {
      title: "Build Diagnostics | Paycheck MD",
      description:
        "Internal build diagnostics and version information for Paycheck MD.",
    },
  },
  {
    pattern: "/debug/transactions",
    meta: {
      title: "Transaction Debug | Paycheck MD",
      description:
        "Internal diagnostic view for auditing transaction inclusion in ledgers and tax totals.",
    },
  },
  {
    pattern: "/admin",
    meta: {
      title: "Admin | Paycheck MD",
      description:
        "Administration tools for managing Paycheck MD users, features, and system health.",
    },
  },
  {
    pattern: "/admin/data-isolation",
    meta: {
      title: "Data Isolation | Paycheck MD",
      description:
        "Audit per-table user and organization data isolation for Paycheck MD accounts.",
    },
  },
  {
    pattern: "/admin/tax-validation",
    meta: {
      title: "Tax Validation | Paycheck MD",
      description:
        "Internal tax calculation validation suite for Paycheck MD engineers.",
    },
  },
  {
    pattern: "/admin/student-loan-validation",
    meta: {
      title: "Student Loan Validation | Paycheck MD",
      description:
        "Internal student loan estimator validation suite for Paycheck MD engineers.",
    },
  },
  {
    pattern: "/trust",
    meta: {
      title: "Trust & Security | Paycheck MD",
      description:
        "How Paycheck MD protects physician financial data — access controls, hosting, subprocessors, retention, and security contact.",
    },
  },

];

const DEFAULT_META: Meta = {
  title: "Paycheck MD — Physician Tax Planning",
  description:
    "Paycheck MD helps physicians track income, withholding, tax reserves, and estimated tax progress across W-2 and 1099 work.",
};

function resolveMeta(pathname: string): Meta {
  for (const entry of ROUTE_META) {
    if (matchPath({ path: entry.pattern, end: true }, pathname)) return entry.meta;
  }
  return DEFAULT_META;
}

export function RouteHead() {
  const { pathname } = useLocation();
  const meta = resolveMeta(pathname);
  const url = `${BASE}${pathname === "/" ? "/" : pathname.replace(/\/$/, "")}`;
  return (
    <Helmet>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={meta.type ?? "website"} />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.description} />
    </Helmet>
  );
}
