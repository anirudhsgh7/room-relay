# RoomRelay — Phase 1 Product Requirements Document

**Phase:** Foundation and demo definition  
**Status:** Draft for implementation  
**Source of truth:** `RoomRelay_Project_Context.pdf` and `plan.md`  
**Repository starting point:** No application source code existed before this phase.  
**Implementation status:** Implemented in this repository. The as-built foundation uses server-only SQLite and explicit scrypt/session authentication instead of managed Supabase Auth because no external project credentials were available. The equivalent trust boundary, append-only history, demo data, tests, and deployment configuration are documented in `README.md`. A public preview URL still requires hosting-provider credentials.

## 1. Executive summary

Phase 1 establishes a secure, reproducible foundation for RoomRelay. It turns the product concept into explicit workflow, role, status, data, and demo decisions; creates a runnable web application; provisions the first database schema and authorization policies; and supplies dependable demo accounts and seed data.

Phase 1 is not the room-booking product itself. It does not implement room discovery, booking submission, manager decisions, access checks, or check-out screens. It prepares the app, schema, permissions, and fixtures so those later phases can be delivered without reworking foundational decisions.

At the end of this phase, a developer must be able to clone the repository, configure documented environment variables, start the app and its backing services, sign in as each seeded role, verify that role information comes from trusted server-side data, and see consistent seed data in both local and hosted preview environments.

## 2. Product context

Universities often coordinate shared rooms with disconnected calendars, messages, and manual access processes. Students need to find suitable spaces and understand whether they are eligible to request them. Room managers need to control availability and approve use. Administrators need role oversight and a reliable history of important actions.

RoomRelay's distinguishing product idea is a connected room lifecycle: discovery, request, review, authorization, access, and close-out. The product should be understandable as a room operations tool—not just a calendar—and should make decision status and responsibility visible.

### Phase 1 product decision

The first release targets **one university-like institution and rooms only**. It supports three roles: student/club lead, room manager, and administrator. The booking workflow will use explicit statuses, and permission checks will be enforced outside the browser. Demo access will ultimately be simulated through software; physical hardware is not a Phase 1 dependency.

## 3. Goals and success measures

### Goals

1. **Make the project runnable:** establish a documented local development setup and a hosted preview.
2. **Resolve foundational product ambiguity:** record roles, permissions, booking statuses, room policy assumptions, time handling, and the judge demo story.
3. **Establish trusted identity and authorization:** authenticated users receive roles from persisted server-side profile data, not client input.
4. **Establish the initial relational data model:** create versioned migrations and database policies for the complete MVP lifecycle.
5. **Make demonstrations repeatable:** provide seeded users, rooms, credentials, bookings, and example history without manual database editing.
6. **Keep the foundation safe to extend:** secrets stay out of the client and repository, timestamps are consistent, and important records can be audited.

### Success measures

- A new contributor can follow the setup guide and reach a running local application without undocumented steps.
- The local and hosted environments use the same migration and seed process.
- A student, room manager, and admin can each sign in using documented demo accounts.
- Changing a browser-submitted role value does not change a user's effective permissions.
- Database access policies prevent users from reading or modifying records outside their role's scope.
- Re-running the seed process does not create duplicate demo rooms, profiles, credentials, or bookings.
- The team can demonstrate the agreed story from a fresh, seeded state without hand-editing the database.

## 4. Users and roles

### Student / club lead

Needs to discover rooms, understand constraints, request a room for a group and purpose, know whether approval has been granted, and later review their own booking history. Students must not approve requests, change room rules, assign roles, or inspect another group's private booking details.

### Room manager

Needs to manage rooms assigned to them, review requests for those rooms, make and explain approval decisions, and review relevant room history. A manager must not gain access to every room merely by having the manager role.

### Administrator

Needs institution-wide room, user, credential, policy, and audit oversight. Administrative actions must be server-authorized and auditable.

### System / unauthenticated visitor

