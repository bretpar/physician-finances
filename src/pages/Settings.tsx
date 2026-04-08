import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Trash2, Building2, Check } from "lucide-react";

// Local state types
interface Profile {
  firstName: string;
  lastName: string;
  email: string;
}

interface TaxSettings {
  federalRate: number;
  stateRate: number;
  bnoRate: number;
}

interface Company {
  id: string;
  name: string;
  companyType: "1099" | "W2" | "K1";
  includeInTax: boolean;
}

const COMPANY_TYPES = [
  { value: "1099", label: "1099" },
  { value: "W2", label: "W2" },
  { value: "K1", label: "K1" },
] as const;

function useAutoSave<T>(value: T, onSave: (v: T) => void, delay = 1000) {
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => {
      onSave(value);
      setSaved(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]); // eslint-disable-line react-hooks/exhaustive-deps
  return saved;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function Settings() {
  // Profile
  const [profile, setProfile] = useState<Profile>({
    firstName: "",
    lastName: "",
    email: "",
  });
  const [emailError, setEmailError] = useState("");

  // Tax settings
  const [taxSettings, setTaxSettings] = useState<TaxSettings>({
    federalRate: 20,
    stateRate: 0,
    bnoRate: 1.5,
  });

  // Companies
  const [companies, setCompanies] = useState<Company[]>([
    { id: "1", name: "Ortho Compass", companyType: "1099", includeInTax: true },
    { id: "2", name: "Hospital W2", companyType: "W2", includeInTax: true },
    { id: "3", name: "Surgery Center Partnership", companyType: "K1", includeInTax: true },
  ]);

  // Delete confirmation
  const [deleteCompanyId, setDeleteCompanyId] = useState<string | null>(null);

  // Auto-save profile
  const profileSaved = useAutoSave(profile, () => {
    if (profile.email && !isValidEmail(profile.email)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setEmailError("");
    // TODO: Save to Supabase when auth is added
    toast.success("Profile saved", { duration: 1500 });
  });

  // Auto-save tax settings
  const taxSaved = useAutoSave(taxSettings, () => {
    // TODO: Save to Supabase when auth is added
    toast.success("Tax settings saved", { duration: 1500 });
  });

  // Company operations
  function addCompany() {
    const newCompany: Company = {
      id: `company-${Date.now()}`,
      name: "",
      companyType: "1099",
      includeInTax: true,
    };
    setCompanies((prev) => [...prev, newCompany]);
  }

  const updateCompany = useCallback((id: string, updates: Partial<Company>) => {
    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
    // TODO: Auto-save to Supabase when auth is added
  }, []);

  function confirmDeleteCompany(id: string) {
    setDeleteCompanyId(id);
  }

  function executeDeleteCompany() {
    if (!deleteCompanyId) return;
    setCompanies((prev) => prev.filter((c) => c.id !== deleteCompanyId));
    setDeleteCompanyId(null);
    toast.success("Company deleted");
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Profile Section */}
      <div className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-card-foreground">Profile</h3>
          {profileSaved && profile.firstName && (
            <span className="text-xs text-success flex items-center gap-1">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">First Name</Label>
            <Input
              value={profile.firstName}
              onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
              placeholder="John"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Last Name</Label>
            <Input
              value={profile.lastName}
              onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
              placeholder="Smith"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Email Address</Label>
          <Input
            type="email"
            value={profile.email}
            onChange={(e) => {
              setProfile((p) => ({ ...p, email: e.target.value }));
              if (emailError) setEmailError("");
            }}
            placeholder="doctor@example.com"
            className={emailError ? "border-destructive" : ""}
          />
          {emailError && <p className="text-xs text-destructive mt-1">{emailError}</p>}
          <p className="text-xs text-muted-foreground mt-1">This will be your login identifier</p>
        </div>
      </div>

      {/* Tax Settings Section */}
      <div className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-card-foreground">Tax Settings</h3>
          {taxSaved && (
            <span className="text-xs text-success flex items-center gap-1">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground -mt-3">
          These rates feed into all dashboard tax calculations and quarterly estimates.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Federal Tax Rate (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={taxSettings.federalRate}
              onChange={(e) =>
                setTaxSettings((s) => ({ ...s, federalRate: parseFloat(e.target.value) || 0 }))
              }
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">State Tax Rate (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={taxSettings.stateRate}
              onChange={(e) =>
                setTaxSettings((s) => ({ ...s, stateRate: parseFloat(e.target.value) || 0 }))
              }
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">B&O Tax Rate (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={taxSettings.bnoRate}
              onChange={(e) =>
                setTaxSettings((s) => ({ ...s, bnoRate: parseFloat(e.target.value) || 0 }))
              }
            />
          </div>
        </div>
      </div>

      {/* Companies Section */}
      <div className="glass-card rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-card-foreground">Companies</h3>
          <Button variant="outline" size="sm" onClick={addCompany} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add Company
          </Button>
        </div>

        {companies.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No companies added yet. Click "Add Company" to get started.
          </p>
        )}

        <div className="space-y-3">
          {companies.map((company) => (
            <div
              key={company.id}
              className="border border-border rounded-lg p-4 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-3 items-end">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Company Name</Label>
                  <Input
                    value={company.name}
                    onChange={(e) => updateCompany(company.id, { name: e.target.value })}
                    placeholder="Company name"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
                  <Select
                    value={company.companyType}
                    onValueChange={(v) =>
                      updateCompany(company.id, { companyType: v as Company["companyType"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPANY_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground hover:text-destructive"
                  onClick={() => confirmDeleteCompany(company.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={company.includeInTax}
                  onCheckedChange={(checked) =>
                    updateCompany(company.id, { includeInTax: checked })
                  }
                />
                <Label className="text-xs text-muted-foreground">
                  Include in tax projections
                </Label>
              </div>

              {company.name && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>
                    {company.name} — {company.companyType}
                    {!company.includeInTax && " (excluded from tax calculations)"}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Delete Company Confirmation */}
      <AlertDialog open={!!deleteCompanyId} onOpenChange={(open) => !open && setDeleteCompanyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Company</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this company from your settings. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDeleteCompany}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
