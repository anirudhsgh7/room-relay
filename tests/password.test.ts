import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(
      true,
    );
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("demo-manager-2026");
    await expect(verifyPassword("demo-manager-2027", hash)).resolves.toBe(false);
  });

  it("uses a unique salt for each hash", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");

    expect(first).not.toBe(second);
    await expect(verifyPassword("same-password", first)).resolves.toBe(true);
    await expect(verifyPassword("same-password", second)).resolves.toBe(true);
  });

  it("fails closed for malformed stored hashes", async () => {
    for (const malformed of [
      "",
      "plain-text-password",
      "md5$abc$def",
      "scrypt$not-base64!$also-not-base64!",
      "scrypt$$",
      "scrypt$AAAA$AAAA",
    ]) {
      await expect(verifyPassword("anything", malformed)).resolves.toBe(false);
    }
  });
});
