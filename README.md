# RoomRelay

**Book a room. Unlock access. Keep trust.**

RoomRelay is a university room-booking and access-management prototype. The complete product connects discovery, fair requests, room-manager decisions, time-bound access checks, check-out, and an accountable audit history.

This repository currently implements **Phase 5: Check-out, condition and incident handling, and lifecycle history**. The complete demo lifecycle runs from room discovery and manager approval through simulated access, check-in, requester check-out, post-use condition reporting, human-reviewed incidents, and a connected booking timeline.

> **Prototype notice:** RoomRelay is not approved for controlling real restricted doors. All accounts and credentials in this repository are public demo fixtures. A pending request is not permission to enter. Access checks are software simulations: no NFC reader, relay, lock, or physical door is connected, and an ALLOW result never represents a real unlock. Incidents are human-reviewed observations, not automatic findings of fault or penalties.

## Current status

| Area | Status |
| --- | --- |
| Application shell and responsive visual system | Complete |
| Server-verified sign-in and HTTP-only sessions | Complete |
| Persisted student, manager, and admin roles | Complete |
| Versioned lifecycle schema | Complete |
| Room-scoped authorization helpers | Complete |
| Append-only access and audit event tables | Complete |
| Idempotent demo accounts, rooms, and records | Complete |
| Active room catalog with URL-backed filters | Complete |
| Room detail with hours, policy, and eligibility state | Complete |
| Server-validated pending booking requests | Complete |
| Requester-only My requests and request receipts | Complete |
| Room-scoped manager queue and decision detail | Complete |
| Reasoned approve/reject with live validation | Complete |
| Audited eligibility override for a single booking | Complete |
| Requester cancellation before approval or before start | Complete |
| Own-credential simulated access checks | Complete |
| Exact booking-window and credential revocation policy | Complete |
| `approved → checked_in` on first valid access | Complete |
| Append-only access events and role-scoped history | Complete |
| Requester check-out with required condition report | Complete |
| Incident reporting, manager review, admin resolution | Complete |
| Connected request-to-close-out lifecycle timeline | Complete |
| Public preview deployment | Requires a hosting provider and URL |

### What Phase 5 deliberately does not include

- Photo upload/storage, notifications, email, calendar export, analytics, or payments
- Automatic no-show classification, penalties, sanctions, or trust scores
- Manager/admin check-out on behalf of a requester
- Appeals or AI-generated incident findings
- Physical NFC/QR reader integration, relay/door output, or live door actuation
- Offline access or production anti-cloning hardware protocols
- Admin credential-binding/revocation UI or full room/user administration
- A “request changes” or waitlist workflow

The application labels these areas as future phases rather than presenting nonfunctional controls.

## Quick start

### Requirements

- Node.js **22.12 or newer** (verified with Node 24)
- npm **10 or newer**

Docker is optional and only needed for container deployment.

```bash
npm install
npm run dev
```

