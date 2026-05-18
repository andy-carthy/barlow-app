import express from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { extractParallel } from '../engines/extraction';
import type { ProgressEvent } from '../engines/extraction';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../db/index.js');

const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory job store — tracks active extraction pipelines
// Keyed by dealId; subscribers receive SSE events as chunks complete
// ---------------------------------------------------------------------------
interface ExtractionJob {
  dealId: string;
  status: 'running' | 'complete' | 'error';
  progress: ProgressEvent;
  result?: Record<string, unknown>;
  error?: string;
  subscribers: Set<Response>;
}

const activeJobs = new Map<string, ExtractionJob>();

function emitToSubscribers(job: ExtractionJob, event: Record<string, unknown>): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of job.subscribers) {
    try { sub.write(data); } catch { /* subscriber disconnected */ }
  }
}

function startSSEHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

// ---------------------------------------------------------------------------
// POST /api/deals — create deal, trigger Phase 1–3 pipeline async
// Body: { name: string, text: string, api_key?: string }
// Returns: { success: true, data: { deal_id: string } } immediately
// ---------------------------------------------------------------------------
router.post('/', (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: string; text?: string; api_key?: string };
    const apiKey = (req.headers['x-anthropic-key'] as string) || body.api_key || process.env.ANTHROPIC_API_KEY;

    if (!body.text?.trim()) {
      res.status(400).json({ success: false, error: 'text is required' });
      return;
    }
    if (!apiKey) {
      res.status(400).json({ success: false, error: 'Anthropic API key required' });
      return;
    }

    const dealId = randomUUID();
    const name = body.name || `Deal ${new Date().toISOString().slice(0, 10)}`;
    const now = new Date().toISOString();

    // Persist deal row so SSE subscriber can look it up
    db.prepare('INSERT OR IGNORE INTO deals (id, name, is_active, loaded_at) VALUES (?, ?, 0, ?)')
      .run(dealId, name, now);

    // Set up in-memory job tracker
    const job: ExtractionJob = {
      dealId,
      status: 'running',
      progress: { completed: 0, total: 0, phase: 'extraction' },
      subscribers: new Set(),
    };
    activeJobs.set(dealId, job);

    // Run extraction async — do NOT await
    void runExtractionPipeline(job, body.text!, apiKey, name);

    res.json({ success: true, data: { deal_id: dealId } });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

async function runExtractionPipeline(
  job: ExtractionJob,
  text: string,
  apiKey: string,
  dealName: string,
): Promise<void> {
  try {
    const extraction = await extractParallel(text, apiKey, {
      dealName,
      onProgress: (ev) => {
        job.progress = ev;
        emitToSubscribers(job, { type: 'progress', ...ev });
      },
    });

    job.status = 'complete';
    job.result = extraction;

    // Persist extraction summary to DB
    db.prepare('UPDATE deals SET name = ?, loaded_at = ? WHERE id = ?')
      .run(dealName, new Date().toISOString(), job.dealId);

    emitToSubscribers(job, {
      type: 'complete',
      deal_id: job.dealId,
      extraction_output: extraction,
    });
  } catch (err) {
    job.status = 'error';
    job.error = (err as Error).message;
    emitToSubscribers(job, { type: 'error', message: job.error });
  } finally {
    // Close all SSE connections
    for (const sub of job.subscribers) {
      try { sub.end(); } catch { /* already closed */ }
    }
    // Keep job in map for a while so late subscribers can see the final state
    setTimeout(() => activeJobs.delete(job.dealId), 30_000);
  }
}

// ---------------------------------------------------------------------------
// GET /api/deals/:dealId/extraction-progress — SSE stream
// Subscribes to active job or returns terminal state for completed/unknown jobs
// ---------------------------------------------------------------------------
router.get('/:dealId/extraction-progress', (req: Request, res: Response) => {
  const { dealId } = req.params;
  startSSEHeaders(res);

  const job = activeJobs.get(dealId);

  if (!job) {
    // No active job — emit idle and close
    const event = JSON.stringify({ type: 'idle', message: 'No active extraction for this deal' });
    res.write(`data: ${event}\n\n`);
    res.end();
    return;
  }

  // If job is already complete/error, replay the terminal event immediately
  if (job.status === 'complete') {
    res.write(`data: ${JSON.stringify({ type: 'progress', ...job.progress })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'complete', deal_id: dealId, extraction_output: job.result })}\n\n`);
    res.end();
    return;
  }
  if (job.status === 'error') {
    res.write(`data: ${JSON.stringify({ type: 'error', message: job.error })}\n\n`);
    res.end();
    return;
  }

  // Job is running — replay current progress then stream future events
  if (job.progress.total > 0) {
    res.write(`data: ${JSON.stringify({ type: 'progress', ...job.progress })}\n\n`);
  }

  job.subscribers.add(res);

  // Heartbeat every 15s to prevent proxy timeouts
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    job.subscribers.delete(res);
  });
});

// ---------------------------------------------------------------------------
// GET /api/deals — list all loaded deals
// ---------------------------------------------------------------------------
router.get('/', (_req: Request, res: Response) => {
  try {
    const deals = db.prepare('SELECT * FROM deals ORDER BY loaded_at DESC').all();
    res.json({ success: true, data: deals });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/deals/:dealId — remove deal (preserves cleared exception register)
// ---------------------------------------------------------------------------
router.delete('/:dealId', (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;

    // Cancel any active extraction
    const job = activeJobs.get(dealId);
    if (job) {
      job.status = 'error';
      job.error = 'Cancelled by client';
      emitToSubscribers(job, { type: 'error', message: 'Cancelled' });
      for (const sub of job.subscribers) { try { sub.end(); } catch { /* ok */ } }
      activeJobs.delete(dealId);
    }

    // Remove deal row — exceptions rows preserved (cleared flag is audit artifact)
    const result = db.prepare('DELETE FROM deals WHERE id = ?').run(dealId);
    if (result.changes === 0) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }
    res.json({ success: true, data: { deleted: dealId } });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/deals/:dealId/activate — switch active deal
// ---------------------------------------------------------------------------
router.patch('/:dealId/activate', (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(dealId);
    if (!deal) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }

    db.transaction(() => {
      db.prepare('UPDATE deals SET is_active = 0').run();
      db.prepare('UPDATE deals SET is_active = 1 WHERE id = ?').run(dealId);
    })();

    const updated = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export { router as dealsRouter };
