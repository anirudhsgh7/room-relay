# RoomRelay — Phase 4 Product Requirements Document

**Phase:** Time-bound access policy and access events  
**Status:** Implemented  
**Depends on:** Phase 1 foundation, Phase 2 discovery/requests, and Phase 3 manager review/cancellation  
**Source of truth:** `RoomRelay_Project_Context.pdf`, `plan.md`, `phase-1-prd.md`, `phase-2-prd.md`, `phase-3-prd.md`, and the implementation in this repository  
**Implementation baseline:** Next.js 16 App Router, React 19, TypeScript, server-only SQLite (`better-sqlite3`), signed HTTP-only user sessions, server-owned credentials, approved bookings, append-only `access_events` and `audit_events`, and one configured campus timezone.

---

## 1. Executive summary

Phase 4 connects an approved room booking to a trustworthy, time-bound access decision. A signed-in user with a server-mapped credential can use a clearly labelled **Simulate access check** action for a room. RoomRelay evaluates the user's active profile, credential ownership and revocation state, room state, booking status, room/time match, and current campus-local time on the server. It returns an allow/deny result with a safe reason, records the attempt, and, on the first successful entry, transitions the booking from `approved` to `checked_in`.

The browser is never the authority. It does not decide to allow access, provide the decision timestamp, supply the actor ID, choose the event outcome, or claim that a real door unlocked. The simulator must be clearly identified as software-only. No physical NFC reader, QR device, relay, or production door is connected in this phase.

Every valid access attempt is recorded, including denied attempts for revoked, unknown/unowned credentials and unapproved/out-of-window room attempts. Access events and their request-scoped audit event are appended atomically. A retry with the same nonce returns the original recorded result and does not create a second event or repeat a state transition.

Phase 4 also provides role-scoped access history: students see their own attempts, managers see attempts for assigned rooms, and admins see institution-wide attempts. This is an access-event history, not yet the complete booking-to-exit timeline; Phase 5 adds condition reports, incidents, check-out, and the full lifecycle timeline.

---

## 2. Product context

The RoomRelay differentiator is that a reservation is connected to an access decision. Phases 1–3 now establish identity, role scope, room discovery, pending requests, manager decisions, cancellation, eligibility, and booking audit history. Phase 4 answers:

- Can this authenticated person use this credential?
- Is that credential active and mapped to this same account?
- Is there an approved booking for this person and this room?
- Is the attempt within the exact approved interval?
- Has the booking been cancelled or otherwise changed since approval?
- Was access allowed or denied, and why?
- Can the requester, manager, or admin inspect the event without exposing unrelated details?

### 2.1 Phase 4 product outcome

A user can select a room and one of their own server-mapped credentials, simulate a tap, and receive a server-calculated allow/deny outcome with a clear reason. A valid attempt is associated with an approved booking in its active time window; the booking becomes `checked_in`. Invalid attempts are denied and logged. The same capability remains useful when no hardware exists.

### 2.2 Phase boundary

```text
Phase 1: identity, roles, schema, demo foundation
    ↓
Phase 2: discover → request → validate
    ↓
Phase 3: review → approve/reject → cancel
    ↓
Phase 4: credential → server policy → allow/deny → access event  ← this PRD
    ↓
Phase 5: check-out, condition, incidents, complete history
```

### 2.3 Simulation claim

The Phase 4 UI and documentation must say **Simulated access check** or **Simulated tap**. An `ALLOW` result means the server policy accepted the simulated attempt; it does not mean a physical lock or door was actuated. No button, animation, color, or copy may imply an actual door unlocked.

---

## 3. Goals and success measures

### Goals

1. Keep every access allow/deny decision on trusted server code.
2. Bind the simulated credential to the currently authenticated account; never allow the browser to impersonate another user.
3. Permit access only when an active credential belongs to an active user with an approved/checked-in booking for the selected room and current server time.
4. Deny a cancelled, rejected, pending, missing, wrong-room, out-of-window, inactive-user, or revoked-credential attempt.
5. Record each validated attempt with a UTC timestamp, result, reason code, room, source, actor, optional booking/credential references, and unique correlation ID.
6. Transition `approved → checked_in` atomically on the first allowed access attempt.
7. Preserve `checked_in` while allowing additional valid attempts for the same booking inside its time window.
8. Make access history visible only to the requester, assigned room managers, and admins according to scope.
9. Make simulator and UI resilient to double submits, network retries, unknown credentials, rate limits, and unavailable services.
10. Leave a stable adapter boundary for future hardware without implementing physical reader/door integration.

### Success measures

- A judge can simulate a valid attempt for the seeded active access booking and receive a server-generated `ALLOW` result.
- A student with a revoked credential gets `DENY / CREDENTIAL_REVOKED`, even if they have an otherwise valid booking.
- A user without a booking for the selected room gets a privacy-safe `DENY / NO_APPROVED_BOOKING`.
- A future or expired booking gets `DENY / OUTSIDE_BOOKING_WINDOW`.
- A pending, rejected, or cancelled request can never return `ALLOW`.
- A valid first tap changes the associated booking to `checked_in` in the same transaction as the access event and audit event.
- Repeated valid taps while the booking is `checked_in` and in-window are allowed and separately logged, but do not repeat the booking state transition.
- Every allow/deny attempt is appended; historical access events cannot be edited/deleted by normal application code.
- A denied result does not disclose another user's name, group, purpose, booking ID, or interval.
- A replayed nonce creates no second event and no second state transition.
- `npm run check` passes with access policy, time boundary, revocation, ownership, nonce replay, transaction rollback, and role-scoped history tests.

---

## 4. Roles and access boundaries

### 4.1 Student / club lead

