# RoomRelay — Phase 2 Product Requirements Document

**Phase:** Room discovery and booking requests  
**Status:** Implemented  
**Depends on:** Phase 1 foundation  
**Source of truth:** `RoomRelay_Project_Context.pdf`, `plan.md`, `phase-1-prd.md`, and the Phase 1 implementation in this repository  
**Current implementation baseline:** Next.js 16 App Router, React 19, TypeScript, server-only SQLite (`better-sqlite3`), signed HTTP-only sessions, scrypt password hashes, and a single configured campus timezone.

---

## 1. Executive summary

Phase 2 turns the authenticated RoomRelay foundation into a useful first product workflow: a student can discover a suitable campus room, understand its availability and rules, submit a booking request, and see the request persist as **Pending**.

This phase must answer the student's practical questions before they send a request:

- Is the room suitable for my group size and equipment needs?
- Is the room active and open for the requested time?
- Does an already-approved booking make this time unavailable?
- Does the room have eligibility requirements, and are they verified for my account?
- If I submit, am I approved to enter?

The answer to the final question must be unambiguous: **no**. Phase 2 requests are pending manager review. The system must never convert a request to `approved` automatically. Manager decisions are Phase 3.

Phase 2 adds a room catalog and detail experience, a request form, a requester-owned request list, server-side schedule/eligibility/capacity validation, conflict feedback, and transaction-safe persistence. It does not add a manager queue, approval/rejection actions, cancellation, access checks, door control, or notifications.

---

## 2. Product context and problem

Campus room supply and student demand are often coordinated through disconnected calendars, messages, and informal approvals. A calendar may show a time but not who can use the room, what equipment it has, what restrictions apply, whether the room is already approved for another group, or whether a request is merely pending.

RoomRelay should make the discovery and request phase clear and trustworthy. It is not a generic event calendar. Room information, hours, policy requirements, capacity, and the meaning of the booking state all matter.

### Phase 2 product outcome

An authenticated student can find a suitable active room, inspect its rules and time window, submit a valid request, receive a persistent pending request, and find it again in **My requests**. Invalid, unavailable, over-capacity, or unauthorized requests are rejected with safe and actionable explanations.

### Relationship to the overall lifecycle

```text
Phase 1 foundation
    ↓
Phase 2 discover → request → validate  ← this PRD
    ↓
Phase 3 manager review → approve/reject
    ↓
Phase 4 time-bound access checks
    ↓
Phase 5 close-out, incidents, and audit timeline
```

Phase 2 establishes booking data and validation rules that Phase 3 must reuse. It must not implement a separate or client-only path that the manager approval phase can bypass.

---

## 3. Goals and success measures

### Goals

1. Make active rooms discoverable through practical filters.
2. Explain a room's capacity, facilities, building/location, permitted use, hours, and eligibility requirements before a request is submitted.
3. Convert a local campus date/time selection into validated UTC booking timestamps consistently.
4. Persist requests as `pending` and show the requester that a pending request is **not permission to enter**.
5. Enforce eligibility visibility, room hours, capacity, active-room status, and approved-booking conflicts on the server.
6. Ensure repeated submissions do not accidentally create duplicate requests.
7. Ensure concurrent requests cannot bypass the confirmed-booking conflict invariant.
8. Keep all private request data scoped to the requester; avoid disclosing another group’s identity, purpose, or request details.
9. Integrate with the Phase 1 visual system, authentication, seed data, test setup, and deployment model without external-service dependencies.

### Success measures

- A student can find a room using at least one combination of date/time, capacity, building, and facility filters.
- A room detail view communicates all information needed to decide whether to request it.
- A valid request appears in both the success response and the student’s persisted request list after navigation or refresh.
- Every new request is `pending`; no request path accepts a client-specified status.
- The student is explicitly told that pending is not authorization to enter.
- Room hour, capacity, policy, and conflict checks run on the server using database-backed room data.
- An approved/checked-in overlap returns a conflict result without inserting a new request.
- Adjacent half-open intervals such as 16:00–17:00 and 17:00–18:00 do not conflict when the configured buffer is zero.
- Replaying an idempotency key returns the original result rather than creating another booking.
- A student cannot view another student’s request by changing a URL, room code, booking ID, form field, or request body.
- `npm run check` passes, including tests for boundary times, DST behavior, eligibility, conflict rules, and role scoping.

---

## 4. Target users and permissions

### Student / club lead

Primary Phase 2 actor. Can browse active rooms, view room policies, check availability, submit requests for themselves, and list/read their own requests. A student cannot choose another requester ID, approve a request, edit a room’s policy, or read another group’s request details.

### Room manager

Can browse the same active room catalog and read public room rules. Phase 2 does not yet provide manager request queues, private request lists, approval actions, rejection actions, or edits to availability. Room ownership remains relevant to Phase 3, but does not grant a manager access to student request details in Phase 2.

### Administrator

Can browse the same active catalog. Admin room management and institution-wide booking review are not in Phase 2. The admin role must not be treated as an implicit student role for creating requests.

### Suspended/inactive account

Cannot access `/app` or execute a request action. Existing session cookies are insufficient when the persisted profile is suspended; Phase 1's per-request profile lookup remains authoritative.

### Unauthenticated visitor

May view the public landing and login pages only. Room inventory, availability, eligibility verification, and booking data are private to authenticated workspace users in this phase.

### Phase 2 action matrix

| Action | Student | Assigned manager | Unassigned manager | Admin | Anonymous |
| --- | --- | --- | --- | --- | --- |
| View active room catalog | Yes | Yes | Yes | Yes | No |
| Search/filter active rooms | Yes | Yes | Yes | Yes | No |
| View active room details and public policy | Yes | Yes | Yes | Yes | No |
| See the viewer’s own requirement-verification state | Yes | No | No | No | No |
| Submit a request as self | Yes | No | No | No | No |
| Read own requests | Yes | No | No | No | No |
| Read another user’s request | No | No in Phase 2 | No in Phase 2 | No in Phase 2 | No |
| Approve/reject a request | No | No in Phase 2 | No in Phase 2 | No in Phase 2 | No |

---

## 5. Scope

### In scope — P0

- Server-rendered active room catalog.
- Room search and filters for requested date/time, capacity, building, and facilities.
- Room detail page with facilities, hours, policy, requirements, and availability feedback.
- Student booking-request form for one room and one time interval.
- Current-user-only **My requests** list and request detail/status view.
- Server-side Zod validation of all submitted fields.
- Server-side authorization from the persisted session profile.
- Eligibility requirement display backed by a verification record.
- Server-side room-hours, duration, notice, capacity, and availability checks.
- Persistent `pending` booking creation with idempotency.
- Safe conflict state and simple alternative suggestions when available.
- Transaction-safe protection of the approved/checked-in no-overlap invariant.
- Audit event for a successful request submission.
- Responsive, accessible loading/error/empty/success states.
- Database migration(s), deterministic fixtures, domain/service tests, and an HTTP smoke test update.

### Out of scope

