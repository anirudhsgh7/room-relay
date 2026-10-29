-- RoomRelay Postgres schema (Neon).
--
-- Timestamps are timestamptz so comparisons are safe across ISO-8601
-- representations. JSON-shaped fields are jsonb; the application reads them as
-- text and performs its own validation. Booking, incident, and audit invariants
-- are enforced by triggers as well as the service layer.

CREATE TABLE IF NOT EXISTS profiles (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  display_name  text NOT NULL CHECK (length(btrim(display_name)) > 0),
  role          text NOT NULL CHECK (role IN ('student', 'manager', 'admin')),
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended')),
  password_hash text NOT NULL CHECK (length(password_hash) > 0),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_idx
  ON profiles (lower(email));

CREATE TABLE IF NOT EXISTS rooms (
  id              text PRIMARY KEY,
  code            text NOT NULL,
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  building        text NOT NULL CHECK (length(btrim(building)) > 0),
  location        text NOT NULL CHECK (length(btrim(location)) > 0),
  capacity        integer NOT NULL CHECK (capacity > 0),
  facilities      jsonb NOT NULL DEFAULT '[]'::jsonb
                  CHECK (jsonb_typeof(facilities) = 'array'),
  policy_summary  text NOT NULL DEFAULT '',
  manager_id      text NOT NULL REFERENCES profiles(id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive')),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_code_lower_idx
  ON rooms (lower(code));

CREATE TABLE IF NOT EXISTS availability_rules (
  id              text PRIMARY KEY,
  room_id         text NOT NULL REFERENCES rooms(id)
                  ON UPDATE CASCADE ON DELETE CASCADE,
  weekday         integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at        text NOT NULL
                  CHECK (opens_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  closes_at       text NOT NULL
                  CHECK (closes_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  effective_from  text NOT NULL,
  effective_until text,
  active          integer NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  CHECK (opens_at < closes_at),
  CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS availability_rules_room_window_idx
  ON availability_rules (room_id, weekday, opens_at, closes_at, effective_from);

CREATE TABLE IF NOT EXISTS eligibility_requirements (
  id               text PRIMARY KEY,
  room_id          text NOT NULL REFERENCES rooms(id)
                   ON UPDATE CASCADE ON DELETE CASCADE,
  requirement_type text NOT NULL CHECK (length(btrim(requirement_type)) > 0),
  description      text NOT NULL CHECK (length(btrim(description)) > 0),
  required         integer NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  active           integer NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS room_booking_policies (
  room_id                 text PRIMARY KEY REFERENCES rooms(id)
                          ON UPDATE CASCADE ON DELETE CASCADE,
  requests_enabled        integer NOT NULL DEFAULT 1 CHECK (requests_enabled IN (0, 1)),
  slot_interval_minutes   integer NOT NULL DEFAULT 30
                          CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  minimum_notice_minutes  integer NOT NULL DEFAULT 30
                          CHECK (minimum_notice_minutes BETWEEN 0 AND 10080),
  maximum_duration_minutes integer NOT NULL DEFAULT 240
                          CHECK (maximum_duration_minutes BETWEEN 15 AND 1440),
  buffer_minutes          integer NOT NULL DEFAULT 0
                          CHECK (buffer_minutes BETWEEN 0 AND 240),
  max_advance_days        integer NOT NULL DEFAULT 60
                          CHECK (max_advance_days BETWEEN 1 AND 365),
  max_active_per_requester integer NOT NULL DEFAULT 0
                          CHECK (max_active_per_requester BETWEEN 0 AND 50),
  allocation_rule         text NOT NULL DEFAULT 'first_come'
                          CHECK (allocation_rule IN ('first_come', 'best_fit', 'fair_share')),
  waitlist_enabled        integer NOT NULL DEFAULT 1 CHECK (waitlist_enabled IN (0, 1)),
  updated_at              timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_eligibility (
  id             text PRIMARY KEY,
  profile_id     text NOT NULL REFERENCES profiles(id)
                 ON UPDATE CASCADE ON DELETE CASCADE,
  requirement_id text NOT NULL REFERENCES eligibility_requirements(id)
                 ON UPDATE CASCADE ON DELETE CASCADE,
  status         text NOT NULL CHECK (status IN ('verified', 'unverified', 'expired')),
  verified_by    text REFERENCES profiles(id)
                 ON UPDATE CASCADE ON DELETE RESTRICT,
  verified_at    timestamptz,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  UNIQUE (profile_id, requirement_id),
  CHECK (
    status <> 'verified'
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CHECK (expires_at IS NULL OR verified_at IS NULL OR expires_at > verified_at)
);

CREATE INDEX IF NOT EXISTS profile_eligibility_profile_idx
  ON profile_eligibility (profile_id, requirement_id);

CREATE TABLE IF NOT EXISTS bookings (
  id                  text PRIMARY KEY,
  room_id             text NOT NULL REFERENCES rooms(id)
                      ON UPDATE CASCADE ON DELETE RESTRICT,
  requester_id        text NOT NULL REFERENCES profiles(id)
                      ON UPDATE CASCADE ON DELETE RESTRICT,
  purpose             text NOT NULL CHECK (length(btrim(purpose)) > 0),
  group_name          text,
  expected_attendance integer NOT NULL CHECK (expected_attendance > 0),
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  status              text NOT NULL CHECK (
                        status IN (
                          'draft', 'pending', 'approved', 'rejected', 'waitlisted',
                          'checked_in', 'completed', 'cancelled', 'no_show', 'incident'
                        )
                      ),
  decision_reason     text,
  decided_by          text REFERENCES profiles(id)
                      ON UPDATE CASCADE ON DELETE RESTRICT,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  submission_key      text,
  request_payload_hash text,
  eligibility_snapshot_json jsonb
                      CHECK (eligibility_snapshot_json IS NULL OR jsonb_typeof(eligibility_snapshot_json) = 'array'),
  cancelled_by        text REFERENCES profiles(id)
                      ON UPDATE CASCADE ON DELETE RESTRICT,
  cancelled_at        timestamptz,
  cancellation_reason text,
  eligibility_override_reason text,
  eligibility_override_requirement_ids_json jsonb
                      CHECK (
                        eligibility_override_requirement_ids_json IS NULL
                        OR jsonb_typeof(eligibility_override_requirement_ids_json) = 'array'
                      ),
  checked_in_at       timestamptz,
  checked_out_at      timestamptz,
  closed_at           timestamptz,
  closure_reason      text,
  allocation_exception_reason text,
  waitlisted_at       timestamptz,
  promoted_at         timestamptz,
  CHECK (end_at > start_at),
  CHECK (
    status <> 'rejected'
    OR (decision_reason IS NOT NULL AND length(btrim(decision_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS bookings_room_window_idx
  ON bookings (room_id, start_at, end_at, status);
CREATE INDEX IF NOT EXISTS bookings_requester_idx
  ON bookings (requester_id, start_at DESC);
CREATE INDEX IF NOT EXISTS bookings_room_status_created_idx
  ON bookings (room_id, status, created_at);
CREATE INDEX IF NOT EXISTS bookings_room_status_time_idx
  ON bookings (room_id, status, start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_cancelled_by_idx
  ON bookings (cancelled_by, cancelled_at);
CREATE INDEX IF NOT EXISTS bookings_requester_status_time_idx
  ON bookings (requester_id, status, start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_room_waitlist_idx
  ON bookings (room_id, status, start_at, end_at)
  WHERE status IN ('pending', 'waitlisted');
CREATE UNIQUE INDEX IF NOT EXISTS bookings_requester_submission_key_idx
  ON bookings (requester_id, submission_key)
  WHERE submission_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS credentials (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES profiles(id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  credential_ref  text NOT NULL,
  credential_type text NOT NULL CHECK (credential_type IN ('nfc_uid', 'demo_token')),
  active          integer NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  CHECK (
    (active = 1 AND revoked_at IS NULL)
    OR (active = 0 AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS credentials_ref_lower_idx
  ON credentials (lower(credential_ref));
CREATE INDEX IF NOT EXISTS credentials_user_idx ON credentials (user_id, active);

CREATE TABLE IF NOT EXISTS access_events (
  id                       text PRIMARY KEY,
  credential_id            text REFERENCES credentials(id)
                           ON UPDATE CASCADE ON DELETE RESTRICT,
  attempted_credential_ref text NOT NULL CHECK (length(btrim(attempted_credential_ref)) > 0),
  room_id                  text NOT NULL REFERENCES rooms(id)
                           ON UPDATE CASCADE ON DELETE RESTRICT,
  occurred_at              timestamptz NOT NULL,
  result                   text NOT NULL CHECK (result IN ('allowed', 'denied')),
  reason_code              text NOT NULL CHECK (length(btrim(reason_code)) > 0),
  source                   text NOT NULL CHECK (source IN ('simulator', 'reader', 'seed')),
  correlation_id           text NOT NULL UNIQUE,
  created_at               timestamptz NOT NULL,
  actor_id                 text REFERENCES profiles(id)
                           ON UPDATE CASCADE ON DELETE RESTRICT,
  booking_id               text REFERENCES bookings(id)
                           ON UPDATE CASCADE ON DELETE RESTRICT,
  reader_id                text,
  request_hash             text
);

CREATE INDEX IF NOT EXISTS access_events_room_time_idx
  ON access_events (room_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_events_credential_time_idx
  ON access_events (credential_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_events_actor_time_idx
  ON access_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_events_booking_time_idx
  ON access_events (booking_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id             text PRIMARY KEY,
  actor_id       text REFERENCES profiles(id)
                 ON UPDATE CASCADE ON DELETE RESTRICT,
  action         text NOT NULL CHECK (length(btrim(action)) > 0),
  entity_type    text NOT NULL CHECK (length(btrim(entity_type)) > 0),
  entity_id      text NOT NULL CHECK (length(btrim(entity_id)) > 0),
  occurred_at    timestamptz NOT NULL,
  summary        text NOT NULL CHECK (length(btrim(summary)) > 0),
  correlation_id text NOT NULL,
  metadata_json  jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx
  ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_booking_idx
  ON audit_events (entity_type, entity_id, occurred_at);

CREATE TABLE IF NOT EXISTS condition_reports (
  id              text PRIMARY KEY,
  booking_id      text NOT NULL REFERENCES bookings(id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  stage           text NOT NULL CHECK (stage IN ('before', 'after')),
  condition_state text CHECK (
                    condition_state IS NULL
                    OR condition_state IN ('left_as_found', 'issue_found')
                  ),
  notes           text NOT NULL CHECK (length(btrim(notes)) > 0),
  submitted_by    text NOT NULL REFERENCES profiles(id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS condition_reports_booking_idx
  ON condition_reports (booking_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS condition_reports_booking_stage_idx
  ON condition_reports (booking_id, stage);

CREATE TABLE IF NOT EXISTS incidents (
  id              text PRIMARY KEY,
  booking_id      text NOT NULL REFERENCES bookings(id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  category        text NOT NULL CHECK (category IN ('damage', 'cleanliness', 'equipment', 'safety', 'overstay', 'other')),
  description     text NOT NULL CHECK (length(btrim(description)) > 0),
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'reviewing', 'resolved')),
  reporter_id     text NOT NULL REFERENCES profiles(id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  reviewer_id     text REFERENCES profiles(id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  resolution_note text,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  manager_reviewed_by text REFERENCES profiles(id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  manager_reviewed_at timestamptz,
  manager_review_note text,
  resolved_at     timestamptz,
  CHECK (
    status <> 'resolved'
    OR (reviewer_id IS NOT NULL AND resolution_note IS NOT NULL AND length(btrim(resolution_note)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS incidents_booking_idx ON incidents (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_status_created_idx ON incidents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_booking_status_idx ON incidents (booking_id, status);

CREATE TABLE IF NOT EXISTS room_blackouts (
  id         text PRIMARY KEY,
  room_id    text NOT NULL REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  reason     text NOT NULL CHECK (length(btrim(reason)) >= 5),
  created_by text NOT NULL REFERENCES profiles(id)
             ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  removed_at timestamptz,
  removed_by text REFERENCES profiles(id)
             ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (ends_at > starts_at),
  CHECK (
    (removed_at IS NULL AND removed_by IS NULL)
    OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS room_blackouts_room_window_idx
  ON room_blackouts (room_id, starts_at, ends_at)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id           text PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES profiles(id)
               ON UPDATE CASCADE ON DELETE CASCADE,
  kind         text NOT NULL CHECK (length(btrim(kind)) > 0),
  title        text NOT NULL CHECK (length(btrim(title)) > 0),
  body         text NOT NULL CHECK (length(btrim(body)) > 0),
  link_path    text CHECK (link_path IS NULL OR link_path LIKE '/app%'),
  booking_id   text REFERENCES bookings(id)
               ON UPDATE CASCADE ON DELETE CASCADE,
  dedupe_key   text,
  created_at   timestamptz NOT NULL,
  read_at      timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications (recipient_id, read_at, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_dedupe_idx
  ON notifications (recipient_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Room ownership
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roomrelay_room_manager_must_be_manager()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = NEW.manager_id) IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'A room manager must have the manager role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rooms_manager_must_be_manager_insert
BEFORE INSERT ON rooms
FOR EACH ROW EXECUTE FUNCTION roomrelay_room_manager_must_be_manager();

CREATE TRIGGER rooms_manager_must_be_manager_update
BEFORE UPDATE OF manager_id ON rooms
FOR EACH ROW EXECUTE FUNCTION roomrelay_room_manager_must_be_manager();

-- ---------------------------------------------------------------------------
-- Confirmed booking overlap, including the current room buffer.
-- The service layer also locks the room row before approvals so two concurrent
-- approvals cannot both pass the pre-check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roomrelay_confirmed_booking_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('approved', 'checked_in') AND EXISTS (
    SELECT 1
    FROM bookings existing
    LEFT JOIN room_booking_policies policy ON policy.room_id = existing.room_id
    WHERE existing.room_id = NEW.room_id
      AND existing.id <> NEW.id
      AND existing.status IN ('approved', 'checked_in')
      AND existing.start_at < NEW.end_at + (COALESCE(policy.buffer_minutes, 0) * interval '1 minute')
      AND existing.end_at + (COALESCE(policy.buffer_minutes, 0) * interval '1 minute') > NEW.start_at
  ) THEN
    RAISE EXCEPTION 'CONFIRMED_BOOKING_OVERLAP';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_confirmed_no_overlap_insert
BEFORE INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_confirmed_booking_no_overlap();

CREATE TRIGGER bookings_confirmed_no_overlap_update
BEFORE UPDATE OF status, room_id, start_at, end_at ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_confirmed_booking_no_overlap();

-- ---------------------------------------------------------------------------
-- Booking decisions, cancellations, and eligibility overrides.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roomrelay_booking_decision_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') THEN
    IF NEW.decided_by IS NULL
      OR NEW.decided_at IS NULL
      OR NEW.decision_reason IS NULL
      OR length(btrim(NEW.decision_reason)) < 10
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
    THEN
      RAISE EXCEPTION 'INVALID_DECISION_METADATA';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_decision_metadata_insert
BEFORE INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_decision_metadata();

CREATE TRIGGER bookings_decision_metadata_update
BEFORE UPDATE OF status, decided_by, decided_at, decision_reason ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_decision_metadata();

CREATE OR REPLACE FUNCTION roomrelay_booking_cancellation_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'cancelled'
    AND (TG_OP = 'INSERT' OR OLD.status IN ('pending', 'approved', 'waitlisted'))
  THEN
    IF NEW.cancelled_by IS NULL
      OR NEW.cancelled_at IS NULL
      OR NEW.cancellation_reason IS NULL
      OR length(btrim(NEW.cancellation_reason)) < 5
      OR NOT (
        NEW.cancelled_by = NEW.requester_id
        OR EXISTS (
          SELECT 1
          FROM profiles p
          JOIN rooms r ON r.id = NEW.room_id
          WHERE p.id = NEW.cancelled_by
            AND p.status = 'active'
            AND (p.role = 'admin' OR (p.role = 'manager' AND r.manager_id = p.id))
        )
      )
    THEN
      RAISE EXCEPTION 'INVALID_CANCELLATION_METADATA';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_cancellation_metadata_insert
BEFORE INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_cancellation_metadata();

CREATE TRIGGER bookings_cancellation_metadata_update
BEFORE UPDATE OF status, cancelled_by, cancelled_at, cancellation_reason ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_cancellation_metadata();

CREATE OR REPLACE FUNCTION roomrelay_booking_override_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.eligibility_override_reason IS NULL
    AND NEW.eligibility_override_requirement_ids_json IS NOT NULL
  ) OR (
    NEW.eligibility_override_reason IS NOT NULL
    AND (
      NEW.eligibility_override_requirement_ids_json IS NULL
      OR length(btrim(NEW.eligibility_override_reason)) < 20
      OR jsonb_typeof(NEW.eligibility_override_requirement_ids_json) <> 'array'
      OR jsonb_array_length(NEW.eligibility_override_requirement_ids_json) < 1
    )
  ) THEN
    RAISE EXCEPTION 'INVALID_ELIGIBILITY_OVERRIDE_METADATA';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_override_metadata_insert
BEFORE INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_override_metadata();

CREATE TRIGGER bookings_override_metadata_update
BEFORE UPDATE OF eligibility_override_reason, eligibility_override_requirement_ids_json ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_override_metadata();

CREATE OR REPLACE FUNCTION roomrelay_booking_allocation_exception()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.allocation_exception_reason IS NOT NULL
    AND length(btrim(NEW.allocation_exception_reason)) < 20
  THEN
    RAISE EXCEPTION 'INVALID_ALLOCATION_EXCEPTION';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_allocation_exception_metadata
BEFORE UPDATE OF allocation_exception_reason ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_allocation_exception();

-- ---------------------------------------------------------------------------
-- Booking state machine and close-out checks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roomrelay_booking_allowed_transitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status THEN
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled', 'waitlisted'))
      OR (OLD.status = 'waitlisted' AND NEW.status IN ('pending', 'rejected', 'cancelled'))
      OR (OLD.status = 'approved' AND NEW.status IN ('cancelled', 'checked_in'))
      OR (OLD.status = 'checked_in' AND NEW.status IN ('completed', 'incident'))
      OR (OLD.status = 'incident' AND NEW.status = 'completed')
    ) THEN
      RAISE EXCEPTION 'INVALID_BOOKING_TRANSITION';
    END IF;

    IF OLD.status = 'checked_in'
      AND NEW.status IN ('completed', 'incident')
      AND NOT EXISTS (
        SELECT 1 FROM condition_reports report
        WHERE report.booking_id = NEW.id AND report.stage = 'after'
      )
    THEN
      RAISE EXCEPTION 'CHECKOUT_REPORT_REQUIRED';
    END IF;

    IF OLD.status = 'checked_in'
      AND NEW.status = 'incident'
      AND NOT EXISTS (
        SELECT 1 FROM incidents incident
        WHERE incident.booking_id = NEW.id
          AND incident.status IN ('open', 'reviewing')
      )
    THEN
      RAISE EXCEPTION 'INCIDENT_REPORT_REQUIRED';
    END IF;

    IF OLD.status = 'incident'
      AND NEW.status = 'completed'
      AND EXISTS (
        SELECT 1 FROM incidents incident
        WHERE incident.booking_id = NEW.id
          AND incident.status IN ('open', 'reviewing')
      )
    THEN
      RAISE EXCEPTION 'OPEN_INCIDENTS_REMAIN';
    END IF;

    IF OLD.status = 'checked_in'
      AND NEW.status IN ('completed', 'incident')
      AND NEW.checked_out_at IS NULL
    THEN
      RAISE EXCEPTION 'CHECKOUT_TIME_REQUIRED';
    END IF;

    IF NEW.status = 'completed' AND NEW.closed_at IS NULL THEN
      RAISE EXCEPTION 'CLOSE_TIME_REQUIRED';
    END IF;

    IF NEW.status = 'waitlisted' AND NEW.waitlisted_at IS NULL THEN
      RAISE EXCEPTION 'WAITLIST_TIME_REQUIRED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_allowed_transitions
BEFORE UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_allowed_transitions();

CREATE OR REPLACE FUNCTION roomrelay_booking_no_approval_in_blackout()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'approved'
    AND (TG_OP = 'INSERT' OR OLD.status <> 'approved')
    AND EXISTS (
      SELECT 1
      FROM room_blackouts blackout
      WHERE blackout.room_id = NEW.room_id
        AND blackout.removed_at IS NULL
        AND blackout.starts_at < NEW.end_at
        AND blackout.ends_at > NEW.start_at
    )
  THEN
    RAISE EXCEPTION 'ROOM_BLACKOUT';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_no_approval_in_blackout_insert
BEFORE INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_no_approval_in_blackout();

CREATE TRIGGER bookings_no_approval_in_blackout_update
BEFORE UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION roomrelay_booking_no_approval_in_blackout();

-- ---------------------------------------------------------------------------
-- Incidents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roomrelay_incident_transitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status THEN
    IF NOT (
      (OLD.status = 'open' AND NEW.status IN ('reviewing', 'resolved'))
      OR (OLD.status = 'reviewing' AND NEW.status = 'resolved')
    ) THEN
      RAISE EXCEPTION 'INVALID_INCIDENT_TRANSITION';
    END IF;

    IF NEW.status = 'reviewing' THEN
      IF NEW.manager_reviewed_by IS NULL
        OR NEW.manager_reviewed_at IS NULL
        OR NEW.manager_review_note IS NULL
        OR length(btrim(NEW.manager_review_note)) < 10
      THEN
        RAISE EXCEPTION 'INVALID_INCIDENT_REVIEW_METADATA';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM profiles p
        JOIN bookings b ON b.id = NEW.booking_id
        JOIN rooms r ON r.id = b.room_id
        WHERE p.id = NEW.manager_reviewed_by
          AND p.status = 'active'
          AND (p.role = 'admin' OR (p.role = 'manager' AND r.manager_id = p.id))
      ) THEN
        RAISE EXCEPTION 'INVALID_INCIDENT_REVIEWER';
      END IF;
    END IF;

    IF NEW.status = 'resolved' THEN
      IF NEW.reviewer_id IS NULL
        OR NEW.resolved_at IS NULL
        OR NEW.resolution_note IS NULL
        OR length(btrim(NEW.resolution_note)) < 10
        OR NOT EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = NEW.reviewer_id AND p.status = 'active' AND p.role = 'admin'
        )
      THEN
        RAISE EXCEPTION 'INVALID_INCIDENT_RESOLUTION';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER incidents_allowed_transitions
BEFORE UPDATE OF status ON incidents
FOR EACH ROW EXECUTE FUNCTION roomrelay_incident_transitions();

CREATE OR REPLACE FUNCTION roomrelay_incidents_resolved_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'resolved incidents are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER incidents_resolved_no_update
BEFORE UPDATE ON incidents
FOR EACH ROW EXECUTE FUNCTION roomrelay_incidents_resolved_immutable();

-- ---------------------------------------------------------------------------
-- Closures.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roomrelay_blackout_removed_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'removed blackouts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER room_blackouts_removed_immutable
BEFORE UPDATE ON room_blackouts
FOR EACH ROW EXECUTE FUNCTION roomrelay_blackout_removed_immutable();

CREATE OR REPLACE FUNCTION roomrelay_blackout_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'blackouts are removed, not deleted';
END;
$$;

CREATE TRIGGER room_blackouts_no_delete
BEFORE DELETE ON room_blackouts
FOR EACH ROW EXECUTE FUNCTION roomrelay_blackout_no_delete();

-- ---------------------------------------------------------------------------
-- Append-only history.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roomrelay_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER access_events_no_update
BEFORE UPDATE ON access_events
FOR EACH ROW EXECUTE FUNCTION roomrelay_append_only();

CREATE TRIGGER access_events_no_delete
BEFORE DELETE ON access_events
FOR EACH ROW EXECUTE FUNCTION roomrelay_append_only();

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION roomrelay_append_only();

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION roomrelay_append_only();

CREATE TRIGGER condition_reports_no_update
BEFORE UPDATE ON condition_reports
FOR EACH ROW EXECUTE FUNCTION roomrelay_append_only();

CREATE TRIGGER condition_reports_no_delete
BEFORE DELETE ON condition_reports
FOR EACH ROW EXECUTE FUNCTION roomrelay_append_only();
