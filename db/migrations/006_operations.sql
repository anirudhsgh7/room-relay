-- RoomRelay 006: room administration, blackouts, published allocation rules,
-- transparent waitlists, and in-app notifications.

-- ---------------------------------------------------------------------------
-- Structured booking policy additions
-- ---------------------------------------------------------------------------

-- How far ahead a request may start (booking horizon).
ALTER TABLE room_booking_policies ADD COLUMN max_advance_days INTEGER NOT NULL
  DEFAULT 60 CHECK (max_advance_days BETWEEN 1 AND 365);

-- Fair-use cap on a requester's concurrent upcoming requests for one room.
-- Counts pending, waitlisted, approved, and checked-in bookings. 0 = no cap.
ALTER TABLE room_booking_policies ADD COLUMN max_active_per_requester INTEGER NOT NULL
  DEFAULT 0 CHECK (max_active_per_requester BETWEEN 0 AND 50);

-- The published rule used to rank competing requests for the same time.
ALTER TABLE room_booking_policies ADD COLUMN allocation_rule TEXT NOT NULL
  DEFAULT 'first_come'
  CHECK (allocation_rule IN ('first_come', 'best_fit', 'fair_share'));

ALTER TABLE room_booking_policies ADD COLUMN waitlist_enabled INTEGER NOT NULL
  DEFAULT 1 CHECK (waitlist_enabled IN (0, 1));

-- ---------------------------------------------------------------------------
-- Booking allocation metadata
-- ---------------------------------------------------------------------------

-- Required when a reviewer approves a request that the published rule ranks
-- below a competing request for the same time.
ALTER TABLE bookings ADD COLUMN allocation_exception_reason TEXT;
ALTER TABLE bookings ADD COLUMN waitlisted_at TEXT;
ALTER TABLE bookings ADD COLUMN promoted_at TEXT;

CREATE INDEX bookings_room_waitlist_idx
  ON bookings (room_id, status, start_at, end_at)
  WHERE status IN ('pending', 'waitlisted');

-- ---------------------------------------------------------------------------
-- Changeover buffer applies after every confirmed booking
-- ---------------------------------------------------------------------------
-- Before 006 the buffer was only added after the booking that was confirmed
-- first, so the outcome depended on approval order. Each confirmed booking now
-- occupies [start, end + buffer), and two confirmed bookings may not overlap.

DROP TRIGGER bookings_confirmed_no_overlap_insert;
DROP TRIGGER bookings_confirmed_no_overlap_update;

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
      AND julianday(existing.start_at) <
          julianday(NEW.end_at) + (COALESCE(policy.buffer_minutes, 0) / 1440.0)
      AND julianday(existing.end_at) + (COALESCE(policy.buffer_minutes, 0) / 1440.0) >
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
      AND julianday(existing.start_at) <
          julianday(NEW.end_at) + (COALESCE(policy.buffer_minutes, 0) / 1440.0)
      AND julianday(existing.end_at) + (COALESCE(policy.buffer_minutes, 0) / 1440.0) >
          julianday(NEW.start_at)
  );
END;

-- ---------------------------------------------------------------------------
-- Blackouts: periods when a room cannot be booked (maintenance, exams, events)
-- ---------------------------------------------------------------------------

CREATE TABLE room_blackouts (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  created_by TEXT NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  removed_by TEXT REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (julianday(ends_at) > julianday(starts_at)),
  CHECK (
    (removed_at IS NULL AND removed_by IS NULL)
    OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

CREATE INDEX room_blackouts_room_window_idx
  ON room_blackouts (room_id, starts_at, ends_at)
  WHERE removed_at IS NULL;

-- A removed blackout stays on record; only its removal can be recorded once.
CREATE TRIGGER room_blackouts_removed_immutable
BEFORE UPDATE ON room_blackouts
WHEN OLD.removed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'removed blackouts are immutable');
END;

CREATE TRIGGER room_blackouts_no_delete
BEFORE DELETE ON room_blackouts
BEGIN
  SELECT RAISE(ABORT, 'blackouts are removed, not deleted');
END;

-- Defense in depth: a booking can never be newly confirmed inside an active
-- blackout, even if a service-layer check is bypassed.
CREATE TRIGGER bookings_no_approval_in_blackout
BEFORE UPDATE OF status ON bookings
WHEN NEW.status = 'approved' AND OLD.status <> 'approved'
BEGIN
  SELECT RAISE(ABORT, 'ROOM_BLACKOUT')
  WHERE EXISTS (
    SELECT 1
    FROM room_blackouts blackout
    WHERE blackout.room_id = NEW.room_id
      AND blackout.removed_at IS NULL
      AND julianday(blackout.starts_at) < julianday(NEW.end_at)
      AND julianday(blackout.ends_at) > julianday(NEW.start_at)
  );
END;

-- ---------------------------------------------------------------------------
-- In-app notifications
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body         TEXT NOT NULL CHECK (length(trim(body)) > 0),
  link_path    TEXT CHECK (link_path IS NULL OR link_path LIKE '/app%'),
  booking_id   TEXT REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
  dedupe_key   TEXT,
  created_at   TEXT NOT NULL,
  read_at      TEXT
);