An unauthenticated visitor may reach the login experience and public application shell. Phase 1 does not expose private booking, user, credential, or audit data to anonymous visitors.

## 5. Scope

### In scope

- Product and architecture decisions needed to implement later phases.
- Next.js/React/TypeScript application scaffold and baseline styling/build tooling.
- Environment-variable handling and a safe example configuration file.
- Authentication integration and sign-in/sign-out for demo roles.
- Persisted user profiles and server-side role resolution.
- Initial schema migrations, indexes, constraints, and database row-level security policies.
- Idempotent seed process for demo accounts and sample data.
- Minimal login, authenticated shell, and role-aware placeholder landing view.
- Local development instructions, deployment preview, and a Phase 1 verification checklist.
- Automated smoke tests for app startup, authentication/role resolution, schema/migrations, seed idempotency, and core authorization boundaries.

### Explicitly out of scope

- Room search, availability calendar, room detail, or booking-request UI.
- Booking creation, approval/rejection actions, conflict enforcement, cancellation, or waitlist behavior.
- Access authorization endpoint or “simulate tap” interaction.
- Check-in/out workflow, condition reports, incident-resolution workflow, or notifications.
- Physical access hardware, firmware, door controllers, QR readers, or live door integration.
- Campus SSO, multi-institution tenancy, payments, mobile applications, AI decisions, analytics, or production identity verification.
- Production-grade security certification or claims that demo credentials/hardware are suitable for live campus access.

## 6. Product decisions to lock in Phase 1

These decisions must be recorded in the repository (for example, in this PRD and the README) before Phase 1 is considered complete.

### Institution and time

- MVP represents one institution. No `institution_id` tenancy framework is needed in the first schema unless deployment architecture makes it unavoidable.
- Database timestamps use UTC (`timestamptz`); the institution's IANA timezone is configured once for display and room-hour interpretation.
- Invalid or missing timezone configuration should be caught during startup/health validation rather than silently interpreted as the server's local timezone.
- Booking intervals are defined as half-open: `[start_at, end_at)`. A booking ending exactly when the next starts is not an overlap unless a later policy adds a buffer.

### Role model

- Each profile has exactly one role: `student`, `manager`, or `admin`.
- A room has one primary manager in the MVP. Future co-management can be added through a join table if required.
- Manager authority is constrained to assigned rooms; the role alone does not imply campus-wide access.
- Role values are loaded from trusted profile data on the server. Do not treat client metadata, URL parameters, form input, or a local-storage role selector as authorization.

### Booking state model

Phase 1 records the proposed state vocabulary and transitions so later code does not invent competing meanings:

| State | Meaning | Intended next steps |
| --- | --- | --- |
| `draft` | Unsubmitted request, if drafts are implemented later | Submit or delete |
| `pending` | Submitted; awaiting manager review | Approve, reject, request changes, or waitlist |
| `approved` | Room/time allocated and eligible for time-bound access checks | Cancel, check in, or flag an issue |
| `rejected` | Declined; decision reason is retained | Edit/resubmit if product policy allows |
| `waitlisted` | Deferred because of scarcity or an explicit policy | Promote or cancel |
| `checked_in` | Authorized use has begun | Check out, report an issue, or request extension |
| `completed` | Use has closed and condition/return outcome is recorded | View history; append manager note |
| `cancelled` | Booking cancelled; future authorization must no longer succeed | View history |
| `no_show` | Approved user did not use the room | Review history; follow published policy |
| `incident` | Booking has a recorded issue requiring review | Submit/review/resolve incident |

Phase 1 may store these as a database enum or a validated text field. The chosen representation must support future migrations and must not imply that every transition is already implemented. Later phases must enforce transitions in trusted server code, not by accepting arbitrary status updates from clients.

### Fairness and eligibility

- Eligibility is a visible hard check, not an opaque ranking score.
- Where no real institutional policy has been provided, demo requirements and priority rules must be labelled as sample policy.
- A human manager may override a policy recommendation only with a recorded reason in a later workflow phase.

