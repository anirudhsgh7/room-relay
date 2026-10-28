export function safeNextPath(
  value: FormDataEntryValue | string | null | undefined,
): string {
  if (typeof value !== "string") {
    return "/app";
  }

  // Only allow in-app destinations. Reject protocol-relative and absolute URLs.
  if (!/^\/app(?:[/?#]|$)/.test(value) || value.startsWith("//")) {
    return "/app";
  }

  return value;
}
