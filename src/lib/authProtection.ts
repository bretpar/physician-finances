const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a few minutes before trying again.";

export function isAuthRateLimitError(error: unknown) {
  const maybeError = error as { message?: string; status?: number; code?: string } | null;
  const message = maybeError?.message?.toLowerCase() || "";
  const code = maybeError?.code?.toLowerCase() || "";

  return (
    maybeError?.status === 429 ||
    code.includes("rate") ||
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("email rate limit")
  );
}

export function getAuthErrorMessage(error: unknown, fallback: string) {
  return isAuthRateLimitError(error) ? RATE_LIMIT_MESSAGE : fallback;
}

export function getCooldownSeconds(failedAttempts: number) {
  if (failedAttempts >= 8) return 5 * 60;
  if (failedAttempts >= 5) return 60;
  if (failedAttempts >= 3) return 15;
  return 0;
}

export type AttemptState = {
  failedAttempts: number;
  cooldownUntil: number;
};

export function readAttemptState(key: string): AttemptState {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      failedAttempts: Number(parsed.failedAttempts) || 0,
      cooldownUntil: Number(parsed.cooldownUntil) || 0,
    };
  } catch {
    return { failedAttempts: 0, cooldownUntil: 0 };
  }
}

export function saveAttemptState(key: string, state: AttemptState) {
  localStorage.setItem(key, JSON.stringify(state));
}

export function clearAttemptState(key: string) {
  localStorage.removeItem(key);
}

export function recordFailedAttempt(key: string) {
  const current = readAttemptState(key);
  const failedAttempts = current.failedAttempts + 1;
  const cooldownSeconds = getCooldownSeconds(failedAttempts);
  const next = {
    failedAttempts,
    cooldownUntil: cooldownSeconds ? Date.now() + cooldownSeconds * 1000 : 0,
  };
  saveAttemptState(key, next);
  return next;
}

export function getRemainingCooldownSeconds(cooldownUntil: number) {
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

// Future server-side signup guard: route signup through an Edge Function that can
// apply IP/email/device velocity checks, disposable-domain blocking, honeypot
// verification, and temporary abuse blocklists before creating auth users.