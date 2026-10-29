"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/service";

/** Marks a notification read and opens what it is about. */
export async function openNotificationAction(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/notifications");
  }

  const id = formData.get("notificationId");
  const db = getDatabase();
  let destination = "/app/notifications";

  if (typeof id === "string") {
    await markNotificationRead(db, profile, id);
    // Resolve the link from the stored notification, never from the form.
    const item = (await listNotifications(db, profile, { limit: 200 })).find(
      (notification) => notification.id === id,
    );
    if (item?.linkPath) {
      destination = item.linkPath;
    }
  }

  revalidatePath("/app", "layout");
  redirect(destination);
}

export async function markAllReadAction(): Promise<void> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/notifications");
  }

  await markAllNotificationsRead(getDatabase(), profile);
  revalidatePath("/app", "layout");
  redirect("/app/notifications");
}