Can:

- open the access simulator for their own account;
- select an active or revoked credential that belongs to them (revoked is included so a deny path can be demonstrated);
- select an active room and simulate a check;
- inspect their own access attempts and the request/decision history for their own bookings;
- see the safe decision and reason for their attempt.

Cannot:

- pass another user's credential as their own;
- pass another user's profile ID or booking ID as authority;
- view another user's access attempts or booking details;
- set the current time, access result, reason code, source, reader identity, booking status, or actor;
- use a pending, rejected, or cancelled booking for access.

### 4.2 Room manager

Can:

- use their own mapped credential in the simulator, subject to the same booking policy as any user;
- view access history for rooms assigned to them;
- see only room-scoped access/booking context relevant to assigned rooms.

A manager role is not a blanket access entitlement. Being a room manager does not permit entry unless the manager has an active credential and an approved/checked-in booking for that room/time.

Cannot:

- simulate another user's credential;
- view attempts for unassigned rooms;
- create allow decisions from the UI or override access policy;
- change event history.

### 4.3 Administrator

Can:

- use their own mapped credential subject to the same policy;
- inspect institution-wide access-event history.

Admin role does **not** automatically grant access to all rooms. An admin still requires an active own credential and an approved/checked-in booking for the target room/time.

### 4.4 Unauthenticated/suspended profiles

- Anonymous users cannot use the simulator or view access history.
- Suspended/inactive users are denied even if the session cookie is otherwise valid.
- A database/profile lookup error fails closed.

### 4.5 Permission matrix

| Action | Student | Assigned manager | Unassigned manager | Admin | Anonymous/suspended |
| --- | --- | --- | --- | --- | --- |
| Simulate own credential in room | Yes, subject to booking policy | Yes, subject to booking policy | Yes, subject to booking policy | Yes, subject to booking policy | No |
| Submit another user's credential | No | No | No | No | No |
| View own access attempts | Yes | If their own attempts | If their own attempts | Yes | No |
| View attempts for assigned room | No, unless own booking event | Yes | No | Yes | No |
| View institution-wide access history | No | No | No | Yes | No |
| Set decision or timestamp in request | No | No | No | No | No |
| Override access result | No | No | No | No | No |
| Edit/delete access history | No | No | No | No | No |

All action checks are server-side. The UI may conditionally show room-history links but never defines access.

---

## 5. Scope and priorities

### 5.1 P0 — required

- Authenticated **Access** simulator page.
- Current user's credential selector showing credential label/type/status without exposing raw credential reference.
- Room selector/search using active room inventory.
- Server access policy service and `POST /api/access/check` simulator endpoint (or equivalent Server Action with the same contract).
- Server-computed allow/deny reason codes and messages.
- Credential ownership, active/revoked state, persisted profile status, room status, booking state, booking/user/room match, and time-window checks.
- Exact half-open access window `[start_at, end_at)` using server UTC time.
- `approved → checked_in` on first successful access in the same transaction as event logging.
- Append-only access event per validly handled attempt, including denied attempts.
- Append-only audit entry per access attempt, committed with the access event.
- Nonce/idempotency and replay protection for simulated requests.
- Role-scoped recent access history for student/manager/admin.
- Safe service-unavailable state that never allows access.
- Rate limiting for repeated access attempts.
- Tests for allow/deny reasons, boundary times, credential revocation/ownership, booking state, concurrency, nonce replay, and event history.
- Seed fixture for a currently active approved booking plus future/out-of-window and revoked-credential denial paths.
- README, smoke-test, dashboard/navigation updates.

### 5.2 P1 — strong if core is reliable

- Booking-specific activity timeline combining request submission, manager decision/cancellation, access events, and access-related audit records.
- Student access attempt result page with a printable/simple access receipt.
- Manager assigned-room access-history filter by date/result/reason.
- Safe demo “retry” experience for a timed-out request with the same nonce.
- Reason code description/help panel for the judge demo.

### 5.3 Defer

- Physical NFC reader/controller integration, firmware, QR scanner, relay/door output, or any live door.
- Device credentials, hardware HMAC/mTLS, reader provisioning, anti-replay cryptography for physical controllers.
- Offline authorization, cached permissions, distributed lock controller, occupancy sensors.
- Native mobile application, push/email notifications, photos, incident management, check-out, condition evidence, penalties.
- Per-room grace windows or “unlock early” buffer; access uses exact booking interval in this MVP.
- Admin credential binding/revocation UI; Phase 1 seed fixtures remain the source for demo credentials.
- AI decisions or inferred trust/risk scores.

Physical hardware is deliberately excluded from Phase 4. The code and payload should leave a clean adapter boundary for future reader integration, but this phase is a software-only proof.

---

## 6. Access policy model

The access service is the single authority for simulated access outcomes. It consumes a credential reference/credential ID and room context from a trusted request path, reads current database state, uses server time, and returns a decision with a safe reason.

### 6.1 Allow requirements

An access attempt is allowed only when **all** of the following are true:

1. Request has an authenticated, active profile resolved by the server.
2. The requested credential exists.
3. Credential belongs to the authenticated profile.
4. Credential is active and not revoked.
5. Selected room exists and is active.
6. There is a booking belonging to the same profile for the same room.
7. Booking status is `approved` or `checked_in`.
8. Server time is within the booking interval: `start_at <= now < end_at`.
9. Booking has not been cancelled or changed to another status.
10. Request nonce is fresh or is a valid same-actor/same-payload replay handled idempotently.
11. The database transaction and append-only writes complete successfully.

Role alone never grants access. Manager/admin accounts use the same user + credential + booking checks as a student.

### 6.2 Deny-by-default order