- Manager request queue, approval, rejection, request changes, or override reason: Phase 3.
- Cancellation, request editing/resubmission, waitlisting, or promoting a request.
- Access authorization endpoint, simulated tap, QR, NFC, door output, or physical access hardware.
- Check-in/out, condition reporting, incidents, overdue reminders, or full audit timeline.
- Recurring reservations, multiple rooms per request, room setup/cleanup, or multi-day bookings.
- Attachments, photo evidence, email/in-app notifications, ICS export, analytics, or AI matching.
- Campus identity-provider integration or institutional eligibility integrations.
- Showing another requester’s name, group, purpose, or pending request details in search results.
- Allowing managers/admins to submit student requests in this phase.

---

## 6. Booking and availability policy decisions

The following rules must be implemented consistently in search, room detail, request validation, database constraints, and tests.

### 6.1 Booking status semantics

- All requests created in Phase 2 have status **`pending`**.
- `pending` means a request has been recorded and awaits a room-manager decision.
- `pending` does not reserve the room, grant access, or guarantee approval.
- Only manager actions in Phase 3 may transition a request to `approved` or `rejected`.
- A submitted form must never set `approved`, `checked_in`, or any other privileged status.
- Existing seeded booking records in other states remain fixtures for later phases. Phase 2 must not reinterpret them as new request outcomes.

### 6.2 Blocking bookings and overlap definition

For discovery and request-time validation, the following booking states block a room interval:

- `approved`
- `checked_in`

Other states do not reserve the room in Phase 2. In particular, `pending` is not a confirmed reservation. The user must be told that a request can still be declined during Phase 3 review.

Booking intervals use half-open semantics: `[start_at, end_at)`. Two intervals overlap when:

```text
existing.start_at < requested.end_at
AND existing.end_at > requested.start_at
```

The room's configured `buffer_minutes` is applied to the blocking interval by expanding the end of the blocking booking. The Phase 2 seed default is zero minutes. A buffer is a demo policy setting and must not be described as a universal campus rule.

The database must reject any insert/update that would create overlapping `approved` or `checked_in` bookings for the same room, even if an application service makes a mistake. The Phase 2 request service must also re-check conflicts inside a write transaction. Phase 3 approval must re-check and set the status inside the same atomic transaction.

### 6.3 Pending-on-pending behavior

- Different users may have overlapping pending requests. Pending requests do not reserve inventory.
- Search does not reveal that another user's pending request exists or expose its timing, purpose, or identity.
- The request confirmation explains that manager review is still required and availability is not guaranteed until approval.
- A user cannot submit the same request repeatedly through a retried form because of idempotency protection.
- If the same user has another pending request for the same room with an overlapping interval, return a private duplicate/self-conflict state rather than making a second overlapping request. Do not expose another user's data.
- Phase 3 must surface pending overlaps to assigned managers and prevent a second approval from violating the confirmed-booking invariant.

### 6.4 Room schedule rules

- A room must be `active` to appear in discovery or accept a request.
- A request must be fully inside an active recurring availability window for that room and campus-local weekday.
- The `availability_rules.weekday` convention is `0 = Sunday` through `6 = Saturday`.
- The request cannot span multiple local dates in Phase 2.
- Overnight availability is out of scope.
- A room with no matching active availability rule is closed for the requested interval.
- A request must not overlap room closing time. Ending exactly at closing time is permitted.
- Room availability and booking conflicts are separate checks: open hours do not mean the slot is free.

### 6.5 Request time and duration rules

Room-specific values should live in a structured policy record rather than being inferred from prose in `policy_summary`:

- `slot_interval_minutes`: seeded default 30 minutes.
- `minimum_notice_minutes`: seeded default 30 minutes.
- `maximum_duration_minutes`: seeded default 240 minutes (4 hours).
- `buffer_minutes`: seeded default 0 minutes.
- `requests_enabled`: whether students may submit requests for this room.

These are illustrative demo defaults. Keep them editable through a future admin capability; do not claim they are institution-wide policy. A request must:

- begin strictly after the server's current time;
- satisfy the configured minimum notice;
- start and end on a valid slot boundary in campus-local time;
- have positive duration no longer than the room's configured maximum;
- fall on one local calendar date;
- fit within opening hours;
- have an end time after its start time after timezone conversion.

### 6.6 Timezone and daylight-saving behavior

- The campus IANA timezone comes from `ROOMRELAY_CAMPUS_TIMEZONE`; the default remains `Europe/London` for the demo.
- HTML date/time input values are campus-local wall-clock values, not UTC strings.
- The server converts local selections to UTC before saving.
- The server uses a timezone-aware conversion strategy that explicitly detects nonexistent and ambiguous wall times.
- A nonexistent time during a daylight-saving spring-forward gap is rejected with a clear message.
- An ambiguous time during a fall-back transition is rejected unless the product has a deliberate disambiguation control. Phase 2 does not add that control.
- Search, detail, confirmation, and request-list screens render times in the campus timezone and do not depend on the visitor's device timezone.
- Database ordering and overlap queries operate on normalized UTC timestamps.

### 6.7 Capacity and facilities

- Expected attendance must be an integer greater than zero.
- Expected attendance cannot exceed room capacity.
- A capacity mismatch returns a clear validation error and does not insert a booking.
- Facility filters use the room's normalized facility values, not free-form client-supplied labels.
- Multiple selected facilities use AND semantics: a result must support every selected facility.
- Building matching is exact against known values; the UI may offer a text filter, but the server must normalize whitespace/case and parameterize the query.

### 6.8 Eligibility semantics

- Each active requirement is displayed with its type/description and whether it is mandatory.
- A natural-language acknowledgement is not proof that training or membership has been verified.
- A profile/requirement verification record is server-owned; students cannot mark themselves verified.
- Required-but-unverified requirements are shown as a warning before submission.
- In Phase 2, a student may submit a request with an unverified requirement if `requests_enabled` permits it. The request remains `pending`; there is no auto-approval.
- The success state and My requests detail preserve the fact that eligibility needs review.
- Later manager approval must re-check requirement state at decision time and must not approve an unsatisfied mandatory requirement except through an explicit, audited human override implemented in Phase 3 or later.
- Search does not hide a room solely because a student's requirement is not verified; users must be able to discover restrictions before deciding whether to request.

---

## 7. User journeys

### Journey A: eligible student finds and requests a seminar room

1. Amelia signs in with the Phase 1 student demo account.
2. She opens **Room discovery** from the authenticated workspace.
3. She selects the desired campus-local date, start and end time, minimum capacity 12, building, and projector facility.
4. The result list shows active rooms that match those filters and are not blocked by an approved or checked-in booking in that interval.
5. She opens Seminar Room 02 and reviews the room capacity, facilities, local hours, permitted use, and demo policy.
6. The page shows her club briefing as verified.
7. She enters purpose, group name, attendance, and slot, reviews the acknowledgement, and submits.
8. Server-side checks run again using trusted room/profile data.
9. A single booking is saved as `pending`, and an audit event is appended.
10. The confirmation page states “Request submitted — awaiting manager review. This is not permission to enter.”
11. The request appears in **My requests** after refresh.

### Journey B: student requests a room while eligibility is unverified

