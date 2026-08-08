import { useMemo, useState } from "react";
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
  useUpdateAccountRole,
  type AdminUserFilter,
  type AdminUserRow,
} from "@/hooks/useAdminUsers";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FeaturesPanel from "@/pages/admin/FeaturesPanel";

const ROLE_OPTIONS: AccountRole[] = ["free", "premium", "premium_beta", "developer"];

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

  const { data: users, isLoading: usersLoading, error } = useAdminUsers(isDeveloper);
  const updateRole = useUpdateAccountRole();
  const bulkDelete = useBulkDeleteUsers();

  const rows = useMemo(
    () => applyAdminUserFilter(filterAdminUsers(users ?? [], search), filter),
    [users, search, filter],
  );
  const developerCount = useMemo(() => (users ?? []).filter((u) => u.role === "developer").length, [users]);

  const selectedRows = useMemo(
    () => (users ?? []).filter((u) => selected.includes(u.userId)),
    [users, selected],
  );
  const visibleIds = rows.map((r) => r.userId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

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
    try {
      const result = await bulkDelete.mutateAsync(selected);
      const skippedNote = result.skipped.length
        ? ` ${result.skipped.length} skipped: ${result.skipped[0].reason}`
        : "";
      const failedNote = result.failed.length ? ` ${result.failed.length} failed.` : "";
      toast({
        title: `${result.deleted.length} account${result.deleted.length === 1 ? "" : "s"} deleted`,
        description: `${skippedNote}${failedNote}`.trim() || "All selected accounts were removed.",
        variant: result.failed.length ? "destructive" : undefined,
      });
      setSelected((prev) => prev.filter((id) => !result.deleted.includes(id)));
      setDeleteOpen(false);
      setConfirmText("");
    } catch (e) {
      toast({
        title: "Bulk delete failed",
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

              {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
                  <span className="text-sm font-medium" data-testid="selection-count">
                    {selected.length} user{selected.length === 1 ? "" : "s"} selected
                  </span>
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
                </div>
              )}
            </CardHeader>
            <CardContent>
              {usersLoading && <p className="text-sm text-muted-foreground">Loading users…</p>}
              {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
              {!usersLoading && !error && rows.length === 0 && (
                <p className="text-sm text-muted-foreground">No users match your search.</p>
              )}

              {rows.length > 0 && (
                <>
                  {/* Mobile cards */}
                  <ul className="space-y-3 md:hidden" data-testid="admin-user-cards">
                    {rows.map((row) => (
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
                        <RoleSelect row={row} />
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
                        {rows.map((row) => (
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
                              </div>
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
          if (!open) {
            setDeleteOpen(false);
            setConfirmText("");
          }
        }}
      >
        <AlertDialogContent>
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
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runBulkDelete();
              }}
              disabled={confirmText !== "DELETE" || bulkDelete.isPending}
            >
              {bulkDelete.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
