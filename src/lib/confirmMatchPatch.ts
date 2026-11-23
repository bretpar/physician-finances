/**
 * Patch applied to an existing Personal Income row when a Planner occurrence is
 * confirmed as its match. Raw bank-import rows (no company, plaid_import origin,
 * or "Imported from" bank notes) are enriched with Planner payroll detail.
 * Manually saved/confirmed actual paychecks only gain lineage and empty
 * identity backfills — every saved financial field (including explicit zeros)
 * is left untouched.
 */
export function isImportedOnlyIncomeRow(existing: Record<string, any>): boolean {
  return !existing.company || String(existing.origin_type || "").toLowerCase() === "plaid_import" ||
    (Boolean(existing.linked_transaction_id) && String(existing.notes || "").toLowerCase().includes("imported from"));
}

export function buildConfirmMatchPatch(args: {
  existing: Record<string, any>;
  conversionId: string;
  /** Planner payroll fields (withholding, deductions, gross) for enrichment. */
  plannerFields: Record<string, any>;
  stream: { company?: string | null; source_id?: string | null; ui_income_subtype?: string | null };
}): Record<string, any> {
  const { existing, conversionId, plannerFields, stream } = args;
  const imported = isImportedOnlyIncomeRow(existing);
  const patch: Record<string, any> = { origin_type: "planner_converted", origin_planner_conversion_id: conversionId };
  if (imported) {
    Object.assign(patch, plannerFields);
    const savedFsa = Number(existing.fsa_health || 0) + Number(existing.fsa_dependent_care || 0) + Number(existing.fsa_limited_purpose || 0);
    if (savedFsa > 0) {
      patch.fsa_health = Number(existing.fsa_health || 0);
      patch.fsa_dependent_care = Number(existing.fsa_dependent_care || 0);
      patch.fsa_limited_purpose = Number(existing.fsa_limited_purpose || 0);
      patch.pre_tax_deductions = Number(existing.pre_tax_deductions || 0);
    }
    if (stream.company) {
      patch.company = stream.company;
      if (!existing.name) patch.name = stream.company;
    }
  }
  if (stream.source_id && !existing.source_id) patch.source_id = stream.source_id;
  if (stream.ui_income_subtype && !existing.ui_income_subtype) patch.ui_income_subtype = stream.ui_income_subtype;
  return patch;
}
