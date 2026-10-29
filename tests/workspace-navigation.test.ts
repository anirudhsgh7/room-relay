import { describe, expect, it } from "vitest";
import { navigationFor, type NavCounts } from "@/lib/workspace/navigation";

const counts: NavCounts = { unread: 4, toReview: 2, openIssues: 1 };

function hrefs(role: Parameters<typeof navigationFor>[0]): string[] {
  return navigationFor(role, counts).flatMap((group) =>
    group.items.map((item) => item.href),
  );
}

describe("workspace navigation", () => {
  it("keeps discovery and check-in in the student journey", async () => {
    expect(hrefs("student")).toEqual([
      "/app",
      "/app/rooms",
      "/app/bookings",
      "/app/access",
      "/app/notifications",
    ]);
  });

  it("gives staff management links and the access log without student actions", async () => {
    for (const role of ["manager", "admin"] as const) {
      expect(hrefs(role)).toEqual([
        "/app",
        "/app/notifications",
        "/app/manager/queue",
        "/app/admin/rooms",
        "/app/incidents",
        "/app/access/history",
      ]);
      expect(hrefs(role)).not.toContain("/app/rooms");
      expect(hrefs(role)).not.toContain("/app/access");
    }
  });

  it("keeps admin room copy distinct and scoped counts intact", async () => {
    const adminGroups = navigationFor("admin", counts);
    const managerGroups = navigationFor("manager", counts);
    const adminItems = adminGroups.flatMap((group) => group.items);
    const managerItems = managerGroups.flatMap((group) => group.items);

    expect(adminItems.find((item) => item.href === "/app/admin/rooms")?.label).toBe(
      "Rooms and rules",
    );
    expect(managerItems.find((item) => item.href === "/app/admin/rooms")?.label).toBe(
      "My rooms",
    );
    expect(adminItems.find((item) => item.href === "/app/notifications")?.count).toBe(
      4,
    );
    expect(adminItems.find((item) => item.href === "/app/manager/queue")?.count).toBe(
      2,
    );
    expect(adminItems.find((item) => item.href === "/app/incidents")?.count).toBe(1);
  });
});
