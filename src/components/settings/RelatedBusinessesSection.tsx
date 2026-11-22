import { useMemo, useState } from "react";
import { Network } from "lucide-react";
import { SectionCard } from "@/components/settings/SectionCard";
import { useRetirementSectionLink } from "@/hooks/useRetirementSectionLink";
import { useCompanies } from "@/contexts/CompanyContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  listRelatedGroups,
  readBusinessRelationship,
  writeBusinessRelationship,
  type BusinessRelationship,
} from "@/lib/businessRelationships";
import { entityKindForCompanyType } from "@/lib/retirementCanonicalInput";

/**
 * Related businesses for the retirement planner. Businesses in one named group
 * share one combined annual contribution limit; businesses confirmed as not
 * related keep their own room. Metadata only — no income or tax record changes.
 */
export function RelatedBusinessesSection() {
  const link = useRetirementSectionLink("related-businesses");
  const { companies, updateCompany, closedCompanyIds } = useCompanies();
  const [newGroupName, setNewGroupName] = useState("");
  const [extraGroups, setExtraGroups] = useState<{ groupId: string; groupName: string }[]>([]);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const businesses = useMemo(
    () =>
      companies.filter((c) => {
        if (closedCompanyIds.has(c.id)) return false;
        const k = entityKindForCompanyType(c.companyType);
        return k === "schedule_c" || k === "partnership_k1" || k === "s_corp";
      }),
    [companies, closedCompanyIds],
  );
  const groups = useMemo(() => listRelatedGroups(businesses), [businesses]);
  const allGroups = useMemo(() => {
    const seen = new Set(groups.map((g) => g.groupId));
    return [
      ...groups,
      ...extraGroups
        .filter((g) => !seen.has(g.groupId))
        .map((g) => ({ ...g, sharedAnnualLimit: null, companyIds: [] as string[] })),
    ];
  }, [groups, extraGroups]);

  const save = async (companyId: string, rel: BusinessRelationship | null) => {
    const c = companies.find((x) => x.id === companyId);
    if (!c) return;
    await updateCompany(companyId, {
      advancedFieldVisibility: writeBusinessRelationship(c.advancedFieldVisibility, rel),
    });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast.success("Saved");
    } catch {
      toast.error("Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onChoose = (companyId: string, value: string) =>
    run(async () => {
      if (value === "unknown") return save(companyId, null);
      if (value === "unrelated") return save(companyId, { status: "unrelated" });
      const g = allGroups.find((x) => x.groupId === value);
      if (!g) return;
      await save(companyId, {
        status: "related",
        groupId: g.groupId,
        groupName: g.groupName,
        sharedAnnualLimit: g.sharedAnnualLimit,
      });
    });

  const onSaveLimit = (groupId: string) =>
    run(async () => {
      const g = allGroups.find((x) => x.groupId === groupId);
      if (!g) return;
      const raw = (limitDrafts[groupId] ?? "").replace(/[$,\s]/g, "");
      const n = Number(raw);
      const limit = raw === "" ? null : Number.isFinite(n) && n > 0 ? n : NaN;
      if (Number.isNaN(limit)) throw new Error("invalid");
      for (const id of g.companyIds) {
        await save(id, { status: "related", groupId: g.groupId, groupName: g.groupName, sharedAnnualLimit: limit });
      }
      setLimitDrafts((d) => ({ ...d, [groupId]: "" }));
    });

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setExtraGroups((g) => [...g, { groupId: crypto.randomUUID(), groupName: name }]);
    setNewGroupName("");
  };

  return (
    <div id={link.anchorId}>
    <SectionCard
      open={link.open}
      onOpenChange={link.onOpenChange}
      title="Related businesses"
      icon={<Network className="h-5 w-5" />}
      description="Tell the retirement planner which of your businesses share one combined contribution limit."
      hideActionBar
    >
      {businesses.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Add at least two businesses (1099, K-1 or S-corp) to set how they relate.
        </p>
      ) : (
        <div className="space-y-5" data-testid="related-businesses-section">
          <p className="text-xs text-muted-foreground">
            Businesses in the same group share one annual total limit. Businesses marked "Not related" keep their
            own room. "Not sure" keeps the amount out of your total until you decide. Ask your tax advisor if
            unsure — common ownership rules decide this.
          </p>

          <div className="space-y-2">
            {businesses.map((c) => {
              const rel = readBusinessRelationship(c.advancedFieldVisibility);
              const value = rel?.status === "related" ? rel.groupId : rel?.status ?? "unknown";
              return (
                <div key={c.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-medium">{c.nickname || c.name}</span>
                  <Select value={value} onValueChange={(v) => onChoose(c.id, v)} disabled={busy}>
                    <SelectTrigger className="sm:w-64" aria-label={`Relationship for ${c.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Not sure</SelectItem>
                      <SelectItem value="unrelated">Not related to my other businesses</SelectItem>
                      {allGroups.map((g) => (
                        <SelectItem key={g.groupId} value={g.groupId}>
                          Group: {g.groupName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="New group name, e.g. My practices"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGroup()}
              aria-label="New group name"
            />
            <Button variant="outline" onClick={addGroup} disabled={!newGroupName.trim()}>
              Add group
            </Button>
          </div>

          {allGroups.map((g) => (
            <div key={g.groupId} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{g.groupName}</span>
                <span className="text-xs text-muted-foreground">
                  {g.companyIds.length} business{g.companyIds.length === 1 ? "" : "es"}
                </span>
              </div>
              <Label className="text-xs" htmlFor={`limit-${g.groupId}`}>
                Annual total limit (optional)
              </Label>
              <p className="text-xs text-muted-foreground">
                Current: {g.sharedAnnualLimit != null ? `$${g.sharedAnnualLimit.toLocaleString()}` : "IRS annual limit"}.
                Enter a lower amount from your plan documents, or leave empty to use the IRS limit.
              </p>
              <div className="flex gap-2">
                <Input
                  id={`limit-${g.groupId}`}
                  inputMode="decimal"
                  placeholder="e.g. 50000"
                  value={limitDrafts[g.groupId] ?? ""}
                  onChange={(e) => setLimitDrafts((d) => ({ ...d, [g.groupId]: e.target.value }))}
                  disabled={g.companyIds.length === 0}
                />
                <Button
                  variant="outline"
                  onClick={() => onSaveLimit(g.groupId)}
                  disabled={busy || g.companyIds.length === 0}
                >
                  Save limit
                </Button>
              </div>
              {g.companyIds.length === 0 && (
                <p className="text-xs text-muted-foreground">Assign a business to this group to save it.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
    </div>
  );
}
