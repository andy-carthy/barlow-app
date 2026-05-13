import { readFileSync } from 'fs';
import { join }         from 'path';

import { parseAgentNotice, validateNoticeUpdate } from './notice_extractor';
import { callClaude }                             from '../api/claude';
import { SYNTHETIC_LOAN_TAPE }                    from '../fixtures/synthetic_loan_tape';
import { NoticeUpdate }                           from '../types/notice';

// ── Mock the API layer ────────────────────────────────────────────────────────

jest.mock('../api/claude');
const mockCallClaude = callClaude as jest.MockedFunction<typeof callClaude>;

// ── Fixture helpers ───────────────────────────────────────────────────────────

const NOTICE_DIR = join(__dirname, '../fixtures/synthetic_notices');

function readNotice(filename: string): string {
  return readFileSync(join(NOTICE_DIR, filename), 'utf8');
}

function mockResponse(partial: Partial<NoticeUpdate>): string {
  return JSON.stringify({
    notice_id:             'test-uuid',
    notice_type:           'UNKNOWN',
    effective_date:        null,
    loan_ids:              [],
    obligor_name:          '',
    updates:               {},
    raw_text:              '',
    extraction_confidence: 'HIGH',
    flags:                 [],
    ...partial,
  });
}

// ── Fixture texts ─────────────────────────────────────────────────────────────

const RATE_RESET_TEXT   = readNotice('rate_reset.txt');
const PAYDOWN_TEXT      = readNotice('paydown.txt');
const PIK_TEXT          = readNotice('pik_election.txt');
const MATURITY_TEXT     = readNotice('maturity_extension.txt');
const AMBIGUOUS_TEXT    = readNotice('ambiguous_amendment.txt');

beforeEach(() => mockCallClaude.mockReset());

// ── validateNoticeUpdate unit tests ──────────────────────────────────────────

