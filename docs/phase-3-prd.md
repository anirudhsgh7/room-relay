# RoomRelay — Phase 3 Product Requirements Document

**Phase:** Manager review, decisions, and cancellation  
**Status:** Implemented  
**Depends on:** Phase 1 foundation and Phase 2 discovery/request workflow  
**Source of truth:** `RoomRelay_Project_Context.pdf`, `plan.md`, `phase-1-prd.md`, `phase-2-prd.md`, and the implementation in this repository  
**Implementation baseline:** Next.js 16 App Router, React 19, TypeScript, server-only SQLite (`better-sqlite3`), signed HTTP-only sessions, room-scoped authorization helpers, `profile_eligibility`, request-scoped idempotency, room booking policies, and append-only audit events.

---

## 1. Executive summary

Phase 3 closes the most important gap in the booking lifecycle: a student can request a room in Phase 2, but a pending request is not a reservation. This phase gives assigned room managers a private, scoped work queue where they can review a request, inspect the relevant room and eligibility context, approve or reject it with a reason, and let the requester see that decision. It also gives requesters a controlled way to cancel their own pending or future approved booking.

The system must make decisions trustworthy and race-safe. Before approving a request, RoomRelay must re-read the current requester, room, schedule, policy, eligibility state, interval, and confirmed conflicts. It must atomically change the request status and append an audit event. If another request was approved first, a later conflicting decision must fail safely and leave that request pending; two confirmed overlapping bookings must never both succeed.

Phase 3 includes an explicit, human-reviewed eligibility override. An assigned manager or administrator may override an unsatisfied mandatory requirement only by selecting the requirement and recording a clear reason. An override applies to that booking only: it does not mark the student's training or membership verified and cannot bypass room closure, capacity, schedule, time, or booking-conflict rules.

This phase does **not** implement room access checks, NFC/QR, door control, check-in/out, incidents, waitlisting, notifications, or a full audit timeline. Approval is a booking decision; it is not proof that a physical door unlocked.

## 2. Product context

RoomRelay connects room discovery, requests, manager decisions, time-bound access, and close-out. Phase 2 established active room discovery, server-side request validation, persistent `pending` requests, requester-private **My requests**, room policy and eligibility data, UTC timestamps, request idempotency, audit events, and the no-overlap invariant for `approved`/`checked_in` bookings.

Phase 3 must build on those services and definitions rather than introduce a parallel approval path. The manager queue is the first product surface that allocates scarce rooms. Decisions must be scoped, explainable, auditable, and revalidated when made.

### Phase 3 outcome

An assigned room manager can review pending requests for their rooms, verify the request against current policy and eligibility, then approve or reject it with a recorded reason. The requester can see the result and reason. A requester can cancel their own pending request or a future approved booking under the rules in this document. A second request cannot be approved after another booking has claimed the overlapping interval.

### Lifecycle

```text
Phase 1: identity, roles, schema, demo foundation
    ↓
Phase 2: discover → request → validate
    ↓
Phase 3: review → approve/reject → cancel       ← this PRD
    ↓
Phase 4: time-bound access policy and events
    ↓
Phase 5: check-out, condition, incident, history
```

### Critical state distinction

- `pending`: a request exists; a manager has not decided; no access authorization is granted.
- `approved`: an authorized manager allocated the room/time under current policy; Phase 4 may consider it for an access check.
- `rejected`: the manager declined the request; a reason is visible to the requester.
- `cancelled`: the requester withdrew the request/booking; future access must be denied by Phase 4.

The UI, audit records, demo, and documentation must not equate `approved` with “the door unlocked.”

## 3. Goals and success measures

### Goals

1. Give managers an actionable queue scoped to assigned rooms.
2. Give administrators institution-wide queue visibility and authority, with admin actions attributed to the actual admin profile.
3. Give managers sufficient current room, request, eligibility, and conflict context for a fair decision without exposing unrelated rooms/users.
4. Enforce only the approved transitions: `pending → approved`, `pending → rejected`, `pending → cancelled`, and `approved → cancelled` before start.
5. Revalidate booking state, room state, schedule, policy, capacity, current eligibility, and confirmed conflicts at decision time.
6. Persist decision actor, time, requester-visible reason, and any eligibility override details.
7. Write each successful decision/cancellation and its audit event atomically.
8. Prevent concurrent approval of overlapping bookings, including manager/admin races.
9. Let the requester cancel only their own eligible pending/future approved booking.
10. Make current decision state/reason visible to the requester after reload without manual database edits.
11. Preserve Phase 2's source of truth: UTC timestamps, campus-local presentation, half-open intervals, current room buffer, and current eligibility verification.
12. Keep the workflow functional without notifications, hardware, or external identity services.

### Success measures

- Managers see only requests for assigned rooms; an unassigned manager cannot read or decide by changing a URL or payload.
- Admin sees institution-wide requests, and the action is attributed to the admin.
- Approval occurs only if the request is still pending and every live hard check passes.
- Rejection requires a non-empty reason; approval also records a reason.
- A confirmed overlap returns a conflict without changing the booking or writing a success event.
- Eligibility override requires explicit action, affected requirement selection, and a reason; it never updates the user's verification record.
- A requester can cancel only their own pending request or their own approved booking strictly before start.
- Cancellation preserves decision/history, stops blocking future requests, and does not create duplicate audit entries on retry.
- Requester sees status/reason after refresh; private details remain scoped.
- `npm run check` passes with role-scope, transition, override, concurrency, cancellation, and audit atomicity coverage.

