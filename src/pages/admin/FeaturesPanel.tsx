import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  FEATURE_ACCESS_LEVEL_LABEL,
  FEATURE_ACCESS_LEVELS,
  FEATURE_REGISTRY,
  FEATURE_TYPE_LABEL,
  featureMatchesQuery,
  getFeatureType,
  groupFeaturesByPage,
  hasFeatureOverride,
  resolveMinimumRole,
  type FeatureAccessLevel,
  type FeatureRegistryEntry,
} from "@/lib/featureRegistry";
import { useFeatureOverrides, useSetFeatureOverride } from "@/hooks/useFeatureOverrides";

/**
 * Feature registry admin, grouped by page-level feature.
 *
 * Names, descriptions, types and DEFAULT access levels are code-defined; only
 * the required access level can be overridden here. Page and child overrides
 * are independent — changing a page tier never cascades to its children.
 */
export default function FeaturesPanel() {
  const [search, setSearch] = useState("");
  const { overrides } = useFeatureOverrides();
  const setOverride = useSetFeatureOverride();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupFeaturesByPage(FEATURE_REGISTRY), []);
  const searching = search.trim().length > 0;

  const visibleGroups = useMemo(() => {
    if (!searching) return groups.map((g) => ({ ...g, forceOpen: false }));
    return groups
      .map((g) => {
        const pageHit = g.page ? featureMatchesQuery(g.page, search) : false;
        const children = g.children.filter((c) => featureMatchesQuery(c, search));
        return { ...g, children: pageHit && children.length === 0 ? g.children : children, forceOpen: true, pageHit };
      })
      .filter((g) => g.children.length > 0 || g.pageHit);
  }, [groups, search, searching]);

  const handleChange = async (entry: FeatureRegistryEntry, value: string) => {
    const next = value === "__default__" ? null : (value as FeatureAccessLevel);
    setPendingKey(entry.key);
    try {
      await setOverride.mutateAsync({ featureKey: entry.key, accessLevel: next });
      toast({
        title: "Feature access updated",
        description: next
          ? `${entry.name} now requires ${FEATURE_ACCESS_LEVEL_LABEL[next]}.`
          : `${entry.name} reset to the code default (${FEATURE_ACCESS_LEVEL_LABEL[entry.minimumRole]}).`,
      });
    } catch (err) {
      toast({
        title: "Could not update feature access",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPendingKey(null);
    }
  };

  const AccessSelect = ({ entry, className }: { entry: FeatureRegistryEntry; className?: string }) => {
    const overridden = hasFeatureOverride(entry.key, overrides);
    const effective = resolveMinimumRole(entry, overrides) ?? entry.minimumRole;
    return (
      <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
        <Select
          value={overridden ? effective : "__default__"}
          disabled={pendingKey === entry.key}
          onValueChange={(v) => handleChange(entry, v)}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs" aria-label={`Required access for ${entry.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">Default ({FEATURE_ACCESS_LEVEL_LABEL[entry.minimumRole]})</SelectItem>
            {FEATURE_ACCESS_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {FEATURE_ACCESS_LEVEL_LABEL[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {overridden && (
          <Badge variant="secondary" className="text-[10px]">
            Override
          </Badge>
        )}
      </div>
    );
  };

  const childSummary = (children: FeatureRegistryEntry[]) => {
    if (children.length === 0) return "No subfeatures";
    const counts = new Map<string, number>();
    for (const c of children) {
      const level = resolveMinimumRole(c, overrides) ?? c.minimumRole;
      counts.set(level, (counts.get(level) ?? 0) + 1);
    }
    return FEATURE_ACCESS_LEVELS.filter((l) => counts.has(l))
      .map((l) => `${counts.get(l)} ${FEATURE_ACCESS_LEVEL_LABEL[l]}`)
      .join(" · ");
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Feature registry ({FEATURE_REGISTRY.length})</CardTitle>
        <p className="text-sm text-muted-foreground">
          Features are grouped under their page. Page and subfeature access are independent — changing a page tier does
          not change its subfeatures. "Default" removes the override and falls back to the code default.
        </p>
        <Input
          placeholder="Search by name, key or description"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {visibleGroups.length === 0 && <p className="text-sm text-muted-foreground">No features match your search.</p>}

        {visibleGroups.map((group) => {
          const open = group.forceOpen || !!manualOpen[group.id];
          return (
            <div key={group.id} className="overflow-hidden rounded-lg border" data-testid="feature-group">
              {/* Page group header */}
              <div className="flex flex-wrap items-center gap-2 bg-muted/40 p-3 sm:flex-nowrap">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${group.title}`}
                  onClick={() => setManualOpen((s) => ({ ...s, [group.id]: !open }))}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                >
                  <ChevronDown
                    className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{group.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {group.page && <span className="font-mono">{group.page.key} · </span>}
                      {group.children.length} {group.children.length === 1 ? "subfeature" : "subfeatures"}
                      {group.children.length > 0 && ` · ${childSummary(group.children)}`}
                    </span>
                  </span>
                </button>
                {group.page && <AccessSelect entry={group.page} className="ml-auto" />}
              </div>

              {/* Child features */}
              {open && (
                <ul className="divide-y" data-testid={`feature-group-children-${group.id}`}>
                  {group.children.length === 0 && (
                    <li className="p-3 text-xs text-muted-foreground">No subfeatures in this group.</li>
                  )}
                  {group.children.map((child) => (
                    <li
                      key={child.key}
                      className="flex flex-wrap items-start gap-2 p-3 pl-4 sm:flex-nowrap sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{child.name}</p>
                        <p className="text-xs text-muted-foreground">{child.description}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">
                            {FEATURE_TYPE_LABEL[getFeatureType(child)]}
                          </Badge>
                          <span className="font-mono">{child.key}</span>
                        </p>
                      </div>
                      <AccessSelect entry={child} className="ml-auto" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {searching && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSearch("")}>
            Clear search
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
