/**
 * Related-business settings for the retirement planner. Stored per company in
 * `companies.advanced_field_visibility.retirement_relationship` (metadata only;
 * never changes income, expense or tax records).
 *
 *  - related:   member of a named group that shares ONE combined annual
 *               additions (§415(c)) limit, optionally capped by a recorded
 *               dollar amount from the plan documents.
 *  - unrelated: confirmed not related to any of the user's other businesses,
 *               so it keeps its own separate contribution room.
 *  - absent:    unknown — capacity stays flagged as unverified.
 */
export const RETIREMENT_RELATIONSHIP_KEY = "retirement_relationship";

export type BusinessRelationship =
  | { status: "related"; groupId: string; groupName: string; sharedAnnualLimit: number | null }
  | { status: "unrelated" };

export function readBusinessRelationship(meta: unknown): BusinessRelationship | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>)[RETIREMENT_RELATIONSHIP_KEY];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.status === "unrelated") return { status: "unrelated" };
  if (r.status === "related" && typeof r.groupId === "string" && r.groupId) {
    const limit = Number(r.sharedAnnualLimit);
    return {
      status: "related",
      groupId: r.groupId,
      groupName: typeof r.groupName === "string" && r.groupName ? r.groupName : "Related group",
      sharedAnnualLimit: r.sharedAnnualLimit != null && Number.isFinite(limit) && limit > 0 ? limit : null,
    };
  }
  return null;
}

export function writeBusinessRelationship<T extends object>(
  meta: T | null | undefined,
  rel: BusinessRelationship | null,
): T {
  const next = { ...((meta ?? {}) as Record<string, unknown>) };
  if (rel) next[RETIREMENT_RELATIONSHIP_KEY] = rel;
  else delete next[RETIREMENT_RELATIONSHIP_KEY];
  return next as T;
}

export interface RelatedBusinessGroup {
  groupId: string;
  groupName: string;
  sharedAnnualLimit: number | null;
  companyIds: string[];
}

/** Groups derived from member metadata. Name/limit: first member (sorted by id) wins. */
export function listRelatedGroups(
  companies: Array<{ id: string; advancedFieldVisibility?: unknown }>,
): RelatedBusinessGroup[] {
  const map = new Map<string, RelatedBusinessGroup>();
  for (const c of [...companies].sort((a, b) => a.id.localeCompare(b.id))) {
    const rel = readBusinessRelationship(c.advancedFieldVisibility);
    if (rel?.status !== "related") continue;
    const g = map.get(rel.groupId);
    if (g) g.companyIds.push(c.id);
    else map.set(rel.groupId, { groupId: rel.groupId, groupName: rel.groupName, sharedAnnualLimit: rel.sharedAnnualLimit, companyIds: [c.id] });
  }
  return Array.from(map.values()).sort((a, b) => a.groupName.localeCompare(b.groupName));
}
