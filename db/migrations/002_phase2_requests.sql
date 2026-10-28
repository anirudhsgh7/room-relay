-- RoomRelay Phase 2: room discovery and booking requests.

CREATE TABLE room_booking_policies (
  room_id                 TEXT PRIMARY KEY REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  requests_enabled        INTEGER NOT NULL DEFAULT 1 CHECK (requests_enabled IN (0, 1)),
  slot_interval_minutes   INTEGER NOT NULL DEFAULT 30
                          CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  minimum_notice_minutes  INTEGER NOT NULL DEFAULT 30
                          CHECK (minimum_notice_minutes BETWEEN 0 AND 10080),
  maximum_duration_minutes INTEGER NOT NULL DEFAULT 240
                          CHECK (maximum_duration_minutes BETWEEN 15 AND 1440),
  buffer_minutes          INTEGER NOT NULL DEFAULT 0
                          CHECK (buffer_minutes BETWEEN 0 AND 240),
  updated_at              TEXT NOT NULL
);

INSERT INTO room_booking_policies (
  room_id, requests_enabled, slot_interval_minutes, minimum_notice_minutes,
  maximum_duration_minutes, buffer_minutes, updated_at
)
SELECT
  id, 1, 30, 30, 240, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM rooms;

CREATE TABLE profile_eligibility (
  id             TEXT PRIMARY KEY,
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES eligibility_requirements(id) ON UPDATE CASCADE ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('verified', 'unverified', 'expired')),
  verified_by    TEXT REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  verified_at    TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (profile_id, requirement_id),
  CHECK (
    status <> 'verified'
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CHECK (expires_at IS NULL OR verified_at IS NULL OR expires_at > verified_at)
);

CREATE INDEX profile_eligibility_profile_idx
  ON profile_eligibility (profile_id, requirement_id);

-- Idempotency and the eligibility snapshot shown on the requester's receipt.
ALTER TABLE bookings ADD COLUMN submission_key TEXT;
ALTER TABLE bookings ADD COLUMN request_payload_hash TEXT;
ALTER TABLE bookings ADD COLUMN eligibility_snapshot_json TEXT
  CHECK (
    eligibility_snapshot_json IS NULL
    OR (
      json_valid(eligibility_snapshot_json)
      AND json_type(eligibility_snapshot_json) = 'array'
    )
  );

CREATE UNIQUE INDEX bookings_requester_submission_key_idx
  ON bookings (requester_id, submission_key)
  WHERE submission_key IS NOT NULL;

CREATE INDEX bookings_requester_status_time_idx
  ON bookings (requester_id, status, start_at, end_at);

-- Confirmed bookings are the source of truth for inventory. Pending requests
-- never reserve a room. The buffer expands the end of an existing confirmed
-- booking, matching the canonical service-layer overlap rule.
CREATE TRIGGER bookings_confirmed_no_overlap_insert
BEFORE INSERT ON bookings
WHEN NEW.status IN ('approved', 'checked_in')
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED_BOOKING_OVERLAP')
  WHERE EXISTS (
    SELECT 1
    FROM bookings AS existing
    LEFT JOIN room_booking_policies AS policy
      ON policy.room_id = existing.room_id
    WHERE existing.room_id = NEW.room_id
      AND existing.id <> NEW.id
      AND existing.status IN ('approved', 'checked_in')
      AND julianday(existing.start_at) < julianday(NEW.end_at)
      AND julianday(existing.end_at) +
          (COALESCE(policy.buffer_minutes, 0) / 1440.0) >
          julianday(NEW.start_at)
  );
END;

CREATE TRIGGER bookings_confirmed_no_overlap_update
BEFORE UPDATE OF status, room_id, start_at, end_at ON bookings
WHEN NEW.status IN ('approved', 'checked_in')
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED_BOOKING_OVERLAP')
  WHERE EXISTS (
    SELECT 1
    FROM bookings AS existing
    LEFT JOIN room_booking_policies AS policy
      ON policy.room_id = existing.room_id
    WHERE existing.room_id = NEW.room_id
      AND existing.id <> NEW.id
      AND existing.status IN ('approved', 'checked_in')
      AND julianday(existing.start_at) < julianday(NEW.end_at)
      AND julianday(existing.end_at) +
          (COALESCE(policy.buffer_minutes, 0) / 1440.0) >
          julianday(NEW.start_at)
  );
END;
