import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lightweight educational content for Tax Savings categories.
 * Display-only: static copy, no calculations and no data access.
 */
export interface DeductionInsightContent {
  /** 1-2 sentence plain-English explanation. */
  explanation: string;
  /** Who typically qualifies. */
  typicalUsers: string[];
  /** How the benefit works. */
  effect: "Reduces taxable income" | "Directly reduces taxes owed";
  /** One practical tip. */
  tip: string;
}

export const DEDUCTION_INSIGHTS: Record<string, DeductionInsightContent> = {
  mileage: {
    explanation:
      "Miles you drive for business — between work sites, to see patients, or to business errands — can be deducted at the IRS standard rate. Commuting from home to your regular workplace does not count.",
    typicalUsers: ["1099 contractors", "Self-employed physicians", "Small business owners"],
    effect: "Reduces taxable income",
    tip: "Log trips as they happen; a contemporaneous mileage log is what the IRS expects if asked.",
  },
  "home-office": {
    explanation:
      "If you regularly work from a dedicated area of your home for your business, you may qualify for a home office deduction. This reduces your taxable business income.",
    typicalUsers: ["Self-employed", "1099 contractors", "Small business owners"],
    effect: "Reduces taxable income",
    tip: "The simplified method ($5 per square foot, up to 300 sq ft) may be easier for many taxpayers.",
  },
  retirement: {
    explanation:
      "Contributions to retirement accounts like a Solo 401(k), SEP IRA, or workplace 401(k) are generally made before tax. Every dollar you contribute lowers the income you're taxed on this year.",
    typicalUsers: ["W-2 employees", "Self-employed", "Business owners with 1099 income"],
    effect: "Reduces taxable income",
    tip: "Self-employed physicians can often contribute far more through a Solo 401(k) than a standard IRA.",
  },
  hsa: {
    explanation:
      "A Health Savings Account pairs with a high-deductible health plan and lets you set money aside before tax for medical costs. Contributions, growth, and qualified withdrawals are all tax-advantaged.",
    typicalUsers: ["Anyone enrolled in a qualifying high-deductible health plan"],
    effect: "Reduces taxable income",
    tip: "Payroll contributions also avoid Social Security and Medicare tax, so contributing through work usually saves more.",
  },
  "student-loan-interest": {
    explanation:
      "You can deduct interest paid on qualified student loans, up to $2,500 a year. The deduction phases out as your income rises, and disappears entirely above the annual limit.",
    typicalUsers: ["Residents and fellows", "Early-career physicians", "Anyone repaying federal or private student loans"],
    effect: "Reduces taxable income",
    tip: "Your loan servicer's Form 1098-E shows the exact interest you paid for the year.",
  },
  "se-health": {
    explanation:
      "Self-employed people who pay their own medical, dental, or long-term care premiums can often deduct them. It applies to premiums for you, your spouse, and your dependents.",
    typicalUsers: ["Self-employed", "1099 contractors", "Partners and S-corp owners"],
    effect: "Reduces taxable income",
    tip: "The deduction generally isn't allowed for months you could have joined a spouse's employer plan.",
  },
  "mortgage-interest": {
    explanation:
      "Interest on a mortgage for your main or second home can be deducted if you itemize. It only helps if your itemized deductions exceed the standard deduction.",
    typicalUsers: ["Homeowners with a mortgage", "Taxpayers who itemize"],
    effect: "Reduces taxable income",
    tip: "Compare your total itemized deductions to the standard deduction before assuming this helps.",
  },
  salt: {
    explanation:
      "State and local income, sales, and property taxes can be deducted if you itemize, subject to an annual cap. In no-income-tax states this is usually property and sales tax.",
    typicalUsers: ["Taxpayers who itemize", "Homeowners paying property tax"],
    effect: "Reduces taxable income",
    tip: "Keep property tax statements — they're the easiest part of this deduction to overlook.",
  },
  charitable: {
    explanation:
      "Donations to qualified charities are deductible if you itemize. Both cash gifts and donated property can count.",
    typicalUsers: ["Taxpayers who itemize", "Regular donors"],
    effect: "Reduces taxable income",
    tip: "Keep written acknowledgment for any single gift of $250 or more.",
  },
  "other-adjustments": {
    explanation:
      "Certain deductions come off your income before AGI is calculated, so you get them whether or not you itemize. Examples include educator expenses and some early-withdrawal penalties.",
    typicalUsers: ["Most taxpayers, depending on circumstances"],
    effect: "Reduces taxable income",
    tip: "Above-the-line adjustments also lower AGI, which can unlock other income-limited tax breaks.",
  },
};

export function WhyThisMattersButton({
  open,
  onToggle,
  controlsId,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  controlsId: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      aria-controls={controlsId}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline min-h-[44px] sm:min-h-0 sm:py-1",
        className,
      )}
    >
      <HelpCircle className="h-3.5 w-3.5 shrink-0" />
      Why this matters
    </button>
  );
}

export function DeductionInsightPanel({
  id,
  content,
}: {
  id: string;
  content: DeductionInsightContent;
}) {
  return (
    <div id={id} className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-3 space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">{content.explanation}</p>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Typical users
        </p>
        <ul className="space-y-0.5">
          {content.typicalUsers.map((u) => (
            <li key={u} className="text-xs text-foreground/80">
              • {u}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs font-medium text-foreground/80">{content.effect}</p>
      <div className="space-y-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tip</p>
        <p className="text-xs text-muted-foreground">{content.tip}</p>
      </div>
    </div>
  );
}