1. Amelia opens Media Studio 01.
2. Room detail explains the equipment-induction requirement and shows it as “Not verified for this account.”
3. The request flow explains that the submission will require human review and will not authorize use.
4. If she proceeds, a valid request is stored as `pending` with the eligibility snapshot recorded in the audit metadata.
5. The confirmation and My requests entry retain the warning; no client checkbox can turn it into a verified requirement.

### Journey C: room time conflicts with an approved booking

1. The student filters for an interval overlapping an approved or checked-in booking.
2. The room appears as unavailable for that interval, or the room detail displays a safe conflict state.
3. The UI does not reveal who holds the booking or its purpose.
4. The request action is disabled or returns a validation error if the user changes client data and tries to submit anyway.
5. The server returns one or more safe alternatives when practical; it does not create a pending request for the blocking interval.

### Journey D: stale/modified form submission

1. A student opens an available time.
2. The room is deactivated, its hours/policy change, or an approved booking is created before the form is submitted.
3. The server re-reads current room state and policy inside the submit path.
4. The stale request fails safely with a refresh/research prompt; no booking is inserted.

### Journey E: request retry/double-click

1. The student submits once; the browser or connection retries the same form payload with the same idempotency key.
2. The service returns the original booking receipt rather than creating a duplicate.
3. If the same key is reused with materially different normalized fields, the service returns an idempotency mismatch and creates no second booking.

---

## 8. Information architecture and routes

All routes below are authenticated under `/app` and use the Phase 1 server-resolved profile.

### `/app/rooms`

Room discovery page. Contains:

- search/filter form;
- selected-filter summary;
- results count;
- room cards;
- available/closed/unavailable status for the requested interval;
- empty, invalid-filter, and service-error states.

Search/filter state is URL-addressable with safe, allowlisted query parameters so a refresh preserves the selected search. Sensitive information is never encoded in the URL.

### `/app/rooms/[code]`

Room detail page. Contains:

- name and human-readable location;
- capacity, facilities, permitted-use summary, and room status;
- weekly room hours in campus-local time;
- structured request constraints such as minimum notice, slot increment, maximum duration, and buffer;
- active eligibility requirements and the current student's verification state;
- availability feedback for an optional selected interval;
- a link to start a request if the room accepts student requests.

Unknown and inactive room codes return a not-found or safe unavailable response. They must not expose a private room record.

### `/app/rooms/[code]/request`

Booking request form. Contains:

- requested date, start time, and end time;
- purpose;
- optional group name;
- expected attendance;
- eligibility notices;
- concise room-rule summary;
- explicit review/submit action;
- unique idempotency key for this form instance;
- success, validation, conflict, unavailable, and service-error states.

A nested route or equivalent dialog is acceptable if it preserves the same direct-link, refresh, accessible, and server-validation behavior.

### `/app/bookings`

Student-only **My requests** page. Shows only records where `requester_id` matches the authenticated profile. The page may display seeded records in all known statuses for demonstration but must not infer that the user can perform a future-phase action. Each row shows room, campus-local date/time, purpose/group as appropriate, attendance, status, and decision reason when one exists. No cancel/edit controls are included in Phase 2.

### Workspace navigation

- Enable **Room discovery** in the sidebar for all authenticated roles.
- Enable **My requests** for students only.
- Keep manager decisions, access checks, audit timeline, and other future features disabled/non-clickable until their phase.
- Managers/admins can use discovery/detail but do not see a student request submission CTA.

---

## 9. Screen-level requirements

### 9.1 Room discovery

#### Filters

| Filter | Input | Behavior |
| --- | --- | --- |
| Date | Date input | Required when checking a time-specific slot; date interpreted in campus timezone |
| Start time | Time input | Must match room slot increment; campus-local wall time |
| End time | Time input | Must be after start; within same local date |
| Minimum capacity | Positive integer | Return rooms whose capacity is greater than or equal to value |
| Building | Select or autocomplete over known values | Match exact known building after safe normalization |
| Facilities | Multi-select/check list | AND semantics across selected facilities |
| Clear all | Button/link | Removes optional filters and returns to the catalog |

If the user supplies a date without both times, the catalog can still filter room features and show regular hours without claiming a specific slot is free. If only one time is provided, return a validation state rather than an incomplete availability result.

#### Room card contents

- room name and code;
- building and concise location;
- capacity;
- up to three facilities plus a count of additional facilities;
- relevant usage/eligibility chip(s);
- status for the selected slot: `Available for request` or `Unavailable` for students; other roles see the availability state without a student-request CTA;
- a clear link to room detail.

Do not label a free time “booked” unless the system has a blocking confirmed booking. A requestable room is still subject to validation and approval.

#### Search result ordering

1. Rooms matching all filters.
2. For a time-specific query, requestable rooms first.
3. Within that grouping, order by capacity fit (smallest sufficient capacity first) to avoid defaulting users to the largest room.
4. Stable tie-break by building, then room code.

Do not use user trust scores, club popularity, protected attributes, or an opaque AI score.

### 9.2 Room detail

Room detail must show policy before a user starts a request. It must distinguish:

- **Room availability:** whether a selected interval is within hours and unblocked by an approved/checked-in booking.
- **Eligibility:** whether the viewer's requirement records are verified.
- **Booking authorization:** not available at this stage; a submitted request is pending until a manager acts.

The page must not expose pending requests or other users' booking purposes.

### 9.3 Request form

Required fields:

- `startDate` (local date in configured campus timezone);
- `startTime` (local time on configured interval);
- `endTime` (same local date, later than start);
- `purpose` (trimmed plain text, 10–500 Unicode characters);
- `expectedAttendance` (integer 1 through room capacity).

Optional field:

- `groupName` (trimmed plain text, 2–80 characters).

Rules:

- The room ID/code and requester ID must come from trusted route/session data, not hidden fields treated as authority.
- Status, manager ID, decision actor, decision reason, eligibility verification, created timestamp, and UTC conversion are server-owned.
- The request form displays room capacity and requirements near related fields.
- Submit button enters a pending state, disables duplicate clicks, and communicates the action (`Submit request`, not `Book now` or `Reserve now`).
- A required acknowledgement must read substantially: “I understand this request is pending manager approval and does not authorize entry.”
- Acknowledgement is a record of notice, not a substitute for policy/eligibility verification.
- A new opaque idempotency key is generated for the form instance; validation errors preserve the key so a network retry remains idempotent.

### 9.4 Request confirmation

On successful submission, show:

- a success indicator and request reference;
- room, requested local date/time, purpose/group, and attendance;
- explicit status label **Pending review**;
- clear statement: **“This request is not permission to enter. Wait for manager approval.”**
- any outstanding eligibility warning;
- link to My requests;
- link back to room detail.

Do not imply that a notification was sent. Notifications are out of scope.

### 9.5 My requests

- Default sort: next future `pending`/`approved`/`checked_in` request first, then most recently updated historical request.
- Filter states may be provided if simple; status filters must be allowlisted.
- Show a clear empty state with a link to discover rooms.
- Show status labels with both text and accessible color treatment.
- A pending request states that manager review is still needed.
- Approved/rejected seeded records show their existing decision reason as supplied by fixture data.
- Phase 2 exposes no cancellation/edit/approval action for any state.
- A request ID lookup is always scoped to the authenticated requester.

