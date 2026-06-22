import { Link } from "react-router-dom";
import { Shield, Lock, Database, Users, Mail, FileText, ChevronLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Public trust & security page.
 *
 * Maintained by the app owner. Lists app-visible controls and platform
 * capabilities only — no certification or compliance claims. Edit copy
 * directly in this file; do not pull dynamic security findings into this
 * surface.
 */
const APP_NAME = "Paycheck MD";
const APP_OWNER = "Paycheck MD";
const SECURITY_CONTACT = "security@paycheckmd.com";
const PRIVACY_CONTACT = "privacy@paycheckmd.com";
const LAST_REVIEWED = "June 2026";

export default function Trust() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-sm font-semibold text-foreground">
            {APP_NAME}
          </Link>
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link to="/">
              <ChevronLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <section className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary">
            <Shield className="h-3.5 w-3.5" />
            Trust & Security
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            How {APP_NAME} protects your financial data
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This page is maintained by {APP_OWNER} to answer common security and privacy
            questions about {APP_NAME}. It describes the controls and practices we have in
            place today. It is not a certification or independent audit, and it does not
            replace our Terms of Service or Privacy Policy.
          </p>
          <p className="text-xs text-muted-foreground">Last reviewed: {LAST_REVIEWED}</p>
        </section>

        <Section
          icon={<Lock className="h-4 w-4" />}
          title="Access & authentication"
          description="How accounts are protected."
        >
          <List
            items={[
              "Email + password sign-in with rate-limited authentication; password reset by email-verified link.",
              "Sessions are stored as JWTs issued by the managed auth provider and rotated on refresh.",
              "Row-level security (RLS) is enabled on user data tables so each account only sees its own rows.",
              "Administrative roles are stored in a dedicated user_roles table checked server-side, not in client storage.",
            ]}
          />
        </Section>

        <Section
          icon={<Database className="h-4 w-4" />}
          title="Platform & hosting"
          description="Where the application runs."
        >
          <List
            items={[
              `${APP_NAME} is a web application built on Lovable Cloud, which uses a managed Postgres database, authentication, and serverless functions.`,
              "Data is encrypted in transit (HTTPS/TLS) and at rest by the underlying managed platform.",
              "Secrets such as bank-link access tokens are stored in a managed secrets vault and referenced by ID — they are never exposed to the browser.",
              "This describes platform capabilities we rely on; it is not a Lovable-issued certification of this app.",
            ]}
          />
        </Section>

        <Section
          icon={<FileText className="h-4 w-4" />}
          title="Data we collect"
          description="What you give us and what is derived."
        >
          <List
            items={[
              "Account profile: email, name, and tax-filing preferences you enter in onboarding.",
              "Financial data you enter: paychecks, W-2 figures, 1099 income, expenses, mileage, and deductions.",
              "Bank/payroll transactions you import via Plaid, our financial-data connector, after you explicitly link an account.",
              "Operational data needed to run the app: timestamps, error logs, and sync status for connected accounts.",
            ]}
          />
        </Section>

        <Section
          icon={<Users className="h-4 w-4" />}
          title="Subprocessors & integrations"
          description="Third parties that process data on our behalf."
        >
          <List
            items={[
              "Lovable Cloud — application hosting, database, authentication, and serverless functions.",
              "Plaid — bank and payroll account linking and transaction sync (only when you choose to connect an account).",
            ]}
          />
          <p className="text-xs text-muted-foreground mt-3">
            We do not sell your personal or financial data. We do not use your financial
            data to train third-party AI models.
          </p>
        </Section>

        <Section
          icon={<Shield className="h-4 w-4" />}
          title="Retention & deletion"
          description="How long data stays and how to remove it."
        >
          <List
            items={[
              "You can disconnect a linked bank/payroll account at any time from Settings → Connected Accounts.",
              "You can delete your account from Settings → Danger Zone. Deletion removes your application data from our active systems.",
              "Encrypted backups taken by the underlying platform may persist for a limited rolling window before being overwritten.",
            ]}
          />
        </Section>

        <Section
          icon={<Mail className="h-4 w-4" />}
          title="Contact & vulnerability reporting"
          description="How to reach us about security or privacy."
        >
          <ul className="text-sm text-foreground space-y-2">
            <li>
              Security issues:{" "}
              <a className="text-primary underline" href={`mailto:${SECURITY_CONTACT}`}>
                {SECURITY_CONTACT}
              </a>
            </li>
            <li>
              Privacy requests & data deletion:{" "}
              <a className="text-primary underline" href={`mailto:${PRIVACY_CONTACT}`}>
                {PRIVACY_CONTACT}
              </a>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            If you believe you have found a security vulnerability, please email the
            address above with steps to reproduce. We ask that you do not publicly
            disclose the issue until we have had a reasonable opportunity to address it.
          </p>
        </Section>

        <section className="text-xs text-muted-foreground border-t border-border pt-6">
          <p>
            Shared responsibility: {APP_OWNER} is responsible for application-level
            controls, configuration, and how customer data is handled in {APP_NAME}.
            The underlying Lovable Cloud platform is responsible for the infrastructure
            controls it provides. Customers are responsible for safeguarding their
            login credentials and the accounts they choose to link.
          </p>
        </section>
      </main>
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm text-foreground">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted-foreground mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}
