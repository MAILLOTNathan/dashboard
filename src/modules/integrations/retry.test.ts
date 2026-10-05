import { describe, expect, it, vi } from "vitest";
import {
  createRetryingFetch,
  DEFAULT_RETRY_POLICY,
  isRetryableResponse,
} from "./retry";

/**
 * The retry wrapper is tested with a fake `fetch` and an instant `sleep`: no test
 * waits in real time, and no test reaches the network.
 */

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status >= 400 ? "error" : "{}", { status, headers });
}

function createHarness(handler: (call: number) => Response) {
  let calls = 0;
  const innerFetch = vi.fn(async () => {
    calls += 1;
    return handler(calls);
  });
  const waits: number[] = [];
  const retrying = createRetryingFetch({
    fetchImpl: innerFetch as unknown as typeof fetch,
    sleep: async (delayMs) => {
      waits.push(delayMs);
    },
    // Neutral jitter: random * 2 - 1 === 0, so waits are the plain backoff.
    random: () => 0.5,
  });

  return { callCount: () => calls, retrying, waits };
}

describe("isRetryableResponse", () => {
  it("retries rate limits and server errors only", () => {
    expect(isRetryableResponse(response(429))).toBe(true);
    expect(isRetryableResponse(response(500))).toBe(true);
    expect(isRetryableResponse(response(503))).toBe(true);
    expect(isRetryableResponse(response(401))).toBe(false);
    expect(isRetryableResponse(response(404))).toBe(false);
    expect(isRetryableResponse(response(403))).toBe(false);
    // GitHub reports a spent quota as 403 with this header, not as 429.
    expect(isRetryableResponse(response(403, { "x-ratelimit-remaining": "0" }))).toBe(
      true,
    );
  });
});

describe("createRetryingFetch", () => {
  it("returns the first response without retrying when it succeeds", async () => {
    const { callCount, retrying } = createHarness(() => response(200));

    const result = await retrying.fetchImpl("https://example.test");

    expect(result.status).toBe(200);
    expect(callCount()).toBe(1);
    expect(retrying.retries()).toBe(0);
  });

  it("retries a transient network error and succeeds on a later attempt", async () => {
    const { callCount, retrying, waits } = createHarness((call) => {
      if (call === 1) {
        throw new TypeError("fetch failed");
      }
      return response(200);
    });

    const result = await retrying.fetchImpl("https://example.test");

    expect(result.status).toBe(200);
    expect(callCount()).toBe(2);
    expect(retrying.retries()).toBe(1);
    // Default backoff: 500 ms, neutral jitter.
    expect(waits).toEqual([500]);
  });

  it("gives up after the attempt cap on repeated server errors", async () => {
    const { callCount, retrying } = createHarness(() => response(500));

    const result = await retrying.fetchImpl("https://example.test");

    // The refusal is returned so the adapter classifies it safely; it is never hidden.
    expect(result.status).toBe(500);
    expect(callCount()).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    expect(retrying.retries()).toBe(DEFAULT_RETRY_POLICY.maxAttempts - 1);
  });

  it("waits the provider's Retry-After instead of the backoff", async () => {
    const { retrying, waits } = createHarness((call) =>
      call === 1 ? response(429, { "retry-after": "2" }) : response(200),
    );

    const result = await retrying.fetchImpl("https://example.test");

    expect(result.status).toBe(200);
    expect(waits).toEqual([2000]);
    expect(retrying.retries()).toBe(1);
  });

  it("does not retry when Retry-After exceeds the wait cap", async () => {
    const { callCount, retrying } = createHarness(() =>
      response(429, { "retry-after": "3600" }),
    );

    const result = await retrying.fetchImpl("https://example.test");

    expect(result.status).toBe(429);
    expect(callCount()).toBe(1);
    expect(retrying.retries()).toBe(0);
  });

  it("never retries authentication or not-found refusals", async () => {
    for (const status of [401, 404]) {
      const { callCount, retrying } = createHarness(() => response(status));

      const result = await retrying.fetchImpl("https://example.test");

      expect(result.status).toBe(status);
      expect(callCount()).toBe(1);
      expect(retrying.retries()).toBe(0);
    }
  });

  it("never retries an aborted request", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const { callCount, retrying } = createHarness(() => {
      throw abort;
    });

    await expect(retrying.fetchImpl("https://example.test")).rejects.toBe(abort);
    expect(callCount()).toBe(1);
    expect(retrying.retries()).toBe(0);
  });
});
