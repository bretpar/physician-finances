import { getBuildInfo } from "@/lib/buildInfo";

export default function DiagnosticsBuild() {
  const info = getBuildInfo();
  return (
    <main className="min-h-screen bg-background text-foreground p-6">
      <h1 className="text-lg font-semibold mb-4">Build Diagnostics</h1>
      <pre className="bg-muted rounded-lg p-4 text-sm font-mono whitespace-pre-wrap break-all border border-border">
        {JSON.stringify(info, null, 2)}
      </pre>
    </main>
  );
}
