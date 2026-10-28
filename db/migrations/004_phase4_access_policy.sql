-- RoomRelay Phase 4: time-bound access decisions and event context.

ALTER TABLE access_events ADD COLUMN actor_id TEXT
  REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE access_events ADD COLUMN booking_id TEXT
  REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE access_events ADD COLUMN reader_id TEXT;
ALTER TABLE access_events ADD COLUMN request_hash TEXT;

CREATE INDEX access_events_actor_time_idx
  ON access_events (actor_id, occurred_at DESC);

CREATE INDEX access_events_booking_time_idx
  ON access_events (booking_id, occurred_at DESC);

-- Preserve actor attribution for historical demo credential events where the
-- credential mapping is unambiguous.
UPDATE access_events
SET actor_id = (
  SELECT credentials.user_id
  FROM credentials
  WHERE credentials.id = access_events.credential_id
)
WHERE actor_id IS NULL
  AND credential_id IS NOT NULL;

UPDATE access_events
SET
  reader_id = COALESCE(reader_id, 'reader-simulator-01'),
  booking_id = CASE
    WHEN id = 'access_completed_allowed' THEN 'booking_completed_seminar'
    ELSE booking_id
  END
WHERE source = 'seed';

-- Phase 4 permits only a trusted successful access policy decision to check an
-- approved booking in. Other Phase 3 transitions remain unchanged.
DROP TRIGGER bookings_allowed_transitions;

CREATE TRIGGER bookings_allowed_transitions
BEFORE UPDATE OF status ON bookings
WHEN OLD.status <> NEW.status
BEGIN
  SELECT RAISE(ABORT, 'INVALID_BOOKING_TRANSITION')
  WHERE NOT (
    (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('cancelled', 'checked_in'))
  );
END;
