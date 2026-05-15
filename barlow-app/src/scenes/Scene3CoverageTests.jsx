import { useEffect } from 'react';
import { useBarlowDemo } from '../context/BarlowDemoContext';
import { runTests } from '../api/barlowApi';

export default function Scene3CoverageTests() {
  const { state, patch, setScene } = useBarlowDemo();
  const { coverageTests, indenture, loanTape } = state;

  useEffect(() => {
    if (coverageTests.status === 'IDLE' && indenture.extractionOutput) {
      runCoverageTests();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCoverageTests(useFallback = false) {
    patch('coverageTests', { status: 'RUNNING', error: null });
    const { data, error } = await runTests(
      indenture.extractionOutput,
      loanTape.positions ?? [],
      { useFallback },
    );
    if (error || !data) {
      patch('coverageTests', { status: 'ERROR', error: error ?? 'Test run failed' });
      return;
    }
    patch('coverageTests', {
      status: 'COMPLETE',
      results: data.coverageResults,
      concentrationResults: data.concentrationResults,
    });
  }

  const { results, concentrationResults } = coverageTests;
  const isRunning = coverageTests.status === 'RUNNING';
  const isError   = coverageTests.status === 'ERROR';

  const coverageFails      = (results ?? []).filter(r => r.result === 'FAIL').length;
  const concentrationFails = (concentrationResults ?? []).filter(r => r.result === 'FAIL').length;
  const anyFail            = coverageFails + concentrationFails > 0;

  return (
    <div>
      {isRunning && (
        <div style={s.runningBanner}>
          <Spinner /> Running coverage tests…
        </div>
      )}

      {isError && (
        <div style={s.errorBanner}>
          Coverage tests failed — {coverageTests.error}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button style={s.btnSmall} onClick={() => runCoverageTests()}>Retry</button>
            <button style={s.btnSmallAlt} onClick={() => runCoverageTests(true)}>Use demo fixture instead</button>
          </div>
        </div>
      )}

      {anyFail && (
        <div style={s.warningBanner}>
          ⚠ OC/IC breach detected. Waterfall diversion will fire in Scene 4.
        </div>
      )}

      {results && (
        <section style={{ marginBottom: 32 }}>
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>OC / IC Coverage Tests</h2>
            <span style={s.summaryPill}>
              <span style={{ color: 'var(--color-pass)' }}>{results.filter(r=>r.result==='PASS').length} passing</span>
              {coverageFails > 0 && <> · <span style={{ color: 'var(--color-fail)' }}>{coverageFails} failing</span></>}
            </span>
          </div>
          <table style={s.table}>
            <thead><tr>
              <Th>Test</Th><Th>Section</Th><Th>Threshold</Th><Th>Actual</Th><Th>Cushion</Th><Th>Result</Th>
            </tr></thead>
            <tbody>
              {results.map(r => {
                const fail = r.result === 'FAIL';
                return (
                  <tr key={r.test_id} style={fail ? { background: 'var(--color-fail-tint)' } : {}}>
                    <Td><code>{r.test_id}</code></Td>
                    <Td style={{ color: 'var(--color-dusty-blue)' }}>{r.indenture_section ?? '—'}</Td>
                    <Td>{r.threshold?.toFixed(2)}%</Td>
                    <Td>{r.actual?.toFixed(2)}%</Td>
                    <Td style={{ color: r.cushion >= 0 ? 'var(--color-pass)' : 'var(--color-fail)', fontWeight: 600 }}>
                      {r.cushion >= 0 ? '+' : ''}{r.cushion?.toFixed(2)}%
                    </Td>
                    <Td>
                      <span style={fail ? s.badgeFail : s.badgePass}>
                        {fail ? '✗ FAIL' : '✓ PASS'}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {concentrationResults && (
        <section style={{ marginBottom: 32 }}>
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Concentration Limits</h2>
            <span style={s.summaryPill}>
              <span style={{ color: 'var(--color-pass)' }}>{concentrationResults.filter(r=>r.result==='PASS').length} passing</span>
              {concentrationFails > 0 && <> · <span style={{ color: 'var(--color-fail)' }}>{concentrationFails} failing</span></>}
            </span>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table style={s.table}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--color-surface)' }}><tr>
                <Th>Limit</Th><Th>Applies To</Th><Th>Max %</Th><Th>Actual %</Th><Th>Headroom</Th><Th>Result</Th>
              </tr></thead>
              <tbody>
                {concentrationResults.map(r => {
                  const fail = r.result === 'FAIL';
                  return (
                    <tr key={r.limit_id} style={fail ? { background: 'var(--color-fail-tint)' } : {}}>
                      <Td><code style={{ fontSize: 11 }}>{r.limit_id}</code></Td>
                      <Td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.description}</Td>
                      <Td>{r.max_pct?.toFixed(2)}%</Td>
                      <Td>{r.actual_pct?.toFixed(2)}%</Td>
                      <Td style={{ color: r.headroom >= 0 ? 'var(--color-pass)' : 'var(--color-fail)', fontWeight: 600 }}>
                        {r.headroom >= 0 ? '+' : ''}{r.headroom?.toFixed(2)}%
                      </Td>
                      <Td>
                        <span style={fail ? s.badgeFail : s.badgePass}>
                          {fail ? '✗ FAIL' : '✓ PASS'}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <button style={s.btnBack} onClick={() => setScene(1)}>← Back to Loan Tape</button>
        <button
          style={s.btnPrimary}
          disabled={coverageTests.status !== 'COMPLETE'}
          onClick={() => setScene(3)}
        >
          Run Waterfall →
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return <div style={{ width: 16, height: 16, border: '2px solid var(--color-border)', borderTopColor: 'var(--color-dusty-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block', marginRight: 8 }} />;
}

function Th({ children }) {
  return <th style={{ textAlign: 'left', padding: '7px 12px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap', background: 'var(--color-bg)' }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding: '7px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border)', verticalAlign: 'middle', ...style }}>{children}</td>;
}

const s = {
  runningBanner: { display: 'flex', alignItems: 'center', padding: '10px 16px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, marginBottom: 16, fontSize: 13 },
  errorBanner:   { padding: '12px 16px', background: 'var(--color-fail-tint)', border: '1px solid var(--color-fail-border)', borderRadius: 6, marginBottom: 16, color: 'var(--color-fail)', fontSize: 13 },
  warningBanner: { padding: '10px 16px', background: 'var(--color-flag-tint)', border: '1px solid var(--color-flag-border)', borderRadius: 6, marginBottom: 20, fontSize: 13, color: '#7a5c00', fontWeight: 600 },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 },
  sectionTitle:  { margin: 0, fontSize: 15, fontWeight: 700 },
  summaryPill:   { fontSize: 13, color: 'var(--color-text-muted)' },
  table:         { width: '100%', borderCollapse: 'collapse' },
  badgePass:     { padding: '2px 8px', background: 'var(--color-pass-tint)', color: 'var(--color-pass)', borderRadius: 4, fontSize: 12, fontWeight: 700 },
  badgeFail:     { padding: '2px 8px', background: 'var(--color-fail-tint)', color: 'var(--color-fail)', borderRadius: 4, fontSize: 12, fontWeight: 700 },
  btnPrimary:    { padding: '9px 20px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnBack:       { padding: '8px 16px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSmall:      { padding: '5px 12px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  btnSmallAlt:   { padding: '5px 12px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
};
