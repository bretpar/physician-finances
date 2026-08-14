import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandLogo } from "@/components/BrandLogo";
import { Calculator, LineChart, Receipt, ShieldCheck, Wallet, CalendarClock } from "lucide-react";

const CANONICAL = "https://app.paycheckmd.com/";

const FEATURES = [
  {
    icon: Wallet,
    title: "W-2 and 1099 income in one place",
    body: "Log paychecks with federal, Social Security, Medicare, state, 401(k), and HSA detail, plus 1099 and locums work alongside it.",
  },
  {
    icon: Calculator,
    title: "Tax estimates built for physicians",
    body: "Federal brackets, self-employment tax, Additional Medicare, and the QBI deduction are calculated together instead of guessed at.",
  },
  {
    icon: CalendarClock,
    title: "Quarterly estimate guidance",
    body: "See whether withholding plus reserves are keeping pace with your quarterly obligation before the due date arrives.",
  },
  {
    icon: Receipt,
    title: "Deductions and tax savings",
    body: "Track mileage, home office, and business expenses, and see which retirement and HSA contribution room is still open.",
  },
  {
    icon: LineChart,
    title: "Income planner",
    body: "Project future paychecks and contract work to forecast the year and test a new job, shift load, or side 1099 before you commit.",
  },
  {
    icon: ShieldCheck,
    title: "Your data stays yours",
    body: "Per-account isolation and access controls, documented on our trust page.",
  },
];

const FAQ = [
  {
    q: "What is tax planning for doctors?",
    a: "Tax planning for doctors is deciding, during the year, how much to withhold, how much to set aside for estimated taxes, and which deductions and retirement contributions to use — instead of finding out the result at filing time. Physicians usually need it because high marginal rates, mixed W-2 and 1099 income, and multi-state work make withholding alone unreliable.",
  },
  {
    q: "How much should a physician set aside for taxes on 1099 income?",
    a: "A common starting point is 30–40% of net 1099 income to cover federal income tax, the 15.3% self-employment tax, and any state tax. The right number depends on your bracket, deductions, a spouse's W-2 withholding, and the states you worked in — which is what Paycheck MD calculates from your actual entries.",
  },
  {
    q: "Do doctors with only W-2 income need tax planning?",
    a: "Yes. W-2 withholding is based on a form, not on your real year: bonuses, moonlighting, two employers, or a working spouse can leave you under-withheld. Planning ahead lets you adjust your W-4 or hold a reserve before the shortfall becomes a penalty.",
  },
  {
    q: "When should physicians consider an S-Corp?",
    a: "An S-Corp generally starts to pay off once net self-employment income is consistently above roughly $80,000–$100,000 and you can document a reasonable salary. Below that, the added payroll and compliance cost often outweighs the FICA savings.",
  },
];

export default function Landing() {
  useEffect(() => {
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Paycheck MD",
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: CANONICAL,
        description:
          "Tax planning for doctors: track W-2 and 1099 income, estimate federal, state, and self-employment taxes, and stay ahead of quarterly payments.",
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
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
            <Link to="/login">
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex">Sign in</Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">Get started</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-4 py-14 sm:py-20">
          <p className="text-sm font-medium uppercase tracking-wide text-primary">For physicians</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
            Tax planning for doctors, all year — not just in April
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Paycheck MD is a tax planning app built for physicians with W-2 salary, 1099 moonlighting,
            or locum tenens work. Track every paycheck, see your real federal, state, and
            self-employment tax picture, and know what to set aside before each quarterly deadline.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/signup" className="sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto">Start planning free</Button>
            </Link>
            <Link to="/estimate" className="sm:w-auto">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Try the free tax estimator
              </Button>
            </Link>
          </div>
        </section>

        <section className="border-t border-border bg-card/50 py-14 sm:py-16">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-2xl font-semibold sm:text-3xl">What physician tax planning looks like here</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <Card key={title} className="h-full">
                  <CardHeader className="pb-3">
                    <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                    <CardTitle as="h3" className="mt-3 text-base">{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-2xl font-semibold sm:text-3xl">Why physicians need a tax plan</h2>
            <div className="mt-6 space-y-4 text-base text-muted-foreground">
              <p>
                Attending pay usually pushes physicians into the top marginal brackets, where the
                Additional Medicare tax and phase-outs start to matter. Add a 1099 shift, a locums
                assignment, or a spouse's income and your W-4 no longer describes your year — the
                shortfall shows up as an underpayment penalty rather than a surprise bill you can plan for.
              </p>
              <p>
                Planning ahead changes the decisions you can make: adjusting withholding mid-year,
                funding a solo 401(k) or HSA before the deadline, keeping mileage and home-office
                records as you go, and paying estimated taxes on schedule instead of catching up in April.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-4 text-sm">
              <Link to="/blog/locum-tenens-tax-guide" className="text-primary underline underline-offset-4">
                Locum tenens tax guide
              </Link>
              <Link to="/blog/physician-scorp-vs-sole-proprietorship" className="text-primary underline underline-offset-4">
                Physician S-Corp vs sole proprietorship
              </Link>
              <Link to="/blog/1099-tax-deductions" className="text-primary underline underline-offset-4">
                1099 tax deductions
              </Link>
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-card/50 py-14 sm:py-16">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-2xl font-semibold sm:text-3xl">Physician tax planning FAQ</h2>
            <dl className="mt-8 space-y-6">
              {FAQ.map((item) => (
                <div key={item.q}>
                  <dt className="text-base font-semibold">{item.q}</dt>
                  <dd className="mt-2 text-sm text-muted-foreground">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-3xl px-4 text-center">
            <h2 className="text-2xl font-semibold sm:text-3xl">Start your tax plan this year</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
              Add your income sources once and Paycheck MD keeps the estimate, reserve, and quarterly
              schedule current as the year goes on.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/signup">
                <Button size="lg" className="w-full sm:w-auto">Create a free account</Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">Sign in</Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Paycheck MD. Educational information, not tax advice.</p>
          <nav className="flex gap-4">
            <Link to="/trust" className="underline underline-offset-4">Trust &amp; security</Link>
            <Link to="/estimate" className="underline underline-offset-4">Tax estimator</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
