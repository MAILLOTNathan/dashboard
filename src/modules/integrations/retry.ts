import { parseRetryAfterSeconds } from "./adapter";

/**
 * Bounded retries for provider requests.
 *
 * A synchronisation reads dozens of URLs; a single transient blip must not fail the
 * whole run. The policy stays deliberately small and predictable:
 * - only network errors, HTTP 429, HTTP 5xx and rate-limit refusals are retried;
 * - authentication, permission and not-found answers are final;
 * - the number of attempts is capped, and so is every wait, so a manual
 *   synchronisation cannot hang on a provider quota window.
 *
 * The wrapper is installed around the injected `fetch` of one run, which keeps the
 * adapters unchanged and makes the retry count observable per run.
 */

export type RetryPolicy = {
  /** Attempts per request, including the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  /** A `Retry-After` longer than this is not waited for: the run reports the
   * provider's rate-limit refusal instead of blocking for minutes. */
  maxDelayMs: number;
  /** Fraction of the delay added or removed at random, so retries do not run in lockstep. */
  jitterRatio: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  jitterRatio: 0.2,
};

export type RetryingFetch = {
  fetchImpl: typeof fetch;
  /** Retries actually made: `0` means every request succeeded on the first try. */
  retries: () => number;
};

export function isRetryableResponse(response: Response): boolean {
  if (response.status === 429 || response.status >= 500) {
    return true;
  }

  // GitHub reports a spent quota as 403 with this header, not as 429.
  return (
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  );
}

export function createRetryingFetch(options: {
  fetchImpl: typeof fetch;
  policy?: Partial<RetryPolicy>;
  /** Injected by tests so a retry does not wait in real time. */
  sleep?: (delayMs: number) => Promise<void>;
  /** Injected by tests so the jitter is deterministic. */
  random?: () => number;
}): RetryingFetch {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.policy };
  const sleep =
    options.sleep ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;
  let used = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;

      try {
        response = await options.fetchImpl(input, init);
      } catch (error) {
        // An aborted synchronisation is a decision, not a blip: never retry it.
        if (isAbortError(error) || attempt >= policy.maxAttempts) {
          throw error;
        }

        used += 1;
        await sleep(backoffDelay(policy, attempt, random));
        continue;
      }

      if (attempt < policy.maxAttempts && isRetryableResponse(response)) {
        const statedWaitMs = statedRetryAfterMs(response);

        if (statedWaitMs !== null && statedWaitMs > policy.maxDelayMs) {
          // The provider asks for a longer pause than a manual run may take: return
          // the refusal and let the adapter report it safely.
          return response;
        }

        used += 1;
        await sleep(
          statedWaitMs ?? backoffDelay(policy, attempt, random),
        );
        continue;
      }

      return response;
    }
  };

  return { fetchImpl, retries: () => used };
}

/** The provider's own `Retry-After`, in milliseconds; `null` when it is absent. */
function statedRetryAfterMs(response: Response): number | null {
  const seconds = parseRetryAfterSeconds(response);
  return seconds === undefined ? null : seconds * 1000;
}

function backoffDelay(
  policy: RetryPolicy,
  attempt: number,
  random: () => number,
): number {
  const base = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  // Jitter around the base delay, kept non-negative.
  const jitter = base * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
