import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseQuery, type ParseContext } from "@/lib/assistant/parse";
import { answerAssistant } from "@/lib/assistant/respond";
import type { UserProfile } from "@/lib/auth/service";
import { decideBooking } from "@/lib/bookings/decisions";
import { createSeededTestDatabase, getTestProfile } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;
type Profile = UserProfile;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

const context: ParseContext = {
  today: "2026-10-28",
  todayWeekday: 3,
  facilities: [
    "Acoustic panels",
    "Camera rig",
    "Green screen",
    "Hearing loop",
    "Hybrid meeting kit",
    "Power outlets",
    "Projector",
    "Step-free access",
    "Whiteboard",
  ],
  buildings: ["Arts Annex", "Central Library", "Hazelwood Hall", "Newton Building"],
  rooms: [
    { code: "SEM-02", name: "Seminar Room 02" },
    { code: "MED-01", name: "Media Studio 01" },
    { code: "NEW-14", name: "Classroom 14" },
    { code: "LIB-03", name: "Quiet Study 03" },
  ],
};

function parse(message: string) {
  return parseQuery(message, context);
}

describe("assistant message parser", () => {
  it.each([
    ["tomorrow 3-5pm", "2026-10-29", "15:00", "17:00"],
    ["friday from 2pm to 4:30pm", "2026-10-30", "14:00", "16:30"],
    ["today at 3 for 2 hours", "2026-10-28", "15:00", "17:00"],
    ["on 30 oct at 10am", "2026-10-30", "10:00", "11:00"],
    ["2026-11-02 14:00-15:30", "2026-11-02", "14:00", "15:30"],
    ["next monday 9-11", "2026-11-02", "09:00", "11:00"],
    ["30/10 at 18:00", "2026-10-30", "18:00", "19:00"],
    ["tomorrow afternoon", "2026-10-29", "13:00", "17:00"],
    ["in 3 days at noon", "2026-10-31", null, null],
  ])("reads %s", (message, date, start, end) => {
    const result = parse(message);
    expect(result.date).toBe(date);
    if (start) {
      expect(result.startTime).toBe(start);
      expect(result.endTime).toBe(end);
    }
  });

  it("reads a lunchtime slot", async () => {
    expect(parse("tomorrow at lunchtime")).toMatchObject({ startTime: "12:00", endTime: "13:00" });
  });

  it("reads group size without confusing it with a duration or a time", async () => {
    expect(parse("a room for 12 people tomorrow").capacity).toBe(12);
    expect(parse("group of 6 at 2pm").capacity).toBe(6);
    expect(parse("for 2 hours tomorrow at 10am")).toMatchObject({ capacity: null, durationMinutes: 120 });
    expect(parse("for 8 at 10:30")).toMatchObject({ capacity: 8, startTime: "10:30" });
  });

  it("matches facilities by name and by everyday words", async () => {
    expect(parse("somewhere with a projector and a whiteboard").facilities.sort()).toEqual([
      "Projector",
      "Whiteboard",
    ]);
    expect(parse("wheelchair accessible room").facilities).toEqual(["Step-free access"]);
    expect(parse("we want to film an interview").facilities).toEqual(["Camera rig"]);
  });

  it("recognises buildings and rooms by code or name", async () => {
    expect(parse("anything in hazelwood tomorrow").building).toBe("Hazelwood Hall");
    expect(parse("is sem-02 free friday at 2").roomCode).toBe("SEM-02");
    expect(parse("is SEM 02 free").roomCode).toBe("SEM-02");
    expect(parse("tell me about the media studio").roomCode).toBe("MED-01");
  });

  it("does not read dates or room codes as times", async () => {
    expect(parse("2026-11-02").startTime).toBeNull();
    expect(parse("is sem-02 free").startTime).toBeNull();
    expect(parse("30/10").startTime).toBeNull();
  });

  it("leaves unknown values empty instead of guessing", async () => {
    expect(parse("I need a space")).toMatchObject({
      date: null,
      startTime: null,
      capacity: null,
      facilities: [],
      building: null,
      roomCode: null,
    });
  });
});

