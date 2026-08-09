import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  FEATURE_ACCESS_LEVEL_LABEL,
  FEATURE_ACCESS_LEVELS,
  FEATURE_REGISTRY,
  FEATURE_STATUS_LABEL,
  FEATURE_TYPE_LABEL,
  filterFeatures,
  getFeatureType,
  hasFeatureOverride,
  resolveMinimumRole,
  type FeatureAccessLevel,
  type FeatureRegistryEntry,
} from "@/lib/featureRegistry";
import { useFeatureOverrides, useSetFeatureOverride } from "@/hooks/useFeatureOverrides";

/**
 * Feature registry admin. Names, descriptions, types and DEFAULT access levels
 * are code-defined; only the required access level can be overridden here and
 * that override is stored in the database.
 */
export default function FeaturesPanel() {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => filterFeatures(FEATURE_REGISTRY, search), [search]);
  const { overrides } = useFeatureOverrides();
  const setOverride = useSetFeatureOverride();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

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

  const AccessSelect = ({ entry }: { entry: FeatureRegistryEntry }) => {
    const overridden = hasFeatureOverride(entry.key, overrides);
    const effective = resolveMinimumRole(entry, overrides) ?? entry.minimumRole;
    return (
      <div className="flex items-center gap-2">
        <Select
          value={overridden ? effective : "__default__"}
          disabled={pendingKey === entry.key}
          onValueChange={(v) => handleChange(entry, v)}
        >
          <SelectTrigger className="h-8 w-[150px]" aria-label={`Required access for ${entry.name}`}>
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

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Feature registry ({FEATURE_REGISTRY.length})</CardTitle>
        <p className="text-sm text-muted-foreground">
          Feature keys, names and default access are defined in application code. Changing the required access here saves
          a database override; "Default" removes the override and falls back to the code default.
        </p>
        <Input
          placeholder="Search by feature name or key"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </CardHeader>
      <CardContent>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No features match your search.</p>}

        {rows.length > 0 && (
          <>
            {/* Mobile cards */}
            <ul className="space-y-3 md:hidden" data-testid="admin-feature-cards">
              {rows.map((row) => (
                <li key={row.key} className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                  <p className="font-mono text-xs text-muted-foreground">{row.key}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{FEATURE_TYPE_LABEL[getFeatureType(row)]}</Badge>
                    {row.parentFeatureKey && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {row.parentFeatureKey}
                      </Badge>
                    )}
                    <Badge variant={row.status === "active" ? "outline" : "destructive"}>
                      {FEATURE_STATUS_LABEL[row.status]}
                    </Badge>
                  </div>
                  <AccessSelect entry={row} />
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Parent</TableHead>
                    <TableHead>Required access</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.description}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.key}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{FEATURE_TYPE_LABEL[getFeatureType(row)]}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.parentFeatureKey ?? "—"}
                      </TableCell>
                      <TableCell>
                        <AccessSelect entry={row} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === "active" ? "outline" : "destructive"}>
                          {FEATURE_STATUS_LABEL[row.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
