import { z } from "zod";

export const accessCheckSchema = z.object({
  credentialId: z.string().trim().min(1).max(120),
  roomId: z.string().trim().min(1).max(120),
  eventNonce: z.uuid("Refresh the access check and try again."),
});

export type AccessCheckInput = z.input<typeof accessCheckSchema>;
