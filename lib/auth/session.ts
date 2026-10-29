import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth/token";
import { getDatabase } from "@/lib/db/client";

export async function establishSession(userId: string): Promise<void> {
  const token = await createSessionToken(userId);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
}

export async function getAuthenticatedProfile(): Promise<UserProfile | null> {
  const cookieStore = await cookies();
  const claims = await verifySessionToken(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );

  if (!claims) {
    return null;
  }

  return await getProfileById(getDatabase(), claims.subject);
}

export const getCurrentProfile = cache(
  async (): Promise<UserProfile | null> => getAuthenticatedProfile(),
);

export async function requireCurrentProfile(): Promise<UserProfile> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  return profile;
}

export async function redirectIfAuthenticated(): Promise<void> {
  const profile = await getCurrentProfile();

  if (profile) {
    redirect("/app");
  }
}
