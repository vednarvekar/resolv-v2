import type { ProviderChatOptions, ProviderResponse } from "../core/types.js";
import type { Provider } from "../providers/provider.js";
import { isTransientProviderError } from "../providers/retry.js";

export interface ChatRetryOptions {
  retries?: number;
  delayMs?: number;
  onAttempt?: (attempt: number) => void;
  onRetry?: (attempt: number, err: Error) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function chatWithTransientRetries(
  provider: Provider,
  options: ProviderChatOptions & { model?: string },
  retryOptions?: ChatRetryOptions,
): Promise<ProviderResponse> {
  const retries = retryOptions?.retries ?? 2;
  const delayMs = retryOptions?.delayMs ?? 1000;

  let attempt = 0;
  while (true) {
    retryOptions?.onAttempt?.(attempt + 1);

    let streamedText = false;
    try {
      return await provider.chat({
        ...options,
        onTextDelta: (text) => {
          if (!text) return;
          streamedText = true;
          options.onTextDelta?.(text);
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (streamedText || attempt >= retries || !isTransientProviderError(error)) {
        throw error;
      }

      attempt++;
      retryOptions?.onRetry?.(attempt, error);
      await delay(delayMs * attempt);
    }
  }
}
