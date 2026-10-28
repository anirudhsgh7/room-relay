import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { getSessionSecret } from "@/lib/config";

export const SESSION_COOKIE_NAME = "roomrelay_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export interface SessionClaims {
  subject: string;
  sessionId: string;
}

export async function createSessionToken(userId: string): Promise<string> {
  if (!userId) {
    throw new Error("A user ID is required to create a session.");
  }

  return new SignJWT({ sid: randomUUID() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer("roomrelay")
    .setAudience("roomrelay-web")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ["HS256"],
      issuer: "roomrelay",
      audience: "roomrelay-web",
    });

    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      return null;
    }

    return { subject: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
