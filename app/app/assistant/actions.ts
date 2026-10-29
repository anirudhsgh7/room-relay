"use server";

import {
  answerAssistant,
  MAX_ASSISTANT_MESSAGE,
  type AssistantReply,
} from "@/lib/assistant/respond";
import { getCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import { consumeRateLimit } from "@/lib/rate-limit";

const LIMIT = { limit: 40, windowMs: 5 * 60 * 1000 };

/**
 * Answers one assistant message for the signed-in person. The assistant only
 * reads data this person can already see and never changes anything.
 */
export async function askAssistantAction(message: string): Promise<AssistantReply> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return {
      message: "Your session has ended. Sign in again to keep going.",
      cards: [],
      suggestions: [],
    };
  }

  if (typeof message !== "string") {
    return { message: "Type a question to get started.", cards: [], suggestions: [] };
  }

  const limit = consumeRateLimit(`assistant:${profile.id}`, LIMIT);

  if (!limit.allowed) {
    return {
      message: "That's a lot of questions in a short time. Wait a minute and try again.",
      cards: [],
      suggestions: [],
    };
  }

  try {
    return answerAssistant(getDatabase(), profile, message.slice(0, MAX_ASSISTANT_MESSAGE));
  } catch (error) {
    console.error(
      "Assistant failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      message: "Something went wrong while looking that up. Try again, or use the menu to find what you need.",
      cards: [],
      suggestions: [],
    };
  }
}
