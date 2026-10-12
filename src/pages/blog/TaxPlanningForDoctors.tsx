import { Link } from "react-router-dom";
import { GuideLayout } from "@/components/GuideLayout";

export default function TaxPlanningForDoctors() {
  return (
    <GuideLayout
      path="/blog/tax-planning-for-doctors"
      title="Tax Planning for Doctors: A Year-Round Checklist"
      description="Tax planning for doctors with W-2 and 1099 income: retirement accounts, HSAs, withholding, quarterly estimates, side-gig deductions, and a month-by-month checklist."
      updated="October 2026"
      datePublished="2026-10-12"
    >
      <h1 className="text-4xl font-bold tracking-tight">Tax Planning for Doctors: A Year-Round Checklist</h1>
      <p className="text-lg text-muted-foreground">
        Physicians earn a lot, start late, and often mix a W-2 job with 1099 side work. That combo
        makes April surprises common. Good tax planning is mostly a handful of habits done during
        the year — not a scramble at filing time.
      </p>

      <h2>1. Max out tax-advantaged accounts</h2>
      <ul>
        <li>
          <strong>Employer 401(k) or 403(b):</strong> $23,500 employee limit in 2025 (more if you're
          50+). Many hospitals also offer a 457(b) with its own separate limit.
        </li>
        <li>
          <strong>Solo 401(k) or SEP-IRA</strong> for 1099 or locums income — a second bucket on top
          of your employer plan.
        </li>
        <li>
          <strong>HSA:</strong> if you have a high-deductible plan, $4,300 self-only / $8,550 family
          in 2025. Deductible going in, tax-free coming out for medical costs.
        </li>
        <li>
          <strong>Backdoor Roth IRA:</strong> most physicians earn too much to contribute directly,
          but can still fund a Roth through the backdoor.
        </li>
      </ul>

      <h2>2. Check your W-2 withholding</h2>
      <p>
        Payroll withholding assumes your paycheck is your only income. Add a spouse's salary,
        moonlighting, or a signing bonus and you can come up short. Update your W-4 or add extra
        withholding mid-year rather than waiting for a bill.
      </p>

      <h2>3. Pay quarterly estimates on 1099 income</h2>
      <p>
        Locums, moonlighting, expert witness work, and consulting have no withholding. Federal
        estimates are due around April 15, June 15, September 15, and January 15. Paying 100% of
        last year's tax (110% if prior-year income was over $150,000) generally keeps you safe from
        underpayment penalties. See{" "}
        <Link to="/blog/how-much-to-set-aside-for-taxes-locum-tenens">
          how much to set aside for locums taxes
        </Link>
        .
      </p>

      <h2>4. Track side-income deductions as you go</h2>
      <p>
        If you have 1099 income, business expenses come off before tax: licenses, board fees, CME,
        malpractice you pay yourself, travel for assignments, and business mileage. A log kept during
        the year beats one rebuilt in March. The{" "}
        <Link to="/blog/1099-tax-deductions">1099 deductions guide</Link> lists the common ones.
      </p>

      <h2>5. Revisit your business structure</h2>
      <p>
        Once 1099 income is steady and significant, an S-Corp election can trim self-employment
        tax. Compare options in{" "}
        <Link to="/blog/physician-scorp-vs-sole-proprietorship">S-Corp vs sole proprietorship</Link>{" "}
        and <Link to="/blog/llc-for-locum-tenens">should you form an LLC</Link>.
      </p>

      <h2>6. Plan around student loans</h2>
      <p>
        If you're on an income-driven repayment plan or pursuing PSLF, how you file (jointly or
        separately) and how much you put into pre-tax accounts can change your payment. Run the
        numbers before you file.
      </p>

      <h2>Month-by-month checklist</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>January</td>
            <td>Pay Q4 estimate; set this year's retirement contribution amounts</td>
          </tr>
          <tr>
            <td>April</td>
            <td>File or extend; pay Q1 estimate; finish last year's IRA/HSA contributions</td>
          </tr>
          <tr>
            <td>June</td>
            <td>Pay Q2 estimate; check withholding against actual income so far</td>
          </tr>
          <tr>
            <td>September</td>
            <td>Pay Q3 estimate; decide on any entity change for next year</td>
          </tr>
          <tr>
            <td>November–December</td>
            <td>Top up retirement contributions; review deductions; adjust withholding if short</td>
          </tr>
        </tbody>
      </table>
    </GuideLayout>
  );
}
