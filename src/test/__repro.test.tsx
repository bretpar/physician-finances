import { describe, it } from "vitest";
import { generateProjectedPaychecks } from "@/hooks/useProjectedIncome";
import { aggregatePlannedBusinessExpenses } from "@/lib/plannedBusinessExpenses";
import { computeRetirementRoomView } from "@/lib/retirementRoomView";
import { annualizeContributionAmount } from "@/lib/retirementContributionRoom";

const stream: any = { id: "s1", company: "QA Schedule C 20260919", company_type: "1099", ui_income_subtype: "1099_schedule_c", source_id: "co-sc", is_active: true, pay_frequency: "single", paycheck_amount: 20000, forecast_expense_per_period: 5000, start_date: "2026-10-15", end_date: null, taxes_withheld: 0, retirement_401k: 0, pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0, include_in_tax: true };
const companies = [ { id: "co-sc", name: "QA Schedule C", companyType: "1099_schedule_c", payFrequency: null }, { id: "co-w2", name: "QA W2", companyType: "w2", payFrequency: null } ];
const contribs: any[] = [
 { id: "c1", company_id: "co-sc", account_type: "solo_401k", contribution_type: "employee", contribution_amount: 3000, frequency: "one_time", contribution_date: "2026-09-19", start_date: "2026-09-19", end_date: null },
 { id: "c2", company_id: "co-sc", account_type: "solo_401k", contribution_type: "employer", contribution_amount: 5000, frequency: "one_time", contribution_date: "2026-09-19", start_date: "2026-09-19", end_date: null },
 { id: "c3", company_id: "co-w2", account_type: "401k", contribution_type: "employee", contribution_amount: 4500, frequency: "one_time", contribution_date: "2026-09-19", start_date: "2026-09-19", end_date: null },
];

describe("repro mileage assembly", () => {
  it("shows projected", () => {
    const occ = generateProjectedPaychecks([stream], [], [], [], [], []);
    const todayISO = new Date().toISOString().split("T")[0];
    const gross = new Map<string, number>();
    for (const p of occ as any[]) {
      if (p.matchStatus !== "active") continue;
      if (!p.date || Number(String(p.date).slice(0,4)) !== 2026) continue;
      if (String(p.date) < todayISO) continue;
      gross.set(p.streamSourceId, (gross.get(p.streamSourceId)||0) + Number(p.grossAmount||0));
    }
    const buckets = aggregatePlannedBusinessExpenses([{ id: stream.id, company: stream.company, company_type: stream.company_type, source_id: stream.source_id, is_active: true, forecast_expense_per_period: 5000 }], (occ as any[]).map(p=>({streamId:p.streamId,type:p.type,matchStatus:p.matchStatus})), companies.map(c=>({id:c.id,name:c.name})));
    const exp = new Map<string, number>();
    for (const b of buckets.values()) if (b.companyId) exp.set(b.companyId, b.total);
    console.log("gross", [...gross], "exp", [...exp]);
    const view = computeRetirementRoomView({
      taxYear: 2026,
      eligibleTaxableCompensation: 50000,
      dateOfBirth: null, filingStatus: "single", magi: null,
      companies,
      paychecks: [],
      standalone: contribs.map(c => ({ id: c.id, companyId: c.company_id, accountType: c.account_type, contributionType: c.contribution_type, annualAmount: annualizeContributionAmount(c as any, { taxYear: 2026, payFrequency: null }).annual, contributionDate: c.contribution_date })),
      ira: { traditionalContributed: 1000, rothContributed: 0 },
      actualNetProfitByCompany: new Map([["co-sc", 50000], ["co-w2", 0]]),
      remainingPlannedGrossByCompany: gross,
      remainingPlannedExpensesByCompany: exp,
      includeProjection: true,
    });
    console.log("actual plans", JSON.stringify(view.engine.plans.map(p=>({id:p.planId,comp:p.eligibleCompensation,cap:p.employerCapacityRemaining,reasons:p.reasons})),null,1));
    console.log("projected plans", JSON.stringify(view.engineProjected?.plans.map(p=>({id:p.planId,comp:p.eligibleCompensation,cap:p.employerCapacityRemaining,reasons:p.reasons})),null,1));
  });
});
