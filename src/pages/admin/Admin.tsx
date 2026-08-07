import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { filterAdminUsers, useAdminUsers, useUpdateAccountRole, type AdminUserRow } from "@/hooks/useAdminUsers";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FeaturesPanel from "@/pages/admin/FeaturesPanel";


const ROLE_OPTIONS: AccountRole[] = ["free", "premium", "premium_beta", "developer"];

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function Admin() {
  const { role, isDeveloper, isLoading, userEmail } = useAccountRole();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<{ user: AdminUserRow; next: AccountRole } | null>(null);

  const { data: users, isLoading: usersLoading, error } = useAdminUsers(isDeveloper);
  const updateRole = useUpdateAccountRole();

  const rows = useMemo(() => filterAdminUsers(users ?? [], search), [users, search]);
  const developerCount = useMemo(() => (users ?? []).filter((u) => u.role === "developer").length, [users]);

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
          <Input
            placeholder="Search by email or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
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
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.email}</p>
                      {row.displayName && (
                        <p className="truncate text-xs text-muted-foreground">{row.displayName}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{ACCOUNT_ROLE_LABEL[row.role]}</Badge>
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
                        <TableCell className="font-medium">{row.email}</TableCell>
                        <TableCell>{row.displayName || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ACCOUNT_ROLE_LABEL[row.role]}</Badge>
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
    </div>
  );
}
