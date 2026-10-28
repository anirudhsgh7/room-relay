import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const ALGORITHM = "scrypt";

/**
 * Hashes a password using Node's scrypt implementation.
 *
 * Stored format: scrypt$<base64url salt>$<base64url derived key>
 * The salt is unique per password. No pepper is used because the value is
 * already server-side and never exposed to clients.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("A non-empty password is required.");
  }

  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return `${ALGORITHM}$${salt.toString("base64url")}$${derivedKey.toString(
    "base64url",
  )}`;
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (typeof password !== "string" || typeof encodedHash !== "string") {
    return false;
  }

  const parts = encodedHash.split("$");
  if (parts.length !== 3 || parts[0] !== ALGORITHM) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;

  try {
    salt = Buffer.from(parts[1], "base64url");
    expected = Buffer.from(parts[2], "base64url");
  } catch {
    return false;
  }

  if (salt.length !== 16 || expected.length !== KEY_LENGTH) {
    return false;
  }

  const actual = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
