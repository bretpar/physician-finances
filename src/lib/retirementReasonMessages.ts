import type { RetirementReasonCode } from "@/lib/retirementOpportunityEngine";

export const RETIREMENT_REASON_MESSAGES: Record<RetirementReasonCode, string> = {
  employee_402g_limit: "You've reached your shared employee contribution limit.",
  governmental_457b_limit: "This plan has a separate contribution limit from your 401(k) and 403(b) limit.",
  simple_plan_limit: "SIMPLE plans use their own annual contribution limit.",
  plan_415c_limit: "This plan has reached its overall annual additions ceiling.",
  compensation_limit: "Your contribution opportunity is limited by eligible compensation.",
  self_employed_employer_formula: "Employer contribution capacity is based on your business earnings.",
  traditional_ira_magi_phaseout: "Your Traditional IRA deduction is reduced based on income.",
  roth_ira_magi_phaseout: "Your income limits how much you can contribute directly to a Roth IRA.",
  insufficient_taxable_compensation: "Eligible compensation limits how much you can contribute.",
  magi_unknown: "Your income estimate is needed to determine IRA eligibility.",
  compensation_unknown: "Eligible compensation is needed to calculate this opportunity.",
  mfs_spouse_status_unknown: "Your living arrangement is needed to determine IRA eligibility.",
  sep_employee_deferral_not_allowed: "SEP IRA employee contributions need review; standard SEP contributions are made by the business.",
  duplicate_contribution_ambiguous: "This contribution may also appear on a paycheck and needs review.",
  unknown_plan_data: "More plan information is needed to calculate this opportunity.",
};

export function retirementReasonMessage(code: RetirementReasonCode): string {
  return RETIREMENT_REASON_MESSAGES[code];
}