The service evaluates checks in a documented order so one attempt has one stable reason code:

1. Validate request shape and nonce.
2. Require active authenticated profile.
3. Resolve credential and verify credential ownership.
4. Verify credential active/revoked status.
5. Resolve active room.
6. Resolve an owned booking for this room.
7. Verify booking status.
8. Verify current server time is in the half-open booking interval.
9. Persist deny result, reason, and correlated audit event.

If several conditions fail, return the first non-sensitive reason in this order. Do not reveal another account's booking existence or details.

### 6.3 Time semantics

- Stored booking timestamps are UTC ISO-8601 values.
- Server time (`Date.now()` or an injected clock in tests) determines the decision time.
- User interface formats times in `ROOMRELAY_CAMPUS_TIMEZONE`.
- Access window is exactly `[start_at, end_at)`.
- At exactly `start_at`, access is allowed if all other checks pass.
- One millisecond before `start_at`, access is denied as outside the booking window.
- At exactly `end_at`, access is denied.
- `room_booking_policies.buffer_minutes` is for booking conflict/turnaround, not an access grace period.
- No client-supplied timestamp is accepted.
- Daylight-saving ambiguity was resolved when the booking was created in Phase 2; Phase 4 compares UTC instants and does not re-interpret the local wall time.

### 6.4 Booking state semantics

- `approved`: eligible for first in-window access.
- `checked_in`: eligible for additional in-window attempts for that same booking; first successful transition is not repeated.
- `pending`, `rejected`, `cancelled`, `completed`, `no_show`, `incident`, `draft`, or `waitlisted`: deny; never grant because another booking for the user exists in another room.
- A successful first attempt transitions the chosen booking from `approved` to `checked_in` atomically.
- Access outside the interval does not change booking state.
- Phase 5 introduces check-out and additional transitions from `checked_in`.

### 6.5 Credential semantics

- Credentials are references mapped server-side to profiles; the tag/credential does not carry a booking permission.
- Browser passes a credential row ID for the simulator (or a trusted adapter passes a credential reference in a future implementation); server confirms it belongs to the current session profile.
- Never trust `credentialId` simply because it appears in a signed-in form.
- Never accept an access result, profile ID, booking status, decision timestamp, reason code, or `source` from the browser.
- The UI displays an opaque human label and status, not raw `credential_ref`.
- A revoked credential remains in the database for history and must always deny.
- Unknown/unowned credential input returns a safe denial without indicating which account owns it.
- No credential binding/revocation operation is added to Phase 4.

---

## 7. Reason codes and user-facing messages

The server returns stable machine-readable reason codes. User-facing copy is mapped centrally and does not leak private booking details.

| Decision | Reason code | Safe UI message |
| --- | --- | --- |
| `ALLOW` | `ACCESS_ALLOWED` | “Access check allowed for your approved booking.” |
| `DENY` | `UNKNOWN_CREDENTIAL` | “This credential is not recognized for your account.” |
| `DENY` | `CREDENTIAL_NOT_OWNED` | Prefer generic “This credential cannot be used by this account.” |
| `DENY` | `CREDENTIAL_REVOKED` | “This credential has been revoked. Contact a room administrator.” |
| `DENY` | `ACCOUNT_INACTIVE` | “This account is not active for access checks.” |
| `DENY` | `ROOM_NOT_FOUND` | “This room is not available for an access check.” |
| `DENY` | `ROOM_INACTIVE` | “This room is not currently active.” |
| `DENY` | `NO_APPROVED_BOOKING` | “No approved booking for this room at this time.” |
| `DENY` | `BOOKING_NOT_APPROVED` | “This booking is not approved for access.” |
| `DENY` | `OUTSIDE_BOOKING_WINDOW` | “This attempt is outside your approved booking window.” |
| `DENY` | `RATE_LIMITED` | “Too many attempts. Wait briefly and try again.” |
| `DENY` | `REPLAYED_ATTEMPT` | “This tap was already processed. Start a new access check.” |
| no decision | `SERVICE_UNAVAILABLE` | “Access service is unavailable. No access was granted.” |

For privacy, `NO_APPROVED_BOOKING` must not say that another person has a booking. Manager/admin views may inspect authorized room events separately.

---

## 8. User journeys

### Journey A — valid simulated access

1. Student signs in and opens **Access checks**.
2. The page shows the user's own credentials and active approved/checked-in bookings or room choices.
3. The student selects their active credential and Seminar Room 02.
4. The browser submits credential ID, room ID, and a fresh event nonce to the server.
5. The server reloads the profile, credential, room, booking, and current server time.
6. The current time falls inside the approved booking window.
7. In one immediate transaction, the server changes `approved → checked_in`, inserts an `access_events` row (`ALLOW / ACCESS_ALLOWED`), and appends an `access.allowed` audit event.
8. The UI shows **Simulated access check: Allowed**, booking reference, timestamp, and a visible “No physical door was unlocked” disclaimer.
9. A second in-window attempt for the same checked-in booking is allowed and logged; state remains `checked_in`.

### Journey B — future approved booking, out-of-window

1. Student chooses an active credential and room where their only approved booking is in the future.
2. Server denies with `OUTSIDE_BOOKING_WINDOW` using server time.
3. A denied access event and correlated audit event are recorded.
4. Booking remains `approved`; no check-in state change occurs.
5. UI does not disclose unrelated bookings or let the user set an earlier test time.

### Journey C — revoked credential

1. Student selects one of their own revoked credentials from the clearly marked test fixture list.
2. Server denies with `CREDENTIAL_REVOKED` before booking evaluation.
3. Denial is timestamped and logged; no booking state changes.
4. UI explains the credential is revoked and does not reveal raw credential reference.

