import { useEffect, useRef, useState } from "react";
import { Paperclip, Upload, Camera, FileText, X, Loader2, ExternalLink, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  ALLOWED_MIME,
  MAX_ATTACHMENTS,
  useDeleteAttachment,
  useSignedAttachmentUrl,
  useTransactionAttachments,
  useUpdateAttachment,
  useUploadAttachments,
  type TransactionAttachment,
} from "@/hooks/useAttachments";
import { cn } from "@/lib/utils";

const ACCEPT = Array.from(ALLOWED_MIME).join(",") + ",.heic,.heif";

interface TransactionAttachmentsProps {
  /** Transaction id. When null + pendingFiles props provided, files stage locally until parent saves. */
  transactionId: string | null;
  /** Optional company id for future audit/export grouping. */
  companyId?: string | null;
  /** Optional label override. Defaults to "Attachments". */
  label?: string;
  /** Locally staged files (only used when transactionId is null). */
  pendingFiles?: File[];
  /** Callback when staged files change (only used when transactionId is null). */
  onPendingFilesChange?: (files: File[]) => void;
}

export function TransactionAttachments({
  transactionId,
  companyId,
  label = "Attachments",
  pendingFiles,
  onPendingFilesChange,
}: TransactionAttachmentsProps) {
  const { data: attachments = [], isLoading } = useTransactionAttachments(transactionId);
  const upload = useUploadAttachments();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [previewing, setPreviewing] = useState<TransactionAttachment | null>(null);
  const [previewingPending, setPreviewingPending] = useState<File | null>(null);

  const canStage = !transactionId && !!onPendingFilesChange;
  const stagedCount = pendingFiles?.length ?? 0;
  const totalCount = transactionId ? attachments.length : stagedCount;
  const atLimit = totalCount >= MAX_ATTACHMENTS;
  const remaining = MAX_ATTACHMENTS - totalCount;
  const disabled = (!transactionId && !canStage) || upload.isPending || atLimit;

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, remaining);
    if (arr.length === 0) return;
    if (transactionId) {
      upload.mutate({ transactionId, companyId, files: arr });
    } else if (canStage) {
      onPendingFilesChange!([...(pendingFiles ?? []), ...arr]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  const removePending = (idx: number) => {
    if (!canStage) return;
    const next = [...(pendingFiles ?? [])];
    next.splice(idx, 1);
    onPendingFilesChange!(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {label}
            {totalCount > 0 && (
              <span className="ml-1 text-muted-foreground/70">({totalCount})</span>
            )}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={disabled}
            >
              {upload.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              Add Photo / File
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
              <Camera className="h-4 w-4 mr-2" /> Take Photo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Choose from Library
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <FileText className="h-4 w-4 mr-2" /> Choose File / Screenshot
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Empty / loading / list */}
      {!transactionId && !canStage ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-[11px] text-muted-foreground">
          Save the transaction first to attach receipts or files.
        </div>
      ) : !transactionId && canStage ? (
        stagedCount === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-[11px] text-muted-foreground">
            Add a receipt now — it'll upload when you save.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {pendingFiles!.map((file, idx) => (
              <PendingRow
                key={`${file.name}-${idx}`}
                file={file}
                onPreview={() => setPreviewingPending(file)}
                onRemove={() => removePending(idx)}
              />
            ))}
            <p className="text-[10px] text-muted-foreground italic">
              Receipts will upload after you save.
            </p>
          </ul>
        )
      ) : isLoading ? (
        <div className="text-[11px] text-muted-foreground px-1">Loading attachments…</div>
      ) : attachments.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-[11px] text-muted-foreground">
          Add receipt, screenshot, invoice, PDF, or other supporting document.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} onPreview={() => setPreviewing(a)} />
          ))}
        </ul>
      )}

      {atLimit && (
        <p className="text-[10px] text-muted-foreground italic">
          Max {MAX_ATTACHMENTS} attachments per transaction.
        </p>
      )}

      <PreviewDialog
        attachment={previewing}
        onClose={() => setPreviewing(null)}
      />
      <PendingPreviewDialog
        file={previewingPending}
        onClose={() => setPreviewingPending(null)}
      />
    </div>
  );
}

/* ─────────── Single attachment row ─────────── */