describe('validateNoticeUpdate', () => {
  test('accepts a fully valid notice', () => {
    const { valid, errors } = validateNoticeUpdate({
      notice_id: 'abc-123', notice_type: 'RATE_RESET', effective_date: '2025-04-01',
      loan_ids: ['L001'], obligor_name: 'Acme Corp', updates: { spread: 450 },
      raw_text: 'text', extraction_confidence: 'HIGH', flags: [],
    });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test('accepts null effective_date', () => {
    const { valid } = validateNoticeUpdate({
      notice_id: 'x', notice_type: 'AMENDMENT', effective_date: null,
      loan_ids: [], obligor_name: 'X', updates: {},
      raw_text: 'text', extraction_confidence: 'LOW', flags: ['missing date'],
    });
    expect(valid).toBe(true);
  });

  test('rejects invalid notice_type', () => {
    const { valid, errors } = validateNoticeUpdate({
      notice_id: 'x', notice_type: 'WIRE_TRANSFER', effective_date: null,
      loan_ids: [], obligor_name: 'X', updates: {},
      raw_text: 'text', extraction_confidence: 'HIGH', flags: [],
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('notice_type'))).toBe(true);
  });

  test('rejects malformed effective_date', () => {
    const { valid, errors } = validateNoticeUpdate({
      notice_id: 'x', notice_type: 'PAYDOWN', effective_date: '01-Mar-2025',
      loan_ids: [], obligor_name: 'X', updates: {},
      raw_text: 'text', extraction_confidence: 'HIGH', flags: [],
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('effective_date'))).toBe(true);
  });

  test('rejects invalid extraction_confidence', () => {
    const { valid, errors } = validateNoticeUpdate({
      notice_id: 'x', notice_type: 'PAYDOWN', effective_date: null,
      loan_ids: [], obligor_name: 'X', updates: {},
      raw_text: 'text', extraction_confidence: 'VERY_HIGH', flags: [],
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('extraction_confidence'))).toBe(true);
  });

  test('generates notice_id when absent', () => {
    const { notice } = validateNoticeUpdate({
      notice_type: 'RATE_RESET', effective_date: '2025-01-01',
      loan_ids: [], obligor_name: 'X', updates: {},
      raw_text: 'text', extraction_confidence: 'HIGH', flags: [],
    });
    expect(notice?.notice_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ── parseAgentNotice — notice 1: SOFR rate reset ──────────────────────────────

test('rate reset: classifies RATE_RESET, extracts spread, HIGH confidence', async () => {
  mockCallClaude.mockResolvedValueOnce(
    mockResponse({
      notice_type:           'RATE_RESET',
      effective_date:        '2025-04-01',
      loan_ids:              ['L001', 'L002'],
      obligor_name:          'Apex Logistics Holdings, LLC',
      updates:               { spread: 450 },
      extraction_confidence: 'HIGH',
      flags:                 [],
    }),
  );

  const { notice, logs } = await parseAgentNotice(RATE_RESET_TEXT, SYNTHETIC_LOAN_TAPE);

  expect(notice.notice_type).toBe('RATE_RESET');
  expect(notice.effective_date).toBe('2025-04-01');
  expect(notice.loan_ids).toEqual(['L001', 'L002']);
  expect(notice.updates.spread).toBe(450);
  expect(notice.extraction_confidence).toBe('HIGH');
  expect(notice.flags).toHaveLength(0);

  // raw_text must be the original notice, not the model's echo
  expect(notice.raw_text).toBe(RATE_RESET_TEXT);

  // Anti-hallucination: every extracted value must appear in the source text
  expect(RATE_RESET_TEXT).toContain('450');          // spread 450 bps
  expect(RATE_RESET_TEXT).toContain('April 1, 2025');
  expect(RATE_RESET_TEXT).toContain('L001');
  expect(RATE_RESET_TEXT).toContain('L002');

  const infoLog = logs.find(l => l.level === 'INFO');
  expect(infoLog?.message).toMatch(/RATE_RESET.*HIGH.*0 flags/);
});

// ── parseAgentNotice — notice 2: partial paydown ──────────────────────────────

test('paydown: classifies PAYDOWN, extracts principal_balance, HIGH confidence', async () => {
  mockCallClaude.mockResolvedValueOnce(
    mockResponse({
      notice_type:           'PAYDOWN',
      effective_date:        '2025-03-05',
      loan_ids:              ['L004'],
      obligor_name:          'Castle Health Group, Inc.',
      updates:               { principal_balance: 7.5 },
      extraction_confidence: 'HIGH',
      flags:                 [],
    }),
  );

  const { notice, logs } = await parseAgentNotice(PAYDOWN_TEXT, SYNTHETIC_LOAN_TAPE);

  expect(notice.notice_type).toBe('PAYDOWN');
  expect(notice.effective_date).toBe('2025-03-05');
  expect(notice.loan_ids).toEqual(['L004']);
  expect(notice.updates.principal_balance).toBe(7.5);
  expect(notice.extraction_confidence).toBe('HIGH');
  expect(notice.raw_text).toBe(PAYDOWN_TEXT);

  // Anti-hallucination: 7.5 $M = $7,500,000 in the notice text
  expect(PAYDOWN_TEXT).toContain('7,500,000');
  expect(PAYDOWN_TEXT).toContain('March 5, 2025');
  expect(PAYDOWN_TEXT).toContain('L004');

  const infoLog = logs.find(l => l.level === 'INFO');
  expect(infoLog?.message).toMatch(/PAYDOWN.*HIGH.*0 flags/);
});

// ── parseAgentNotice — notice 3: PIK election ────────────────────────────────

test('PIK election: classifies PIK_ELECTION, marks is_current_pay false', async () => {
  mockCallClaude.mockResolvedValueOnce(
    mockResponse({
      notice_type:           'PIK_ELECTION',
      effective_date:        '2025-01-10',
      loan_ids:              ['L005'],
      obligor_name:          'Delta Energy Holdings, Ltd.',
      updates:               { is_current_pay: false, is_deferrable: true },
      extraction_confidence: 'HIGH',
      flags:                 [],
    }),
  );

  const { notice, logs } = await parseAgentNotice(PIK_TEXT, SYNTHETIC_LOAN_TAPE);

  expect(notice.notice_type).toBe('PIK_ELECTION');
  expect(notice.loan_ids).toEqual(['L005']);
  expect(notice.updates.is_current_pay).toBe(false);
  expect(notice.updates.is_deferrable).toBe(true);
  expect(notice.extraction_confidence).toBe('HIGH');
  expect(notice.raw_text).toBe(PIK_TEXT);

  // Anti-hallucination
  expect(PIK_TEXT).toContain('PIK');
  expect(PIK_TEXT).toContain('L005');
  expect(PIK_TEXT).toContain('January 10, 2025');

  expect(logs.find(l => l.level === 'INFO')?.message).toMatch(/PIK_ELECTION.*HIGH.*0 flags/);
});

// ── parseAgentNotice — notice 4: maturity extension ──────────────────────────

test('maturity extension: classifies MATURITY_EXTENSION, extracts new maturity date', async () => {
  mockCallClaude.mockResolvedValueOnce(
    mockResponse({
      notice_type:           'MATURITY_EXTENSION',
      effective_date:        '2025-04-01',
      loan_ids:              ['L003'],
      obligor_name:          'Bravo Media LLC',
      updates:               { maturity_date: '2030-07-30' },
      extraction_confidence: 'HIGH',
      flags:                 [],
    }),
  );

  const { notice, logs } = await parseAgentNotice(MATURITY_TEXT, SYNTHETIC_LOAN_TAPE);

  expect(notice.notice_type).toBe('MATURITY_EXTENSION');
  expect(notice.effective_date).toBe('2025-04-01');
  expect(notice.loan_ids).toEqual(['L003']);
  expect(notice.updates.maturity_date).toBe('2030-07-30');
  expect(notice.extraction_confidence).toBe('HIGH');
  expect(notice.raw_text).toBe(MATURITY_TEXT);

  // Anti-hallucination
  expect(MATURITY_TEXT).toContain('July 30, 2030');
  expect(MATURITY_TEXT).toContain('April 1, 2025');
  expect(MATURITY_TEXT).toContain('L003');

  expect(logs.find(l => l.level === 'INFO')?.message).toMatch(/MATURITY_EXTENSION.*HIGH.*0 flags/);
});

// ── parseAgentNotice — notice 5: ambiguous amendment ─────────────────────────

test('ambiguous amendment: LOW confidence, null effective_date, multiple flags, WARN log', async () => {
  const flags = [
    'Effective Date defined by reference to each respective Amendment Agreement — not specified in this notice',
    'Applicable Rate references Pricing Grid in Exhibit A not attached to this notice',
    'Affected facilities listed in Schedule 1 not included in this notice',
    'Covenant changes in Section 7.15 excluded from this notice pending final execution',
    'New applicable spread pending S&P and Moody\'s agency rating updates — not quantified',
  ];

  mockCallClaude.mockResolvedValueOnce(
    mockResponse({
      notice_type:           'AMENDMENT',
      effective_date:        null,
      loan_ids:              [],
      obligor_name:          'Multiple — see Schedule 1',
      updates:               {},
      extraction_confidence: 'LOW',
      flags,
    }),
  );

  const { notice, logs } = await parseAgentNotice(AMBIGUOUS_TEXT, SYNTHETIC_LOAN_TAPE);

  expect(notice.notice_type).toBe('AMENDMENT');
  expect(notice.effective_date).toBeNull();
  expect(notice.loan_ids).toHaveLength(0);
  expect(notice.extraction_confidence).toBe('LOW');
  expect(notice.flags.length).toBeGreaterThanOrEqual(3);
  expect(notice.raw_text).toBe(AMBIGUOUS_TEXT);

  // All flags must reference terms or phrases that actually appear in the notice
  expect(AMBIGUOUS_TEXT).toContain('Effective Date');
  expect(AMBIGUOUS_TEXT).toContain('Exhibit A');
  expect(AMBIGUOUS_TEXT).toContain('Schedule 1');
  expect(AMBIGUOUS_TEXT).toContain('Section 7.15');

  // INFO log present
  expect(logs.find(l => l.level === 'INFO')?.message).toMatch(/AMENDMENT.*LOW/);
  // WARN log present for low confidence
  expect(logs.some(l => l.level === 'WARN')).toBe(true);
});

// ── callClaude is invoked with correct args ───────────────────────────────────

test('passes system prompt and tape context to callClaude', async () => {
  mockCallClaude.mockResolvedValueOnce(
    mockResponse({ notice_type: 'RATE_RESET', effective_date: '2025-04-01',
      obligor_name: 'Apex Logistics Holdings, LLC', loan_ids: ['L001'],
      updates: { spread: 450 }, extraction_confidence: 'HIGH', flags: [] }),
  );

  await parseAgentNotice(RATE_RESET_TEXT, SYNTHETIC_LOAN_TAPE);

  expect(mockCallClaude).toHaveBeenCalledTimes(1);
  const [systemPrompt, userMessage, maxTokens] = mockCallClaude.mock.calls[0];

  expect(systemPrompt).toContain('RATE_RESET');
  expect(userMessage).toContain('L001');               // tape context present
  expect(userMessage).toContain('Apex Logistics');     // tape context present
  expect(userMessage).toContain('April 1, 2025');      // notice text present
  expect(maxTokens).toBe(4000);
});

// ── Error handling ────────────────────────────────────────────────────────────

test('throws and logs ERROR when API call fails', async () => {
  mockCallClaude.mockRejectedValueOnce(new Error('network timeout'));

  await expect(
    parseAgentNotice(RATE_RESET_TEXT, SYNTHETIC_LOAN_TAPE),
  ).rejects.toThrow('network timeout');
});

test('throws and logs ERROR when response is not valid JSON', async () => {
  mockCallClaude.mockResolvedValueOnce('not json at all');

  await expect(
    parseAgentNotice(RATE_RESET_TEXT, SYNTHETIC_LOAN_TAPE),
  ).rejects.toThrow(/invalid JSON/i);
});

test('throws and logs ERROR when response fails schema validation', async () => {
  mockCallClaude.mockResolvedValueOnce(JSON.stringify({ notice_type: 'WIRE_TRANSFER' }));

  await expect(
    parseAgentNotice(RATE_RESET_TEXT, SYNTHETIC_LOAN_TAPE),
  ).rejects.toThrow(/validation failed/i);
});