### Journey D — no booking/wrong room

1. Student chooses a room with no own approved or checked-in booking.
2. Server denies with safe `NO_APPROVED_BOOKING` (or `BOOKING_NOT_APPROVED` when a known own pending request is explicitly available to the simulator).
3. The response does not identify another user's booking or purpose.
4. Denial is logged with a safe reason and no booking association if no own booking matched.

### Journey E — cancelled booking

1. Student attempts access for a room after cancelling their approved booking.
2. Server finds no eligible booking in `approved`/`checked_in` state and denies.
3. A denied event records the attempt; the cancelled booking remains unchanged and visible in history.

### Journey F — manager room history

1. Manager opens Access history for an assigned room.
2. Manager sees allow/deny events for that room and enough identity to investigate within assigned scope.
3. Manager cannot view attempts for a room assigned to another manager.

### Journey G — service unavailable

1. Database/access service is unavailable.
2. Simulator shows a clear unavailable state; no allow result is produced.
3. No event is claimed to have been persisted when the database cannot accept a write.
4. Emergency egress/physical safety is not affected because no door hardware is connected.

---

## 9. Routes and information architecture

### `/app/access`

Authenticated simulator page.

- The current user's credentials only, with active/revoked labels and masked references.
- Room selection from active room inventory.
- Fresh nonce per attempt.
- **Simulate access check** action.
- Explicit software-only disclaimer.
- Recent personal attempts for the student; manager/admin may additionally navigate to scoped history.
- Empty states for no credentials, no bookings, no attempts, and service unavailable.

### `/app/access/history`

Role-scoped recent access history:

- Student: events where `actor_id = current profile ID` (and own booking context only).
- Manager: events for rooms assigned to current manager.
- Admin: institution-wide events.
- Filters: room, result, reason code, and campus-local date range.
- Bounded pagination and stable chronological ordering.
- No raw credential reference; display masked credential label.

### `/api/access/check`

Session-authenticated simulator API. The simulator route accepts only:

- `credentialId` (opaque database ID; server must verify ownership);
- `roomId` (target room; server resolves room);
- `eventNonce` (UUID/high-entropy unique request identifier).

It does not accept:

- actor/profile/user ID;
- booking status or booking decision;
- current timestamp;
- allow/deny decision or reason code;
- source (`simulator` is server-set);
- credential owner or raw tag UID as proof.

A later physical controller must use a separate authenticated device adapter; it must not reuse this browser-session simulator path as device authentication.

### Navigation

- Enable **Access checks** for authenticated roles.
- Add **Access history** link for managers/admins and a self-history link for students.
- Keep check-out, incident, and full audit timeline as Phase 5.
- Direct history URLs still enforce role scope on the server.

---

## 10. Screen requirements

### 10.1 Simulator page

Show:

- page heading **Simulated access check**;
- warning: “Software simulation only — no physical door or lock is connected.”;
- brief current-time context in campus timezone (display only; the server is authoritative);
- credential selector containing only current user's credentials;
- active/revoked state and credential type, never raw credential reference;
- target active-room selector;
- submit control;
- decision result with clear `ALLOW`/`DENY` label, reason code, safe explanation, server timestamp, room and optional own booking reference;
- latest attempt history scoped to the actor.

The UI may show the user's own upcoming approved bookings as helpful choices, but room and credential values are always revalidated by the service. Do not show a “force allow,” “change time,” or “set outcome” control.

### 10.2 Decision result

For allow:

- “Simulated access check: Allowed.”
- Show masked credential label, room, access timestamp in campus timezone, booking status now `Checked in`.
- Say “This was a software decision. No physical door was unlocked.”

For deny:

- “Simulated access check: Denied.”
- Show safe reason code/message, room, attempt timestamp.
- Do not reveal another user's booking details.
- State that no access was granted.

For service unavailable:

- Show no allow/deny event ID unless persisted;
- state “No access was granted”;
- provide a retry action that creates a fresh nonce.

### 10.3 Access history

Each row includes:

- timestamp in campus-local timezone;
- room name/code;
- allow/deny result and text reason;
- credential label/type masked;
- source `Simulated`;
- booking status/reference only if the viewer is authorized for that booking.

Students see only their own access attempts and own booking details. Managers see only assigned-room records. Admin sees institution scope. Never display a raw credential reference in the UI.

### 10.4 Accessible behavior

- Result is announced as an alert/live region after submission.
- ALLOW/DENY always uses text, not color only.
- Keyboard users can select credential/room, submit, and reach result/history.
- Prevent duplicate click while processing, but server nonce/idempotency remains authoritative.
- Honor reduced motion and 360px mobile layout.

---

## 11. Functional requirements

### FR-4.01 — Authentication and actor resolution

- Every simulator/API/history route requires an active persisted profile.
- Actor ID is derived from current server session; never from payload.
- Suspended profiles deny even if session cookie remains valid.
- Manager/admin roles do not confer automatic room-entry rights.

**Acceptance:** anonymous/suspended requests never receive ALLOW; changing a client role value does not change decision.

### FR-4.02 — Credential lookup/ownership

- Browser simulator selects credential ID from server-provided list for current actor.
- Before booking evaluation, service loads the credential from DB and verifies `user_id = actor.id`.
- Unknown/non-owned ID returns a safe denial; it must not reveal owner or credential metadata.
- Inactive/revoked credential denies with `CREDENTIAL_REVOKED`.
- Credential raw reference is not echoed in API response, HTML, or logs.
- Credential row is not deleted when revoked; history remains linkable.

### FR-4.03 — Booking/room/time decision

