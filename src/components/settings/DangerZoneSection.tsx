import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { SectionCard } from "@/components/settings/SectionCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Step = "choose" | "confirmErase" | "confirmDelete" | "erased";

const ERASE_COMPLETE_MARKER = "paycheckmd:erase-complete";

export function DangerZoneSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  function reset() {
    setStep("choose");
    setDeleteConfirmText("");
    setBusy(false);
  }

  async function callCleanup(action: "erase" | "delete") {
    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    if (sessErr || !sessionData.session) {
      throw new Error("You must be logged in.");
    }
    const { data, error } = await supabase.functions.invoke("account-cleanup", {
      body: { action },
    });
    if (error) throw new Error(error.message || "Cleanup failed");
    if (data && (data as any).ok === false) {
      throw new Error((data as any).error || "Cleanup failed");
    }
    return data;
  }

  async function handleErase() {
    setBusy(true);
    try {
      await callCleanup("erase");
      // Clear any cached query state and local/session caches.
      try {
        queryClient.clear();
        Object.keys(sessionStorage).forEach((k) => {
          if (k.startsWith("paycheckmd-")) sessionStorage.removeItem(k);
        });
        // Preserve auth-related localStorage; clear app caches.
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith("paycheckmd-") || k.startsWith("w4.")) {
            localStorage.removeItem(k);
          }
        });
      } catch {
        // best effort
      }
      // Deterministic post-erase signal for E2E + humans.
      try {
        localStorage.setItem(ERASE_COMPLETE_MARKER, String(Date.now()));
      } catch {
        // best effort
      }
      toast.success("Your account data has been erased. Start onboarding again.");
      setStep("erased");
      setBusy(false);
      // Hard-navigate so cached state is dropped. Small delay lets the
      // success state render so tests can latch onto either the URL change
      // or the visible "erase-success" marker.
      window.setTimeout(() => {
        window.location.assign("/onboarding?reset=1");
      }, 250);
    } catch (err: any) {
      toast.error(err?.message || "Failed to erase account data");
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await callCleanup("delete");
      toast.success("Your account has been permanently deleted.");
      try {
        queryClient.clear();
        sessionStorage.clear();
        // Note: supabase auth tokens live in localStorage; clearing them ends the session.
        localStorage.clear();
      } catch {
        // best effort
      }
      await signOut().catch(() => {});
      window.location.assign("/login");
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete account");
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Delete/Erase Account"
      icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
      description="Permanently erase your data or delete your account."
      hideActionBar
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          These actions cannot be undone. Erasing keeps your login; deleting removes everything.
        </p>
        <Button
          variant="destructive"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          Delete/Erase Account
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!busy) {
            setOpen(o);
            if (!o) reset();
          }
        }}
      >
        <DialogContent>
          {step === "choose" && (
            <>
              <DialogHeader>
                <DialogTitle>Delete or erase account?</DialogTitle>
                <DialogDescription>
                  You can erase your data and restart onboarding while keeping your login, or
                  permanently delete your account.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 pt-2">
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setStep("confirmErase")}
                >
                  Erase account data
                </Button>
                <Button variant="destructive" onClick={() => setStep("confirmDelete")}>
                  Delete account
                </Button>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {step === "confirmErase" && (
            <>
              <DialogHeader>
                <DialogTitle>Erase all account data?</DialogTitle>
                <DialogDescription>
                  This will remove all app data and Plaid links but keep your login. Continue?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="secondary" onClick={() => setStep("choose")} disabled={busy}>
                  Back
                </Button>
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={handleErase}
                  disabled={busy}
                >
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Yes, erase my data
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "confirmDelete" && (
            <>
              <DialogHeader>
                <DialogTitle>Permanently delete account?</DialogTitle>
                <DialogDescription>
                  This permanently removes your account, all data, Plaid links, and attachments.
                  This cannot be undone. Type <span className="font-semibold">DELETE</span> to
                  confirm.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
                <Input
                  id="delete-confirm"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="secondary" onClick={() => setStep("choose")} disabled={busy}>
                  Back
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={busy || deleteConfirmText.trim() !== "DELETE"}
                >
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Permanently delete account
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

export default DangerZoneSection;
