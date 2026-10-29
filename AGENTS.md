<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# RoomRelay agent notes

## Verify changes

- Run `npm run check` before claiming work is done. It runs lint → typecheck → tests → production build → HTTP smoke test.
- Focused tests: `npx vitest run tests/access.test.ts`; focused case: `npx vitest run -t "allows a valid"`.
- Tests require a real Postgres. Default: `postgresql://roomrelay:roomrelay_test@127.0.0.1:55432/roomrelay_test`; override with `TEST_DATABASE_URL`. CI starts its own Postgres service.
- Database tests share one Postgres database and truncate tables; `fileParallelism` is disabled. Do not add tests that assume parallel database isolation.
- `tsconfig.json` excludes `tests`, so `npm run typecheck` does not type-check test files. Vitest still transpiles and runs them.
- `npm run test:smoke` starts the production server on port `3107`; it needs a current `npm run build` and an initialized database.
- `scripts/e2e-neon.ts` mutates data. It requires `ROOMRELAY_E2E_ALLOW_MUTATION=1` and a disposable Neon branch.

## Setup, database, and fixtures

- `npm run dev` triggers `predev` → `db:setup`, which applies migrations and seeds demo data. The app uses Neon Postgres via `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct).
- Only `db/postgres/*.sql` is applied. `db/migrations/` is legacy SQLite history; do not edit or use it. Migrations are forward-only; add the next numbered Postgres file.
- `db:setup` is safe to rerun, but many seeded bookings/events are insert-only. Use `npm run db:reset` to refresh relative demo dates, the active access window, and demo state.
- `db:reset` drops the public schema and requires `ROOMRELAY_ALLOW_DB_RESET=1`. Run it only against a disposable database.
- Seed only creates rooms that do not exist; never overwrite admin-owned room data. Never commit `.env.local` or store real personal/access data in this demo.
- Docs live in `docs/`; the current implementation notes and demo walkthrough are in `README.md`.

## Architecture and rules that are easy to break

- Postgres on Neon through `pg` is server-only. There is no browser-facing database client.
- Protected pages live under `app/app/**`; protected API handlers re-check authentication themselves (for example `app/api/access/check`). Resolve the actor with `getCurrentProfile()`/`requireCurrentProfile()` and re-check persisted role, status, and room ownership server-side.
- Manager scope is per assigned room; admin scope is institution-wide. Never trust role, requester, booking status, timestamps, or result values from the client.
- Domain code is split under `lib/`: `bookings`, `access`, `incidents`, `rooms`, `allocation`, `admin`, `notifications`, and the read-only `assistant`. `lib/allocation/ranking.ts` is the single ranking implementation; `lib/bookings/waitlist.ts` handles settle-after-approval and promotion.
- Use `intervalsConflict`/`getBlockingBookings` for overlap. The room buffer applies after every booking, so the conflict rule is symmetric.
- Emit notifications inside the same transaction as the state change they describe.
- Booking transitions are enforced by Postgres triggers: `pending→approved|rejected|cancelled|waitlisted`, `waitlisted→pending|rejected|cancelled`, `approved→cancelled|checked_in`, `checked_in→completed|incident`, `incident→completed`. Staff cancellations require an active admin or the room's manager. A booking cannot become approved inside an active blackout.
- A clean checkout requires an after-use condition report; an issue checkout requires an incident; an incident booking completes only when all incidents are resolved.
- Only the access service may set `approved→checked_in`. Access checks are **simulated**; never claim a physical door unlocked or add hardware authority to the prototype.
- `access_events`, `audit_events`, and `condition_reports` are append-only; resolved incidents are immutable. Do not edit/delete history to "fix" state.
- Store timestamps as UTC ISO strings. Use `lib/time/campus-time.ts` (Temporal) for campus-local conversion; do not use process-local `Date` formatting.
- Postgres timestamps are `timestamptz`; the data layer returns ISO strings. Use parameterized queries through `lib/db/client.ts`.

## Deployment

- Live production: https://room-relay.vercel.app (Vercel + Neon Postgres), linked to `github.com/anirudhsgh7/room-relay`. Do not claim a different URL or environment is deployed unless verified.
- Vercel stores some pasted env values with surrounding quotes. Use `getEnvValue` from `lib/config.ts` for env reads; it strips paired quotes. Do not read connection/session/timezone values directly from `process.env`.
- Use the pooled Neon URL for runtime `DATABASE_URL`; use `DATABASE_URL_UNPOOLED` for migrations, seeds, and backups.
- Vercel builds do not run migrations. Apply them as a controlled step with `npm run db:migrate` against the direct URL.
- Verify deployment with `vercel curl https://room-relay.vercel.app/api/health`; it should report `database: "ok"` and `migrations: 1`.
