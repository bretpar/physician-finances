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
  groupChildrenByAdminGroup,
  groupFeaturesByPage,
  hasFeatureOverride,
  resolveMinimumRole,
  summarizeChildAccess,
  type FeatureAccessLevel,
  type FeatureRegistryEntry,
} from "@/lib/featureRegistry";
import { useFeatureOverrides, useSetFeatureOverride } from "@/hooks/useFeatureOverrides";

/**
 * Feature registry admin, organized around the real app pages.
 *
 * Collapsed view = one row per page (name, effective child tier summary, page
 * access select). Expanded view = display-only `adminGroup` subgroups with
 * compact child rows. Grouping is presentation only: page and child overrides
 * stay independent and entitlement resolution is untouched.
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
    if (!searching) return groups.map((g) => ({ ...g, forceOpen: false, pageHit: false }));
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
          <SelectTrigger
            className="h-9 w-[112px] px-2 text-xs sm:w-[136px] sm:px-3"
            aria-label={`Required access for ${entry.name}`}
          >
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
        {/* Override state stays internal; surfaced only as subtle desktop text. */}
        {overridden && (
          <span className="hidden text-[10px] text-muted-foreground sm:inline" data-testid="override-hint">
            Override
          </span>
        )}
      </div>
    );
  };

  const FeatureRow = ({ entry }: { entry: FeatureRegistryEntry }) => (
    <li
      className="flex items-center gap-2 px-2 py-2 sm:px-3 sm:py-2.5"
      data-testid={`feature-row-${entry.key}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {FEATURE_TYPE_LABEL[getFeatureType(entry)]} · <span className="font-mono">{entry.key}</span>
        </p>
      </div>
      <AccessSelect entry={entry} className="ml-auto" />
    </li>
  );


  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Feature registry ({FEATURE_REGISTRY.length})</CardTitle>
        <p className="text-sm text-muted-foreground">
          Features are grouped under their app page, then into display-only sections. Page and subfeature access are
          independent — changing a page tier does not change its subfeatures. "Default" removes the override.
        </p>
        <Input
          placeholder="Search page, section, name, key or description"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {visibleGroups.length === 0 && <p className="text-sm text-muted-foreground">No features match your search.</p>}

        {visibleGroups.map((group) => {
          const open = group.forceOpen || !!manualOpen[group.id];
          const subgroups = groupChildrenByAdminGroup(group.children);
          const flatten = group.children.length <= 3;
          return (
            <div key={group.id} className="overflow-hidden rounded-lg border" data-testid="feature-group">
              {/* Page row */}
              <div className="flex items-center gap-2 bg-muted/40 p-2 sm:p-3">
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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{group.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {summarizeChildAccess(group.children, overrides)}
                    </span>
                  </span>
                </button>
                {group.page && <AccessSelect entry={group.page} className="ml-auto" />}
              </div>

              {/* Children */}
              {open && (
                <div data-testid={`feature-group-children-${group.id}`}>
                  {group.children.length === 0 && (
                    <p className="p-3 text-xs text-muted-foreground">No subfeatures in this group.</p>
                  )}

                  {flatten ? (
                    <ul className="divide-y">
                      {group.children.map((child) => (
                        <FeatureRow key={child.key} entry={child} />
                      ))}
                    </ul>
                  ) : (
                    subgroups.map((sub) => (
                      <div key={sub.title} className="border-t" data-testid={`feature-subgroup-${sub.title}`}>
                        <p className="px-3 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {sub.title}
                        </p>
                        <ul className="divide-y pl-1">
                          {sub.features.map((child) => (
                            <FeatureRow key={child.key} entry={child} />
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </div>
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
