import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth/token";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session tokens", () => {
  it("creates and verifies a server-signed session", async () => {
    const token = await createSessionToken("usr_test_account");
    const claims = await verifySessionToken(token);

    expect(claims).not.toBeNull();
    expect(claims?.subject).toBe("usr_test_account");
    expect(claims?.sessionId).toEqual(expect.any(String));
  });

  it("rejects missing and malformed tokens", async () => {
    await expect(verifySessionToken(undefined)).resolves.toBeNull();
    await expect(verifySessionToken("")).resolves.toBeNull();
    await expect(verifySessionToken("not-a-jwt")).resolves.toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken("usr_test_account");
    const [header, payload, signature] = token.split(".");
    const tampered = `${header}.${payload}.${signature?.slice(0, -2)}xx`;

    await expect(verifySessionToken(tampered)).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken("usr_test_account");
    vi.stubEnv(
      "ROOMRELAY_SESSION_SECRET",
      "a-different-test-secret-that-is-long-enough-to-sign-tokens",
    );

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("uses hardened cookie defaults", () => {
    expect(SESSION_COOKIE_NAME).toBe("roomrelay_session");
    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  });
});
