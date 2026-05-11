import { useState } from 'react';

// confidence → accent colour
const CONF = {
  HIGH:   { bg: 'var(--color-pass-tint)', text: 'var(--color-pass)', border: 'var(--color-pass-border)' },
  MEDIUM: { bg: 'var(--color-flag-tint)', text: 'var(--color-flag)', border: 'var(--color-flag-border)' },
  LOW:    { bg: 'var(--color-fail-tint)', text: 'var(--color-fail)', border: 'var(--color-fail-border)' },
};

const isFlagged = (confidence) => confidence === 'MEDIUM' || confidence === 'LOW';

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }) {
  const c = CONF[confidence] || CONF.HIGH;
  return (
    <span style={{ ...s.badge, background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {confidence}
    </span>
  );
}

function FlagStrip({ reason }) {
  return (
    <div style={s.flagStrip}>
      <FlagIcon />
      <span>{reason}</span>
    </div>
  );
}

function Field({ label, children, span }) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : {}}>
      <div style={s.fieldLabel}>{label}</div>
      <div style={s.fieldValue}>{children}</div>
    </div>
  );
}

function CoverageTestCard({ test }) {
  const flagged = isFlagged(test.confidence);
  return (
    <div style={{ ...s.card, ...(flagged ? s.cardFlagged : {}) }}>
      <div style={s.cardTop}>
        <code style={s.ruleId}>{test.test_id}</code>
        <ConfidenceBadge confidence={test.confidence} />
      </div>

      {flagged && <FlagStrip reason={test.confidence_reason} />}

      <div style={s.threshold}>{test.threshold_pct}%</div>
      <div style={s.thresholdLabel}>threshold</div>

      <p style={s.desc}>{test.description}</p>

      <div style={s.fields}>
        <Field label="Type">{test.test_type.replace('_', ' ')}</Field>
        <Field label="Source"><span style={s.mono}>{test.source_clause}</span></Field>
        <Field label="Numerator" span>{test.numerator}</Field>
        <Field label="Denominator" span>{test.denominator}</Field>
        <Field label="Failure action" span>{test.failure_action}</Field>
      </div>
    </div>
  );
}

function ConcentrationLimitCard({ limit }) {
  const flagged = isFlagged(limit.confidence);
  return (
    <div style={{ ...s.card, ...(flagged ? s.cardFlagged : {}) }}>
      <div style={s.cardTop}>
        <code style={s.ruleId}>{limit.limit_id}</code>
        <ConfidenceBadge confidence={limit.confidence} />
      </div>

      {flagged && <FlagStrip reason={limit.confidence_reason} />}

      <div style={s.threshold}>{limit.max_pct}%</div>
      <div style={s.thresholdLabel}>maximum</div>

      <p style={s.desc}>{limit.description}</p>

      <div style={s.fields}>
        <Field label="Dimension">{limit.dimension}</Field>
        <Field label="Source"><span style={s.mono}>{limit.source_clause}</span></Field>
        <Field label="Calculation basis" span>{limit.calculation_basis}</Field>
        {limit.notes && <Field label="Notes" span>{limit.notes}</Field>}
      </div>
    </div>
  );
}

