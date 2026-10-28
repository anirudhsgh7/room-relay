import { z } from "zod";

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const localTimePattern = /^\d{2}:\d{2}$/;

export const bookingRequestSubmissionSchema = z.object({
  roomCode: z.string().trim().min(1).max(40),
  startDate: z
    .string()
    .trim()
    .regex(localDatePattern, "Enter a valid date."),
  startTime: z
    .string()
    .trim()
    .regex(localTimePattern, "Enter a valid start time."),
  endTime: z.string().trim().regex(localTimePattern, "Enter a valid end time."),
  purpose: z
    .string()
    .trim()
    .min(10, "Describe the purpose in at least 10 characters.")
    .max(500, "Keep the purpose under 500 characters."),
  groupName: z
    .string()
    .trim()
    .max(80, "Keep the group name under 80 characters.")
    .transform((value) => value || null),
  expectedAttendance: z.coerce
    .number()
    .int("Attendance must be a whole number.")
    .min(1, "Attendance must be at least 1.")
    .max(10_000, "Attendance must be 10,000 or fewer."),
  acknowledgement: z
    .string()
    .refine((value) => value === "on", {
      message: "Confirm that you understand the request is not approved access.",
    }),
  idempotencyKey: z.uuid("Refresh the form and try again."),
});

export type BookingRequestSubmission = z.input<
  typeof bookingRequestSubmissionSchema
>;

export type BookingRequestInput = z.output<
  typeof bookingRequestSubmissionSchema
>;

export type FieldErrors = Partial<
  Record<
    | "startDate"
    | "startTime"
    | "endTime"
    | "purpose"
    | "groupName"
    | "expectedAttendance"
    | "acknowledgement"
    | "idempotencyKey",
    string
  >
>;

export function validationFieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  const allowedFields = new Set<keyof FieldErrors>([
    "startDate",
    "startTime",
    "endTime",
    "purpose",
    "groupName",
    "expectedAttendance",
    "acknowledgement",
    "idempotencyKey",
  ]);

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (
      typeof field === "string" &&
      allowedFields.has(field as keyof FieldErrors) &&
      !result[field as keyof FieldErrors]
    ) {
      result[field as keyof FieldErrors] = issue.message;
    }
  }

  return result;
}
