# RoomRelay — Phase 5 Product Requirements Document

**Phase:** Check-out, condition/incident handling, and lifecycle history  
**Status:** Implemented  
**Depends on:** Phases 1–4  
**Source of truth:** `RoomRelay_Project_Context.pdf`, `plan.md`, `phase-1-prd.md` through `phase-4-prd.md`, and the current application implementation  
**Implementation baseline:** Next.js 16 App Router, React 19, TypeScript, server-only SQLite, persisted role/room scope, booking status transitions through `checked_in`, append-only `access_events` and `audit_events`, one configured campus timezone, and explicitly simulated access.

---

## 1. Executive summary

Phase 5 closes the booking lifecycle after a successful access check. A requester who has checked in can record that they are leaving, submit a required post-use condition report, and either close the booking as `completed` or report an issue that enters human review. Managers review/recommend on incidents for their assigned rooms; an administrator records the final resolution. The requester can follow their own close-out and incident status. Authorized room managers and admins can inspect a connected lifecycle timeline.

The core success path is:

```text
pending → approved → checked_in → completed
                              ↘ incident → completed (after final review)
```

`checked_in` is set by the Phase 4 server access policy on the first successful simulated access. Phase 5 records the post-use handover and prevents a booking from remaining indefinitely active after its user leaves. A clean check-out requires a condition report and transitions to `completed`. A reported issue creates an incident, closes the access session, and changes the booking to `incident` until all related incidents receive an authorized final resolution.

Every state transition and report must be attributable and auditable. Historical access/decision events remain immutable. No AI, automated penalty, trust score, real door control, or unreviewed sanction is introduced.

---

## 2. Product context

Phases 1–4 deliver identity, room discovery, requests, manager decisions, cancellation, time-bound access checks, check-in, and access-event logging. The remaining operational questions are:

- Did the person leave the room after using it?
- Was the room left in acceptable condition?
- Was a problem reported, by whom, and who is reviewing it?
- Has the incident been resolved by an authorized human?
- What happened from request through decision, access, and close-out?

Phase 5 makes the lifecycle accountable through handover, human-reviewed incidents, and a timeline. It must not infer misconduct, impose penalties automatically, or claim that a simulated access event is a physical door event.

### 2.1 Phase 5 outcome

A requester with a `checked_in` booking can complete a check-out action and persist an after-use condition report. If the room is left as found, the booking becomes `completed`. If the requester reports an issue, the booking becomes `incident`, an incident enters a manager-review/admin-resolution workflow, and the requester can see progress. All authorized actors can inspect the relevant lifecycle history under their role scope.

### 2.2 Scope boundary

- Phase 4 access remains simulated; Phase 5 does not connect to physical devices.
- Phase 5 closes use after `checked_in`; it does not mark an approved booking as a no-show or create automatic overdue penalties.
- Phase 5 implements a minimal read-only admin incident/usage overview; full room/user/credential administration is deferred.
- Check-out does not imply a physical lock was activated or that an emergency egress system changed state.

---

## 3. Goals and success measures

### Goals

1. Let the booking requester check out only a booking they own that is currently `checked_in`.
2. Require a persistent post-use condition report for every successful check-out.
3. Complete a clean booking atomically with the report and audit history.
4. Create an incident instead of silently completing when the requester reports damage, cleanliness, equipment, safety, or another issue.
5. Keep an incident's status distinct from the booking lifecycle status.
6. Let assigned managers record a review/recommendation without making a final sanction decision.
7. Let an active administrator record final incident resolution with a resolution note.
8. Complete an incident booking only after every incident associated with that booking is resolved.
9. Show a booking-scoped timeline with request, decision, cancellation, access, condition, incident, and close-out events.
10. Enforce requester, assigned-room manager, and admin visibility on the server.
11. Preserve immutable access/audit history and append correction events rather than rewriting the past.
12. Keep outcomes explainable and subject to human review; do not automate penalties.

### Success measures

- A `checked_in` booking can be checked out exactly once; a retry does not create duplicate condition reports, incidents, or audit events.
- Every successful check-out creates one after-use report and records `checked_out_at`.
- A clean report transitions `checked_in → completed` with an audit event in the same transaction.
- An issue report creates a condition report and incident and transitions `checked_in → incident` atomically.
- A pending/open incident is visible to the requester, assigned manager, and admin—never unrelated users.
- Only an assigned manager or admin can view/review incidents for a room; only an admin can finalize resolution.
- Admin resolution is recorded with a non-empty reason and audit event.
- A booking with multiple incidents remains `incident` until all are resolved.
- A denied access attempt, decision, condition report, or incident event remains unchanged in historical views.
- Timeline order is deterministic and uses campus-local display with UTC storage.
- All lifecycle routes are accessible and role-scoped, and `npm run check` passes.

