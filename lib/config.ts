import path from "node:path";

export const DEFAULT_CAMPUS_TIMEZONE = "Europe/London";
export const DEFAULT_DATABASE_PATH = "./data/room-relay.db";

export function getDatabasePath(): string {
  const configured = process.env.ROOMRELAY_DB_PATH?.trim() || DEFAULT_DATABASE_PATH;

  if (configured === ":memory:") {
    return configured;
  }

  return path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
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
  databasePathConfigured: boolean;
  sessionSecretConfigured: boolean;
  campusTimezone: string;
} {
  const secret = process.env.ROOMRELAY_SESSION_SECRET?.trim();

  return {
    databasePathConfigured: Boolean(
      process.env.ROOMRELAY_DB_PATH?.trim() || DEFAULT_DATABASE_PATH,
    ),
    sessionSecretConfigured: Boolean(secret && secret.length >= 32),
    campusTimezone: getCampusTimezone(),
  };
}
