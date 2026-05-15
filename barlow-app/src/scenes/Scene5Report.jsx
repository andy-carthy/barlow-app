import { useState, useEffect, useRef } from 'react';
import { useBarlowDemo } from '../context/BarlowDemoContext';
import { assembleReport, generateNarratives } from '../api/barlowApi';

const SECTIONS = [
  { key: 'header',                label: 'Deal Header' },
  { key: 'note_balance',          label: 'Note Balance Statement' },
  { key: 'coverage_tests',        label: 'Coverage Test Summary' },
  { key: 'concentration',         label: 'Concentration Limits' },
  { key: 'waterfall',             label: 'Waterfall Allocation' },
  { key: 'interest_dist',         label: 'Interest Distribution' },
  { key: 'principal_dist',        label: 'Principal Distribution' },
  { key: 'portfolio',             label: 'Portfolio Characteristics' },
  { key: 'diversion',             label: 'Diversion Summary' },
  { key: 'exceptions',            label: 'Exception Register' },
  { key: 'narratives',            label: 'Exception Narratives' },
];

export default function Scene5Report() {
  const { state, patch, setScene } = useBarlowDemo();
  const { report: reportState, indenture, loanTape, coverageTests, waterfall } = state;

  const [activeSection, setActiveSection]   = useState('header');
  const [narrativeMap, setNarrativeMap]     = useState({});
  const [narrativeTokens, setNarrativeTokens] = useState({});
  const [timings, setTimings]               = useState({});
  const assembledAt = useRef(null);

  useEffect(() => {
    if (reportState.status === 'IDLE' && indenture.extractionOutput) {
      assemble();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function assemble(useFallback = false) {
    const t0 = Date.now();
    patch('report', { status: 'RUNNING', error: null });

    const { data, error } = await assembleReport({
      extraction:           indenture.extractionOutput,
      positions:            loanTape.positions ?? [],
      coverageResults:      coverageTests.results ?? [],
      concentrationResults: coverageTests.concentrationResults ?? [],
      allocationLedger:     waterfall.allocationLedger,
      noteBalances:         buildNoteBalances(),
      reportMeta:           buildReportMeta(),
    }, { useFallback });

    if (error || !data) {
      patch('report', { status: 'ERROR', error: error ?? 'Assembly failed' });
      return;
    }

    setTimings(t => ({ ...t, assembly: Date.now() - t0 }));
    assembledAt.current = new Date().toISOString();

    patch('report', {
      status: 'COMPLETE',
      trusteeReport: data.report,
      markdown: data.markdown,
      narrativeStatus: 'IDLE',
    });

    // Auto-start narrative generation if exceptions exist
    if (data.report?.exception_register?.entries?.length > 0) {
      generateNarrativesFor(data.report, useFallback);
    }
  }

  async function generateNarrativesFor(report, useFallback = false) {
    const t0 = Date.now();
    patch('report', { narrativeStatus: 'RUNNING' });
    setNarrativeMap({});
    setNarrativeTokens({});

    const { error } = await generateNarratives(
      report,
      indenture.extractionOutput,
      (event) => {
        if (event.type === 'start') {
          setNarrativeTokens(m => ({ ...m, [event.exception_id]: '' }));
          setActiveSection('narratives');
        }
        if (event.type === 'token') {
          setNarrativeTokens(m => ({ ...m, [event.exception_id]: (m[event.exception_id] ?? '') + event.token }));
        }
        if (event.type === 'complete') {
          setNarrativeMap(m => ({ ...m, [event.exception_id]: event }));
          setNarrativeTokens(m => { const n = { ...m }; delete n[event.exception_id]; return n; });
        }
      },
      { useFallback },
    );

    setTimings(t => ({ ...t, narratives: Date.now() - t0 }));
    patch('report', { narrativeStatus: error ? 'ERROR' : 'COMPLETE', narratives: Object.values(narrativeMap) });
  }

  const r = reportState.trusteeReport;
  const isRunning  = reportState.status === 'RUNNING';
  const isError    = reportState.status === 'ERROR';
  const isComplete = reportState.status === 'COMPLETE';

  const exceptions    = r?.exception_register?.entries ?? [];
  const hasExceptions = exceptions.length > 0;
  const hasDiversion  = (r?.diversion_summary?.entries?.length ?? 0) > 0;
  const narStatus     = reportState.narrativeStatus;

  function downloadMarkdown() {
    const md = reportState.markdown ?? '';
    const blob = new Blob([md], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'trustee_report.md'; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    const json = JSON.stringify(r, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'trustee_report.json'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={s.layout}>
      {/* ── Left — Section nav ── */}
      <div style={s.nav}>
        {SECTIONS.map(sc => {
          const isDiversion = sc.key === 'diversion';
          const isException = sc.key === 'exceptions';
          const isNarrative = sc.key === 'narratives';
          const amber = (isDiversion && hasDiversion) || (isException && hasExceptions);
          const spinning = isNarrative && narStatus === 'RUNNING';
          const icon = spinning ? '◌' : amber ? '⚠' : isComplete ? '✓' : '○';

          return (
            <button
              key={sc.key}
              style={{ ...s.navItem, background: activeSection === sc.key ? 'var(--color-bg)' : 'transparent',
                       fontWeight: activeSection === sc.key ? 700 : 400,
                       color: amber ? 'var(--color-flag)' : 'var(--color-text-primary)' }}
              onClick={() => { setActiveSection(sc.key); document.getElementById(`section-${sc.key}`)?.scrollIntoView({ behavior: 'smooth' }); }}
            >
              <span style={{ color: amber ? 'var(--color-flag)' : isComplete ? 'var(--color-pass)' : 'var(--color-text-muted)', marginRight: 6 }}>
                {spinning ? <SpinIcon /> : icon}
              </span>
              {sc.label}
            </button>
          );
        })}
      </div>

      {/* ── Center — Report content ── */}
      <div style={s.center}>
        {isRunning && (
          <div style={s.loadingState}><Spinner /> Assembling report…</div>
        )}

        {isError && (
          <div style={s.errorBanner}>
            {reportState.error}
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button style={s.btnSmall} onClick={() => assemble()}>Retry</button>
              <button style={s.btnSmallAlt} onClick={() => assemble(true)}>Use demo fixture instead</button>
            </div>
          </div>
        )}

        {isComplete && r && (
          <>
            {/* Toolbar */}
            <div style={s.toolbar}>
              <button style={s.toolBtn} onClick={downloadMarkdown}>⬇ Markdown</button>
              <button style={s.toolBtn} onClick={downloadJson}>⬇ JSON</button>
              <button style={s.toolBtn} onClick={() => navigator.clipboard?.writeText(reportState.markdown ?? '')}>⎘ Copy</button>
            </div>

            {/* Header */}
            <div id="section-header" style={s.reportSection}>
              <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>{r.deal_name}</h1>
              <h2 style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>Payment Date Report</h2>
              <MetaRow label="Payment Date"      value={r.payment_date} />
              <MetaRow label="Period"            value={`${r.period_start} — ${r.period_end}`} />
              <MetaRow label="Trustee"           value={r.trustee} />
              <MetaRow label="Collateral Manager" value={r.collateral_manager} />
            </div>

            {/* Note Balance */}
            <div id="section-note_balance" style={s.reportSection}>
              <SectionTitle>1. Note Balance Statement</SectionTitle>
              <table style={s.table}>
                <thead><tr>
                  <Th>Note Class</Th><Th>Prior Balance</Th><Th>Principal Paid</Th><Th>Current Balance</Th><Th>Rate</Th><Th>Interest Paid</Th>
                </tr></thead>
                <tbody>
                  {r.note_balance_statement?.entries?.map(e => (
                    <tr key={e.note_class}>
                      <Td>{e.note_class?.replace('CLASS_', 'Class ')}</Td>
                      <Td>{fmtM(e.balance_prior)}</Td>
                      <Td>{e.principal_paid > 0 ? fmtM(e.principal_paid) : '—'}</Td>
                      <Td>{fmtM(e.balance_current)}</Td>
                      <Td>{(e.note_rate * 100).toFixed(2)}%</Td>
                      <Td>{fmtM(e.interest_paid)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Coverage Tests */}
            <div id="section-coverage_tests" style={s.reportSection}>
              <SectionTitle>2. Coverage Test Summary</SectionTitle>
              <table style={s.table}>
                <thead><tr><Th>Test</Th><Th>Section</Th><Th>Threshold</Th><Th>Actual</Th><Th>Cushion</Th><Th>Result</Th></tr></thead>
                <tbody>
                  {r.coverage_test_summary?.entries?.map(e => (
                    <tr key={e.test_id} style={e.result==='FAIL' ? { background: 'var(--color-fail-tint)' } : {}}>
                      <Td><code>{e.test_id}</code></Td>
                      <Td style={{ color: 'var(--color-dusty-blue)' }}>{e.indenture_section ?? '—'}</Td>
                      <Td>{e.threshold?.toFixed(2)}%</Td>
                      <Td>{e.actual?.toFixed(2)}%</Td>
                      <Td style={{ color: e.cushion >= 0 ? 'var(--color-pass)' : 'var(--color-fail)', fontWeight: 600 }}>{e.cushion >= 0 ? '+' : ''}{e.cushion?.toFixed(2)}%</Td>
                      <Td><span style={e.result === 'PASS' ? s.badgePass : s.badgeFail}>{e.result === 'PASS' ? '✓ PASS' : '✗ FAIL'}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Concentration */}
            <div id="section-concentration" style={s.reportSection}>
              <SectionTitle>3. Concentration Limit Summary</SectionTitle>
              <table style={s.table}>
                <thead><tr><Th>Limit</Th><Th>Description</Th><Th>Max %</Th><Th>Actual %</Th><Th>Headroom</Th><Th>Result</Th></tr></thead>
                <tbody>
                  {r.concentration_limit_summary?.entries?.map(e => (
                    <tr key={e.limit_id} style={e.result==='FAIL' ? { background: 'var(--color-fail-tint)' } : {}}>
                      <Td><code style={{ fontSize: 11 }}>{e.limit_id}</code></Td>
                      <Td style={{ fontSize: 12 }}>{e.description}</Td>
                      <Td>{e.max_pct?.toFixed(2)}%</Td>
                      <Td>{e.actual_pct?.toFixed(2)}%</Td>
                      <Td style={{ color: e.headroom >= 0 ? 'var(--color-pass)' : 'var(--color-fail)', fontWeight: 600 }}>{e.headroom >= 0 ? '+' : ''}{e.headroom?.toFixed(2)}%</Td>
                      <Td><span style={e.result === 'PASS' ? s.badgePass : s.badgeFail}>{e.result === 'PASS' ? '✓ PASS' : '✗ FAIL'}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Waterfall */}
            <div id="section-waterfall" style={s.reportSection}>
              <SectionTitle>4. Waterfall Allocation</SectionTitle>
              <table style={s.table}>
                <thead><tr><Th>#</Th><Th>Beneficiary</Th><Th>Type</Th><Th>Due</Th><Th>Paid</Th><Th>Shortfall</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {r.waterfall_allocation_table?.entries?.map(e => (
                    <tr key={e.step_id} style={e.blocked ? { opacity: 0.55 } : {}}>
                      <Td>{e.step_number}</Td>
                      <Td>{e.beneficiary || e.step_id}</Td>
                      <Td style={{ fontSize: 11 }}>{e.step_type}</Td>
                      <Td>{fmtM(e.amount_due)}</Td>
                      <Td>{fmtM(e.amount_paid)}</Td>
                      <Td style={{ color: e.shortfall > 0 ? 'var(--color-fail)' : 'inherit', fontWeight: e.shortfall > 0 ? 600 : 400 }}>{e.shortfall > 0 ? fmtM(e.shortfall) : '—'}</Td>
                      <Td>{e.blocked ? <span style={{ color:'var(--color-fail)',fontWeight:700,fontSize:11 }}>BLOCKED</span> : e.step_type==='EQUITY_DISTRIBUTION' ? <span style={{ color:'var(--color-pass)',fontWeight:700,fontSize:11 }}>✓ EQUITY</span> : <span style={{ color:'var(--color-pass)',fontWeight:700,fontSize:11 }}>✓</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Exception Register */}
            <div id="section-exceptions" style={s.reportSection}>
              <SectionTitle>9. Exception Register</SectionTitle>
              {r.exception_register ? (
                <table style={s.table}>
                  <thead><tr><Th>Exception ID</Th><Th>Type</Th><Th>Section</Th><Th>Breach Depth</Th></tr></thead>
                  <tbody>
                    {r.exception_register.entries?.map(e => (
                      <tr key={e.exception_id} style={{ background: 'var(--color-fail-tint)' }}>
                        <Td><code style={{ fontSize: 11 }}>{e.exception_id}</code></Td>
                        <Td>{e.exception_type}</Td>
                        <Td style={{ color: 'var(--color-dusty-blue)' }}>{e.indenture_section ?? '—'}</Td>
                        <Td style={{ color: 'var(--color-fail)', fontWeight: 600 }}>{e.breach_depth?.toFixed(2)}%</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={s.noExceptions}>No exceptions this period.</div>
              )}
            </div>

            {/* Exception Narratives */}
            <div id="section-narratives" style={s.reportSection}>
              <SectionTitle>10. Exception Narratives</SectionTitle>
              {!hasExceptions ? (
                <div style={s.noExceptions}>No exceptions this period.</div>
              ) : (
                <>
                  {exceptions.map(exc => {
                    const completed = narrativeMap[exc.exception_id];
                    const streaming = narrativeTokens[exc.exception_id];
                    const isPending = !completed && streaming === undefined;

                    return (
                      <div key={exc.exception_id} style={s.narrativeCard}>
                        <div style={s.narrativeHeader}>
                          <code style={{ fontSize: 12 }}>{exc.exception_id}</code>
                          {isPending && narStatus === 'RUNNING' && <SpinIcon />}
                          {completed && <span style={{ color: 'var(--color-pass)', fontSize: 12 }}>✓</span>}
                        </div>

                        {streaming !== undefined && !completed && (
                          <div style={s.narrativeText}>
                            <div style={s.aiCallout}>
                              Claude is drafting indenture-grounded breach narratives. Controller review required before distribution.
                            </div>
                            <div style={{ marginTop: 8 }}>{streaming}<span style={s.cursor}>▌</span></div>
                          </div>
                        )}

                        {completed && (
                          <div style={s.narrativeText}>
                            <p style={{ margin: '0 0 10px', lineHeight: 1.65 }}>{completed.narrative}</p>
                            <p style={s.disclaimer}>
                              <em>Generated by Barlow 5B. Controller review required before distribution.</em>
                            </p>
                          </div>
                        )}

                        {isPending && narStatus === 'RUNNING' && (
                          <div style={{ ...s.narrativeText, color: 'var(--color-text-muted)', fontSize: 12 }}>Queued…</div>
                        )}
                      </div>
                    );
                  })}

                  {narStatus === 'ERROR' && (
                    <div style={{ ...s.errorBanner, marginTop: 12 }}>
                      Narrative generation failed.
                      <button style={{ ...s.btnSmallAlt, marginLeft: 12 }} onClick={() => generateNarrativesFor(r, true)}>Use demo fixture instead</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Right — Metadata ── */}
      <div style={s.meta}>
        {r && (
          <>
            <div style={s.metaBlock}>
              <MetaRow label="Deal"         value={r.deal_name} />
              <MetaRow label="Payment Date" value={r.payment_date} />
              <MetaRow label="Period"       value={`${r.period_start?.slice(5)} – ${r.period_end?.slice(5)}`} />
              <MetaRow label="Trustee"      value={r.trustee} />
              <MetaRow label="Manager"      value={r.collateral_manager} />
              <MetaRow label="Generated"    value={assembledAt.current?.slice(0, 19).replace('T', ' ') ?? '—'} />
              <MetaRow label="By"           value="Barlow v0.5" />
            </div>

            <div style={{ ...s.metaBlock, marginTop: 16 }}>
              <div style={s.metaTitle}>Pipeline Summary</div>
              {timings.assembly  && <TimingRow label="Report Assembly"  ms={timings.assembly} />}
              {timings.narratives && <TimingRow label="Narratives"       ms={timings.narratives} />}
            </div>

            {hasExceptions && (
              <div style={s.exceptionBadge}>
                ⚠ {exceptions.length} exception{exceptions.length > 1 ? 's' : ''} — controller review required
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 24 }}>
          <button style={s.btnBack} onClick={() => setScene(3)}>← Back to Waterfall</button>
        </div>
      </div>
    </div>
  );
}

function buildNoteBalances() {
  return {
    class_a: { par: 180.0, coupon_rate: 0.0650, accrued_interest: 2.925, deferred_interest: 0 },
    class_b: { par: 60.0,  coupon_rate: 0.0750, accrued_interest: 1.125, deferred_interest: 0 },
    class_c: { par: 40.0,  coupon_rate: 0.0875, accrued_interest: 0.875, deferred_interest: 0 },
    fees: { trustee_and_admin: 0.125, senior_management_fee: 0.250, subordinate_management_fee: 0.150 },
  };
}

function buildReportMeta() {
  return {
    payment_date:       '2026-01-15',
    period_start:       '2025-10-15',
    period_end:         '2026-01-15',
    trustee:            'Wilmington Trust, N.A.',
    collateral_manager: 'Carlyle',
    deal_cik:           'N/A',
  };
}

function fmtM(v) {
  if (v == null) return '—';
  const dollars = Math.round(v * 1_000_000);
  return (v < 0 ? '-$' : '$') + Math.abs(dollars).toLocaleString('en-US');
}

function SectionTitle({ children }) {
  return <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px', color: 'var(--color-text-primary)' }}>{children}</h3>;
}
function MetaRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 5, fontSize: 12 }}>
      <span style={{ color: 'var(--color-text-muted)', width: 100, flexShrink: 0 }}>{label}:</span>
      <span style={{ fontWeight: 600 }}>{value ?? '—'}</span>
    </div>
  );
}
function TimingRow({ label, ms }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{(ms / 1000).toFixed(1)}s</span>
    </div>
  );
}
function Spinner() {
  return <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--color-border)', borderTopColor: 'var(--color-dusty-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 6, verticalAlign: 'middle' }} />;
}
function SpinIcon() {
  return <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--color-border)', borderTopColor: 'var(--color-dusty-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginLeft: 6, verticalAlign: 'middle' }} />;
}
function Th({ children }) {
  return <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap', background: 'var(--color-bg)' }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding: '6px 10px', fontSize: 13, borderBottom: '1px solid var(--color-border)', ...style }}>{children}</td>;
}

const s = {
  layout:         { display: 'flex', gap: 20, alignItems: 'flex-start', minHeight: 600 },
  nav:            { width: 200, flexShrink: 0, borderRight: '1px solid var(--color-border)', paddingRight: 12 },
  navItem:        { display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, marginBottom: 2 },
  center:         { flex: 1, minWidth: 0 },
  meta:           { width: 200, flexShrink: 0, borderLeft: '1px solid var(--color-border)', paddingLeft: 16 },
  metaBlock:      { padding: '10px 0', borderBottom: '1px solid var(--color-border)' },
  metaTitle:      { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 8 },
  toolbar:        { display: 'flex', gap: 8, marginBottom: 16, padding: '8px 0', borderBottom: '1px solid var(--color-border)' },
  toolBtn:        { padding: '5px 12px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-primary)' },
  reportSection:  { marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--color-border)' },
  table:          { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  badgePass:      { padding: '2px 7px', background: 'var(--color-pass-tint)', color: 'var(--color-pass)', borderRadius: 4, fontSize: 11, fontWeight: 700 },
  badgeFail:      { padding: '2px 7px', background: 'var(--color-fail-tint)', color: 'var(--color-fail)', borderRadius: 4, fontSize: 11, fontWeight: 700 },
  noExceptions:   { fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0', fontStyle: 'italic' },
  narrativeCard:  { border: '1px solid var(--color-border)', borderRadius: 8, marginBottom: 14, overflow: 'hidden' },
  narrativeHeader:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' },
  narrativeText:  { padding: '12px' },
  aiCallout:      { fontSize: 12, color: 'var(--color-dusty-blue)', fontStyle: 'italic', marginBottom: 6 },
  disclaimer:     { fontSize: 12, color: 'var(--color-text-muted)', margin: 0, borderTop: '1px solid var(--color-border)', paddingTop: 8 },
  cursor:         { animation: 'blink 1s step-end infinite', marginLeft: 1 },
  errorBanner:    { padding: '10px 14px', background: 'var(--color-fail-tint)', border: '1px solid var(--color-fail-border)', borderRadius: 6, color: 'var(--color-fail)', fontSize: 13 },
  exceptionBadge: { marginTop: 16, padding: '8px 10px', background: 'var(--color-flag-tint)', border: '1px solid var(--color-flag-border)', borderRadius: 6, fontSize: 12, color: '#7a5c00', fontWeight: 600 },
  loadingState:   { display: 'flex', alignItems: 'center', padding: '16px 0', color: 'var(--color-text-muted)', fontSize: 14 },
  btnBack:        { padding: '7px 14px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', fontSize: 13, width: '100%' },
  btnSmall:       { padding: '5px 12px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  btnSmallAlt:    { padding: '5px 12px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
};