## 7. User journeys in Phase 1

### Developer setup journey

1. Clone the repository.
2. Read the README prerequisites and select the documented local or hosted service configuration.
3. Copy the environment example to a local, ignored environment file and enter local credentials.
4. Start the app and required services using documented commands.
5. Apply migrations and run the idempotent seed command.
6. Open the local app and sign in using one of the documented demo accounts.
7. Confirm the shell identifies the signed-in user's role without exposing privileged actions to other roles.

### Judge/demo setup journey

1. Open the hosted preview.
2. Sign in as a seeded student, manager, or administrator using the documented demo instructions.
3. See the signed-in identity and role in the application shell.
4. Navigate to a role-appropriate placeholder landing page that explains which workflows arrive in later phases.
5. Sign out and repeat with another role.

The Phase 1 demo must not suggest that a booking, approval, access decision, or door unlock has already occurred when those workflows are not implemented.

## 8. Functional requirements

### FR-01: Application scaffold

- The application shall use the agreed Next.js App Router, React, and TypeScript baseline unless repository or deployment constraints require a documented alternative.
- The project shall include scripts for development, production build, linting, type checking, tests, database migration, and seed execution as applicable.
- The baseline build shall fail on TypeScript errors and lint failures in CI.
- The repository shall include an ignored local environment file pattern and a committed `.env.example` containing names and safe placeholders only.
- No production secrets, service-role keys, passwords, API tokens, or private keys may be committed.

**Acceptance criteria:** a clean checkout can install dependencies and run the documented validation/build commands; the production build succeeds with configuration supplied through environment variables.

### FR-02: Runtime configuration and health

- The app shall validate required configuration at startup or through a clear health check.
- Public client configuration and server-only secrets shall be separated.
- A missing required value shall produce a clear, non-secret-leaking error for developers and an appropriate generic error in user-facing pages.
- The service shall not print secret values in logs or expose them through a client bundle, error response, or diagnostic endpoint.

**Acceptance criteria:** invalid/missing configuration is discoverable through a documented diagnostic; inspection of the browser bundle and public routes reveals no server-only secret.

### FR-03: Authentication and sessions

- The app shall integrate the selected managed auth provider (default: Supabase Auth).
- Users shall be able to sign in and sign out from the app.
- Protected application-shell routes shall require a valid session.
- A missing/expired session shall redirect to a clear login state without exposing private data.
- Session handling shall use the framework/provider's server-supported pattern; privileged role checks shall not rely solely on client-side rendering guards.
- The initial MVP need not support public registration. Demo accounts are provisioned through a trusted setup/seed process.

**Acceptance criteria:** each seeded account can sign in and out; an unauthenticated request cannot retrieve protected profile or demo data; expired sessions are handled without a crash or private-data flash.

### FR-04: Profile and role resolution

- Every demo auth user shall have a corresponding profile.
- A profile shall include `id`, `display_name`, `role`, `status`, and creation/update timestamps. Email should be read from the auth provider where practical rather than duplicated unnecessarily.
- The application shall load the profile on the server for protected pages and protected operations.
- Suspended/inactive profiles shall not be treated as active demo users.
- Missing or inconsistent profile records shall fail closed: show a recoverable error or deny protected actions rather than assigning a default privileged role.

**Acceptance criteria:** altering a role-looking value in browser storage, query parameters, or a request body does not grant access; role display corresponds to the database profile.

### FR-05: Database migrations and schema

All schema changes shall be version-controlled and repeatable. The initial schema should cover the MVP entities below, even if later-phase UI and workflows are not yet implemented.

#### `profiles`

- Primary key references the managed-auth user ID.
- Fields: `display_name`, `role`, `status`, `created_at`, `updated_at`.
- Role is constrained to `student`, `manager`, or `admin`; status is constrained to the documented active/inactive values.
- Deleting or disabling an auth user must not silently erase historical audit attribution. Use deliberate archival/deletion behavior.