---

## 10. Functional requirements

### FR-2.01 — Role-protected discovery

- Room discovery and room detail require an active authenticated profile.
- `student`, `manager`, and `admin` may read the active room catalog.
- Suspended users, unknown sessions, and anonymous visitors are denied.
- Role is loaded through the existing server session/profile path.

**Acceptance:** direct requests to protected room routes redirect unauthenticated users to login; a suspended user cannot view inventory; no client role parameter changes access.

### FR-2.02 — Active room catalog

- List active rooms regardless of whether requests are enabled, so catalog visibility is separate from request permission.
- For a room with `requests_enabled = false`, show its room details and policy but label it as not accepting requests and omit the student request CTA.
- Do not surface inactive room data in general results.
- Read capacity/facilities/building/policy from the database, not a hard-coded client list.
- Use prepared/parameterized SQL for all filter input.
- Limit result count and paginate or provide a safe “show more” strategy before the fixture set grows.

**Acceptance:** filtering is server-backed, all inactive rooms are excluded, and arbitrary query strings cannot become SQL syntax.

### FR-2.03 — Availability-aware search

- When a complete interval is supplied, determine if each room is open and whether it has a blocking booking.
- Use the canonical shared availability/conflict functions also called by request submission.
- Pending requests are not shown as booking conflicts to other users.
- Return a safe `available`, `outside_hours`, `closed`, `conflict`, or `not_requestable` result; do not include conflicting requester details.
- A stale search result is advisory only; request submission always revalidates.

**Acceptance:** a search cannot show a room as requestable when a current approved/checked-in blocker exists; the result does not leak the other booking's data.

### FR-2.04 — Room details and policy

- Show the active room's full public booking context: location, capacity, facilities, hours, policy summary, structured request policy, and eligibility requirements.
- Load the signed-in student's verification state server-side.
- Treat a missing verification row as unverified.
- Managers/admins viewing a room do not receive another person's verification data.
- Do not render inactive room details to a student; return not-found or safe unavailable.

**Acceptance:** every required room constraint and eligibility requirement is visible before request submission.

### FR-2.05 — Server-side booking request validation

On submission, validate in this order and return a typed safe result:

1. Authenticated profile exists and is active.
2. Role is `student`.
3. Route room exists, is active, and accepts requests.
4. Form fields parse and satisfy bounds.
5. Local date/time is syntactically valid and converts unambiguously under campus timezone.
6. Interval is future, meets minimum notice, uses configured slot increment, stays on one local date, and respects max duration.
7. Attendance does not exceed capacity.
8. The room schedule covers the full interval.
9. Mandatory eligibility requirements are loaded and current verification state is resolved.
10. A blocking confirmed booking does not overlap.
11. The same student does not already have a duplicate overlapping pending request for the same room.
12. The request is inserted with status `pending` inside the transaction.
13. An audit event recording request submission is inserted in the same transaction.

Every validation must be recomputed from trusted database/configuration values. Client-side validation may improve UX but is not authoritative.

**Acceptance:** an invalid value submitted by a direct server action is rejected even if client validation is bypassed; failures do not partially insert a booking or audit row.

### FR-2.06 — Eligibility check and disclosure

- Add a trusted verification record mapping profile to eligibility requirement.
- A student can read only their own verification outcome for the current room.
- Student-submitted acknowledgement never mutates this record.
- If a required requirement is unverified, show it before submission and include requirement IDs/status in the request audit metadata.
- The allowed Phase 2 outcome is still `pending`; no auto-approval or silent eligibility override is allowed.
- If an actual room policy sets `requests_enabled = false`, reject submission even if eligibility is satisfied.

**Acceptance:** an unverified user can never submit a `verified` status; the required warning survives in the confirmation/My requests view; audit metadata records the relevant check without storing unnecessary personal evidence.

### FR-2.07 — Pending request creation

- Every Phase 2 booking creation sets `status = 'pending'` in trusted service code.
- The insert stores requester from the session, room from the route, normalized UTC start/end, normalized form text, attendance, timestamps, and decision fields as null.
- `decided_by`, `decided_at`, and `decision_reason` are not set by a student request.
- Persist request and audit event atomically.
- Return a minimal booking receipt; never send the full database row with credentials or internal metadata.

**Acceptance:** all newly inserted records are pending; caller-supplied `status`, `requester_id`, `decided_by`, or timestamp values have no effect.

### FR-2.08 — Conflict and alternative handling

- Check conflicts against `approved` and `checked_in` states.
- If a blocker exists, do not insert a pending booking.
- Return a safe conflict code and a user-facing message without exposing other booking data.
- When time permits, return up to three deterministic alternatives, ordered earliest first, within the next seven calendar days, using the same room-duration/slot/hours/policy rules.
- Alternative room suggestions must preserve requested minimum capacity and all selected facilities.
- Suggestions are advisory; selecting one always performs a new authoritative validation.
- If no suggestion is found within a bounded search budget, show “Try another time or room” without failure.

**Acceptance:** confirmed conflicts are blocked under concurrent submission; alternative search terminates within a bounded number of candidates and reveals no other user's booking details.

### FR-2.09 — Duplicate protection and idempotency

- Every request form carries a high-entropy/UUID idempotency key generated for that specific form instance.
- The server stores a unique key scoped to requester.
- Repeating the same key with the same normalized payload returns the original booking receipt.
- Repeating the key with a different payload returns an idempotency mismatch error and does not create another row.
- Independently, repeated overlapping pending requests by the same requester for the same room are blocked as a self-duplicate with a link to the existing request.
- The server shall rate limit request submissions per authenticated user, e.g. 10 attempts per 10 minutes, with the limit centralized and adjustable.

**Acceptance:** double click, browser retry, and direct HTTP replay do not create duplicates; another user's idempotency key cannot be used to retrieve their request.

### FR-2.10 — My requests privacy and status

- List and detail queries require an active session and apply `requester_id = authenticatedProfile.id` in the database query.
- No generic “get booking by ID” path may return data before scope verification.
- Unknown and not-owned booking IDs return the same safe not-found behavior.
- My requests includes all current user's booking records with safe status and decision reason fields.
- No student-supplied role, requester ID, or admin flag is used to widen the query.

**Acceptance:** changing a booking ID in a path does not reveal another student's room purpose, group, dates, or status.

### FR-2.11 — Request audit record

- Successful request creation adds one `booking.submitted` audit event with actor, booking entity, timestamp, correlation ID, and concise summary.
- The audit metadata may capture relevant validation outcomes, including outstanding requirement identifiers and the configured rule version/snapshot where needed.
- Do not store passwords, auth tokens, raw credentials, or full sensitive form payload in audit metadata.
- Audit event and booking row are committed/rolled back together.
- Validation failures need not be permanent audit entries; abuse/security metrics may be operational logs without private request content.

**Acceptance:** each newly created request has one corresponding append-only audit event; a failed insert leaves neither row.