- Resolve active room; inactive/missing room denies.
- Find a current actor-owned booking for that room in `approved` or `checked_in`.
- If none is currently active, distinguish only safe reasons: no approved booking versus outside window when the actor owns an approved/checked-in booking in that room but its time is not active.
- Require `start_at <= server_now < end_at`.
- `cancelled`, pending, rejected, completed, no-show, incident, waitlisted, and draft cannot ALLOW.
- A booking for a different room never authorizes the selected room.
- Do not leak any other user's booking existence, time, purpose, or status.

### FR-4.04 — First successful access and check-in

- If valid booking status is `approved`, first ALLOW changes status to `checked_in`.
- Access event, audit event, and booking state change commit in one immediate transaction.
- If booking status is already `checked_in` and remains in window, allow/log another attempt without changing booking state again.
- If the check-in state transition fails, no ALLOW is returned.
- Denied attempt never changes booking state.
- Phase 5 will add check-out/complete/incident transitions; Phase 4 does not implement those actions.

### FR-4.05 — Access event persistence

Every syntactically valid, authenticated attempt that reaches the access service is recorded when DB writes are available:

- `occurred_at` from server UTC time;
- `credential_id` when mapped (nullable for unknown);
- `attempted_credential_ref` masked or a safe constant, never a raw secret/tag reference in public output;
- `room_id` for a valid room selection;
- allow/deny result and stable reason code;
- source set server-side to `simulator`;
- correlation ID derived from event nonce;
- actor ID, booking ID, reader/simulator ID, and request hash added by Phase 4 migration.

Access events remain append-only. A database/service failure fails closed and must not claim a durable event was recorded.

### FR-4.06 — Audit event/timeline integration

- For each recorded access event, append an `access.allowed` or `access.denied` audit event in the same transaction.
- Use matching correlation ID to correlate audit/access records.
- Keep access event as the detailed source for the policy result; audit event provides cross-lifecycle actor/action history.
- Denied attempts are audited without unnecessary PII.
- Access and audit event writes are atomic with `approved → checked_in` on first successful access.
- Phase 4 provides an access history/timeline surface; Phase 5 extends it with check-out, condition, and incident events.

### FR-4.07 — Nonce, retry, and replay handling

- Every simulator submission includes a UUID or equivalent high-entropy `eventNonce`.
- Store it in the existing unique correlation field; add a canonical request hash and actor ID.
- Same nonce + same actor + same normalized room/credential input returns the already-recorded result without a second event or state transition.
- Same nonce with different actor or payload is rejected as `REPLAYED_ATTEMPT` (no second grant/event).
- A new user tap uses a new nonce.
- In future physical integrations, nonce idempotency alone is insufficient; signed device request/anti-replay controls are required.

### FR-4.08 — Rate limiting

- Rate limit per active actor (e.g. 20 access checks/minute) and optionally by source IP as secondary control.
- Rate-limited attempts receive safe `RATE_LIMITED` denial.
- If the system can persist the attempt, persist a rate-limit denial event; avoid expensive credential/booking work after the limit is exceeded.
- Never return an allow because the rate-limit store is unavailable.
- Current in-memory limiter is demo-only and single-process; document shared store requirement before horizontal scale.

### FR-4.09 — Access history authorization

- Student query constrains by `actor_id = profile.id` and may show booking details only when booking requester matches actor.
- Manager query constrains by current `room.manager_id = profile.id`.
- Admin query is explicit institution-wide.
- Anonymous/suspended actors have no access history.
- Do not load all events then filter in UI.
- Use bounded, stable pagination and allowlisted filters.

### FR-4.10 — Outage/fail-closed behavior

- If profile, credential, room, booking, clock/configuration, or database state cannot be validated, no allow decision is returned.
- If the DB is unavailable, return HTTP 503/service unavailable and do not claim event persistence.
- Do not fallback to client-side status, cached browser permission, or offline allow.
- Emergency egress is outside this software simulator and is never changed by this phase.

---

## 12. Reason codes

Use stable codes in API, DB, tests, and UI. Maintain a centralized code-to-copy map.

| Result | Reason code | Safe UI text |
| --- | --- | --- |
| Allow | `ACCESS_ALLOWED` | “Access check allowed for your approved booking.” |
| Deny | `UNKNOWN_CREDENTIAL` | “This credential is not recognized for your account.” |
| Deny | `CREDENTIAL_NOT_OWNED` | “This credential cannot be used by this account.” |
| Deny | `CREDENTIAL_REVOKED` | “This credential has been revoked. Contact a room administrator.” |
| Deny | `ACCOUNT_INACTIVE` | “This account is not active for access checks.” |
| Deny | `ROOM_NOT_FOUND` | “This room is not available for an access check.” |
| Deny | `ROOM_INACTIVE` | “This room is not currently active.” |
| Deny | `NO_APPROVED_BOOKING` | “No approved booking for this room at this time.” |
| Deny | `BOOKING_NOT_APPROVED` | “This booking is not approved for access.” |
| Deny | `OUTSIDE_BOOKING_WINDOW` | “This attempt is outside your approved booking window.” |
| Deny | `RATE_LIMITED` | “Too many attempts. Wait briefly and try again.” |
| Deny | `REPLAYED_ATTEMPT` | “This tap was already processed. Start a new access check.” |
| No decision | `SERVICE_UNAVAILABLE` | “Access service is unavailable. No access was granted.” |

Do not return a different message that reveals another person's booking. For browser simulator attempts, generic no-booking copy is preferred.

---

## 13. Data model and migration

Add forward-only migration `004_phase4_access_policy.sql`. Do not edit migrations `001`–`003`.

### 13.1 `access_events` additions

Add nullable fields for historical compatibility:

| Field | Meaning |
| --- | --- |
| `actor_id` | authenticated simulator actor / mapped device actor when trusted |
| `booking_id` | own booking evaluated, if one is safely associated |
| `reader_id` | stable simulator/reader context; Phase 4 server sets a simulator ID |
| `request_hash` | hash of canonical actor/credential/room request for nonce replay verification |

Keep `correlation_id` unique and use it as the event nonce/idempotency key. Existing seeded access events should be backfilled where the mapping is unambiguous (for example, credential owner); otherwise fields remain null and are labeled as historical seed records.

Add indexes for actor/time, booking/time, and existing room/time queries. Keep access event update/delete triggers. Add audit event update/delete triggers if not already present; audit history is append-only.

### 13.2 Transition trigger update

Phase 3 currently permits `pending→approved/rejected/cancelled` and `approved→cancelled`. Phase 4 migration must replace/extend the transition trigger to also allow:

- `approved → checked_in` (trusted successful access only).

Do not enable `checked_in → completed/incident` until the Phase 5 migration. Continue to reject unsupported client/service transitions.

### 13.3 Access reason constraints

- `result` remains `allowed` or `denied`.
- `source` is `simulator` for all Phase 4 web-originated attempts.
- `reason_code` is non-empty and from the centralized supported set for new simulator records.
- Unknown credentials may have null `credential_id`; the request still records a safe attempted reference marker.
- Raw credential/tag references must not be returned to users; persist only the credential reference already held server-side or a masked/hashed form according to the final schema decision.

### 13.4 Audit correlation

For a successful access attempt, the event and `access_events` row share a correlation ID. Access decision plus audit write plus first check-in state change occur in one transaction. For denies, access event and audit event commit together.

---

## 14. API/service contract

### 14.1 Simulator request

`POST /api/access/check` (Node runtime; authenticated browser simulator only):

```json
{
  "credentialId": "cred_amelia_active",
  "roomId": "room_seminar_02",
  "eventNonce": "7d8e3a00-0000-4000-8000-000000000000"
}
```

The endpoint sets `source = 'simulator'`, actor from the session, `occurred_at` from server time, and decision/reason from the policy service.

### 14.2 Response

```json
{
  "decision": "DENY",
  "reasonCode": "OUTSIDE_BOOKING_WINDOW",
  "message": "This attempt is outside your approved booking window.",
  "eventId": "access-event-id",
  "occurredAt": "2026-10-28T12:00:00.000Z",
  "source": "SIMULATED",
  "replayed": false
}
```

The response never contains raw credential reference, another user's identity, another booking's purpose, internal SQL, or a secret.

### 14.3 Trust and request security

- Validate `Origin`/same-origin for the cookie-authenticated POST or use an equivalent CSRF protection supported by the framework.
- Validate schema and rate limits server-side.
- `credentialId` must be an active row owned by the signed-in profile for ALLOW.
- `roomId` is looked up server-side and must be active.
- The server ignores/rejects extra fields such as actor, booking, timestamp, decision, source, reason, reader authentication, or profile.
- This endpoint is not authenticated for external devices. A future device adapter needs a separate device identity and authenticated protocol.

---

## 15. Transaction and consistency requirements

### 15.1 Access attempt transaction

For a known authenticated actor and a validly shaped attempt:

1. Normalize/validate input and event nonce.
2. Begin immediate SQLite transaction.
3. Resolve nonce replay; same actor/payload returns existing outcome without writes, mismatched replay denies safely.
4. Re-read actor profile and account status.
5. Resolve credential and enforce ownership/active state.
6. Resolve room and status.
7. Find actor-owned approved/checked-in booking for the selected room.
8. Compare server timestamp to exact half-open booking window.
9. Produce allow/deny reason code.
10. Insert immutable `access_events` row with actor/room/credential/booking/result/reason/time/source/correlation.
11. Insert matching `access.allowed` or `access.denied` audit event.
12. On first allowed access, update booking `approved→checked_in` with a compare-and-set update.
13. Commit, then return the decision.

If any write fails, roll back state and events. Do not return ALLOW before the transaction commits. A policy denial is a valid transaction and should normally persist both event records.

### 15.2 Replay semantics

- Same actor + same nonce + same canonical payload returns the previously stored result/event ID with `replayed: true`; it does not append a second event or repeat state transition.
- Same nonce with different actor or different credential/room payload returns `REPLAYED_ATTEMPT` and does not reveal the original event.
- A retry never causes a second physical side effect; there is no physical side effect in this phase.
- Future device integrations must provide additional replay-resistant device authentication; nonce alone is not a production door-security protocol.

### 15.3 Rate-limit semantics

- Rate-limit before expensive DB policy work.
- If an authenticated request is denied by rate limit and DB remains available, persist a `RATE_LIMITED` deny event under the same transactional path.
- If rate-limit storage/configuration is unavailable, fail closed; no allow result.
- The current in-memory limiter is a demo control; horizontal deployments require shared rate-limit storage.

---

## 16. Access history and timeline authorization

### Student

- Query only `access_events.actor_id = current_profile.id`.
- May see details for a booking only if `bookings.requester_id = current_profile.id`.
- Does not see other actors' names or attempts for a room.

### Manager

- Query only rooms where `rooms.manager_id = current_profile.id`.
- May see actor display name and room event details needed for operations, but not raw credential secret/reference.
- Cannot query other managers' rooms by changing date/room filters.

### Admin

- Institution-wide access event read scope.
- Admin role does not grant access entry itself.

### Timeline behavior

