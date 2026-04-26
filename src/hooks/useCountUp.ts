import { useEffect, useRef, useState } from "react";

/**
 * Animate a numeric value from 0 (or previous) up to `target` using rAF.
 * Defaults to 900ms ease-out. Returns the current animated value.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const currentRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const from = currentRef.current;
    const to = Number.isFinite(target) ? target : 0;
    const duration = Math.max(0, durationMs);

    if (duration === 0 || Math.abs(to - from) < 0.001) {
      currentRef.current = to;
      setValue(to);
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      currentRef.current = next;
      setValue(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else {
        currentRef.current = to;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, durationMs]);

  return value;
}

export const useAnimatedNumber = useCountUp;