---

## 4. Roles and permissions

### 4.1 Student / club lead (booking requester)

Can:

- view their own booking status and timeline;
- optionally submit a before-use condition note for their own checked-in booking;
- check out their own `checked_in` booking;
- select “left as found” or “issue needs review” and submit a post-use report;
- create an incident only as part of reporting an issue for their own checked-in booking;
- see the incident state and final resolution note for their own booking.

Cannot:

- check out another user's booking;
- edit or delete a condition report after submission;
- mark their own incident resolved;
- set a reviewer, manager/admin decision, or booking status;
- see another user's booking timeline or incident.

### 4.2 Assigned room manager

Can:

- view timelines and incidents for rooms assigned through `rooms.manager_id`;
- move an open incident to `reviewing`;
- attach a manager review/recommendation note;
- add a follow-up manager review note through an append-only audit action if required by the implementation;
- inspect before/after condition notes for assigned rooms.

Cannot:

- view incidents for an unassigned room;
- edit/delete a condition report or prior incident event;
- make the final authorized resolution or impose a penalty;
- check out a user's booking on their behalf;
- set a booking to completed directly.

### 4.3 Administrator

Can:

- view institution-wide incidents and timelines;
- record the final resolution for an open/reviewing incident with a required note;
- close a booking's incident state when all related incidents are resolved;
- view a minimal institution overview of active check-ins, open incidents, and recent completed bookings.

Cannot:

- rewrite access/decision/audit history;
- impose an automated penalty from an incident status;
- use a resolution action without persisted admin role and an audit record.

### 4.4 Suspended/anonymous profile

Cannot access private booking, condition, incident, or audit timeline data. Every action reloads the active persisted profile; a stale session does not retain access.

### 4.5 Permission matrix

| Action/data | Requester | Assigned manager | Unassigned manager | Admin | Anonymous/suspended |
| --- | --- | --- | --- | --- | --- |
| Read own booking timeline | Yes | Only if assigned room, or own record | No | Yes | No |
| Read other requester timeline in assigned room | No | Operational fields only | No | Yes | No |
| Submit own after-use report/check-out | Own `checked_in` booking | No | No | No by default | No |
| Submit own issue incident at check-out | Own `checked_in` booking | No | No | No by default | No |
| Read incident for assigned room | Own incident | Yes | No | Yes | No |
| Move incident to reviewing | No | Assigned room | No | Yes | No |
| Final incident resolution | No | No | No | Yes | No |
| Edit/delete submitted condition report | No | No | No | No | No |
| Institution incident overview | No | No | No | Yes | No |

---

## 5. Scope and priorities

### 5.1 P0 — required

- Requester check-out page/form for a `checked_in` booking.
- Required after-use condition report with structured condition state and notes.
- Clean check-out transition `checked_in → completed`.
- Issue-at-checkout flow creating a condition report + incident and transitioning `checked_in → incident`.
- Incident requester view and status.
- Manager incident queue scoped to assigned rooms.
- Manager transition `open → reviewing` with review note/recommendation.
- Admin final resolution with a required resolution note.
- Booking becomes `completed` after all associated incidents are resolved.
- Booking-scoped lifecycle timeline with role-appropriate visibility.
- Append-only audit events for reports, check-out, incident report/review/resolution, and completion.
- Forward-only schema migration with idempotent seed updates and historical backfill.
- Tests for status transitions, permissions, duplicate submissions, audit atomicity, and timeline scope.

### 5.2 P1 — strong if the core is stable

- Optional before-use condition report after check-in.
- Minimal read-only admin dashboard with open/reviewing incidents, active check-ins, and recent completions.
- Incident category/date/room filters and queue pagination.
- Manager review-history note appended without replacing earlier notes.
- Incident report form supports a small optional evidence description (no file upload).
- Overdue informational badge when `checked_out_at` is later than scheduled `end_at`; no penalty or automated sanction.

### 5.3 Defer

