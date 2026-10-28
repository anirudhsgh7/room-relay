"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateWithPassword, type UserProfile } from "@/lib/auth/service";
import { establishSession } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { getDatabase } from "@/lib/db/client";
import { consumeRateLimit } from "@/lib/rate-limit";

export interface LoginState {
  error?: string;
  email?: string;
}

type SignInFailure = {
  code: "invalid" | "rate_limited" | "unavailable";
  error: string;
};

type SignInResult = SignInFailure | { profile: UserProfile };

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(254)
    .email("Enter a valid email address."),
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(256, "That password is too long."),
});

async function rateLimitKey(): Promise<string> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const address =
    forwardedFor?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "local";

  return createHash("sha256").update(`login:${address}`).digest("hex");
}

async function attemptSignIn(
  email: string,
  password: string,
): Promise<SignInResult> {
  const limit = consumeRateLimit(await rateLimitKey(), {
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });

  if (!limit.allowed) {
    return {
      code: "rate_limited",
      error: "Too many sign-in attempts. Wait a few minutes and try again.",
    };
  }

  try {
    const profile = await authenticateWithPassword(
      getDatabase(),
      email,
      password,
    );

    if (!profile) {
      return {
        code: "invalid",
        error: "Email or password is incorrect.",
      };
    }

    await establishSession(profile.id);
    return { profile };
  } catch (error) {
    console.error(
      "Sign-in unavailable:",
      error instanceof Error ? error.message : "unknown server error",
    );

    return {
      code: "unavailable",
      error: "Sign-in is temporarily unavailable. Please try again.",
    };
  }
}

export async function authenticateAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const submittedEmail =
    typeof formData.get("email") === "string"
      ? String(formData.get("email"))
      : undefined;

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Check your email address and password.",
      email: submittedEmail,
    };
  }

  const result = await attemptSignIn(parsed.data.email, parsed.data.password);

  if ("error" in result) {
    return { error: result.error, email: parsed.data.email };
  }

  redirect(safeNextPath(formData.get("next")));
}

function quickSignInErrorCode(code: SignInFailure["code"]): string {
  switch (code) {
    case "rate_limited":
      return "rate-limit";
    case "unavailable":
      return "unavailable";
    case "invalid":
      return "invalid";
  }
}

export async function quickSignInAction(formData: FormData): Promise<void> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid");
  }

  const result = await attemptSignIn(parsed.data.email, parsed.data.password);

  if ("error" in result) {
    redirect(`/login?error=${quickSignInErrorCode(result.code)}`);
  }

  redirect(safeNextPath(formData.get("next")));
}
