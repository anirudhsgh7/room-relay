import type { RoomRelayDatabase } from "@/lib/db/client";
import type { ProfileStatus, Role } from "@/lib/domain";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: ProfileStatus;
  createdAt: string;
  updatedAt: string;
}

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: ProfileStatus;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

interface PublicProfileRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
}

function toProfile(row: PublicProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let dummyHashPromise: Promise<string> | undefined;

async function burnPasswordComparison(password: string): Promise<void> {
  // A valid scrypt hash of a value nobody can sign in with. This keeps the
  // no-such-email path roughly as expensive as the wrong-password path.
  dummyHashPromise ??= hashPassword("roomrelay-invalid-account-placeholder");
  const dummyHash = await dummyHashPromise;
  await verifyPassword(password, dummyHash);
}

export async function authenticateWithPassword(
  db: RoomRelayDatabase,
  email: string,
  password: string,
): Promise<UserProfile | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const row = db
    .prepare(
      `SELECT id, email, display_name, role, status, password_hash, created_at, updated_at
       FROM profiles
       WHERE email = ? COLLATE NOCASE`,
    )
    .get(normalizedEmail) as ProfileRow | undefined;

  if (!row) {
    await burnPasswordComparison(password);
    return null;
  }

  const passwordMatches = await verifyPassword(password, row.password_hash);

  if (!passwordMatches || row.status !== "active") {
    return null;
  }

  return toProfile(row);
}

export function getProfileById(
  db: RoomRelayDatabase,
  userId: string,
): UserProfile | null {
  const row = db
    .prepare(
      `SELECT id, email, display_name, role, status, created_at, updated_at
       FROM profiles
       WHERE id = ?`,
    )
    .get(userId) as PublicProfileRow | undefined;

  if (!row || row.status !== "active") {
    return null;
  }

  return toProfile(row);
}
