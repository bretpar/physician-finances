import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAccountRole } from "@/hooks/useAccountRole";
import { useAuth } from "@/contexts/AuthContext";
import { ACCOUNT_ROLE_LABEL, type AccountRole } from "@/lib/roles";
import { isLikelyTestAccount } from "@/lib/testAccounts";
import {
  applyAdminUserFilter,
  filterAdminUsers,
  useAdminUsers,
  useBulkDeleteUsers,
  useResetUserData,
  useUpdateAccountRole,
  type AdminUserFilter,
  type AdminUserRow,
  type BulkDeleteProgress,
} from "@/hooks/useAdminUsers";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FeaturesPanel from "@/pages/admin/FeaturesPanel";

const ROLE_OPTIONS: AccountRole[] = ["free", "premium", "premium_beta", "developer"];

const PAGE_SIZE = 25;

const FILTER_OPTIONS: Array<{ value: AdminUserFilter; label: string }> = [
  { value: "all", label: "All roles" },
  { value: "free", label: "Free" },
  { value: "premium", label: "Premium" },
  { value: "premium_beta", label: "Premium Beta" },
  { value: "developer", label: "Developer" },
  { value: "likely_test", label: "Likely test accounts" },
];

const ROLE_BADGE_CLASS: Record<AccountRole, string> = {
  free: "border-border bg-muted text-muted-foreground",
  premium: "border-primary/30 bg-primary/10 text-primary",
  premium_beta: "border-accent/40 bg-accent/15 text-accent-foreground",
  developer: "border-destructive/30 bg-destructive/10 text-destructive",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function RoleBadge({ role }: { role: AccountRole }) {
  return (
    <Badge variant="outline" className={ROLE_BADGE_CLASS[role]}>
      {ACCOUNT_ROLE_LABEL[role]}
    </Badge>
  );
}

function TestBadge() {
  return (
    <Badge variant="outline" className="border-border bg-muted text-muted-foreground" title="Email matches a known test pattern. Label only — not a role.">
      Test account
    </Badge>
  );
}

export default function Admin() {
  const { role, isDeveloper, isLoading, userEmail } = useAccountRole();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AdminUserFilter>("all");
  const [pending, setPending] = useState<{ user: AdminUserRow; next: AccountRole } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [progress, setProgress] = useState<BulkDeleteProgress | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserRow | null>(null);
  const [resetConfirm, setResetConfirm] = useState("");
  const [deleteIssues, setDeleteIssues] = useState<{
    failed: Array<{ userId: string; message: string }>;
    skipped: Array<{ userId: string; message: string }>;
  } | null>(null);

  const { data: users, isLoading: usersLoading, error } = useAdminUsers(isDeveloper);
  const updateRole = useUpdateAccountRole();
  const bulkDelete = useBulkDeleteUsers();
  const resetUserData = useResetUserData();


  const [page, setPage] = useState(1);

  const rows = useMemo(
    () => applyAdminUserFilter(filterAdminUsers(users ?? [], search), filter),
    [users, search, filter],
  );
  const developerCount = useMemo(() => (users ?? []).filter((u) => u.role === "developer").length, [users]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [rows, currentPage],
  );

  // Reset to the first page whenever the result set changes.
  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  // Drop selections for users that no longer exist server-side.
  useEffect(() => {
    if (!users) return;
    const known = new Set(users.map((u) => u.userId));
    setSelected((prev) => {
      const next = prev.filter((id) => known.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [users]);

  const selectedRows = useMemo(
    () => (users ?? []).filter((u) => selected.includes(u.userId)),
    [users, selected],
  );
  // "Visible" always means the rows rendered on the current page.
  const visibleIds = pageRows.map((r) => r.userId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const selectedOffPage = selected.filter((id) => !visibleIds.includes(id)).length;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // Security is enforced server-side too, not by hiding the nav link.
  if (!isDeveloper) {
    return <Navigate to="/" replace />;
  }

  const isSelf = pending?.user.userId === user?.id;
  const isLastDeveloper = pending?.user.role === "developer" && developerCount <= 1;

  const toggleUser = (userId: string, checked: boolean) => {
    setSelected((prev) => (checked ? Array.from(new Set([...prev, userId])) : prev.filter((id) => id !== userId)));
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) =>
      checked
        ? Array.from(new Set([...prev, ...visibleIds]))
        : prev.filter((id) => !visibleIds.includes(id)),
    );
  };

  const confirmChange = async () => {
    if (!pending) return;
    try {
      await updateRole.mutateAsync({ userId: pending.user.userId, role: pending.next });
      toast({
        title: "Role updated",
        description: `${pending.user.email} is now ${ACCOUNT_ROLE_LABEL[pending.next]}.`,
      });
      setPending(null);
    } catch (e) {
      toast({
        title: "Could not update role",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const runBulkDelete = async () => {
    if (bulkDelete.isPending || confirmText !== "DELETE" || selected.length === 0) return;
    setProgress({ processed: 0, total: selected.length });
    setDeleteIssues(null);
    try {
      const result = await bulkDelete.mutateAsync({
        userIds: selected,
        onProgress: (p) => setProgress(p),
      });
      const skippedNote = result.skipped.length
        ? ` ${result.skipped.length} skipped: ${result.skipped[0].reason}`
        : "";
      const failedNote = result.failed.length ? ` ${result.failed.length} failed.` : "";
      toast({
        title: result.stopped
          ? "Bulk delete stopped"
          : `${result.deleted.length} account${result.deleted.length === 1 ? "" : "s"} deleted`,
        description:
          result.stoppedReason ||
          `${skippedNote}${failedNote}`.trim() ||
          "All selected accounts were removed.",
        variant: result.failed.length ? "destructive" : undefined,
      });

      // Successful deletions stay applied; only unresolved rows remain selected.
      setSelected((prev) => prev.filter((id) => !result.deleted.includes(id)));
      setDeleteIssues(
        result.failed.length || result.skipped.length
          ? {
              failed: result.failed.map((f) => ({ userId: f.user_id, message: f.error })),
              skipped: result.skipped.map((s) => ({ userId: s.user_id, message: s.reason })),
            }
          : null,
      );
      setDeleteOpen(false);
      setConfirmText("");
    } catch (e) {
      toast({
        title: "Bulk delete failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setProgress(null);
    }
  };

  const labelForUser = (userId: string) =>
    (users ?? []).find((u) => u.userId === userId)?.email ?? userId;

  const runReset = async () => {
    if (!resetTarget || resetConfirm !== "RESET" || resetUserData.isPending) return;
    try {
      const result = await resetUserData.mutateAsync({ userId: resetTarget.userId });
      const failedNote = result.failed_tables?.length
        ? ` ${result.failed_tables.length} table(s) could not be cleared.`
        : "";
      toast({
        title: "QA data reset complete",
        description:
          `QA data reset complete. Login and ${ACCOUNT_ROLE_LABEL[resetTarget.role]} access preserved. ` +
          `${result.total_rows_deleted} record(s) removed · settings ${result.settings_reset ? "reset" : "unchanged"} · ` +
          `onboarding ${result.onboarding_reset ? "reset" : "unchanged"}.${failedNote}`,
        variant: result.ok === false ? "destructive" : undefined,
      });
      setResetTarget(null);
      setResetConfirm("");
    } catch (e) {
      toast({
        title: "Reset failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const RoleSelect = ({ row }: { row: AdminUserRow }) => (
    <Select value={row.role} onValueChange={(next) => setPending({ user: row, next: next as AccountRole })}>
      <SelectTrigger className="h-9 w-[150px]" aria-label={`Change role for ${row.email}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {ACCOUNT_ROLE_LABEL[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const ResetButton = ({ row }: { row: AdminUserRow }) => (
    <Button
      variant="outline"
      size="sm"
      className="h-9"
      data-testid="reset-qa-data-button"
      aria-label={`Reset QA data for ${row.email}`}
      onClick={() => {
        setResetConfirm("");
        setResetTarget(row);
      }}
    >
      Reset QA Data
    </Button>
  );


  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {userEmail || "—"} · {ACCOUNT_ROLE_LABEL[role]}
        </p>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
        </TabsList>

        <TabsContent value="features" className="mt-4">
          <FeaturesPanel />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader className="space-y-3">
              <CardTitle className="text-base">Registered users {users ? `(${users.length})` : ""}</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  placeholder="Search by email or name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-sm"
                />
                <Select value={filter} onValueChange={(v) => setFilter(v as AdminUserFilter)}>
                  <SelectTrigger className="h-10 w-[220px]" aria-label="Filter users by role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleAllVisible(!allVisibleSelected)}
                  disabled={visibleIds.length === 0}
                >
                  {allVisibleSelected ? "Deselect visible" : "Select all visible"}
                </Button>
                <span className="text-sm font-medium" data-testid="selection-count">
                  {selected.length} user{selected.length === 1 ? "" : "s"} selected
                </span>
                {selectedOffPage > 0 && (
                  <span className="text-xs text-muted-foreground" data-testid="selection-offpage">
                    ({selectedOffPage} on other pages/filters)
                  </span>
                )}
                {selected.length > 0 && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                      Clear selection
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setConfirmText("");
                        setDeleteOpen(true);
                      }}
                    >
                      Delete selected users
                    </Button>
                  </>
                )}
              </div>

            </CardHeader>
            <CardContent>
              {deleteIssues && (
                <div
                  className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
                  data-testid="bulk-delete-issues"
                  role="alert"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-destructive">
                        {deleteIssues.failed.length + deleteIssues.skipped.length} of the selected accounts could not
                        be deleted
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Successful deletions were applied. The accounts below are still selected so you can retry.
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteIssues(null)}>
                      Dismiss
                    </Button>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {deleteIssues.failed.map((f) => (
                      <li key={`failed-${f.userId}`} className="text-xs" data-testid="bulk-delete-failed-row">
                        <span className="font-medium">{labelForUser(f.userId)}</span>
                        <span className="text-destructive"> — {f.message}</span>
                      </li>
                    ))}
                    {deleteIssues.skipped.map((s) => (
                      <li key={`skipped-${s.userId}`} className="text-xs" data-testid="bulk-delete-skipped-row">
                        <span className="font-medium">{labelForUser(s.userId)}</span>
                        <span className="text-muted-foreground"> — skipped: {s.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {usersLoading && <p className="text-sm text-muted-foreground">Loading users…</p>}
              {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
              {!usersLoading && !error && rows.length === 0 && (
                <p className="text-sm text-muted-foreground">No users match your search.</p>
              )}

              {rows.length > 0 && (
                <>
                  {/* Mobile cards */}
                  <ul className="space-y-3 md:hidden" data-testid="admin-user-cards">
                    {pageRows.map((row) => (
                      <li key={row.userId} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            checked={selected.includes(row.userId)}
                            onCheckedChange={(c) => toggleUser(row.userId, c === true)}
                            aria-label={`Select ${row.email}`}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{row.email}</p>
                            {row.displayName && (
                              <p className="truncate text-xs text-muted-foreground">{row.displayName}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <RoleBadge role={row.role} />
                          {isLikelyTestAccount(row.email) && <TestBadge />}
                          <span>Joined {formatDate(row.createdAt)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Last sign-in {formatDate(row.lastSignInAt)}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <RoleSelect row={row} />
                          <ResetButton row={row} />
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* Desktop table */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              checked={allVisibleSelected}
                              onCheckedChange={(c) => toggleAllVisible(c === true)}
                              aria-label="Select all visible users"
                            />
                          </TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Joined</TableHead>
                          <TableHead>Last sign-in</TableHead>
                          <TableHead className="text-right">Change role</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageRows.map((row) => (
                          <TableRow key={row.userId}>
                            <TableCell>
                              <Checkbox
                                checked={selected.includes(row.userId)}
                                onCheckedChange={(c) => toggleUser(row.userId, c === true)}
                                aria-label={`Select ${row.email}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <span>{row.email}</span>
                                {isLikelyTestAccount(row.email) && <TestBadge />}
                              </div>
                            </TableCell>
                            <TableCell>{row.displayName || "—"}</TableCell>
                            <TableCell>
                              <RoleBadge role={row.role} />
                            </TableCell>
                            <TableCell>{formatDate(row.createdAt)}</TableCell>
                            <TableCell>{formatDate(row.lastSignInAt)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end">
                                <RoleSelect row={row} />
                                <ResetButton row={row} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground" data-testid="pagination-summary">
                      Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                      {Math.min(currentPage * PAGE_SIZE, rows.length)} of {rows.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Page {currentPage} of {pageCount}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                        disabled={currentPage >= pageCount}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change account role?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending && (
                <>
                  Change {pending.user.email} from {ACCOUNT_ROLE_LABEL[pending.user.role]} to{" "}
                  {ACCOUNT_ROLE_LABEL[pending.next]}?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isSelf && pending?.next !== "developer" && (
            <p className="text-sm font-medium text-destructive">
              Warning: this is your own account. You will immediately lose developer access, including this page.
            </p>
          )}
          {isLastDeveloper && pending?.next !== "developer" && (
            <p className="text-sm font-medium text-destructive">
              This is the last remaining developer account and cannot be demoted.
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmChange();
              }}
              disabled={updateRole.isPending || (isLastDeveloper && pending?.next !== "developer")}
            >
              {updateRole.isPending ? "Saving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          // Never dismiss while the edge function is running.
          if (!open && !bulkDelete.isPending) {
            setDeleteOpen(false);
            setConfirmText("");
          }
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(e) => bulkDelete.isPending && e.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.length} account{selected.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes these accounts, their sign-in credentials, and all of their financial data.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
            {selectedRows.slice(0, 10).map((row) => (
              <li key={row.userId} className="truncate">
                {row.email}
              </li>
            ))}
            {selectedRows.length > 10 && (
              <li className="text-muted-foreground">and {selectedRows.length - 10} more…</li>
            )}
          </ul>

          <p className="text-sm text-muted-foreground">
            Your own account and the last remaining developer account are always excluded.
          </p>

          {bulkDelete.isPending && progress ? (
            <div className="space-y-2" aria-live="polite">
              <p className="text-sm font-medium" data-testid="bulk-delete-progress">
                Deleting {progress.processed}/{progress.total} users…
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Keep this dialog open until the cleanup finishes.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="bulk-delete-confirm" className="text-sm font-medium">
                Type DELETE to confirm
              </label>
              <Input
                id="bulk-delete-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                disabled={bulkDelete.isPending}
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDelete.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runBulkDelete();
              }}
              disabled={confirmText !== "DELETE" || bulkDelete.isPending}
            >
              {bulkDelete.isPending
                ? `Deleting ${progress?.processed ?? 0}/${progress?.total ?? selected.length}…`
                : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!resetTarget}
        onOpenChange={(open) => {
          if (!open && !resetUserData.isPending) {
            setResetTarget(null);
            setResetConfirm("");
          }
        }}
      >
        <AlertDialogContent data-testid="reset-qa-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset QA data?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  All user-created financial and test data for{" "}
                  <span className="font-medium text-foreground">{resetTarget?.email}</span> will be
                  permanently deleted — companies, income, transactions, planner data, contributions,
                  deductions and tax tracking.
                </p>
                <p>
                  The login account, email, password and{" "}
                  {resetTarget ? ACCOUNT_ROLE_LABEL[resetTarget.role] : ""} role are preserved. This
                  does not delete the account.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Type <span className="font-mono font-semibold">RESET</span> to confirm.
            </p>
            <Input
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              placeholder="RESET"
              aria-label="Type RESET to confirm"
              data-testid="reset-qa-confirm-input"
              disabled={resetUserData.isPending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetUserData.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="reset-qa-confirm-button"
              onClick={(e) => {
                e.preventDefault();
                void runReset();
              }}
              disabled={resetConfirm !== "RESET" || resetUserData.isPending}
            >
              {resetUserData.isPending ? "Resetting…" : "Reset user data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

  );
}
