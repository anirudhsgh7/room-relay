# RoomRelay

**Book a room. Unlock access. Keep trust.**

RoomRelay is a university room-booking and access-management prototype. It connects the whole campus room lifecycle in one application: discovering a free room, submitting a request, reviewing it fairly, issuing time-bound (simulated) access, checking out, reporting a problem, and keeping an accountable history of every step.

The project is built for students and club leads, room managers, and administrators. It is also a complete reference implementation for developers who want to see how a policy-heavy workflow can be modelled with Next.js, Postgres, server-side authorization, and database-enforced invariants.

**Public demo (verified):** [https://room-relay.vercel.app](https://room-relay.vercel.app) — the health endpoint returned HTTP 200 with `database: "ok"` when this README was written.

> **Prototype notice:** RoomRelay is not approved for controlling real restricted doors. All accounts and credentials in this repository are public demo fixtures. A pending request is not permission to enter. Access checks are software simulations: no NFC reader, relay, lock, or physical door is connected, and an `ALLOW` result never represents a real unlock. Incidents are human-reviewed observations, not automatic findings of fault or penalties.

## At a glance

| Area | Details |
| --- | --- |
| Current phase | Phase 6: operations and usability |
| Application | Next.js 16 App Router, React 19, TypeScript |
| Database | Postgres, with Neon as the documented hosted target |
| Deployment target | Vercel + Neon; Docker is also supported |
| Authentication | Server-verified credentials, signed HTTP-only session cookie |
| Test suite | 205 Vitest tests across 23 files |
| Public demo | [room-relay.vercel.app](https://room-relay.vercel.app) |
| Production readiness | Prototype. Not audited or approved for real access control. |

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Demo](#demo)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [Usage](#usage)
- [HTTP API](#http-api)
- [Deployment](#deployment)
- [Testing and Troubleshooting](#testing-and-troubleshooting)
- [Security and Limitations](#security-and-limitations)
- [Project Documents](#project-documents)
- [Contributing](#contributing)
- [License](#license)

## Overview

### The problem

Campus rooms are usually managed through a patchwork of spreadsheets, email threads, shared calendars, and manual door access. That makes it hard to answer basic questions:

- Which rooms are actually free for this group, at this time, with the facilities we need?
- Who is allowed to approve the request, and why was one request chosen over another?
- Was the room entered during the approved booking window?
- What condition was the room left in, and what happened to the issue that was reported?
- Did the process treat people consistently, and is there evidence of what happened?

### The solution

RoomRelay models the complete room lifecycle as one connected workflow:

1. **Discover** active rooms by date, time, capacity, building, and facilities.
2. **Request** a room. The request is deliberately *pending*, not a booking and not permission to enter.
3. **Review** by the assigned room manager, using explicit eligibility requirements, conflict checks, and a published allocation rule.
4. **Settle** competing requests through a waitlist when one request is approved.
5. **Check in** with a simulated, time-bound credential check. The first valid check moves the booking to `checked_in`.
6. **Check out** with an after-use condition report. A clean checkout completes the booking; an issue opens an incident.
7. **Resolve** incidents through manager review and administrator resolution.
8. **Audit** every important action through append-only access events, condition reports, and audit records.

### Who it is for

- **Students and club leads** who need a room and want a clear, fair answer.
- **Room managers** who need a scoped queue, the context to make a good decision, and tools to manage their rooms.
- **Administrators** who need institution-wide oversight, room setup, and final incident resolution.
- **Developers and reviewers** who want a realistic, policy-driven reference implementation rather than a CRUD demo.

### What makes it interesting

- **Published rules, not hidden judgement.** Each room uses one of three allocation rules, and the same plain-language rule is shown to requesters, managers, and administrators.
- **Waitlists that explain themselves.** Approving one request moves competing requests to a waitlist (or declines them when no waitlist exists), with notifications and a position.
- **Access is a policy decision, not a UI flag.** Credential ownership, active state, room state, booking state, and the exact time window are rechecked on every attempt.
- **History is evidence.** Access events, audit events, and condition reports are append-only. Resolved incidents are immutable.
- **A grounded assistant.** “Ask RoomRelay” answers from live data and published policy. It never changes anything and does not call an external AI model.

## Features

### Discovery and requests

- Active room catalog with URL-backed filters for date and time, minimum capacity, building, and facilities.
- Room detail pages with opening hours, facilities, policy summary, eligibility requirements, planned closures, and the room's published allocation rule.
- Server-validated request forms with:
  - room hours and slot-boundary checks;
  - capacity, minimum notice, maximum advance, and maximum-duration checks;
  - confirmed-booking conflict checks using the room's changeover buffer;
  - duplicate pending-request protection and per-person upcoming-request limits;
  - requester-scoped idempotency keys so retries do not create duplicates;
  - safe alternative times when a slot is unavailable.
- Requests are created as `pending` or `waitlisted`. The UI states clearly that a pending request is not permission to enter.
- Requester-only “My bookings” list and request receipt, including decision reason, cancellation reason, eligibility warnings, and lifecycle history.

### Decisions, fairness, and waitlists

- Manager queue scoped to the manager's assigned rooms; administrators see the whole institution.
- Queue filters for status, room, date, eligibility review, and conflict state.
- Request detail with requester context, room policy, current eligibility, overlapping requests, allocation standing, and audit history.
- Reasoned approval or rejection. Decision reasons are requester-visible and stored atomically with an audit event.
- Per-booking eligibility override with a recorded reason. The override does not change the requester's profile eligibility.
- Three published allocation rules:
  - **First come, first served** — earliest request wins.
  - **Best use of space** — the largest expected group wins.
  - **Fair share** — the requester with the fewest confirmed minutes in that room over the last 30 days, including time already booked ahead, wins.
- Under every rule, requests that already meet the room requirements rank first; ties break on submission time and then a stable reference.
- Approving out of order requires a recorded allocation exception.
- After an approval, conflicting pending requests move to the waitlist (with positions and notifications) or are declined with a reason when the room keeps no waitlist.
- Cancelling or checking out early releases the time and promotes eligible waitlisted requests back to manager review. Promotion is never automatic approval.

### Access and the booking lifecycle

- Simulated access-check page for the requester's own credentials and an active room.
- Every attempt is evaluated against:
  - the persisted account status;
  - credential ownership, active state, and revocation;
  - room active state;
  - the requester's own approved or checked-in booking;
  - the exact half-open booking window `[start_at, end_at)`.
- Safe denial reason codes such as `CREDENTIAL_REVOKED`, `BOOKING_NOT_APPROVED`, `OUTSIDE_BOOKING_WINDOW`, `ROOM_INACTIVE`, and `RATE_LIMITED`.
- Requester-scoped nonces plus a request hash for replay protection.
- Access events and audit records are appended in the same transaction. The first valid check changes `approved` to `checked_in`.
- Role-scoped access history: students see their own attempts, managers see their assigned rooms, administrators see the institution-wide log.
- Requester check-out with a required condition report:
  - **Left as found** completes the booking.
  - **Issue found** opens an incident and moves the booking to `incident`.
- Incident workflow: manager review and administrator final resolution. A booking completes only when every linked incident is resolved.
- Connected lifecycle timeline merging request, decision, access, condition, incident review, resolution, and completion events.

### Room operations

- Administrators can add rooms, edit room details, assign managers, open or close a room, set weekly hours, add closures, and configure booking rules.
- A room's assigned manager can edit its hours, closures, and booking rules, but not its core details or manager assignment.
- Impact previews before destructive changes:
  - closing a room or adding a closure shows affected bookings first;
  - bookings in use are never interrupted;
  - reducing capacity warns about upcoming bookings above the new capacity;
  - raising the changeover buffer is refused when it would make existing approved bookings collide.
- Closures are removed, not deleted, and every closure action is audited.
- Notifications for request submission, decisions, cancellations, waitlist moves, incident updates, room assignments, reminders, and overdue check-outs.
- Reminders are generated on workspace page loads (at most once a minute per server process) or by `npm run reminders`.
- Role-aware home pages and navigation with scoped badge counts.

### Assistant

“Ask RoomRelay” is a deterministic, read-only assistant. It can:

- find free rooms from plain-language requests such as “a room for 10 tomorrow 2–4pm with a projector”;
- check one named room at a specific time;
- explain eligibility, closures, cancellation, check-in, check-out, waitlists, and allocation rules;
- summarise the signed-in person's bookings and waitlist positions;
- summarise what needs attention for a manager or administrator.

It never writes data, never makes an approval or access decision, and links to the real forms instead.

### Implemented vs. planned

| Capability | Status |
| --- | --- |
| Room discovery, filters, detail, and published rules | Implemented |
| Pending requests, validation, idempotency, and safe alternatives | Implemented |
| Manager/admin queue and reasoned decisions | Implemented |
| Eligibility overrides and allocation exceptions | Implemented |
| Waitlists, promotion after cancellation, and notifications | Implemented |
| Simulated access checks and role-scoped access history | Implemented |
| Requester check-out, condition reports, and incident workflow | Implemented |
| Lifecycle timeline and audit history | Implemented |
| Room administration, hours, closures, and booking rules | Implemented |
| In-app notifications and reminder sweep | Implemented |
| Deterministic read-only assistant | Implemented |
| Postgres/Neon, Vercel configuration, Docker, CI, and tests | Implemented |
| Email, SMS, push delivery, or calendar export | Not implemented |
| Photo upload or object storage | Not implemented |
| Analytics, payments, or trust scores | Not implemented |
| Automatic no-show classification, penalties, or sanctions | Not implemented |
| Manager/admin check-out on behalf of a requester | Not implemented |
| Appeals or AI-generated incident findings | Not implemented |
| Physical NFC/QR reader, relay, lock, or door actuation | Not implemented |
| Offline access or production anti-cloning hardware protocols | Not implemented |
| Admin credential-binding/revocation UI or full user administration | Not implemented |
| “Request changes” workflow or automatic approval from a waitlist | Not implemented |
| External AI model | Not implemented — the assistant is deterministic |

## Tech Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Application framework | **Next.js 16.4.3** (App Router) | Server Components, Server Actions, route handlers, rendering, and routing |
| UI | **React 19.3.1**, **Tailwind CSS 4.3.3** | Responsive workspace UI and custom campus-operations visual system |
| Language | **TypeScript 5.9.3** | Strict end-to-end typing |
| Validation | **Zod 4.6.7** | Server-side form and service input validation |
| Database | **Postgres**, **Neon** (documented target) | Durable relational storage and transactional invariants |
| Database client | **pg 8.23.1** | Server-only connection pool and parameterized SQL |
| Authentication | **jose 6.2.13**, Node `crypto.scrypt` | HS256 session tokens in an HTTP-only cookie; salted scrypt password hashes |
| Time handling | **@js-temporal/polyfill 0.5.1** | Campus-local time, timezone, and DST-safe conversion |
| Testing | **Vitest 5.0.5** | Database, service, authorization, time, and UI-helper tests |
| Linting | **ESLint 9** with `eslint-config-next` | Static analysis |
| Scripts | **tsx 4.23.15**, **dotenv 18** | Migration, seed, reset, reminder, and end-to-end scripts |
| Neon configuration | **@neon/config 1.9.5** | Project service declaration in `neon.ts` |
| CI | **GitHub Actions** with a Postgres 17 service | Lint, type-check, tests, production build, and HTTP smoke test |
| Deployment | **Vercel + Neon**, optional **Docker** | Hosted demo and portable container deployment |

There is no ORM, Redis, object-storage SDK, email provider, or external AI provider in the running application. SQL is written explicitly and executed through the server-only adapter in `lib/db/client.ts`.

> **Legacy note:** `db/migrations/` contains the historical SQLite migration set and `data/` may contain local SQLite files. Neither is used by the current application. Only `db/postgres/*.sql` is applied.

## Demo

### Live application

The repository documents a public demo at **[https://room-relay.vercel.app](https://room-relay.vercel.app)**. Its health endpoint was verified while writing this README:

```json
{
  "status": "ok",
  "service": "roomrelay",
  "phase": 6,
  "database": "ok",
  "migrations": 1,
  "checkedAt": "2026-10-29T21:17:06.451Z"
}
```

The demo uses public fixture accounts and seeded data. Do not enter real personal, access, or credential information.

### Screenshots and video

No screenshots, GIFs, or demo videos are committed to this repository, and there is no `public/` asset directory. To add them, place the files under `docs/` (or a new `public/` directory) and link them from this section.

| Asset | Status |
| --- | --- |
| Live demo | Verified at the URL above |
| Screenshots | Not committed |
| GIF / video walkthrough | Not committed |

### Demo accounts

All passwords are intentionally public and disposable.

| Role | Name | Email | Password | Scope |
| --- | --- | --- | --- | --- |
| Student / club lead | Amelia Chen | `student@roomrelay.demo` | `demo-student-2026` | Discovery, own requests, cancellation, check-in/out |
| Room manager | Marcus Webb | `manager@roomrelay.demo` | `demo-manager-2026` | Seminar Room 02 and Classroom 14 |
| Room manager | Priya Nair | `manager2@roomrelay.demo` | `demo-manager-2026` | Media Studio 01 and Quiet Study 03 |
| Administrator | Rowan Ellis | `admin@roomrelay.demo` | `demo-admin-2026` | Institution-wide review and oversight |
| Suspended user | Jamie Cole | `inactive@roomrelay.demo` | `demo-inactive-2026` | Intentionally cannot sign in |

A second active student fixture, Noah Williams (`student2@roomrelay.demo`), exists to create the overlapping pending request in Priya's manager queue. It is not shown in the judge-facing login directory.

### Five-minute tour

1. **Student:** sign in as Amelia, open **Find a room**, filter by date/time and capacity, then open **Seminar Room 02**. Submit a request and confirm it says **Pending review** — not permission to enter.
2. **Manager:** sign in as Priya. Her queue contains only Media Studio 01 and Quiet Study 03 requests. Open Noah's request and note the allocation position, eligibility warning, and overlap context.
3. **Fairness:** approve Amelia's competing Media Studio request. Noah moves to the waitlist with a notification and a position. Cancel Amelia's approved booking and watch Noah return to review automatically.
4. **Access:** sign in as Amelia and open **Check in**. The seeded Classroom 14 window is relative to the last database reset. A valid tap is allowed and checks the booking in; a revoked card and a pending request are denied with distinct reasons.
5. **Close-out:** check out with a clean condition report, then open the seeded equipment incident, review it as Priya, and resolve it as Rowan. The booking completes only when all linked incidents are resolved.
6. **Operations:** as Rowan, open **Rooms and rules**, add a room or closure, and review the impact preview. As Priya, open **My rooms** to see manager-scoped controls.
7. **Assistant:** ask “a room for 10 tomorrow 2–4pm with a projector”, “is SEM-02 free friday at 3”, or “what needs my attention?”.

## Architecture

RoomRelay is a server-rendered Next.js application with a small number of route handlers and a server-only Postgres data layer. Most mutations use Server Actions rather than a public REST API.

```mermaid
flowchart TB
  subgraph Browser
    Pages[Server-rendered pages]
    Forms[Client forms and Assistant panel]
  end

  subgraph Next["Next.js server runtime"]
    App[App Router pages and Server Actions]
    Health[GET /api/health]
    AccessAPI[POST /api/access/check]
    Auth[lib/auth]
    Domain["lib/bookings, lib/rooms, lib/incidents, lib/admin, lib/notifications, lib/assistant"]
    AccessSvc[lib/access/service]
  end

  DB[(Neon Postgres)]

  Pages --> App
  Forms -->|Server Actions| App
  Forms -->|JSON + session cookie| AccessAPI
  App --> Auth
  App --> Domain
  AccessAPI --> Auth
  AccessAPI --> AccessSvc
  Health --> DB
  Auth --> DB
  Domain --> DB
  AccessSvc --> DB
```

### Lifecycle flow

```mermaid
sequenceDiagram
  actor Student
  actor Manager
  actor Admin
  participant App as Next.js server
  participant DB as Postgres

  Student->>App: Submit room request
  App->>DB: Revalidate profile, policy, hours, conflicts
  App->>DB: Insert pending/waitlisted request + audit + notification
  Manager->>App: Approve or reject with a reason
  App->>DB: Recheck eligibility, allocation, blackout, conflicts
  App->>DB: Update status + audit + notify
  App->>DB: Move conflicting pending requests to waitlist
  Student->>App: Simulated access check
  App->>DB: Check credential, room, booking, exact window
  App->>DB: Append access event + audit; first valid check sets checked_in
  Student->>App: Check out with condition report
  App->>DB: Append report; complete or open incident
  Manager->>App: Review incident
  Admin->>App: Record final resolution
  App->>DB: Complete booking when no unresolved incidents remain
```

### Trust boundaries

- **Postgres is server-only.** There is no browser-facing database client or public query API. All reads go through narrow server-side query functions.
- **The client is untrusted.** Role, status, requester, booking status, timestamps, decision fields, and access results are resolved or set on the server.
- **Every protected page and handler re-resolves the actor.** Protected pages use `requireCurrentProfile()`; the access route handler and Server Actions re-check authentication themselves.
- **Manager scope is per assigned room.** Admin scope is explicitly institution-wide. Room ownership is re-read from the database, not taken from a form.
- **Core booking, access, and incident mutations run in transactions.** The state change, audit event, and related notification are committed together.
- **Postgres triggers are defense in depth.** They enforce allowed booking transitions, decision/cancellation metadata, confirmed-booking overlap, blackout approvals, incident transitions, immutability, and append-only history.

### Data model

The current schema lives in `db/postgres/001_initial.sql`.

| Table | Purpose |
| --- | --- |
| `profiles` | Display identity, role, account status, and password hash |
| `rooms` | Room code, name, building, location, capacity, facilities, manager, and status |
| `availability_rules` | Weekday opening windows and effective dates |
| `eligibility_requirements` | Visible room requirements such as inductions or briefings |
| `profile_eligibility` | Server-owned verification state for each profile/requirement |
| `room_booking_policies` | Request enablement, slot interval, notice, duration, buffer, quota, allocation rule, and waitlist setting |
| `room_blackouts` | Planned closures with reason and soft-removal metadata |
| `bookings` | Requester, room, purpose, attendance, time window, status, decision, cancellation, eligibility, waitlist, and lifecycle fields |
| `credentials` | Server-side credential reference and active/revoked state |
| `access_events` | Append-only access attempts with actor, room, time, result, reason, source, and correlation ID |
| `audit_events` | Append-only actor/action/entity history with correlation IDs and metadata |
| `condition_reports` | Append-only before/after room condition notes |
| `incidents` | Issue status, manager review, final administrator resolution, and immutability |
| `notifications` | In-app inbox with recipient, kind, link, booking reference, dedupe key, and read state |
| `schema_migrations` | Applied Postgres migration names |

Key invariants include:

- one booking per requester submission key;
- half-open booking intervals and `end_at > start_at`;
- confirmed `approved`/`checked_in` bookings cannot overlap in the same room, including the buffer;
- a booking cannot be approved inside an active closure;
- decision and cancellation metadata are validated at the database;
- only the access service moves a booking from `approved` to `checked_in`;
- a clean checkout requires an after-use condition report;
- an issue checkout requires an open incident;
- an incident booking completes only when every linked incident is resolved;
- access events, audit events, and condition reports cannot be updated or deleted;
- resolved incidents and removed closures are immutable.

### Configuration files

| File | Purpose |
| --- | --- |
| `next.config.ts` | Security headers and Next.js configuration |
| `tsconfig.json` | Strict TypeScript, `@/*` path alias, excludes `tests` |
| `vitest.config.mts` | Node test environment, `@` alias, setup file, serial file execution |
| `eslint.config.mjs` | ESLint 9 with Next.js core-web-vitals and TypeScript rules |
| `.env.example` | Template for required runtime configuration |
| `neon.ts` | Neon project/branch service declaration |
| `Dockerfile`, `docker-compose.yml` | Optional production container deployment |
| `.github/workflows/ci.yml` | PostgreSQL-backed validation pipeline |

## Project Structure

```text
room-relay/
├── app/
│   ├── api/
│   │   ├── access/check/route.ts      # POST simulated access check
│   │   └── health/route.ts            # GET health/readiness
│   ├── app/                           # Protected workspace
│   │   ├── access/                    # Simulator and access history
│   │   ├── admin/rooms/               # Room administration
│   │   ├── bookings/                  # Requester receipts and check-out
│   │   ├── incidents/                 # Manager/admin incident queue
│   │   ├── manager/                   # Review queue and request detail
│   │   ├── notifications/             # In-app inbox
│   │   ├── rooms/                     # Discovery, detail, request form
│   │   ├── assistant/                 # Assistant Server Action
│   │   ├── actions.ts                 # Sign-out action
│   │   ├── layout.tsx                 # Authenticated shell
│   │   └── page.tsx                   # Role-aware home
│   ├── login/                         # Sign-in page and actions
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                       # Public landing page
├── components/
│   ├── access/                        # Access simulator form
│   ├── admin/                         # Room, hours, policy, closure forms
│   ├── assistant/                     # “Ask RoomRelay” panel
│   ├── bookings/                      # Cancel and check-out forms
│   ├── incidents/                     # Review and resolution forms
│   ├── manager/                       # Decision and staff-cancel panels
│   ├── rooms/                         # Search date/time controls
│   ├── timeline/                      # Lifecycle timeline
│   └── badges.tsx, brand.tsx, workspace-nav.tsx
├── lib/
│   ├── access/                        # Access policy, queries, types
│   ├── admin/                         # Room administration services
│   ├── allocation/ranking.ts          # Single allocation implementation
│   ├── assistant/                     # Query parser and grounded answers
│   ├── auth/                          # Password, token, session, redirects
│   ├── bookings/                      # Requests, decisions, cancellation,
│   │                                  # check-out, waitlist, timeline, queries
│   ├── db/                            # Pool adapter, migrations, seed
│   ├── incidents/                     # Review/resolution services and queries
│   ├── notifications/                 # Inbox and reminder sweep
│   ├── rooms/                         # Availability, policy, queries, search
│   ├── time/                          # Temporal-based campus time
│   ├── workspace/                     # Home projections and navigation
│   ├── audit.ts
│   ├── authorization.ts
│   ├── config.ts
│   ├── demo-accounts.ts
│   ├── domain.ts
│   └── rate-limit.ts
├── db/
│   ├── postgres/001_initial.sql       # Current schema and triggers
│   └── migrations/                    # Legacy SQLite history (not applied)
├── scripts/
│   ├── migrate.ts, seed.ts, setup.ts, reset.ts
│   ├── reminders.ts, load-env.ts
│   ├── e2e-neon.ts                    # Opt-in mutating Neon check
│   └── smoke-test.mjs                 # Production HTTP smoke test
├── tests/                             # Vitest suite and fixtures
├── docs/                              # Plan, phase PRDs, context PDF
├── .env.example
├── .github/workflows/ci.yml
├── Dockerfile
├── docker-compose.yml
├── eslint.config.mjs
├── neon.ts
├── next.config.ts
├── package.json
├── tsconfig.json
└── vitest.config.mts
```

### Important modules

| Module | Responsibility |
| --- | --- |
| `lib/db/client.ts` | Server-only `pg` pool, placeholder binding, transactions, JSON/timestamp parsers |
| `lib/auth/*` | scrypt password verification, HS256 session tokens, cookie session resolution, safe redirects |
| `lib/authorization.ts` | Central role and room-scope policy helpers |
| `lib/bookings/service.ts` | Atomic pending/waitlisted request creation |
| `lib/bookings/decisions.ts` | Scoped approve/reject with eligibility and allocation checks |
| `lib/bookings/waitlist.ts` | Settle-after-approval and promotion after freed time |
| `lib/allocation/ranking.ts` | The single ranking/standing implementation |
| `lib/rooms/availability.ts` | Shared conflict rule and blocking-booking queries |
| `lib/rooms/policy.ts` | Published allocation copy and structured policy defaults |
| `lib/access/service.ts` | Fail-closed simulated access policy and event recording |
| `lib/bookings/checkout.ts` | Condition report, clean completion, and issue-to-incident flow |
| `lib/incidents/service.ts` | Manager review and administrator resolution |
| `lib/admin/rooms.ts` | Room creation, details, hours, closures, policies, and impact previews |
| `lib/notifications/reminders.ts` | Idempotent reminder sweep and page-load throttle |
| `lib/assistant/parse.ts`, `respond.ts` | Deterministic query parsing and grounded answers |
| `lib/time/campus-time.ts` | Temporal-based local/UTC conversion with DST rejection |

## Getting Started

### Prerequisites

- **Node.js 22.12 or newer.** CI uses Node 24 and the Docker image is based on Node 24.
- **npm** with support for `package-lock.json` lockfile version 3.
- A **Postgres database**. Neon is the documented hosted target; any standard Postgres instance works. The schema uses no Postgres extensions.
- A **separate disposable Postgres database** for tests, or permission to truncate the configured test database.
- Optional: a **Neon account** for the intended deployment path.
- Optional: **Docker** for the container workflow.

### 1. Clone the repository

```bash
git clone https://github.com/anirudhsgh7/room-relay.git
cd room-relay
```

### 2. Install dependencies

```bash
npm install
```

For a reproducible CI-style install, use `npm ci` instead. The project does not use Yarn or pnpm.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and provide:

```dotenv
ROOMRELAY_SESSION_SECRET=replace-with-at-least-32-random-characters
DATABASE_URL=postgresql://user:password@host-pooler.region.aws.neon.tech/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:password@host.region.aws.neon.tech/neondb?sslmode=require
ROOMRELAY_CAMPUS_TIMEZONE=Europe/London
```

Generate a session secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Use the **pooled** connection string for `DATABASE_URL` (application runtime) and the **direct** connection string for `DATABASE_URL_UNPOOLED` (migrations, seeds, and dumps). If you are using a local Postgres without a pooler, both values can point at the same database.

> `npm run db:setup` can create `.env.local` with a random session secret if the file does not exist, but it cannot invent a database URL. You must provide `DATABASE_URL` or `DATABASE_URL_UNPOOLED`.

### 4. Provision the database

**Neon (documented target):**

1. Create or link a Neon project.
2. Copy the pooled connection string into `DATABASE_URL`.
3. Copy the direct connection string into `DATABASE_URL_UNPOOLED`.
4. If you use the Neon CLI, `neon env pull` writes the connection strings into `.env.local`. The repository includes `neon.ts` for project/branch configuration; a local `.neon` link file may exist if you have used the CLI, and it is gitignored.

**Any other Postgres:**

Set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to a reachable Postgres connection string. Use `sslmode=require` when your provider requires TLS. The application creates its schema in the `public` schema.

### 5. Initialize the schema and demo data

```bash
npm run db:setup
```

This command:

1. creates `.env.local` with a local session secret if it does not exist;
2. applies every unapplied SQL file in `db/postgres/` in lexicographic order;
3. seeds the demo profiles, rooms, policies, credentials, bookings, access events, incidents, and audit history.

The seed is idempotent for the demo dataset, but it is intentionally conservative:

- profiles and credentials are upserted;
- rooms, opening hours, and booking policies are created only for newly seeded rooms, so administrator edits are preserved;
- eligibility requirements are inserted only when missing (`ON CONFLICT DO NOTHING`);
- most seeded bookings and history rows are insert-only.

Use `npm run db:reset` to refresh relative demo dates and the active access window. It drops the public schema, so it requires an explicit guard and must only be used against a disposable database:

```bash
ROOMRELAY_ALLOW_DB_RESET=1 npm run db:reset
```

### 6. Run the application locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The `predev` hook runs `npm run db:setup` first.

For a production-style local run:

```bash
npm run build
npm start
```

`npm start` runs `db:setup` again through the `prestart` hook, then starts Next.js in production mode.

### 7. Verify the setup

```bash
curl -s http://localhost:3000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "roomrelay",
  "phase": 6,
  "database": "ok",
  "migrations": 1,
  "checkedAt": "..."
}
```

Then sign in with one of the [demo accounts](#demo-accounts).

## Environment Configuration

### Runtime variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ROOMRELAY_SESSION_SECRET` | **Yes** | — | At least 32 characters. Signs HS256 session tokens. Keep it stable and secret. |
| `DATABASE_URL` | **Yes** | — | Pooled Postgres connection used by the application runtime. `getDatabaseUrl()` prefers this value. |
| `DATABASE_URL_UNPOOLED` | **Yes for Neon setup** | — | Direct Postgres connection intended for migrations, seeds, and backups. Used as a fallback when `DATABASE_URL` is absent. |
| `ROOMRELAY_CAMPUS_TIMEZONE` | No | `Europe/London` | IANA timezone used for campus-local parsing and display. Invalid values fail at startup or health check. |
| `PG_POOL_MAX` | No | `1` on Vercel, otherwise `5` | Maximum `pg` pool size. |

### Test and operational variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TEST_DATABASE_URL` | No | `postgresql://roomrelay:roomrelay_test@127.0.0.1:55432/roomrelay_test` | Postgres database used by Vitest. Must be disposable because the suite truncates tables. |
| `ROOMRELAY_ALLOW_DB_RESET` | **Yes for `db:reset`** | unset | Safety guard. `db:reset` refuses to drop the public schema unless this is `1`. |
| `ROOMRELAY_E2E_ALLOW_MUTATION` | **Yes for `scripts/e2e-neon.ts`** | unset | Safety guard for the opt-in mutating Neon end-to-end script. Use only on a disposable branch. |
| `VERCEL` | Platform-set | unset | Read by the pool factory to choose a single connection on Vercel. Do not set manually unless you know why. |

### Configuration notes

- `.env.local` is gitignored. Never commit it.
- Some deployment providers preserve surrounding quotes in pasted values. `lib/config.ts` uses `getEnvValue()` to strip paired quotes from `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `ROOMRELAY_SESSION_SECRET`, and `ROOMRELAY_CAMPUS_TIMEZONE`.
- The shared `getDatabaseUrl()` helper resolves `DATABASE_URL` first and falls back to `DATABASE_URL_UNPOOLED`. The repository's deployment guidance designates the direct URL for migrations, so when running a controlled migration against the direct endpoint, set `DATABASE_URL` to the direct connection string for that command (or omit `DATABASE_URL` and let the helper fall back to `DATABASE_URL_UNPOOLED`):

  ```bash
  DATABASE_URL="postgresql://user:password@direct-host/db?sslmode=require" npm run db:migrate
  ```

- `ROOMRELAY_SESSION_SECRET` must be at least 32 characters. Changing it invalidates existing sessions.
- `ROOMRELAY_CAMPUS_TIMEZONE` must be a valid IANA timezone. DST gaps and folds are rejected for booking intervals rather than silently shifted.

## Usage

### Sign in

Open `/login` and use a demo account from the [Demo](#demo) section. The login page lists the active demo accounts and also offers one-click sign-in buttons. Suspended accounts are not listed and cannot sign in even with correct credentials.

### Student / club lead workflow

1. Open **Find a room** (`/app/rooms`).
2. Filter by date and time, minimum capacity, building, or facilities. Availability is labelled as free, booked, closed, outside hours, invalid for the room's rules, or not requestable.
3. Open a room to review its hours, facilities, requirements, published allocation rule, and planned closures.
4. Submit a request with a purpose, group name, expected attendance, and the acknowledgement that a pending request is not permission to enter.
5. Follow the request in **My bookings** (`/app/bookings`). A pending request can be cancelled; a waitlisted request shows its position.
6. When a request is approved and its window starts, open **Check in** (`/app/access`), choose your own credential and the room, and run the simulated tap.
7. After the session, open the booking and **Check out**. Record the room condition as **Left as found** or **Issue found**. An issue opens an incident for human review.

### Manager workflow

1. Open **Requests to review** (`/app/manager/queue`). The queue is scoped to rooms assigned to you; administrators see every room.
2. Filter by status, room, date, eligibility review, or conflict state.
3. Open a request to see the requester's context, current eligibility, overlapping requests, allocation standing, room policy, and history.
4. Approve or decline with a reason of at least 10 characters. The requester sees the reason.
5. If a required eligibility check is outstanding, use the explicit override and record why. The override applies to that booking only.
6. If another request ranks ahead under the room's published rule, approve that request instead or record an allocation exception.
7. Approving one request automatically settles conflicting pending requests into the waitlist or declines them, with notifications.
8. Use **My rooms** (`/app/admin/rooms`) to manage hours, closures, and booking rules for assigned rooms.
9. Use the staff cancellation control only when a booking genuinely cannot proceed. The requester is told why, and the freed time is offered to the waitlist.

### Administrator workflow

1. Open **Requests to review** to see the institution-wide queue.
2. Open **Rooms and rules** (`/app/admin/rooms`) to add rooms, assign managers, edit details, open or close rooms, set weekly hours, add closures, and configure booking rules.
3. Review impact previews before destructive changes. Closing a room or adding a closure cancels affected upcoming bookings and notifies each requester; a booking already in use is not interrupted.
4. Open **Reported issues** (`/app/incidents`) to see manager-reviewed and open incidents across campus.
5. Record the final resolution for an incident. When no unresolved incidents remain, the linked booking completes.
6. Use **Access log** (`/app/access/history`) for the institution-wide, append-only access history.

### Assistant workflow

The assistant is available from the bottom-right panel in the authenticated workspace. Example prompts:

- “Find a room for 10 people tomorrow 2–4pm with a projector”
- “Is SEM-02 free on Friday at 3?”
- “How are competing requests ranked?”
- “Show my requests”
- “What needs my attention?” (manager or administrator)
- “Rules for MED-01”
- “What is the waitlist policy?”

The assistant is read-only. It links to the real request, booking, review, or room pages and never approves, cancels, or checks anyone in.

### Reminders

Reminders are delivered in-app. They are generated when workspace pages load, at most once a minute per server process. To run the same sweep from a scheduler:

```bash
npm run reminders
```

The sweep is idempotent: each reminder has a dedupe key, so repeated runs do not duplicate notifications.

### Health check

```bash
curl -s http://localhost:3000/api/health
```

`GET /api/health` is public, returns `Cache-Control: no-store`, and reports whether the database is reachable, the session secret is configured, and the migration table is available. It returns HTTP 503 with a safe reason if the service is degraded.

## HTTP API

Only two public HTTP endpoints exist. All other mutations are Next.js Server Actions reached through forms in the authenticated workspace.

### `GET /api/health`

| Item | Value |
| --- | --- |
| Authentication | None |
| Cache | `no-store` |
| Success | HTTP 200 with status `ok` |
| Failure | HTTP 503 with status `degraded` |

Success response:

```json
{
  "status": "ok",
  "service": "roomrelay",
  "phase": 6,
  "database": "ok",
  "migrations": 1,
  "checkedAt": "2026-10-29T21:17:06.451Z"
}
```

Degraded response:

```json
{
  "status": "degraded",
  "service": "roomrelay",
  "phase": 6,
  "database": "unavailable",
  "reason": "configuration_or_database_unavailable",
  "checkedAt": "..."
}
```

### `POST /api/access/check`

Runs a simulated access check for the signed-in user. There is no bearer-token endpoint: use the HTTP-only `roomrelay_session` cookie created by the login flow.

**Request body**

| Field | Type | Description |
| --- | --- | --- |
| `credentialId` | string | A credential row belonging to the signed-in user, such as `cred_amelia_active` in the seeded demo |
| `roomId` | string | The room being checked, such as `room_classroom_14` in the seeded demo |
| `eventNonce` | UUID string | A fresh idempotency nonce for this tap. Reusing it with a different payload is rejected. |

```bash
curl -sS -X POST http://localhost:3000/api/access/check \
  -H 'Content-Type: application/json' \
  -H 'Cookie: roomrelay_session=<session-cookie>' \
  -d '{
    "credentialId": "cred_amelia_active",
    "roomId": "room_classroom_14",
    "eventNonce": "8f3a09d8-18ee-4f43-8e6f-d79e83df2051"
  }'
```

The `<session-cookie>` value is a placeholder: sign in through the UI and copy the `roomrelay_session` cookie from the browser. The seeded Classroom 14 demo window is relative to the last `npm run db:reset`; if it has passed, the server correctly returns a denial.

**Decision response**

```json
{
  "decision": "ALLOW",
  "reasonCode": "ACCESS_ALLOWED",
  "message": "Access check allowed for your approved booking.",
  "source": "SIMULATED",
  "replayed": false,
  "eventId": "access_...",
  "occurredAt": "2026-10-29T21:20:00.000Z",
  "bookingId": "booking_demo_active_classroom",
  "bookingStatus": "checked_in"
}
```

A denied decision still returns a normal decision body with `"decision": "DENY"` and a reason code such as `CREDENTIAL_REVOKED`, `BOOKING_NOT_APPROVED`, or `OUTSIDE_BOOKING_WINDOW`.

**Status codes**

| Status | Meaning |
| --- | --- |
| `200` | Decision returned (`ALLOW` or `DENY`) |
| `400` | Invalid JSON, missing fields, or an invalid nonce |
| `401` | No active session |
| `403` | Cross-origin request or inactive account |
| `409` | Nonce reused with a different actor or payload |
| `429` | Rate limited; the body is a denied decision with `RATE_LIMITED` |
| `503` | Access service unavailable; no access is granted |

Origin checking is applied when the browser supplies both `Origin` and `Host` headers. The route runs on the Node.js runtime and never sets a browser-readable session cookie.

## Deployment

### Vercel + Neon (documented target)

The repository is configured and documented for **Vercel** hosting with **Neon Postgres**. The public demo above shows that this deployment is reachable and healthy; there is no infrastructure-as-code in the repository for provisioning Neon or Vercel.

1. Create a Neon project and database.
2. Import this repository into Vercel.
3. Configure the environment variables from [Environment Configuration](#environment-configuration):
   - `ROOMRELAY_SESSION_SECRET`
   - `DATABASE_URL` (pooled)
   - `DATABASE_URL_UNPOOLED` (direct)
   - `ROOMRELAY_CAMPUS_TIMEZONE` (optional)
4. Apply migrations as a controlled step. **Vercel builds do not run migrations.** Use the direct connection for the migration command, replacing the example URL with your own direct connection string:

   ```bash
   DATABASE_URL="postgresql://user:password@direct-host/db?sslmode=require" npm run db:migrate
   ```

5. Seed the demo data only for a demo environment:

   ```bash
   DATABASE_URL="postgresql://user:password@direct-host/db?sslmode=require" npm run db:seed
   ```

6. Deploy the Next.js project. The build produces the application; no database schema changes are performed by `next build`.
7. Verify the deployment:

   ```bash
   curl -s https://<your-deployment>/api/health
   ```

   It should report `"status": "ok"`, `"database": "ok"`, and `"migrations": 1`.

### Docker

Docker is optional. The supplied image uses Node 24 and runs `npm run db:setup` before starting Next.js, so the target database must be reachable from the container.

```bash
export ROOMRELAY_SESSION_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))")"
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
docker compose up --build
```

The application is available at [http://localhost:3000](http://localhost:3000). The compose health check calls `/api/health`.

### CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It starts a Postgres 17 service and runs:

```text
npm ci
npm run db:setup
npm run lint
npm run typecheck
npm test
npm run build
npm run test:smoke
```

The workflow validates the application; it does not deploy it.

### Operational notes

- Use the pooled Neon URL for runtime traffic and the direct URL for migrations and dumps.
- Keep the session secret stable across deployments. Rotating it signs everyone out.
- Do not run `db:reset` against a shared, staging, or production database.
- The demo credentials are public. Replace authentication before exposing real user data.
- There is no high-availability or multi-region configuration in this repository.

## Testing and Troubleshooting

### Command reference

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs `db:setup`, then starts the development server |
| `npm run build` | Creates an optimized production build |
| `npm start` | Runs `db:setup`, then starts the production server |
| `npm run lint` | Runs ESLint |
| `npm run typecheck` | Runs TypeScript with `tsc --noEmit` |
| `npm test` | Runs the full Vitest suite once |
| `npm run test:watch` | Runs Vitest in watch mode |
| `npm run test:smoke` | Starts the production build on port `3107` and checks health, auth redirects, role scoping, and key flows over HTTP |
| `npm run db:migrate` | Applies pending SQL files from `db/postgres/` |
| `npm run db:seed` | Applies migrations and upserts the demo dataset |
| `npm run db:setup` | Creates `.env.local` if needed, migrates, and seeds |
| `npm run db:reset` | Drops the public schema and recreates it; requires `ROOMRELAY_ALLOW_DB_RESET=1` |
| `npm run reminders` | Runs one reminder sweep against the configured database |
| `npm run check` | Runs lint → typecheck → tests → production build → HTTP smoke test |

### Focused tests

```bash
npx vitest run tests/access.test.ts
npx vitest run -t "allows a valid"
```

### Database test setup

The suite requires a real Postgres database. The default is:

```text
postgresql://roomrelay:roomrelay_test@127.0.0.1:55432/roomrelay_test
```

Override it with `TEST_DATABASE_URL`. CI starts its own Postgres service and sets that variable.

Important constraints:

- The database tests share one Postgres database and truncate tables between test files.
- `fileParallelism` is disabled in `vitest.config.mts`; do not add tests that assume parallel database isolation.
- `tsconfig.json` excludes `tests`, so `npm run typecheck` does not type-check test files. Vitest still transpiles and runs them.
- `npm run test:smoke` requires a current `npm run build` and an initialized, seeded database.
- `scripts/e2e-neon.ts` mutates data. It requires `ROOMRELAY_E2E_ALLOW_MUTATION=1` and a disposable Neon branch.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `DATABASE_URL is required` | `.env.local` missing or not loaded | Copy `.env.example` to `.env.local`, set `DATABASE_URL`, and rerun `npm run db:setup` |
| `ROOMRELAY_SESSION_SECRET is required and must contain at least 32 characters` | Missing or short secret | Generate a 48-byte base64url secret and set it in `.env.local` |
| `/api/health` returns 503 | Database unreachable, schema not migrated, or session secret invalid | Check the connection string, run `npm run db:migrate`, and confirm the secret |
| Tests fail to connect | No Postgres on the default test port | Start a disposable Postgres and set `TEST_DATABASE_URL` |
| Tests fail with locked or truncated tables | Another test run is using the same database | Use a separate disposable test database; do not parallelize database tests |
| `db:reset` refuses to run | Guard variable is unset | Set `ROOMRELAY_ALLOW_DB_RESET=1` only for a disposable database |
| Demo dates or the access window are stale | Seeded fixtures are relative to the last setup | Run `ROOMRELAY_ALLOW_DB_RESET=1 npm run db:reset` |
| `npm run test:smoke` cannot start | No production build or port `3107` is occupied | Run `npm run build`, free the port, and ensure the database is seeded |
| A deployment fails database queries | Migrations were not applied | Run `npm run db:migrate` as a controlled deployment step with the direct URL |
| Environment values seem ignored | Quoted values pasted into a host dashboard | The app strips paired quotes, but verify the value and redeploy; do not read connection values directly from `process.env` in application code |
| The assistant says it cannot find a room | Missing date, time, or group size | Include all three, or let the assistant ask for the missing detail |

## Security and Limitations

### Security controls

- Passwords are hashed with Node's `scrypt`, using a random 16-byte salt and a 64-byte derived key per password. Verification uses `timingSafeEqual`.
- Sign-in returns a generic error for unknown accounts, wrong passwords, and suspended accounts. A dummy scrypt comparison is performed for unknown emails to reduce timing-based account enumeration.
- Sessions are signed HS256 JWTs in an HTTP-only cookie, with `SameSite=Lax`, `Secure` in production, an eight-hour expiry, and an issuer/audience check.
- Role and account status are re-read from Postgres on every protected request. A suspended account loses access immediately on its next request.
- Protected pages live under `/app/**`; the access-check route and Server Actions re-check authentication themselves.
- Authorization is server-side and room-scoped. Managers act only on assigned rooms; administrators have explicit institution-wide scope.
- Booking, access, room-admin, and incident mutations validate input with Zod and re-read trusted state inside a transaction. Client-supplied roles, statuses, requester IDs, decision fields, timestamps, and access results are ignored.
- Room IDs, credential ownership, booking ownership, and time windows are derived from server state.
- Access checks fail closed. Unknown credentials, revoked credentials, inactive rooms, unapproved bookings, and out-of-window attempts are denied and logged.
- Access nonces plus a request hash prevent replay; mismatched replays are rejected.
- Access events, audit events, and condition reports are append-only at the database layer. Resolved incidents and removed closures are immutable.
- Database triggers enforce allowed booking transitions, decision and cancellation metadata, confirmed-booking overlap, blackout approval, and incident transitions.
- Security headers are set for content sniffing, framing, referrer policy, and browser feature permissions.

### Known limitations and incomplete functionality

- This is a **prototype**, not a production access-control system. No physical NFC reader, relay, lock, or door is connected, and `ALLOW` never actuates hardware.
- Demo passwords are public by design. There is no institutional SSO, MFA, password reset, email verification, device management, or session revocation list.
- Rate limiting is in memory and per process. It resets on restart and is not shared across instances; a multi-instance deployment needs a shared store such as Redis or a database-backed limiter.
- Notifications are in-app only. There is no email, SMS, push, or calendar-export delivery.
- There is no photo upload, object storage, analytics, payments, or external AI integration.
- There is no automatic no-show classification, penalty, sanction, trust score, or appeal workflow. Incidents are human-reviewed.
- Managers and administrators cannot check out on behalf of a requester.
- Waitlists do not approve automatically. Freed time returns a request to human review.
- There is no administrative UI for credential binding or revocation, and no full user-management console.
- There is no nonce-based Content Security Policy; `script-src` is not yet restricted.
- SQLite is not used at runtime. `db/migrations/` and `data/` are legacy local artifacts.
- The demo runs on a single Neon project. There is no high-availability, multi-region, or long-retention backup configuration in this repository.
- No security audit, penetration test, compliance certification, or production readiness review has been performed.

### Hardening notes for contributors

These are accurate observations about the current implementation, not claims about production behavior:

- **Transaction isolation:** `transaction().immediate()` issues `BEGIN`/`COMMIT` at Postgres READ COMMITTED; it is not an exclusive lock. The approval path does not currently take an explicit per-room lock. Concurrent approvals of different overlapping requests, concurrent duplicate submissions, and concurrent policy/closure changes should be load-tested and serialized (for example with a per-room advisory lock) before production use.
- **Check-in timestamp:** live access checks record the event and change the booking to `checked_in`, but they do not currently populate `bookings.checked_in_at`; the access event remains the authoritative check-in time. Seeded fixtures do populate the column.
- **Discovery vs. submission:** discovery availability checks hours, closures, and confirmed conflicts. Minimum notice, maximum advance days, and per-person quotas are enforced when the request is submitted. A search result can therefore say “Free” for a time that the request service later rejects.
- **Replay races:** idempotency and nonce uniqueness are enforced by database indexes. Under a true concurrent collision, one request can receive a generic failure rather than the original receipt; the duplicate write is still prevented.

### Privacy and demo-data warning

- The seed contains fictitious names, emails, bookings, credentials, and incident descriptions. Do not replace them with real personal or access data in a public deployment.
- Credential references are stored in the database and masked in the UI. Treat them as sensitive even in the demo.
- Access history is role-scoped, but managers and administrators can see operational details for the rooms they oversee.
- Do not use the public demo for confidential meetings, real door access, or regulated data.

## Project Documents

- [`docs/plan.md`](docs/plan.md) — phased build plan and original scope.
- [`docs/phase-1-prd.md`](docs/phase-1-prd.md) — foundation, authentication, schema, and seed requirements.
- [`docs/phase-2-prd.md`](docs/phase-2-prd.md) — discovery and booking requests.
- [`docs/phase-3-prd.md`](docs/phase-3-prd.md) — manager review and cancellation.
- [`docs/phase-4-prd.md`](docs/phase-4-prd.md) — access policy and event history.
- [`docs/phase-5-prd.md`](docs/phase-5-prd.md) — check-out, condition reports, and incidents.
- [`docs/RoomRelay_Project_Context.pdf`](docs/RoomRelay_Project_Context.pdf) — source hackathon concept and product context.
- [`AGENTS.md`](AGENTS.md) — repository-specific contributor and verification notes.

The phase PRDs document the project's earlier implementation baseline. Some of them refer to SQLite and `better-sqlite3`; the current runtime is Postgres through `pg`. Treat the current schema and code as authoritative when they differ.

## Contributing

There is no separate `CONTRIBUTING.md`, but the repository does have contributor notes in [`AGENTS.md`](AGENTS.md). Before opening a pull request:

1. Read `AGENTS.md`.
2. Keep the database server-only; never add a browser-facing database client.
3. Re-check authentication, role, status, and room ownership in protected API handlers and mutation services.
4. Use `intervalsConflict` and `getBlockingBookings` for booking overlap. The room buffer applies symmetrically after every booking.
5. Emit notifications in the same transaction as the state change they describe.
6. Do not edit or use `db/migrations/`; add the next numbered SQL file under `db/postgres/`.
7. Do not edit or delete append-only history to “fix” state.
8. Run `npm run check` before claiming the work is complete.

The project uses ESLint and TypeScript for static analysis but does not currently configure a standalone formatter such as Prettier. If you add a formatter, document its command in `package.json` and in this README.

## License

No `LICENSE` file is included in this repository. The code and demo data are presented as a prototype; add an explicit license before redistributing or using the project outside its intended demo context.
