/**
 * Tiny coordination registry so only one field picker (calendar, combobox,
 * select) can be open at a time. Presentation-only helper — no business logic.
 *
 * Each picker registers a close callback while it is mounted and calls
 * `closeOtherPickers(id)` right before it opens.
 */
type Closer = () => void;

const closers = new Map<string, Closer>();
let seq = 0;

/** Unique id for a picker instance. */
export function createPickerId(prefix = "picker"): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** Register a picker's close callback. Returns an unregister function. */
export function registerPicker(id: string, close: Closer): () => void {
  closers.set(id, close);
  return () => {
    closers.delete(id);
  };
}

/** Close every registered picker except `id` (pass nothing to close all). */
export function closeOtherPickers(id?: string): void {
  closers.forEach((close, key) => {
    if (key !== id) {
      try {
        close();
      } catch {
        /* ignore */
      }
    }
  });
}
