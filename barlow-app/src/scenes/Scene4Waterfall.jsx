import { useState, useEffect } from 'react';
import { useBarlowDemo } from '../context/BarlowDemoContext';
import { runWaterfall } from '../api/barlowApi';
import SceneToolbar, { tbBtn, tbNavLink } from '../components/SceneToolbar';

const DEFAULT_COLLECTIONS = {
  payment_date:  '2026-01-15',
  period_start:  '2025-10-15',
  period_end:    '2026-01-15',
  interest_input:   2187500,
  principal_input:  8430000,
};

export default function Scene4Waterfall() {
  const { state, patch, setScene } = useBarlowDemo();
  const { waterfall, coverageTests, indenture } = state;

  useEffect(() => { document.title = 'Barlow — Waterfall'; }, []);

  const [form, setForm] = useState({
    payment_date:  DEFAULT_COLLECTIONS.payment_date,
    period_start:  DEFAULT_COLLECTIONS.period_start,
    period_end:    DEFAULT_COLLECTIONS.period_end,
    interest:      String(DEFAULT_COLLECTIONS.interest_input),
    principal:     String(DEFAULT_COLLECTIONS.principal_input),
  });

  async function calculate(useFallback = false) {
    patch('waterfall', { status: 'RUNNING', error: null });

    const extraction = indenture.extractionOutput;
    if (!extraction && !useFallback) {
      patch('waterfall', { status: 'ERROR', error: 'No extraction output — run Scene 1 first' });
      return;
    }

    const interestAmt  = parseFloat(form.interest)  / 1_000_000;
    const principalAmt = parseFloat(form.principal) / 1_000_000;

    const collections = {
      payment_date:               form.payment_date,
      period_start:               form.period_start,
      period_end:                 form.period_end,
      scheduled_interest:         interestAmt,
      unscheduled_interest:       0,
      default_interest_recovered: 0,
      total_interest_proceeds:    interestAmt,
      scheduled_principal:        principalAmt,
      unscheduled_principal:      0,
      default_principal_recovered:0,
      total_principal_proceeds:   principalAmt,
      hedge_receipts:             0,
      reserve_account_balance:    0,
    };

    // Build NoteBalanceSnapshot from default Carlyle capital structure
    const noteBalances = buildNoteBalances(collections);

    const input = {
      waterfall_steps:       extraction?.waterfall_steps ?? [],
      coverage_test_results: coverageTests.results ?? [],
      collections,
      note_balances:         noteBalances,
    };

    const { data, error } = await runWaterfall(input, { useFallback });
    if (error || !data) {
      patch('waterfall', { status: 'ERROR', error: error ?? 'Waterfall calculation failed' });
      return;
    }

    patch('waterfall', {
      status: 'COMPLETE',
      collections,
      allocationLedger: data.allocationLedger,
      diversionLedger:  data.diversionLedger,
    });
  }

  const [showBlocked, setShowBlocked] = useState(true);

  const { allocationLedger, diversionLedger } = waterfall;
  const isRunning  = waterfall.status === 'RUNNING';
  const isError    = waterfall.status === 'ERROR';
  const isComplete = waterfall.status === 'COMPLETE';
  const hasDiversion = (diversionLedger?.entries?.length ?? 0) > 0;

  const toolbarRight = (
    <>
      {isComplete && (
        <button style={tbNavLink} onClick={() => setScene(4)}>Generate Report →</button>
      )}
      <button style={{ ...tbBtn, opacity: isRunning ? 0.6 : 1 }} disabled={isRunning} onClick={() => calculate()}>
        {isRunning ? <><Spinner /> Calculating…</> : 'Calculate Waterfall'}
      </button>
    </>
  );

  return (
    <div>
      <SceneToolbar stepNum={4} title="Waterfall" back={() => setScene(2)} backLabel="Coverage Tests" right={toolbarRight} />
      {isError && (
        <div style={s.errorBanner}>
          {waterfall.error}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button style={s.btnSmall} onClick={() => calculate()}>Retry</button>
            <button style={s.btnSmallAlt} onClick={() => calculate(true)}>Use demo fixture instead</button>
          </div>
        </div>
      )}

      {/* Section A — Collections Input */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>Collections Input</h2>
        <div style={s.formGrid}>
          <FormField label="Interest Proceeds ($)">
            <input style={s.input} type="number" value={form.interest}
              onChange={e => setForm(f => ({ ...f, interest: e.target.value }))} />
          </FormField>
          <FormField label="Principal Proceeds ($)">
            <input style={s.input} type="number" value={form.principal}
              onChange={e => setForm(f => ({ ...f, principal: e.target.value }))} />
          </FormField>
          <FormField label="Payment Date">
            <input style={s.input} type="date" value={form.payment_date}
              onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} />
            {form.payment_date && <span style={s.dateHint}>{fmtDateUS(form.payment_date)}</span>}
          </FormField>
          <FormField label="Period Start">
            <input style={s.input} type="date" value={form.period_start}
              onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} />
            {form.period_start && <span style={s.dateHint}>{fmtDateUS(form.period_start)}</span>}
          </FormField>
          <FormField label="Period End">
            <input style={s.input} type="date" value={form.period_end}
              onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} />
            {form.period_end && <span style={s.dateHint}>{fmtDateUS(form.period_end)}</span>}
          </FormField>
        </div>
      </section>

      {/* Section B — Diversion Summary */}
      {isComplete && (
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Diversion Summary</h2>
          {hasDiversion ? (
            <>
              <div style={s.diversionBanner}>
                ⚠ Diversion triggered — {diversionLedger.entries.length} test(s) failed
              </div>
              {diversionLedger.entries.map((d, i) => (
                <div key={i} style={s.diversionCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <code style={{ fontSize: 12 }}>{d.triggering_test}</code>
                    <span style={{ color: 'var(--color-flag)', fontWeight: 700, fontSize: 14 }}>{fmtM(d.diversion_amount)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{d.cure_mechanism}</div>
                </div>
              ))}
            </>
          ) : (
            <div style={s.passBanner}>✓ No diversion — all coverage tests passing</div>
          )}
        </section>
      )}

      {/* Section C — Allocation Table */}
      {isComplete && allocationLedger && (
        <section style={s.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ ...s.sectionTitle, margin: 0 }}>Waterfall Allocation</h2>
            <button style={s.btnSmallAlt} onClick={() => setShowBlocked(v => !v)}>
              {showBlocked ? 'Hide blocked' : 'Show blocked'}
            </button>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto' }}>
            <table style={s.table}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--color-surface)' }}><tr>
                <Th>#</Th><Th>Beneficiary</Th><Th>Type</Th><Th>Due</Th><Th>Paid</Th><Th>Shortfall</Th><Th>Status</Th>
              </tr></thead>
              <tbody>
                {(showBlocked ? allocationLedger.entries : allocationLedger.entries.filter(e => !e.blocked)).map(e => {
                  const blocked  = e.blocked;
                  const partial  = e.shortfall > 0 && !blocked;
                  const diverted = e.step_type === 'COVERAGE_TEST_CHECK' && e.amount_paid > 0;
                  return (
                    <tr key={e.step_id} style={blocked ? { background: '#f5f5f3' } : diverted ? { background: 'var(--color-flag-tint)' } : {}}>
                      <Td>{e.step_number}</Td>
                      <Td><span style={blocked ? { textDecoration: 'line-through', opacity: 0.55 } : {}}>{e.beneficiary || e.step_id}</span></Td>
                      <Td><span style={{ fontSize: 11 }}>{e.step_type}</span></Td>
                      <Td>{fmtM(e.amount_due)}</Td>
                      <Td>{fmtM(e.amount_paid)}</Td>
                      <Td style={partial ? { color: 'var(--color-flag)', fontWeight: 600 } : {}}>
                        {e.shortfall > 0 ? fmtM(e.shortfall) : '—'}
                      </Td>
                      <Td>{statusBadge(e)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={s.summaryFooter}>
            <FooterItem label="Total Interest Proceeds"  value={fmtM(allocationLedger.collections?.total_interest_proceeds ?? 0)} />
            <FooterItem label="Total Principal Proceeds" value={fmtM(allocationLedger.collections?.total_principal_proceeds ?? 0)} />
            <FooterItem label="Total Allocated"          value={fmtM(allocationLedger.total_allocated)} />
            {hasDiversion && <FooterItem label="Total Diverted" value={fmtM(diversionLedger.total_diverted)} color="var(--color-flag)" />}
          </div>
        </section>
      )}

    </div>
  );
}

function buildNoteBalances(collections) {
  return {
    class_a: { outstanding_balance: 180.0, accrued_interest: 2.925, deferred_interest: 0 },
    class_b: { outstanding_balance:  60.0, accrued_interest: 1.125, deferred_interest: 0 },
    class_c: { outstanding_balance:  40.0, accrued_interest: 0.875, deferred_interest: 0 },
    fees: {
      trustee_and_admin:           0.125,
      senior_management_fee:       0.250,
      subordinate_management_fee:  0.150,
    },
  };
}

function fmtDateUS(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return (y && m && d) ? `${m}/${d}/${y}` : iso;
}

function fmtM(v) {
  if (v == null) return '—';
  return `$${(v * 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function statusBadge(e) {
  if (e.blocked) return <span style={{ color: 'var(--color-fail)', fontWeight: 700, fontSize: 11 }}>BLOCKED</span>;
  if (e.step_type === 'EQUITY_DISTRIBUTION') return <span style={{ color: 'var(--color-pass)', fontWeight: 700, fontSize: 11 }}>✓ EQUITY</span>;
  if (e.step_type === 'COVERAGE_TEST_CHECK' && e.amount_paid > 0) return <span style={{ color: 'var(--color-flag)', fontWeight: 700, fontSize: 11 }}>DIVERTED</span>;
  if (e.shortfall === 0) return <span style={{ color: 'var(--color-pass)', fontWeight: 700, fontSize: 11 }}>✓</span>;
  return <span style={{ color: 'var(--color-fail)', fontWeight: 700, fontSize: 11 }}>PARTIAL</span>;
}

function FormField({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
      <label style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}
function FooterItem({ label, value, color }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}:</span>
      <span style={{ fontWeight: 700, color: color ?? 'var(--color-text-primary)' }}>{value}</span>
    </div>
  );
}
function Spinner() {
  return <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #ccc', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 6, verticalAlign: 'middle' }} />;
}
function Th({ children }) {
  return <th style={{ textAlign: 'left', padding: '7px 12px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding: '7px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border)', ...style }}>{children}</td>;
}

const s = {
  section:        { marginBottom: 28 },
  sectionTitle:   { fontSize: 15, fontWeight: 700, margin: '0 0 14px' },
  formGrid:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', maxWidth: 640 },
  input:          { padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 5, fontSize: 13, width: '100%' },
  table:          { width: '100%', borderCollapse: 'collapse' },
  summaryFooter:  { display: 'flex', gap: 24, flexWrap: 'wrap', padding: '10px 0', borderTop: '2px solid var(--color-border)', marginTop: 4 },
  errorBanner:    { padding: '12px 16px', background: 'var(--color-fail-tint)', border: '1px solid var(--color-fail-border)', borderRadius: 6, marginBottom: 16, color: 'var(--color-fail)', fontSize: 13 },
  diversionBanner:{ padding: '10px 16px', background: 'var(--color-flag-tint)', border: '1px solid var(--color-flag-border)', borderRadius: 6, marginBottom: 10, fontSize: 13, fontWeight: 600, color: '#7a5c00' },
  diversionCard:  { borderLeft: '3px solid var(--color-flag)', background: 'var(--color-flag-tint)', padding: '10px 14px', borderRadius: '0 6px 6px 0', marginBottom: 8 },
  passBanner:     { padding: '10px 16px', background: 'var(--color-pass-tint)', border: '1px solid var(--color-pass-border)', borderRadius: 6, fontSize: 13, color: 'var(--color-pass)', fontWeight: 600 },
  btnPrimary:     { padding: '9px 20px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center' },
  btnBack:        { padding: '8px 16px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSmall:       { padding: '5px 12px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  btnSmallAlt:    { padding: '5px 12px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  dateHint:       { fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 },
};
