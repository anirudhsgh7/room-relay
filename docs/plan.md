# RoomRelay Build Plan

## Goal

Build a working university room-booking and access-management prototype that connects room discovery, booking approval, time-bound access checks, check-out, and an auditable history. The core product must work without NFC hardware; hardware is an optional demonstration layer.

## Current repository state

Phases 1–5 are implemented. The repository now contains a runnable Next.js application, server-verified demo authentication, the lifecycle SQLite schema, idempotent demo data, active room discovery, pending booking requests, room-scoped manager decisions, audited eligibility overrides, requester cancellation, time-bound simulated access decisions, append-only access events, role-scoped access history, requester check-out and condition reports, incident review/resolution, a connected lifecycle timeline, automated tests, a production smoke test, CI, and Docker deployment configuration. See [`README.md`](../README.md) for setup, demo accounts, the stack decision, and current limitations.

A public preview URL has not been provisioned because no hosting-provider credentials were available. The PDF describes prior STM32/ESP32 and ST25R3911AQB-W work, but that firmware and hardware compatibility are not present here and must be verified before promising integration.

## MVP scope

### Roles

- **Student / club lead:** browse rooms, submit and cancel own requests, check in/out, and view own booking history.
- **Room manager:** manage assigned room availability and approve or reject requests with a reason.
- **Administrator:** manage rooms and credentials and review institution-wide audit events.

### P0 — required workflow

1. Browse and filter rooms by time, capacity, building, and facilities.
2. View room details, allowed use, and eligibility requirements.
3. Submit a booking request with time, purpose, and expected attendance.
4. Validate eligibility, room hours, and booking conflicts on the server.
5. Allow an authorized manager to approve or reject with a recorded reason.
6. Check access through a server-side policy decision, initially via a clearly labelled simulator.
7. Check out, record a room-condition confirmation, and inspect the event history.

### Defer until the core flow is reliable

Waitlists, fair-use quotas, notifications, photos, analytics, calendar export, QR access, and real door control. Add NFC only as an adapter after the simulated access path is complete and tested.

## Recommended implementation defaults

- **Application:** Next.js, React, and TypeScript.
- **UI:** Tailwind CSS or a small existing component library; responsive campus-operations style with clear text status labels.
- **Authentication and database:** Supabase Auth and PostgreSQL.
- **Server logic:** Next.js route handlers/server actions or equivalent trusted API endpoints.
- **Deployment:** Vercel or another publicly reachable host.

Use the repository's existing conventions if they are introduced before implementation. Keep authorization and booking/access decisions server-side; do not trust role or approval values supplied by the browser.

## Delivery phases

### Phase 1 — Foundation and demo definition

- Initialize the app, formatting/linting, environment configuration, and deployment pipeline.
- Define roles, booking states, room policies, and the judge demo journey.
- Create seeded demo users for each role, rooms, credentials, and example bookings.
- Implement the initial database schema and access policies.

**Exit condition:** the app runs locally and in a hosted preview, with dependable demo data and clear role separation.

### Phase 2 — Room discovery and booking requests

- Build room listing, filters, room detail, and booking request screens.
- Add booking form validation and server-side eligibility and hours checks.
- Block overlapping approved bookings using a transaction-safe database/server check.
- Show pending, conflict, and eligibility states with actionable explanations.

**Exit condition:** a student can find a suitable room and submit a persistent request; conflicting confirmed bookings cannot both succeed.

### Phase 3 — Manager review

- Build a manager queue scoped to rooms assigned to that manager.
- Add approve/reject actions and required decision reasons.
- Show booking status and decision details to the requester.
- Add cancellation and ensure cancelled bookings cannot authorize future access.

**Exit condition:** the request can be processed end to end, and ordinary users cannot invoke manager-only actions.

### Phase 4 — Access policy and event history

- Implement a server-side access-check endpoint and a clearly labelled “Simulate NFC tap” UI.
- Validate active credential, user status, room/reader mapping, approved booking, and current time window.
- Return an allow/deny decision with a safe reason code and persist every attempt.
- Add an append-only audit timeline for requests, decisions, cancellations, access attempts, and permission changes.

