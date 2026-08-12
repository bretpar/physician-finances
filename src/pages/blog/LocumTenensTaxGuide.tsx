import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/BrandLogo";

const CANONICAL = "https://app.paycheckmd.com/blog/locum-tenens-tax-guide";
const TITLE = "Locum Tenens Tax Guide for Physicians | Paycheck MD";
const DESCRIPTION =
  "Locum tenens tax guide for physicians: multi-state filing, travel and lodging deductions, stipends, quarterly estimates, and S-Corp vs sole proprietor.";

export default function LocumTenensTaxGuide() {
  useEffect(() => {
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: TITLE,
        description: DESCRIPTION,
        mainEntityOfPage: CANONICAL,
        author: { "@type": "Organization", name: "Paycheck MD" },
        publisher: { "@type": "Organization", name: "Paycheck MD" },
        datePublished: "2026-08-12",
        dateModified: "2026-08-12",
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Do locum tenens physicians have to file taxes in every state they work in?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Generally yes. Most states tax income earned within their borders, so you file a nonresident return in each state where you worked (unless that state has no income tax or a reciprocity agreement). Your home state taxes all of your income and usually gives a credit for taxes paid to other states.",
            },
          },
          {
            "@type": "Question",
            name: "Can locum tenens doctors deduct travel and lodging?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes, when the assignment is away from your tax home and is temporary — generally expected to last one year or less. Airfare, rental cars, mileage, lodging, and 50% of meals are deductible on Schedule C. Reimbursed or stipend-covered costs cannot be deducted again.",
            },
          },
          {
            "@type": "Question",
            name: "How much should a locum tenens physician set aside for taxes?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "A common starting point is 30–40% of net 1099 income to cover federal income tax, the 15.3% self-employment tax, and any state tax. The right number depends on your bracket, deductions, spousal W-2 withholding, and which states you worked in.",
            },
          },
          {
            "@type": "Question",
            name: "Should a locum tenens physician form an S-Corp?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "An S-Corp usually starts to pay off once net locums income is consistently above roughly $80,000–$100,000 and you can document a reasonable salary. With unpredictable assignment volume or a short locums stretch, a sole proprietorship is often simpler and cheaper.",
            },
          },
        ],
      },
    ]);
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
          <p className="text-sm text-muted-foreground">Tax guide · Updated August 2026</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">
            Locum Tenens Tax Guide for Physicians
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Locum tenens work pays well and travels far — which means your tax return looks nothing
            like an employed physician's. You are almost always a 1099 independent contractor, you
            may owe tax in several states in the same year, and no one is withholding anything on
            your behalf. This guide covers the four things that decide your locums tax bill:
            multi-state filing, travel deductions, quarterly estimates, and entity choice.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">You are a business, not an employee</h2>
          <p>
            Staffing agencies typically pay locums physicians on a 1099-NEC. That means no federal
            or state withholding, no employer FICA match, and no payroll department catching your
            mistakes. Your net income (revenue minus business expenses) flows through Schedule C
            and is subject to:
          </p>
          <ul className="list-disc pl-6">
            <li>Federal income tax at your marginal bracket</li>
            <li>
              Self-employment tax of 15.3% on the first $176,100 of net earnings (2025 Social
              Security wage base), then 2.9% Medicare above it
            </li>
            <li>An extra 0.9% Additional Medicare tax above $200,000 single / $250,000 married filing jointly</li>
            <li>State income tax in each state where you earned the income</li>
          </ul>
          <p>
            The practical implication: a locums physician earning $350,000 of net 1099 income can
            easily owe $110,000–$140,000 in total tax with nothing withheld. Setting money aside as
            you get paid is not optional.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">Multi-state income filing</h2>
          <p>
            This is the single biggest difference between locums and other physician tax returns.
            States tax income sourced to work physically performed inside their borders, so a year
            with assignments in four states can mean four nonresident returns plus your resident
            return.
          </p>
          <h3 className="mt-6 text-xl font-semibold">How the sourcing usually works</h3>
          <ol className="list-decimal pl-6">
            <li>
              <strong>Each work state:</strong> file a nonresident return reporting only the income
              earned on assignments in that state.
            </li>
            <li>
              <strong>Your home (resident) state:</strong> report 100% of your income, then claim a
              credit for taxes paid to the other states so the same dollars are not taxed twice.
            </li>
            <li>
              <strong>No-income-tax states:</strong> assignments in states like Texas, Florida,
              Washington, Tennessee, Nevada, and South Dakota generate no state income tax return —
              but if you live in a taxing state, your home state still taxes that income.
            </li>
          </ol>
          <h3 className="mt-6 text-xl font-semibold">What to track per assignment</h3>
          <ul className="list-disc pl-6">
            <li>State and facility for every assignment</li>
            <li>First and last day worked, and the number of days worked in that state</li>
            <li>Gross pay attributable to that assignment</li>
            <li>Travel days and reimbursements tied to that assignment</li>
          </ul>
          <p>
            Agencies rarely break income out by state for you, and a single 1099 can cover work in
            three states. If you cannot reconstruct which dollars came from where, you cannot file
            accurate nonresident returns — so record it as you go, assignment by assignment.
          </p>
          <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
            Watch out for states with credit quirks and city-level taxes (New York, California,
            Ohio, and Pennsylvania localities are common surprises), and for residency traps if you
            spend a large share of the year in one state that is not your home state.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">Travel, lodging, and the "tax home" rule</h2>
          <p>
            Locums travel deductions hinge on one concept: your <strong>tax home</strong>. That is
            the general area of your main place of business or, if you work in many places, the area
            where you maintain your permanent residence and regular living expenses. Travel away
            from your tax home for a <em>temporary</em> assignment — one reasonably expected to last
            one year or less — is deductible.
          </p>
          <p>
            If an assignment is expected to last more than a year, or you keep renewing at the same
            site indefinitely, that location can become your new tax home and the travel deductions
            stop.
          </p>
          <h3 className="mt-6 text-xl font-semibold">Commonly deductible on Schedule C</h3>
          <ul className="list-disc pl-6">
            <li>Airfare, rental cars, rideshare, parking, tolls, and baggage fees</li>
            <li>Lodging at the assignment site (hotel, short-term rental, corporate housing)</li>
            <li>Meals while traveling away from your tax home — 50% deductible, or use the federal per diem rate</li>
            <li>Mileage in your own vehicle at the IRS business rate (70¢ per mile for 2025)</li>
            <li>State medical licenses, DEA registration, credentialing, and application fees</li>
            <li>Malpractice premiums and tail coverage you pay yourself</li>
            <li>CME, board fees, medical society dues, journals, and specialty software</li>
            <li>Scrubs, loupes, stethoscopes, laptop, phone (business-use portion)</li>
            <li>Home office used regularly and exclusively for admin work, charting, and telehealth</li>
            <li>Self-employed health insurance premiums and a Solo 401(k) or SEP-IRA</li>
          </ul>
          <h3 className="mt-6 text-xl font-semibold">Stipends and reimbursements</h3>
          <p>
            Many agencies pay travel and housing stipends or book them directly. The rule is simple:
            you cannot deduct what you did not pay for out of pocket. If a stipend is included in
            your 1099 income, the corresponding expenses are deductible; if the agency paid the
            hotel directly and it is not in your 1099, it is not your deduction. Keep the agency's
            pay statements — they are the evidence for which side of the line each dollar falls on.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">Quarterly estimated taxes</h2>
          <p>
            With no withholding, the IRS expects payments four times a year. Federal due dates are
            April 15, June 15, September 15, and January 15 of the following year, and most taxing
            states follow the same schedule with their own vouchers.
          </p>
          <table className="mt-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Quarter</th>
                <th className="py-2 pr-4">Income period</th>
                <th className="py-2">Federal due date</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2 pr-4">Q1</td>
                <td className="py-2 pr-4">Jan 1 – Mar 31</td>
                <td className="py-2">April 15</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2 pr-4">Q2</td>
                <td className="py-2 pr-4">Apr 1 – May 31</td>
                <td className="py-2">June 15</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2 pr-4">Q3</td>
                <td className="py-2 pr-4">Jun 1 – Aug 31</td>
                <td className="py-2">September 15</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Q4</td>
                <td className="py-2 pr-4">Sep 1 – Dec 31</td>
                <td className="py-2">January 15</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4">
            You avoid underpayment penalties by hitting a safe harbor: pay 90% of the current year's
            tax, or 100% of last year's tax (110% if your prior-year AGI exceeded $150,000). For
            physicians whose locums income swings year to year, the prior-year safe harbor is
            usually the easiest target to hit.
          </p>
          <p>
            If you have a W-2 job or a spouse with wages, increasing that withholding is an
            alternative to writing quarterly checks — withholding counts as paid evenly across the
            year, which can cure an earlier shortfall.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">S-Corp vs. sole proprietorship for locums</h2>
          <p>
            As a sole proprietor, every dollar of net income is exposed to self-employment tax. With
            an S-Corp election, you pay yourself a reasonable W-2 salary (subject to FICA) and take
            the remaining profit as a distribution that avoids the 15.3% layer.
          </p>
          <table className="mt-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Factor</th>
                <th className="py-2 pr-4">Sole proprietor</th>
                <th className="py-2">S-Corp</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2 pr-4">Self-employment tax base</td>
                <td className="py-2 pr-4">All net profit</td>
                <td className="py-2">Salary only</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2 pr-4">Annual compliance cost</td>
                <td className="py-2 pr-4">Minimal</td>
                <td className="py-2">~$2,000–$5,000 (payroll + 1120-S)</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2 pr-4">Multi-state complexity</td>
                <td className="py-2 pr-4">Nonresident returns</td>
                <td className="py-2">Nonresident returns plus possible entity registrations and payroll filings</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Best fit</td>
                <td className="py-2 pr-4">Occasional or short-term locums</td>
                <td className="py-2">Consistent full-time locums income</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4">
            The multi-state angle is the locums-specific catch: an S-Corp working across several
            states may need to register the entity and run payroll reporting in more than one state,
            which erodes some of the FICA savings. Many locums physicians stay sole proprietors
            during a travel-heavy year and elect S-Corp status once assignments concentrate in one
            or two states.
          </p>
          <p>
            For the full breakdown of the reasonable-salary rule and the savings math, see our{" "}
            <Link to="/blog/physician-scorp-vs-sole-proprietorship" className="underline">
              physician S-Corp vs. sole proprietorship guide
            </Link>
            , and our{" "}
            <Link to="/blog/1099-tax-deductions" className="underline">
              1099 tax deductions guide
            </Link>{" "}
            for a deduction-by-deduction walkthrough.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">Locum tenens tax checklist</h2>
          <ol className="list-decimal pl-6">
            <li>Log every assignment: state, facility, dates, days worked, and gross pay.</li>
            <li>Separate reimbursed travel from out-of-pocket travel as it happens.</li>
            <li>Keep a business bank account and card so Schedule C expenses are clean.</li>
            <li>Set aside 30–40% of each payment for taxes the day it lands.</li>
            <li>Pay federal and state estimates on all four due dates.</li>
            <li>Track mileage contemporaneously — reconstructed logs do not survive audits.</li>
            <li>Fund a Solo 401(k) or SEP-IRA to convert tax into retirement savings.</li>
            <li>Revisit entity choice each year as your income and state mix change.</li>
          </ol>

          <h2 className="mt-10 text-2xl font-semibold">Frequently asked questions</h2>
          <h3 className="mt-6 text-xl font-semibold">
            Do I have to file taxes in every state I work in?
          </h3>
          <p>
            Generally yes — a nonresident return for each taxing state where you physically worked,
            plus your resident return with a credit for taxes paid elsewhere.
          </p>
          <h3 className="mt-6 text-xl font-semibold">Can I deduct my housing on assignment?</h3>
          <p>
            Yes, if the assignment is temporary (expected to last a year or less), away from your
            tax home, and you paid for the lodging yourself rather than through an agency-paid or
            excluded stipend.
          </p>
          <h3 className="mt-6 text-xl font-semibold">How much should I set aside?</h3>
          <p>
            Start at 30–40% of net 1099 income and refine it with an actual projection once you know
            your bracket, deductions, and which states are in play.
          </p>
          <h3 className="mt-6 text-xl font-semibold">Is an S-Corp worth it for locums?</h3>
          <p>
            Usually once net income is consistently above roughly $80,000–$100,000 and your
            assignments are not scattered across many payroll-registering states.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">Estimate your locums tax bill</h2>
          <p>
            Paycheck MD is built for physicians juggling W-2 and 1099 income. Track locums pay by
            assignment, capture mileage and travel deductions, and see exactly how much to reserve
            for each quarter — no spreadsheets.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/estimate">
              <Button size="lg">Get a free tax estimate</Button>
            </Link>
            <Link to="/signup">
              <Button size="lg" variant="outline">Start tracking locums income</Button>
            </Link>
          </div>

          <p className="mt-10 text-sm text-muted-foreground">
            This article is general information and is not tax advice. Multi-state sourcing, tax
            home determinations, and entity elections depend on your specific facts. Consult a CPA
            familiar with locum tenens physicians before filing.
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
