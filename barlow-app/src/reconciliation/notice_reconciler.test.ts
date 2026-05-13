import { normalizeName, matchNoticeToLoans, applyNoticeUpdate } from './notice_reconciler';
import { SYNTHETIC_LOAN_TAPE } from '../fixtures/synthetic_loan_tape';
import { NoticeUpdate }        from '../types/notice';
import { LoanPosition }        from '../types/loan';

// ── Shared test fixture helpers ───────────────────────────────────────────────

function makeUpdate(partial: Partial<NoticeUpdate>): NoticeUpdate {
  return {
    notice_id:             'test-id',
    notice_type:           'AMENDMENT',
    effective_date:        '2025-01-01',
    loan_ids:              [],
    obligor_name:          '',
    updates:               {},
    raw_text:              '',
    extraction_confidence: 'HIGH',
    flags:                 [],
    ...partial,
  };
}

// Pre-built updates for the five synthetic notices
const RATE_RESET = makeUpdate({
  notice_id:   'nr-001',
  notice_type: 'RATE_RESET',
  effective_date: '2025-04-01',
  loan_ids:    ['L001', 'L002'],        // use explicit IDs
  obligor_name: 'Apex Logistics Holdings, LLC',
  updates:     { spread: 450 },
});

const PAYDOWN = makeUpdate({
  notice_id:   'nr-002',
  notice_type: 'PAYDOWN',
  effective_date: '2025-03-05',
  loan_ids:    [],                      // exercise fuzzy matching
  obligor_name: 'Castle Health Group, Inc.',
  updates:     { principal_balance: 7.5 },
});

const PIK_ELECTION = makeUpdate({
  notice_id:   'nr-003',
  notice_type: 'PIK_ELECTION',
  effective_date: '2025-01-10',
  loan_ids:    ['L005'],
  obligor_name: 'Delta Energy Holdings, Ltd.',
  updates:     { is_current_pay: false, is_deferrable: true },
});

const MATURITY_EXT = makeUpdate({
  notice_id:   'nr-004',
  notice_type: 'MATURITY_EXTENSION',
  effective_date: '2025-04-01',
  loan_ids:    [],                      // exercise fuzzy matching
  obligor_name: 'Bravo Media LLC',
  updates:     { maturity_date: '2030-07-30' },
});

const AMBIGUOUS = makeUpdate({
  notice_id:   'nr-005',
  notice_type: 'AMENDMENT',
  effective_date: null,
  loan_ids:    [],
  obligor_name: 'Multiple — see Schedule 1',
  updates:     {},
  extraction_confidence: 'LOW',
  flags: [
    'Effective Date defined by reference — not specified in this notice',
    'Applicable Rate references Exhibit A not attached',
    'Affected facilities listed in Schedule 1 not included',
  ],
});

// ── normalizeName ─────────────────────────────────────────────────────────────

