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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function DangerZoneSection() {
  const queryClient = useQueryClient();
  const { session, signOut } = useAuth();
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
      const sessionData = session
        ? { session }
        : (await withTimeout(
            supabase.auth.getSession(),
            5_000,
            "Could not confirm your login session. Please refresh and try again.",
          )).data;
      const sessErr = session ? null : null;
      if (sessErr || !sessionData.session) {
        throw new Error("You must be logged in.");
      }
      const accessToken = sessionData.session.access_token;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      let response: Response;
      try {
        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/account-cleanup`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ action: "delete" }),
            signal: controller.signal,
          },
        );
      } catch (fetchErr: any) {
        if (fetchErr?.name === "AbortError") {
          throw new Error("Account deletion timed out before the delete service responded. Please try again.");
        }
        throw new Error("Could not reach the delete service. Check your connection and try again.");
      } finally {
        clearTimeout(timeoutId);
      }

      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok || (payload && payload.ok === false)) {
        const failedAt = payload?.failedStep
          ? ` Failed at ${payload.failedStep}${payload.failedTable ? ` (${payload.failedTable})` : ""}.`
          : "";
        const detail =
          payload?.detail || payload?.error || `Failed to delete account (status ${response.status})`;
        console.error("account-cleanup delete failed", { status: response.status, payload });
        throw new Error(`${detail}${failedAt}`);
      }

      try {
        queryClient.clear();
        sessionStorage.clear();
        // Supabase auth tokens live in localStorage; clearing them ends the session.
        localStorage.clear();
      } catch {
        // best effort
      }

      await withTimeout(signOut().catch(() => {}), 2_000, "Sign out timed out.").catch(() => {});
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
          type="button"
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
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
              data-testid="settings-delete-account-cancel-button"
            >
              Cancel
            </Button>
            <Button
              type="button"
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
