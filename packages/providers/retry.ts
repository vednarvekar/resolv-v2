import { ProviderError } from "../core/errors.js";

const TRANSIENT_ERROR_PATTERNS = [
  /fetch failed/i,
  /cannot reach/i,
  /request timed out/i,
  /timeout/i,
  /enotfound/i,
  /econnreset/i,
  /econnrefused/i,
  /eai_again/i,
  /etimedout/i,
  /socket hang up/i,
];

export function isTransientProviderError(err: unknown): boolean {
  if (err instanceof ProviderError) {
    if (typeof err.statusCode === "number" && err.statusCode >= 500) return true;
    return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(err.message));
  }

  if (err instanceof Error) {
    return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(err.message));
  }

  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(String(err)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryTransientProviderOperation<T>(
  operation: () => Promise<T>,
  options?: { retries?: number; delayMs?: number; onRetry?: (attempt: number, err: Error) => void },
): Promise<T> {
  const retries = options?.retries ?? 1;
  const delayMs = options?.delayMs ?? 1000;
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (err) {
      attempt++;
      const error = err instanceof Error ? err : new Error(String(err));
      if (attempt > retries || !isTransientProviderError(error)) {
        throw error;
      }
      options?.onRetry?.(attempt, error);
      await delay(delayMs * attempt);
    }
  }
}
