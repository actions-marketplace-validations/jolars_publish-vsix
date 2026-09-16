import { setTimeout } from "node:timers/promises";

function isTransient(error) {
  const status = error?.statusCode ?? error?.status;
  if (status !== undefined) {
    return status === 408 || status === 429 || (status >= 500 && status < 600);
  }
  return (
    ["ECONNRESET", "ETIMEDOUT", "ESOCKETTIMEDOUT", "EAI_AGAIN"].includes(
      error?.code,
    ) ||
    /\brequest timeout\b/i.test(error?.message) ||
    /^No response from .+ for \d+ ms\.$/.test(error?.message)
  );
}

function retryAfter(error) {
  const value = error?.responseHeaders?.["retry-after"];
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

export async function retry(
  operation,
  { maxAttempts = 4, sleep = setTimeout, warn = console.warn } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransient(error)) throw error;
      const delay = Math.max(
        Math.min(15_000 * 2 ** (attempt - 1), 60_000),
        retryAfter(error),
      );
      // Fail rather than retrying before a long server-requested cooldown has elapsed.
      if (delay > 300_000) throw error;
      warn(
        `Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${delay / 1000}s.`,
      );
      await sleep(delay);
    }
  }
}
