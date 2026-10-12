import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/BrandLogo";

export const GUIDE_LINKS = [
  { to: "/blog/tax-planning-for-doctors", label: "Tax planning for doctors" },
  { to: "/blog/how-much-to-set-aside-for-taxes-locum-tenens", label: "How much to set aside for locums taxes" },
  { to: "/blog/llc-for-locum-tenens", label: "Should locums physicians form an LLC?" },
  { to: "/blog/locum-tenens-tax-guide", label: "Locum tenens tax guide" },
  { to: "/blog/physician-scorp-vs-sole-proprietorship", label: "Physician S-Corp vs sole proprietorship" },
  { to: "/blog/1099-tax-deductions", label: "1099 tax deductions" },
];

interface GuideLayoutProps {
  path: string;
  title: string;
  description: string;
  updated: string;
  datePublished: string;
  children: ReactNode;
}

export function GuideLayout({ path, title, description, updated, datePublished, children }: GuideLayoutProps) {
  const canonical = `https://app.paycheckmd.com${path}`;

  useEffect(() => {
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description,
      mainEntityOfPage: canonical,
      author: { "@type": "Organization", name: "Paycheck MD" },
      publisher: { "@type": "Organization", name: "Paycheck MD" },
      datePublished,
      dateModified: datePublished,
    });
    document.head.appendChild(ld);
    return () => {
      document.head.removeChild(ld);
    };
  }, [title, description, canonical, datePublished]);

  const related = GUIDE_LINKS.filter((g) => g.to !== path);

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
        <article className="max-w-none space-y-4 leading-relaxed [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:underline [&_table]:w-full [&_table]:text-sm [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_td]:py-2 [&_td]:pr-4 [&_tr]:border-b [&_tr]:border-border">
          <p className="text-sm text-muted-foreground">Tax guide · Updated {updated}</p>
          {children}

          <h2>Get your own number</h2>
          <p>
            Paycheck MD is built for physicians with W-2 and 1099 income. Log each paycheck or locums
            payment and it shows how much to set aside, what you owe each quarter, and whether you
            are on track.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/estimate" className="no-underline">
              <Button size="lg">Get a free tax estimate</Button>
            </Link>
            <Link to="/signup" className="no-underline">
              <Button size="lg" variant="outline">Start tracking income</Button>
            </Link>
          </div>

          <h2>More physician tax guides</h2>
          <ul>
            {related.map((g) => (
              <li key={g.to}>
                <Link to={g.to}>{g.label}</Link>
              </li>
            ))}
          </ul>

          <p className="mt-10 text-sm text-muted-foreground">
            This article is general information, not tax or legal advice. Figures use 2025 federal
            rules where noted. Your situation depends on your state, filing status, and facts —
            confirm with a CPA familiar with physicians before acting.
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
