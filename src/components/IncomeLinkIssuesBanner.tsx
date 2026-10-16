import { Link } from "react-router-dom";
import { AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { LinkIssue } from "@/lib/incomeLinkValidation";

export const LINK_ISSUE_LABEL = {
  duplicate: "Possible duplicate",
  missing: "Missing link",
  conflicting: "Conflicting link",
  incomplete_metadata: "Incomplete link details",
} as const;

/** Issues that can change counted income or calculations (each has a Link Review card). */
export const actionableLinkIssues = (issues: LinkIssue[]) => issues.filter((i) => i.kind !== "incomplete_metadata");

/**
 * Red banner only for issues that can affect counted income. Metadata-only
 * notices are shown (neutral) only when `showMetadata` is set (Diagnostics).
 * Never changes records.
 */
export function IncomeLinkIssuesBanner({
  issues,
  context = "estimate",
  showMetadata = false,
}: {
  issues: LinkIssue[];
  context?: "estimate" | "export";
  showMetadata?: boolean;
}) {
  const actionable = actionableLinkIssues(issues);
  const metadata = showMetadata ? issues.filter((i) => i.kind === "incomplete_metadata") : [];
  if (!actionable.length && !metadata.length) return null;
  return (
    <div className="space-y-3">
      {actionable.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {actionable.length} income link issue{actionable.length === 1 ? "" : "s"} may affect this {context}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {actionable.slice(0, 5).map((i) => (
                <li key={i.key}><span className="font-medium">{LINK_ISSUE_LABEL[i.kind]}:</span> {i.message}</li>
              ))}
            </ul>
            {actionable.length > 5 && <p className="text-sm">…and {actionable.length - 5} more.</p>}
            <p className="text-sm">
              Your records are unchanged. <Link to="/link-review" className="underline font-medium">Review and confirm fixes</Link>.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {metadata.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{metadata.length} link detail notice{metadata.length === 1 ? "" : "s"} (no effect on taxes)</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {metadata.map((i) => <li key={i.key}>{i.message}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