- Photo upload/storage, notifications, email, calendar export, analytics, payments/deposits, occupancy sensors.
- Manager/admin check-out on behalf of a requester.
- Automatic no-show classification or penalties.
- Appeals, disputes, sanctions, trust score, AI-generated incident findings, or punitive recommendations.
- Full room CRUD/policy editor, user/credential administration, multi-institution support.
- Offline access, hardware integration, live door control, NFC reader setup.

---

## 6. Booking and incident state model

### 6.1 Booking states used by Phase 5

| Current state | Action | Next state | Actor |
| --- | --- | --- | --- |
| `checked_in` | Clean check-out + after report | `completed` | Requester |
| `checked_in` | Check-out + issue report | `incident` | Requester |
| `incident` | All linked incidents finally resolved | `completed` | System transaction triggered by admin resolution |

The booking may transition only once through the supported lifecycle. Repeated check-out submissions return the current state and do not insert a duplicate after-report or incident.

No-show is not implemented in Phase 5. An `approved` booking that never checked in remains outside this check-out flow.

### 6.2 Incident states

| Incident state | Meaning | Allowed next action |
| --- | --- | --- |
| `open` | Requester reported an issue; no manager review yet | Assigned manager starts review; admin may resolve directly |
| `reviewing` | Assigned manager recorded a review/recommendation | Admin records final resolution |
| `resolved` | Admin recorded final resolution note | Read-only |

The booking remains `incident` while any incident is `open` or `reviewing`. When the last incident linked to a booking becomes `resolved`, the same transaction moves the booking to `completed` and records its close time.

### 6.3 No automatic penalties

- A reported issue is an allegation/observation, not a finding of fault.
- Manager review can document facts/recommendation, not impose a penalty.
- Admin final resolution closes the operational record; it does not automatically create a fine, suspension, or profile restriction.
- Any future sanction requires separate institutional policy and human authorization.

---

## 7. Check-out and condition policy

### 7.1 Eligibility for check-out

Only the booking requester with an active profile may check out a booking where:

- booking status is `checked_in`;
- booking requester equals the current profile;
- the booking has not already been checked out;
- no other actor-supplied identity is accepted.

Check-out is permitted after the scheduled end time so users can close an overdue session. Late check-out is recorded; Phase 5 does not automatically penalize or reject it.

### 7.2 Required after-use report

Every successful check-out requires one after-use condition report:

- condition state `left_as_found` or `issue_found`;
- notes 5–1000 characters after trimming;
- submitted by current requester;
- server timestamp in UTC;
- attached to the booking.

For `left_as_found`, UI copy confirms the room is being reported as returned in acceptable condition. Notes may contain concise handover details; the default text can be “Room left as found.” but the report remains an explicit requester submission.

For `issue_found`, a valid incident category and issue description of 10–1500 characters are additionally required. The after-use report and incident are created together.

### 7.3 Optional before-use report

P1: While a booking is `checked_in`, requester may submit one before-use condition report describing a pre-existing issue. This does not change booking status. It must be append-only and is available only to the booking owner. This is a protection against attributing an existing problem to the requester, not a mandatory barrier to starting use.

### 7.4 Check-out success paths

**Clean close-out:**

1. Re-read active requester and checked-in booking inside an immediate transaction.
2. Insert after-use report with `left_as_found`.
3. Set booking status `completed`, `checked_out_at`, `closed_at`, `closure_reason` as appropriate.
4. Append condition-report and booking-completed audit events.
5. Commit all together.

**Issue reported:**

1. Re-read active requester and checked-in booking inside an immediate transaction.
2. Insert after-use report with `issue_found`.
3. Insert an incident with `open` status and requester reporter.
4. Set booking status `incident`, set `checked_out_at`; leave `closed_at` null.
5. Append condition-report, incident-reported, and booking-incident audit events.
6. Commit all together.

Any failure rolls back all writes. Do not display success until commit succeeds.

---

## 8. Incident policy and review

### 8.1 Categories

Use an allowlist:

- `damage`
- `cleanliness`
- `equipment`
- `safety`
- `overstay`
- `other`

User-facing labels are human-readable. Server rejects unknown categories. `other` requires a useful description; no arbitrary category string.

### 8.2 Manager review

