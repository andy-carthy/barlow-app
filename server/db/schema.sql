-- Barlow Exception Register Schema — Phase 7

CREATE TABLE IF NOT EXISTS deals (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  indenture_file  TEXT,
  loan_tape_file  TEXT,
  extraction_output TEXT,   -- JSON blob
  compliance_run    TEXT,   -- JSON blob
  waterfall         TEXT,   -- JSON blob
  trustee_report    TEXT,   -- JSON blob
  is_active    INTEGER NOT NULL DEFAULT 0,
  loaded_at    TEXT
);

CREATE TABLE IF NOT EXISTS exceptions (
  id               TEXT PRIMARY KEY,
  deal_id          TEXT NOT NULL REFERENCES deals(id),
  run_id           TEXT,
  test_id          TEXT NOT NULL,
  test_type        TEXT NOT NULL,  -- COVERAGE | CONCENTRATION | WATERFALL | MANUAL
  severity         TEXT NOT NULL,  -- BREACH | WARNING | WATCH
  status           TEXT NOT NULL DEFAULT 'OPEN',
  -- OPEN | UNDER_REVIEW | PENDING_APPROVAL | RESOLVED | WAIVED | ESCALATED
  threshold        REAL,
  actual           REAL,
  cushion          REAL,           -- actual - threshold; negative = breach
  description      TEXT NOT NULL,
  indenture_section TEXT,
  assigned_to      TEXT,
  assigned_at      TEXT,
  opened_at        TEXT NOT NULL,
  due_date         TEXT,
  resolution_notes TEXT,
  waiver_rationale TEXT,
  cleared          INTEGER NOT NULL DEFAULT 0,
  cleared_at       TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id           TEXT PRIMARY KEY,
  exception_id TEXT NOT NULL REFERENCES exceptions(id),
  deal_id      TEXT NOT NULL,
  timestamp    TEXT NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  -- CREATED | ASSIGNED | STATUS_CHANGED | NOTE_ADDED | FILE_ATTACHED | APPROVAL_GIVEN | CLEARED
  from_value   TEXT,
  to_value     TEXT,
  note         TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id            TEXT PRIMARY KEY,
  exception_id  TEXT NOT NULL REFERENCES exceptions(id),
  level         INTEGER NOT NULL,  -- 1 or 2
  approver_id   TEXT NOT NULL,
  approver_name TEXT NOT NULL,
  approved_at   TEXT NOT NULL,
  comment       TEXT
);

CREATE TABLE IF NOT EXISTS attached_files (
  id           TEXT PRIMARY KEY,
  exception_id TEXT NOT NULL REFERENCES exceptions(id),
  filename     TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  uploaded_at  TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  url          TEXT NOT NULL
);

-- Indexes required by Register Intelligence tab (Phase 7, Section 15 Step 1)
CREATE INDEX IF NOT EXISTS idx_exceptions_deal_id      ON exceptions(deal_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_status       ON exceptions(status);
CREATE INDEX IF NOT EXISTS idx_exceptions_due_date     ON exceptions(due_date);
CREATE INDEX IF NOT EXISTS idx_exceptions_deal_status  ON exceptions(deal_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_events_exception_id ON audit_events(exception_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_deal_id    ON audit_events(deal_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp  ON audit_events(timestamp);