## 4. Roles and authorization

### Student / club lead

Can browse rooms, submit requests, read own request/booking detail, see the current status and requester-visible decision reason, cancel own pending requests, cancel own future approved bookings before start, and see whether an eligibility override was applied. Cannot read another user's request, decide any request, set decision/override fields, change their eligibility verification, or cancel after booking start.

### Assigned room manager

Can list and inspect requests for rooms where `rooms.manager_id` equals their authenticated profile ID; view request purpose/group, requested interval, attendance, current room policy, current and submission-time eligibility, and room-scoped conflict information; approve/reject pending requests with a reason; and apply a narrowly scoped eligibility override with a reason. Cannot see or decide requests for unassigned rooms, mutate profile verification, bypass hard checks, or cancel a request on behalf of its requester.

### Administrator

Can review and decide across all rooms, with every action attributed to the persisted admin profile. Admin cannot bypass schedule, room status, capacity, time, or conflict invariants. There is no room delegation matrix in this phase.

### Suspended/anonymous actor

Cannot view queues, request details, or submit transitions. A valid session cookie is insufficient if the persisted profile is suspended. Missing/inconsistent authorization data fails closed.

### Phase 3 permission matrix

| Action | Student requester | Assigned manager | Unassigned manager | Admin | Anonymous/suspended |
| --- | --- | --- | --- | --- | --- |
| Read own request | Yes | Only if also requester | No | Yes | No |
| Read assigned-room request | No, unless own | Yes | No | Yes | No |
| Read other-room request | No | No | No | Yes | No |
| Approve/reject assigned-room request | No | Yes | No | Yes | No |
| Override eligibility at decision | No | Yes, assigned room only | No | Yes | No |
| Cancel own pending request | Yes | No | No | No by default | No |
| Cancel own future approved booking | Yes, before start | No | No | No by default | No |
| Cancel another user's request | No | No | No | No in Phase 3 | No |
| Edit profile eligibility | No | No | No | Not in this phase | No |

Admin's institution-wide scope is explicit. A manager role alone never implies global access. Hiding a route or button is not authorization; every read and mutation must check the server-resolved profile and current room assignment.

## 5. Scope and priorities

### P0 — required

- Manager queue scoped to assigned rooms; admin queue scoped to all rooms.
- Pending request list and review detail.
- Filters for room, date range, eligibility warning, and conflict status.
- Decision-time checks for state, active room, request policy, current hours, current slot/duration rules, capacity, current eligibility, future start time, and confirmed conflicts.
- Approve/reject actions with required requester-visible decision reason.
- Explicit eligibility override with authorization, requirement selection, reason, audit, and requester disclosure.
- Atomic decision status update plus append-only audit event.
- Requester-facing status/reason updates in My requests and request detail.
- Requester cancellation for own pending/future approved bookings with required reason.
- Atomic cancellation plus audit event; cancelled booking ceases to block future searches.
- Conflict signals for pending overlaps and changed confirmed availability.
- Forward-only migration, seed updates, service tests, UI tests/smoke coverage, and docs.

### P1 — include if core is stable

- Queue pagination/load-more, pending-age display, decision reason presets, scoped workload counts, concise request-scoped audit activity.
- Extra filters for attendance or capacity fit.
- Admin cross-room summary counts.

### Defer

- Request-changes/resubmission, waitlist, automatic promotion, allocation scoring, notifications, email, bulk decisions, admin room/policy editing, eligibility verification editor, manager cancellation on behalf of a requester, appeals/sanctions, AI recommendations, access checks, NFC/QR, door control, check-in/out, incidents, and full audit timeline.

### Explicit decision: no “request changes” action

The concept PDF lists “request changes” as a possible manager action. Phase 3 follows the existing build plan's required actions—approve/reject—and does not add a new `changes_requested` state or an underspecified resubmission workflow. Managers should reject with a clear reason when a request cannot be approved as submitted. Do not simulate “request changes” by leaving the request pending with an unstructured note. A future phase may add this only with explicit status, resubmission, and audit semantics.

## 6. Booking state machine

### Phase 3 meanings

| State | Meaning | Phase 3 behavior |
| --- | --- | --- |
| `pending` | Awaiting manager review; not an authorization | Approve/reject or requester cancel |
| `approved` | Allocated by authorized manager for the requested interval | Requester can cancel before start; access is Phase 4 |
| `rejected` | Declined; reason visible to requester | Read-only |
| `cancelled` | Requester withdrew request/allocation; history retained | Read-only |
| `waitlisted` | Future state; waitlist not implemented | Read-only fixture |
| `checked_in` | Future check-in state | No Phase 3 transition |
| `completed` | Future close-out state | Read-only fixture |
| `no_show` | Future close-out state | Read-only fixture |
| `incident` | Future incident state | Read-only fixture |

