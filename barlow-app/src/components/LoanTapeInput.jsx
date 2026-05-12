import { useState } from 'react';

export const DEFAULT_LOAN_TAPE = [
  { id: 'L001', obligor: 'Apex Logistics',     industry: 'Transportation',    country: 'US',     par:  8.0, spread: 425, rating: 'B',    status: 'Current', accrued_interest: 0.61, loan_type: 'SENIOR_SECURED' },
  { id: 'L002', obligor: 'Apex Logistics',     industry: 'Transportation',    country: 'US',     par:  6.5, spread: 425, rating: 'B',    status: 'Current', accrued_interest: 0.57, loan_type: 'SENIOR_SECURED' },
  { id: 'L003', obligor: 'Bravo Media',        industry: 'Media & Ent.',      country: 'US',     par: 10.0, spread: 375, rating: 'B',    status: 'Current', accrued_interest: 0.41, loan_type: 'SENIOR_SECURED' },
  { id: 'L004', obligor: 'Castle Health',      industry: 'Healthcare',        country: 'US',     par: 10.0, spread: 450, rating: 'BB',   status: 'Current', accrued_interest: 0.42, loan_type: 'SENIOR_SECURED' },
  { id: 'L005', obligor: 'Delta Energy',       industry: 'Oil & Gas',         country: 'US',     par: 10.0, spread: 500, rating: 'CCC',  status: 'Current', accrued_interest: 0.38, loan_type: 'SENIOR_SECURED' },
  { id: 'L006', obligor: 'Echo Software',      industry: 'Technology',        country: 'US',     par: 10.0, spread: 350, rating: 'B',    status: 'Current', accrued_interest: 0.54, loan_type: 'SENIOR_SECURED' },
  { id: 'L007', obligor: 'Foxtrot Retail',     industry: 'Retail',            country: 'US',     par:  9.5, spread: 550, rating: 'CCC',  status: 'Current', accrued_interest: 0.34, loan_type: 'SENIOR_SECURED' },
  { id: 'L008', obligor: 'Golf Pharma',        industry: 'Healthcare',        country: 'US',     par: 10.0, spread: 400, rating: 'BB',   status: 'Current', accrued_interest: 0.48, loan_type: 'SENIOR_SECURED' },
  { id: 'L009', obligor: 'Hotel Group',        industry: 'Lodging',           country: 'US',     par: 10.0, spread: 475, rating: 'B',    status: 'Current', accrued_interest: 0.45, loan_type: 'SENIOR_SECURED' },
  { id: 'L010', obligor: 'India Steel',        industry: 'Metals',            country: 'US',     par: 10.0, spread: 525, rating: 'BB',   status: 'Current', accrued_interest: 0.43, loan_type: 'SENIOR_SECURED' },
  { id: 'L011', obligor: 'Juliet Auto',        industry: 'Automotive',        country: 'US',     par: 10.0, spread: 410, rating: 'B',    status: 'Current', accrued_interest: 0.43, loan_type: 'SENIOR_SECURED' },
  { id: 'L012', obligor: 'Kilo Foods',         industry: 'Beverage/Food',     country: 'US',     par: 10.0, spread: 365, rating: 'BB',   status: 'Current', accrued_interest: 0.47, loan_type: 'SENIOR_SECURED' },
  { id: 'L013', obligor: 'Lima Telecom',       industry: 'Telecom',           country: 'US',     par: 10.0, spread: 440, rating: 'B',    status: 'Current', accrued_interest: 0.44, loan_type: 'SENIOR_SECURED' },
  { id: 'L014', obligor: 'Mike Defense',       industry: 'Aerospace',         country: 'US',     par: 10.0, spread: 390, rating: 'BB',   status: 'Current', accrued_interest: 0.34, loan_type: 'SENIOR_SECURED' },
  { id: 'L015', obligor: 'November Bldg',      industry: 'Construction',      country: 'US',     par:  9.0, spread: 510, rating: 'CCC',  status: 'Current', accrued_interest: 0.36, loan_type: 'SENIOR_SECURED' },
  { id: 'L016', obligor: 'Oscar Finance',      industry: 'Financial Svcs',    country: 'US',     par: 10.0, spread: 420, rating: 'B',    status: 'Current', accrued_interest: 0.48, loan_type: 'SENIOR_SECURED' },
  { id: 'L017', obligor: 'Papa Chemical',      industry: 'Chemicals',         country: 'US',     par: 10.0, spread: 460, rating: 'BB',   status: 'Current', accrued_interest: 0.41, loan_type: 'SENIOR_SECURED' },
  { id: 'L018', obligor: 'Quebec Mining',      industry: 'Metals',            country: 'Canada', par:  8.5, spread: 535, rating: 'CCC',  status: 'Current', accrued_interest: 0.36, loan_type: 'SENIOR_SECURED' },
  { id: 'L019', obligor: 'Romeo Fitness',      industry: 'Retail',            country: 'US',     par:  9.0, spread: 580, rating: 'CCC',  status: 'PIK',     accrued_interest: 0.00, loan_type: 'SENIOR_SECURED' },
  { id: 'L020', obligor: 'Sierra Waste',       industry: 'Environmental',     country: 'US',     par: 10.0, spread: 395, rating: 'B',    status: 'Current', accrued_interest: 0.44, loan_type: 'SENIOR_SECURED' },
  { id: 'L021', obligor: 'Atlas Networks',     industry: 'Software',          country: 'US',     par: 10.0, spread: 380, rating: 'BB',   status: 'Current', accrued_interest: 0.30, loan_type: 'SENIOR_SECURED' },
  { id: 'L022', obligor: 'Beacon Property',    industry: 'Real Estate',       country: 'US',     par: 10.0, spread: 395, rating: 'BB',   status: 'Current', accrued_interest: 0.28, loan_type: 'SENIOR_SECURED' },
  { id: 'L023', obligor: 'Crown Utilities',    industry: 'Utilities',         country: 'US',     par: 10.0, spread: 350, rating: 'BB',   status: 'Current', accrued_interest: 0.25, loan_type: 'SENIOR_SECURED' },
  { id: 'L024', obligor: 'Dunbar Insurance',   industry: 'Insurance',         country: 'US',     par: 10.0, spread: 370, rating: 'BB',   status: 'Current', accrued_interest: 0.27, loan_type: 'SENIOR_SECURED' },
  { id: 'L025', obligor: 'Eagle Agriculture',  industry: 'Agriculture',       country: 'US',     par: 10.0, spread: 410, rating: 'BB',   status: 'Current', accrued_interest: 0.31, loan_type: 'SENIOR_SECURED' },
  { id: 'L026', obligor: 'Frontier Defense',   industry: 'Defense',           country: 'US',     par: 10.0, spread: 360, rating: 'BB',   status: 'Current', accrued_interest: 0.26, loan_type: 'SENIOR_SECURED' },
  { id: 'L027', obligor: 'Gemstone Gaming',    industry: 'Gaming',            country: 'US',     par: 10.0, spread: 420, rating: 'BB',   status: 'Current', accrued_interest: 0.32, loan_type: 'SENIOR_SECURED' },
  { id: 'L028', obligor: 'Harbor Packaging',   industry: 'Packaging',         country: 'US',     par: 10.0, spread: 385, rating: 'BB',   status: 'Current', accrued_interest: 0.29, loan_type: 'SENIOR_SECURED' },
  { id: 'L029', obligor: 'Ironwood Consumer',  industry: 'Consumer Products', country: 'US',     par: 10.0, spread: 400, rating: 'BB',   status: 'Current', accrued_interest: 0.30, loan_type: 'SENIOR_SECURED' },
  { id: 'L030', obligor: 'Jade Education',     industry: 'Education',         country: 'US',     par: 10.0, spread: 375, rating: 'BB',   status: 'Current', accrued_interest: 0.28, loan_type: 'SENIOR_SECURED' },
  { id: 'L031', obligor: 'Keystone Shipping',  industry: 'Shipping',          country: 'US',     par: 10.0, spread: 415, rating: 'BB',   status: 'Current', accrued_interest: 0.32, loan_type: 'SENIOR_SECURED' },
  { id: 'L032', obligor: 'Lantern Biz Svcs',   industry: 'Business Services', country: 'US',     par: 10.0, spread: 390, rating: 'BB',   status: 'Current', accrued_interest: 0.29, loan_type: 'SENIOR_SECURED' },
  { id: 'L033', obligor: 'Marble Pharma',      industry: 'Pharmaceuticals',   country: 'US',     par: 10.0, spread: 365, rating: 'BB',   status: 'Current', accrued_interest: 0.27, loan_type: 'SENIOR_SECURED' },
  { id: 'L034', obligor: 'Nordic Mining Co',   industry: 'Mining',            country: 'US',     par: 10.0, spread: 430, rating: 'BB',   status: 'Current', accrued_interest: 0.33, loan_type: 'SENIOR_SECURED' },
  { id: 'L035', obligor: 'Orbit Mfg Group',    industry: 'Industrials',       country: 'US',     par: 10.0, spread: 380, rating: 'BB',   status: 'Current', accrued_interest: 0.29, loan_type: 'SENIOR_SECURED' },
  { id: 'L036', obligor: 'Pacific Hospitality',industry: 'Hospitality',       country: 'US',     par: 10.0, spread: 395, rating: 'BB',   status: 'Current', accrued_interest: 0.30, loan_type: 'SENIOR_SECURED' },
  { id: 'L037', obligor: 'Quartz Media Tech',  industry: 'Media Technology',  country: 'US',     par: 10.0, spread: 370, rating: 'BB',   status: 'Current', accrued_interest: 0.28, loan_type: 'SENIOR_SECURED' },
];