- Only a manager assigned to the booking's room or an admin may read/review the incident.
- Assigned manager may transition `open → reviewing` and write a review/recommendation note of 10–1000 characters.
- Manager review records actor/time/note and appends `incident.review_started` (or `incident.review_updated`) audit event.
- Manager cannot set incident `resolved`, write final resolution fields, or set booking to `completed`.
- Manager review is not a determination of fault.

### 8.3 Admin final resolution

- Only an active admin can transition `open → resolved` or `reviewing → resolved`.
- Resolution note is required, 10–1500 characters.
- Resolution record includes admin profile ID and server UTC resolution time.
- Admin may resolve with no sanction; the UI must not imply penalties.
- After updating the incident, check for any other unresolved incidents linked to the booking.
- If all are resolved, set booking `incident → completed`, set `closed_at`, and append `booking.completed` in the same transaction.
- If another open/reviewing incident remains, booking stays `incident`.

### 8.4 Incident privacy

- Student requester sees their own incident's category, description, state, manager review status/note where designated requester-visible, and final resolution note.
- Manager sees details only for assigned rooms.
- Admin sees institution-wide incidents.
- Never expose reports to other students or unauthenticated visitors.
- Do not show the reporter's unrelated bookings, credential IDs, or access patterns.

---

## 9. Lifecycle timeline

Phase 5 adds a booking-scoped timeline assembled from immutable/auditable sources:

- `audit_events` for booking submission, approve/reject, cancellation, access decisions, condition report submissions, incident report/review/resolution, and completion;
- `access_events` for detailed access result/reason and source;
- `condition_reports` for before/after handover records;
- `incidents` for current state plus incident-specific events from the audit log.

### Timeline requirements

- Sort chronologically by UTC timestamp, with deterministic event ID/source tie-break.
- Render timestamps in campus timezone and make event actor/action clear.
- Avoid duplicating access events when both audit and access rows exist; choose one canonical display entry with detail link or merge fields.
- Student sees only timeline for own booking.
- Manager sees timeline only for assigned room.
- Admin sees institution scope.
- Historical records are never edited to “correct” the past; corrections are new events.
- Full export/analytics are out of scope.

### Suggested event labels

| Event | Display label |
| --- | --- |
| `booking.submitted` | Request submitted |
| `booking.approved` | Request approved |
| `booking.rejected` | Request not approved |
| `booking.cancelled` | Request/booking cancelled |
| `access.allowed` | Simulated access allowed |
| `access.denied` | Simulated access denied |
| `condition.before_submitted` | Arrival condition reported |
| `condition.after_submitted` | Check-out condition reported |
| `incident.reported` | Incident reported |
| `incident.review_started` | Manager review started |
| `incident.resolved` | Incident resolved by administrator |
| `booking.completed` | Booking completed |

---

## 10. Scope and routes

### `/app/bookings/[id]`

Extend requester booking detail:

- for `checked_in`, show check-out panel;
- show any before-use report and after-use report;
- if incident state, show issue status and review history;
- show full authorized lifecycle timeline;
- requester-only access check-in time and close-out time;
- no manager/admin actions rendered for requester.

### `/app/incidents`

Manager/admin queue:

- manager sees assigned rooms only;
- admin sees institution-wide list;
- filters for incident status, room, category, date, and whether requester has checked out;
- default manager view is open/reviewing incidents;
- manager can open incident detail and start review;
- admin can open and resolve.

### `/app/incidents/[id]`

Role-scoped incident detail:

- booking/room context, report category/description, requester, after-use condition report, access/check-in/checkout facts relevant to this incident;
- manager review panel for assigned managers;
- final resolution panel for admin;
- read-only for requester except seeing own report and status;
- no sanction controls.

### `/app/audit` (admin; P1)

Minimal read-only institution event view, filterable and role-gated. If scope is too large, implement the timeline only on booking/incident details in P0 and defer this global view.

### Navigation

- Add **Incidents** for managers/admins; students reach incident from their booking.
- Keep **Access history** from Phase 4.
- Add requester check-out affordance only for checked-in own booking.
- Keep admin room CRUD out of P0; if implementing a minimal room setup page, use the P1 criteria below.

---

## 11. Functional requirements

### FR-5.01 — Requester check-out authorization

- Require active profile and `profile.id = booking.requester_id`.
- Require current booking state `checked_in`.
- Reject cancelled, pending, approved-not-checked-in, completed, incident, and other states.
- Check-out is allowed at or after the booked end time; no automatic penalty is applied for late time.
- Ignore any client-supplied status, actor, checkout timestamp, booking owner, or room.