The `predev` hook creates a local `.env.local` with a random development session secret, applies migrations, and seeds the demo dataset. Open [http://localhost:3000](http://localhost:3000).

If you prefer explicit setup:

```bash
npm run db:setup
npm run dev
```

The database is stored at `data/room-relay.db` by default and is ignored by Git.

### Demo accounts

All passwords are intentionally public and disposable.

| Role | Name | Email | Password | Scope |
| --- | --- | --- | --- | --- |
| Student / club lead | Amelia Chen | `student@roomrelay.demo` | `demo-student-2026` | Discovery, own requests, cancellation |
| Room manager | Marcus Webb | `manager@roomrelay.demo` | `demo-manager-2026` | Seminar Room 02 and Classroom 14 |
| Room manager | Priya Nair | `manager2@roomrelay.demo` | `demo-manager-2026` | Media Studio 01 and Quiet Study 03 |
| Administrator | Rowan Ellis | `admin@roomrelay.demo` | `demo-admin-2026` | Institution-wide review and oversight |
| Suspended user | Jamie Cole | `inactive@roomrelay.demo` | `demo-inactive-2026` | Intentionally cannot sign in |

The suspended account is not shown in the login directory. A second active student fixture, Noah Williams (`student2@roomrelay.demo`), exists only to create the overlapping pending request in Priya's manager queue; it is not displayed in the judge-facing login directory.

## How to verify the full Phase 5 journey

### Student path

1. Sign in as **Amelia Chen** and open **Room discovery**.
2. Search by date, time, capacity, building, and facilities. Try 16:00–17:30 on the seeded approved date to see a safe conflict state.
3. Open **Seminar Room 02**, review its rules, and submit a request. Confirm the receipt says **Pending manager review** and **not permission to enter**.
4. Open **My requests** and a pending request detail. Confirm the **Cancel request** control is available.
5. After a manager approves a future request, return to its detail. Confirm **Approved** and the manager’s reason, then use **Cancel booking** with a reason and see the cancellation recorded.

### Manager/admin path

6. Sign in as **Priya Nair** and open **Manager queue**. Confirm only Media Studio 01 and Quiet Study 03 requests appear, and that the two seeded Media Studio requests show a pending overlap.
7. Open a pending Media Studio request. Confirm current equipment-induction eligibility blocks ordinary approval and that the explicit override requires a reason.
8. Sign in as **Marcus Webb**. Confirm Seminar Room 02 requests appear but Priya’s Media Studio requests do not.
9. Sign in as **Rowan Ellis**. Confirm the queue is institution-wide, while every decision would be attributed to the admin account.
10. Submit a decision, then return to My requests as Amelia and confirm the status and reason persist after refresh.

### Access path

11. Still as Amelia, open **Access checks**. Classroom 14 shows a synthetic demo access window seeded around the current time. Run `npm run db:reset` before a live demo to refresh this relative window.
12. Keep the active NFC card selected and simulate an access check. Confirm the server returns **Allowed**, the booking becomes **Checked in**, and the attempt appears in Access history.
13. Select the revoked card fixture. Confirm the server returns **Denied / CREDENTIAL_REVOKED** and the booking state does not change.
14. Select Seminar Room 02 (future approved booking) and confirm **Denied / OUTSIDE_BOOKING_WINDOW**. Select Media Studio 01 (pending request) and confirm **Denied / BOOKING_NOT_APPROVED**.
15. Sign in as Priya and open **Access history**; confirm only assigned-room events appear. Sign in as Rowan to see institution-wide history.
16. Confirm every page labels the check as simulated and never claims a physical door unlocked.

### Close-out and incident path

17. After a successful simulated access, return to **My requests** and open the checked-in booking. Use **Check out**, leave a condition note, and choose **Left as found**. Confirm the booking becomes Completed and the timeline includes access and the condition report.
18. Open the seeded **equipment incident** from My requests to see the requester view: category, description, check-out condition, status, and human-review copy.
19. Sign in as Priya and open **Incidents**. Start a manager review for the open Media Studio incident, recording a recommendation.
20. Sign in as Rowan and open the reviewing incident. Add a final admin resolution note. Confirm the linked booking completes when no unresolved incidents remain.
21. Confirm the lifecycle timeline shows request, decision, simulated access, condition, incident review, resolution, and completion. No automatic penalty or physical lock is created.

### Trust checks

22. Try changing a role value, local storage entry, booking ID, room ID, credential owner, condition report ID, or incident ID in a URL. Server-side identity, requester scoping, room assignment, credential ownership, and event timestamps remain authoritative.
23. Request `/app`, `/app/manager/queue`, `/app/access`, or `/app/incidents` in a private window. Anonymous access is denied.
24. Try the suspended account. Authentication fails after password verification.

The app has no browser-facing database API, so SQLite cannot be queried directly from the client even if the UI is bypassed.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Set up if needed, then start the development server |
| `npm run build` | Create an optimized production build |
| `npm start` | Set up and start the production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run the Vitest suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:smoke` | Start the production build and verify health, auth redirect, and role scoping over HTTP |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Apply migrations and idempotently seed demo data |
| `npm run db:setup` | Create `.env.local` locally, migrate, and seed |
| `npm run db:reset` | Delete the local database and recreate it with fresh relative demo dates |
| `npm run check` | Run lint, type-check, tests, and production build |

Use `npm run db:reset` when the seeded relative booking dates become stale. The reset script refuses to run against `NODE_ENV=production` unless `ROOMRELAY_ALLOW_DB_RESET=1` is explicitly set.

## Architecture

```text
Browser
  │
  │  HTML forms + Next.js Server Actions
  ▼
Next.js application (server runtime)
  ├─ lib/auth/session.ts           server-only session resolution
  ├─ lib/auth/service.ts           credential verification
  ├─ lib/authorization.ts          role and room-scope policy helpers
  ├─ lib/rooms/queries.ts          catalog, filters, detail projections
  ├─ lib/rooms/availability.ts     schedule and confirmed-booking rules
  ├─ lib/bookings/service.ts       atomic pending-request creation
  ├─ lib/bookings/decisions.ts     scoped approve/reject + overrides
  ├─ lib/bookings/cancellation.ts  requester-scoped cancellation
  ├─ lib/bookings/manager-queries.ts manager/admin queue projections
  ├─ lib/bookings/queries.ts       requester-scoped receipts
  ├─ lib/access/service.ts         server access-policy decision + events
  ├─ lib/access/queries.ts         simulator choices + scoped history
  ├─ lib/bookings/checkout.ts      requester condition report + close-out
  ├─ lib/bookings/timeline.ts      merged lifecycle timeline
  ├─ lib/incidents/service.ts      manager review + admin resolution
  ├─ lib/incidents/queries.ts      scoped incident queue/detail
  ├─ lib/time/campus-time.ts       timezone/DST-aware local↔UTC conversion
  ├─ lib/db/queries.ts             dashboard projections
  └─ lib/db/client.ts              server-only better-sqlite3 access
                                     │
                                     ▼
                              data/room-relay.db
```

### Stack

- **Next.js 16 / React 19 / TypeScript**
- **Tailwind CSS 4** with a custom campus-operations visual system
- **SQLite** through `better-sqlite3`, accessed only in the Node server runtime
- **scrypt** password hashing with per-password random salts
- **jose** HS256 session tokens in an HTTP-only cookie
- **Temporal polyfill** for timezone/DST-safe local-time conversion
- **Zod** server-side form validation
- **Vitest** database, authentication, authorization, discovery, booking, timezone, redirect, and rate-limit tests

### Foundation-stack decision

The recommended product stack in `docs/plan.md` is Supabase Auth plus PostgreSQL. This implementation instead uses a self-contained SQLite database and explicit server-side authentication because:

1. No Supabase project credentials or Docker daemon were available in the implementation environment.
2. Phase 1 must be immediately runnable by a reviewer without an external account or network service.
3. The database is never exposed to the browser, so there is no client-side database API that requires row-level security policies.

This does **not** claim SQLite is the final production datastore. The equivalent trust controls are:

- no browser-reachable database client;
- all reads through narrow server-side query functions;
- role and account status loaded from the database on every protected request;
- central room-scope authorization helpers;
- append-only triggers on access and audit history;
- server-side credential verification and generic sign-in errors.

Before a multi-instance or production deployment, migrate the repository layer to PostgreSQL, add database RLS as defense in depth, replace the in-memory rate limiter with a shared store, and move from demo passwords to managed institutional identity.

### Why two managers?

The two manager accounts have disjoint room portfolios. That makes room-scoped authorization testable from the first phase and prevents a future approval queue from accidentally becoming institution-wide for every manager.

## Data model

The migrations under `db/migrations/` define the Phase 1 lifecycle and the Phase 2 request foundation:

- `profiles` — display identity, persisted role, account status, password hash
- `rooms` — code, building, location, capacity, facilities, policy, manager ownership
- `availability_rules` — weekday local opening windows
- `eligibility_requirements` — visible hard requirements, seeded as demo policy
- `bookings` — requester, room, purpose, attendance, time window, status, decision metadata
- `credentials` — server-side credential reference, active/revoked state
- `access_events` — attempted reference, room, time, result, reason, source, correlation ID
- `audit_events` — actor, action, entity, time, summary, correlation ID
- `condition_reports` — before/after room condition notes
- `incidents` — issue status, reviewer, and resolution note
- `room_booking_policies` — per-room request enablement, slot interval, notice, duration, and buffer
- `profile_eligibility` — server-owned requirement verification state
- `bookings.submission_key` / `request_payload_hash` — requester-scoped idempotent submission
- `bookings.eligibility_snapshot_json` — eligibility warnings retained on a request receipt
- `bookings.cancelled_by` / `cancelled_at` / `cancellation_reason` — requester cancellation record
- `bookings.eligibility_override_reason` / `eligibility_override_requirement_ids_json` — one-booking human eligibility exception
- `access_events.actor_id` / `booking_id` / `reader_id` / `request_hash` — Phase 4 access context and nonce replay protection
- `bookings.checked_in_at` / `checked_out_at` / `closed_at` / `closure_reason` — lifecycle timestamps and outcome
- `condition_reports.condition_state` — `left_as_found` or `issue_found`
- `incidents.manager_reviewed_by` / `manager_reviewed_at` / `manager_review_note` — manager review
- `incidents.resolved_at` plus existing reviewer/resolution fields — final admin resolution

Key constraints include:

- valid role and account-status enumerations;
- positive room capacity and expected attendance;
- `end_at > start_at` for bookings;
- a room manager must hold the manager role;
- credentials must have revocation metadata consistent with their state;
- resolved incidents must have a reviewer and resolution note;
- access and audit events cannot be updated or deleted;
- a confirmed booking cannot overlap another `approved` or `checked_in` booking in the same room;
- a request submission key is unique per requester when present;
- verified eligibility rows require a verifier and verification timestamp;
- Phase 3 decision writes require a non-empty reason and an active assigned manager/admin actor;
- Phase 3 cancellation writes require requester ownership, timestamp, and reason;
- unsupported status transitions are rejected by a database trigger;
- eligibility overrides store both a reasoned explanation and the exact requirement IDs;
- access events require a room/time/credential/result record and are append-only;
- only the access service can transition `approved → checked_in`;
- `checked_in → completed` requires an after-use condition report and checkout/close timestamps;
- `checked_in → incident` requires an after-use report and an open incident;
- `incident → completed` requires every linked incident to be resolved;
- condition reports are append-only with one report per stage per booking;
- resolved incidents are immutable and require an admin reviewer, timestamp, and final note.

Timestamps are stored as ISO-8601 UTC strings. The application reads `ROOMRELAY_CAMPUS_TIMEZONE` and converts date/time form values with explicit DST-gap/fold rejection. Booking intervals are half-open, `[start_at, end_at)`. Pending requests do not reserve inventory; only `approved` and `checked_in` records block discovery and submission. An approved booking is eligible for an access check only inside its exact window; approval is not itself an access event.

## Security model

### Implemented

- Password hashes use Node's scrypt with 16-byte random salts and 64-byte derived keys.
- Sign-in uses a generic error for unknown accounts, incorrect passwords, and suspended accounts.
- A valid scrypt comparison is deliberately performed for unknown emails to reduce timing-based account enumeration.
- Sessions are signed with HS256, expire after eight hours, and use `httpOnly`, `SameSite=Lax`, and `Secure` in production.
- Role and profile status are re-read from the database on every protected request.
- Protected pages live under `/app`, which requires a server-resolved profile.
- Sign-in attempts are rate-limited in memory.
- Form input is validated on the server with Zod.
- Room IDs, requester IDs, statuses, decision fields, eligibility status, and timestamps are resolved or set by trusted server code.
- Room search errors never expose another requester's name, group, purpose, or booking ID.
- Request creation re-reads the profile, room policy, hours, eligibility, and confirmed conflicts inside an immediate SQLite write transaction.
- Request creation uses requester-scoped idempotency keys and a canonical payload hash to make retries safe.
- Duplicate overlapping pending requests from the same user are rejected.
- Room request attempts are rate-limited per active account.
- Manager/admin queue reads are scoped in SQL by current room assignment; admin scope is explicit.
- Decision services reload the actor, booking, room policy, hours, capacity, current eligibility, time, and confirmed conflicts inside an immediate transaction.
- Approval/rejection reasons are requester-visible and decision metadata is written atomically with an audit event.
- Eligibility override is a per-booking human exception, requires a reason, and does not alter `profile_eligibility`.
- Requester cancellation verifies ownership and the before-start cutoff; cancellation metadata and audit event commit atomically.
- Access checks are server-calculated, use the current persisted actor and server time, and fail closed.
- Credential ownership, active/revoked state, room state, booking state/ownership, and exact time window are rechecked on every attempt.
- Access events and their audit records are append-only and commit atomically; first valid access changes `approved` to `checked_in`.
- Access history is scoped by actor for students, room assignment for managers, and institution-wide only for admins.
- Nonces provide requester-scoped idempotency; mismatched replays are rejected.
- Requester check-out and incident creation commit condition report, state change, and audit records atomically.
- Condition reports reject update/delete; resolved incidents are immutable.
- Incident manager review is scoped to assigned rooms; final resolution is admin-only.
- Booking completion after incidents requires all linked incidents to be resolved.
- Lifecycle timelines are assembled from authorized booking, access, condition, incident, and audit records.
- The database file is server-only and ignored by Git.
- Access and audit tables reject updates and deletes.
- Confirmed booking overlap, decision metadata, cancellation metadata, access context, condition reports, incident review, and allowed transitions are guarded by database triggers.
- Security headers are set for content sniffing, framing, referrer policy, and browser feature permissions.

### Known limitations

- The in-memory rate limiter is per-process and resets on restart; production needs shared rate-limit storage.
- No session revocation list, MFA, password reset, email verification, or device management.
- Demo passwords are public by design; seeded eligibility/policy values, incidents, and the active access window are illustrative fixtures.
- Pending requests intentionally do not reserve inventory; there is no waitlist or automatic allocation.
- Manager/admin check-out on behalf of a requester, appeals, notifications, photo evidence, and automatic penalties are not implemented.
- The access simulator does not support physical readers, device-authenticated controllers, anti-replay hardware protocols, offline grants, or live door control.
- SQLite is a single-instance datastore and is not suitable for horizontally scaled serverless deployments without a persistent volume/migration.
- There is no real campus SSO, eligibility roster, NFC hardware, or door integration.
- `script-src` is not yet restricted with a nonce-based Content Security Policy.

## Health check

`GET /api/health` returns a no-store JSON status and never exposes configuration values:

```json
{
  "status": "ok",
  "service": "roomrelay",
  "phase": 5,
  "database": "ok",
  "migrations": 5,
  "checkedAt": "2026-10-28T06:01:07.556Z"
}
```

It returns HTTP 503 with a safe reason if the database is uninitialized, the session secret is invalid, or the database cannot be reached.

## Testing

```bash
npm run check
```

The suite covers:

- migrations applying once from zero;
- full lifecycle table creation and foreign-key enforcement;
- idempotent seeding with exact fixture counts;
- manager portfolio separation;
- role, time-range, ownership, and append-only constraints;
- correct, incorrect, unknown, case-insensitive, and suspended-account authentication;
- authorization across students, assigned managers, unassigned managers, admins, and suspended admins;
- role-scoped query projections;
- room filter, capacity, facility, building, hours, and confirmed-conflict behavior;
- manager/admin room eligibility visibility boundaries;
- timezone conversion and DST gap/fold rejection;
- pending request creation, trusted-field override resistance, idempotent retries, and audit writes;
- capacity, notice, slot-boundary, duration, out-of-hours, and duplicate-pending validation;
- requester-scoped My requests and cross-user denial;
- manager/admin queue and detail scoping by room assignment;
- approve/reject decisions, stale-state protection, reason validation, and atomic audit writes;
- current eligibility revalidation, one-booking overrides, and profile verification immutability;
- conflict revalidation and database transition/decision/cancellation triggers;
- requester cancellation ownership, cutoff, availability release, and duplicate-event protection;
- access allow/deny policy, exact start/end boundaries, revoked/unknown/non-owned credentials, inactive rooms, pending/cancelled/future bookings, manager/admin non-entitlement, and nonce replay;
- access event/audit atomicity, access history scoping, credential masking, and rate-limit denial logging;
- requester check-out ownership, condition-report requirements, clean completion, issue-to-incident flow, duplicate prevention, and late-checkout behavior;
- incident state transitions, manager room scope, admin-only resolution, multi-incident booking completion, and human-review copy;
- lifecycle timeline sources, ordering, and requester/manager/admin scope;
- session signing, tampering, and wrong-secret rejection;
- safe redirects that reject open-redirect payloads;
- rate-limit windows and key isolation.

The current suite contains 122 tests across 16 files.

`npm run test:smoke` additionally starts the production server and checks the live `/api/health` response, login page, anonymous redirects, room discovery, request and manager flows, the access simulator, access history scoping, requester incident pages, manager/admin incident routes, anonymous API rejection, and simulation notices over HTTP. It uses port `3107` and requires a production build plus an initialized database.

## Deployment

A public preview has not been provisioned because no hosting-provider credentials were supplied. The GitHub Actions workflow validates the application. The included Docker configuration is ready for a single-instance deployment with persistent storage.

### Docker Compose

Generate a real session secret first:

```bash
export ROOMRELAY_SESSION_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))")"
docker compose up --build
```

The app is available at `http://localhost:3000`. Demo data lives in the named `roomrelay-data` volume. The container runs migrations and the idempotent seed before starting Next.js.