function AttachmentRow({
  attachment,
  onPreview,
}: {
  attachment: TransactionAttachment;
  onPreview: () => void;
}) {
  const url = useSignedAttachmentUrl(attachment.file_path);
  const update = useUpdateAttachment();
  const del = useDeleteAttachment();
  const [caption, setCaption] = useState(attachment.caption || "");
  const [editingCaption, setEditingCaption] = useState(false);

  const isImage = (attachment.file_type || "").startsWith("image/") ||
    /\.(jpe?g|png|heic|heif|webp)$/i.test(attachment.file_name);
  const isPdf = attachment.file_type === "application/pdf" ||
    /\.pdf$/i.test(attachment.file_name);

  const saveCaption = () => {
    setEditingCaption(false);
    if ((caption || "") === (attachment.caption || "")) return;
    update.mutate({
      id: attachment.id,
      transactionId: attachment.transaction_id,
      caption: caption.trim() || null,
    });
  };

  return (
    <li className="flex items-center gap-2.5 rounded-md border border-border bg-card px-2 py-2">
      {/* Thumbnail / icon */}
      <button
        type="button"
        onClick={onPreview}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted",
          isImage && "p-0",
        )}
        aria-label="Preview"
      >
        {isImage && url ? (
          <img
            src={url}
            alt={attachment.file_name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : isPdf ? (
          <FileText className="h-5 w-5 text-destructive" />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground" />
        )}
      </button>

      {/* Filename + caption */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onPreview}
          className="truncate text-xs font-medium text-foreground hover:underline text-left w-full"
          title={attachment.file_name}
        >
          {attachment.file_name}
        </button>
        {editingCaption ? (
          <Input
            autoFocus
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={saveCaption}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCaption();
              if (e.key === "Escape") {
                setCaption(attachment.caption || "");
                setEditingCaption(false);
              }
            }}
            placeholder="Add caption (e.g. Receipt)"
            className="mt-0.5 h-6 text-[11px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingCaption(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {attachment.caption || "+ Add caption"}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          type="button"
          onClick={() => {
            if (confirm("Remove this attachment?")) del.mutate(attachment);
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Remove attachment"
          disabled={del.isPending}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

/* ─────────── Pending (pre-save) row ─────────── */

function PendingRow({
  file,
  onPreview,
  onRemove,
}: {
  file: File;
  onPreview: () => void;
  onRemove: () => void;
}) {
  const isImage = (file.type || "").startsWith("image/") ||
    /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const u = URL.createObjectURL(file);
    setThumb(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);

  return (
    <li className="flex items-center gap-2.5 rounded-md border border-dashed border-border bg-muted/10 px-2 py-2">
      <button
        type="button"
        onClick={onPreview}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted",
          isImage && "p-0",
        )}
        aria-label="Preview pending attachment"
      >
        {isImage && thumb ? (
          <img src={thumb} alt={file.name} className="h-full w-full object-cover" />
        ) : isPdf ? (
          <FileText className="h-5 w-5 text-destructive" />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground" title={file.name}>
          {file.name}
        </p>
        <p className="text-[10px] text-muted-foreground italic">Will upload on save</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label="Remove pending attachment"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/* ─────────── Preview dialog (saved attachments) ─────────── */

export function PreviewDialog({
  attachment,
  onClose,
}: {
  attachment: TransactionAttachment | null;
  onClose: () => void;
}) {
  const url = useSignedAttachmentUrl(attachment?.file_path);
  if (!attachment) return null;
  const isImage = (attachment.file_type || "").startsWith("image/") ||
    /\.(jpe?g|png|heic|heif|webp)$/i.test(attachment.file_name);
  const isPdf = attachment.file_type === "application/pdf" ||
    /\.pdf$/i.test(attachment.file_name);

  return (
    <Dialog open={!!attachment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{attachment.file_name}</p>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" /> Open
              </a>
            )}
          </div>
          <div className="rounded-md border border-border bg-muted/40 overflow-hidden flex items-center justify-center min-h-[300px]">
            {!url ? (
              <div className="py-12 text-xs text-muted-foreground">Loading…</div>
            ) : isImage ? (
              <img src={url} alt={attachment.file_name} className="max-h-[70vh] object-contain" />
            ) : isPdf ? (
              <iframe src={url} className="h-[70vh] w-full" title={attachment.file_name} />
            ) : (
              <a href={url} target="_blank" rel="noreferrer" className="text-sm text-primary py-12">
                Open file
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Pending preview dialog (local Files) ─────────── */

function PendingPreviewDialog({ file, onClose }: { file: File | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!file) return null;
  const isImage = (file.type || "").startsWith("image/") ||
    /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <div className="space-y-2">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <div className="rounded-md border border-border bg-muted/40 overflow-hidden flex items-center justify-center min-h-[300px]">
            {!url ? (
              <div className="py-12 text-xs text-muted-foreground">Loading…</div>
            ) : isImage ? (
              <img src={url} alt={file.name} className="max-h-[70vh] object-contain" />
            ) : isPdf ? (
              <iframe src={url} className="h-[70vh] w-full" title={file.name} />
            ) : (
              <p className="text-xs text-muted-foreground py-12">No preview available</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Mobile in-ledger viewer ─────────── */

/**
 * Lightweight viewer for tapping "View Receipt" in the ledger.
 * Loads attachments for the transaction and shows the first one
 * (with a list to switch if multiple).
 */
export function MobileAttachmentViewer({
  transactionId,
  open,
  onClose,
}: {
  transactionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: attachments = [], isLoading } = useTransactionAttachments(
    open ? transactionId : null,
  );
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (open) setActiveIdx(0);
  }, [open, transactionId]);

  const active = attachments[activeIdx];
  const url = useSignedAttachmentUrl(active?.file_path);
  const isImage = active
    ? (active.file_type || "").startsWith("image/") ||
      /\.(jpe?g|png|heic|heif|webp)$/i.test(active.file_name)
    : false;
  const isPdf = active
    ? active.file_type === "application/pdf" || /\.pdf$/i.test(active.file_name)
    : false;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <div className="space-y-2">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-muted-foreground">Loading…</div>
          ) : attachments.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No attachments on this transaction.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{active?.file_name}</p>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" /> Open
                  </a>
                )}
              </div>
              <div className="rounded-md border border-border bg-muted/40 overflow-hidden flex items-center justify-center min-h-[300px]">
                {!url ? (
                  <div className="py-12 text-xs text-muted-foreground">Loading…</div>
                ) : isImage ? (
                  <img
                    src={url}
                    alt={active!.file_name}
                    className="max-h-[70vh] object-contain"
                  />
                ) : isPdf ? (
                  <iframe
                    src={url}
                    className="h-[70vh] w-full"
                    title={active!.file_name}
                  />
                ) : (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary py-12"
                  >
                    Open file
                  </a>
                )}
              </div>
              {attachments.length > 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {attachments.map((a, i) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setActiveIdx(i)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px]",
                        i === activeIdx
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