### Allowed transitions

```text
pending  -- manager/admin approve --> approved
pending  -- manager/admin reject  --> rejected
pending  -- requester cancel     --> cancelled
approved -- requester cancel     --> cancelled   (strictly before start)
```

All other transitions fail closed. A rejected/cancelled booking cannot be reopened; a new request is the retry path. A manager/admin cannot cancel on behalf of a student in Phase 3.

### Decision metadata

Successful approve/reject stores `decided_by`, `decided_at`, and required `decision_reason`; status changes only from `pending`; optional override metadata is set only for an authorized valid override; one corresponding audit event is appended. Cancellation stores separate `cancelled_by`, `cancelled_at`, and `cancellation_reason`; original decision metadata is preserved when an approved booking is later cancelled.

## 7. Decision and cancellation policy

### 7.1 Approval hard checks

Before approval, in this order, the server must:

1. Load an active persisted profile and confirm the actor is an assigned room manager or admin.
2. Reload the booking and room; confirm the booking is still `pending`.
3. Confirm the room is still active and accepts requests.
4. Confirm requested start is still in the future.
5. Revalidate the interval against the current slot increment and max duration.
6. Revalidate schedule coverage using current room hours, campus timezone, local weekday, and effective dates.
7. Confirm expected attendance is positive and no greater than the current capacity.
8. Reload active mandatory requirements and the requester's current `profile_eligibility` records.
9. Require each mandatory requirement to be current/verified unless a valid explicit override is provided.
10. Recheck `approved`/`checked_in` conflicts using half-open intervals and current `buffer_minutes`.
11. Validate a non-empty 10–500 character decision reason.
12. Update and audit atomically; the database overlap trigger remains a second line of defense.

Any failed hard check except an eligible human override blocks approval. The manager may reject with a reason or leave the request pending. Do not auto-reject a request because a policy changed.

### 7.2 Minimum notice at review

`minimum_notice_minutes` is checked at request submission. Do not reapply it at decision time merely because the queue took time to process. At approval time, require only that the interval is still in the future and all current room/schedule/eligibility/conflict rules pass. A deliberately different institutional policy requires a documented product change.

### 7.3 Conflict semantics

- Blocking states are `approved` and `checked_in`.
- Pending requests do not reserve inventory.
- Half-open interval overlap is `existing.start < requested.end AND existing.end > requested.start`.
- Expand the existing confirmed interval by the room's configured buffer.
- Adjacent intervals do not conflict when buffer is zero.
- Recheck inside an immediate SQLite write transaction immediately before update.
- If the overlap trigger fires, map it to a safe domain conflict; do not return SQLite text.
- If the approval loses a race, leave the booking pending and do not append a successful decision event.
- Do not automatically reject or waitlist the losing request.

### 7.4 Pending request overlaps

Different requesters may have overlapping pending requests. The assigned manager sees an overlap indicator and the relevant request chronology, but the system does not automatically select a winner or invent a priority score. Requests are sorted oldest-submitted first by default. Once one request is approved, the other becomes conflicted and cannot be approved until that conflict is removed. Manager sees assigned-room context only; students do not learn about another group's request.

### 7.5 Eligibility and human override

Use current active requirement and verification data at approval. The Phase 2 `eligibility_snapshot_json` is historical context, not current authority.

Normal approval requires every active mandatory requirement to be currently verified. Missing, unverified, or expired records are not verified. Newly added active requirements apply at review; removed/deactivated requirements no longer block.

An override:

- is available only to assigned manager/admin for the room;
- must be an explicit opt-in, not a default checkbox;
- must identify the exact currently unsatisfied mandatory requirements;
- requires a separate 20–500 character reason;
- is recorded on the booking and audit event;
- is visible to the requester;
- applies to this booking only and never mutates profile eligibility;
- cannot bypass inactive room, disabled requests, hours, capacity, expired interval, or conflict.

### 7.6 Decision reasons

- Require 10–500 trimmed plain-text characters for both approval and rejection.
- Reason is requester-visible; Phase 3 has no private manager-only notes.
- Rejection should explain the practical reason neutrally and specifically.
- Do not include unsupported allegations, protected attributes, trustworthiness ratings, sanctions, or unnecessary personal data.
- Eligibility override reason is separate from the overall decision reason.

### 7.7 Cancellation rules

Requester can cancel a pending request any time before it has been decided. Requester can cancel an approved booking only when `start_at > server_now`. Requester cannot cancel another user's booking, rejected/cancelled/completed/no-show/incident records, a booking at/after its start, or a checked-in booking.

Cancellation requires a 5–500 character reason. The action is serialized with decisions. If approval wins first, cancellation may still win afterward only if the booking remains future. If cancellation wins first, approval fails as stale. A successful cancellation stops blocking future discovery and preserves decision history. It does not rely on notifications or on an access-permission row (access is Phase 4).

## 8. User journeys

### A. Approve an eligible request