For a public deployment:

1. Deploy the image to a host that supports a persistent volume, or migrate the data layer to PostgreSQL first.
2. Provide `ROOMRELAY_SESSION_SECRET` as a runtime secret.
3. Set `ROOMRELAY_CAMPUS_TIMEZONE` to the institution's IANA timezone.
4. Mount `/app/data` on persistent storage.
5. Set `ROOMRELAY_DB_PATH` if the volume uses a different path.
6. Verify `/api/health` before sharing the URL.

### Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ROOMRELAY_SESSION_SECRET` | Yes | — | 32+ characters; do not reuse the demo value |
| `ROOMRELAY_DB_PATH` | No | `./data/room-relay.db` | Absolute path or path relative to app root |
| `ROOMRELAY_CAMPUS_TIMEZONE` | No | `Europe/London` | Must be a valid IANA timezone |

See `.env.example`. Never commit `.env.local` or a populated database.

## Project documents

- [`plan.md`](docs/plan.md) — phased build plan
- [`phase-1-prd.md`](docs/phase-1-prd.md) — detailed Phase 1 product requirements
- [`phase-2-prd.md`](docs/phase-2-prd.md) — detailed Phase 2 product requirements
- [`phase-3-prd.md`](docs/phase-3-prd.md) — detailed Phase 3 product requirements
- [`phase-4-prd.md`](docs/phase-4-prd.md) — detailed Phase 4 product requirements
- [`phase-5-prd.md`](docs/phase-5-prd.md) — detailed Phase 5 product requirements
- [`RoomRelay_Project_Context.pdf`](docs/RoomRelay_Project_Context.pdf) — source hackathon concept and blueprint

## Next phase

**Phase 6 — Hardening and submission:** deployment, complete role/state/concurrency testing, backup demo, documentation, and final submission materials.
