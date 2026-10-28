-- RoomRelay Phase 5: check-out, condition reports, incident review, and close-out.

ALTER TABLE bookings ADD COLUMN checked_in_at TEXT;
ALTER TABLE bookings ADD COLUMN checked_out_at TEXT;
ALTER TABLE bookings ADD COLUMN closed_at TEXT;
ALTER TABLE bookings ADD COLUMN closure_reason TEXT;

ALTER TABLE condition_reports ADD COLUMN condition_state TEXT
  CHECK (
    condition_state IS NULL
    OR condition_state IN ('left_as_found', 'issue_found')
  );

ALTER TABLE incidents ADD COLUMN manager_reviewed_by TEXT
  REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE incidents ADD COLUMN manager_reviewed_at TEXT;
ALTER TABLE incidents ADD COLUMN manager_review_note TEXT;
ALTER TABLE incidents ADD COLUMN resolved_at TEXT;

CREATE INDEX incidents_status_created_idx
  ON incidents (status, created_at DESC);

CREATE INDEX incidents_booking_status_idx
  ON incidents (booking_id, status);

-- Backfill only from unambiguous existing evidence. Fixtures are otherwise
-- updated by the seed process.
UPDATE bookings
SET checked_in_at = (
  SELECT MIN(event.occurred_at)
  FROM access_events event
  WHERE event.booking_id = bookings.id
    AND event.result = 'allowed'
)
WHERE checked_in_at IS NULL
  AND status IN ('checked_in', 'completed');

UPDATE bookings
SET checked_out_at = (
  SELECT MAX(report.created_at)
  FROM condition_reports report
  WHERE report.booking_id = bookings.id
    AND report.stage = 'after'
)
WHERE checked_out_at IS NULL
  AND status = 'completed';

UPDATE bookings
SET
  closed_at = COALESCE(closed_at, checked_out_at),
  closure_reason = COALESCE(closure_reason, 'left_as_found')
WHERE status = 'completed';

UPDATE condition_reports
SET condition_state = 'left_as_found'
WHERE condition_state IS NULL;

CREATE UNIQUE INDEX condition_reports_booking_stage_idx
  ON condition_reports (booking_id, stage);

CREATE TRIGGER condition_reports_no_update
BEFORE UPDATE ON condition_reports
BEGIN
  SELECT RAISE(ABORT, 'condition_reports is append-only');
END;

CREATE TRIGGER condition_reports_no_delete
BEFORE DELETE ON condition_reports
BEGIN
  SELECT RAISE(ABORT, 'condition_reports is append-only');
END;

-- A resolved incident is immutable except for future append-only corrections.
CREATE TRIGGER incidents_resolved_no_update
BEFORE UPDATE ON incidents
WHEN OLD.status = 'resolved'
BEGIN
  SELECT RAISE(ABORT, 'resolved incidents are immutable');
END;

CREATE TRIGGER incidents_allowed_transitions
BEFORE UPDATE OF status ON incidents
WHEN OLD.status <> NEW.status
BEGIN
  SELECT RAISE(ABORT, 'INVALID_INCIDENT_TRANSITION')
  WHERE NOT (
    (OLD.status = 'open' AND NEW.status IN ('reviewing', 'resolved'))
    OR (OLD.status = 'reviewing' AND NEW.status = 'resolved')
  );

  SELECT RAISE(ABORT, 'INVALID_INCIDENT_REVIEW_METADATA')
  WHERE NEW.status = 'reviewing'
    AND (
      NEW.manager_reviewed_by IS NULL
      OR NEW.manager_reviewed_at IS NULL
      OR NEW.manager_review_note IS NULL
      OR length(trim(NEW.manager_review_note)) < 10
    );

  SELECT RAISE(ABORT, 'INVALID_INCIDENT_REVIEWER')
  WHERE NEW.status = 'reviewing'
    AND NOT EXISTS (
      SELECT 1
      FROM profiles p
      JOIN bookings b ON b.id = NEW.booking_id
      JOIN rooms r ON r.id = b.room_id
      WHERE p.id = NEW.manager_reviewed_by
        AND p.status = 'active'
        AND (
          p.role = 'admin'
          OR (p.role = 'manager' AND r.manager_id = p.id)
        )
    );

  SELECT RAISE(ABORT, 'INVALID_INCIDENT_RESOLUTION')
  WHERE NEW.status = 'resolved'
    AND (
      NEW.reviewer_id IS NULL
      OR NEW.resolved_at IS NULL
      OR NEW.resolution_note IS NULL
      OR length(trim(NEW.resolution_note)) < 10
      OR NOT EXISTS (
        SELECT 1
        FROM profiles p
        WHERE p.id = NEW.reviewer_id
          AND p.status = 'active'
          AND p.role = 'admin'
      )
    );
END;

DROP TRIGGER bookings_allowed_transitions;

CREATE TRIGGER bookings_allowed_transitions
BEFORE UPDATE OF status ON bookings
WHEN OLD.status <> NEW.status
BEGIN
  SELECT RAISE(ABORT, 'INVALID_BOOKING_TRANSITION')
  WHERE NOT (
    (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
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
END;