1. Manager signs in and opens **Manager queue**.
2. Queue contains only assigned-room requests; oldest pending is first.
3. Manager opens a request and reviews purpose/group, interval, attendance/capacity, current room rules, current and submission-time eligibility, and conflicts.
4. Current mandatory requirements are verified and no confirmed booking conflicts.
5. Manager chooses **Approve**, enters a reason, and confirms.
6. Server revalidates all state inside an immediate transaction.
7. Booking becomes `approved`; actor/time/reason and one audit event commit together.
8. Queue shows approved; requester sees the status and reason after reload.
9. UI states that approval allocates the room but does not prove physical access.

### B. Reject a request

1. Manager reviews the assigned-room request.
2. Chooses **Reject** and enters a required requester-visible reason.
3. Server verifies scope and pending state, then atomically updates and audits.
4. Requester sees **Not approved**, reason, and a route back to discovery for a new request.

### C. Eligibility override

1. Manager opens a request with an unmet mandatory requirement.
2. Normal approval is blocked and the exact requirement is explained.
3. Manager rejects, or explicitly enables a one-booking override, selects affected requirement(s), and enters a separate reason.
4. All other hard checks still run.
5. Successful approval records the override and discloses it to the requester; the profile stays unverified.

### D. Competing requests

1. Two different students have pending requests for overlapping intervals.
2. Assigned manager sees pending-overlap indicators and reviews in chronology.
3. First request is approved.
4. Second request is rechecked and shows a confirmed conflict; approval fails and remains pending.
5. Manager rejects the second with reason or leaves it pending; requester may cancel.

### E. Changed room policy

1. A request looked valid at submission.
2. Room becomes inactive, hours/policy changes, capacity is reduced, a requirement is added, or another booking is approved.
3. Approval service re-reads current state and blocks the decision.
4. Manager sees the precise safe reason; no successful transition/audit event is written.

### F. Cancel future approved booking

1. Requester opens own approved booking before start.
2. Chooses **Cancel booking**, confirms room/time, and provides a reason.
3. Server checks ownership/status/current time in a transaction.
4. Booking becomes cancelled; cancellation metadata and event commit atomically.
5. My requests updates and room is no longer considered blocked; Phase 4 must deny future access for it.

## 9. Routes and information architecture

### `/app/manager/queue`

- Manager sees assigned rooms only; admin sees all rooms.
- Default tab is **Pending review**; history tabs are read-only.
- Filters: room, local date range, eligibility warning, conflict state, status.
- Stable ordering: oldest pending `created_at`, then requested start, then ID.
- Counts and filters always use actor scope in SQL.
- Empty states distinguish no assigned rooms, no pending requests, no filter matches, and service unavailable.

### `/app/manager/requests/[bookingId]`

- Admin or assigned manager only.
- Shows request, room, current and submission-time eligibility, current schedule/policy, capacity, confirmed conflict, and pending overlap context.
- Decision panel only for pending requests; read-only history for decided/cancelled requests.
- No cross-room details, raw DB errors, or auth secrets.

### `/app/bookings` and `/app/bookings/[id]`

- Remain requester-scoped.
- Show current status, decision reason, decision actor display name/time, eligibility override disclosure, and cancellation reason/time.
- Cancel action only for own pending or future approved booking.
- Pending continues to state “not permission to enter.”
- No manager-only queue data is embedded in requester pages.

### Navigation

- Enable **Manager queue** for managers/admins only.
- Keep **My requests** for students.
- Direct route access still undergoes server authorization.

## 10. Screen-level requirements

### Queue row/card

Show room name/code/building; requester display name; purpose/group; local date/time; attendance/current capacity; request received time; eligibility state; pending-overlap/current-conflict indicator; and a link to review. Do not show credentials, profile eligibility evidence, or unrelated bookings.

### Decision detail

Group content into Request, Room, Eligibility, Scheduling, Decision, and request-scoped History sections. Show request-time eligibility snapshot separately from current state. If the current state differs, explain the change. Historical decision panel is read-only.

### Approve form

- Required 10–500 character requester-visible decision reason.
- Explicit final review of room/request/time/capacity.
- For unmet requirement, ordinary approval blocked; explicit override control lists current unmet mandatory requirement(s), requires selection and a separate 20–500 character reason.
- Copy states override affects this booking only and does not verify a profile.
- Submit label is **Approve request**, not “Unlock room.”
- Disable during submission but rely on server transaction/state check.

### Reject form

- Required 10–500 character requester-visible reason.
- Confirmation makes clear this closes this request; requester may create a new request.
- No rejection without reason; no hidden status setter.

### Cancellation

- Pending: label **Cancel request**.
- Future approved: label **Cancel booking**.
- Required 5–500 character reason and confirmation.
- Hide/disable after start, for unsupported statuses, and for non-owners.
- On success, show Cancelled and reason; retain previous approval decision details.

### Status copy

| State | Display | Meaning |
| --- | --- | --- |
| `pending` | Pending review | Awaiting manager; not a reservation/access right |
| `approved` | Approved | Room/time allocated; physical access is a later phase |
| `rejected` | Not approved | Declined with reason; request is closed |
| `cancelled` | Cancelled | Request/booking withdrawn; history retained |

Do not say “Access granted,” “Door unlocked,” “Your room is ready,” or “Confirmed entry.”

