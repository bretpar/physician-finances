import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Shared public layout for Privacy and Terms, matching the Trust page. */
export function LegalPage({ title, intro, updated, children }: { title: string; intro: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-sm font-semibold text-foreground">Paycheck MD</Link>
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link to="/"><ChevronLeft className="h-4 w-4" /> Back</Link>
          </Button>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <section className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{intro}</p>
          <p className="text-xs text-muted-foreground">Last updated: {updated}</p>
        </section>
        {children}
        <nav className="flex flex-wrap gap-4 border-t border-border pt-6 text-sm text-muted-foreground">
          <Link to="/privacy" className="underline underline-offset-4">Privacy</Link>
          <Link to="/terms" className="underline underline-offset-4">Terms</Link>
          <Link to="/trust" className="underline underline-offset-4">Trust &amp; security</Link>
        </nav>
      </main>
    </div>
  );
}

export function LegalSection({ title, items, children }: { title: string; items?: string[]; children?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle as="h2" className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2 text-sm text-foreground leading-relaxed">
        {items && (
          <ul className="list-disc pl-5 space-y-2">
            {items.map((i) => <li key={i}>{i}</li>)}
          </ul>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export function LegalLinks() {
  return (
    <nav className="flex justify-center gap-4 text-xs text-muted-foreground">
      <Link to="/privacy" className="underline underline-offset-4">Privacy</Link>
      <Link to="/terms" className="underline underline-offset-4">Terms</Link>
    </nav>
  );
}