### FR-2.12 — Loading, empty, error, and accessibility states

- Provide loading state for search filters and request submission.
- Empty results offer ways to broaden filters or clear them.
- Closed room, capacity failure, eligibility warning, conflict, duplicate, service unavailable, and stale data have distinct human-readable states.
- Validation errors are associated with fields and announced to assistive technology.
- Focus moves to the error summary or first invalid field after a failed form submission where feasible.
- Status must not rely on color alone.
- Keyboard navigation must reach filters, results, form fields, status chips, and actions in logical order.
- Layout is usable at 360px mobile width and desktop widths; avoid horizontal page overflow.
- Honor `prefers-reduced-motion` already established by Phase 1.

**Acceptance:** all key flows can be completed by keyboard, with visible focus and non-color status labels; mobile pages have no unintended horizontal overflow.

---

## 11. Data model and migration requirements

Phase 2 must use versioned migrations and preserve Phase 1 seeded data. Do not edit `001_initial.sql` after it has been applied to an existing environment; add the next migration.

### 11.1 New structured room booking policy

Add a `room_booking_policies` table, one row per room:

| Field | Type/constraint | Meaning |
| --- | --- | --- |
| `room_id` | PK/FK to rooms | Policy owner |
| `requests_enabled` | boolean/integer | Whether student requests may be submitted |
| `slot_interval_minutes` | positive integer | Allowed local-time increments (seed 30) |
| `minimum_notice_minutes` | non-negative integer | Minimum advance notice (seed 30) |
| `maximum_duration_minutes` | positive integer | Maximum request duration (seed 240) |
| `buffer_minutes` | non-negative integer | Cleanup/setup conflict buffer (seed 0) |
| `updated_at` | UTC timestamp | Policy freshness |

Migrate existing rooms to an explicit demo policy. Do not parse `rooms.policy_summary` to make security- or availability-related decisions.

### 11.2 Requirement verification

Add `profile_eligibility` (or a similarly named normalized table):

| Field | Type/constraint | Meaning |
| --- | --- | --- |
| `id` | primary key | Verification record ID |
| `profile_id` | FK to profiles | Person whose requirement is tracked |
| `requirement_id` | FK to eligibility_requirements | Requirement being verified |
| `status` | `verified`, `unverified`, or `expired` | Server-maintained verification state |
| `verified_by` | nullable FK to profiles | Authorized reviewer who verified it |
| `verified_at` | nullable UTC timestamp | Verification time |
| `expires_at` | nullable UTC timestamp | Optional expiry |
| `created_at`, `updated_at` | UTC timestamps | Record lifecycle |

Constraints:

- Unique `(profile_id, requirement_id)`.
- `verified` requires `verified_by` and `verified_at`.
- Student request code does not write this table.
- Absence of a row means unverified.
- Phase 2 does not ship UI to create or update verification records; seed fixtures establish the demonstration states.

### 11.3 Booking request idempotency

Add fields to `bookings` through the new migration:

- `submission_key` — opaque key scoped to requester, nullable for pre-existing/seed records; unique index on `(requester_id, submission_key)` where non-null.
- `request_payload_hash` — hash of canonical normalized request fields used to validate replay equivalence; never store a password/secret here.
- Optional `eligibility_snapshot_json` is not required if the same information is stored in the atomic audit event metadata. Prefer the audit event to avoid duplicating long-lived policy evidence.

The request key is not an authorization token. A key never grants access to a booking unless the current authenticated requester owns the record.

### 11.4 Booking conflict invariant

Add transaction-safe app-service validation and SQLite triggers protecting confirmed states:

- Before insert/update that sets a booking to `approved` or `checked_in`, reject overlapping blocking intervals in the same room, including configured buffer.
- Ignore the row being updated.
- Do not consider `pending`, `rejected`, `waitlisted`, `cancelled`, `completed`, or `no_show` as active blockers unless the explicit state semantics are changed through a reviewed product decision and migration.
- Use one canonical predicate/function so search, submit, and future approval agree.
- Because the current SQLite approach is single-instance, use `better-sqlite3` immediate write transactions plus the database trigger as defense in depth.

### 11.5 Query indexes

Review/add indexes for:

- active room catalog filters (`status`, building/code as appropriate);
- availability lookup by room, weekday, active, and effective date;
- booking interval lookup by room/status/start/end;
- a student's request list by requester/status/start/update;
- requirement lookup by room/active;
- profile requirement verification by profile and requirement;
- unique requester/submission key.

Do not create a generic database API. Database access remains through narrow server-side repository/service methods.

### 11.6 Seed updates

Update the idempotent seed process to include:

- room booking policies for all rooms;
- deterministic verified records for Amelia's club safety briefing;
- an unverified record or absent record for Amelia's media equipment induction;
- relative-time booking examples that stay inside seeded weekday hours;
- at least one approved slot that appears unavailable in discovery;
- at least one requestable slot and one pending request for My requests;
- an inactive room that remains excluded from discovery;
- a requirement fixture clearly labelled as illustrative demo policy.

The seed process must not create multiple overlapping confirmed bookings. Its second run must preserve the same number of fixtures and valid references.

---

## 12. Server/API and domain service contract

Implementation may use Next.js Server Actions and Server Components rather than public REST endpoints. Regardless of transport, use service contracts equivalent to these.

### `searchRooms(actor, filters)`

**Inputs:** authenticated profile; optional date/time interval; minimum capacity; known building; normalized facility IDs/values; page cursor/limit.

**Output:** safe room card projections and a per-room availability state. Never return password hashes, manager email, private request purpose, access history, or another requester's identity.

### `getRoomDetails(actor, roomCode, interval?)`

**Output:** safe active room details, hours, booking policy, public requirements, and only the current actor's verification states if the actor is a student.

### `submitBookingRequest(actor, roomCode, input)`

**Input fields from browser:** local date, start time, end time, purpose, group name, attendance, acknowledgement, idempotency key.

**Trusted values:** actor ID/role/status from session profile; room ID and room policy from database; campus timezone from validated runtime config; current time from server.

**Result union:**

```ts
type RequestResult =
  | {
      kind: "created";
      booking: BookingReceipt;
      eligibilityWarnings: SafeRequirement[];
    }
  | {
      kind: "existing";
      booking: BookingReceipt;
      eligibilityWarnings: SafeRequirement[];
    } // idempotent retry
  | { kind: "validation_error"; fieldErrors: FieldErrors }
  | { kind: "conflict"; alternatives: SafeAlternative[] }
  | { kind: "duplicate"; bookingId: string }
  | { kind: "unavailable"; reason: SafeUnavailableReason }
  | { kind: "forbidden" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "service_error"; correlationId: string };
```

The exact TypeScript shape can differ, but the result must be exhaustive and typed. Error responses must not contain SQL errors, stack traces, other bookings' fields, or details that enable enumeration.

### `getMyRequests(actor, filters)`

**Output:** only requests where requester equals the authenticated profile ID; safe room projection, status, time, purpose/group, attendance, decision reason, and eligibility warning as appropriate. Pagination is required if the dataset can grow beyond a small seeded collection.

---