## 11. Functional requirements

### FR-3.01 — Queue authorization and scoping

- Require an active current profile for every queue/detail/query/action.
- Managers' SQL always constrains to rooms assigned to their ID.
- Admin SQL has explicit institution scope.
- Students, anonymous, and suspended actors are denied.
- Filters, counts, pagination, and status tabs retain identical scope.
- Never fetch all bookings and filter only in React.
- Unknown and out-of-scope booking IDs return safe not-found.

**Acceptance:** Marcus cannot see Priya's Media Studio pending request or read its detail by guessing its ID; Priya can; admin can.

### FR-3.02 — Queue reads

- Bounded page size (default 25, maximum 100) with stable ordering/cursor.
- Pending first; history tabs read-only.
- All request detail fields are limited to authorized rooms.
- Counts are computed within the same scope.
- No broad generic “get all bookings” UI repository method.

### FR-3.03 — Decision form and trust boundary

Only decision action, booking ID, decision reason, and explicit override values are accepted from the browser. Actor, room, assignment, requester, current status, policy, eligibility, time, and audit actor are loaded/set by server code. Forged client values are ignored/rejected.

### FR-3.04 — Approve

- Run approval through a single trusted booking decision service.
- Re-read active profile, actor role, booking, room, assignment, policy, availability, capacity, current eligibility, and blockers inside an immediate write transaction.
- Require pending state and a future interval.
- Require valid 10–500 character reason.
- Reject if room inactive/request disabled, hours changed, duration/slot no longer valid, attendance exceeds capacity, or confirmed conflict exists.
- Require current mandatory eligibility or valid explicit override.
- Update to approved and insert `booking.approved` audit event atomically.
- Return success only after commit.

### FR-3.05 — Reject

- Require active assigned manager/admin, pending state, and 10–500 character reason.
- Update status, actor/time/reason, and append `booking.rejected` event atomically.
- Keep request visible to requester with reason.
- No profile, room policy, or credential state changes.

### FR-3.06 — Eligibility override

- Override only currently unsatisfied active mandatory requirements for this booking's room/requester.
- Require explicit opt-in, exact requirement IDs, and separate 20–500 character reason.
- Actor must be assigned manager/admin.
- Do not update `profile_eligibility`.
- Record reason/IDs on booking and event; make disclosure visible to requester.
- Cannot bypass any non-eligibility hard check.

### FR-3.07 — Cancellation

- Only booking requester can cancel pending or approved-before-start.
- Require 5–500 character reason.
- Re-read actor/booking/current state/time inside immediate transaction.
- Compare-and-set expected prior status; set cancellation actor/time/reason; append `booking.cancelled` atomically.
- Cancellation removes the booking from confirmed blockers but preserves previous decision metadata and audit history.
- Retry returns current cancelled state without duplicate audit.
- Managers/admins cannot cancel for requesters in this phase.

### FR-3.08 — Audit events

Successful actions append one event:

| Action | Required fields |
| --- | --- |
| `booking.approved` | actor, booking entity, UTC time, decision reason, correlation ID, override details if used |
| `booking.rejected` | actor, booking entity, UTC time, reason, correlation ID |
| `booking.cancelled` | requester actor, booking entity, UTC time, prior status, cancellation reason, correlation ID |

Events are inserted in the same transaction as status changes. Failed operations do not write a success event. Never log auth tokens/passwords/raw credential secrets. Audit stays append-only.

### FR-3.09 — Conflict visibility

- Show pending overlap to assigned manager/admin, not to unrelated students.
- Show current confirmed blocker state and prevent approval.
- A conflicting pending request remains pending; no auto-reject/waitlist.
- Recheck on action, regardless of page state.
- Keep student-facing conflict messages privacy-safe.

### FR-3.10 — Requester-visible result

- My requests and detail use current persisted status after reload.
- Approved/rejected state shows decision reason and time; decision actor display name may be shown, email is not required.
- Cancelled state shows cancellation reason/time and prior decision context.
- Override disclosure is visible and does not imply the student's profile is verified.
- No notification/email claim.

### FR-3.11 — Errors and accessibility

- Distinguish forbidden, not-found, stale state, validation, eligibility, confirmed conflict, policy failure, and database failure.
- Never expose trigger/SQL error text or stack trace.
- Associate field errors and announce them; preserve no false success state.
- Keyboard access to queue filters, rows, decision/cancellation controls and confirmation dialogs.
- Status uses text plus color; supports reduced motion and 360px mobile without page overflow.

## 12. Migration and data model

Add a forward-only migration such as `003_phase3_manager_review.sql`. Do not edit applied migrations `001` or `002`.

### 12.1 Additional `bookings` fields

| Field | Meaning |
| --- | --- |
| `cancelled_by` | profile ID responsible for requester cancellation |
| `cancelled_at` | UTC cancellation timestamp |
| `cancellation_reason` | requester reason (service validates 5–500 chars) |
| `eligibility_override_reason` | separate reason for a human eligibility exception |
| `eligibility_override_requirement_ids_json` | JSON array of exact requirement IDs overridden |

