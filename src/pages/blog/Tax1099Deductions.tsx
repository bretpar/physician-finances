import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/BrandLogo";

const CANONICAL = "https://app.paycheckmd.com/blog/1099-tax-deductions";
const TITLE = "1099 Tax Deductions Guide for Freelancers | Paycheck MD";
const DESCRIPTION =
  "Complete guide to 1099 tax deductions: home office, mileage, health insurance, retirement, QBI, and more.";

export default function Tax1099Deductions() {
  // Article JSON-LD only — title/description/canonical/og are managed by RouteHead.
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
            1099 Tax Deductions: The Complete Guide for Freelancers
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            If you earn 1099 income as a freelancer, independent contractor, or gig worker, the
            tax code lets you deduct the ordinary and necessary costs of running your business.
            Tracking those deductions throughout the year is the single biggest lever you have to
            lower your self-employment tax bill.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">What counts as a 1099 tax deduction?</h2>
          <p>
            A 1099 deduction is any business expense that is both <strong>ordinary</strong> (common
            in your line of work) and <strong>necessary</strong> (helpful and appropriate for your
            business). These expenses reduce your <em>net self-employment income</em>, which in
            turn lowers both your federal income tax and your 15.3% self-employment tax.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">The most common 1099 write-offs</h2>

          <h3 className="mt-6 text-xl font-semibold">1. Home office deduction</h3>
          <p>
            If you use part of your home <em>regularly and exclusively</em> for business, you can
            deduct a portion of rent, mortgage interest, utilities, insurance, and depreciation.
            Two methods:
          </p>
          <ul className="list-disc pl-6">
            <li><strong>Simplified method:</strong> $5 per square foot, up to 300 sq ft ($1,500 max).</li>
            <li><strong>Actual expense method:</strong> business-use % × actual home costs. More paperwork, usually larger deduction.</li>
          </ul>

          <h3 className="mt-6 text-xl font-semibold">2. Mileage and vehicle expenses</h3>
          <p>
            Miles driven for business — client visits, supply runs, between-job travel — are
            deductible. For 2026 the IRS standard mileage rate is the simplest approach: multiply
            business miles by the per-mile rate. Alternatively, track actual vehicle costs (gas,
            insurance, maintenance, depreciation) and deduct the business-use percentage.
          </p>
          <p>
            Keep a contemporaneous log: date, miles, destination, and business purpose. Apps that
            track trips automatically make audits much easier.
          </p>

          <h3 className="mt-6 text-xl font-semibold">3. Health insurance premiums</h3>
          <p>
            Self-employed individuals can deduct 100% of health, dental, and qualifying long-term
            care premiums for themselves, a spouse, and dependents — as an above-the-line
            deduction, even if you take the standard deduction.
          </p>

          <h3 className="mt-6 text-xl font-semibold">4. Retirement contributions</h3>
          <p>
            A Solo 401(k), SEP-IRA, or SIMPLE IRA lets you shelter a large share of self-employment
            income. Solo 401(k)s in particular allow both an employee deferral and an employer
            profit-sharing contribution, often totaling tens of thousands per year.
          </p>

          <h3 className="mt-6 text-xl font-semibold">5. Self-employment tax deduction</h3>
          <p>
            You automatically deduct half of your self-employment tax on your federal return. It
            isn't optional — but it's worth knowing so you don't double-count it.
          </p>

          <h3 className="mt-6 text-xl font-semibold">6. Qualified Business Income (QBI) deduction</h3>
          <p>
            Most 1099 contractors can deduct up to 20% of qualified business income, subject to
            income thresholds and the specified-service-trade rules. This is taken on your 1040 —
            not on Schedule C — but it's one of the largest deductions available to freelancers.
          </p>

          <h3 className="mt-6 text-xl font-semibold">7. Software, subscriptions, and tools</h3>
          <p>
            Accounting software, design tools, cloud storage, project-management apps, and
            industry subscriptions are all deductible when used for business.
          </p>

          <h3 className="mt-6 text-xl font-semibold">8. Phone and internet</h3>
          <p>
            Deduct the business-use percentage of your phone and internet bills. A reasonable,
            documented estimate is fine — 100% is hard to defend unless you have a dedicated line.
          </p>

          <h3 className="mt-6 text-xl font-semibold">9. Education and professional development</h3>
          <p>
            Courses, books, certifications, and conferences that maintain or improve skills used in
            your current business are deductible. Education that qualifies you for a new
            profession is not.
          </p>

          <h3 className="mt-6 text-xl font-semibold">10. Business meals</h3>
          <p>
            Meals with clients or while traveling for business are generally 50% deductible. Keep
            the receipt and note who you met with and what you discussed.
          </p>

          <h3 className="mt-6 text-xl font-semibold">11. Marketing and advertising</h3>
          <p>
            Website hosting, domain registration, ads, business cards, and branded materials are
            fully deductible.
          </p>

          <h3 className="mt-6 text-xl font-semibold">12. Professional services</h3>
          <p>
            Legal, accounting, and bookkeeping fees that relate to your business are deductible —
            including the cost of preparing the Schedule C portion of your return.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">How to track deductions during the year</h2>
          <ol className="list-decimal pl-6">
            <li>Open a separate business checking account and run all business income/expenses through it.</li>
            <li>Categorize transactions monthly — don't wait until April.</li>
            <li>Keep digital copies of receipts for anything over $75.</li>
            <li>Log mileage in real time, not from memory.</li>
            <li>Estimate your quarterly tax payments so deductions translate into cash savings, not just a smaller April bill.</li>
          </ol>

          <h2 className="mt-10 text-2xl font-semibold">Common mistakes to avoid</h2>
          <ul className="list-disc pl-6">
            <li>Mixing personal and business spending on the same card.</li>
            <li>Deducting 100% of a phone or vehicle when you also use it personally.</li>
            <li>Claiming a home office that isn't used exclusively for business.</li>
            <li>Forgetting to deduct half of self-employment tax.</li>
            <li>Skipping retirement contributions — they're often the largest legal deduction available.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-semibold">Estimate your 1099 tax bill</h2>
          <p>
            Paycheck MD's free estimator shows what you'll owe based on your 1099 income, expenses,
            and deductions — and how much to set aside each quarter so you aren't surprised in
            April.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/estimate">
              <Button size="lg">Get a free tax estimate</Button>
            </Link>
            <Link to="/signup">
              <Button size="lg" variant="outline">Start tracking deductions</Button>
            </Link>
          </div>

          <p className="mt-10 text-sm text-muted-foreground">
            This article is general information and is not tax advice. Consult a CPA or tax
            professional about your specific situation.
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