- Phase 4 access history can combine booking `audit_events` and `access_events` for authorized scopes, ordered by UTC timestamp and stable event ID.
- Each row identifies source as simulated.
- Access result and reason are visible.
- Phase 5 adds checkout, condition, and incidents to the connected timeline; do not label Phase 4 history as complete lifecycle history.

---

## 17. Error and edge-case matrix

| Scenario | Decision/UI | Event/state behavior |
| --- | --- | --- |
| Active own credential, active booking, exact start time | ALLOW | Event + audit; `approved→checked_in` |
| Active own credential, within active interval | ALLOW | Event + audit; no second state transition |
| One instant before start | DENY `OUTSIDE_BOOKING_WINDOW` | Event + audit; no state change |
| Exact end time | DENY `OUTSIDE_BOOKING_WINDOW` | Event + audit; no state change |
| Pending booking | DENY `BOOKING_NOT_APPROVED`/safe equivalent | Event + audit; no state change |
| Cancelled booking | DENY `NO_APPROVED_BOOKING` or safe cancelled code | Event + audit; no state change |
| No own booking for target room | DENY `NO_APPROVED_BOOKING` | Event + audit; no booking association |
| Booking exists only for another room | DENY `NO_APPROVED_BOOKING` | No other room booking disclosed |
| Credential revoked | DENY `CREDENTIAL_REVOKED` | Event + audit; no booking evaluation needed beyond safe association |
| Unknown/non-owned credential | DENY generic credential reason | Event + audit; no owner disclosure |
| Account suspended | DENY `ACCOUNT_INACTIVE` | Event if actor can be safely identified; no state change |
| Inactive/missing room | DENY room reason | Event if selected room resolves; no state change |
| Duplicate same nonce/payload | Return existing response | No new event/state transition |
| Duplicate nonce, changed payload/actor | DENY `REPLAYED_ATTEMPT` | No second event for mismatched nonce |
| Rate limit exceeded | DENY `RATE_LIMITED` | Persist denial when DB available; no state change |
| DB unavailable | SERVICE_UNAVAILABLE | No ALLOW; no claim of persisted event |
| Audit insert fails | SERVICE_UNAVAILABLE | Roll back access event and check-in |
| Two taps race first check-in | Both may be evaluated serially | Only one state transition; each distinct nonce may have its own event |

---

## 18. Acceptance test plan

### Policy and identity

1. Active own credential + own approved booking + active window allows.
2. Role (student/manager/admin) alone never allows access.
3. Manager without own booking is denied even in an assigned room.
4. Admin without own booking is denied.
5. Inactive/suspended profile denies.
6. Unknown credential denies without owner disclosure.
7. Credential owned by another profile denies.
8. Revoked credential denies even if user has an active approved booking.
9. Inactive room denies.
10. Booking in a different room does not allow the selected room.

### Time/status

1. `start_at <= now < end_at` is allowed.
2. One millisecond before start denies outside window.
3. Exact end timestamp denies.
4. Pending/rejected/cancelled/completed/no-show/incident/waitlisted/draft never allow.
5. Approved booking future/past denies outside window.
6. First valid access sets booking to `checked_in`.
7. Subsequent valid checked-in access in window is allowed without repeating state change.
8. Denied attempts do not mutate booking state.

### Events and security

1. Every allow/deny inserts `access_events` and `audit_events` with matching correlation.
2. First allowed event, audit event, and checked-in status commit together.
3. Failure writing audit rolls back event and check-in.
4. Access/audit events cannot be updated/deleted.
5. Client-supplied decision, source, actor, timestamp, booking status, and reason are ignored/rejected.
6. Same nonce/payload is idempotent; same nonce with different payload is rejected.
7. Rate limiting denies excessive attempts and does not grant during limiter failure.
8. Service/DB unavailable returns no grant.

### History authorization and UI

1. Student sees own events only.
2. Manager sees assigned-room events only.
3. Admin sees institution events; admin still cannot enter without an own booking/credential.
4. Raw credential reference is not rendered.
5. Simulation disclaimer appears before and after result.
6. Denied reason does not reveal another user's booking information.
7. Result is announced to assistive technology and status is text plus color.
8. Mobile layout has no page-level horizontal overflow.

---

## 19. Demo fixtures

Keep Phase 4 demo reliable after `npm run db:reset`:

- Amelia has one active credential and one revoked credential.
- Amelia has one synthetic, explicitly labelled **demo access window** whose approved interval is active around seed time, permitting an immediate simulated ALLOW.
- Amelia has a separate future approved booking in another room to demonstrate `OUTSIDE_BOOKING_WINDOW` without colliding with the currently active demo window.
- Amelia has a room without an approved booking for `NO_APPROVED_BOOKING`.
- Existing pending/rejected/cancelled fixtures remain for their corresponding denial paths.
- A recorded denied seed event may show an example reason, but live event history tests must distinguish `source='seed'` from `source='simulator'`.

The active demo booking is a synthetic test fixture, not evidence of a real campus reservation or a claim about room-hour policy. It must be clearly marked as demo data in the UI/docs.

Suggested 3-minute demo:

1. As Amelia, show active credential and active demo booking.
2. Simulate a valid tap: ALLOW, booking becomes Checked in, event appears.
3. Repeat with revoked credential: DENY / CREDENTIAL_REVOKED.
4. Choose future booking interval: DENY / OUTSIDE_BOOKING_WINDOW.
5. Choose room without own approval: DENY / NO_APPROVED_BOOKING.
6. Open access history as Priya and show only assigned room attempts; show simulator-only disclaimer.

---

## 20. Security, privacy, and physical safety

