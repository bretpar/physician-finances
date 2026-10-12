import { it } from "vitest";
import { computeUnifiedTaxEstimate } from "@/lib/taxCalculationService";
it("probe", () => {
  for (const sw of [1000, 5000]) {
    const r: any = computeUnifiedTaxEstimate({
      businessIncome:0, seEligibleBusinessIncome:0, businessW2:0, businessFederalWithheld:0, businessStateWithheld:0,
      businessPreTax:0, businessRetirement:0, ownerHealthcare:0, businessStateEligibleGross:0, businessStateEligibleExpenses:0,
      businessStateEligibleMileage:0, businessStateEligibleOwnerAdjustments:0,
      personalIncome:100000, personalW2:100000, personalNonW2Income:0, personalFederalWithheld:5000, personalStateWithheld:sw,
      personalPreTax:0, personalRetirement:0, netStockGain:0, businessExpenses:0, mileageDeduction:0, annualizedRetirement:0,
      txActualWithholding:0, actualEstimatedPaymentsMade:0, taxSavingsSetAside:0, remainingPayPeriods:10,
      projectedW2Income:0, projectedSEIncome:0, projectedOtherIncome:0, projectedFederalWithheld:0, projectedStateWithheld:0,
      projectedPreTax:0, projectedRetirement:0, projectedHealthInsuranceDeduction:0, filingStatus:"single", lastYearTax:0,
      standardDeductionOverride:null, ssWageCap:184500, stateIncomeTaxEnabled:true, personalStateTaxMode:"annual_estimate",
      personalStateTaxAnnualEstimate:1000, includeProjectedIncome:false,
    } as any);
    console.log(sw, JSON.stringify({fed:r.estimate?.federalTax ?? r.federalTax, st:r.estimate?.stateTax, tot:r.debug?.totalEstimatedTax, cred:r.debug?.countedCreditsTotal, rem:r.debug?.remainingTaxDue, keys:Object.keys(r).slice(0,12)}));
  }
});
