import { LoanPosition } from '../types/loan';
import { NoticeUpdate }  from '../types/notice';
import { ChangeLogEntry } from '../types/changelog';

// ── Public types ──────────────────────────────────────────────────────────────

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export interface LogEntry { level: LogLevel; message: string; }

export interface ApplyResult {
  updatedTape: LoanPosition[];
  changeLog:   ChangeLogEntry[];
  logs:        LogEntry[];
}

// ── Name normalisation ────────────────────────────────────────────────────────
// Strip punctuation and common legal suffixes so "Castle Health Group, Inc."
// matches "Castle Health" in the loan tape.

const LEGAL_SUFFIXES =
  /\b(llc|lp|llp|ltd|inc|corp|co|holdings?|group|company|limited|partners?|partnership|international|intl|industries|enterprises|n\.?a\.?|trust|bank)\b/gi;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bn\.a\./gi, 'na')           // collapse "N.A." before dots are stripped
    .replace(/[.,/#!$%^&*;:{}=\-_`~()']/g, ' ')
    .replace(LEGAL_SUFFIXES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Loan matching ─────────────────────────────────────────────────────────────

type LogFn = (level: LogLevel, message: string) => void;

export function matchNoticeToLoans(
  update: NoticeUpdate,
  tape:   LoanPosition[],
  log:    LogFn = () => { /* noop */ },
): LoanPosition[] {
  // Prefer explicit loan_ids — no normalisation needed
  if (update.loan_ids.length > 0) {
    const idSet = new Set(update.loan_ids);
    return tape.filter(l => idSet.has(l.loan_id));
  }

  // Fuzzy obligor-name match
  const normalizedNotice = normalizeName(update.obligor_name);
  const matched = tape.filter(
    l => normalizeName(l.obligor_name) === normalizedNotice,
  );

  if (matched.length === 0) {
    log('ERROR', `Could not match notice obligor "${update.obligor_name}" to any loan in tape`);
    return [];
  }

  if (matched.length > 1) {
    log(
      'WARN',
      `Multiple loans matched for obligor "${update.obligor_name}" — applying update to all matched positions`,
    );
  }

  return matched;
}

// ── Update application ────────────────────────────────────────────────────────

export function applyNoticeUpdate(
  update: NoticeUpdate,
  tape:   LoanPosition[],
): ApplyResult {
  const logEntries: LogEntry[] = [];
  const log: LogFn = (level, message) => logEntries.push({ level, message });

  const matchedLoans = matchNoticeToLoans(update, tape, log);
  const matchedIds   = new Set(matchedLoans.map(l => l.loan_id));
  const changeLog:   ChangeLogEntry[] = [];

  if (update.extraction_confidence === 'LOW' && matchedLoans.length > 0) {
    log(
      'WARN',
      `Applying LOW-confidence update from notice ${update.notice_id} — manual verification recommended`,
    );
  }

  const updatedTape = tape.map(loan => {
    if (!matchedIds.has(loan.loan_id)) return loan;

    const updatedLoan = { ...loan } as Record<string, unknown>;

    for (const [field, newValue] of Object.entries(update.updates)) {
      if (newValue === undefined) continue;
      const oldValue = (loan as Record<string, unknown>)[field];
      updatedLoan[field] = newValue;
      changeLog.push({
        loan_id:        loan.loan_id,
        field,
        old_value:      oldValue,
        new_value:      newValue,
        notice_id:      update.notice_id,
        effective_date: update.effective_date,
      });
    }

    return updatedLoan as LoanPosition;
  });

  if (matchedIds.size > 0) {
    const fc = changeLog.length;
    log(
      'INFO',
      `Applied notice ${update.notice_id} (${update.notice_type}): ` +
        `${fc} field change${fc !== 1 ? 's' : ''} across ${matchedIds.size} loan${matchedIds.size !== 1 ? 's' : ''}`,
    );
  }

  return { updatedTape, changeLog, logs: logEntries };
}
