import { spawn } from "node:child_process";
import { SignJWT } from "jose";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const port = 3107;
const baseUrl = `http://127.0.0.1:${port}`;
const secret = process.env.ROOMRELAY_SESSION_SECRET;

if (!secret || secret.length < 32) {
  throw new Error(
    "ROOMRELAY_SESSION_SECRET is required for the smoke test. Run `npm run db:setup` first.",
  );
}

async function createToken(userId) {
  return new SignJWT({ sid: `smoke-${userId}` })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer("roomrelay")
    .setAudience("roomrelay-web")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
  {
    env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 200) {
        return response;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error("The production server did not become healthy in 20 seconds.");
}

try {
  const healthResponse = await waitForServer();
  const health = await healthResponse.json();
  assert(health.status === "ok", "Health check did not report ok.");
  assert(health.phase === 6, "Health check did not report the Phase 6 service.");
  assert(health.database === "ok", "Health check did not report a healthy database.");
  assert(health.migrations === 6, "The Phase 6 migration was not reported as applied.");

  const loginResponse = await fetch(`${baseUrl}/login`);
  assert(loginResponse.status === 200, "The login page did not return 200.");

  const anonymousApp = await fetch(`${baseUrl}/app`, { redirect: "manual" });
  assert(
    anonymousApp.status === 307 &&
      anonymousApp.headers.get("location")?.endsWith("/login"),
    "An anonymous request to /app was not redirected to /login.",
  );

  const anonymousRooms = await fetch(`${baseUrl}/app/rooms`, {
    redirect: "manual",
  });
  assert(
    anonymousRooms.status === 307 &&
      anonymousRooms.headers.get("location")?.endsWith("/login"),
    "An anonymous request to room discovery was not redirected to /login.",
  );

  const anonymousAccess = await fetch(`${baseUrl}/app/access`, {
    redirect: "manual",
  });
  assert(
    anonymousAccess.status === 307 &&
      anonymousAccess.headers.get("location")?.endsWith("/login"),
    "An anonymous request to the access simulator was not redirected to /login.",
  );

  const anonymousAccessApi = await fetch(`${baseUrl}/api/access/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credentialId: "cred_amelia_active",
      roomId: "room_classroom_14",
      eventNonce: "8f3a09d8-18ee-4f43-8e6f-d79e83df2051",
    }),
  });
  assert(
    anonymousAccessApi.status === 401,
    "An anonymous access API request was not rejected.",
  );

  const studentToken = await createToken("usr_amelia_chen");
  const studentApp = await fetch(`${baseUrl}/app`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  const studentHtml = await studentApp.text();
  assert(studentApp.status === 200, "The seeded student could not load /app.");
  assert(
    studentHtml.includes("Amelia Chen") &&
      studentHtml.includes("Your upcoming bookings") &&
      studentHtml.includes("Ask RoomRelay"),
    "The student workspace did not render the expected server-resolved profile.",
  );
  assert(
    !studentHtml.includes("/app/manager/queue"),
    "The student workspace exposed the manager queue.",
  );
  assert(
    !studentHtml.includes("Your room portfolio"),
    "The student workspace leaked manager-only UI.",
  );

  const studentRooms = await fetch(`${baseUrl}/app/rooms`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  const studentRoomsHtml = await studentRooms.text();
  assert(studentRooms.status === 200, "The student could not load room discovery.");
  assert(
    studentRoomsHtml.includes("Find a room") &&
      studentRoomsHtml.includes("Seminar Room 02") &&
      studentRoomsHtml.includes("Choose a date") &&
      studentRoomsHtml.includes("Start hour") &&
      studentRoomsHtml.includes("End minute"),
    "Room discovery did not render the active room catalog.",
  );

  const requestPage = await fetch(
    `${baseUrl}/app/rooms/SEM-02/request?date=2026-10-29&start=10%3A00&end=11%3A30`,
    { headers: { Cookie: `roomrelay_session=${studentToken}` } },
  );
  const requestHtml = await requestPage.text();
  assert(requestPage.status === 200, "The request form did not render.");
  assert(
    requestHtml.includes("Send request") &&
      requestHtml.includes("If someone else wants the same time") &&
      requestHtml.includes("First come, first served"),
    "The request form did not communicate its pending-only meaning.",
  );

  const studentBookings = await fetch(`${baseUrl}/app/bookings`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  const studentBookingsHtml = await studentBookings.text();
  assert(studentBookings.status === 200, "The student could not load My requests.");
  assert(
    studentBookingsHtml.includes("Media Studio 01") &&
      studentBookingsHtml.includes("Pending review") &&
      studentBookingsHtml.includes("My bookings"),
    "My requests did not show the requester's seeded pending request.",
  );

  const studentBookingDetail = await fetch(
    `${baseUrl}/app/bookings/booking_pending_media`,
    { headers: { Cookie: `roomrelay_session=${studentToken}` } },
  );
  const studentBookingDetailHtml = await studentBookingDetail.text();
  assert(
    studentBookingDetail.status === 200 &&
      studentBookingDetailHtml.includes("Cancel request") &&
      studentBookingDetailHtml.includes("Waiting for the room manager"),
    "The requester could not see the pending receipt or cancellation control.",
  );

  const studentIncidentBooking = await fetch(
    `${baseUrl}/app/bookings/booking_incident_open`,
    { headers: { Cookie: `roomrelay_session=${studentToken}` } },
  );
  const studentIncidentBookingHtml = await studentIncidentBooking.text();
  assert(
    studentIncidentBooking.status === 200 &&
      studentIncidentBookingHtml.includes("Reported issues") &&
      studentIncidentBookingHtml.includes("Booking history"),
    "The requester booking did not show incident status or lifecycle history.",
  );

  const studentIncidentDetail = await fetch(
    `${baseUrl}/app/incidents/incident_equipment_open`,
    { headers: { Cookie: `roomrelay_session=${studentToken}` } },
  );
  const studentIncidentDetailHtml = await studentIncidentDetail.text();
  assert(
    studentIncidentDetail.status === 200 &&
      studentIncidentDetailHtml.includes("Reported issue") &&
      studentIncidentDetailHtml.includes("No automatic penalties"),
    "The requester could not see their own incident detail or safety copy.",
  );

  const studentIncidentQueue = await fetch(`${baseUrl}/app/incidents`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  assert(
    studentIncidentQueue.status === 404,
    "A student was able to load the manager/admin incident queue.",
  );

  const studentManagerQueue = await fetch(`${baseUrl}/app/manager/queue`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  assert(
    studentManagerQueue.status === 404,
    "A student was able to load the manager queue.",
  );


  const studentAdminRooms = await fetch(`${baseUrl}/app/admin/rooms`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  assert(studentAdminRooms.status === 404, "A student could open room administration.");

  const studentRoomPage = await fetch(`${baseUrl}/app/rooms/MED-01`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  const studentRoomPageHtml = await studentRoomPage.text();
  assert(
    studentRoomPage.status === 200 &&
      studentRoomPageHtml.includes("If others want the same time") &&
      studentRoomPageHtml.includes("Booking rules"),
    "The room page did not publish its booking and allocation rules.",
  );

  const studentAccess = await fetch(`${baseUrl}/app/access`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  const studentAccessHtml = await studentAccess.text();
  assert(studentAccess.status === 200, "The student could not load access checks.");
  assert(
    studentAccessHtml.includes("Tap your card") &&
      studentAccessHtml.includes("No card reader or door lock is connected") &&
      studentAccessHtml.includes("NFC card"),
    "The access simulator did not render its credentials or simulation disclaimer.",
  );

  const studentAccessHistory = await fetch(`${baseUrl}/app/access/history`, {
    headers: { Cookie: `roomrelay_session=${studentToken}` },
  });
  const studentAccessHistoryHtml = await studentAccessHistory.text();
  assert(
    studentAccessHistory.status === 200 &&
      studentAccessHistoryHtml.includes("My taps"),
    "The student access history did not render.",
  );

  const managerToken = await createToken("usr_priya_nair");
  const managerApp = await fetch(`${baseUrl}/app`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  const managerHtml = await managerApp.text();
  assert(managerApp.status === 200, "The seeded manager could not load /app.");
  assert(
    managerHtml.includes("Media Studio 01") &&
      managerHtml.includes("Requests to review") &&
      !managerHtml.includes("Seminar Room 02"),
    "The manager workspace was not scoped to the assigned room portfolio.",
  );

  const managerQueue = await fetch(`${baseUrl}/app/manager/queue`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  const managerQueueHtml = await managerQueue.text();
  assert(managerQueue.status === 200, "The manager queue did not render.");
  assert(
    managerQueueHtml.includes("Media Studio 01") &&
      managerQueueHtml.includes("want this time") &&
      managerQueueHtml.includes("Access log") &&
      !managerQueueHtml.includes("Find a room") &&
      !managerQueueHtml.includes("Tap simulator") &&
      !managerQueueHtml.includes("Seminar Room 02"),
    "The manager queue was not scoped to Priya's assigned rooms.",
  );

  const managerRequestDetail = await fetch(
    `${baseUrl}/app/manager/requests/booking_pending_media`,
    { headers: { Cookie: `roomrelay_session=${managerToken}` } },
  );
  const managerRequestDetailHtml = await managerRequestDetail.text();
  assert(
    managerRequestDetail.status === 200 &&
      managerRequestDetailHtml.includes("Your decision") &&
      managerRequestDetailHtml.includes("requirements aren&#x27;t met yet") &&
      managerRequestDetailHtml.includes("First in line of 2 requests for this time"),
    "The manager review detail did not render the eligibility decision state.",
  );

  const managerIncidents = await fetch(`${baseUrl}/app/incidents`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  const managerIncidentsHtml = await managerIncidents.text();
  assert(
    managerIncidents.status === 200 &&
      managerIncidentsHtml.includes("Reported issues") &&
      managerIncidentsHtml.includes("Media Studio 01"),
    "The manager incident queue did not render assigned-room incidents.",
  );

  const managerIncidentDetail = await fetch(
    `${baseUrl}/app/incidents/incident_equipment_open`,
    { headers: { Cookie: `roomrelay_session=${managerToken}` } },
  );
  const managerIncidentDetailHtml = await managerIncidentDetail.text();
  assert(
    managerIncidentDetail.status === 200 &&
      managerIncidentDetailHtml.includes("Manager review / recommendation"),
    "The manager could not access the assigned-room incident review.",
  );

  const unassignedManagerDetail = await fetch(
    `${baseUrl}/app/manager/requests/booking_pending_seminar`,
    { headers: { Cookie: `roomrelay_session=${managerToken}` } },
  );
  assert(
    unassignedManagerDetail.status === 404,
    "A manager could read a request for an unassigned room.",
  );

  const managerBookings = await fetch(`${baseUrl}/app/bookings`, {
    redirect: "manual",
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  assert(
    managerBookings.status === 307 &&
      managerBookings.headers.get("location")?.endsWith("/app/rooms"),
    "A manager was able to access the student-only request list.",
  );

  const managerBookingDetail = await fetch(
    `${baseUrl}/app/bookings/booking_pending_media`,
    { headers: { Cookie: `roomrelay_session=${managerToken}` } },
  );
  assert(
    managerBookingDetail.status === 404,
    "A manager could read a student's private request detail.",
  );

  const managerRequestForm = await fetch(
    `${baseUrl}/app/rooms/SEM-02/request`,
    { headers: { Cookie: `roomrelay_session=${managerToken}` } },
  );
  assert(
    managerRequestForm.status === 404,
    "A manager was able to open the student request form.",
  );


  // Room administration: managers see their own rooms; only admins add rooms.
  const managerRooms = await fetch(`${baseUrl}/app/admin/rooms`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  const managerRoomsHtml = await managerRooms.text();
  assert(
    managerRooms.status === 200 &&
      managerRoomsHtml.includes("My rooms") &&
      managerRoomsHtml.includes("Media Studio 01") &&
      !managerRoomsHtml.includes("Seminar Room 02") &&
      !managerRoomsHtml.includes("Add a room"),
    "The manager room list was not scoped to assigned rooms.",
  );

  const managerOwnRoom = await fetch(`${baseUrl}/app/admin/rooms/room_media_studio`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  const managerOwnRoomHtml = await managerOwnRoom.text();
  assert(
    managerOwnRoom.status === 200 &&
      managerOwnRoomHtml.includes("Opening hours") &&
      managerOwnRoomHtml.includes("Booking rules") &&
      managerOwnRoomHtml.includes("Only an administrator can change these"),
    "A manager could not manage their own room's hours and rules.",
  );

  const managerOtherRoom = await fetch(`${baseUrl}/app/admin/rooms/room_seminar_02`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  assert(managerOtherRoom.status === 404, "A manager could open another manager's room settings.");

  const managerNewRoom = await fetch(`${baseUrl}/app/admin/rooms/new`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  assert(managerNewRoom.status === 404, "A manager could open the add-room form.");

  const managerNotifications = await fetch(`${baseUrl}/app/notifications`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  assert(
    managerNotifications.status === 200 &&
      (await managerNotifications.text()).includes("Notifications"),
    "The notifications page did not render.",
  );

  const managerAccessHistory = await fetch(`${baseUrl}/app/access/history`, {
    headers: { Cookie: `roomrelay_session=${managerToken}` },
  });
  const managerAccessHistoryHtml = await managerAccessHistory.text();
  assert(managerAccessHistory.status === 200, "Manager access history did not render.");
  assert(
    managerAccessHistoryHtml.includes("Media Studio 01") &&
      !managerAccessHistoryHtml.includes("Seminar Room 02"),
    "Manager access history was not scoped to assigned rooms.",
  );

  const adminToken = await createToken("usr_rowan_ellis");
  const adminQueue = await fetch(`${baseUrl}/app/manager/queue`, {
    headers: { Cookie: `roomrelay_session=${adminToken}` },
  });
  const adminQueueHtml = await adminQueue.text();
  assert(adminQueue.status === 200, "The admin queue did not render.");
  assert(
    adminQueueHtml.includes("Media Studio 01") &&
      adminQueueHtml.includes("Seminar Room 02"),
    "The admin queue was not institution-wide.",
  );


  const adminRooms = await fetch(`${baseUrl}/app/admin/rooms`, {
    headers: { Cookie: `roomrelay_session=${adminToken}` },
  });
  const adminRoomsHtml = await adminRooms.text();
  assert(
    adminRooms.status === 200 &&
      adminRoomsHtml.includes("Rooms and rules") &&
      adminRoomsHtml.includes("Add a room") &&
      adminRoomsHtml.includes("Seminar Room 02") &&
      adminRoomsHtml.includes("Media Studio 01"),
    "The admin room list was not institution-wide.",
  );

  const adminNewRoom = await fetch(`${baseUrl}/app/admin/rooms/new`, {
    headers: { Cookie: `roomrelay_session=${adminToken}` },
  });
  assert(
    adminNewRoom.status === 200 && (await adminNewRoom.text()).includes("Room code"),
    "The admin could not open the add-room form.",
  );

  const adminIncident = await fetch(
    `${baseUrl}/app/incidents/incident_light_reviewing`,
    { headers: { Cookie: `roomrelay_session=${adminToken}` } },
  );
  const adminIncidentHtml = await adminIncident.text();
  assert(
    adminIncident.status === 200 &&
      adminIncidentHtml.includes("Administrator final resolution") &&
      adminIncidentHtml.includes("Resolve incident"),
    "The admin could not access the incident resolution workflow.",
  );

  console.log(
    "Smoke test passed: health, lifecycle roles, room administration, notifications, access, close-out, incidents, timeline, and privacy boundaries.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (serverOutput) {
    console.error("\nServer output:\n", serverOutput);
  }
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