- The browser requests a policy check; trusted server code decides.
- Never encode names, emails, booking permissions, or long-lived authorization on a credential/tag.
- Treat a demo UID as a credential reference, not proof of personhood or a production secret.
- Fail closed on database/network/service errors; never allow offline.
- Do not install a prototype relay on a live restricted door.
- Keep emergency egress independent; no physical locking/actuation in Phase 4.
- Do not claim “unhackable,” “production-secure,” or “door unlocked.”
- The simulator is user-session authenticated, not device authenticated. Future hardware use requires separate device authentication, authenticated transport, nonce/replay protection, controller provisioning, safety review, and institutional approval.
- Minimize event data; mask credential identifiers in UI and logs.
- Access events may be sensitive: apply role-scoped retention and access expectations in later production work.

---

## 21. Implementation guidance

Suggested modules (filenames may vary):

```text
app/app/access/page.tsx
app/app/access/history/page.tsx
app/api/access/check/route.ts
app/app/access/actions.ts
components/access/access-attempt-form.tsx
components/access/access-result.tsx
lib/access/policy.ts
lib/access/service.ts
lib/access/queries.ts
lib/access/validation.ts
db/migrations/004_phase4_access_policy.sql
```

Keep browser simulator and future hardware adapter separate. The simulator adapter supplies authenticated actor + selected own credential + room + nonce to the same policy service. A future reader adapter can submit a credential reference + reader identity through a separate authenticated device boundary without changing policy semantics.

The API should use the Node runtime for `better-sqlite3`, validate same-origin/CSRF for cookie-authenticated POSTs, and return typed safe responses. Keep SQLite out of Client Components.

---

## 22. Dependencies, assumptions, and risks

### Assumptions

- Phases 1–3 and migration 003 are implemented and passing checks.
- Credential refs are server-side mappings; user has a current credential record.
- Only one institution timezone is configured.
- Access interval has no early/late grace period; exact half-open interval applies.
- Physical NFC, QR, device API authentication, and door actuation are out of scope.
- A successful first access is the Phase 4 check-in event; check-out belongs to Phase 5.

### Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Client becomes authority | Server-only policy; payload excludes decision/time/actor; tests mutate fields |
| Credential copied/shared | Server ownership, revocation, event log; clearly state UID is prototype-grade |
| Cancelled/stale approval cached | Re-read booking status on every attempt inside transaction |
| Replay | Unique nonce/correlation + request hash + idempotent behavior; future hardware needs stronger auth |
| Cross-user data leak in denial | Generic reason and scoped history queries |
| Denial is not logged | Append event/audit atomically whenever DB can accept it |
| Audit failure after allow | Atomic transaction; no ALLOW response before commit |
| Offline service defaults allow | Fail closed; explicit unavailable UI |
| Simulation is mistaken for real unlock | Persistent labels before/after attempt and in docs |
| Demo active booking has artificial time | Explicit demo fixture label; no production policy claim |

---

## 23. Delivery sequence and exit gates

### Step 1 — Migration and policy types

Add actor/booking/reader/request-hash access event fields, indexes, seed backfill, append-only guarantees, and `approved→checked_in` transition. Add typed decision/reason codes.

**Exit:** migration applies to fresh and populated Phase 3 DB; historical access events remain readable.

### Step 2 — Access service

Implement credential ownership, account state, room, booking/status/window checks, nonce replay, rate limiting, one-transaction event/audit/check-in, and safe responses.

**Exit:** policy tests cover allow/deny/time/revocation/state/atomicity/replay.

### Step 3 — Simulator UI/API

Build `/app/access`, credential and room selectors, result states, own recent attempts, and simulator disclaimer. Add `POST /api/access/check` or equivalent secure server action.

**Exit:** a judge can execute a valid and denied attempt with no manual data edits or hardware.

### Step 4 — Scoped history

Build role-scoped access history with filters and bounded pagination; merge booking audit/access history only for authorized scope.

**Exit:** student, manager, and admin history tests prevent cross-scope reads.

### Step 5 — Polish, tests, docs

Update seed fixtures, README, plan, navigation, CI/smoke test; verify exact boundary-time behavior and fresh-reset demo.

**Exit:** `npm run check` passes and demo clearly identifies all access as simulated.

---

## 24. Definition of done

Phase 4 is complete only when:

- All access decisions are server-calculated and fail closed.
- Simulator credentials belong to current actor; revoked/unknown/non-owned credentials deny.
- Active booking must match actor and selected room and be approved/checked-in.
- Exact `[start_at, end_at)` server-time window is enforced.
- First allow atomically changes approved to checked-in and records access/audit events.
- Subsequent valid taps within the same checked-in window are allowed and logged without duplicate transition.
- All relevant denials are timestamped and logged when database is available.
- Nonce retry does not create duplicate event or repeat side effect; mismatched replay denies.
- Access events and audit events are append-only.
- Student/manager/admin history is scoped correctly; admin does not receive implicit access.
- UI and docs say simulator-only and never claim a physical door unlocked.
- Physical reader integration is not required to finish Phase 4.
- Migrations/seed are repeatable; Phase 1–3 workflows still pass.
- `npm run check` passes lint, typecheck, all unit/integration tests, build, and HTTP smoke test.

## 25. Handoff to Phase 5

Phase 5 will build on `checked_in` and the access event stream to add:

1. Requester check-out and room-left-as-found confirmation.
2. Condition reports and incident submission.
3. Manager/admin review and resolution note.
4. `checked_in → completed` or `checked_in → incident` transitions with audit history.
5. A connected booking lifecycle timeline containing request, decision, cancellation, access attempts, check-out, condition, and incident events.
6. Human review for sanctions/penalties; no automatic punishment from access or incident data.

Phase 5 must preserve Phase 4 access events and never rewrite earlier allow/deny decisions.
