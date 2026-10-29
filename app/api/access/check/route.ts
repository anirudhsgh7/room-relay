import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { simulateAccessCheck } from "@/lib/access/service";
import { getDatabase } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (origin && host) {
    let originHost = "";

    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = "";
    }

    if (originHost !== host) {
      return json(
        {
          error: "Cross-origin access checks are not allowed.",
          reasonCode: "INVALID_REQUEST",
        },
        403,
      );
    }
  }

  const profile = await getCurrentProfile();

  if (!profile) {
    return json(
      {
        error: "Sign in to perform a simulated access check.",
        reasonCode: "ACCOUNT_INACTIVE",
      },
      401,
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        error: "The access-check request must be valid JSON.",
        reasonCode: "INVALID_REQUEST",
      },
      400,
    );
  }

  if (typeof body !== "object" || body === null) {
    return json(
      {
        error: "The access-check request is invalid.",
        reasonCode: "INVALID_REQUEST",
      },
      400,
    );
  }

  const record = body as Record<string, unknown>;
  const result = await simulateAccessCheck(getDatabase(), profile, {
    credentialId:
      typeof record.credentialId === "string" ? record.credentialId : "",
    roomId: typeof record.roomId === "string" ? record.roomId : "",
    eventNonce:
      typeof record.eventNonce === "string" ? record.eventNonce : "",
  });

  if (!result.ok) {
    return json(
      {
        error: result.error,
        reasonCode: result.reasonCode ?? "INVALID_REQUEST",
      },
      result.httpStatus,
    );
  }

  return json(result.response, result.httpStatus);
}
