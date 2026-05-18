import express from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { transitionGuard } from '../middleware/transitions';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../db/index.js');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function writeAuditEvent(params: {
  id?: string;
  exception_id: string;
  deal_id: string;
  actor: string;
  action: string;
  from_value?: string | null;
  to_value?: string | null;
  note?: string | null;
}): void {
  db.prepare(`
    INSERT INTO audit_events (id, exception_id, deal_id, timestamp, actor, action, from_value, to_value, note)
    VALUES (@id, @exception_id, @deal_id, @timestamp, @actor, @action, @from_value, @to_value, @note)
  `).run({
    id: params.id ?? randomUUID(),
    exception_id: params.exception_id,
    deal_id: params.deal_id,
    timestamp: now(),
    actor: params.actor,
    action: params.action,
    from_value: params.from_value ?? null,
    to_value: params.to_value ?? null,
    note: params.note ?? null,
  });
}

function hydrateException(exc: Record<string, unknown>) {
  const approvals = db
    .prepare('SELECT * FROM approvals WHERE exception_id = ? ORDER BY level')
    .all(exc.id);
  const audit_trail = db
    .prepare('SELECT * FROM audit_events WHERE exception_id = ? ORDER BY timestamp')
    .all(exc.id);
  const supporting_files = db
    .prepare('SELECT * FROM attached_files WHERE exception_id = ? ORDER BY uploaded_at')
    .all(exc.id);

  return { ...exc, approvals, audit_trail, supporting_files, cleared: exc.cleared === 1 };
}

function registerSummary(dealId: string) {
  const exceptions = db
    .prepare('SELECT * FROM exceptions WHERE deal_id = ? ORDER BY opened_at')
    .all(dealId)
    .map(hydrateException);

  const open_count = exceptions.filter((e: Record<string, unknown>) => !e.cleared && e.status !== 'RESOLVED' && e.status !== 'WAIVED').length;
  const resolved_count = exceptions.filter((e: Record<string, unknown>) => e.status === 'RESOLVED' && !e.cleared).length;
  const waived_count = exceptions.filter((e: Record<string, unknown>) => e.status === 'WAIVED' && !e.cleared).length;

  const dealRow = db.prepare('SELECT register_version, last_cleared_at FROM deals WHERE id = ?').get(dealId) as
    | { register_version?: number; last_cleared_at?: string | null }
    | undefined;

  return {
    deal_id: dealId,
    register_version: dealRow?.register_version ?? 1,
    last_cleared_at: dealRow?.last_cleared_at ?? null,
    open_count,
    resolved_count,
    waived_count,
    exceptions,
  };
}

