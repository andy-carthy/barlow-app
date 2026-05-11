import { useEffect, useState } from 'react';
import { generateNarrative } from '../api/anthropic';

// ── Narrative hook ────────────────────────────────────────────────────────────
// One API call for all failures; paragraphs split on blank lines and zipped
// with the ordered failures array so each row gets its own text.

function useNarrative(coverageResults, concentrationResults) {
  const [map, setMap]         = useState({});   // id → paragraph
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const failures = [
      ...(coverageResults  || []).filter(r => r.result === 'FAIL'),
      ...(concentrationResults || []).filter(r => r.result === 'FAIL'),
    ];

    setMap({});
    if (failures.length === 0) return;

    let cancelled = false;
    setLoading(true);

    generateNarrative(failures)
      .then(text => {
        if (cancelled || !text) return;
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
        const next = {};
        failures.forEach((f, i) => {
          next[f.test_id ?? f.limit_id] = paragraphs[i] ?? paragraphs[paragraphs.length - 1] ?? '';
        });
        setMap(next);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [coverageResults, concentrationResults]); // eslint-disable-line react-hooks/exhaustive-deps

  return { map, loading };
}

// ── Badges ────────────────────────────────────────────────────────────────────

function PassBadge() {
  return <span style={s.passBadge}>PASS</span>;
}
function FailBadge() {
  return <span style={s.failBadge}>FAIL</span>;
}
function Badge({ result }) {
  return result === 'PASS' ? <PassBadge /> : <FailBadge />;
}

// ── Inline narrative row (colspan across all columns) ─────────────────────────

function NarrativeRow({ colSpan, text, loading, extra }) {
  if (!loading && !text && !extra) return null;
  return (
    <tr>
      <td colSpan={colSpan} style={s.narrativeTd}>
        {loading && <span style={s.narrativePending}>Generating exception narrative…</span>}
        {!loading && text && <p style={s.narrativeText}>{text}</p>}
        {extra}
      </td>
    </tr>
  );
}

// ── Coverage test table ───────────────────────────────────────────────────────

function CoverageTable({ results, narrativeMap, narrativeLoading }) {
  if (!results?.length) return null;
  return (
    <section>
      <h3 style={s.sectionTitle}>Coverage Tests</h3>
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Test</th>
              <th style={{ ...s.th, ...s.thRight }}>Calculated</th>
              <th style={{ ...s.th, ...s.thRight }}>Threshold</th>
              <th style={{ ...s.th, ...s.thRight }}>Cushion</th>
              <th style={{ ...s.th, textAlign: 'center' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => {
              const fail     = r.result === 'FAIL';
              const cushionC = r.cushion_pct >= 0 ? 'var(--color-pass)' : 'var(--color-fail)';
              const narrative = narrativeMap[r.test_id];
              const extra = fail && r.failure_action
                ? <p style={s.actionText}><strong>Required action:</strong> {r.failure_action}</p>
                : null;

              return [
                <tr key={r.test_id} style={fail ? s.failRow : s.passRow}>
                  <td style={s.td}>
                    <code style={s.ruleId}>{r.test_id}</code>
                    <span style={s.clause}>{r.source_clause}</span>
                  </td>
                  <td style={{ ...s.td, ...s.tdRight }}>{r.calculated_pct}%</td>
                  <td style={{ ...s.td, ...s.tdRight }}>{r.threshold_pct}%</td>
                  <td style={{ ...s.td, ...s.tdRight, color: cushionC, fontWeight: 600 }}>
                    {r.cushion_pct >= 0 ? '+' : ''}{r.cushion_pct}%
                  </td>
                  <td style={{ ...s.td, textAlign: 'center' }}><Badge result={r.result} /></td>
                </tr>,
                fail && (
                  <NarrativeRow
                    key={`${r.test_id}-narrative`}
                    colSpan={5}
                    text={narrative}
                    loading={narrativeLoading && !narrative}
                    extra={extra}
                  />
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Concentration limit table ─────────────────────────────────────────────────

function ConcentrationTable({ results, narrativeMap, narrativeLoading }) {
  if (!results?.length) return null;
  return (
    <section>
      <h3 style={s.sectionTitle}>Concentration Limits</h3>
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Limit</th>
              <th style={{ ...s.th, ...s.thRight }}>Max</th>
              <th style={{ ...s.th, ...s.thRight }}>Pool Par</th>
              <th style={{ ...s.th, ...s.thRight }}>Breaches</th>
              <th style={{ ...s.th, textAlign: 'center' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => {
              const fail      = r.result === 'FAIL';
              const narrative = narrativeMap[r.limit_id];
              const extra     = fail ? <BreachDetail result={r} /> : null;

              return [
                <tr key={r.limit_id} style={fail ? s.failRow : s.passRow}>
                  <td style={s.td}>
                    <code style={s.ruleId}>{r.limit_id}</code>
                    <span style={s.clause}>{r.source_clause}</span>
                  </td>
                  <td style={{ ...s.td, ...s.tdRight }}>{r.max_pct}%</td>
                  <td style={{ ...s.td, ...s.tdRight }}>${r.total_par_basis}M</td>
                  <td style={{ ...s.td, ...s.tdRight, color: fail ? 'var(--color-fail)' : 'var(--color-pass)', fontWeight: 600 }}>
                    {r.breach_count}
                  </td>
                  <td style={{ ...s.td, textAlign: 'center' }}><Badge result={r.result} /></td>
                </tr>,
                fail && (
                  <NarrativeRow
                    key={`${r.limit_id}-narrative`}
                    colSpan={5}
                    text={narrative}
                    loading={narrativeLoading && !narrative}
                    extra={extra}
                  />
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BreachDetail({ result }) {
  if (!result.breaches?.length) return null;
  return (
    <table style={s.breachTable}>
      <thead>
        <tr>
          <th style={s.bth}>Item</th>
          <th style={{ ...s.bth, textAlign: 'right' }}>Par ($M)</th>
          <th style={{ ...s.bth, textAlign: 'right' }}>% of Pool</th>
          <th style={{ ...s.bth, textAlign: 'right' }}>Excess</th>
        </tr>
      </thead>
      <tbody>
        {result.breaches.map((b, i) => (
          <tr key={i}>
            <td style={s.btd}>{b.item}{b.loans ? ` — ${b.loans.join(', ')}` : ''}</td>
            <td style={{ ...s.btd, textAlign: 'right' }}>{b.par_value}</td>
            <td style={{ ...s.btd, textAlign: 'right', color: 'var(--color-fail)', fontWeight: 600 }}>{b.pct}%</td>
            <td style={{ ...s.btd, textAlign: 'right', color: 'var(--color-fail)' }}>+{(b.pct - result.max_pct).toFixed(2)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ coverageResults, concentrationResults }) {
  const all      = [...(coverageResults || []), ...(concentrationResults || [])];
  const passed   = all.filter(r => r.result === 'PASS').length;
  const failed   = all.filter(r => r.result === 'FAIL').length;
  const allPass  = failed === 0 && all.length > 0;

  return (
    <div style={{ ...s.summary, borderColor: allPass ? 'var(--color-pass-border)' : 'var(--color-fail-border)', background: allPass ? 'var(--color-pass-tint)' : 'var(--color-fail-tint)' }}>
      <span style={s.summaryTitle}>{allPass ? '✓ All tests passed' : `${failed} test${failed !== 1 ? 's' : ''} failed`}</span>
      <span style={s.summaryDetail}>
        <span style={s.passCount}>{passed} PASS</span>
        {failed > 0 && <span style={s.failCount}>{failed} FAIL</span>}
        <span style={s.totalCount}>{all.length} total</span>
      </span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function TestResults({ testResults }) {
  const coverage      = testResults?.coverage      ?? null;
  const concentration = testResults?.concentration ?? null;

  const { map: narrativeMap, loading: narrativeLoading } = useNarrative(coverage, concentration);

  if (!testResults) {
    return <p style={s.empty}>Run tests to see results.</p>;
  }

  return (
    <div style={s.container}>
      <SummaryBar coverageResults={coverage} concentrationResults={concentration} />
      <CoverageTable
        results={coverage}
        narrativeMap={narrativeMap}
        narrativeLoading={narrativeLoading}
      />
      <ConcentrationTable
        results={concentration}
        narrativeMap={narrativeMap}
        narrativeLoading={narrativeLoading}
      />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  container:   { display: 'flex', flexDirection: 'column', gap: 24 },
  empty:       { color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 },

  summary:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                 padding: '12px 16px', borderRadius: 8, border: '1px solid', gap: 12 },
  summaryTitle:{ fontWeight: 700, fontSize: 15, color: 'var(--color-text-primary)' },
  summaryDetail:{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 13 },
  passCount:   { fontWeight: 700, color: 'var(--color-pass)' },
  failCount:   { fontWeight: 700, color: 'var(--color-fail)' },
  totalCount:  { color: 'var(--color-text-muted)' },

  sectionTitle:{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)',
                 textTransform: 'uppercase', letterSpacing: '0.08em' },

  tableWrap:   { border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:          { padding: '9px 14px', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)',
                 fontWeight: 600, color: 'var(--color-text-primary)', textAlign: 'left', whiteSpace: 'nowrap' },
  thRight:     { textAlign: 'right' },
  td:          { padding: '10px 14px', borderBottom: '1px solid var(--color-border)', verticalAlign: 'middle' },
  tdRight:     { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  passRow:     { background: 'var(--color-surface)' },
  failRow:     { background: 'var(--color-fail-tint)' },

  ruleId:      { fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--color-text-primary)',
                 background: 'var(--color-bg)', padding: '1px 6px', borderRadius: 3, marginRight: 8 },
  clause:      { fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace' },

  passBadge:   { display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 12,
                 fontWeight: 700, background: 'var(--color-pass-tint)', color: 'var(--color-pass)' },
  failBadge:   { display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 12,
                 fontWeight: 700, background: 'var(--color-fail-tint)', color: 'var(--color-fail)' },

  narrativeTd: { padding: '10px 16px 14px', background: 'var(--color-bg)',
                 borderBottom: '1px solid var(--color-border)', borderLeft: '3px solid var(--color-border)' },
  narrativePending: { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' },
  narrativeText:    { margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.65,
                      maxWidth: 720 },
  actionText:  { margin: '6px 0 0', fontSize: 12, color: 'var(--color-flag)', background: 'var(--color-flag-tint)',
                 border: '1px solid var(--color-flag-border)', borderRadius: 4, padding: '6px 10px',
                 maxWidth: 720 },

  breachTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10,
                 border: '1px solid var(--color-border)', borderRadius: 4, overflow: 'hidden' },
  bth:         { padding: '5px 10px', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)',
                 fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' },
  btd:         { padding: '4px 10px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-primary)' },
};