Existing `decided_by`, `decided_at`, and `decision_reason` remain decision metadata and must not be overwritten when an approved booking is later cancelled.

### 12.2 Database defense in depth

Recommended SQLite triggers/constraints:

- approved/rejected decision states require decision actor, timestamp, and non-empty reason on new Phase 3 writes;
- decision actor must be an admin or a manager assigned to that booking's room;
- allowed transitions are pending→approved/rejected/cancelled and approved→cancelled;
- cancelled transition requires actor/time/reason and actor=requester for Phase 3 cancellation;
- confirmed-overlap triggers from Phase 2 remain active;
- existing historical seed rows continue to load; use nullable fields/backfill with explicit fixture semantics.

Service checks remain primary for friendly errors. Database triggers are the final invariant boundary.

### 12.3 Queue indexes

Review existing indexes; add only as needed for `room_id/status/created_at`, `room_id/status/start_at/end_at`, requester/status/start, and audit entity/time. All queue reads remain scoped and bounded.

## 13. Server/service contracts

### Queue query

`listManagerRequests(actor, filters)` returns minimal scoped items, page info, and scoped counts. The actor is resolved server-side. Manager scope comes from current room assignment; admin scope is explicit; filters are allowlisted and parameterized.

### Decision service result

The implementation may use another type shape, but must distinguish at least:

- success (`approved` or `rejected`) with safe receipt;
- forbidden;
- not found/out of scope;
- already decided/current status;
- validation errors;
- eligibility required/override invalid;
- current room unavailable/policy changed;
- confirmed conflict;
- safe service error with correlation ID.

### Cancellation service result

Must distinguish success, forbidden/not found, not cancellable, validation error, stale state, and safe database/service failure.

### Error privacy

- Same safe not-found for unknown IDs and out-of-scope manager IDs.
- Student-facing pages never reveal another requester identity/purpose.
- Manager conflict details are limited to assigned rooms; admin may see institution scope.
- No SQL text, stack trace, session claims, or secret values reach users.

## 14. Transactions and race handling

### Decision transaction

```text
BEGIN IMMEDIATE
  reload active actor and booking status
  reload booking + room + current policy
  authorize assignment/admin scope
  validate future interval, hours, slot/duration, capacity
  validate current requirements and override
  validate confirmed conflicts and current buffer
  compare-and-set pending → approved/rejected
  append decision audit event
COMMIT
```

Any failure rolls back. No network or external service call occurs inside the transaction. Do not return success before commit.

### Cancellation transaction

```text
BEGIN IMMEDIATE
  reload active requester + booking
  enforce requester_id = actor.id
  enforce pending OR approved-before-start
  compare-and-set state → cancelled and write cancellation fields
  append cancellation audit event
COMMIT
```

### Competing actions

- Include expected prior status in the update condition, even after transaction re-read.
- If manager/admin decision wins first, a later decision returns current state without duplicate event.
- If requester cancellation wins first, approval returns current state and cannot proceed.
- If approval wins first, requester may still cancel afterward only while start remains future.
- For overlapping pending requests, first valid approval wins; later approval returns conflict and remains pending.

## 15. Privacy, security, and fairness

### Authorization

- Resolve profile from current session/database on each page/action.
- Manager scope from current `rooms.manager_id`, never token/client data.
- Admin scope from persisted active admin profile.
- Requester cancellation requires requester ID from session, not form.
- Every query/action repeats scope checks; never rely on navigation hiding.

### Transparency

- Requester sees decision and reason.
- Eligibility override is explicit and visible, but does not certify future eligibility.
- Managers see current vs request-time eligibility separately.
- No AI/score decides access or allocation.
- Default queue is oldest-submission-first; this is a transparent workflow ordering, not a claim of universal fairness.

### Data minimization

- Show operational request context only for authorized assigned rooms.
- Avoid showing student email by default if display name is enough.
- Avoid duplicating purpose/group in audit summaries; reference the booking.
- Do not expose internal-only notes; Phase 3 has none.
- No unauthenticated calendars/private schedules.

## 16. Non-functional requirements

- Demo queue page server-rendered under 500 ms on local seeded SQLite.
- Bounded queue page size (default 25, max 100) and stable pagination/order.
- Every decision and its event are atomic; failed checks leave no writes.
- A stale page cannot force a stale decision.
- Database unavailability never defaults to approval.
- Forms are keyboard accessible; errors are field-associated and announced.
- Status is understandable without color; mobile at 360px has no unintended overflow.
- Reuse Phase 2 availability/time logic; do not duplicate overlap predicates in UI.
- Add migrations; keep seed idempotent; centralize typed transitions.

## 17. Copy and error states

| Context | Required meaning |
| --- | --- |
| Pending | “Pending review — this is not permission to enter.” |
| Approval | “Request approved. The room/time is allocated; this does not confirm a door was unlocked.” |
| Rejection | “Request not approved. The requester will see this reason.” |
| Eligibility blocker | “A required eligibility check is not verified. Verify it or use an authorized override with a recorded reason.” |
| Override | “This overrides eligibility for this booking only. It does not verify the profile for future requests.” |
| Conflict | “This request now overlaps a confirmed booking. No decision was saved.” |
| Stale state | “This request was already updated. Refresh to see the latest status.” |
| Cancellation | “This withdraws your request/booking. The room may become available to others.” |
| Cancellation cutoff | “This approved booking has started and can no longer be cancelled here.” |

