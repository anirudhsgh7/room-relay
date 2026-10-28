-- RoomRelay initial schema (Phase 1)
-- Timestamps are ISO-8601 UTC strings. The application displays campus-local time.

CREATE TABLE profiles (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  role          TEXT NOT NULL CHECK (role IN ('student', 'manager', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended')),
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE rooms (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  building        TEXT NOT NULL CHECK (length(trim(building)) > 0),
  location        TEXT NOT NULL CHECK (length(trim(location)) > 0),
  capacity        INTEGER NOT NULL CHECK (capacity > 0),
  facilities      TEXT NOT NULL DEFAULT '[]'
                  CHECK (json_valid(facilities) AND json_type(facilities) = 'array'),
  policy_summary  TEXT NOT NULL DEFAULT '',
  manager_id      TEXT NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TRIGGER rooms_manager_must_be_manager_insert
BEFORE INSERT ON rooms
WHEN (SELECT role FROM profiles WHERE id = NEW.manager_id) IS NOT 'manager'
BEGIN
  SELECT RAISE(ABORT, 'A room manager must have the manager role');
END;

CREATE TRIGGER rooms_manager_must_be_manager_update
BEFORE UPDATE OF manager_id ON rooms
WHEN (SELECT role FROM profiles WHERE id = NEW.manager_id) IS NOT 'manager'
BEGIN
  SELECT RAISE(ABORT, 'A room manager must have the manager role');
END;

CREATE TABLE availability_rules (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  weekday         INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at        TEXT NOT NULL CHECK (opens_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  closes_at       TEXT NOT NULL CHECK (closes_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  effective_from  TEXT NOT NULL,
  effective_until TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (opens_at < closes_at),
  CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE UNIQUE INDEX availability_rules_room_window_idx
  ON availability_rules (room_id, weekday, opens_at, closes_at, effective_from);

CREATE TABLE eligibility_requirements (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  requirement_type TEXT NOT NULL CHECK (length(trim(requirement_type)) > 0),
  description      TEXT NOT NULL CHECK (length(trim(description)) > 0),
  required         INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE bookings (
  id                  TEXT PRIMARY KEY,
  room_id             TEXT NOT NULL REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  requester_id        TEXT NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  purpose             TEXT NOT NULL CHECK (length(trim(purpose)) > 0),
  group_name          TEXT,
  expected_attendance INTEGER NOT NULL CHECK (expected_attendance > 0),
  start_at            TEXT NOT NULL,
  end_at              TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (
                        status IN (
                          'draft', 'pending', 'approved', 'rejected', 'waitlisted',
                          'checked_in', 'completed', 'cancelled', 'no_show', 'incident'
                        )
                      ),
  decision_reason     TEXT,
  decided_by          TEXT REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  decided_at          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (end_at > start_at),
  CHECK (
    status <> 'rejected'
    OR (decision_reason IS NOT NULL AND length(trim(decision_reason)) > 0)
  )
);

CREATE INDEX bookings_room_window_idx
  ON bookings (room_id, start_at, end_at, status);

CREATE INDEX bookings_requester_idx
  ON bookings (requester_id, start_at DESC);

CREATE TABLE credentials (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  credential_ref  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('nfc_uid', 'demo_token')),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revoked_at      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (
    (active = 1 AND revoked_at IS NULL)
    OR (active = 0 AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX credentials_user_idx ON credentials (user_id, active);

CREATE TABLE access_events (
  id                      TEXT PRIMARY KEY,
  credential_id           TEXT REFERENCES credentials(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  attempted_credential_ref TEXT NOT NULL CHECK (length(trim(attempted_credential_ref)) > 0),
  room_id                 TEXT NOT NULL REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  occurred_at             TEXT NOT NULL,
  result                  TEXT NOT NULL CHECK (result IN ('allowed', 'denied')),
  reason_code             TEXT NOT NULL CHECK (length(trim(reason_code)) > 0),
  source                  TEXT NOT NULL CHECK (source IN ('simulator', 'reader', 'seed')),
  correlation_id          TEXT NOT NULL UNIQUE,
  created_at              TEXT NOT NULL
);

CREATE INDEX access_events_room_time_idx
  ON access_events (room_id, occurred_at DESC);

CREATE INDEX access_events_credential_time_idx
  ON access_events (credential_id, occurred_at DESC);

CREATE TABLE audit_events (
  id             TEXT PRIMARY KEY,
  actor_id       TEXT REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  action         TEXT NOT NULL CHECK (length(trim(action)) > 0),
  entity_type    TEXT NOT NULL CHECK (length(trim(entity_type)) > 0),
  entity_id      TEXT NOT NULL CHECK (length(trim(entity_id)) > 0),
  occurred_at    TEXT NOT NULL,
  summary        TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  correlation_id TEXT NOT NULL,
  metadata_json  TEXT NOT NULL DEFAULT '{}'
                 CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object')
);

CREATE INDEX audit_events_entity_idx
  ON audit_events (entity_type, entity_id, occurred_at DESC);

CREATE INDEX audit_events_actor_idx
  ON audit_events (actor_id, occurred_at DESC);

CREATE TABLE condition_reports (
  id           TEXT PRIMARY KEY,
  booking_id   TEXT NOT NULL REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  stage        TEXT NOT NULL CHECK (stage IN ('before', 'after')),
  notes        TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  submitted_by TEXT NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at   TEXT NOT NULL
);

CREATE INDEX condition_reports_booking_idx
  ON condition_reports (booking_id, created_at DESC);

CREATE TABLE incidents (
  id              TEXT PRIMARY KEY,
  booking_id      TEXT NOT NULL REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  category        TEXT NOT NULL CHECK (length(trim(category)) > 0),
  description     TEXT NOT NULL CHECK (length(trim(description)) > 0),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'reviewing', 'resolved')),
  reporter_id     TEXT NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  reviewer_id     TEXT REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  resolution_note TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (
    status <> 'resolved'
    OR (reviewer_id IS NOT NULL AND resolution_note IS NOT NULL AND length(trim(resolution_note)) > 0)
  )
);

CREATE INDEX incidents_booking_idx ON incidents (booking_id, created_at DESC);

-- Access and audit records are append-only. Corrections are represented by new
-- events rather than mutating history. These triggers are intentionally strict:
-- even an application administrator cannot rewrite the past.
CREATE TRIGGER access_events_no_update
BEFORE UPDATE ON access_events
BEGIN
  SELECT RAISE(ABORT, 'access_events is append-only');
END;

CREATE TRIGGER access_events_no_delete
BEFORE DELETE ON access_events
BEGIN
  SELECT RAISE(ABORT, 'access_events is append-only');
END;

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;