**Exit condition:** valid access is allowed; unapproved, out-of-window, cancelled, or revoked access is denied and logged.

### Phase 5 — Check-out and incident handling

- Add check-out and a room-left-as-found confirmation.
- Allow users to report an issue; provide a basic manager/admin review status and resolution note.
- Keep sanctions or penalties subject to human review.

**Exit condition:** a booking reaches Completed or an incident workflow, and the result appears in its history.

### Phase 6 — Testing, polish, and submission

- Test role permissions, eligibility failures, booking overlap (including concurrent requests), access-window boundaries, revocation, cancellation, and check-out.
- Polish responsive layout, empty states, loading/error states, and accessible status messaging.
- Seed a reliable demo scenario with one pending request, one confirmed booking, and one denied-access case.
- Deploy and verify the public link; document setup, demo accounts, test instructions, architecture, privacy/security decisions, limitations, and hardware simulation.
- Record a short backup demo and prepare the final project submission.

## Suggested 48-hour order

| Time | Focus | Exit condition |
| --- | --- | --- |
| 0–3 h | Freeze workflow, roles, states, schema, setup, and deployment | Demo journey and rules are unambiguous |
| 3–8 h | Auth/demo roles, seed data, room listing/detail/search | Judge can browse rooms |
| 8–14 h | Request form, eligibility and conflict checks | Request persists; overlaps are blocked |
| 14–19 h | Manager queue, decisions, reasons, cancellation | Request is processed end to end |
| 19–24 h | Server access policy, simulator, access-event logging | Valid and invalid attempts are distinguishable and logged |
| 24–29 h | Check-out, condition/incident reporting, audit timeline | Lifecycle reaches completion with history |
| 29–34 h | Reliability buffer for workflow gaps and critical fixes | Core journey remains dependable |
| 34–39 h | UX, responsive layout, empty/error states | Judge path has no broken states |
| 39–44 h | Must-pass tests, demo data, critical bug fixes | Fresh demo session is reliable |
| 44–48 h | Backup demo, README/submission, deployment verification | App and submission materials are judge-ready |

If time is tight, defer optional polish before cutting the booking-to-return workflow.

## Initial data model

Start with the minimum tables needed for the lifecycle; add optional detail only when a screen or rule needs it:

- `profiles`: user identity, role, and active status.
- `rooms`: name, building/location, capacity, facilities, manager, hours, and policy/status.
- `bookings`: room, requester, purpose, start/end, status, and decision reason.
- `credentials`: user, credential reference/type, active state, and revocation time.
- `access_events`: credential, room, timestamp, allow/deny result, reason, and reader/controller reference.
- `audit_events`: actor, action, entity, timestamp, summary, and correlation ID.
- `condition_reports` / `incidents`: booking, notes, status, submitter, reviewer, and resolution.

Store timestamps in UTC and display campus-local time. Keep audit events append-only; record corrections as new events.

## Must-pass acceptance checks

- A user can browse and filter rooms and submit a request.
- A request appears in the manager queue; only an authorized manager can approve/reject it.
- Two overlapping approved bookings for the same room cannot both succeed.
- Access is denied when there is no approved booking, the credential is inactive/revoked, or the attempt is outside the allowed time window.
- Every access attempt records a timestamp, decision, and reason.
- Cancellation blocks future access while preserving historical events.
- A booking can be checked out/closed and the outcome appears in history.
- The complete judge demo works with no physical NFC hardware connected.

## Safety and scope guardrails

- Never treat a tag UID as production-grade authentication; keep credential mapping and authorization in trusted software.
- Do not silently grant access when the service is unavailable; the MVP requires the service for authorization.
- Keep emergency egress independent and do not use a prototype relay on a live restricted door without institutional approval and safety review.
- Clearly distinguish simulated access from a real door unlock in the UI, demo, and documentation.
- Keep privacy data minimal and restrict access history by role.
- Do not use AI as the final authority for access, safety, or penalties.