## 13. Transaction and consistency requirements

Booking submission is a write operation and must not be implemented as an unprotected sequence of “check availability, then insert.”

For the current SQLite runtime:

1. Parse and normalize input before opening the write transaction where possible.
2. Begin an immediate write transaction.
3. Re-read current profile status/role, room status, structured policy, requirement records, and current conflict data.
4. Check idempotency key and canonical payload hash.
5. Check request-specific duplicate state.
6. Insert booking as `pending` with trusted values.
7. Insert `booking.submitted` audit event with the same correlation ID.
8. Commit both records together.
9. Return the safe receipt only after successful commit.

If any step fails, rollback all writes. Do not hold a write transaction open while awaiting network calls or external services. There are no external services in this phase.

The confirmed-booking database trigger is the invariant boundary for any future route that sets a booking to an active confirmed state. Phase 3 must still check the interval and return a friendly domain error before relying on the SQLite trigger as a user-facing error path.

---

## 14. Privacy, security, and abuse resistance

### Authorization

- Use `requireCurrentProfile()` or equivalent on every protected route/action.
- Require role `student` for request creation; do not infer role from a form or path.
- Derive requester ID exclusively from the resolved profile.
- Scope every My requests read in SQL by the resolved requester ID.
- Resolve room by code from the route; never accept manager assignment, room status, policy, or eligibility status from the client.
- Do not add broad “get all bookings” methods for the UI.

### Data minimization

- Store purpose/group as necessary for room review; do not collect a full participant roster, student number, or sensitive reason unless a later policy requires it.
- Search result messages must not reveal who booked a room or why.
- Do not include manager contact information in a public room card unless explicitly approved.
- Keep error logs free of password/session values and unnecessary form content.

### Form and route protection

- Validate all strings, length limits, dates, integers, arrays, filter values, and idempotency key format on the server.
- Use prepared SQL and an allowlist for sort columns/status filters.
- Restrict allowed post-login destinations using the Phase 1 safe redirect helper.
- Rate-limit request attempts per active account and return a `Retry-After` equivalent where applicable.
- Do not trust hidden form fields for actor, state, timestamp, requirement verification, or policy.
- Server Action framework protections do not replace domain authorization or input validation.

### Audit

- Log successful submission only in `audit_events`.
- Keep audit rows append-only.
- Correlation ID must connect the booking insert and audit event.
- Do not include auth tokens, raw credential references, full user profile, or unnecessary private text in audit metadata.

### Availability truthfulness

- Search availability is advisory and can become stale.
- The request service revalidates at submission time.
- Future manager approval must revalidate again because a pending request never reserves the room.
- On database/service error, do not mark a room available and do not accept a request optimistically.

---

## 15. Non-functional requirements

### Performance

- Seeded catalog: search should render comfortably under 500 ms server-side on a local demo instance.
- Use indexed/filterable SQL and avoid loading all bookings/profiles into memory.
- Alternative search is bounded: no more than seven local days and a configured maximum candidate count per request.
- My requests must not load data belonging to other users and must be paginated once the dataset is nontrivial.

### Reliability

- Request creation and its audit event are atomic.
- Migrations are forward-only and safe for an existing Phase 1 database.
- Seed is idempotent and produces valid relative-time fixtures.
- If the database is unavailable, show an actionable service-unavailable state and do not write partial state.

### Accessibility

- Semantic headings, labels, buttons, links, and status text.
- Required form fields are identified in text and programmatically.
- Error messages reference the invalid field and are announced.
- Keyboard-only users can search, open a room, submit a request, and navigate My requests.
- Color is never the sole carrier of availability or request status.
- Reduced-motion settings are respected.

### Responsive design

- Support 360px mobile width through large desktop layouts.
- Filters collapse into a clear mobile layout without hiding their state.
- Room cards and request rows remain readable without horizontal scrolling.
- Touch targets are at least 44px high where practical.

### Maintainability

- Centralize booking status types, room policy types, local-time conversion, availability calculation, validation result codes, and overlap logic.
- Reuse the same availability/conflict domain function in discovery and request submission.
- Reuse the same authorization helpers and session profile resolution from Phase 1.
- Add migrations rather than mutating applied schema history.
- Add tests at the domain/service/database boundary; avoid tests that assert implementation-specific markup unnecessarily.

---

## 16. Statuses and copy

### User-facing booking labels

| Stored status | Display label | Required meaning in Phase 2 |
| --- | --- | --- |
| `pending` | Pending review | Request recorded; manager has not decided; not access permission |
| `approved` | Approved | Seeded/later-phase state; no Phase 2 approval action |
| `rejected` | Not approved | Decision reason can be displayed to the requester |
| `cancelled` | Cancelled | Historical/demo state; no Phase 2 cancel action |
| `completed` | Completed | Historical/demo state; no Phase 2 close-out action |
| Other existing statuses | Their accessible label | Read-only in Phase 2; no implied action |

### Required copy

Request submit action: **Submit request**.  
Success headline: **Request submitted**.  
Success status: **Pending manager review**.  
Authorization notice: **This request is not permission to enter. Wait for manager approval.**  
Conflict: **This time conflicts with a confirmed room booking. Choose another time or room.**  
Eligibility: **This room has a requirement that is not verified for your account. You may submit a request, but a manager must review eligibility before approval.**  
Closed room: **This room is not available for requests at this time.**

Never say “Room booked”, “Reservation confirmed”, “You're in”, or “Access granted” for a pending request.

---

## 17. Error and edge-case matrix

| Scenario | Server outcome | UI outcome | Persistence |
| --- | --- | --- | --- |
| Missing/invalid purpose | Field validation error | Preserve safe inputs; focus error | No booking/audit write |
| Invalid date/time syntax | Field validation error | Explain valid date/time format | No write |
| DST-nonexistent local time | Time validation error | Ask user to choose another time | No write |
| DST-ambiguous local time | Time validation error | Explain time cannot be resolved unambiguously | No write |
| Start is in the past | Time validation error | Choose a future time | No write |
| Minimum notice violated | Policy validation error | Show minimum notice rule | No write |
| Duration exceeds limit | Policy validation error | Show maximum duration | No write |
| Off slot increment | Time validation error | Show allowed increment | No write |
| Attendance exceeds capacity | Capacity error | Show room maximum and adjust count | No write |
| Inactive or unknown room | Unavailable/not-found | Safe not-found or unavailable message | No write |
| Requests disabled | Unavailable | Explain room is not taking requests | No write |
| Interval outside hours | Outside-hours result | Show local room hours and choose another slot | No write |
| Existing approved overlap | Conflict result | Hide booking owner/purpose; offer alternatives | No write |
| Existing checked-in overlap | Conflict result | Same safe conflict treatment | No write |
| Pending overlap by a different requester | No conflict result | Explain approval is not guaranteed | New pending request allowed |
| Same user's pending duplicate | Duplicate result | Link to the user's existing request | No duplicate write |
| Same idempotency key, same payload | Existing receipt | Show original pending request | No new write |
| Same idempotency key, different payload | Idempotency mismatch | Ask user to refresh/restart request | No new write |
| Profile suspended after page load | Forbidden | Session/login recovery state | No write |
| Manager/admin tries request submit | Forbidden | No student request action | No write |
| Cross-user booking ID read | Not-found | Generic not-found | No data leak |
| Database unavailable | Service error + correlation ID | Retry later; do not imply success | No write/rollback |
| Concurrent confirmed booking created first | Conflict/trigger constraint | Refresh/research slot | No invalid pending request for that blocked interval |