const DEFAULT_JSON = JSON.stringify(DEFAULT_LOAN_TAPE, null, 2);

// ── Validation ────────────────────────────────────────────────────────────────
// Returns { loans: Array|null, error: string|null }
// Empty text is neither valid nor an error — button just stays disabled.

function validateJson(text) {
  if (!text.trim()) return { loans: null, error: null };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { loans: null, error: `JSON syntax error — ${e.message}` };
  }

  if (!Array.isArray(parsed)) {
    return { loans: null, error: 'Expected a JSON array of loan objects, e.g. [{...}, {...}]' };
  }

  if (parsed.length === 0) {
    return { loans: null, error: 'Array is empty — at least one loan object is required' };
  }

  for (let i = 0; i < parsed.length; i++) {
    const l = parsed[i];
    if (typeof l !== 'object' || l === null) {
      return { loans: null, error: `Item ${i + 1} is not an object` };
    }
    if (typeof l.par !== 'number') {
      return { loans: null, error: `Loan ${i + 1}${l.id ? ` (${l.id})` : ''}: "par" must be a number` };
    }
    if (typeof l.accrued_interest !== 'number') {
      return { loans: null, error: `Loan ${i + 1}${l.id ? ` (${l.id})` : ''}: "accrued_interest" must be a number` };
    }
    if (!l.obligor) {
      return { loans: null, error: `Loan ${i + 1}: missing required field "obligor"` };
    }
  }

  return { loans: parsed, error: null };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoanTapeInput({ onRunTests, loading, disabled }) {
  const [text, setText] = useState(DEFAULT_JSON);
  const { loans, error } = validateJson(text);

  const totalPar   = loans ? loans.reduce((s, l) => s + l.par, 0) : 0;
  const canRun     = !!loans && !disabled && !loading;
  const borderColor = error ? 'var(--color-fail-border)' : loans ? 'var(--color-pass-border)' : 'var(--color-border)';

  return (
    <div style={s.container}>

      <div style={s.header}>
        <div>
          <h2 style={s.title}>Loan Tape</h2>
          <p style={s.hint}>
            Paste a JSON array of loan objects. Each object must include{' '}
            <code style={s.code}>par</code>, <code style={s.code}>accrued_interest</code>, and{' '}
            <code style={s.code}>obligor</code>.
          </p>
        </div>
        <button style={s.resetBtn} onClick={() => setText(DEFAULT_JSON)}>
          Load default tape
        </button>
      </div>

      <textarea
        style={{ ...s.textarea, borderColor }}
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
      />

      {/* Inline validation feedback */}
      <div style={s.feedback}>
        {error && (
          <div style={s.errorMsg}>
            <ErrorIcon /> {error}
          </div>
        )}
        {!error && loans && (
          <div style={s.validMsg}>
            <CheckIcon /> {loans.length} loans · ${totalPar.toFixed(1)}M total par
          </div>
        )}
        {!error && !loans && (
          <div style={s.neutralMsg}>Paste JSON above to continue</div>
        )}

        <button
          style={canRun ? s.runBtn : s.runBtnDisabled}
          onClick={() => canRun && onRunTests(loans)}
          disabled={!canRun}
          title={disabled ? 'Extract indenture rules first' : !loans ? 'Fix JSON errors first' : ''}
        >
          {loading ? 'Running…' : 'Run Tests →'}
        </button>
      </div>

    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  container:     { display: 'flex', flexDirection: 'column', gap: 10 },

  header:        { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  title:         { margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' },
  hint:          { margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 },
  code:          { fontFamily: 'monospace', background: 'var(--color-bg)', padding: '1px 5px', borderRadius: 3, fontSize: 12 },
  resetBtn:      { flexShrink: 0, padding: '6px 14px', background: 'var(--color-surface)', color: 'var(--color-text-primary)',
                   border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                   whiteSpace: 'nowrap' },

  textarea:      { width: '100%', minHeight: 360, fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
                   fontSize: 12, lineHeight: 1.6, padding: '12px 14px',
                   border: '1.5px solid var(--color-border)', borderRadius: 7, resize: 'vertical',
                   boxSizing: 'border-box', background: 'var(--color-bg)', color: 'var(--color-text-primary)',
                   outline: 'none', transition: 'border-color 0.15s' },

  feedback:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },

  errorMsg:      { display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13,
                   color: 'var(--color-fail)', lineHeight: 1.4 },
  validMsg:      { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                   color: 'var(--color-pass)', fontWeight: 500 },
  neutralMsg:    { fontSize: 13, color: 'var(--color-text-muted)' },

  runBtn:        { flexShrink: 0, padding: '9px 22px', background: 'var(--color-text-primary)', color: 'var(--color-surface)',
                   border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  runBtnDisabled:{ flexShrink: 0, padding: '9px 22px', background: 'var(--color-border)', color: 'var(--color-text-muted)',
                   border: 'none', borderRadius: 6, cursor: 'not-allowed', fontWeight: 600, fontSize: 14 },
};
