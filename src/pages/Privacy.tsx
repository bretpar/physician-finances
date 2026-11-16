import { LegalPage, LegalSection } from "@/components/legal/LegalPage";

const PRIVACY_CONTACT = "privacy@paycheckmd.com";

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="November 2026"
      intro="This page explains what information Paycheck MD handles and why. Paycheck MD is a tax-planning app for physicians; it provides planning estimates and is not tax, legal, investment, or accounting advice."
    >
      <LegalSection
        title="Information you provide"
        items={[
          "Account details: your email address, name, and the tax-filing preferences you choose during setup.",
          "Financial details you enter: paychecks, W-2 and 1099 income, withholding, expenses, mileage, deductions, retirement contributions, and planned income.",
          "Bank or payroll transactions, only if you choose to connect an account through Plaid.",
          "Receipts or files you choose to attach to a record.",
        ]}
      />
      <LegalSection
        title="How it is used"
        items={[
          "To show your income, tax estimates, set-aside recommendations, and planning tools inside your account.",
          "To keep the app running, including sign-in, saving your records, and fixing errors.",
          "We do not sell your personal or financial data.",
        ]}
      />
      <LegalSection
        title="Services that process data for us"
        items={[
          "Lovable Cloud hosts the app, its database, sign-in, and file storage.",
          "Plaid links bank and payroll accounts, only when you choose to connect one.",
          "Google Analytics runs on our pages and may use cookies to measure visits.",
        ]}
      />
      <LegalSection title="Site analytics">
        <p>
          Lovable's built-in visitor analytics records the pages visited, where visitors came from, their country,
          browser, operating system and device type, how long they stay, how fast pages load, errors, and which
          buttons and links are clicked. It uses no cookies, stores nothing on your device, doesn't keep IP addresses,
          and doesn't identify visitors. It runs for every visitor. Detailed data is kept for 90 days and daily
          summaries for a year.
        </p>
        <p>
          Lovable collects this data for us.{" "}
          <a className="text-primary underline" href="https://lovable.dev/privacy" target="_blank" rel="noreferrer">Lovable's privacy policy</a>{" "}
          explains how it handles it.
        </p>
      </LegalSection>
      <LegalSection
        title="Your choices"
        items={[
          "You can edit or remove records you have entered.",
          "You can disconnect a linked bank or payroll account from Settings.",
          "You can delete your account from Settings → Danger Zone.",
        ]}
      />
      <LegalSection title="Contact">
        <p>
          Privacy questions or requests:{" "}
          <a className="text-primary underline" href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