**Acceptance:** direct form/API invocation by another user or a manager fails with safe not-found/forbidden and creates no report/event.

### FR-5.02 — After-use condition report

- Required on every successful check-out.
- Validate condition state and notes server-side.
- `left_as_found` requires a non-empty note/acknowledgement.
- `issue_found` requires category plus meaningful description.
- Report actor and timestamp derive from server/session.
- Report is immutable after insertion; corrections are new reports/events if product policy later supports them.
- A unique booking+stage constraint prevents duplicate after reports.

### FR-5.03 — Clean check-out

- In one immediate transaction: re-read actor and booking, verify checked-in ownership, insert `after` report, update booking to `completed`, set checkout/close timestamps, append report and completion audit events.
- Failed write rolls back all changes.
- Successful receipt displays **Completed**, condition note, and timeline.

### FR-5.04 — Check-out with issue

- In one immediate transaction: verify actor/booking, insert after report with `issue_found`, insert open incident, transition booking `checked_in → incident`, set `checked_out_at` and leave `closed_at` null, append report/incident/booking events.
- No access attempts after the booking enters incident can be allowed because Phase 4 policy only allows approved/checked-in active bookings; the access service must re-read status.
- Requester sees incident reference and status `Open — awaiting review`.

### FR-5.05 — Optional arrival-condition report (P1)

- Requester may submit one `before` condition report for their checked-in booking.
- Does not change booking/incident state.
- Is append-only and included in the booking timeline.
- No photo upload in Phase 5.

### FR-5.06 — Incident manager queue and scope

- Managers see incidents only for currently assigned rooms.
- Admin sees all incidents.
- Student sees only their incident through their booking detail.
- Queue data/counts/filters are scoped in SQL, not filtered in React.
- Unknown/out-of-scope IDs return safe not-found.

### FR-5.07 — Manager review

- Assigned manager can move an `open` incident to `reviewing` with review note (10–1000 chars).
- Actor and timestamp are server-derived.
- Manager may not resolve the incident or close the booking.
- Every review action appends audit event in the same transaction as current incident review fields.
- If a review note is updated, append a new audit event; never rewrite prior event history.

### FR-5.08 — Admin resolution

- Active admin can resolve an `open` or `reviewing` incident with final resolution note (10–1500 chars).
- Store reviewer/admin ID and resolved timestamp.
- Append `incident.resolved` audit event atomically.
- If all incidents for the booking are resolved, transition booking `incident → completed`, set `closed_at`, and append `booking.completed` in the same transaction.
- If any linked incident remains unresolved, keep booking status `incident`.
- Resolution does not impose automatic penalty, suspension, or credential revocation.

### FR-5.09 — Booking/incident state guards

Migration triggers and service checks must enforce:

- `checked_in → completed` only with an after condition report;
- `checked_in → incident` only with at least one newly opened incident and after report;
- `incident → completed` only when all linked incidents are resolved;
- `incident.status` transitions only `open → reviewing/resolved` or `reviewing → resolved`;
- resolved incident is immutable except future append-only correction metadata;
- condition reports are append-only;
- no Phase 5 mutation can change approved/rejected/cancelled bookings into checked-in/completed.

### FR-5.10 — Timeline

- Render request, decision, cancellation, access, check-in, condition, incident, resolution, and completion events.
- Query only actor-authorized booking/room scope.
- Merge sources without duplicate display rows.
- Use UTC ordering and campus-local presentation.
- Clearly distinguish simulated access from physical access.
- Empty timeline state is explicit; no fabricated event is added for absent hardware.

### FR-5.11 — Minimal admin room setup (P1)

If included after lifecycle P0 is stable, admins may create/edit/deactivate room records, assign an active manager, edit weekly hours and structured booking policy. They may not delete rooms with booking/event history. Changes require server validation and audit entries. The seed process must not overwrite admin changes on every startup; separate immutable fixtures from user-managed records or make seeding insert-only. User/credential admin, institutional eligibility verification UI, and multi-institution support remain out of scope.

---

## 12. Migration/data model

Add forward-only migration `005_phase5_closeout.sql`; do not edit migrations `001`–`004`.

### `bookings` additions

