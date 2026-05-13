import { NoticeUpdate, NoticeType, NOTICE_TYPES } from '../types/notice';
import { LoanPosition } from '../types/loan';
import { NOTICE_EXTRACTION_SYSTEM_PROMPT, buildNoticeUserMessage } from '../prompts/notice_extraction_prompt';
import { callClaude } from '../api/claude';

// ── Public types ──────────────────────────────────────────────────────────────

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export interface LogEntry { level: LogLevel; message: string; }

export interface NoticeExtractionResult {
  notice: NoticeUpdate;
  logs:   LogEntry[];
}

export interface NoticeValidationResult {
  valid:   boolean;
  errors:  string[];
  notice?: NoticeUpdate;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Validator ─────────────────────────────────────────────────────────────────

export function validateNoticeUpdate(raw: unknown): NoticeValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Response is not a plain object'] };
  }

  const obj = raw as Record<string, unknown>;

  if (!NOTICE_TYPES.includes(obj.notice_type as NoticeType)) {
    errors.push(`Invalid notice_type: "${String(obj.notice_type)}"`);
  }

  if (!obj.obligor_name || typeof obj.obligor_name !== 'string') {
    errors.push('Missing or invalid obligor_name');
  }

  if (!Array.isArray(obj.loan_ids)) {
    errors.push('loan_ids must be an array');
  }

  if (obj.effective_date !== null && obj.effective_date !== undefined) {
    if (
      typeof obj.effective_date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(obj.effective_date)
    ) {
      errors.push(
        `Invalid effective_date: "${String(obj.effective_date)}" — expected YYYY-MM-DD or null`,
      );
    }
  }

  if (!obj.updates || typeof obj.updates !== 'object' || Array.isArray(obj.updates)) {
    errors.push('updates must be a plain object');
  }

  if (typeof obj.raw_text !== 'string') {
    errors.push('raw_text must be a string');
  }

  if (!['HIGH', 'MEDIUM', 'LOW'].includes(obj.extraction_confidence as string)) {
    errors.push(`Invalid extraction_confidence: "${String(obj.extraction_confidence)}"`);
  }

  if (!Array.isArray(obj.flags)) {
    errors.push('flags must be an array');
  }

  if (errors.length > 0) return { valid: false, errors };

  const notice: NoticeUpdate = {
    notice_id:             typeof obj.notice_id === 'string' ? obj.notice_id : generateId(),
    notice_type:           obj.notice_type as NoticeType,
    effective_date:        (obj.effective_date ?? null) as string | null,
    loan_ids:              obj.loan_ids as string[],
    obligor_name:          obj.obligor_name as string,
    updates:               obj.updates as Partial<LoanPosition>,
    raw_text:              obj.raw_text as string,
    extraction_confidence: obj.extraction_confidence as 'HIGH' | 'MEDIUM' | 'LOW',
    flags:                 (obj.flags as unknown[]).map(String),
  };

  return { valid: true, errors: [], notice };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseAgentNotice(
  noticeText:   string,
  existingTape: LoanPosition[],
): Promise<NoticeExtractionResult> {
  const logs: LogEntry[] = [];
  const log = (level: LogLevel, message: string) => logs.push({ level, message });

  const tapeContext = existingTape.map(l => ({
    loan_id:      l.loan_id,
    obligor_name: l.obligor_name,
  }));

  const userMessage = buildNoticeUserMessage(noticeText, tapeContext);

  let rawText: string;
  try {
    rawText = await callClaude(NOTICE_EXTRACTION_SYSTEM_PROMPT, userMessage, 4000);
  } catch (e) {
    log('ERROR', `API call failed: ${(e as Error).message}`);
    throw e;
  }

  // Strip any accidental markdown fences
  const clean = rawText.replace(/```json\s*|```\s*/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    log('ERROR', `Failed to parse JSON response: ${(e as Error).message}`);
    throw new Error(`Notice extraction returned invalid JSON: ${(e as Error).message}`);
  }

  const { valid, errors, notice } = validateNoticeUpdate(parsed);

  if (!valid || !notice) {
    const msg = `Notice validation failed: ${errors.join('; ')}`;
    log('ERROR', msg);
    throw new Error(msg);
  }

  // Always overwrite raw_text with the original — don't trust the model's echo
  notice.raw_text = noticeText;

  if (!notice.notice_id) notice.notice_id = generateId();

  const fc = notice.flags.length;
  log(
    'INFO',
    `Notice parsed: ${notice.notice_type}, confidence ${notice.extraction_confidence}, ${fc} flag${fc !== 1 ? 's' : ''}`,
  );

  if (notice.extraction_confidence === 'LOW') {
    log('WARN', `Low-confidence extraction — manual review required: ${notice.flags.join('; ')}`);
  }

  return { notice, logs };
}