#### `rooms`

- Fields: stable ID, room name/code, building, human-readable location, capacity, facilities, permitted-use description, primary manager, status, and timestamps.
- Capacity must be a positive integer.
- Room code should be unique within the single institution.
- Room status should distinguish at least active from inactive; inactive rooms are not discoverable/bookable in later phases.
- The room manager reference shall point to a profile, and later authorization must verify both the manager role and assignment.

#### `availability_rules`

- Stores recurring room availability in campus-local terms: room, weekday, local opening time, local closing time, and active/effective date range as needed.
- Opening time must be earlier than closing time for a same-day rule; overnight availability is out of initial scope unless explicitly designed.
- Room hours are policy inputs, not a substitute for checking booking conflicts.

#### `eligibility_requirements`

- Stores requirements associated with a room or room policy: type, user-facing description, whether mandatory, and active state.
- Phase 1 may seed sample requirements but shall label them as demo policy.
- The schema shall not assume that a natural-language requirement has been verified merely because a user has read or acknowledged it.

#### `bookings`

- Fields: stable ID, room, requester profile, purpose, optional group name, expected attendance, start/end timestamp, status, decision reason, decision actor, decision timestamp, and creation/update timestamps.
- `end_at` must be later than `start_at`; expected attendance must be positive and shall not exceed room capacity when later validated.
- Use UTC-compatible timestamp types.
- Index room/time/status and requester/time/status access patterns expected in future phases.
- Phase 1 shall not claim to prevent overlapping bookings solely through an ordinary application-level precheck. The concurrency-safe conflict rule must be designed and implemented in the booking phase, using a transaction/constraint/locking strategy appropriate to the database.

#### `credentials`

- Fields: stable ID, user profile, credential reference, credential type, active state, created timestamp, and revocation timestamp.
- Credential references must be unique within their defined namespace and must not contain unnecessary personal information.
- Revocation must be represented without deleting the historical record.
- Demo credential values are fixtures only and must not be presented as production-grade credentials.

#### `access_events`

- Fields: stable ID, optional mapped credential, room, timestamp, result, safe reason code, source/reader reference, and correlation/attempt identifier where available.
- Must be able to record a denied attempt when no credential maps to an active account; an unknown credential attempt should not be dropped just because no credential foreign key exists.
- The event should not store tag secrets or unnecessary personal information.
- Later phases shall append events rather than editing previous decisions.

#### `audit_events`

- Fields: stable ID, optional actor for system events, action, entity type/ID, timestamp, concise summary, and correlation ID.
- Audit records are append-only to application roles. Corrections are represented as new events.
- Do not write passwords, auth tokens, raw secrets, or unnecessary sensitive booking details to the audit summary.

#### `condition_reports` and `incidents`

- Include foundational tables if they fit the initial migration cleanly; otherwise document the planned shape and add them in the check-out/incident phase.
- Condition reports associate a booking, stage, submitter, timestamp, notes, and optional future evidence references.
- Incidents associate a booking, category, description, status, reviewer, and resolution note.
- Any outcome that could become a sanction requires an authorized human reviewer in a later phase.

**Acceptance criteria:** a clean database can be migrated from zero; schema constraints reject invalid roles, capacities, statuses, and time ranges where constraints are appropriate; migrations are committed and applied consistently in local and preview environments.

### FR-06: Database authorization and trust boundaries

- Row-level security (RLS) shall be enabled on tables exposed through the client-accessible database API.
- The default policy shall be deny; every granted read/write policy must be documented by table, role, and operation.
- Students may read only their own profile and, in later phases, their own booking/access summary; they may not edit their role or status.
- Managers may access room-scoped records only for rooms assigned to them; manager role alone does not grant access to every room.
- Admin policies shall be explicit and limited to the trusted admin role.
- Users must not be able to write `role`, `status`, `manager_id`, approval decisions, access results, or audit history through an unrestricted client request.
- Server/service credentials shall only be used in trusted server contexts and never be bundled to the browser.
- If both application-level authorization and RLS are used, they must agree; RLS is not a reason to omit meaningful application authorization checks.

