import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/BrandLogo";

const CANONICAL = "https://app.paycheckmd.com/blog/physician-scorp-vs-sole-proprietorship";
const TITLE = "Physician S-Corp vs. Sole Proprietorship: Tax Savings Guide | Paycheck MD";
const DESCRIPTION =
  "Compare S-Corp and sole proprietorship tax benefits for physicians. Learn how the 'reasonable salary' rule and FICA savings can reduce your tax bill.";

export default function PhysicianScorpVsSoleProprietorship() {
  useEffect(() => {
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      description: DESCRIPTION,
      mainEntityOfPage: CANONICAL,
      author: { "@type": "Organization", name: "Paycheck MD" },
      publisher: { "@type": "Organization", name: "Paycheck MD" },
      datePublished: "2026-06-14",
      dateModified: "2026-06-14",
    });
    document.head.appendChild(ld);
    return () => {
      document.head.removeChild(ld);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <BrandLogo className="h-8 w-8 rounded-md" />
            <span className="text-base font-semibold">Paycheck MD</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/estimate">
              <Button variant="ghost" size="sm">Free tax estimate</Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">Get started</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <article className="prose prose-slate max-w-none">
          <p className="text-sm text-muted-foreground">Tax guide · Updated June 2026</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">
            Physician S-Corp vs. Sole Proprietorship: Which Saves More on Taxes?
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            If you are a physician earning 1099 or practice income, choosing between a sole
            proprietorship and an S-Corporation is one of the most consequential tax decisions
            you will make. The right structure can save you thousands of dollars a year in
            self-employment tax — but the wrong one can trigger IRS scrutiny or leave money on the
            table.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">How sole proprietorship taxes work for doctors</h2>
          <p>
            By default, a physician who contracts independently or runs a small practice is a sole
            proprietor. All net business income is subject to federal income tax <em>and</em> the
            full 15.3% self-employment tax (FICA). There is no employer to split Social Security
            and Medicare taxes with, so you pay both halves on every dollar of profit.
          </p>
          <p>
            You do get an above-the-line deduction for one-half of the self-employment tax, but the
            remaining half is still real money out of your pocket. On $200,000 of net income, the
            self-employment tax alone is roughly $22,000 — before federal and state income taxes
            are even calculated.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">How an S-Corp changes the math</h2>
          <p>
            When you elect S-Corp status, your business files its own return and you become an
            employee of the corporation. Your total earnings are split into two buckets:
          </p>
          <ul className="list-disc pl-6">
            <li>
              <strong>Reasonable salary (W-2 wages):</strong> subject to regular payroll taxes
              (FICA), split between employer and employee just like a hospital job.
            </li>
            <li>
              <strong>Remaining profit (distribution):</strong> passed through to you as a
              shareholder distribution. It avoids self-employment tax entirely.
            </li>
          </ul>
          <p>
            That pass-through profit is still subject to ordinary income tax, but skipping the 15.3%
            FICA layer on the distribution portion is where the bulk of the savings come from.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">The "reasonable salary" rule — and why it matters</h2>
          <p>
            The IRS requires that S-Corp owner-employees pay themselves a <strong>reasonable
            salary</strong> for the work they perform. You cannot zero out wages and take everything
            as a distribution. What counts as "reasonable" depends on:
          </p>
          <ul className="list-disc pl-6">
            <li>Your medical specialty and geographic market rates</li>
            <li>Years of experience and board certifications</li>
            <li>Hours worked and scope of duties</li>
            <li>Compensation data from comparable employed positions</li>
          </ul>
          <p>
            For a board-certified internist working full-time in a mid-size city, a reasonable salary
            might fall between $180,000 and $250,000. If the practice nets $350,000, the remaining
            $100,000–$170,000 can be distributed — avoiding ~$15,000–$26,000 in self-employment tax.
          </p>
          <p>
            Underpaying yourself to maximize distributions is a common audit trigger. Document your
            salary rationale with market data and keep it in your corporate records.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">Self-employment tax (FICA) savings at a glance</h2>
          <table className="mt-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Structure</th>
                <th className="py-2 pr-4">FICA on $300k net</th>
                <th className="py-2">Approximate tax</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2 pr-4">Sole proprietorship</td>
                <td className="py-2 pr-4">100% of net income</td>
                <td className="py-2">~$34,500</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">S-Corp</td>
                <td className="py-2 pr-4">Only on $200k salary</td>
                <td className="py-2">~$23,000</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-sm text-muted-foreground">
            Figures are illustrative. Actual savings depend on salary level, state taxes, and
            additional payroll costs.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">Other S-Corp considerations for physicians</h2>

          <h3 className="mt-6 text-xl font-semibold">Qualified Business Income (QBI) deduction</h3>
          <p>
            Both sole proprietors and S-Corp shareholders may qualify for the 20% QBI deduction,
            but the calculation differs. For S-Corps, the 20% applies to the <em>combined</em>
            salary and distribution, subject to income limits and the specified-service trade
            rules that apply to many medical practices.
          </p>

          <h3 className="mt-6 text-xl font-semibold">Retirement contributions</h3>
          <p>
            An S-Corp can sponsor a Solo 401(k). Your employee deferral is based on W-2 wages, and
            the employer profit-sharing contribution is based on total W-2 compensation. Because
            the contribution limits are tied to salary, a very low salary can reduce your ability to
            maximize retirement savings — another reason to set wages at a reasonable, not
            artificially low, level.
          </p>

          <h3 className="mt-6 text-xl font-semibold">Administrative costs</h3>
          <p>
            S-Corps require payroll processing, corporate tax returns, separate bookkeeping, and
            formalities like minutes and bylaws. These costs typically run $2,000–$5,000 per year
            but are usually dwarfed by the FICA savings at physician income levels.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">When a sole proprietorship still makes sense</h2>
          <ul className="list-disc pl-6">
            <li>Side income under ~$60,000 — the savings may not justify the overhead.</li>
            <li>Locums or per-diem work with unpredictable annual volume.</li>
            <li>You are still employed full-time elsewhere and the 1099 income is secondary.</li>
            <li>You prefer the simplest possible tax filing.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-semibold">Quick checklist: Should you elect S-Corp status?</h2>
          <ol className="list-decimal pl-6">
            <li>Do you expect $80,000+ in net 1099 or practice income after expenses?</li>
            <li>Can you document a reasonable salary based on market rates?</li>
            <li>Are you comfortable running payroll at least quarterly?</li>
            <li>Do the estimated FICA savings exceed $3,000–$5,000 in added compliance costs?</li>
          </ol>
          <p className="mt-4">
            If you answered yes to most of these, an S-Corp election is usually the right move for
            a physician.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">Track your income and estimate your tax bill</h2>
          <p>
            Whether you are a sole proprietor or an S-Corp, Paycheck MD helps physicians track
            1099 income, expenses, and quarterly estimates — so you know exactly how much to set
            aside and avoid surprises at tax time.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/estimate">
              <Button size="lg">Get a free tax estimate</Button>
            </Link>
            <Link to="/signup">
              <Button size="lg" variant="outline">Start tracking income</Button>
            </Link>
          </div>

          <p className="mt-10 text-sm text-muted-foreground">
            This article is general information and is not tax advice. Entity selection and salary
            decisions depend on your specific situation. Consult a CPA or tax attorney before
            making an S-Corp election.
          </p>
        </article>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Paycheck MD ·{" "}
          <Link to="/estimate" className="underline">Free estimate</Link> ·{" "}
          <Link to="/login" className="underline">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
