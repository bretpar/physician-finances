import { useRef, useState } from "react";
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
  /** Transaction id. When null, show "save first" empty state. */
  transactionId: string | null;
  /** Optional company id for future audit/export grouping. */
  companyId?: string | null;
  /** Optional label override. Defaults to "Attachments". */
  label?: string;
}

export function TransactionAttachments({
  transactionId,
  companyId,
  label = "Attachments",
}: TransactionAttachmentsProps) {
  const { data: attachments = [], isLoading } = useTransactionAttachments(transactionId);
  const upload = useUploadAttachments();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [previewing, setPreviewing] = useState<TransactionAttachment | null>(null);

  const atLimit = attachments.length >= MAX_ATTACHMENTS;
  const remaining = MAX_ATTACHMENTS - attachments.length;
  const disabled = !transactionId || upload.isPending || atLimit;

  const handleFiles = (files: FileList | null) => {
    if (!files || !transactionId) return;
    const arr = Array.from(files).slice(0, remaining);
    if (arr.length === 0) return;
    upload.mutate({ transactionId, companyId, files: arr });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {label}
            {attachments.length > 0 && (
              <span className="ml-1 text-muted-foreground/70">({attachments.length})</span>
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
      {!transactionId ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-[11px] text-muted-foreground">
          Save the transaction first to attach receipts or files.
        </div>
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

      {atLimit && transactionId && (
        <p className="text-[10px] text-muted-foreground italic">
          Max {MAX_ATTACHMENTS} attachments per transaction.
        </p>
      )}

      <PreviewDialog
        attachment={previewing}
        onClose={() => setPreviewing(null)}
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

/* ─────────── Preview dialog ─────────── */

function PreviewDialog({
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
