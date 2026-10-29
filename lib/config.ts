export const DEFAULT_CAMPUS_TIMEZONE = "Europe/London";

export function getDatabaseUrl(): string {
  const configured =
    process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim();

  if (!configured) {
    throw new Error(
      "DATABASE_URL is required. Run `neon env pull` or set a Postgres connection string.",
    );
  }

  return configured;
}

export function getCampusTimezone(): string {
  const timezone =
    process.env.ROOMRELAY_CAMPUS_TIMEZONE?.trim() || DEFAULT_CAMPUS_TIMEZONE;

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
  const secret = process.env.ROOMRELAY_SESSION_SECRET?.trim();

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
  const secret = process.env.ROOMRELAY_SESSION_SECRET?.trim();

  return {
    databaseConfigured: Boolean(
      process.env.DATABASE_URL?.trim() ||
        process.env.DATABASE_URL_UNPOOLED?.trim(),
    ),
    sessionSecretConfigured: Boolean(secret && secret.length >= 32),
    campusTimezone: getCampusTimezone(),
  };
}