**Acceptance criteria:** automated policy tests or equivalent role-specific checks demonstrate expected allow/deny behavior for student, manager, admin, and anonymous access. A student cannot read another student's private booking or mutate a room assignment; an unassigned manager cannot act on another manager's room.

### FR-07: Idempotent demo seed data

- The seed process shall be safe to rerun and shall use stable fixture identifiers or another deterministic upsert strategy.
- Demo auth users shall be created by a trusted setup script or provider admin mechanism; privileged auth provisioning credentials must never be exposed to browser code.
- Seed data shall include:
  - one student/club-lead account;
  - at least two managers, allowing assigned-versus-unassigned authorization checks;
  - one administrator account;
  - at least three active rooms with different capacities/facilities and manager assignments;
  - at least one inactive room for later discovery-state testing;
  - sample availability rules and at least one clearly labelled demo eligibility requirement;
  - example pending, approved, rejected, and cancelled booking records for later UI work;
  - at least one active and one revoked demo credential;
  - representative access/audit events only where their schema exists.
- Seed dates used for an immediately demonstrable approved booking shall be generated relative to seed time and the configured campus timezone, so sample data does not become stale after a fixed date passes.
- Demo passwords shall be documented as public test credentials if they are exposed to judges. They must never be reused for real accounts or deployment secrets.
- Seed output shall summarize created/updated fixture counts without printing passwords or secrets.

**Acceptance criteria:** two consecutive seed runs leave one copy of each fixture and preserve valid foreign-key relationships; seeded role assignments and room ownership support the authorization test matrix.

### FR-08: Minimal authentication UI and role-aware shell

- Provide a login screen with clear validation, loading, success, and error states.
- Provide sign-out and a visible signed-in identity/role indicator after authentication.
- Provide a minimal authenticated landing view with a short product description and role-appropriate navigation placeholders.
- The student view shall communicate that room discovery/request features are forthcoming rather than offering nonfunctional booking controls.
- The manager view shall communicate that assigned-room request review is forthcoming.
- The admin view shall communicate that administration tools are forthcoming.
- Role-specific UI is for clarity only; server-side authorization remains authoritative.
- Do not implement an unrestricted role-switch dropdown. Switching roles in a demo requires signing in as a different seeded account.
- Include responsive layout, keyboard-accessible form controls, visible focus state, semantic labels, and errors that are not conveyed by color alone.

**Acceptance criteria:** all three seeded users can sign in and see the correct placeholder shell; protected routes redirect unauthenticated users; users cannot reach privileged server data by manually navigating to another role's route.

### FR-09: Deployment preview and operational docs

- Establish a preview deployment that can be reached by project reviewers.
- Document the environment variables, provisioning steps, migrations, seed command, demo account access, and known limitations.
- Document how to promote or refresh preview data without exposing service credentials.
- Deployment shall run a production build and basic automated checks.
- The project shall display a non-sensitive health/build status for maintainers if practical; it shall not expose environment values or database internals.

**Acceptance criteria:** a team member can redeploy from the repository using documented steps; the preview login works with the seeded demo identities; failed configuration is diagnosable without leaking secrets.

## 9. Data access matrix

This matrix describes the foundational intended policy. Later product phases may narrow access further but must not silently broaden it.

| Data/action | Anonymous | Student | Assigned room manager | Admin |
| --- | --- | --- | --- | --- |
| Read active room catalog | No private data; public catalog decision to be finalized before Phase 2 | Yes, once room discovery launches | Yes | Yes |
| Read own profile | No | Yes | Yes | Yes |
| Edit own display name | No | Limited, if enabled later | Limited, if enabled later | Yes/administrative support |
| Change role/status | No | No | No | Trusted administrative action only |
| Read own booking | No | Yes | If assigned room and policy permits | Yes, institution scope |
| Read another user's booking details | No | No | Only operational fields for assigned room | Yes, institution scope |
| Assign room manager / edit room policy | No | No | Assigned-room operational fields only, if explicitly granted | Yes |
| Bind/revoke credential | No | No in Phase 1 | No by default | Yes, audited |
| Create/edit access or audit events | No | No | No direct client writes | Trusted server action only |

