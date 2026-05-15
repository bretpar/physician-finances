import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";

interface TableReport {
  total: number;
  null_user_id: number;
  null_organization_id: number;
  cross_org_rows: number;
  cross_org_sample_ids?: string[];
  ok: boolean;
  error?: string;
}

interface Report {
  generated_at: string;
  tables: Record<string, TableReport>;
}

export default function DataIsolationReport() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAuthChecked(true); return; }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "super_admin"]);
      setIsAdmin(!!(data && data.length));
      setAuthChecked(true);
    })();
  }, []);

  const run = async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase.functions.invoke("data-isolation-report", { body: {} });
    if (error) setError(error.message);
    else setReport(data as Report);
    setLoading(false);
  };

  const copyJson = () => {
    if (!report) return;
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    toast.success("Report JSON copied");
  };

  if (!authChecked) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="container max-w-6xl py-8 space-y-6" data-testid="data-isolation-report">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Data Isolation Report</h1>
          <p className="text-sm text-muted-foreground">Audits per-table user/org integrity. Admin-only.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={run} disabled={loading}>{loading ? "Running…" : "Run audit"}</Button>
          {report && <Button variant="outline" onClick={copyJson}><Copy className="h-4 w-4 mr-1" />Copy JSON</Button>}
        </div>
      </div>

      {error && <Card><CardContent className="py-4 text-destructive">{error}</CardContent></Card>}

      {report && (
        <Card>
          <CardHeader><CardTitle className="text-base">Generated {new Date(report.generated_at).toLocaleString()}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className="text-right">Total rows</TableHead>
                  <TableHead className="text-right">NULL user_id</TableHead>
                  <TableHead className="text-right">NULL organization_id</TableHead>
                  <TableHead className="text-right">Cross-org leak</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(report.tables).map(([name, r]) => (
                  <TableRow key={name}>
                    <TableCell className="font-mono text-xs">{name}</TableCell>
                    <TableCell className="text-right">{r.error ? "—" : r.total}</TableCell>
                    <TableCell className="text-right">{r.null_user_id ?? "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.null_organization_id ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.cross_org_rows ?? "—"}</TableCell>
                    <TableCell>
                      {r.error ? (
                        <Badge variant="destructive">{r.error}</Badge>
                      ) : r.ok ? (
                        <span className="inline-flex items-center text-emerald-600 text-xs"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />OK</span>
                      ) : (
                        <span className="inline-flex items-center text-destructive text-xs"><AlertTriangle className="h-3.5 w-3.5 mr-1" />Flag</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-4">
              "NULL organization_id" rows are not flagged as failures (legacy rows are allowed via the
              owner-fallback policies), but newly created rows should always have one.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
