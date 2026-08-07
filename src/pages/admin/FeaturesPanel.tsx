import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FEATURE_ACCESS_LEVEL_LABEL,
  FEATURE_REGISTRY,
  FEATURE_STATUS_LABEL,
  filterFeatures,
} from "@/lib/featureRegistry";

/** Read-only view of the code-defined feature registry. No edit controls. */
export default function FeaturesPanel() {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => filterFeatures(FEATURE_REGISTRY, search), [search]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Feature registry ({FEATURE_REGISTRY.length})</CardTitle>
        <p className="text-sm text-muted-foreground">
          Read-only. Access levels are defined in application code, not the database.
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
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{FEATURE_ACCESS_LEVEL_LABEL[row.minimumRole]}</Badge>
                    <Badge variant={row.status === "active" ? "outline" : "destructive"}>
                      {FEATURE_STATUS_LABEL[row.status]}
                    </Badge>
                  </div>
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
                        <Badge variant="secondary">{FEATURE_ACCESS_LEVEL_LABEL[row.minimumRole]}</Badge>
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
