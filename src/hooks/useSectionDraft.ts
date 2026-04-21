import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Manages a local draft of a section's editable values, decoupled from the
 * server/source-of-truth. Tracks dirty state, supports cancel/reset, and
 * exposes a save handler that delegates persistence to the caller.
 *
 * Usage:
 *   const draft = useSectionDraft({
 *     source: serverValue,                          // canonical value
 *     onSave: async (next) => mutation.mutateAsync(next),
 *   });
 */
export interface UseSectionDraftOptions<T> {
  /** Canonical value (e.g. from server). When this changes and draft is clean, draft re-syncs. */
  source: T;
  /** Persist the draft. Throw to keep the user's edits and surface an error. */
  onSave: (next: T) => Promise<void> | void;
  /** Equality fn to detect dirty state. Defaults to JSON-stringify compare. */
  equals?: (a: T, b: T) => boolean;
}

export interface SectionDraft<T> {
  draft: T;
  setDraft: React.Dispatch<React.SetStateAction<T>>;
  /** Patch helper for object drafts. */
  patch: (updates: Partial<T>) => void;
  isDirty: boolean;
  isSaving: boolean;
  save: () => Promise<boolean>;
  cancel: () => void;
  /** Force-sync the draft to the latest source (use after external refetch). */
  resync: () => void;
}

const defaultEquals = <T,>(a: T, b: T) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
};

export function useSectionDraft<T>({
  source,
  onSave,
  equals = defaultEquals,
}: UseSectionDraftOptions<T>): SectionDraft<T> {
  const [draft, setDraft] = useState<T>(source);
  const [isSaving, setIsSaving] = useState(false);
  const lastSourceRef = useRef<T>(source);

  // Re-sync draft when source changes AND draft is currently equal to the
  // previous source (i.e., no in-flight user edits to clobber).
  useEffect(() => {
    const wasClean = equals(draft, lastSourceRef.current);
    lastSourceRef.current = source;
    if (wasClean) setDraft(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const isDirty = useMemo(() => !equals(draft, source), [draft, source, equals]);

  const patch = useCallback((updates: Partial<T>) => {
    setDraft((d) => ({ ...(d as object), ...(updates as object) } as T));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    try {
      await onSave(draft);
      lastSourceRef.current = draft;
      return true;
    } catch {
      // Caller is responsible for surfacing the error toast.
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [draft, onSave]);

  const cancel = useCallback(() => setDraft(source), [source]);
  const resync = useCallback(() => setDraft(source), [source]);

  return { draft, setDraft, patch, isDirty, isSaving, save, cancel, resync };
}
