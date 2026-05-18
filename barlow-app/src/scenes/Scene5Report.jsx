import { useState, useEffect, useRef } from 'react';
import { useBarlowDemo } from '../context/BarlowDemoContext';
import { assembleReport, generateNarratives } from '../api/barlowApi';
import SceneToolbar from '../components/SceneToolbar';

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
  const [scrollPct, setScrollPct]           = useState(0);
  const assembledAt = useRef(null);
  const centerRef   = useRef(null);

  useEffect(() => { document.title = 'Barlow — Trustee Report'; }, []);

  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    let scrollEl = el.parentElement;
    while (scrollEl && scrollEl !== document.documentElement) {
      const { overflowY } = window.getComputedStyle(scrollEl);
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scrollEl = scrollEl.parentElement;
    }
    if (!scrollEl) return;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - scrollEl.clientHeight;
      const scrolled = Math.max(0, -rect.top + scrollEl.getBoundingClientRect().top);
      setScrollPct(total > 0 ? Math.min(1, scrolled / total) : 0);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function downloadPdf() {
    if (!r) return;
    const noteRows = (r.note_balance_statement?.entries ?? []).map(e => `
      <tr>
        <td>${e.note_class?.replace('CLASS_', 'Class ')}</td>
        <td>${fmtM(e.balance_prior)}</td>
        <td>${e.principal_paid > 0 ? fmtM(e.principal_paid) : '—'}</td>
        <td>${fmtM(e.balance_current)}</td>
        <td>${((e.note_rate ?? 0) * 100).toFixed(2)}%</td>
        <td>${fmtM(e.interest_paid)}</td>
      </tr>`).join('');
    const covRows = (r.coverage_test_summary?.entries ?? []).map(e => `
      <tr${e.result === 'FAIL' ? ' class="fail-row"' : ''}>
        <td><code>${e.test_id}</code></td>
        <td>${fmt(e.threshold)}%</td>
        <td>${fmt(e.actual)}%</td>
        <td style="color:${(e.cushion ?? 0) >= 0 ? '#4a7c59' : '#a05252'}">${(e.cushion ?? 0) >= 0 ? '+' : ''}${fmt(e.cushion)}%</td>
        <td><strong>${e.result}</strong></td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${r.deal_name} — Trustee Report</title>
<style>
  body{font-family:'Times New Roman',serif;font-size:10pt;margin:0;color:#000}
  .page{padding:.9in;box-sizing:border-box}
  .cover{min-height:10in;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  h1{font-size:22pt;margin:0 0 8px}
  h2{font-size:13pt;font-weight:normal;color:#555;margin:0 0 28px}
  .draft{font-size:13pt;font-weight:bold;color:#c00;border:2px solid #c00;padding:8px 24px;letter-spacing:.1em;display:inline-block}
  .meta{margin-top:32px;font-size:11pt;line-height:2.2}
  .gen{margin-top:48px;font-size:8pt;color:#999}
  .sec-title{font-size:12pt;font-weight:bold;border-bottom:1.5px solid #000;margin:20px 0 10px;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:12px}
  th{background:#f0f0f0;text-align:left;padding:4px 8px;border:1px solid #ccc}
  td{padding:3px 8px;border:1px solid #ccc}
  .fail-row td{background:#efe0e0}
  .footer{margin-top:24px;font-size:8pt;color:#888;text-align:center;border-top:1px solid #ccc;padding-top:8px}
  @media print{
    @page{margin:.75in;size:letter}
    .page-break{page-break-after:always}
    body::after{content:"DRAFT — Controller Review Required";position:fixed;top:50%;left:50%;
      transform:translate(-50%,-50%) rotate(-45deg);font-size:64pt;
      color:rgba(180,0,0,.07);pointer-events:none;z-index:9999;white-space:nowrap;
      font-family:'Times New Roman',serif;font-weight:bold}
  }
</style></head><body>
<div class="page cover page-break">
  <h1>${r.deal_name}</h1>
  <h2>Payment Date Report</h2>
  <div class="draft">DRAFT — CONTROLLER REVIEW REQUIRED</div>
  <div class="meta">
    <div><strong>Payment Date:</strong> ${r.payment_date}</div>
    <div><strong>Period:</strong> ${r.period_start} — ${r.period_end}</div>
    <div><strong>Trustee:</strong> ${r.trustee}</div>
    <div><strong>Collateral Manager:</strong> ${r.collateral_manager}</div>
  </div>
  <div class="gen">Generated by Barlow v0.5 · ${assembledAt.current?.slice(0, 10) ?? ''} · Not for distribution</div>
</div>
<div class="page">
  <div class="sec-title">1. Note Balance Statement</div>
  <table><thead><tr><th>Note Class</th><th>Prior Balance</th><th>Principal Paid</th><th>Current Balance</th><th>Rate</th><th>Interest Paid</th></tr></thead>
  <tbody>${noteRows}</tbody></table>
  <div class="sec-title">2. Coverage Test Summary</div>
  <table><thead><tr><th>Test</th><th>Threshold</th><th>Actual</th><th>Cushion</th><th>Result</th></tr></thead>
  <tbody>${covRows}</tbody></table>
  <div class="footer">Barlow v0.5 — DRAFT. Controller review required before distribution. Not legally binding.</div>
</div>
</body></html>`;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 600);
  }

  function downloadJson() {
    const json = JSON.stringify(r, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'trustee_report.json'; a.click();
    URL.revokeObjectURL(url);
  }

  const toolbarRight = isComplete ? (
    <>
      <button style={s.toolBtn} onClick={downloadPdf}>⬇ PDF</button>
      <button style={s.toolBtn} onClick={downloadJson}>⬇ JSON</button>
      <button style={s.toolBtn} onClick={() => navigator.clipboard?.writeText(reportState.markdown ?? '')}>⎘ Copy</button>
    </>
  ) : null;

  return (
    <div>
      <SceneToolbar stepNum={5} title="Trustee Report" back={() => setScene(3)} backLabel="Waterfall" right={toolbarRight} />
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
      <div ref={centerRef} style={s.center}>
        <div style={s.progressTrack}><div style={{ ...s.progressFill, width: `${scrollPct * 100}%` }} /></div>
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
                      <Td>{fmt(e.note_rate != null ? e.note_rate * 100 : null)}%</Td>
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
                      <Td>{fmt(e.threshold)}%</Td>
                      <Td>{fmt(e.actual)}%</Td>
                      <Td style={{ color: (e.cushion ?? 0) >= 0 ? 'var(--color-pass)' : 'var(--color-fail)', fontWeight: 600 }}>{(e.cushion ?? 0) >= 0 ? '+' : ''}{fmt(e.cushion)}%</Td>
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
                      <Td>{fmt(e.max_pct)}%</Td>
                      <Td>{fmt(e.actual_pct)}%</Td>
                      <Td style={{ color: (e.headroom ?? 0) >= 0 ? 'var(--color-pass)' : 'var(--color-fail)', fontWeight: 600 }}>{(e.headroom ?? 0) >= 0 ? '+' : ''}{fmt(e.headroom)}%</Td>
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
                        <Td style={{ color: 'var(--color-fail)', fontWeight: 600 }}>{fmt(e.breach_depth)}%</Td>
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

      </div>
    </div>
    </div>
  );
}

function buildNoteBalances() {
  return {
    class_a: { outstanding_balance: 180.0, accrued_interest: 2.925, deferred_interest: 0 },
    class_b: { outstanding_balance:  60.0, accrued_interest: 1.125, deferred_interest: 0 },
    class_c: { outstanding_balance:  40.0, accrued_interest: 0.875, deferred_interest: 0 },
    class_d: { outstanding_balance:  20.0, accrued_interest: 0.525, deferred_interest: 0 },
    preferred_interests: { outstanding_balance: 25.0, accrued_interest: 0, deferred_interest: 0 },
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

function fmt(n, decimals = 2) {
  return (n != null && !isNaN(n)) ? n.toFixed(decimals) : '—';
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
      <span style={{ fontWeight: 600 }}>{ms >= 100 ? `${(ms / 1000).toFixed(1)}s` : '< 0.1s'}</span>
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
  progressTrack:  { height: 2, background: 'var(--color-border)', marginBottom: 10, borderRadius: 1 },
  progressFill:   { height: '100%', background: 'var(--color-dusty-blue)', transition: 'width 0.1s', borderRadius: 1 },
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
