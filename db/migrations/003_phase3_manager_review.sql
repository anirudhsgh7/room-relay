-- RoomRelay Phase 3: manager decisions and requester cancellation.

ALTER TABLE bookings ADD COLUMN cancelled_by TEXT
  REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE bookings ADD COLUMN cancellation_reason TEXT;
ALTER TABLE bookings ADD COLUMN eligibility_override_reason TEXT;
ALTER TABLE bookings ADD COLUMN eligibility_override_requirement_ids_json TEXT
  CHECK (
    eligibility_override_requirement_ids_json IS NULL
    OR (
      json_valid(eligibility_override_requirement_ids_json)
      AND json_type(eligibility_override_requirement_ids_json) = 'array'
    )
  );

-- Historical seeded cancellations must remain readable after the new metadata
-- rules are enabled. This is fixture backfill, not a synthetic live decision.
UPDATE bookings
SET
  cancelled_by = requester_id,
  cancelled_at = COALESCE(updated_at, created_at),
  cancellation_reason = COALESCE(
    NULLIF(decision_reason, ''),
    'Historical demo cancellation.'
  )
WHERE status = 'cancelled'
  AND cancelled_at IS NULL;

CREATE INDEX bookings_room_status_created_idx
  ON bookings (room_id, status, created_at);

CREATE INDEX bookings_room_status_time_idx
  ON bookings (room_id, status, start_at, end_at);

CREATE INDEX bookings_cancelled_by_idx
  ON bookings (cancelled_by, cancelled_at);

CREATE INDEX audit_events_booking_idx
  ON audit_events (entity_type, entity_id, occurred_at);

-- Decision metadata must identify an active manager assigned to the room or an
-- active administrator. The service still provides friendly validation errors.
CREATE TRIGGER bookings_decision_metadata_insert
BEFORE INSERT ON bookings
WHEN NEW.status IN ('approved', 'rejected')
  AND (
    NEW.decided_by IS NULL
    OR NEW.decided_at IS NULL
    OR NEW.decision_reason IS NULL
    OR length(trim(NEW.decision_reason)) < 10
    OR NOT EXISTS (
      SELECT 1
      FROM profiles p
      JOIN rooms r ON r.id = NEW.room_id
      WHERE p.id = NEW.decided_by
        AND p.status = 'active'
        AND (
          p.role = 'admin'
          OR (p.role = 'manager' AND r.manager_id = p.id)
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_DECISION_METADATA');
END;

CREATE TRIGGER bookings_decision_metadata_update
BEFORE UPDATE OF status, decided_by, decided_at, decision_reason ON bookings
WHEN NEW.status IN ('approved', 'rejected')
  AND (
    NEW.decided_by IS NULL
    OR NEW.decided_at IS NULL
    OR NEW.decision_reason IS NULL
    OR length(trim(NEW.decision_reason)) < 10
    OR NOT EXISTS (
      SELECT 1
      FROM profiles p
      JOIN rooms r ON r.id = NEW.room_id
      WHERE p.id = NEW.decided_by
        AND p.status = 'active'
        AND (
          p.role = 'admin'
          OR (p.role = 'manager' AND r.manager_id = p.id)
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_DECISION_METADATA');
END;

-- Cancellation metadata is requester-owned in Phase 3. Approved decision
-- metadata is preserved when an approved booking is later cancelled.
CREATE TRIGGER bookings_cancellation_metadata_insert
BEFORE INSERT ON bookings
WHEN NEW.status = 'cancelled'
  AND (
    NEW.cancelled_by IS NULL
    OR NEW.cancelled_at IS NULL
    OR NEW.cancellation_reason IS NULL
    OR length(trim(NEW.cancellation_reason)) < 5
    OR NEW.cancelled_by <> NEW.requester_id
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_CANCELLATION_METADATA');
END;

CREATE TRIGGER bookings_cancellation_metadata_update
BEFORE UPDATE OF status, cancelled_by, cancelled_at, cancellation_reason ON bookings
WHEN NEW.status = 'cancelled'
  AND OLD.status IN ('pending', 'approved')
  AND (
    NEW.cancelled_by IS NULL
    OR NEW.cancelled_at IS NULL
    OR NEW.cancellation_reason IS NULL
    OR length(trim(NEW.cancellation_reason)) < 5
    OR NEW.cancelled_by <> NEW.requester_id
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_CANCELLATION_METADATA');
END;

CREATE TRIGGER bookings_override_metadata_insert
BEFORE INSERT ON bookings
WHEN (
  NEW.eligibility_override_reason IS NULL
  AND NEW.eligibility_override_requirement_ids_json IS NOT NULL
)
OR (
  NEW.eligibility_override_reason IS NOT NULL
  AND (
    NEW.eligibility_override_requirement_ids_json IS NULL
    OR length(trim(NEW.eligibility_override_reason)) < 20
    OR json_type(NEW.eligibility_override_requirement_ids_json) <> 'array'
    OR json_array_length(NEW.eligibility_override_requirement_ids_json) < 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ELIGIBILITY_OVERRIDE_METADATA');
END;

CREATE TRIGGER bookings_override_metadata_update
BEFORE UPDATE OF eligibility_override_reason, eligibility_override_requirement_ids_json ON bookings
WHEN (
  NEW.eligibility_override_reason IS NULL
  AND NEW.eligibility_override_requirement_ids_json IS NOT NULL
)
OR (
  NEW.eligibility_override_reason IS NOT NULL
  AND (
    NEW.eligibility_override_requirement_ids_json IS NULL
    OR length(trim(NEW.eligibility_override_reason)) < 20
    OR json_type(NEW.eligibility_override_requirement_ids_json) <> 'array'
    OR json_array_length(NEW.eligibility_override_requirement_ids_json) < 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ELIGIBILITY_OVERRIDE_METADATA');
END;

CREATE TRIGGER bookings_allowed_transitions
BEFORE UPDATE OF status ON bookings
WHEN OLD.status <> NEW.status
BEGIN
  SELECT RAISE(ABORT, 'INVALID_BOOKING_TRANSITION')
  WHERE NOT (
    (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
    OR (OLD.status = 'approved' AND NEW.status = 'cancelled')
  );
END;
