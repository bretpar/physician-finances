import { Link } from "react-router-dom";
import { GuideLayout } from "@/components/GuideLayout";

export default function LlcForLocumTenens() {
  return (
    <GuideLayout
      path="/blog/llc-for-locum-tenens"
      title="Should a Locum Tenens Physician Form an LLC?"
      description="LLC for locum tenens physicians: what an LLC does and doesn't change for taxes, liability limits, PLLC rules, costs, and when an S-Corp election makes sense."
      updated="October 2026"
      datePublished="2026-10-12"
    >
      <h1 className="text-4xl font-bold tracking-tight">Should a Locum Tenens Physician Form an LLC?</h1>
      <p className="text-lg text-muted-foreground">
        An LLC on its own <strong>does not lower your taxes</strong>. A single-member LLC is taxed
        exactly like a sole proprietor. The reasons to form one are paperwork, separation, and the
        option to elect S-Corp tax treatment later.
      </p>

      <h2>What an LLC changes — and what it doesn't</h2>
      <table>
        <thead>
          <tr>
            <th>Question</th>
            <th>Sole proprietor</th>
            <th>Single-member LLC</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Federal tax</td>
            <td>Schedule C</td>
            <td>Schedule C (same)</td>
          </tr>
          <tr>
            <td>Self-employment tax</td>
            <td>15.3% / 2.9%</td>
            <td>Same, unless you elect S-Corp</td>
          </tr>
          <tr>
            <td>Malpractice liability</td>
            <td>Personal</td>
            <td>Still personal — an LLC doesn't shield your own clinical work</td>
          </tr>
          <tr>
            <td>Business debts and contracts</td>
            <td>Personal</td>
            <td>Generally limited to the LLC</td>
          </tr>
          <tr>
            <td>Setup and yearly cost</td>
            <td>None</td>
            <td>State filing fees, often $50–$500/yr; California charges at least $800/yr</td>
          </tr>
        </tbody>
      </table>

      <h2>PLLC rules for physicians</h2>
      <p>
        Many states require licensed professionals to use a professional LLC (PLLC) or professional
        corporation, and some don't allow physicians to use an ordinary LLC at all. Check your state
        medical board and secretary of state rules before filing.
      </p>

      <h2>When an LLC is worth it</h2>
      <ul>
        <li>An agency or facility asks to contract with a business entity.</li>
        <li>You want a clean business bank account and books for deductions.</li>
        <li>You plan to elect S-Corp status once your locums income is steady.</li>
      </ul>

      <h2>When to skip it</h2>
      <ul>
        <li>You're doing a few locums shifts on top of a W-2 job.</li>
        <li>You work in a state with high annual entity fees and modest locums income.</li>
        <li>You're only forming it for "tax savings" — there are none without an S-Corp election.</li>
      </ul>

      <h2>The S-Corp election</h2>
      <p>
        Real tax savings come from electing S-Corp treatment: you pay yourself a reasonable salary
        and take the rest as distributions that skip self-employment tax. It usually starts paying
        off once net locums income is consistently above roughly $80,000–$100,000, after payroll and
        extra filing costs. Locums working in many states may need payroll registrations in each,
        which eats into the savings. See the full math in{" "}
        <Link to="/blog/physician-scorp-vs-sole-proprietorship">
          physician S-Corp vs sole proprietorship
        </Link>
        .
      </p>

      <h2>Whatever you choose, save for taxes</h2>
      <p>
        An LLC doesn't withhold anything either. Plan on setting aside a share of every payment — see{" "}
        <Link to="/blog/how-much-to-set-aside-for-taxes-locum-tenens">
          how much to set aside for locums taxes
        </Link>
        .
      </p>
    </GuideLayout>
  );
}
