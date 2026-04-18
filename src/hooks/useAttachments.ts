import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export const ATTACHMENT_BUCKET = "transaction-attachments";

/** Allowed MIME types for MVP. */
export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "application/pdf",
]);

/** Max file size: 15 MB. */
export const MAX_FILE_SIZE = 15 * 1024 * 1024;

/** Max attachments per transaction. */
export const MAX_ATTACHMENTS = 10;

export interface TransactionAttachment {
  id: string;
  user_id: string;
  organization_id: string | null;
  transaction_id: string;
  company_id: string | null;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  caption: string | null;
  created_at: string;
  updated_at: string;
}

function isAllowedFile(file: File): { ok: boolean; reason?: string } {
  const type = (file.type || "").toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const extAllowed = ["jpg", "jpeg", "png", "heic", "heif", "webp", "pdf"].includes(ext);
  if (!ALLOWED_MIME.has(type) && !extAllowed) {
    return { ok: false, reason: "Unsupported file type" };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, reason: `File too large (max ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB)` };
  }
  return { ok: true };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/** List attachments for a single transaction. */
export function useTransactionAttachments(transactionId: string | null | undefined) {
  return useQuery({
    queryKey: ["transaction_attachments", transactionId],
    enabled: !!transactionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaction_attachments")
        .select("*")
        .eq("transaction_id", transactionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as TransactionAttachment[];
    },
  });
}

/** Get attachment counts grouped by transaction_id (for ledger badges). */
export function useAttachmentCounts() {
  return useQuery({
    queryKey: ["transaction_attachment_counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaction_attachments")
        .select("transaction_id");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data || []) {
        const id = (row as any).transaction_id as string;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      return counts;
    },
  });
}

/** Upload one or more files for a given transaction. */
export function useUploadAttachments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      transactionId,
      companyId,
      files,
    }: {
      transactionId: string;
      companyId?: string | null;
      files: File[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();

      const inserted: TransactionAttachment[] = [];
      for (const file of files) {
        const check = isAllowedFile(file);
        if (!check.ok) {
          toast.error(`${file.name}: ${check.reason}`);
          continue;
        }
        const safeName = sanitizeFileName(file.name);
        const path = `${user.id}/${transactionId}/${Date.now()}_${safeName}`;

        const { error: upErr } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || undefined,
          });
        if (upErr) {
          toast.error(`Upload failed: ${file.name}`);
          continue;
        }

        const { data: row, error: insErr } = await supabase
          .from("transaction_attachments")
          .insert({
            user_id: user.id,
            organization_id: orgId,
            transaction_id: transactionId,
            company_id: companyId || null,
            file_path: path,
            file_name: file.name,
            file_type: file.type || null,
            file_size: file.size,
          } as any)
          .select("*")
          .single();

        if (insErr) {
          // Best-effort cleanup of orphaned storage object
          await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
          toast.error(`Save failed: ${file.name}`);
          continue;
        }
        inserted.push(row as TransactionAttachment);
      }
      return inserted;
    },
    onSuccess: (inserted, vars) => {
      qc.invalidateQueries({ queryKey: ["transaction_attachments", vars.transactionId] });
      qc.invalidateQueries({ queryKey: ["transaction_attachment_counts"] });
      if (inserted.length > 0) {
        toast.success(
          inserted.length === 1
            ? "Attachment added"
            : `${inserted.length} attachments added`,
        );
      }
    },
  });
}

/** Delete an attachment (storage object + DB row). */
export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (att: TransactionAttachment) => {
      // Try removing storage first; ignore "not found" errors.
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([att.file_path]);
      const { error } = await supabase
        .from("transaction_attachments")
        .delete()
        .eq("id", att.id);
      if (error) throw error;
      return att;
    },
    onSuccess: (att) => {
      qc.invalidateQueries({ queryKey: ["transaction_attachments", att.transaction_id] });
      qc.invalidateQueries({ queryKey: ["transaction_attachment_counts"] });
      toast.success("Attachment removed");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to remove attachment"),
  });
}

/** Update attachment caption. */
export function useUpdateAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      transactionId,
      caption,
    }: {
      id: string;
      transactionId: string;
      caption: string | null;
    }) => {
      const { error } = await supabase
        .from("transaction_attachments")
        .update({ caption } as any)
        .eq("id", id);
      if (error) throw error;
      return { id, transactionId };
    },
    onSuccess: ({ transactionId }) => {
      qc.invalidateQueries({ queryKey: ["transaction_attachments", transactionId] });
    },
  });
}

/**
 * Generate a short-lived signed URL for an attachment file path.
 * Returns null while loading or on error.
 */
export function useSignedAttachmentUrl(filePath: string | null | undefined, expiresIn = 60 * 10) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!filePath) {
      setUrl(null);
      return;
    }
    supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(filePath, expiresIn)
      .then(({ data }) => {
        if (active) setUrl(data?.signedUrl || null);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
    };
  }, [filePath, expiresIn]);
  return url;
}