describe('normalizeName', () => {
  test.each([
    ['Apex Logistics Holdings, LLC', 'apex logistics'],
    ['Castle Health Group, Inc.',    'castle health'],
    ['Delta Energy Holdings, Ltd.',  'delta energy'],
    ['Bravo Media LLC',              'bravo media'],
    ['First National Bank, N.A.',    'first national'],
    ['Apex Logistics',               'apex logistics'],   // tape side (no suffix)
    ['Castle Health',                'castle health'],
    ['Bravo Media',                  'bravo media'],
    ['Delta Energy',                 'delta energy'],
  ])('normalizes "%s" → "%s"', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

// ── matchNoticeToLoans ────────────────────────────────────────────────────────

describe('matchNoticeToLoans', () => {
  test('matches by loan_ids when provided', () => {
    const result = matchNoticeToLoans(RATE_RESET, SYNTHETIC_LOAN_TAPE);
    expect(result.map(l => l.loan_id).sort()).toEqual(['L001', 'L002']);
  });

  test('fuzzy-matches by obligor name when loan_ids is empty', () => {
    const result = matchNoticeToLoans(PAYDOWN, SYNTHETIC_LOAN_TAPE);
    expect(result).toHaveLength(1);
    expect(result[0].loan_id).toBe('L004');
  });

  test('strips legal suffixes on both notice and tape sides', () => {
    const result = matchNoticeToLoans(MATURITY_EXT, SYNTHETIC_LOAN_TAPE);
    expect(result).toHaveLength(1);
    expect(result[0].loan_id).toBe('L003');
  });

  test('logs ERROR when obligor has no match', () => {
    const logs: Array<{ level: string; message: string }> = [];
    const result = matchNoticeToLoans(AMBIGUOUS, SYNTHETIC_LOAN_TAPE, (level, message) => {
      logs.push({ level, message });
    });
    expect(result).toHaveLength(0);
    expect(logs.some(l => l.level === 'ERROR' && l.message.includes('Multiple — see Schedule 1'))).toBe(true);
  });

  test('logs WARN when multiple loans match the same obligor', () => {
    // Apex Logistics has two loans — fuzzy match should warn
    const multiUpdate = makeUpdate({ obligor_name: 'Apex Logistics Holdings, LLC', updates: { spread: 450 } });
    const logs: Array<{ level: string; message: string }> = [];
    const result = matchNoticeToLoans(multiUpdate, SYNTHETIC_LOAN_TAPE, (level, message) => {
      logs.push({ level, message });
    });
    expect(result).toHaveLength(2);
    expect(logs.some(l => l.level === 'WARN' && l.message.includes('Multiple loans matched'))).toBe(true);
  });
});

// ── applyNoticeUpdate — individual notice tests ───────────────────────────────

describe('applyNoticeUpdate — rate reset', () => {
  test('updates spread on L001 and L002', () => {
    const { updatedTape } = applyNoticeUpdate(RATE_RESET, SYNTHETIC_LOAN_TAPE);
    expect(updatedTape.find(l => l.loan_id === 'L001')?.spread).toBe(450);
    expect(updatedTape.find(l => l.loan_id === 'L002')?.spread).toBe(450);
  });

  test('produces two change log entries (one per loan)', () => {
    const { changeLog } = applyNoticeUpdate(RATE_RESET, SYNTHETIC_LOAN_TAPE);
    expect(changeLog).toHaveLength(2);
    expect(changeLog.every(e => e.field === 'spread')).toBe(true);
    expect(changeLog.every(e => e.old_value === 425)).toBe(true);
    expect(changeLog.every(e => e.new_value === 450)).toBe(true);
  });
});

describe('applyNoticeUpdate — paydown (fuzzy name match)', () => {
  test('updates principal_balance on L004 via obligor name match', () => {
    const { updatedTape } = applyNoticeUpdate(PAYDOWN, SYNTHETIC_LOAN_TAPE);
    expect(updatedTape.find(l => l.loan_id === 'L004')?.principal_balance).toBe(7.5);
  });

  test('change log records old value of 10.0', () => {
    const { changeLog } = applyNoticeUpdate(PAYDOWN, SYNTHETIC_LOAN_TAPE);
    const entry = changeLog.find(e => e.loan_id === 'L004' && e.field === 'principal_balance');
    expect(entry?.old_value).toBe(10.0);
    expect(entry?.new_value).toBe(7.5);
  });
});

describe('applyNoticeUpdate — PIK election', () => {
  test('sets is_current_pay=false and is_deferrable=true on L005', () => {
    const { updatedTape } = applyNoticeUpdate(PIK_ELECTION, SYNTHETIC_LOAN_TAPE);
    const l005 = updatedTape.find(l => l.loan_id === 'L005');
    expect(l005?.is_current_pay).toBe(false);
    expect(l005?.is_deferrable).toBe(true);
  });

  test('produces two change log entries for L005', () => {
    const { changeLog } = applyNoticeUpdate(PIK_ELECTION, SYNTHETIC_LOAN_TAPE);
    expect(changeLog.filter(e => e.loan_id === 'L005')).toHaveLength(2);
    expect(changeLog.find(e => e.field === 'is_current_pay')?.old_value).toBe(true);
    expect(changeLog.find(e => e.field === 'is_deferrable')?.old_value).toBe(false);
  });
});

describe('applyNoticeUpdate — maturity extension (fuzzy name match)', () => {
  test('updates maturity_date on L003 to 2030-07-30', () => {
    const { updatedTape } = applyNoticeUpdate(MATURITY_EXT, SYNTHETIC_LOAN_TAPE);
    expect(updatedTape.find(l => l.loan_id === 'L003')?.maturity_date).toBe('2030-07-30');
  });

  test('change log records old maturity date as 2028-07-30', () => {
    const { changeLog } = applyNoticeUpdate(MATURITY_EXT, SYNTHETIC_LOAN_TAPE);
    const entry = changeLog.find(e => e.field === 'maturity_date');
    expect(entry?.old_value).toBe('2028-07-30');
    expect(entry?.new_value).toBe('2030-07-30');
    expect(entry?.effective_date).toBe('2025-04-01');
  });
});

describe('applyNoticeUpdate — ambiguous amendment', () => {
  test('returns zero changes when no loans match', () => {
    const { changeLog } = applyNoticeUpdate(AMBIGUOUS, SYNTHETIC_LOAN_TAPE);
    expect(changeLog).toHaveLength(0);
  });

  test('logs an ERROR for unmatched obligor', () => {
    const { logs } = applyNoticeUpdate(AMBIGUOUS, SYNTHETIC_LOAN_TAPE);
    expect(logs.some(l => l.level === 'ERROR')).toBe(true);
  });

  test('tape is returned unchanged', () => {
    const { updatedTape } = applyNoticeUpdate(AMBIGUOUS, SYNTHETIC_LOAN_TAPE);
    expect(updatedTape).toHaveLength(SYNTHETIC_LOAN_TAPE.length);
    expect(updatedTape.find(l => l.loan_id === 'L001')?.spread)
      .toBe(SYNTHETIC_LOAN_TAPE.find(l => l.loan_id === 'L001')?.spread);
  });
});

// ── Audit trail invariants ────────────────────────────────────────────────────

describe('change log audit trail', () => {
  test('every entry is attributed to the correct notice_id', () => {
    const { changeLog } = applyNoticeUpdate(RATE_RESET, SYNTHETIC_LOAN_TAPE);
    expect(changeLog.every(e => e.notice_id === 'nr-001')).toBe(true);
  });

  test('effective_date propagated from notice into every entry', () => {
    const { changeLog } = applyNoticeUpdate(PAYDOWN, SYNTHETIC_LOAN_TAPE);
    expect(changeLog.every(e => e.effective_date === '2025-03-05')).toBe(true);
  });

  test('null effective_date on ambiguous notice propagates (even if no entries)', () => {
    // Verify the structure is consistent — null propagates if entries exist
    const update = makeUpdate({
      ...PAYDOWN,
      notice_id: 'null-date',
      effective_date: null,
      updates: { spread: 999 },
    });
    const { changeLog } = applyNoticeUpdate(update, SYNTHETIC_LOAN_TAPE);
    expect(changeLog.every(e => e.effective_date === null)).toBe(true);
  });

  test('unchanged fields do not appear in change log', () => {
    const { changeLog } = applyNoticeUpdate(RATE_RESET, SYNTHETIC_LOAN_TAPE);
    // Rate reset only touches spread; principal_balance should not appear
    expect(changeLog.some(e => e.field === 'principal_balance')).toBe(false);
  });
});

// ── Immutability ──────────────────────────────────────────────────────────────

test('does not mutate the original tape', () => {
  const originalSpread = SYNTHETIC_LOAN_TAPE.find(l => l.loan_id === 'L001')!.spread;
  applyNoticeUpdate(RATE_RESET, SYNTHETIC_LOAN_TAPE);
  expect(SYNTHETIC_LOAN_TAPE.find(l => l.loan_id === 'L001')!.spread).toBe(originalSpread);
});

// ── All five notices applied sequentially to the same tape ───────────────────

test('applying all five notices in effective_date order yields correct final tape', () => {
  // Sort by effective_date, nulls last
  const notices = [RATE_RESET, PAYDOWN, PIK_ELECTION, MATURITY_EXT, AMBIGUOUS].sort((a, b) => {
    if (!a.effective_date) return 1;
    if (!b.effective_date) return -1;
    return a.effective_date < b.effective_date ? -1 : 1;
  });

  let tape: LoanPosition[] = [...SYNTHETIC_LOAN_TAPE];
  let totalChanges = 0;
  const affectedLoans = new Set<string>();

  for (const update of notices) {
    const { updatedTape, changeLog } = applyNoticeUpdate(update, tape);
    tape = updatedTape;
    changeLog.forEach(e => affectedLoans.add(e.loan_id));
    totalChanges += changeLog.length;
  }

  // All four high-confidence notices applied
  expect(tape.find(l => l.loan_id === 'L001')?.spread).toBe(450);
  expect(tape.find(l => l.loan_id === 'L002')?.spread).toBe(450);
  expect(tape.find(l => l.loan_id === 'L004')?.principal_balance).toBe(7.5);
  expect(tape.find(l => l.loan_id === 'L005')?.is_current_pay).toBe(false);
  expect(tape.find(l => l.loan_id === 'L003')?.maturity_date).toBe('2030-07-30');

  // Ambiguous notice produced zero changes
  expect(totalChanges).toBe(6);   // 2 spread + 1 par + 2 PIK fields + 1 maturity
  expect(affectedLoans.size).toBe(5);  // L001, L002, L003, L004, L005

  // Unaffected loans are untouched
  expect(tape.find(l => l.loan_id === 'L006')?.spread).toBe(
    SYNTHETIC_LOAN_TAPE.find(l => l.loan_id === 'L006')?.spread,
  );
});