CREATE INDEX notifications_recipient_idx
  ON notifications (recipient_id, read_at, created_at DESC);

-- Reminders are generated by a repeatable sweep; the key makes each one
-- deliverable at most once per recipient.
CREATE UNIQUE INDEX notifications_recipient_dedupe_idx
  ON notifications (recipient_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Booking lifecycle: waitlist transitions and staff cancellation
-- ---------------------------------------------------------------------------

DROP TRIGGER bookings_allowed_transitions;

CREATE TRIGGER bookings_allowed_transitions
BEFORE UPDATE OF status ON bookings
WHEN OLD.status <> NEW.status
BEGIN
  SELECT RAISE(ABORT, 'INVALID_BOOKING_TRANSITION')
  WHERE NOT (
    (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled', 'waitlisted'))
    OR (OLD.status = 'waitlisted' AND NEW.status IN ('pending', 'rejected', 'cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('cancelled', 'checked_in'))
    OR (OLD.status = 'checked_in' AND NEW.status IN ('completed', 'incident'))
    OR (OLD.status = 'incident' AND NEW.status = 'completed')
  );

  SELECT RAISE(ABORT, 'CHECKOUT_REPORT_REQUIRED')
  WHERE OLD.status = 'checked_in'
    AND NEW.status IN ('completed', 'incident')
    AND NOT EXISTS (
      SELECT 1
      FROM condition_reports report
      WHERE report.booking_id = NEW.id
        AND report.stage = 'after'
    );

  SELECT RAISE(ABORT, 'INCIDENT_REPORT_REQUIRED')
  WHERE OLD.status = 'checked_in'
    AND NEW.status = 'incident'
    AND NOT EXISTS (
      SELECT 1
      FROM incidents incident
      WHERE incident.booking_id = NEW.id
        AND incident.status IN ('open', 'reviewing')
    );

  SELECT RAISE(ABORT, 'OPEN_INCIDENTS_REMAIN')
  WHERE OLD.status = 'incident'
    AND NEW.status = 'completed'
    AND EXISTS (
      SELECT 1
      FROM incidents incident
      WHERE incident.booking_id = NEW.id
        AND incident.status IN ('open', 'reviewing')
    );

  SELECT RAISE(ABORT, 'CHECKOUT_TIME_REQUIRED')
  WHERE OLD.status = 'checked_in'
    AND NEW.status IN ('completed', 'incident')
    AND NEW.checked_out_at IS NULL;

  SELECT RAISE(ABORT, 'CLOSE_TIME_REQUIRED')
  WHERE NEW.status = 'completed'
    AND NEW.closed_at IS NULL;

  SELECT RAISE(ABORT, 'WAITLIST_TIME_REQUIRED')
  WHERE NEW.status = 'waitlisted'
    AND NEW.waitlisted_at IS NULL;
END;

-- Cancellation may now be recorded by the requester, an active administrator,
-- or the active manager assigned to the room (for blackouts and room closures).
DROP TRIGGER bookings_cancellation_metadata_insert;
DROP TRIGGER bookings_cancellation_metadata_update;

CREATE TRIGGER bookings_cancellation_metadata_insert
BEFORE INSERT ON bookings
WHEN NEW.status = 'cancelled'
  AND (
    NEW.cancelled_by IS NULL
    OR NEW.cancelled_at IS NULL
    OR NEW.cancellation_reason IS NULL
    OR length(trim(NEW.cancellation_reason)) < 5
    OR (
      NEW.cancelled_by <> NEW.requester_id
      AND NOT EXISTS (
        SELECT 1
        FROM profiles p
        JOIN rooms r ON r.id = NEW.room_id
        WHERE p.id = NEW.cancelled_by
          AND p.status = 'active'
          AND (p.role = 'admin' OR (p.role = 'manager' AND r.manager_id = p.id))
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_CANCELLATION_METADATA');
END;

CREATE TRIGGER bookings_cancellation_metadata_update
BEFORE UPDATE OF status, cancelled_by, cancelled_at, cancellation_reason ON bookings
WHEN NEW.status = 'cancelled'
  AND OLD.status IN ('pending', 'approved', 'waitlisted')
  AND (
    NEW.cancelled_by IS NULL
    OR NEW.cancelled_at IS NULL
    OR NEW.cancellation_reason IS NULL
    OR length(trim(NEW.cancellation_reason)) < 5
    OR (
      NEW.cancelled_by <> NEW.requester_id
      AND NOT EXISTS (
        SELECT 1
        FROM profiles p
        JOIN rooms r ON r.id = NEW.room_id
        WHERE p.id = NEW.cancelled_by
          AND p.status = 'active'
          AND (p.role = 'admin' OR (p.role = 'manager' AND r.manager_id = p.id))
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_CANCELLATION_METADATA');
END;

-- An out-of-order approval must carry its explanation.
CREATE TRIGGER bookings_allocation_exception_metadata
BEFORE UPDATE OF allocation_exception_reason ON bookings
WHEN NEW.allocation_exception_reason IS NOT NULL
  AND length(trim(NEW.allocation_exception_reason)) < 20
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ALLOCATION_EXCEPTION');
END;
