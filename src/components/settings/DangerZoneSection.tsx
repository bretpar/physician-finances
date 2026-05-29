import { useState } from "react";

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
import { SectionCard } from "@/components/settings/SectionCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function DangerZoneSection() {
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [confirmText, setConfirmText] = useState("");

  function reset() {
    setConfirmText("");
    setDeleteError("");
    setBusy(false);
  }

  async function handleDelete() {
    if (busy) return;
    setDeleteError("");
    setBusy(true);
    try {
      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr || !sessionData.session) {
        throw new Error("You must be logged in.");
      }
      const { data, error } = await supabase.functions.invoke("account-cleanup", {
        body: { action: "delete" },
      });
      if (error) {
        const status = (error as any)?.context?.status ?? (error as any)?.status;
        const rawMsg = (error as any)?.message || "Failed to delete account";
        console.error("account-cleanup delete failed", { status, message: rawMsg });
        const friendly =
          status === 401 || status === 403
            ? "Your session has expired. Please log out and back in, then try again."
            : status >= 500
            ? "The server could not delete your account right now. Please try again in a moment."
            : !status
            ? "Could not reach the delete service. Check your connection and try again."
            : rawMsg;
        throw new Error(friendly);
      }
      if (data && (data as any).ok === false) {
        throw new Error((data as any).error || "Failed to delete account");
      }

      try {
        queryClient.clear();
        sessionStorage.clear();
        // Supabase auth tokens live in localStorage; clearing them ends the session.
        localStorage.clear();
      } catch {
        // best effort
      }

      await signOut().catch(() => {});
      toast.success("Your account has been permanently deleted.");
      window.location.assign("/login");
    } catch (err: any) {
      const message = err?.message || "Failed to delete account";
      console.error("Settings delete: failed", { message, err });
      setDeleteError(message);
      toast.error(message);
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Delete Account"
      icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
      description="Permanently delete your account and all associated data."
      hideActionBar
      collapsible={false}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          This permanently deletes your account and all financial data. This cannot be undone.
        </p>
        <Button
          variant="destructive"
          data-testid="settings-delete-account-button"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          Delete Account
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
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account and all associated financial data. This cannot
              be undone. To use PaycheckMD again, you will need to create a new account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
            <Input
              id="delete-confirm"
              data-testid="settings-delete-account-confirm-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </div>
          {deleteError && (
            <p className="text-sm text-destructive" role="alert" data-testid="delete-error">
              {deleteError}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
              data-testid="settings-delete-account-cancel-button"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={busy || confirmText.trim() !== "DELETE"}
              data-testid="settings-delete-account-confirm-button"
              aria-busy={busy}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Permanently Delete Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

export default DangerZoneSection;
