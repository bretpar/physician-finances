import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { LinkIssue } from "@/lib/incomeLinkValidation";

const LABEL = { duplicate: "Possible duplicate", missing: "Missing link", conflicting: "Conflicting link" } as const;

/** Shows link problems found before estimates/exports. Never changes records. */
export function IncomeLinkIssuesBanner({ issues, context = "estimate" }: { issues: LinkIssue[]; context?: "estimate" | "export" }) {
  if (!issues.length) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {issues.length} income link issue{issues.length === 1 ? "" : "s"} may affect this {context}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <ul className="list-disc space-y-1 pl-4 text-sm">
          {issues.slice(0, 5).map((i) => (
            <li key={i.key}><span className="font-medium">{LABEL[i.kind]}:</span> {i.message}</li>
          ))}
        </ul>
        {issues.length > 5 && <p className="text-sm">…and {issues.length - 5} more.</p>}
        <p className="text-sm">
          Your records are unchanged. <Link to="/link-review" className="underline font-medium">Review and confirm fixes</Link>.
        </p>
      </AlertDescription>
    </Alert>
  );
}
