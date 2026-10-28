import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safe post-login redirects", () => {
  it("allows paths inside the authenticated workspace", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/bookings")).toBe("/app/bookings");
    expect(safeNextPath("/app?tab=rooms")).toBe("/app?tab=rooms");
  });

  it("rejects absolute and protocol-relative destinations", () => {
    expect(safeNextPath("https://evil.example")).toBe("/app");
    expect(safeNextPath("//evil.example")).toBe("/app");
    expect(safeNextPath("javascript:alert(1)")).toBe("/app");
    expect(safeNextPath("/login")).toBe("/app");
    expect(safeNextPath(undefined)).toBe("/app");
    expect(safeNextPath(null)).toBe("/app");
  });
});