Never say “Access granted,” “Door unlocked,” or “Confirmed entry” in Phase 3.

## 18. Error and edge-case matrix

| Scenario | Result | Persistence |
| --- | --- | --- |
| Assigned manager views pending request | Authorized detail | Read only |
| Unassigned manager guesses request ID | Safe not found | No write |
| Admin views request | Institution-wide authorized detail | Read only |
| Student invokes decision action | Forbidden | No write |
| Valid approval | Approved receipt | Booking + one event atomically |
| Valid rejection | Rejected receipt/reason | Booking + one event atomically |
| Missing decision reason | Validation error | No write |
| Eligibility unsatisfied, no override | Approval blocked | No write |
| Override selects wrong/verified requirement | Validation error | No write |
| Valid override but room closed | Approval blocked | No write |
| Room/policy changed since request | Approval blocked | No write |
| Request time now past | Approval blocked | No write |
| Confirmed overlap | Conflict | No write; pending remains |
| Concurrent decision lost race | Stale/current-state result | No duplicate event |
| Requester cancels own pending | Cancelled receipt | Booking + event atomically |
| Requester cancels own future approved | Cancelled receipt | Booking + event atomically |
| Requester cancels after start | Not cancellable | No write |
| Manager/admin cancels for requester | Forbidden | No write |
| Database/audit insert failure | Safe error + correlation ID | Transaction rollback |

## 19. Acceptance test plan

### Queue and role scope

1. Priya sees pending requests for her rooms; Marcus does not.
2. Marcus sees his rooms; Priya's requests are absent.
3. Admin sees institution-wide requests and counts.
4. Student, anonymous, suspended users cannot access queue.
5. Direct detail access outside manager scope returns safe not-found.
6. Filters/counts/pagination preserve actor scope.

### Decisions and invariants

1. Assigned manager/admin can approve valid pending with reason.
2. Assigned manager/admin can reject pending with reason.
3. Student/unassigned manager cannot decide.
4. Forged actor/status/room/requester fields cannot alter trusted values.
5. Already-decided request cannot transition again.
6. Approval rechecks room, hours, request policy, slot, max duration, capacity, future time, current eligibility, and confirmed conflicts.
7. Minimum notice is not re-applied at decision time unless policy is changed.
8. Two overlapping pending requests can exist; only one can be approved.
9. Database overlap trigger blocks direct invalid approval.
10. Audit failure rolls back status; successful change has exactly one audit event.

### Eligibility override

1. Current verified mandatory requirement allows ordinary approval.
2. Missing/unverified/expired requirement blocks ordinary approval.
3. Override is restricted to assigned manager/admin.
4. Override needs exact unsatisfied requirement IDs and reason length.
5. Override cannot change profile verification or bypass other hard checks.
6. Requester sees override disclosure and reason.

### Cancellation

1. Requester cancels own pending with reason.
2. Requester cancels own future approved with reason.
3. Non-owner/manager/admin cannot cancel in Phase 3.
4. Past-start, checked-in, rejected, cancelled, completed bookings cannot be cancelled.
5. Approval/cancellation race produces one serialized valid outcome.
6. Cancelled record no longer blocks search; history remains.
7. Retry does not append duplicate event.

### Accessibility/privacy

1. Manager decision flow works by keyboard and screen reader labels.
2. Reasons/errors are text, not color-only.
3. Student pages include no manager-only data.
4. 360px layout has no horizontal page overflow.
5. Pending state always says not permission to enter.

## 20. Demo fixtures and walkthrough

Seed remains idempotent. Maintain:

- one Priya-assigned pending Media Studio request with an unverified required equipment induction;
- one Marcus-assigned pending request with current requirements verified;
- one future approved booking for conflict demonstration;
- pending overlaps in a manager-assigned room if safely representable;
- one rejected sample with requester-visible reason;
- one future approved booking that its requester can cancel;
- historical cancelled sample with explicit fixture/backfill semantics;
- two disjoint manager room portfolios and active/inactive profiles.

All sample times must be generated relative to seed time and fit schedule windows. `npm run db:reset` must restore a demo-ready database without manual edits. Seeded decisions must be clearly fixture data.

Suggested demo: sign in as Priya, review an eligibility warning, show normal approval blocked, optionally make a reasoned override, show conflict blocking for an overlapping request, then switch to the student and show the requester-visible decision. Demonstrate that a different manager cannot access Priya's queue. Avoid implying a physical door was unlocked.

## 21. Implementation guidance

Suggested modules (names may vary):

```text
app/app/manager/queue/page.tsx
app/app/manager/requests/[id]/page.tsx
app/app/manager/actions.ts
app/app/bookings/actions.ts
components/manager/decision-panel.tsx
components/manager/queue-filters.tsx
components/bookings/cancel-booking-form.tsx
lib/bookings/decisions.ts
lib/bookings/cancellation.ts
lib/bookings/manager-queries.ts
lib/bookings/transitions.ts
db/migrations/003_phase3_manager_review.sql
```

