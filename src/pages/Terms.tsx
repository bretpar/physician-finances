import { LegalPage, LegalSection } from "@/components/legal/LegalPage";

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="November 2026"
      intro="These terms describe how you may use Paycheck MD. By creating an account or using the app, you agree to them."
    >
      <LegalSection
        title="Planning estimates, not advice"
        items={[
          "Paycheck MD provides planning estimates based on the information you enter and the tax rules built into the app.",
          "It is not tax, legal, investment, or accounting advice, and it does not replace a qualified professional.",
          "Estimates can differ from what you actually owe. Review important decisions, such as estimated payments or W-4 changes, with a tax professional.",
        ]}
      />
      <LegalSection
        title="Your account"
        items={[
          "Keep your sign-in details private and tell us if you think someone else has accessed your account.",
          "You are responsible for the accuracy of the information you enter and the accounts you choose to connect.",
          "You can stop using Paycheck MD and delete your account at any time from Settings.",
        ]}
      />
      <LegalSection
        title="Free and Premium access"
        items={[
          "Paycheck MD offers Free and Premium access levels. The features included in each may change as the app develops.",
          "If paid plans are introduced, pricing and billing terms will be shown before you are asked to pay.",
        ]}
      />
      <LegalSection
        title="Acceptable use"
        items={[
          "Use the app only for your own (or your household's) financial planning.",
          "Do not try to access other users' data, disrupt the service, or misuse connected-account features.",
        ]}
      />
      <LegalSection
        title="Availability and changes"
        items={[
          "We work to keep Paycheck MD available and accurate but cannot promise it will be uninterrupted or error-free.",
          "We may update these terms; the date above shows the latest version.",
        ]}
      />
    </LegalPage>
  );
}