---

## 18. Acceptance test plan

### A. Room discovery and detail

1. Active authenticated users can list rooms; anonymous/suspended users cannot.
2. Inactive Archive Lab is not returned in student discovery.
3. Minimum capacity excludes rooms below the requested value.
4. Building filter matches the known building and rejects SQL metacharacters as ordinary input.
5. Multiple facility selections require all selected facilities.
6. Search with no results shows a useful empty state and a clear-filter action.
7. A complete interval marks the seeded Seminar Room 02 approved interval unavailable.
8. Search never reveals the existing booking's requester, group, or purpose.
9. Detail displays facilities, capacity, local room hours, policy, and requirements.
10. Student sees own eligibility status only; manager/admin do not receive student-specific verification data.
11. Inactive room detail is not exposed through a guessed room code.

### B. Date/time policy

1. Date/time values are interpreted in campus timezone, not browser timezone.
2. Valid local time converts to the correct UTC instant.
3. DST gap time is rejected.
4. DST ambiguous time is rejected.
5. Past and too-soon requests are rejected.
6. Slot increment and max duration constraints are enforced.
7. A same-local-date request ending exactly at closing time succeeds if otherwise valid.
8. Requests spanning local midnight are rejected.
9. A request outside weekly availability is rejected.
10. Half-open adjacent intervals do not conflict with zero buffer.
11. Configured buffer is applied consistently to search and submit checks.

### C. Request validation and eligibility

1. A student can create a valid request for an active room.
2. New request status is always `pending`.
3. Server ignores/strips forged `status`, `requester_id`, `decided_by`, `decided_at`, room policy, and eligibility fields.
4. Attendance above capacity is rejected.
5. Mandatory requirement without a verified profile record is shown but cannot be made verified by a student.
6. Eligible seminar room request and unverified media room request follow the defined pending/warning rules.
7. Every validation error leaves no booking row and no audit row.
8. Successful request and audit event are committed together.

### D. Conflict and concurrency

1. Approved and checked-in intervals block submission.
2. Pending/rejected/cancelled/completed intervals do not block discovery under Phase 2 semantics.
3. A second distinct user's pending overlap does not expose the first request or block it automatically.
4. Same-user overlapping pending request is returned as duplicate/self-conflict.
5. Concurrent inserts into approved/checked-in states cannot create two overlapping confirmed bookings.
6. Server revalidation catches a room/policy/conflict change between page load and submission.
7. Alternatives are valid under the same room rules and are bounded/deterministic.

### E. Idempotency and abuse

1. Replaying the same requester/key/payload returns the original booking ID.
2. Same key with a different canonical payload is rejected.
3. Different requester cannot retrieve a receipt by reusing another user's key.
4. Repeated form submissions do not create duplicate bookings.
5. Per-user rate limiting returns a safe retry time and does not leak other users' data.

### F. My requests and privacy

1. Student sees own seeded and newly created requests.
2. Request remains visible after full page reload and new session.
3. A student cannot read another booking by changing route ID.
4. Unknown booking IDs and not-owned booking IDs produce equivalent safe responses.
5. No manager/admin request queue or private booking details appear in Phase 2.
6. Pending status and not-authorized notice are visible in success and list/detail states.

### G. Responsive and accessibility

1. Keyboard-only student can complete discovery → detail → request → My requests.
2. Inputs have labels; field errors are connected and announced.
3. Availability/status is understandable with color disabled.
4. 360px viewport has no page-level horizontal overflow.
5. Reduced-motion preference is respected.

---

## 19. Demo fixture requirements

The Phase 2 demo must be reproducible through `npm run db:setup` and work with no manual database editing.

### Primary demonstration path

- Sign in as Amelia Chen (`student@roomrelay.demo`).
- Search for an upcoming weekday interval with capacity 12 and a projector.
- See Seminar Room 02 as a candidate and review its rules.
- Submit a new 90-minute request for the Robotics Club within seeded hours and outside any approved fixture.
- See a persisted pending confirmation with the explicit “not permission to enter” text.
- Open My requests and see the request.

### Required fixture scenarios

- One active room with active eligibility requirement verified for Amelia.
- One active room with an active required eligibility requirement not verified for Amelia.
- One approved room/time interval that can be searched as unavailable.
- One pending fixture to demonstrate pending is not equivalent to approved.
- One inactive room excluded from search.
- Room capacities/facilities/buildings that produce both matching and empty filter results.
- A date relative to seed time that lies within a valid future schedule window.
- A timezone-aware DST test fixture in automated tests; it need not appear in the judge-facing seed data.

Every demo requirement/policy is labelled illustrative rather than institutionally verified.

---

## 20. Technical implementation guidance

### Application structure

Keep the existing Next.js App Router and server-only SQLite strategy for Phase 2. A reasonable module split is:

```text
app/app/rooms/page.tsx                  server-rendered discovery
app/app/rooms/[code]/page.tsx           server-rendered detail
app/app/rooms/[code]/request/page.tsx   request screen
app/app/rooms/actions.ts                validated server actions
app/app/bookings/page.tsx               current user's request list
lib/rooms/queries.ts                    narrow room/read projections
lib/bookings/policy.ts                  canonical schedule/conflict rules
lib/bookings/validation.ts              schemas and safe result types
lib/bookings/service.ts                 atomic creation and idempotency
lib/time/campus-time.ts                 local/UTC conversion
db/migrations/002_phase2_requests.sql   policy, verification, and key changes
```

Exact filenames may vary, but the domain rules must be centralized and shared.

### Server Components and actions

- Use Server Components for initial room result/detail/My requests rendering.
- Use Server Actions or route handlers for form submission; all inputs are revalidated server-side.
- Keep SQLite access in server-only modules. Do not import `better-sqlite3` from a Client Component.
- Return minimal projections rather than full rows.
- Keep dynamic pages non-cacheable per user unless cache invalidation is explicitly scoped to the user and filters.

### Filter URL contract

Suggested allowlisted search keys:

```text
date=YYYY-MM-DD
start=HH:mm
end=HH:mm
capacity=12
building=Hazelwood%20Hall
facility=Projector&facility=Whiteboard
```

The server clamps lengths/counts and validates all values. Unknown parameters are ignored or result in a safe validation state. No user IDs, request IDs, eligibility status, or private information belong in filter URLs.

### Search/submit shared service

Implement a canonical service that calculates:

- room requestable state;
- schedule coverage;
- active confirmed conflict;
- capacity fit;
- policy duration and lead time;
- eligibility state for the current student.

Search can call it read-only; submission calls the same logic inside the transaction after re-reading records. Do not duplicate an overlap predicate separately in SQL list queries, a React component, and a server action.

---

