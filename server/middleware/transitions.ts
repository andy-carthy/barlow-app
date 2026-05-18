'use strict';
import type { Request, Response, NextFunction } from 'express';

type ExceptionStatus =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'PENDING_APPROVAL'
  | 'RESOLVED'
  | 'WAIVED'
  | 'CLEARED'
  | 'ESCALATED';

interface TransitionRequest {
  action?: string;
  to_status?: ExceptionStatus;
  actor?: string;
  note?: string;
}

// Valid transitions per spec Section 4
const VALID_TRANSITIONS: Record<ExceptionStatus, ExceptionStatus[]> = {
  OPEN:               ['UNDER_REVIEW'],
  UNDER_REVIEW:       ['PENDING_APPROVAL', 'OPEN'],
  PENDING_APPROVAL:   ['RESOLVED', 'WAIVED', 'OPEN'],
  RESOLVED:           ['CLEARED', 'OPEN'],
  WAIVED:             ['CLEARED', 'OPEN'],
  CLEARED:            ['OPEN'],
  ESCALATED:          ['OPEN'],
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../db/index.js');

export function transitionGuard(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as TransitionRequest;

  if (body.action !== 'TRANSITION' || !body.to_status) {
    next();
    return;
  }

  const { dealId, id } = req.params;
  const toStatus = body.to_status;

  const exception = db.prepare('SELECT * FROM exceptions WHERE id = ? AND deal_id = ?').get(id, dealId);
  if (!exception) {
    res.status(404).json({ success: false, error: 'Exception not found' });
    return;
  }

  const currentStatus = exception.status as ExceptionStatus;
  const allowed = VALID_TRANSITIONS[currentStatus] ?? [];

  if (!allowed.includes(toStatus)) {
    res.status(400).json({
      success: false,
      error: `Invalid transition: ${currentStatus} → ${toStatus}. Allowed: ${allowed.join(', ') || 'none'}`,
    });
    return;
  }

  // Guard conditions per spec
  if (toStatus === 'UNDER_REVIEW') {
    if (!exception.assigned_to) {
      res.status(400).json({
        success: false,
        error: 'Cannot move to UNDER_REVIEW: exception must be assigned first',
      });
      return;
    }
  }

  if (toStatus === 'PENDING_APPROVAL') {
    const notes = (exception.resolution_notes ?? '').trim();
    const waiver = (exception.waiver_rationale ?? '').trim();
    if (notes.length < 20 && waiver.length < 20) {
      res.status(400).json({
        success: false,
        error: 'Cannot submit for approval: resolution notes or waiver rationale must be at least 20 characters',
      });
      return;
    }
  }

  if (toStatus === 'RESOLVED' || toStatus === 'WAIVED') {
    const l1 = db
      .prepare('SELECT * FROM approvals WHERE exception_id = ? AND level = 1')
      .get(id);
    if (!l1) {
      res.status(400).json({
        success: false,
        error: `Cannot move to ${toStatus}: Level 1 approval is required first`,
      });
      return;
    }
  }

  if (toStatus === 'CLEARED') {
    const l2 = db
      .prepare('SELECT * FROM approvals WHERE exception_id = ? AND level = 2')
      .get(id);
    if (!l2) {
      res.status(400).json({
        success: false,
        error: 'Cannot clear: Level 2 approval is required',
      });
      return;
    }
  }

  // Attach fetched exception to request for use in the route handler
  (req as Request & { exception: typeof exception }).exception = exception;
  next();
}
