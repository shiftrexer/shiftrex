-- SHIFTREX D1 schema blueprint (not deployed, not used by the demo interface).
-- Do not store production credentials in source control.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  name_kana TEXT NOT NULL DEFAULT '',
  phone TEXT,
  email TEXT,
  birth_date TEXT,
  joined_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','left')),
  leave_on TEXT,
  paused_from TEXT,
  paused_through TEXT,
  line_subject TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_invites (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  token_sha256 TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  auth_provider_user_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_permission_overrides (
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
  PRIMARY KEY(staff_id, permission)
);

CREATE TABLE IF NOT EXISTS staff_invites (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  token_sha256 TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operating_rules (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  opens_at TEXT,
  closes_at TEXT,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1))
);

CREATE TABLE IF NOT EXISTS operating_overrides (
  work_date TEXT PRIMARY KEY,
  opens_at TEXT,
  closes_at TEXT,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1))
);

CREATE TABLE IF NOT EXISTS published_months (
  month_key TEXT PRIMARY KEY,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_slots (
  id TEXT PRIMARY KEY,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('instant','approval')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  staff_id TEXT REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(starts_at, staff_id)
);

CREATE INDEX IF NOT EXISTS booking_slots_start_idx ON booking_slots(starts_at);

CREATE TABLE IF NOT EXISTS menus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  standard_price_yen INTEGER NOT NULL CHECK (standard_price_yen >= 0),
  ticket_count INTEGER NOT NULL CHECK (ticket_count >= 0),
  validity_days INTEGER,
  target_month_required INTEGER NOT NULL DEFAULT 0 CHECK (target_month_required IN (0,1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE RESTRICT,
  menu_name_at_sale TEXT NOT NULL,
  purchased_on TEXT NOT NULL,
  target_month TEXT,
  actual_price_yen INTEGER NOT NULL CHECK (actual_price_yen >= 0),
  canceled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS purchases_member_idx ON purchases(member_id, purchased_on);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  paid_on TEXT NOT NULL,
  amount_yen INTEGER NOT NULL CHECK (amount_yen > 0),
  method_name_snapshot TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS held_credit_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  purchase_id TEXT REFERENCES purchases(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('hold','apply','refund','adjust')),
  amount_delta_yen INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  purchase_id TEXT UNIQUE REFERENCES purchases(id) ON DELETE RESTRICT,
  initial_count INTEGER NOT NULL CHECK (initial_count > 0),
  available_count INTEGER NOT NULL CHECK (available_count >= 0),
  valid_from TEXT NOT NULL,
  expires_on TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES booking_slots(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','declined','withdrawn','canceled','done','absent')),
  ticket_id TEXT REFERENCES tickets(id) ON DELETE RESTRICT,
  decline_reason TEXT,
  member_notice_required INTEGER NOT NULL DEFAULT 0 CHECK (member_notice_required IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS booking_requests_slot_idx ON booking_requests(slot_id, status);
CREATE INDEX IF NOT EXISTS booking_requests_member_idx ON booking_requests(member_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_slot ON booking_requests(slot_id) WHERE status IN ('confirmed','done','absent');

CREATE TABLE IF NOT EXISTS ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  booking_id TEXT REFERENCES booking_requests(id) ON DELETE RESTRICT,
  amount_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_change_requests (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  requested_phone TEXT,
  requested_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','declined','withdrawn')),
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('all','selected')),
  publish_on TEXT,
  published_at TEXT,
  deleted_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notice_recipients (
  notice_id TEXT NOT NULL REFERENCES notices(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  PRIMARY KEY(notice_id,member_id)
);

CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('member','staff')),
  recipient_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  seen_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member','staff','system')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity_type,entity_id,created_at);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