## 21. Rollout and observability

- Phase 2 is released behind authenticated routes; public landing remains unchanged except for Phase 2 availability messaging.
- Add a feature flag only if needed to hide incomplete routes; do not put security decisions behind a client-only flag.
- Operational logs may include action name, result code, correlation ID, and elapsed time.
- Do not log the student's full purpose/group text on validation failures.
- Monitor counts of request validation categories during the demo only if collection is privacy-safe and documented.
- `/api/health` continues to report database/migration readiness without exposing user or booking data.
- No email integration is required; the UI is the source of request confirmation in this phase.

---

## 22. Dependencies and assumptions

- Phase 1 migrations, auth, demo fixtures, authorization helpers, and UI shell remain intact.
- The Phase 1 seeded demo accounts are intentionally shared, non-production accounts.
- One configured campus timezone applies to all rooms in the initial MVP.
- Weekday hours and room policy values in seed data are illustrative demo policy.
- Pending requests do not reserve a room; managers make the allocation decision in Phase 3.
- Approved/checked-in bookings do reserve the room interval.
- All room request creation is student-only in Phase 2.
- The database is a persistent single-instance SQLite file; no public serverless deployment with ephemeral storage is implied.
- No public preview URL or production hosting credentials are currently configured.
- The PDF's suggestion to use Supabase/Postgres was not used for Phase 1 due to missing external credentials. Phase 2 should continue the as-built SQLite server-only approach unless a deliberate datastore migration is undertaken and documented.

---

## 23. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Search says a room is available after data changes | User submits a misleading request | Revalidate room, schedule, and conflicts in atomic submit service |
| Pending request is mistaken for reservation | User assumes the room is theirs or enters without approval | Label Pending everywhere; explicit “not permission to enter” copy |
| Availability checks use a different conflict rule than approval | Two confirmed bookings can overlap | Central canonical conflict function plus SQLite trigger and Phase 3 re-check requirement |
| Campus-local times convert incorrectly near DST | Wrong time is requested or accepted | Use a timezone-aware conversion utility and tests for gaps/folds |
| Free-text room rules are parsed as enforcement | Inconsistent or unsafe booking decisions | Add structured policy fields; keep prose informational only |
| Student changes requester/status fields in a server action | Unauthorized booking or approval | Derive identity/status from session; allowlist form inputs; ignore forged fields |
| Eligibility checkbox is treated as proof | Ineligible use can be auto-approved | Maintain server-owned verification records; acknowledgement never mutates verification |
| Search leaks details from blocking booking | Privacy breach | Return only safe availability state and reason; no names/purpose/group |
| Double click or retry creates duplicate requests | Confusing manager queue and spam | Requester-scoped idempotency key plus same-user duplicate check and rate limit |
| Alternative search grows unbounded | Slow request and denial of service | Search only a bounded date range/candidate count and stop after first three results |
| SQLite trigger error produces raw DB message | Internal implementation leak | Catch known constraint errors and map to safe domain result/correlation ID |
| Demo seed times expire | Demo failure | Generate relative weekday times; `npm run db:reset` remains idempotent and documented |
| New tables overbuild for 48-hour scope | Delayed useful UI | Add only structured policy and verification needed by this phase; defer waitlist and full admin editing |

---

## 24. Delivery sequence and exit gates

### Step 1 — Freeze rules and migration

- Confirm policy defaults and status semantics.
- Add migration for structured room request policy, profile eligibility verification, idempotency, and confirmed-overlap triggers.
- Extend seed process without modifying an already-applied migration.

**Exit gate:** migration applies to both an empty DB and a Phase 1 seeded DB; existing fixtures remain valid.

### Step 2 — Build the room query and time domain layer

- Implement timezone conversion and DST behavior.
- Implement filter validation, room search projections, room details, schedule coverage, and conflict checks.
- Add domain tests before UI consumes the functions.

**Exit gate:** tests pass for filters, hours, interval boundaries, capacity, policy, timezone, and privacy-safe conflicts.

### Step 3 — Build discovery and detail UX

- Enable Room discovery navigation.
- Implement filter/search state, cards, detail page, requirements, and empty/error states.
- Verify role access and mobile layout.

**Exit gate:** all roles can browse active rooms; no role sees private booking data.

### Step 4 — Build request submission and My requests

- Implement request form and server action.
- Add atomic transaction, idempotency, duplicate prevention, audit insertion, and safe result mapping.
- Implement confirmation and requester-scoped list/detail.

**Exit gate:** a student can submit a valid pending request and retrieve only their own request after refresh.

### Step 5 — Hardening and demo readiness

- Add conflict, DST, authorization, and form replay tests.
- Update smoke test to submit a valid request and verify persisted pending status if test harness permits.
- Verify the full primary demo from a reset database.
- Update README and plan with Phase 2 implementation status, commands, and policy assumptions.

**Exit gate:** all acceptance checks below pass, and the judge can complete the Phase 2 discovery/request journey without team-side database edits.

---

## 25. Definition of done

Phase 2 is complete only when all conditions below are true:

- Student, manager, and admin accounts can browse active rooms after authentication.
- Anonymous and suspended accounts cannot access room inventory or request actions.
- Discovery supports date/time, capacity, building, and facility filtering.
- Room details show capacity, location, facilities, hours, usage summary, structured policy, and requirements.
- Student requirement state is server-resolved and private to that student.
- Request form supports purpose, optional group name, attendance, date, and local start/end times.
- Server validates every field and re-reads current room/profile/policy data before persistence.
- Invalid time, closed room, disabled request, ineligible field, capacity, duplicate, conflict, and unavailable errors are handled safely.
- A successful request is persistent, assigned to the authenticated requester, and stored as `pending` only.
- A successful request and its audit event commit atomically.
- The confirmation and My requests state clearly say pending is not access authorization.
- Confirmed overlapping bookings cannot be submitted over, including under concurrent operation.
- Pending requests remain non-reserving and do not leak to other users.
- Idempotency prevents double-submit/retry duplicates.
- My requests and detail are requester-scoped in server queries.
- The app works with the existing local SQLite setup and no external auth/database service.
- Migrations/seed are repeatable and the Phase 1 fixtures remain intact.
- `npm run check` passes, including production build and applicable HTTP smoke test.
- README and `plan.md` accurately state what Phase 2 implements and what remains Phase 3+.

---

## 26. Handoff to Phase 3

Phase 3 must extend the Phase 2 booking service rather than writing a second approval path. It must:

1. Add a manager queue scoped to `rooms.manager_id = authenticated manager ID`, with explicit admin delegation if required.
2. Re-read the pending booking, current room policy, current eligibility state, and confirmed conflicts inside one write transaction.
3. Approve only if all hard requirements are met or a specifically authorized human override with a recorded reason is applied.
4. Use the same half-open interval and buffer policy as Phase 2.
5. Rely on the confirmed-overlap database invariant as defense in depth.
6. Append a decision audit event atomically with the booking status change.
7. Expose the decision and reason only to the requester and authorized room managers/admins.

Phase 3 must not change the meaning of `pending` or treat a Phase 2 request as a reservation.
