import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Shield, User, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface OrgMember {
  id: string;
  user_id: string;
  role: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

const roleIcons = { owner: Crown, admin: Shield, member: User };
const roleColors = { owner: "default", admin: "secondary", member: "outline" } as const;

export default function Team() {
  const { organizationId, userRole, user } = useAuth();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdminOrOwner = userRole === "owner" || userRole === "admin";

  // Invite dialog
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviting, setInviting] = useState(false);

  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function loadMembers() {
    if (!organizationId) return;
    setLoading(true);

    const { data: memberships } = await supabase
      .from("organization_members")
      .select("id, user_id, role")
      .eq("organization_id", organizationId);

    if (!memberships) { setLoading(false); return; }

    // Load profiles for each member
    const userIds = memberships.map(m => m.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email, first_name, last_name")
      .in("user_id", userIds);

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

    const enriched: OrgMember[] = memberships.map(m => ({
      ...m,
      email: profileMap.get(m.user_id)?.email || "",
      first_name: profileMap.get(m.user_id)?.first_name || "",
      last_name: profileMap.get(m.user_id)?.last_name || "",
    }));

    setMembers(enriched);
    setLoading(false);
  }

  useEffect(() => { loadMembers(); }, [organizationId]);

  async function handleInvite() {
    if (!inviteEmail || !organizationId) return;
    setInviting(true);

    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: {
        email: inviteEmail,
        firstName: inviteFirstName,
        lastName: inviteLastName,
        organizationId,
        role: inviteRole,
      },
    });

    setInviting(false);
    if (error) {
      toast.error("Failed to invite user: " + error.message);
    } else {
      toast.success(`Invite sent to ${inviteEmail}`);
      setShowInvite(false);
      setInviteEmail(""); setInviteFirstName(""); setInviteLastName(""); setInviteRole("member");
      loadMembers();
    }
  }

  async function handleRemove() {
    if (!deleteId) return;
    const { error } = await supabase.from("organization_members").delete().eq("id", deleteId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Member removed");
      loadMembers();
    }
    setDeleteId(null);
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    const { error } = await supabase
      .from("organization_members")
      .update({ role: newRole as "owner" | "admin" | "member" })
      .eq("id", memberId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Role updated");
      loadMembers();
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Team Management</h1>
          <p className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdminOrOwner && (
          <Button onClick={() => setShowInvite(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Invite Member
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {loading ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Loading…</CardContent></Card>
        ) : members.map((member) => {
          const Icon = roleIcons[member.role as keyof typeof roleIcons] || User;
          return (
            <Card key={member.id}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-card-foreground">
                    {member.first_name} {member.last_name}
                    {member.user_id === user?.id && <span className="text-muted-foreground ml-1">(you)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isAdminOrOwner && member.user_id !== user?.id && member.role !== "owner" ? (
                    <Select value={member.role} onValueChange={(v: string) => handleRoleChange(member.id, v)}>
                      <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {userRole === "owner" && <SelectItem value="admin">Admin</SelectItem>}
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={roleColors[member.role as keyof typeof roleColors] || "outline"} className="capitalize">
                      {member.role}
                    </Badge>
                  )}
                  {isAdminOrOwner && member.user_id !== user?.id && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(member.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name</Label>
                <Input value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
              <p className="text-xs text-muted-foreground mt-1">An invite link will be sent to this email address.</p>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>
                {inviting ? "Sending…" : "Send Invite Link"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>This will remove this person from your organization. They will lose access to all data.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
