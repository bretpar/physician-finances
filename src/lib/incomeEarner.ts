/**
 * Canonical "Income earner" resolution for employer-linked records.
 * Source of truth: companies.employee_role ("primary" = You, "spouse" = Spouse).
 *
 * Priority: source_id → company role; then an unambiguous exact-name match;
 * otherwise defaults to "primary".
 */
export type IncomeEarner = "primary" | "spouse";

interface EarnerCompany {
  id: string;
  name?: string | null;
  employeeRole?: IncomeEarner | null;
}

export function resolveIncomeEarner(company: { employeeRole?: IncomeEarner | null } | null | undefined): IncomeEarner {
  return company?.employeeRole === "spouse" ? "spouse" : "primary";
}

export function resolveIncomeEarnerFor(
  ref: { sourceId?: string | null; companyName?: string | null },
  companies: EarnerCompany[],
): IncomeEarner {
  if (ref.sourceId) {
    const c = companies.find((x) => x.id === ref.sourceId);
    if (c) return resolveIncomeEarner(c);
  }
  const norm = ref.companyName?.trim().toLowerCase();
  if (norm) {
    const matches = companies.filter((x) => (x.name || "").trim().toLowerCase() === norm);
    if (matches.length === 1) return resolveIncomeEarner(matches[0]);
  }
  return "primary";
}

/** Map an income earner to ytd_catchup_entries.owner_person. */
export function earnerToOwnerPerson(earner: IncomeEarner): "taxpayer" | "spouse" {
  return earner === "spouse" ? "spouse" : "taxpayer";
}
