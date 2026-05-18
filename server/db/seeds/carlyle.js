'use strict';
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../../../barlow.db');

const DEAL_ID = 'carlyle-2024-1';
const RUN_ID  = 'run-2026-05-18-001';

// Fixed IDs for demo reproducibility — deal.id === DEAL_ID so FK constraints pass
const IDS = {
  deal:    DEAL_ID,
  exc1:    'exc-oc-class-a-001',
  exc2:    'exc-conc-juniper-002',
  exc3:    'exc-oc-class-b-003',
  exc4:    'exc-conc-healthcare-004',
  exc5:    'exc-ic-class-a-005',
  // Audit events for exception #1
  ae1_1:   'ae-exc1-created',
  ae1_2:   'ae-exc1-assigned',
  ae1_3:   'ae-exc1-status-under-review',
  // Audit events for exception #5
  ae5_1:   'ae-exc5-created',
  ae5_2:   'ae-exc5-assigned',
  ae5_3:   'ae-exc5-status-under-review',
  ae5_4:   'ae-exc5-note-added',
  ae5_5:   'ae-exc5-status-pending-approval',
  ae5_6:   'ae-exc5-approval-l1',
  // Level 1 approval for exception #5
  appr5_1: 'appr-exc5-level1',
};

function seed() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  // Idempotent — skip if deal already seeded
  const existing = db.prepare('SELECT id FROM deals WHERE id = ?').get(IDS.deal);
  if (existing) {
    console.log('Carlyle seed already present — skipping.');
    db.close();
    return;
  }

  const insertDeal = db.prepare(`
    INSERT INTO deals (id, name, is_active, loaded_at)
    VALUES (?, ?, 1, ?)
  `);

  const insertException = db.prepare(`
    INSERT INTO exceptions
      (id, deal_id, run_id, test_id, test_type, severity, status,
       threshold, actual, cushion, description, indenture_section,
       assigned_to, assigned_at, opened_at, due_date, resolution_notes)
    VALUES
      (@id, @deal_id, @run_id, @test_id, @test_type, @severity, @status,
       @threshold, @actual, @cushion, @description, @indenture_section,
       @assigned_to, @assigned_at, @opened_at, @due_date, @resolution_notes)
  `);

  const insertAuditEvent = db.prepare(`
    INSERT INTO audit_events
      (id, exception_id, deal_id, timestamp, actor, action, from_value, to_value, note)
    VALUES
      (@id, @exception_id, @deal_id, @timestamp, @actor, @action, @from_value, @to_value, @note)
  `);

  const insertApproval = db.prepare(`
    INSERT INTO approvals
      (id, exception_id, level, approver_id, approver_name, approved_at, comment)
    VALUES
      (@id, @exception_id, @level, @approver_id, @approver_name, @approved_at, @comment)
  `);

  const seedAll = db.transaction(() => {
    // -- Deal record --
    insertDeal.run(IDS.deal, 'Carlyle DL CLO 2024-1', '2026-05-18T09:00:00.000Z');

    // -- Exception 1: OC_CLASS_A — BREACH, UNDER_REVIEW --
    insertException.run({
      id: IDS.exc1,
      deal_id: DEAL_ID,
      run_id: RUN_ID,
      test_id: 'OC_CLASS_A',
      test_type: 'COVERAGE',
      severity: 'BREACH',
      status: 'UNDER_REVIEW',
      threshold: 120.0,
      actual: 115.2,
      cushion: -4.8,
      description: 'Class A OC ratio 115.2% vs 120.0% threshold',
      indenture_section: '§7.4(a)(i)',
      assigned_to: 'controller_a',
      assigned_at: '2026-05-18T09:15:00.000Z',
      opened_at: '2026-05-18T09:00:00.000Z',
      due_date: '2026-05-22',
      resolution_notes: null,
    });

    // Audit trail for exception #1 — demonstrates key transition event types
    insertAuditEvent.run({
      id: IDS.ae1_1,
      exception_id: IDS.exc1,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:00:00.000Z',
      actor: 'system',
      action: 'CREATED',
      from_value: null,
      to_value: 'OPEN',
      note: 'Auto-registered from Phase 3 compliance run run-2026-05-18-001',
    });
    insertAuditEvent.run({
      id: IDS.ae1_2,
      exception_id: IDS.exc1,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:15:00.000Z',
      actor: 'controller_a',
      action: 'ASSIGNED',
      from_value: null,
      to_value: 'controller_a',
      note: 'Assigned to Controller A for review',
    });
    insertAuditEvent.run({
      id: IDS.ae1_3,
      exception_id: IDS.exc1,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:16:00.000Z',
      actor: 'controller_a',
      action: 'STATUS_CHANGED',
      from_value: 'OPEN',
      to_value: 'UNDER_REVIEW',
      note: 'Reviewing Class A OC breach — pulling supporting loan positions',
    });

    // -- Exception 2: CONC_SINGLE_OBLIGOR_JUNIPER — BREACH, OPEN --
    insertException.run({
      id: IDS.exc2,
      deal_id: DEAL_ID,
      run_id: RUN_ID,
      test_id: 'CONC_SINGLE_OBLIGOR_JUNIPER',
      test_type: 'CONCENTRATION',
      severity: 'BREACH',
      status: 'OPEN',
      threshold: 2.5,
      actual: 2.8,
      cushion: -0.3,
      description: 'Juniper Health Systems 2.8% vs 2.5% single-obligor limit',
      indenture_section: '§7.7(b)(i)',
      assigned_to: null,
      assigned_at: null,
      opened_at: '2026-05-18T09:00:00.000Z',
      due_date: '2026-05-22',
      resolution_notes: null,
    });
    insertAuditEvent.run({
      id: 'ae-exc2-created',
      exception_id: IDS.exc2,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:00:00.000Z',
      actor: 'system',
      action: 'CREATED',
      from_value: null,
      to_value: 'OPEN',
      note: 'Auto-registered from Phase 3 compliance run run-2026-05-18-001',
    });

    // -- Exception 3: OC_CLASS_B — WARNING, OPEN --
    insertException.run({
      id: IDS.exc3,
      deal_id: DEAL_ID,
      run_id: RUN_ID,
      test_id: 'OC_CLASS_B',
      test_type: 'COVERAGE',
      severity: 'WARNING',
      status: 'OPEN',
      threshold: 110.5,
      actual: 108.1,
      cushion: -2.4,
      description: 'Class B OC ratio 108.1% vs 110.5% threshold',
      indenture_section: '§7.4(a)(ii)',
      assigned_to: null,
      assigned_at: null,
      opened_at: '2026-05-18T09:00:00.000Z',
      due_date: null,
      resolution_notes: null,
    });
    insertAuditEvent.run({
      id: 'ae-exc3-created',
      exception_id: IDS.exc3,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:00:00.000Z',
      actor: 'system',
      action: 'CREATED',
      from_value: null,
      to_value: 'OPEN',
      note: 'Auto-registered from Phase 3 compliance run run-2026-05-18-001',
    });

    // -- Exception 4: CONC_INDUSTRY_HEALTHCARE — WATCH, UNDER_REVIEW --
    insertException.run({
      id: IDS.exc4,
      deal_id: DEAL_ID,
      run_id: RUN_ID,
      test_id: 'CONC_INDUSTRY_HEALTHCARE',
      test_type: 'CONCENTRATION',
      severity: 'WATCH',
      status: 'UNDER_REVIEW',
      threshold: 15.0,
      actual: 14.2,
      cushion: -0.8,
      description: 'Healthcare sector 14.2% approaching 15.0% industry limit',
      indenture_section: '§7.7(c)(iii)',
      assigned_to: 'controller_b',
      assigned_at: '2026-05-18T10:00:00.000Z',
      opened_at: '2026-05-18T09:00:00.000Z',
      due_date: null,
      resolution_notes: null,
    });
    insertAuditEvent.run({
      id: 'ae-exc4-created',
      exception_id: IDS.exc4,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:00:00.000Z',
      actor: 'system',
      action: 'CREATED',
      from_value: null,
      to_value: 'OPEN',
      note: 'Auto-registered from Phase 3 compliance run run-2026-05-18-001',
    });
    insertAuditEvent.run({
      id: 'ae-exc4-assigned',
      exception_id: IDS.exc4,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T10:00:00.000Z',
      actor: 'controller_b',
      action: 'ASSIGNED',
      from_value: null,
      to_value: 'controller_b',
      note: null,
    });
    insertAuditEvent.run({
      id: 'ae-exc4-under-review',
      exception_id: IDS.exc4,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T10:01:00.000Z',
      actor: 'controller_b',
      action: 'STATUS_CHANGED',
      from_value: 'OPEN',
      to_value: 'UNDER_REVIEW',
      note: 'Monitoring healthcare exposure — no immediate action required',
    });

    // -- Exception 5: IC_CLASS_A — WARNING, PENDING_APPROVAL (Level 1 given) --
    insertException.run({
      id: IDS.exc5,
      deal_id: DEAL_ID,
      run_id: RUN_ID,
      test_id: 'IC_CLASS_A',
      test_type: 'COVERAGE',
      severity: 'WARNING',
      status: 'PENDING_APPROVAL',
      threshold: 135.0,
      actual: 132.1,
      cushion: -2.9,
      description: 'Class A IC ratio 132.1% vs 135.0% threshold',
      indenture_section: '§7.5(a)(i)',
      assigned_to: 'controller_a',
      assigned_at: '2026-05-18T09:20:00.000Z',
      opened_at: '2026-05-18T09:00:00.000Z',
      due_date: '2026-05-22',
      resolution_notes: 'IC shortfall driven by scheduled fee accrual timing. Net interest collections confirm full coverage by distribution date. No portfolio action required.',
    });
    insertAuditEvent.run({
      id: IDS.ae5_1,
      exception_id: IDS.exc5,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:00:00.000Z',
      actor: 'system',
      action: 'CREATED',
      from_value: null,
      to_value: 'OPEN',
      note: 'Auto-registered from Phase 3 compliance run run-2026-05-18-001',
    });
    insertAuditEvent.run({
      id: IDS.ae5_2,
      exception_id: IDS.exc5,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:20:00.000Z',
      actor: 'controller_a',
      action: 'ASSIGNED',
      from_value: null,
      to_value: 'controller_a',
      note: null,
    });
    insertAuditEvent.run({
      id: IDS.ae5_3,
      exception_id: IDS.exc5,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T09:21:00.000Z',
      actor: 'controller_a',
      action: 'STATUS_CHANGED',
      from_value: 'OPEN',
      to_value: 'UNDER_REVIEW',
      note: null,
    });
    insertAuditEvent.run({
      id: IDS.ae5_4,
      exception_id: IDS.exc5,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T10:30:00.000Z',
      actor: 'controller_a',
      action: 'NOTE_ADDED',
      from_value: null,
      to_value: null,
      note: 'IC shortfall driven by scheduled fee accrual timing. Net interest collections confirm full coverage by distribution date.',
    });
    insertAuditEvent.run({
      id: IDS.ae5_5,
      exception_id: IDS.exc5,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T10:45:00.000Z',
      actor: 'controller_a',
      action: 'STATUS_CHANGED',
      from_value: 'UNDER_REVIEW',
      to_value: 'PENDING_APPROVAL',
      note: 'Resolution documented — submitted for Level 1 sign-off',
    });
    insertAuditEvent.run({
      id: IDS.ae5_6,
      exception_id: IDS.exc5,
      deal_id: DEAL_ID,
      timestamp: '2026-05-18T11:00:00.000Z',
      actor: 'controller_a',
      action: 'APPROVAL_GIVEN',
      from_value: null,
      to_value: 'level_1',
      note: 'Level 1 sign-off — resolution rationale accepted',
    });

    // Level 1 approval record for exception #5
    insertApproval.run({
      id: IDS.appr5_1,
      exception_id: IDS.exc5,
      level: 1,
      approver_id: 'controller_a',
      approver_name: 'Controller A',
      approved_at: '2026-05-18T11:00:00.000Z',
      comment: 'Resolution rationale accepted. Accrual timing explanation is sound.',
    });
  });

  seedAll();

  console.log('Seeded 5 exceptions for Carlyle DL CLO 2024-1');
  db.close();
}

seed();