Phase 1 shall implement only the policy needed for the foundation and demo. Where a future product action has no UI yet, direct database access must still be restricted rather than left permissive.

## 10. Non-functional requirements

### Security and privacy

- Collect only the demo profile information needed for authentication and attribution.
- Keep service-role/database admin credentials server-side and out of Git.
- Fail closed on missing identity, missing profile, unknown role, inactive user, or database authorization failure.
- Validate all environment configuration and all server input at trust boundaries.
- Do not log passwords, auth tokens, credential secrets, or full sensitive request payloads.
- Apply least-privilege database policies and protect admin routes/actions.
- The prototype must clearly state that it is not approved for controlling real institutional doors.

### Reliability

- Migrations and seeds shall be repeatable.
- Authentication/database service errors shall produce recoverable app states rather than blank pages or unhandled exceptions.
- Demo fixtures shall not depend on email delivery or hardware connectivity.

### Accessibility and usability

- The login and shell shall support keyboard-only use and sensible screen-reader labels.
- Status and validation messages shall include text and not rely on color alone.
- Layout shall remain usable at mobile and desktop viewport widths.

### Maintainability

- Keep domain types for roles, booking statuses, and authorization decisions centralized rather than duplicating string literals.
- Keep database migrations, seed data, and environment configuration discoverable and documented.
- Prefer a small number of well-defined modules over premature service decomposition.
- CI shall run type checking, linting, tests, and production build.

## 11. UX and content requirements

### Login page

- Product name: **RoomRelay**.
- Supporting line: **Book a room. Unlock access. Keep trust.**
- Explain that this is a prototype and demo accounts are available to authorized reviewers.
- Include labelled email and password inputs, submit control, pending state, and inline error summary.
- Do not reveal whether an arbitrary email address exists in the system through distinct auth error messages.
- If demo credentials are shown, label them as public demo-only credentials and never imply they are real campus identities.

### Authenticated shell

- Show RoomRelay identity, signed-in display name, role label, and sign-out control.
- Present only links/actions appropriate to the role.
- Use status text and accessible focus styles.
- Clearly label nonfunctional future workflow areas as “Coming in a later build phase.”

### Error states

- Auth service unavailable: explain that sign-in is temporarily unavailable and provide a retry action.
- Profile unavailable/inactive: deny privileged access and tell the user to contact the project administrator; do not assign a fallback role.
- Unauthorized route/action: show a generic access-denied state without leaking another user's data.
- Missing configuration: show a generic deployment error to visitors and a detailed non-secret diagnostic to developers/logs.

## 12. Analytics and telemetry

No third-party behavioral analytics are required in Phase 1. Operational logs may record server errors and non-sensitive request correlation identifiers. Do not record passwords, session tokens, credential secrets, or unnecessary personally identifying information. Any future analytics must be reviewed for necessity and privacy impact.

## 13. Acceptance test plan

### Setup and build

1. Fresh checkout follows documented installation and startup steps.
2. Environment validation identifies missing required values without printing secrets.
3. Type check, lint, test suite, and production build pass in CI.
4. Clean database migration completes from zero.

### Authentication and identity

1. Each seeded role signs in and signs out successfully.
2. Unauthenticated requests cannot access protected profile/demo data.
3. Invalid credentials produce safe, understandable errors.
4. Inactive or profile-less users do not receive an implicit role or privileged access.
5. A browser-supplied role or altered local state cannot change server-resolved permissions.

### Authorization