// ---------------------------------------------------------------------------
// POST /api/exceptions/register
// Create (or return existing) exception register for a deal
// ---------------------------------------------------------------------------
router.post('/register', (req: Request, res: Response) => {
  try {
    const { deal_id, run_id, coverage_results, concentration_results } = req.body as {
      deal_id?: string;
      run_id?: string;
      coverage_results?: Array<Record<string, unknown>>;
      concentration_results?: Array<Record<string, unknown>>;
    };

    if (!deal_id) {
      res.status(400).json({ success: false, error: 'deal_id is required' });
      return;
    }

    // Ensure deal record exists
    const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(deal_id);
    if (!deal) {
      db.prepare('INSERT INTO deals (id, name, is_active, loaded_at) VALUES (?, ?, 0, ?)')
        .run(deal_id, deal_id, now());
    }

    // If Phase 3 results provided, auto-register new exceptions
    if (run_id && (coverage_results?.length || concentration_results?.length)) {
      const insertExc = db.prepare(`
        INSERT OR IGNORE INTO exceptions
          (id, deal_id, run_id, test_id, test_type, severity, status,
           threshold, actual, cushion, description, indenture_section, opened_at)
        VALUES
          (@id, @deal_id, @run_id, @test_id, @test_type, @severity, @status,
           @threshold, @actual, @cushion, @description, @indenture_section, @opened_at)
      `);

      const registerExceptions = db.transaction((results: Array<Record<string, unknown>>, testType: string) => {
        for (const r of results) {
          const isBreach = r.status === 'FAIL' || (typeof r.cushion === 'number' && r.cushion < 0);
          const severity = isBreach ? 'BREACH' : 'WARNING';
          const excId = randomUUID();
          const ts = now();

          insertExc.run({
            id: excId,
            deal_id,
            run_id,
            test_id: String(r.test_id ?? r.test_name ?? 'UNKNOWN'),
            test_type: testType,
            severity,
            status: 'OPEN',
            threshold: r.threshold ?? null,
            actual: r.actual ?? null,
            cushion: r.cushion ?? null,
            description: String(r.description ?? r.test_name ?? ''),
            indenture_section: r.indenture_section ?? null,
            opened_at: ts,
          });

          // Only write audit event if the row was actually inserted (not ignored)
          const inserted = db.prepare('SELECT id FROM exceptions WHERE id = ?').get(excId);
          if (inserted) {
            writeAuditEvent({
              exception_id: excId,
              deal_id,
              actor: 'system',
              action: 'CREATED',
              to_value: 'OPEN',
              note: `Auto-registered from Phase 3 compliance run ${run_id}`,
            });
          }
        }
      });

      if (coverage_results?.length) registerExceptions(coverage_results, 'COVERAGE');
      if (concentration_results?.length) registerExceptions(concentration_results, 'CONCENTRATION');
    }

    res.json({ success: true, data: registerSummary(deal_id) });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/exceptions/:dealId/audit  — deal-level audit trail
// Must be before /:dealId/:id to avoid param conflict
// ---------------------------------------------------------------------------
router.get('/:dealId/audit', (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const events = db
      .prepare('SELECT * FROM audit_events WHERE deal_id = ? ORDER BY timestamp DESC')
      .all(dealId);
    res.json({ success: true, data: events });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/exceptions/:dealId/export — CSV snapshot
// ---------------------------------------------------------------------------
router.get('/:dealId/export', (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const rows = db
      .prepare('SELECT * FROM exceptions WHERE deal_id = ? ORDER BY opened_at')
      .all(dealId);

    const cols = ['id', 'test_id', 'test_type', 'severity', 'status', 'threshold', 'actual', 'cushion', 'description', 'indenture_section', 'assigned_to', 'opened_at', 'due_date', 'resolution_notes', 'cleared', 'cleared_at'];
    const csvRows = [cols.join(',')];
    for (const row of rows) {
      csvRows.push(cols.map(c => JSON.stringify(row[c] ?? '')).join(','));
    }

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="barlow-exceptions-${dealId}-${date}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/exceptions/:dealId — full register
// ---------------------------------------------------------------------------
router.get('/:dealId', (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(dealId);
    if (!deal) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }
    res.json({ success: true, data: registerSummary(dealId) });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/exceptions/:dealId/:id — single exception
// ---------------------------------------------------------------------------
router.get('/:dealId/:id', (req: Request, res: Response) => {
  try {
    const { dealId, id } = req.params;
    const exc = db.prepare('SELECT * FROM exceptions WHERE id = ? AND deal_id = ?').get(id, dealId);
    if (!exc) {
      res.status(404).json({ success: false, error: 'Exception not found' });
      return;
    }
    res.json({ success: true, data: hydrateException(exc) });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/exceptions/:dealId/:id — update status, notes, assignment
// ---------------------------------------------------------------------------
router.patch('/:dealId/:id', transitionGuard, (req: Request, res: Response) => {
  try {
    const { dealId, id } = req.params;
    const body = req.body as {
      action?: string;
      to_status?: string;
      actor?: string;
      note?: string;
      assigned_to?: string;
      resolution_notes?: string;
      waiver_rationale?: string;
      due_date?: string;
    };

    const exc = db.prepare('SELECT * FROM exceptions WHERE id = ? AND deal_id = ?').get(id, dealId);
    if (!exc) {
      res.status(404).json({ success: false, error: 'Exception not found' });
      return;
    }

    const actor = body.actor ?? 'system';

    const doUpdate = db.transaction(() => {
      if (body.action === 'TRANSITION' && body.to_status) {
        const fromStatus = exc.status;
        const toStatus = body.to_status;

        db.prepare('UPDATE exceptions SET status = ?, cleared = ?, cleared_at = ? WHERE id = ?')
          .run(
            toStatus,
            toStatus === 'CLEARED' ? 1 : exc.cleared,
            toStatus === 'CLEARED' ? now() : exc.cleared_at,
            id,
          );

        writeAuditEvent({
          exception_id: id,
          deal_id: dealId,
          actor,
          action: 'STATUS_CHANGED',
          from_value: fromStatus,
          to_value: toStatus,
          note: body.note ?? null,
        });
      }

      if (body.assigned_to !== undefined) {
        db.prepare('UPDATE exceptions SET assigned_to = ?, assigned_at = ? WHERE id = ?')
          .run(body.assigned_to, now(), id);
        writeAuditEvent({
          exception_id: id,
          deal_id: dealId,
          actor,
          action: 'ASSIGNED',
          from_value: exc.assigned_to ?? null,
          to_value: body.assigned_to,
          note: body.note ?? null,
        });
      }

      if (body.resolution_notes !== undefined) {
        db.prepare('UPDATE exceptions SET resolution_notes = ? WHERE id = ?')
          .run(body.resolution_notes, id);
        writeAuditEvent({
          exception_id: id,
          deal_id: dealId,
          actor,
          action: 'NOTE_ADDED',
          note: body.resolution_notes,
        });
      }

      if (body.waiver_rationale !== undefined) {
        db.prepare('UPDATE exceptions SET waiver_rationale = ? WHERE id = ?')
          .run(body.waiver_rationale, id);
        writeAuditEvent({
          exception_id: id,
          deal_id: dealId,
          actor,
          action: 'NOTE_ADDED',
          note: `Waiver rationale: ${body.waiver_rationale}`,
        });
      }

      if (body.due_date !== undefined) {
        db.prepare('UPDATE exceptions SET due_date = ? WHERE id = ?')
          .run(body.due_date, id);
      }
    });

    doUpdate();

    const updated = db.prepare('SELECT * FROM exceptions WHERE id = ?').get(id);
    res.json({ success: true, data: hydrateException(updated) });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/exceptions/:dealId/:id/approve — submit Level 1 or 2 approval
// ---------------------------------------------------------------------------
router.post('/:dealId/:id/approve', (req: Request, res: Response) => {
  try {
    const { dealId, id } = req.params;
    const body = req.body as {
      level: 1 | 2;
      approver_id: string;
      approver_name: string;
      comment?: string;
    };

    if (!body.level || !body.approver_id || !body.approver_name) {
      res.status(400).json({ success: false, error: 'level, approver_id, and approver_name are required' });
      return;
    }

    const exc = db.prepare('SELECT * FROM exceptions WHERE id = ? AND deal_id = ?').get(id, dealId);
    if (!exc) {
      res.status(404).json({ success: false, error: 'Exception not found' });
      return;
    }

    // Level 2 cannot be same user as Level 1
    if (body.level === 2) {
      const l1 = db.prepare('SELECT approver_id FROM approvals WHERE exception_id = ? AND level = 1').get(id) as { approver_id: string } | undefined;
      if (l1 && l1.approver_id === body.approver_id) {
        res.status(400).json({
          success: false,
          error: 'Level 2 approver cannot be the same person as Level 1 approver',
        });
        return;
      }
    }

    // Check for duplicate approval at this level
    const existing = db.prepare('SELECT id FROM approvals WHERE exception_id = ? AND level = ?').get(id, body.level);
    if (existing) {
      res.status(400).json({
        success: false,
        error: `Level ${body.level} approval has already been given for this exception`,
      });
      return;
    }

    const doApprove = db.transaction(() => {
      const approvalId = randomUUID();
      const ts = now();

      db.prepare(`
        INSERT INTO approvals (id, exception_id, level, approver_id, approver_name, approved_at, comment)
        VALUES (@id, @exception_id, @level, @approver_id, @approver_name, @approved_at, @comment)
      `).run({
        id: approvalId,
        exception_id: id,
        level: body.level,
        approver_id: body.approver_id,
        approver_name: body.approver_name,
        approved_at: ts,
        comment: body.comment ?? null,
      });

      writeAuditEvent({
        exception_id: id,
        deal_id: dealId,
        actor: body.approver_id,
        action: 'APPROVAL_GIVEN',
        to_value: `level_${body.level}`,
        note: body.comment ?? `Level ${body.level} sign-off by ${body.approver_name}`,
      });
    });

    doApprove();

    const updated = db.prepare('SELECT * FROM exceptions WHERE id = ?').get(id);
    res.json({ success: true, data: hydrateException(updated) });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/exceptions/:dealId/:id/files — attach supporting file
// ---------------------------------------------------------------------------
router.post('/:dealId/:id/files', (req: Request, res: Response) => {
  try {
    const { dealId, id } = req.params;
    const body = req.body as {
      filename: string;
      size_bytes: number;
      uploaded_by: string;
      url: string;
    };

    if (!body.filename || !body.uploaded_by || !body.url) {
      res.status(400).json({ success: false, error: 'filename, uploaded_by, and url are required' });
      return;
    }

    const exc = db.prepare('SELECT id FROM exceptions WHERE id = ? AND deal_id = ?').get(id, dealId);
    if (!exc) {
      res.status(404).json({ success: false, error: 'Exception not found' });
      return;
    }

    const doAttach = db.transaction(() => {
      const fileId = randomUUID();
      const ts = now();

      db.prepare(`
        INSERT INTO attached_files (id, exception_id, filename, size_bytes, uploaded_at, uploaded_by, url)
        VALUES (@id, @exception_id, @filename, @size_bytes, @uploaded_at, @uploaded_by, @url)
      `).run({
        id: fileId,
        exception_id: id,
        filename: body.filename,
        size_bytes: body.size_bytes ?? 0,
        uploaded_at: ts,
        uploaded_by: body.uploaded_by,
        url: body.url,
      });

      writeAuditEvent({
        exception_id: id,
        deal_id: dealId,
        actor: body.uploaded_by,
        action: 'FILE_ATTACHED',
        to_value: body.filename,
      });

      return fileId;
    });

    const fileId = doAttach();
    const file = db.prepare('SELECT * FROM attached_files WHERE id = ?').get(fileId);
    res.json({ success: true, data: file });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/exceptions/:dealId/:id/files/:fileId — remove file
// ---------------------------------------------------------------------------
router.delete('/:dealId/:id/files/:fileId', (req: Request, res: Response) => {
  try {
    const { id, fileId } = req.params;

    const file = db.prepare('SELECT * FROM attached_files WHERE id = ? AND exception_id = ?').get(fileId, id);
    if (!file) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }

    db.prepare('DELETE FROM attached_files WHERE id = ?').run(fileId);
    res.json({ success: true, data: { deleted: fileId } });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export { router as exceptionsRouter };
