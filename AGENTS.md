<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# RoomRelay agent notes

## Verify changes

- Run `npm run check` for complete validation. It runs lint → typecheck → tests → production build → HTTP smoke test.
- Focused tests: `npx vitest run tests/access.test.ts`; focused case: `npx vitest run -t "allows a valid"`.
- `npm run test:smoke` starts the production server on port `3107`. It requires an initialized database and a current `npm run build`.
- Tests use a disposable Postgres database and fake clocks; no external services are required. Start Docker Postgres on port `55432`, or set `TEST_DATABASE_URL`.

## Setup, database, and fixtures

- `npm run dev` triggers `predev` → `db:setup`, which applies migrations and seeds demo data. `DATABASE_URL` and `DATABASE_URL_UNPOOLED` must come from Neon (`neon env pull`).
- Local demo data lives in Neon Postgres. Never commit `.env.local`. Use `npm run db:reset` only against a disposable database with `ROOMRELAY_ALLOW_DB_RESET=1`.
- `db:setup` is safe to rerun, but many seeded bookings/events are insert-only. Use `npm run db:reset` to refresh relative demo dates, the active access window, and a clean demo state.
- Migrations are forward-only in `db/postgres/`. Add the next numbered SQL file and run `db:setup`.
- Docs live in `docs/`: plan, context PDF, and Phase 1–5 PRDs. Seed only creates rooms that don't exist; never make it overwrite admin-owned data.

## Architecture and rules that are easy to break

- Postgres on Neon through `pg` is server-only. There is no browser-facing database client.
- All protected routes live under `app/app/**`. Resolve the actor with `getCurrentProfile()`/`requireCurrentProfile()` and re-check persisted role, status, and room ownership server-side.
- Manager scope is per assigned room; admin scope is explicit institution-wide. Never trust role, requester, booking status, timestamps, or result values from the client.
- Domain code is split under `lib/`:
  - `lib/bookings`: request, decisions, cancellation, checkout, timeline
  - `lib/access`: simulated access policy, events, history
  - `lib/incidents`: review/resolution services and queries
  - `lib/rooms`: catalog/availability, `policy.ts` (published rule copy), `blackouts.ts`; `lib/time`: campus timezone/DST handling
  - `lib/allocation/ranking.ts`: the one ranking implementation; `lib/bookings/waitlist.ts`: settle-after-approval and promotion
  - `lib/admin/rooms.ts`: room administration; `lib/notifications`: inbox + reminder sweep; `lib/assistant`: read-only assistant
- Use `intervalsConflict`/`getBlockingBookings` for overlap: the buffer applies after every booking (symmetric).
- Emit notifications inside the same transaction as the state change they describe.
- Booking transitions enforced by triggers: `pending→approved|rejected|cancelled|waitlisted`, `waitlisted→pending|rejected|cancelled`, `approved→cancelled|checked_in`, `checked_in→completed|incident`, `incident→completed`. Staff (active admin or the room's manager) may record cancellations; a booking can never become approved inside an active blackout. A clean checkout requires an after-use condition report; an issue checkout requires an incident; an incident booking completes only when all incidents are resolved.
- Only the access service may set `approved→checked_in`. Access checks are **simulated**; never claim a physical door unlocked.
- `access_events`, `audit_events`, and `condition_reports` are append-only; resolved incidents are immutable. Do not edit/delete history to “fix” state.
- Store timestamps as UTC ISO strings. Use `lib/time/campus-time.ts` (Temporal) for campus-local conversion; do not use process-local `Date` formatting.
- Postgres timestamps are `timestamptz`; the data layer returns them as ISO strings. Use parameterized queries through `lib/db/client.ts`.

## Deployment

- No public preview credentials/URL are configured. README documents Vercel + Neon deployment and the optional Docker path; do not claim the app is publicly deployed unless verified.
