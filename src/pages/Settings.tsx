import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, Trash2, Building2, Check, Landmark, RefreshCw, Loader2,
  Shield, User, Crown,
} from "lucide-react";
import { useCompanies, type Company } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/* ─── Types ─── */
interface Profile { firstName: string; lastName: string; email: string; }
interface TaxSettings { federalRate: number; stateRate: number; bnoRate: number; }
interface PlaidItem { id: string; institution_name: string; created_at: string; }
interface OrgMember { id: string; user_id: string; role: string; email?: string; first_name?: string; last_name?: string; }

const COMPANY_TYPES = [
  { value: "1099", label: "1099" },
  { value: "W2", label: "W2" },
  { value: "K1", label: "K1" },
] as const;

const roleIcons = { owner: Crown, admin: Shield, member: User };
const roleColors = { owner: "default", admin: "secondary", member: "outline" } as const;

/* ─── Auto-save hook ─── */
function useAutoSave<T>(value: T, onSave: (v: T) => void, delay = 1000) {
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => { onSave(value); setSaved(true); }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]); // eslint-disable-line react-hooks/exhaustive-deps
  return saved;
}

function isValidEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

/* ─── Main Component ─── */
export default function Settings() {
  const { companies, addCompany, updateCompany, removeCompany } = useCompanies();
  const { organizationId, userRole, user } = useAuth();
  const isAdminOrOwner = userRole === "owner" || userRole === "admin";

  /* Profile */
  const [profile, setProfile] = useState<Profile>({ firstName: "", lastName: "", email: "" });
  const [emailError, setEmailError] = useState("");
  const profileSaved = useAutoSave(profile, () => {
    if (profile.email && !isValidEmail(profile.email)) { setEmailError("Please enter a valid email address"); return; }
    setEmailError("");
    toast.success("Profile saved", { duration: 1500 });
  });

  /* Tax Settings */
  const [taxSettings, setTaxSettings] = useState<TaxSettings>({ federalRate: 20, stateRate: 0, bnoRate: 1.5 });
  const taxSaved = useAutoSave(taxSettings, () => { toast.success("Tax settings saved", { duration: 1500 }); });

  /* Companies */
  const [deleteCompanyId, setDeleteCompanyId] = useState<string | null>(null);
  function handleAddCompany() { addCompany({ name: "", companyType: "1099", includeInTax: true }); }
  function executeDeleteCompany() { if (!deleteCompanyId) return; removeCompany(deleteCompanyId); setDeleteCompanyId(null); toast.success("Company deleted"); }

  /* ─── Accounts (Plaid) ─── */
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchPlaidItems = useCallback(async () => {
    const { data } = await supabase.from("plaid_items").select("id, institution_name, created_at").order("created_at", { ascending: false });
    if (data) setPlaidItems(data);
  }, []);

  useEffect(() => { fetchPlaidItems(); }, [fetchPlaidItems]);

  const handleConnectBank = async () => {
    setLinkLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("plaid-create-link-token");
      if (error || !data?.link_token) { toast.error("Failed to initialize bank connection"); return; }
      if (!(window as any).Plaid) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Plaid"));
          document.head.appendChild(script);
        });
      }
      const handler = (window as any).Plaid.create({
        token: data.link_token,
        onSuccess: async (publicToken: string, metadata: any) => {
          setPlaidLoading(true);
          const { error: exchangeError } = await supabase.functions.invoke("plaid-exchange-token", {
            body: { public_token: publicToken, institution_name: metadata?.institution?.name || "Bank Account" },
          });
          if (exchangeError) { toast.error("Failed to connect account"); }
          else { toast.success("Bank account connected!"); await fetchPlaidItems(); handleSyncTransactions(); }
          setPlaidLoading(false);
        },
        onExit: () => {},
      });
      handler.open();
    } catch { toast.error("Failed to open bank connection"); }
    finally { setLinkLoading(false); }
  };

  const handleSyncTransactions = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("plaid-sync-transactions");
      if (error) toast.error("Failed to sync transactions");
      else toast.success(`Synced ${data?.transactions_added || 0} new transactions`);
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  };

  /* ─── Team ─── */
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [deleteMemId, setDeleteMemId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!organizationId) return;
    setMembersLoading(true);
    const { data: memberships } = await supabase.from("organization_members").select("id, user_id, role").eq("organization_id", organizationId);
    if (!memberships) { setMembersLoading(false); return; }
    const userIds = memberships.map((m) => m.user_id);
    const { data: profiles } = await supabase.from("profiles").select("user_id, email, first_name, last_name").in("user_id", userIds);
    const profileMap = new Map(profiles?.map((p) => [p.user_id, p]) || []);
    setMembers(memberships.map((m) => ({ ...m, email: profileMap.get(m.user_id)?.email || "", first_name: profileMap.get(m.user_id)?.first_name || "", last_name: profileMap.get(m.user_id)?.last_name || "" })));
    setMembersLoading(false);
  }, [organizationId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  async function handleInvite() {
    if (!inviteEmail || !invitePassword || !organizationId) return;
    setInviting(true);
    const { error } = await supabase.functions.invoke("invite-user", {
      body: { email: inviteEmail, password: invitePassword, firstName: inviteFirstName, lastName: inviteLastName, organizationId, role: inviteRole },
    });
    setInviting(false);
    if (error) { toast.error("Failed to invite user: " + error.message); }
    else { toast.success(`Invited ${inviteEmail}`); setShowInvite(false); setInviteEmail(""); setInvitePassword(""); setInviteFirstName(""); setInviteLastName(""); setInviteRole("member"); loadMembers(); }
  }

  async function handleRemoveMember() {
    if (!deleteMemId) return;
    const { error } = await supabase.from("organization_members").delete().eq("id", deleteMemId);
    if (error) toast.error(error.message); else { toast.success("Member removed"); loadMembers(); }
    setDeleteMemId(null);
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    const { error } = await supabase.from("organization_members").update({ role: newRole as "owner" | "admin" | "member" }).eq("id", memberId);
    if (error) toast.error(error.message); else { toast.success("Role updated"); loadMembers(); }
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* ─── Profile ─── */}
      <section className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-card-foreground">Profile</h3>
          {profileSaved && profile.firstName && (
            <span className="text-xs text-success flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><Label className="text-xs text-muted-foreground mb-1.5 block">First Name</Label><Input value={profile.firstName} onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))} placeholder="John" /></div>
          <div><Label className="text-xs text-muted-foreground mb-1.5 block">Last Name</Label><Input value={profile.lastName} onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))} placeholder="Smith" /></div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Email Address</Label>
          <Input type="email" value={profile.email} onChange={(e) => { setProfile((p) => ({ ...p, email: e.target.value })); if (emailError) setEmailError(""); }} placeholder="doctor@example.com" className={emailError ? "border-destructive" : ""} />
          {emailError && <p className="text-xs text-destructive mt-1">{emailError}</p>}
          <p className="text-xs text-muted-foreground mt-1">This will be your login identifier</p>
        </div>
      </section>

      {/* ─── Tax Settings ─── */}
      <section className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-card-foreground">Tax Settings</h3>
          {taxSaved && <span className="text-xs text-success flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}
        </div>
        <p className="text-xs text-muted-foreground -mt-3">These rates feed into all dashboard tax calculations and quarterly estimates.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><Label className="text-xs text-muted-foreground mb-1.5 block">Federal Tax Rate (%)</Label><Input type="number" step="0.1" min="0" max="100" value={taxSettings.federalRate} onChange={(e) => setTaxSettings((s) => ({ ...s, federalRate: parseFloat(e.target.value) || 0 }))} /></div>
          <div><Label className="text-xs text-muted-foreground mb-1.5 block">State Tax Rate (%)</Label><Input type="number" step="0.1" min="0" max="100" value={taxSettings.stateRate} onChange={(e) => setTaxSettings((s) => ({ ...s, stateRate: parseFloat(e.target.value) || 0 }))} /></div>
          <div><Label className="text-xs text-muted-foreground mb-1.5 block">B&O Tax Rate (%)</Label><Input type="number" step="0.1" min="0" max="100" value={taxSettings.bnoRate} onChange={(e) => setTaxSettings((s) => ({ ...s, bnoRate: parseFloat(e.target.value) || 0 }))} /></div>
        </div>
      </section>

      {/* ─── Companies ─── */}
      <section className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-card-foreground">Companies</h3>
          <Button variant="outline" size="sm" onClick={handleAddCompany} className="gap-1.5"><Plus className="h-4 w-4" /> Add Company</Button>
        </div>
        {companies.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No companies added yet. Click "Add Company" to get started.</p>}
        <div className="space-y-3">
          {companies.map((company) => (
            <div key={company.id} className="border border-border rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-3 items-end">
                <div><Label className="text-xs text-muted-foreground mb-1.5 block">Company Name</Label><Input value={company.name} onChange={(e) => updateCompany(company.id, { name: e.target.value })} placeholder="Company name" /></div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
                  <Select value={company.companyType} onValueChange={(v) => updateCompany(company.id, { companyType: v as Company["companyType"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COMPANY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-destructive" onClick={() => setDeleteCompanyId(company.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={company.includeInTax} onCheckedChange={(checked) => updateCompany(company.id, { includeInTax: checked })} />
                <Label className="text-xs text-muted-foreground">Include in tax projections</Label>
              </div>
              {company.name && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" /><span>{company.name} — {company.companyType}{!company.includeInTax && " (excluded from tax calculations)"}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* ─── Accounts (Plaid) ─── */}
      <section className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-card-foreground">Linked Accounts</h3>
          <div className="flex gap-2">
            {plaidItems.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleSyncTransactions} disabled={syncing} className="gap-1.5">
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync
              </Button>
            )}
            <Button size="sm" onClick={handleConnectBank} disabled={linkLoading || plaidLoading} className="gap-1.5">
              {linkLoading || plaidLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Connect Bank
            </Button>
          </div>
        </div>
        {plaidItems.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {plaidItems.map((item) => (
              <div key={item.id} className="border border-border rounded-lg p-4 flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary shrink-0"><Landmark className="h-5 w-5" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-card-foreground">{item.institution_name}</p>
                  <p className="text-xs text-muted-foreground">Connected {new Date(item.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <Landmark className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No bank accounts connected yet.</p>
          </div>
        )}
      </section>

      {/* ─── Team ─── */}
      <section className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-card-foreground">Team</h3>
            <p className="text-xs text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</p>
          </div>
          {isAdminOrOwner && (
            <Button size="sm" onClick={() => setShowInvite(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Invite Member</Button>
          )}
        </div>
        <div className="space-y-2">
          {membersLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
          ) : members.map((member) => {
            const Icon = roleIcons[member.role as keyof typeof roleIcons] || User;
            return (
              <Card key={member.id} className="shadow-none">
                <CardContent className="flex items-center gap-4 py-3 px-4">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-card-foreground">{member.first_name} {member.last_name}{member.user_id === user?.id && <span className="text-muted-foreground ml-1">(you)</span>}</p>
                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdminOrOwner && member.user_id !== user?.id ? (
                      <Select value={member.role} onValueChange={(v) => handleRoleChange(member.id, v)}>
                        <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Owner</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={roleColors[member.role as keyof typeof roleColors] || "outline"} className="capitalize">{member.role}</Badge>
                    )}
                    {isAdminOrOwner && member.user_id !== user?.id && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteMemId(member.id)}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ─── Dialogs ─── */}
      <AlertDialog open={!!deleteCompanyId} onOpenChange={(open) => !open && setDeleteCompanyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Company</AlertDialogTitle><AlertDialogDescription>This will permanently remove this company from your settings.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={executeDeleteCompany} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} /></div>
              <div><Label>Last Name</Label><Input value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} /></div>
            </div>
            <div><Label>Email *</Label><Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} /></div>
            <div><Label>Temporary Password *</Label><Input type="password" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} placeholder="Min 8 chars" /></div>
            <div>
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="member">Member</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail || !invitePassword}>{inviting ? "Inviting…" : "Send Invite"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteMemId} onOpenChange={(open) => !open && setDeleteMemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove Team Member</AlertDialogTitle><AlertDialogDescription>This will remove this person from your organization. They will lose access to all data.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleRemoveMember} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
