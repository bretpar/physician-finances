import { Link } from "react-router-dom";
import { GuideLayout } from "@/components/GuideLayout";

export default function LocumTenensSetAside() {
  return (
    <GuideLayout
      path="/blog/how-much-to-set-aside-for-taxes-locum-tenens"
      title="How Much to Set Aside for Taxes as a Locum Tenens Physician"
      description="How much of each locum tenens payment to save for taxes: a 30–40% starting rule, what drives it up or down, and how to pay quarterly estimates."
      updated="October 2026"
      datePublished="2026-10-12"
    >
      <h1 className="text-4xl font-bold tracking-tight">
        How Much to Set Aside for Taxes as a Locum Tenens Physician
      </h1>
      <p className="text-lg text-muted-foreground">
        Short answer: set aside <strong>30–40% of every locums payment</strong> the day it arrives,
        then fine-tune that number once you know your bracket, your deductions, and which states you
        worked in. Here is where the number comes from and when to go higher or lower.
      </p>

      <h2>Why nothing is withheld</h2>
      <p>
        Staffing agencies usually pay locums physicians as 1099 contractors. No federal tax, state
        tax, Social Security, or Medicare comes out of your check. You owe all of it yourself —
        usually through quarterly estimated payments.
      </p>

      <h2>What the 30–40% covers</h2>
      <ul>
        <li>
          <strong>Self-employment tax:</strong> 15.3% on net earnings up to the Social Security
          wage base ($176,100 in 2025), then 2.9% above it.
        </li>
        <li>
          <strong>Federal income tax:</strong> most physicians land in the 24%–35% brackets on
          their last dollars of income.
        </li>
        <li>
          <strong>State income tax:</strong> 0% in states like Texas, Florida, or Washington; 5–10%+
          in many others. Locums often owe more than one state.
        </li>
        <li>
          <strong>Additional Medicare tax:</strong> 0.9% above $200,000 single / $250,000 married
          filing jointly.
        </li>
      </ul>

      <h2>When to set aside more or less</h2>
      <table>
        <thead>
          <tr>
            <th>Situation</th>
            <th>Starting point</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Locums is your only income, no-tax state</td>
            <td>About 30%</td>
          </tr>
          <tr>
            <td>Locums on top of a full-time W-2 job</td>
            <td>35–45% (your W-2 already filled the lower brackets)</td>
          </tr>
          <tr>
            <td>Assignments in high-tax states</td>
            <td>Add 5–10%</td>
          </tr>
          <tr>
            <td>Large Solo 401(k) or SEP-IRA contributions planned</td>
            <td>Can go lower — contributions cut income tax</td>
          </tr>
          <tr>
            <td>Agency covers travel and housing</td>
            <td>Fewer deductions, so stay at the higher end</td>
          </tr>
        </tbody>
      </table>

      <h2>A simple example</h2>
      <p>
        An employed physician picks up $60,000 of weekend locums work. Their W-2 salary already
        puts them in the 32% federal bracket, and they live in a state with a 5% income tax. Roughly:
      </p>
      <ul>
        <li>Self-employment tax: about 2.9%–15.3% depending on whether the W-2 salary already hit the wage base</li>
        <li>Federal income tax: about 32%</li>
        <li>State tax: about 5%</li>
      </ul>
      <p>
        That can add up to 40% or more of each locums check. Saving only 25% would leave a
        five-figure bill in April.
      </p>

      <h2>Paying it: quarterly estimates</h2>
      <p>
        Federal estimated payments are due around April 15, June 15, September 15, and January 15.
        To avoid an underpayment penalty, you generally need to pay at least 90% of this year's tax,
        or 100% of last year's tax (110% if your prior-year income was over $150,000). If you also
        have a W-2 job, raising your W-2 withholding is another way to cover locums tax.
      </p>

      <h2>Keep it separate</h2>
      <p>
        Move the set-aside into a separate savings account the day each payment lands. It keeps the
        money out of your spending and makes quarterly payments painless. For deductions that lower
        the number, see the <Link to="/blog/1099-tax-deductions">1099 deductions guide</Link>; for
        multi-state rules, see the <Link to="/blog/locum-tenens-tax-guide">locum tenens tax guide</Link>.
      </p>
    </GuideLayout>
  );
}
