export const DEFAULT_CAMPUS_TIMEZONE = "Europe/London";

/**
 * Reads an environment value and strips paired quotes. Some deployment
 * providers preserve the quotes from a pasted value, which breaks URLs and
 * secrets even though the value is otherwise correct.
 */
export function getEnvValue(name: string): string | undefined {
  const raw = process.env[name];

  if (raw === undefined) {
    return undefined;
  }

  const trimmed = raw.trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function getDatabaseUrl(): string {
  const configured =
    getEnvValue("DATABASE_URL") || getEnvValue("DATABASE_URL_UNPOOLED");

  if (!configured) {
    throw new Error(
      "DATABASE_URL is required. Run `neon env pull` or set a Postgres connection string.",
    );
  }

  return configured;
}

export function getCampusTimezone(): string {
  const timezone =
    getEnvValue("ROOMRELAY_CAMPUS_TIMEZONE") || DEFAULT_CAMPUS_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format();
  } catch {
    throw new Error(
      `ROOMRELAY_CAMPUS_TIMEZONE is not a valid IANA timezone: "${timezone}".`,
    );
  }

  return timezone;
}

export function getSessionSecret(): Uint8Array {
  const secret = getEnvValue("ROOMRELAY_SESSION_SECRET");

  if (!secret || secret.length < 32) {
    throw new Error(
      "ROOMRELAY_SESSION_SECRET is required and must contain at least 32 characters. Run `npm run db:setup` for local development.",
    );
  }

  return new TextEncoder().encode(secret);
}

export function validateRuntimeConfig(): {
  databaseConfigured: boolean;
  sessionSecretConfigured: boolean;
  campusTimezone: string;
} {
  const secret = getEnvValue("ROOMRELAY_SESSION_SECRET");

  return {
    databaseConfigured: Boolean(
      getEnvValue("DATABASE_URL") || getEnvValue("DATABASE_URL_UNPOOLED"),
    ),
    sessionSecretConfigured: Boolean(secret && secret.length >= 32),
    campusTimezone: getCampusTimezone(),
  };
}
