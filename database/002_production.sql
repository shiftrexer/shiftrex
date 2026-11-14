-- SHIFTREX production additions. Run 001_initial_schema.sql first.
PRAGMA foreign_keys = ON;
ALTER TABLE staff_accounts ADD COLUMN password_salt TEXT;
ALTER TABLE staff_accounts ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_type TEXT NOT NULL CHECK (user_type IN ('staff','member')),
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_throttles (
  email TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  pkce_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  invite_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 1-on-1 gym: each half-hour block can belong to at most one confirmed booking.
-- A 60 minute session acquires two blocks inside the same SQLite transaction.
CREATE TABLE IF NOT EXISTS booking_locks (
  block_start TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES booking_requests(id)
);

-- Each confirmed booking must consume one valid ticket. A failed lock or ticket
-- condition aborts the entire booking transaction atomically.
CREATE TRIGGER IF NOT EXISTS booking_confirm_insert
AFTER INSERT ON booking_requests
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT CASE WHEN NEW.ticket_id IS NULL THEN RAISE(ABORT,'ticket_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tickets t JOIN booking_slots s ON s.id=NEW.slot_id
    WHERE t.id=NEW.ticket_id AND t.member_id=NEW.member_id
      AND t.disabled_at IS NULL AND t.available_count>0
      AND substr(s.starts_at,1,10)>=t.valid_from
      AND (t.expires_on IS NULL OR substr(s.starts_at,1,10)<=t.expires_on)
  ) THEN RAISE(ABORT,'ticket_invalid_or_expired') END;
  UPDATE tickets SET available_count=available_count-1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.ticket_id;
  INSERT INTO booking_locks (block_start,booking_id)
    VALUES ((SELECT substr(starts_at,1,16) FROM booking_slots WHERE id=NEW.slot_id), NEW.id);
  INSERT INTO booking_locks (block_start,booking_id)
    VALUES ((SELECT strftime('%Y-%m-%dT%H:%M',starts_at,'+30 minutes') FROM booking_slots WHERE id=NEW.slot_id), NEW.id);
  INSERT INTO ticket_events(id,ticket_id,booking_id,amount_delta,reason,created_by,created_at)
    VALUES(lower(hex(randomblob(16))),NEW.ticket_id,NEW.id,-1,'booking_confirmed','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER IF NOT EXISTS booking_confirm_update
AFTER UPDATE OF status ON booking_requests
WHEN NEW.status='confirmed' AND OLD.status='pending'
BEGIN
  SELECT CASE WHEN NEW.ticket_id IS NULL THEN RAISE(ABORT,'ticket_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tickets t JOIN booking_slots s ON s.id=NEW.slot_id
    WHERE t.id=NEW.ticket_id AND t.member_id=NEW.member_id
      AND t.disabled_at IS NULL AND t.available_count>0
      AND substr(s.starts_at,1,10)>=t.valid_from
      AND (t.expires_on IS NULL OR substr(s.starts_at,1,10)<=t.expires_on)
  ) THEN RAISE(ABORT,'ticket_invalid_or_expired') END;
  UPDATE tickets SET available_count=available_count-1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.ticket_id;
  INSERT INTO booking_locks (block_start,booking_id)
    VALUES ((SELECT substr(starts_at,1,16) FROM booking_slots WHERE id=NEW.slot_id), NEW.id);
  INSERT INTO booking_locks (block_start,booking_id)
    VALUES ((SELECT strftime('%Y-%m-%dT%H:%M',starts_at,'+30 minutes') FROM booking_slots WHERE id=NEW.slot_id), NEW.id);
  INSERT INTO ticket_events(id,ticket_id,booking_id,amount_delta,reason,created_by,created_at)
    VALUES(lower(hex(randomblob(16))),NEW.ticket_id,NEW.id,-1,'booking_approved','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER IF NOT EXISTS booking_release_locks
AFTER UPDATE OF status ON booking_requests
WHEN OLD.status IN ('confirmed','done','absent') AND NEW.status IN ('canceled','declined')
BEGIN
  DELETE FROM booking_locks WHERE booking_id=NEW.id;
END;

-- Prevent members from having pending applications beyond the balance of
-- currently valid tickets. Pending requests do not consume tickets.
CREATE TRIGGER IF NOT EXISTS pending_ticket_limit
BEFORE INSERT ON booking_requests
WHEN NEW.status='pending'
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM booking_requests r
    WHERE r.member_id=NEW.member_id AND r.status='pending'
  ) >= COALESCE((
    SELECT SUM(t.available_count) FROM tickets t JOIN booking_slots s ON s.id=NEW.slot_id
    WHERE t.member_id=NEW.member_id AND t.disabled_at IS NULL
      AND s.starts_at IS NOT NULL AND substr(s.starts_at,1,10)>=t.valid_from
      AND (t.expires_on IS NULL OR substr(s.starts_at,1,10)<=t.expires_on)
  ),0) THEN RAISE(ABORT,'pending_ticket_limit') END;
END;

-- Exactly-once cancellation: no duplicated ticket refunds if requests race.
CREATE TABLE IF NOT EXISTS booking_cancellations (
  booking_id TEXT PRIMARY KEY REFERENCES booking_requests(id),
  return_ticket INTEGER NOT NULL CHECK (return_ticket IN (0,1)),
  canceled_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS booking_cancel_once
AFTER INSERT ON booking_cancellations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM booking_requests WHERE id=NEW.booking_id AND status='confirmed'
  ) THEN RAISE(ABORT,'already_canceled') END;
  UPDATE booking_requests SET status='canceled',updated_at=NEW.created_at
    WHERE id=NEW.booking_id AND status='confirmed';
  UPDATE tickets SET available_count=available_count+1,updated_at=NEW.created_at
    WHERE id=(SELECT ticket_id FROM booking_requests WHERE id=NEW.booking_id)
      AND NEW.return_ticket=1;
  INSERT INTO ticket_events(id,ticket_id,booking_id,amount_delta,reason,created_by,created_at)
    SELECT lower(hex(randomblob(16))),ticket_id,NEW.booking_id,1,'booking_canceled',NEW.canceled_by,NEW.created_at
    FROM booking_requests WHERE id=NEW.booking_id AND NEW.return_ticket=1 AND ticket_id IS NOT NULL;
END;