Reuse `getCurrentProfile()`/`requireCurrentProfile()`, `lib/authorization.ts`, `lib/rooms/availability.ts`, `lib/time/campus-time.ts`, and existing booking/audit tables. Keep UI in server components/actions and SQLite access server-only. Decision routes must be dynamic/per-user; no static cache of private queue data. Do not show optimistic success before commit.

## 22. Dependencies and assumptions

- Phase 1/2 implementation and tests remain intact.
- One primary `rooms.manager_id`; no co-manager table.
- Admin has explicit institution-wide scope; no delegated admin model.
- Pending requests do not reserve room time; only approved/checked-in states block.
- All timestamps remain UTC in storage and campus-local in UI.
- Minimum notice is a request-submission check, not an approval-time recheck.
- Demo eligibility and room policy are illustrative, not institutional truth.
- Single-instance SQLite with persistent volume remains the deployment model for this phase.
- No notifications/email or external identity service is required.
- Request changes, waitlist, manager-side cancellation, access, and incident handling are deferred.

## 23. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Cross-room request disclosure | Scope every manager query/action by current assignment; negative tests and safe not-found |
| Overlapping approvals | Immediate transaction, compare-and-set, canonical overlap logic, database trigger |
| Stale eligibility | Re-read current requirement and verification records at decision time |
| Hidden override bypass | Explicit opt-in, exact requirements, separate reason, audit, requester disclosure |
| Approval confused with entry | Copy distinguishes allocation from physical access; no unlock language |
| Status change without audit | Same transaction for booking update and append-only event |
| Unsupported rejection | Required requester-visible reason |
| Decision replay | State compare-and-set and no duplicate success event |
| Stale room rules | Revalidate current room state/policy/hours/capacity |
| Hidden allocation bias | Oldest-submission-first default; no opaque score/AI; reasons retained |
| Cancellation after start | Server cutoff and checked-in exclusion |
| SQLite scale limits | Single instance documented; shared lock/store required before horizontal scaling |
| Scope creep into changes/waitlist | Explicitly defer until state/resubmission policy is defined |

## 24. Delivery sequence and exit gates

### Step 1 — Migration and transition design

Add cancellation and eligibility-override fields, allowed-transition/decision metadata defense-in-depth, and safe historical fixture handling.

**Exit:** migration works from zero and from populated Phase 2 DB; fixtures/history remain valid.

### Step 2 — Scoped queue reads

Add manager/admin queue/detail projections, filters/counts/pagination, pending overlaps, and current confirmed-conflict display.

**Exit:** assignment and admin scope tests pass; no cross-room leakage.

### Step 3 — Decision services

Implement approve/reject, current-state checks, eligibility override, audit transaction, concurrency handling, and safe domain errors.

**Exit:** decision tests pass for hard checks, overrides, stale state, race, rollback, and invariants.

### Step 4 — Manager UI and requester visibility

Implement queue, detail, approve/reject panels, status/reason rendering, and role-aware navigation.

**Exit:** manager can decide from UI; requester sees the persisted outcome after refresh.

### Step 5 — Cancellation

Implement requester-only pending/future-approved cancellation with reason, transactional audit, and availability effect.

**Exit:** allowed/denied cancellation tests and UI behavior pass.

### Step 6 — Hardening and docs

Run full check, smoke test, migration test, and seeded demo walkthrough; update `README.md` and `plan.md`.

**Exit:** definition of done below; no manual database changes required.

## 25. Definition of done

Phase 3 is complete only when:

- Manager queue/detail/actions are room-assignment scoped; admin scope is explicit.
- Students, anonymous, suspended, and unassigned managers cannot read or mutate out-of-scope requests.
- Only `pending` can be approved/rejected; only own pending/future approved can be cancelled.
- Approval revalidates live room, hours, policy, capacity, time, current eligibility, and conflicts.
- Approval/rejection require reasons; eligibility override has separate reason and exact requirement list.
- Override is one-booking-only, requester-visible, and does not verify the user's profile.
- Confirmed overlap cannot be approved, including concurrent attempts.
- Booking status and audit event commit/rollback atomically.
- Cancellation preserves decision history, appends an event, and removes the booking from future blockers.
- Requester sees current status/reason after reload and pending still clearly means no entry authorization.
- Seed, migration, tests, production build, and HTTP smoke checks pass.
- `README.md` and `plan.md` accurately describe delivered and deferred features.

## 26. Handoff to Phase 4

Phase 4 must treat Phase 3 status as current authority:

1. Only `approved` may be considered for an allow decision.
2. `pending`, `rejected`, `cancelled`, inactive user, or revoked credential must deny.
3. Re-read booking state at every access check; no stale cached permission.
4. Log each allow/deny in append-only `access_events` with time, reason code, and correlation ID.
5. Cancellation in Phase 3 must immediately prevent future successful policy decisions.
6. Label simulator outcome as simulated; never claim a real door unlocked.

Phase 4 must not rewrite Phase 3 decision or cancellation history.