describe("assistant answers", () => {
  let testDatabase: SeededTestDatabase;
  let amelia: Profile;
  let priya: Profile;
  let admin: Profile;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    amelia = await getTestProfile(testDatabase.db, "usr_amelia_chen");
    priya = await getTestProfile(testDatabase.db, "usr_priya_nair");
    admin = await getTestProfile(testDatabase.db, "usr_rowan_ellis");
  });

  afterEach(() => {
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("finds free rooms and links straight to a prefilled request", async () => {
    const answer = await answerAssistant(
      testDatabase.db,
      amelia,
      "find a room for 12 people tomorrow 10-11am with a projector",
    );

    expect(answer.message).toContain("free for");
    expect(answer.cards.map((card) => card.title)).toEqual(["Seminar Room 02", "Classroom 14"]);
    expect(answer.cards[0]).toMatchObject({
      badge: "Free",
      cta: "Request",
      href: "/app/rooms/SEM-02/request?date=2026-10-29&start=10%3A00&end=11%3A00&people=12",
    });
  });

  it("explains a booked time and offers the waitlist instead of inventing availability", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "is SEM-02 free tomorrow 4-5pm?");

    expect(answer.message).toContain("already booked");
    expect(answer.message).toContain("waitlist");
    expect(answer.cards[0]).toMatchObject({ badge: "Booked", cta: "Join waitlist" });
  });

  it("asks for the missing piece and suggests complete questions", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "I need a room for 6 people");

    expect(answer.message).toContain("Tell me a day and time");
    expect(answer.suggestions[0]).toBe("Find a room for 6 people tomorrow at 10am");
    expect(answer.cards.length).toBeGreaterThan(0);
  });

  it("summarises a student's own bookings with waitlist positions", async () => {
    await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media_overlap",
      action: "approve",
      decisionReason: "Approving Noah to test the waitlist summary.",
      overrideRequirementIds: ["req_media_equipment_induction"],
      overrideReason: "Induction confirmed by the technician for this session.",
      allocationExceptionReason: "Film Society deadline is fixed by the festival committee.",
    });

    const answer = await answerAssistant(testDatabase.db, amelia, "show my bookings");

    expect(answer.message).toContain("on a waitlist");
    const waitlisted = answer.cards.find((card) => card.badge === "Waitlisted");
    expect(waitlisted?.detail).toBe("Number 1 on the waitlist");
  });

  it("answers rule questions from the room's published policy", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "how are requests ranked for SEM-02?");

    expect(answer.message).toContain('Seminar Room 02 uses "First come, first served"');
  });

  it("treats 'how do I cancel my booking' as a question, not a status request", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "how do I cancel my booking?");

    expect(answer.message).toContain("choose Cancel");
  });

  it("gives managers their own queue and admins the whole campus", async () => {
    const priyaView = await answerAssistant(testDatabase.db, priya, "what needs my attention?");
    const adminView = await answerAssistant(testDatabase.db, admin, "what needs my attention?");

    expect(priyaView.message).toContain("2 requests are waiting for a decision");
    expect(adminView.message).toContain("3 requests are waiting for a decision");
    expect(priyaView.cards.every((card) => !card.title.includes("Seminar"))).toBe(true);
  });

  it("never offers students a request link for rooms that cannot take one", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "find a room tomorrow at 7am");

    for (const card of answer.cards) {
      expect(card.cta).not.toBe("Request");
    }
  });

  it("explains competing requests in everyday words", async () => {
    const answer = await answerAssistant(
      testDatabase.db,
      amelia,
      "what happens if someone else wants the same time?",
    );

    expect(answer.message).toContain("ranks them by its published rule");
  });

  it("snaps off-grid times to bookable suggestions", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "find a room tomorrow 3:10-4pm");

    expect(answer.message).toContain("30-minute steps");
    expect(answer.suggestions).toEqual([
      "Find a room on 29 Oct 15:00-16:00",
      "Find a room on 29 Oct 15:30-16:30",
    ]);
    const followUp = await answerAssistant(testDatabase.db, amelia, answer.suggestions[0]!);
    expect(followUp.message).toContain("free for");
  });

  it("states the largest room when a group is too big", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "find a room for 50 people tomorrow at 2");

    expect(answer.message).toBe("No room seats 50. The largest seats 40.");
  });

  it("puts a booking that has started first and points to check-in", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "my requests");

    expect(answer.message).toContain("Your Classroom 14 booking has started");
    expect(answer.cards[0]).toMatchObject({ title: "Classroom 14", cta: "Check in", href: "/app/access" });
  });

  it("falls back with suggestions when it does not understand", async () => {
    const answer = await answerAssistant(testDatabase.db, amelia, "banana");

    expect(answer.message).toContain("not sure I understood");
    expect(answer.suggestions.length).toBeGreaterThan(0);
  });
});
