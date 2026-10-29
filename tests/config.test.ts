import { afterEach, describe, expect, it, vi } from "vitest";
import { getDatabaseUrl, getEnvValue } from "@/lib/config";

describe("environment configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("strips paired quotes from pasted environment values", () => {
    vi.stubEnv("DATABASE_URL", '"postgresql://user:pass@example.test/db"');

    expect(getEnvValue("DATABASE_URL")).toBe(
      "postgresql://user:pass@example.test/db",
    );
    expect(getDatabaseUrl()).toBe("postgresql://user:pass@example.test/db");
  });

  it("leaves ordinary values unchanged", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@example.test/db");

    expect(getEnvValue("DATABASE_URL")).toBe(
      "postgresql://user:pass@example.test/db",
    );
  });

  it("falls back to the direct connection URL", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv(
      "DATABASE_URL_UNPOOLED",
      "postgresql://user:pass@direct.example.test/db",
    );

    expect(getDatabaseUrl()).toBe(
      "postgresql://user:pass@direct.example.test/db",
    );
  });
});
