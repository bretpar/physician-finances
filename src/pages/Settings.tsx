import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Trash2, Building2, Check, Landmark, RefreshCw, Loader2,
  Shield, User, Crown, Calculator, CreditCard, Unplug, Settings2,
  Lock, HelpCircle, AlertTriangle,
} from "lucide-react";
import { useCompanies, type Company } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useTaxSettings, useUpdateTaxSettings, type WithholdingMethod } from "@/hooks/useTaxSettings";
import { FILING_TYPES, type FilingType } from "@/lib/filingTypes";
import {
  usePlaidItems,
  usePlaidAccounts,
  useSyncTransactions,
  useDisconnectPlaidItem,
  useUpdatePlaidAccount,
  useBulkApplyAccountBusiness,
  useToggleAccountSync,
  useReviewAccounts,
} from "@/hooks/usePlaid";

/* ─── Types ─── */
interface Profile { firstName: string; lastName: string; email: string; }
interface TaxSettings { federalRate: number; stateRate: number; bnoRate: number; }
interface OrgMember { id: string; user_id: string; role: string; email?: string; first_name?: string; last_name?: string; }

const COMPANY_TYPES = FILING_TYPES.map((t) => ({ value: t.value, label: t.label }));

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
  const { data: taxSettingsData } = useTaxSettings();
  const updateTaxSettingsMutation = useUpdateTaxSettings();

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
  function handleAddCompany() { addCompany({ name: "", companyType: "1099_schedule_c", includeInTax: true }); }
  function executeDeleteCompany() { if (!deleteCompanyId) return; removeCompany(deleteCompanyId); setDeleteCompanyId(null); toast.success("Company deleted"); }

  /* ─── Connected Accounts (Plaid) ─── */
  const { data: plaidItems = [], isLoading: plaidItemsLoading } = usePlaidItems();
  const { data: plaidAccounts = [] } = usePlaidAccounts();
  const syncMutation = useSyncTransactions();
  const disconnectMutation = useDisconnectPlaidItem();
  const updateAccountMutation = useUpdatePlaidAccount();
  const bulkApplyMutation = useBulkApplyAccountBusiness();
  const toggleSyncMutation = useToggleAccountSync();
  const reviewAccountsMutation = useReviewAccounts();

  const [linkLoading, setLinkLoading] = useState(false);
  const [disconnectItemId, setDisconnectItemId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [editRouting, setEditRouting] = useState<string>("needs_review");
  const [editMode, setEditMode] = useState<string>("unassigned");
  const [editCompanyId, setEditCompanyId] = useState<string>("");

  // Post-link review modal state
  const [reviewItemId, setReviewItemId] = useState<string | null>(null);
  const [reviewInstitution, setReviewInstitution] = useState<string>("");
  const [reviewPrefs, setReviewPrefs] = useState<
    Record<string, { sync_enabled: boolean; mode: string; companyId: string; routing: string }>
  >({});

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
          const { data: exchangeData, error: exchangeError } = await supabase.functions.invoke("plaid-exchange-token", {
            body: { public_token: publicToken, institution_name: metadata?.institution?.name || "Bank Account", institution_id: metadata?.institution?.institution_id || "" },
          });
          if (exchangeError) { toast.error("Failed to connect account"); }
          else {
            toast.success("Bank account connected! Please review imported accounts.");
            // Open review modal — refetch accounts first
            if (exchangeData?.item_db_id) {
              setReviewItemId(exchangeData.item_db_id);
              setReviewInstitution(exchangeData.institution_name || "Bank Account");
              // Initialize review prefs after accounts load
              setTimeout(async () => {
                const { data: newAccts } = await supabase
                  .from("plaid_accounts")
                  .select("*")
                  .eq("plaid_item_id", exchangeData.item_db_id)
                  .eq("is_active", true);
                if (newAccts) {
                  const prefs: Record<string, { sync_enabled: boolean; mode: string; companyId: string; routing: string }> = {};
                  for (const a of newAccts) {
                    prefs[a.id] = { sync_enabled: false, mode: "unassigned", companyId: "", routing: "needs_review" };
                  }
                  setReviewPrefs(prefs);
                }
              }, 500);
            }
          }
        },
        onExit: () => {},
      });
      handler.open();
    } catch { toast.error("Failed to open bank connection"); }
    finally { setLinkLoading(false); }
  };

  const accountTypeIcon = (type: string) => {
    if (type === "credit") return <CreditCard className="h-4 w-4" />;
    return <Building2 className="h-4 w-4" />;
  };

  const formatDate = (d: string | null) => {
    if (!d) return "Never";
    return new Date(d).toLocaleString();
  };

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return null;
    return companies.find((c) => c.id === companyId)?.name || null;
  };

  const getModeLabel = (routing: string, mode: string, companyId: string | null) => {
    if (routing === "personal") return "Personal";
    if (routing === "ignore") return "Ignored";
    if (routing === "needs_review") return "Needs Review";
    if (routing === "business") {
      if (mode === "single_business") {
        const name = getCompanyName(companyId);
        return name ? `Business · ${name}` : "Business (no company)";
      }
      if (mode === "shared") return "Business · Shared";
      return "Business";
    }
    return "Needs Review";
  };

  const getModeColor = (routing: string): "secondary" | "default" | "outline" | "destructive" => {
    if (routing === "business") return "default";
    if (routing === "personal") return "secondary";
    if (routing === "ignore") return "outline";
    return "destructive";
  };

  const openEditDialog = (acct: any) => {
    setEditingAccount(acct);
    setEditRouting(acct.account_routing || "needs_review");
    setEditMode(acct.account_business_mode || "unassigned");
    setEditCompanyId(acct.default_company_id || "");
  };

  const handleSaveAffiliation = () => {
    if (!editingAccount) return;
    updateAccountMutation.mutate({
      id: editingAccount.id,
      account_business_mode: editRouting === "business" ? editMode : "unassigned",
      default_company_id: editRouting === "business" && editMode === "single_business" && editCompanyId ? editCompanyId : null,
      account_routing: editRouting,
    }, { onSuccess: () => setEditingAccount(null) });
  };

  const handleBulkApply = () => {
    if (!editingAccount || editMode !== "single_business" || !editCompanyId) return;
    const name = getCompanyName(editCompanyId);
    if (!name) return;
    bulkApplyMutation.mutate({ accountId: editingAccount.id, companyName: name });
  };

  const handleSaveReview = async () => {
    if (!reviewItemId) return;
    // Get the actual account rows for this item
    const { data: accts } = await supabase
      .from("plaid_accounts")
      .select("id")
      .eq("plaid_item_id", reviewItemId)
      .eq("is_active", true);
    if (!accts) return;

    const updates = accts.map((a) => {
      const pref = reviewPrefs[a.id] || { sync_enabled: false, mode: "unassigned", companyId: "", routing: "needs_review" };
      const routing = pref.routing;
      return {
        id: a.id,
        sync_enabled: routing === "business" || routing === "personal",
        account_business_mode: routing === "business" ? pref.mode : "unassigned",
        default_company_id: routing === "business" && pref.mode === "single_business" && pref.companyId ? pref.companyId : null,
        account_routing: routing,
      };
    });

    reviewAccountsMutation.mutate(updates, {
      onSuccess: () => {
        setReviewItemId(null);
        setReviewPrefs({});
        // Auto-sync after review
        syncMutation.mutate(reviewItemId!);
      },
    });
  };

  const handleToggleSync = (accountId: string, enabled: boolean) => {
    toggleSyncMutation.mutate({ id: accountId, sync_enabled: enabled });
  };

  /* ─── Team ─── */
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
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
    if (!inviteEmail || !organizationId) return;
    setInviting(true);
    const { error } = await supabase.functions.invoke("invite-user", {
      body: { email: inviteEmail, firstName: inviteFirstName, lastName: inviteLastName, organizationId, role: inviteRole },
    });
    setInviting(false);
    if (error) { toast.error("Failed to invite user: " + error.message); }
    else { toast.success(`Invite sent to ${inviteEmail}`); setShowInvite(false); setInviteEmail(""); setInviteFirstName(""); setInviteLastName(""); setInviteRole("member"); loadMembers(); }
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

      {/* ─── Tax Withholding Method ─── */}
      <section className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold text-card-foreground">Tax Withholding Method</h3>
        </div>
        <p className="text-xs text-muted-foreground -mt-3">
          Choose how withholding recommendations are calculated across the app. This applies to both Business Activity and Personal Income.
        </p>

        <RadioGroup
          value={taxSettingsData?.withholdingMethod || "dynamic_actual"}
          onValueChange={(v: string) => {
            if (!taxSettingsData?.id) return;
            updateTaxSettingsMutation.mutate({ id: taxSettingsData.id, withholdingMethod: v as WithholdingMethod });
          }}
          className="space-y-3"
        >
          <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
            <RadioGroupItem value="flat_estimate" className="mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-card-foreground">Flat Estimate</p>
              <p className="text-xs text-muted-foreground mt-0.5">Use a fixed percentage for all withholding recommendations.</p>
              {(taxSettingsData?.withholdingMethod === "flat_estimate") && (
                <div className="mt-3 flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Rate (%)</Label>
                  <Input type="number" step="0.1" min="0" max="100" className="w-24 h-8" value={taxSettingsData?.manualEffectiveTaxRate ?? 20} onChange={(e) => { if (!taxSettingsData?.id) return; updateTaxSettingsMutation.mutate({ id: taxSettingsData.id, manualEffectiveTaxRate: parseFloat(e.target.value) || 0 }); }} />
                </div>
              )}
            </div>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
            <RadioGroupItem value="dynamic_actual" className="mt-0.5" />
            <div>
              <p className="text-sm font-medium text-card-foreground">Dynamic — Based on Current Income</p>
              <p className="text-xs text-muted-foreground mt-0.5">Uses all actual income entered across business, personal, and capital gains with real tax brackets.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
            <RadioGroupItem value="dynamic_planner" className="mt-0.5" />
            <div>
              <p className="text-sm font-medium text-card-foreground">Dynamic — Based on Income Planner</p>
              <p className="text-xs text-muted-foreground mt-0.5">Includes projected future income for forward-looking bracket estimation.</p>
            </div>
          </label>
        </RadioGroup>
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

      {/* ─── Connected Accounts (Plaid) — Full-featured ─── */}
      <section className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-card-foreground">Connected Accounts</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Manage linked bank and credit card accounts. Assign each to a business for auto-categorization.</p>
          </div>
          <Button size="sm" onClick={handleConnectBank} disabled={linkLoading} className="gap-1.5">
            {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Connect Account
          </Button>
        </div>

        {plaidItemsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : plaidItems.length > 0 ? (
          <div className="space-y-4">
            {plaidItems.map((item) => {
              const accounts = plaidAccounts.filter((a) => a.plaid_item_id === item.id);
              return (
                <div key={item.id} className="rounded-lg border border-border bg-card p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary">
                        <Landmark className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-card-foreground">{item.institution_name}</p>
                        <p className="text-xs text-muted-foreground">Last synced: {formatDate(item.last_synced_at)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => syncMutation.mutate(item.id)} disabled={syncMutation.isPending} className="gap-1.5">
                        {syncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Refresh
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDisconnectItemId(item.id)} className="gap-1.5 text-destructive hover:text-destructive">
                        <Unplug className="h-3.5 w-3.5" /> Disconnect
                      </Button>
                    </div>
                  </div>

                  {accounts.length > 0 && (
                    <div className="grid grid-cols-1 gap-3">
                      {accounts.map((acct) => {
                        const routing = (acct as any).account_routing || "needs_review";
                        const mode = (acct as any).account_business_mode || "unassigned";
                        const companyId = (acct as any).default_company_id || null;
                        const isActive = routing === "business" || routing === "personal";
                        return (
                          <div key={acct.id} className={`flex items-center gap-3 rounded-lg border border-border p-3 ${isActive ? "bg-muted/30" : "bg-muted/10 opacity-60"}`}>
                            <div className="text-muted-foreground">{accountTypeIcon(acct.account_type)}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-card-foreground truncate">{acct.account_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {acct.account_type}{acct.account_subtype ? ` · ${acct.account_subtype}` : ""}
                                {acct.account_mask ? ` ···${acct.account_mask}` : ""}
                              </p>
                            </div>
                            <Badge variant={getModeColor(routing)} className="text-xs shrink-0">
                              {getModeLabel(routing, mode, companyId)}
                            </Badge>
                            {acct.current_balance != null && (
                              <Badge variant="secondary" className="text-xs font-mono shrink-0">
                                ${Number(acct.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                              </Badge>
                            )}
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => openEditDialog(acct)}>
                              <Settings2 className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <Landmark className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Connect your bank accounts to automatically import transactions.</p>
            <Button onClick={handleConnectBank} disabled={linkLoading} className="mt-4 gap-2">
              {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Connect Your First Account
            </Button>
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
                    {isAdminOrOwner && member.user_id !== user?.id && member.role !== "owner" ? (
                      <Select value={member.role} onValueChange={(v) => handleRoleChange(member.id, v)}>
                        <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {userRole === "owner" && <SelectItem value="admin">Admin</SelectItem>}
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

      {/* Disconnect account dialog */}
      <AlertDialog open={!!disconnectItemId} onOpenChange={() => setDisconnectItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Bank Account?</AlertDialogTitle>
            <AlertDialogDescription>This will deactivate the connection. Your previously imported transactions will be kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (disconnectItemId) disconnectMutation.mutate(disconnectItemId); setDisconnectItemId(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit account routing dialog */}
      <Dialog open={!!editingAccount} onOpenChange={() => setEditingAccount(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Account Routing</DialogTitle>
            <DialogDescription>Choose where transactions from this account should go.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Transaction Destination</label>
              <Select value={editRouting} onValueChange={(v) => { setEditRouting(v); if (v !== "business") { setEditMode("unassigned"); setEditCompanyId(""); } }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Business Activity</SelectItem>
                  <SelectItem value="personal">Personal Income / Activity</SelectItem>
                  <SelectItem value="ignore">Ignore / Do Not Sync</SelectItem>
                  <SelectItem value="needs_review">Needs Review</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {editRouting === "business" && "Transactions appear in Business Activity for profit/loss tracking."}
                {editRouting === "personal" && "Transactions appear in Personal Income. Not included in business P&L."}
                {editRouting === "ignore" && "No transactions will be imported from this account."}
                {editRouting === "needs_review" && "Transactions are paused until you choose a destination."}
              </p>
            </div>
            {editRouting === "business" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Business Assignment</label>
                  <Select value={editMode} onValueChange={setEditMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      <SelectItem value="single_business">One Specific Business</SelectItem>
                      <SelectItem value="shared">Shared / Multiple Businesses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editMode === "single_business" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Default Business</label>
                    <Select value={editCompanyId} onValueChange={setEditCompanyId}>
                      <SelectTrigger><SelectValue placeholder="Select a business..." /></SelectTrigger>
                      <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {editMode === "single_business" && editCompanyId && (
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground mb-2">Optionally apply this business to existing unassigned imported transactions from this account.</p>
                    <Button variant="outline" size="sm" onClick={handleBulkApply} disabled={bulkApplyMutation.isPending}>
                      {bulkApplyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                      Apply to Existing Transactions
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>Cancel</Button>
            <Button onClick={handleSaveAffiliation} disabled={updateAccountMutation.isPending || (editRouting === "business" && editMode === "single_business" && !editCompanyId)}>
              {updateAccountMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite team member dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} /></div>
              <div><Label>Last Name</Label><Input value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} /></div>
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">An invite link will be sent to this email address.</p>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="member">Member</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>{inviting ? "Sending…" : "Send Invite Link"}</Button>
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

      {/* Post-link account review dialog */}
      <Dialog open={!!reviewItemId} onOpenChange={(open) => { if (!open) { setReviewItemId(null); setReviewPrefs({}); } }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Imported Accounts</DialogTitle>
            <DialogDescription>
              {reviewInstitution} returned the accounts below. Choose where each account's transactions should go before syncing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {Object.entries(reviewPrefs).length === 0 ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              (() => {
                const reviewAccounts = plaidAccounts.filter((a) => a.plaid_item_id === reviewItemId);
                return (reviewAccounts.length > 0 ? reviewAccounts : []).map((acct: any) => {
                  const pref = reviewPrefs[acct.id] || { sync_enabled: false, mode: "unassigned", companyId: "", routing: "needs_review" };
                  const routing = pref.routing;
                  return (
                    <div key={acct.id} className="rounded-lg border border-border p-4 space-y-3 bg-card">
                      <div className="flex items-center gap-3">
                        <div className="text-muted-foreground">{accountTypeIcon(acct.account_type)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-card-foreground">{acct.account_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {acct.account_type}{acct.account_subtype ? ` · ${acct.account_subtype}` : ""}
                            {acct.account_mask ? ` ···${acct.account_mask}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Route to:</label>
                        <Select value={routing} onValueChange={(v) => setReviewPrefs((p) => ({ ...p, [acct.id]: { ...pref, routing: v, mode: v !== "business" ? "unassigned" : pref.mode, companyId: v !== "business" ? "" : pref.companyId, sync_enabled: v === "business" || v === "personal" } }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="business">Business Activity</SelectItem>
                            <SelectItem value="personal">Personal Income / Activity</SelectItem>
                            <SelectItem value="ignore">Ignore / Do Not Sync</SelectItem>
                            <SelectItem value="needs_review">Decide Later</SelectItem>
                          </SelectContent>
                        </Select>
                        {routing === "business" && (
                          <div className="space-y-2 pl-2">
                            <Select value={pref.mode} onValueChange={(v) => setReviewPrefs((p) => ({ ...p, [acct.id]: { ...pref, mode: v, companyId: v !== "single_business" ? "" : pref.companyId } }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">No default business</SelectItem>
                                <SelectItem value="single_business">Assign to a business</SelectItem>
                                <SelectItem value="shared">Shared / Multiple</SelectItem>
                              </SelectContent>
                            </Select>
                            {pref.mode === "single_business" && (
                              <Select value={pref.companyId} onValueChange={(v) => setReviewPrefs((p) => ({ ...p, [acct.id]: { ...pref, companyId: v } }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select business..." /></SelectTrigger>
                                <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                              </Select>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewItemId(null); setReviewPrefs({}); }}>Skip</Button>
            <Button onClick={handleSaveReview} disabled={reviewAccountsMutation.isPending}>
              {reviewAccountsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Save & Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
