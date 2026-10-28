import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRateLimitsForTests,
  consumeRateLimit,
} from "@/lib/rate-limit";

describe("in-process rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
    clearRateLimitsForTests();
  });

  afterEach(() => {
    clearRateLimitsForTests();
    vi.useRealTimers();
  });

  it("allows requests up to the configured limit", () => {
    expect(
      consumeRateLimit("key-a", { limit: 2, windowMs: 60_000 }).allowed,
    ).toBe(true);
    expect(
      consumeRateLimit("key-a", { limit: 2, windowMs: 60_000 }).allowed,
    ).toBe(true);
    expect(
      consumeRateLimit("key-a", { limit: 2, windowMs: 60_000 }).allowed,
    ).toBe(false);
  });

  it("scopes counters by key", () => {
    consumeRateLimit("key-a", { limit: 1, windowMs: 60_000 });
    expect(
      consumeRateLimit("key-a", { limit: 1, windowMs: 60_000 }).allowed,
    ).toBe(false);
    expect(
      consumeRateLimit("key-b", { limit: 1, windowMs: 60_000 }).allowed,
    ).toBe(true);
  });

  it("resets after the window expires", () => {
    consumeRateLimit("key-a", { limit: 1, windowMs: 1_000 });
    vi.advanceTimersByTime(1_001);

    expect(
      consumeRateLimit("key-a", { limit: 1, windowMs: 1_000 }).allowed,
    ).toBe(true);
  });
});