| Field | Meaning |
| --- | --- |
| `checked_in_at` | first successful Phase 4 allow time; backfill from earliest allowed access event per booking where available |
| `checked_out_at` | requester checkout time; set for clean or incident checkout |
| `closed_at` | final booking completion time; null while incident unresolved |
| `closure_reason` | safe closure outcome/category such as `left_as_found` or `incident_resolved` |

### `condition_reports` additions

- `condition_state` constrained to `left_as_found` or `issue_found` for new records;
- keep `stage` as `before`/`after`;
- add unique partial index on `(booking_id, stage)` if the product enforces one report per stage;
- append-only update/delete triggers;
- historical seed rows get a safe default/backfill.

### `incidents` additions

- `manager_reviewed_by` nullable profile FK;
- `manager_reviewed_at` UTC timestamp;
- `manager_review_note` text;
- `resolved_at` UTC timestamp;
- keep existing `reviewer_id` for final admin reviewer and `resolution_note` for final resolution;
- category remains allowlisted by application (damage/cleanliness/equipment/safety/overstay/other);
- resolved status requires active admin reviewer, resolved time, and non-empty final note.

### Status/role triggers

Update booking allowed-transition trigger to permit `checked_in→completed`, `checked_in→incident`, and `incident→completed` only when all linked incidents are resolved. Preserve prior Phase 3 and Phase 4 transitions. Add incident transition/assignment triggers for manager review and admin resolution. Do not allow a manager to set final resolved status.

### Backfill

- For `checked_in` bookings without `checked_in_at`, use the earliest associated allowed access event; if none exists, leave null and mark it as legacy/unavailable for strict reporting rather than inventing a timestamp.
- Existing completed/incident fixtures may backfill `checked_out_at`/`closed_at` only from unambiguous existing condition report/event timestamps; otherwise leave nullable with historical presentation.
- Seed must provide complete new fields for newly created fixtures.

---

## 13. Transactions, races, and invariants

### Checkout transaction

```text
BEGIN IMMEDIATE
  reload active actor + booking
  enforce requester ownership and checked_in state
  validate after report and, if needed, incident fields
  insert after condition report
  if clean: checked_in → completed; set checked_out_at/closed_at
  if issue: insert open incident; checked_in → incident; set checked_out_at
  append report + booking/incident audit events
COMMIT
```

### Manager incident review

```text
BEGIN IMMEDIATE
  reload active actor + incident + booking + room assignment
  require assigned manager and open/reviewing status
  update manager review fields/status
  append incident.review_started or incident.review_updated event
COMMIT
```

### Admin incident resolution

```text
BEGIN IMMEDIATE
  reload active admin + incident + booking
  require open/reviewing and valid final note
  set incident resolved/reviewer/resolved_at
  append incident.resolved event
  if no unresolved linked incidents: incident booking → completed; set closed_at
  append booking.completed event when transitioned
COMMIT
```

Any failure rolls back all state/event writes. Do not call email, storage, or network APIs inside transactions. Database unavailable means no success response.

---

## 14. Privacy, safety, and human review

- Student condition/incident data is visible only to the requester, assigned manager, and admin.
- Manager data scope is by current room assignment, not room ID supplied by client.
- Admin can see institution scope but cannot edit prior access/audit events.
- Collect only room condition details needed for handover and review; no participant rosters or sensitive personal information.
- Never automatically assign blame, detect trustworthiness, or impose a penalty.
- Manager review is a recommendation; admin resolution is a human decision.
- AI may assist a future summary only if separate policy permits; it cannot make findings or sanctions.
- Avoid storing photos in Phase 5. Future file upload would require storage controls and access policy.
- No physical door/egress changes are made by check-out or incident handling.
- Clearly state the access subsystem remains simulated.

---

## 15. Acceptance tests

### Checkout and reports

1. Requester can submit a clean after-report for own checked-in booking; booking completes.
2. Requester can submit issue after-report; incident opens and booking enters incident state.
3. Pending, approved-not-checked-in, cancelled, completed, or another user's booking cannot be checked out.
4. Missing condition, reason, category, or issue details fail with field errors and no writes.
5. Duplicate form submission cannot create duplicate after report/incident/audit events.
6. Check-out after scheduled end is allowed and records actual time without penalty.
7. `checked_in` is required; no-show flow is not inferred.

### Incident review