1. Student cannot mutate role, status, room manager, booking decision, access event, or audit event.
2. Manager can only see manager-scoped records for assigned rooms where permitted.
3. Manager assigned to Room A cannot operate on Room B assigned to another manager.
4. Admin privileges require the persisted admin role and trusted server/database policy.
5. Anonymous access is denied for private records.

### Seed and deployment

1. Seed run creates all required fixture types.
2. Second seed run creates no duplicates and does not break references.
3. The hosted preview can authenticate the documented demo users.
4. Browser bundles and public endpoints contain no privileged secrets.
5. Demo instructions work without team intervention or manual database updates.

## 14. Dependencies and assumptions

- A Supabase project or compatible local Supabase environment can be provisioned.
- A Vercel (or equivalent) project can be connected for preview deployment.
- The team can provide or accept the demo institution's timezone and sample room data.
- The Phase 1 role model uses a single persisted role per person.
- Demo passwords may be shared with reviewers, but the accounts and credentials are disposable and non-production.
- Actual institutional eligibility, room policies, and priority rules are unknown; seed values are explicitly illustrative.
- Existing NFC firmware is not in this repository and is not needed for Phase 1.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Role exists only in client state | Privilege escalation in later phases | Persist roles; resolve on server; test tampering; enable restrictive RLS |
| Overly permissive initial RLS | Private data exposure when new UI ships | Default deny; table-by-table policy matrix; add negative authorization tests |
| Seed users require manual setup | Unrepeatable demo and onboarding failures | Provide trusted idempotent provisioning/seed script and documented commands |
| Seeded booking times become stale | Demo cannot exercise future access behavior | Generate relative dates using configured campus timezone |
| Schema is too broad for a hackathon | Lost time and brittle initial migrations | Create only MVP lifecycle entities; defer optional tables when not needed yet |
| Schema is too narrow and must be rewritten | Delays later workflow phases | Agree role/state/time/ownership model now; version migrations; document transition rules |
| Secrets leak into frontend or Git | Unauthorized project/database access | `.env.example`, ignored secrets, server/client config separation, bundle inspection |
| Demo accounts appear production-ready | Misuse or false security claims | Label demo-only accounts and prototype limitations in UI/docs |
| Hosted service is unavailable during demo | Sign-in or seed setup fails | Keep local instructions and a recorded backup demo; surface service errors clearly |

## 16. Deliverables

At Phase 1 completion, the repository should contain:

- Runnable Next.js/TypeScript application with login, logout, and role-aware placeholder shell.
- Versioned database migrations and documented RLS policies.
- Idempotent demo-user/data provisioning process.
- Automated checks for build, role resolution, and authorization boundaries.
- `.env.example` with no real secrets.
- README sections for prerequisites, local setup, migrations, seeding, demo accounts, deployment, and known limitations.
- A preview deployment reachable by reviewers.
- This PRD updated if implementation decisions materially differ from it.

## 17. Definition of done

Phase 1 is done only when all of the following are true:

- The product boundaries, roles, status vocabulary, timezone, and demo scenario are recorded and agreed.
- A fresh checkout can be installed and started by following the README.
- Database migrations succeed from an empty database and are tracked in Git.
- RLS and server-side role resolution are enabled and verified with positive and negative tests.
- Seeded student, manager, and admin accounts work in local and preview environments.
- Seed data is deterministic/idempotent and contains enough variation for later workflow development.
- The app displays the authenticated user and correct role without pretending the booking/access workflow is implemented.
- CI passes lint, type check, tests, and production build.
- No secrets are committed, logged, or exposed to the browser.
- The team can demonstrate Phase 1 from a fresh state without manually editing the database.

## 18. Handoff to Phase 2

Phase 2 may begin once this PRD's definition of done is satisfied. Phase 2 should consume the agreed room, availability, eligibility, and booking schemas; add room discovery and booking request experiences; and implement server-side eligibility and overlap validation. It should not change role meanings, time semantics, or booking status names without updating migrations, tests, and this document.