function GlobalFlagsBanner({ flags }) {
  const [open, setOpen] = useState(false);
  if (!flags?.length) return null;
  return (
    <div style={s.globalFlags}>
      <button style={s.flagToggle} onClick={() => setOpen(o => !o)}>
        <FlagIcon />
        <strong>{flags.length} extraction flag{flags.length > 1 ? 's' : ''}</strong>
        <span style={s.flagToggleHint}>{open ? '— click to collapse' : '— click to expand'}</span>
      </button>
      {open && (
        <ul style={s.flagItems}>
          {flags.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'tests',     label: 'Coverage Tests'       },
  { id: 'limits',    label: 'Concentration Limits'  },
  { id: 'waterfall', label: 'Waterfall'             },
];

export default function RulesPanel({ extractedRules }) {
  const [tab, setTab] = useState('tests');

  if (!extractedRules) {
    return <p style={s.empty}>Extract an indenture to view rules.</p>;
  }

  const { coverage_tests, concentration_limits, waterfall, extraction_summary } = extractedRules;

  const tabCount = {
    tests:     coverage_tests.length,
    limits:    concentration_limits.length,
    waterfall: waterfall.length,
  };

  return (
    <div style={s.container}>

      {/* Deal header */}
      <div style={s.dealHeader}>
        <div>
          <h2 style={s.dealName}>{extractedRules.deal_name}</h2>
          <span style={s.dealMeta}>
            {extraction_summary.tests_found} coverage tests &middot;&nbsp;
            {extraction_summary.limits_found} concentration limits &middot;&nbsp;
            {extraction_summary.waterfall_steps_found} waterfall steps
          </span>
        </div>
        <ConfidenceBadge confidence={extraction_summary.overall_confidence} />
      </div>

      {/* Global flags banner */}
      <GlobalFlagsBanner flags={extraction_summary.flags} />

      {/* Tabs */}
      <div style={s.tabs}>
        {TABS.map(t => (
          <button
            key={t.id}
            style={tab === t.id ? s.tabActive : s.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span style={tab === t.id ? s.tabCountActive : s.tabCount}>
              {tabCount[t.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Coverage Tests — two-column grid */}
      {tab === 'tests' && (
        <div style={s.grid}>
          {coverage_tests.map(t => <CoverageTestCard key={t.test_id} test={t} />)}
        </div>
      )}

      {/* Concentration Limits — two-column grid */}
      {tab === 'limits' && (
        <div style={s.grid}>
          {concentration_limits.map(l => <ConcentrationLimitCard key={l.limit_id} limit={l} />)}
        </div>
      )}

      {/* Waterfall — single column step list */}
      {tab === 'waterfall' && (
        <div style={s.waterfallList}>
          {waterfall.map(w => (
            <div key={w.step} style={s.waterfallRow}>
              <div style={s.stepBubble}>{w.step}</div>
              <div style={s.stepBody}>
                <div style={s.stepPayee}>{w.payee}</div>
                <div style={s.stepMeta}>
                  <span style={s.payeeChip}>{w.payee_type}</span>
                  <span style={s.mono}>{w.source_clause}</span>
                </div>
                {w.conditions && (
                  <div style={s.stepCondition}>
                    <ConditionIcon /> {w.conditions}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Icons (inline SVG, no dependency) ────────────────────────────────────────

function FlagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

function ConditionIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  container:       { display: 'flex', flexDirection: 'column', gap: 16 },
  empty:           { color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 },

  dealHeader:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  dealName:        { margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--color-text-primary)' },
  dealMeta:        { fontSize: 12, color: 'var(--color-text-muted)' },

  badge:           { display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700,
                     padding: '2px 8px', borderRadius: 4, letterSpacing: '0.04em', whiteSpace: 'nowrap' },

  globalFlags:     { background: 'var(--color-flag-tint)', border: '1px solid var(--color-flag-border)', borderRadius: 7, overflow: 'hidden' },
  flagToggle:      { display: 'flex', alignItems: 'center', gap: 7, width: '100%', background: 'none',
                     border: 'none', padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
                     fontSize: 13, color: 'var(--color-flag)' },
  flagToggleHint:  { color: 'var(--color-flag)', fontWeight: 400 },
  flagItems:       { margin: 0, paddingLeft: 36, paddingBottom: 12, paddingRight: 14 },

  tabs:            { display: 'flex', gap: 2, borderBottom: '2px solid var(--color-border)' },
  tab:             { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                     border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
                     color: 'var(--color-text-muted)', borderBottom: '2px solid transparent', marginBottom: -2 },
  tabActive:       { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                     border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
                     color: 'var(--color-text-primary)', fontWeight: 700, borderBottom: '2px solid var(--color-text-primary)', marginBottom: -2 },
  tabCount:        { fontSize: 11, fontWeight: 700, background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                     padding: '1px 6px', borderRadius: 10 },
  tabCountActive:  { fontSize: 11, fontWeight: 700, background: 'var(--color-text-primary)', color: 'var(--color-surface)',
                     padding: '1px 6px', borderRadius: 10 },

  // Two-column grid
  grid:            { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },

  // Card base
  card:            { border: '1px solid var(--color-border)', borderRadius: 9, padding: '16px', background: 'var(--color-surface)',
                     display: 'flex', flexDirection: 'column', gap: 0 },
  cardFlagged:     { borderColor: 'var(--color-flag-border)', background: 'var(--color-flag-tint)',
                     boxShadow: 'inset 4px 0 0 var(--color-flag)' },

  cardTop:         { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  ruleId:          { fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary)',
                     background: 'var(--color-bg)', padding: '2px 7px', borderRadius: 4 },

  flagStrip:       { display: 'flex', alignItems: 'flex-start', gap: 6, background: 'var(--color-flag-tint)',
                     border: '1px solid var(--color-flag-border)', borderRadius: 5, padding: '7px 10px',
                     fontSize: 12, color: 'var(--color-flag)', marginBottom: 12, lineHeight: 1.4 },

  threshold:       { fontSize: 26, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1, marginBottom: 2 },
  thresholdLabel:  { fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase',
                     letterSpacing: '0.06em', marginBottom: 10 },
  desc:            { margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5 },

  fields:          { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px',
                     borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 'auto' },
  fieldLabel:      { fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase',
                     letterSpacing: '0.06em', marginBottom: 2 },
  fieldValue:      { fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.45 },
  mono:            { fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-muted)' },

  // Waterfall
  waterfallList:   { display: 'flex', flexDirection: 'column' },
  waterfallRow:    { display: 'flex', gap: 14, padding: '12px 0',
                     borderBottom: '1px solid var(--color-border)', alignItems: 'flex-start' },
  stepBubble:      { width: 30, height: 30, borderRadius: '50%', background: 'var(--color-text-primary)',
                     color: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                     fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  stepBody:        { flex: 1 },
  stepPayee:       { fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 },
  stepMeta:        { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 },
  payeeChip:       { fontSize: 11, fontWeight: 600, background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                     padding: '1px 7px', borderRadius: 4 },
  stepCondition:   { display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 12,
                     color: 'var(--color-flag)', fontStyle: 'italic', lineHeight: 1.4 },
};