1. Manager can review incident for assigned room only.
2. Unassigned manager cannot read/review incident by URL tampering.
3. Manager cannot resolve incident or close booking.
4. Admin can resolve with required final note.
5. Admin resolution records reviewer/time/audit.
6. Booking completes only when all linked incidents resolve.
7. Incident resolution does not create a penalty or user suspension.

### Timeline/privacy

1. Student sees own booking timeline only.
2. Manager sees only assigned-room timeline.
3. Admin sees institution timeline.
4. Access event appears once, not duplicated as both raw access and audit entries.
5. Condition and incident actions appear in deterministic chronological order.
6. Historical access/decision events remain unchanged.

### UI

1. A checked-in booking offers condition/check-out actions.
2. Clean and issue paths are clearly distinguished.
3. Requester sees incident status and final resolution.
4. Managers/admins see relevant queues and role-appropriate controls.
5. Keyboard and mobile workflows work without color-only states or horizontal overflow.

---

## 16. Demo fixtures

After `npm run db:reset`, seed:

- one currently `checked_in` booking that can be checked out cleanly;
- one separate checked-in fixture suitable for an issue/incident demo, or let the judge create an incident from the live checked-in fixture;
- one open incident awaiting manager review;
- one reviewing incident awaiting admin resolution;
- one resolved incident and completed booking for history view;
- multiple assigned room portfolios and an admin account;
- one before-use report and one after-use report;
- access events for allowed and denied cases from Phase 4.

Seeded times are relative to seed time. Seed changes must be idempotent and must not manufacture real-world incident claims; fixture copy explicitly says these are demo examples.

Suggested 3–4 minute demo:

1. Show an approved booking, active simulated check-in, and the requester check-out screen.
2. Submit “left as found” and show Completed plus timeline.
3. Use a second fixture to report an equipment issue; show booking enters incident workflow.
4. As manager, review/recommend for assigned room.
5. As admin, add final resolution note and show booking completes.
6. Show timeline with request → decision → access → check-out → incident resolution; emphasize no automatic penalty and no physical lock.

---

## 17. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Checkout by wrong requester | Re-read booking and requester in transaction; negative tests |
| Duplicate check-out/incident on retry | State compare-and-set, unique stage/report rule, transaction rollback |
| Incident accusation treated as fact | Label report as unreviewed; manager recommends; admin final review |
| Booking completes while incident remains open | Keep booking `incident` until all related incidents resolve |
| Manager resolves without authority | DB/app role checks; only admin may finalize |
| Incident history overwritten | Append audit events for review updates; preserve original report |
| Timeline leaks another user's purpose | Scope at SQL by requester/assigned room/admin |
| Audit/source events duplicated | Canonical merge and de-dup by correlation/entity/action |
| Overdue booking auto-penalized | Record actual checkout time only; no automatic sanctions |
| Admin room edits clobber seed | Keep P1; separate fixture data or make seeding insert-only before enabling edits |

---

## 18. Delivery sequence and definition of done

### Delivery sequence

1. Add Phase 5 migration, state triggers, timestamps, condition-state and incident-review fields.
2. Implement checkout and report service with transaction tests.
3. Build requester checkout and issue-report UI.
4. Implement scoped manager incident review and admin final resolution.
5. Build booking/incident timelines with role-scoped merged event queries.
6. Add P1 admin read-only incident/usage overview and optional room setup only if P0 is stable.
7. Update fixtures, README, plan, CI/smoke tests, and verify demo from reset DB.

### Definition of done

Phase 5 is done only when:

- Requester can check out only their own checked-in booking.
- Every successful checkout creates an after condition report and actual checkout time.
- Clean checkout atomically sets completed and appends audit events.
- Issue checkout atomically creates incident, records report, and moves booking to incident.
- Assigned manager can review/recommend but not finalize or penalize.
- Admin resolves with required note and audit record.
- Booking incident becomes completed only after all incidents are resolved.
- Requester/manager/admin timeline visibility is correctly scoped.
- Existing access and decision history is immutable and clearly labeled as simulated where relevant.
- No automatic penalties/sanctions or physical lock actions are implemented.
- Migrations and seed are repeatable, the full lifecycle demo works from reset state, and `npm run check` passes.

## 19. Handoff to Phase 6

Phase 6 hardens the whole product, verifies deployment and backup demo, tests the full role/state matrix and concurrency, audits privacy/security limitations, and prepares submission materials. It must preserve the immutable lifecycle history and keep simulation-vs-hardware claims accurate.
