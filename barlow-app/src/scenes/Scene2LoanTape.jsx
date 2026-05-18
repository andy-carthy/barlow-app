import { useState, useRef, useEffect } from 'react';
import { useBarlowDemo } from '../context/BarlowDemoContext';
import { ingestTape, processNotice } from '../api/barlowApi';
import SceneToolbar, { tbBtn } from '../components/SceneToolbar';

export default function Scene2LoanTape() {
  const { state, patch, setScene } = useBarlowDemo();
  const { loanTape } = state;

  useEffect(() => { document.title = 'Barlow — Loan Tape'; }, []);

  const [tapeDragOver, setTapeDragOver]     = useState(false);
  const [noticeDragOver, setNoticeDragOver] = useState(false);
  const [noticeFiles, setNoticeFiles]       = useState([]);
  const [noticeStatuses, setNoticeStatuses] = useState({});
  const tapeRef   = useRef(null);
  const noticeRef = useRef(null);

  async function handleTapeFile(file, useFallback = false) {
    patch('loanTape', { file, status: 'RUNNING', error: null, positions: null, summary: null });
    let csv = null;
    if (!useFallback && file) csv = await file.text();
    const { data, error } = await ingestTape(csv, { useFallback: useFallback || !csv });
    if (error || !data) {
      patch('loanTape', { status: 'ERROR', error: error ?? 'Parse failed' });
      return;
    }
    patch('loanTape', { status: 'COMPLETE', positions: data.positions, summary: data.summary });
  }

  async function processNotices() {
    const files = noticeFiles.filter(f => f.status !== 'COMPLETE');
    const positions = loanTape.positions ?? [];
    let allChanges = [...(loanTape.changeLog ?? [])];

    for (const nf of files) {
      setNoticeStatuses(ns => ({ ...ns, [nf.id]: 'RUNNING' }));
      const { data, error } = await processNotice(nf.text, positions);
      if (error || !data) {
        setNoticeStatuses(ns => ({ ...ns, [nf.id]: 'ERROR' }));
        setNoticeFiles(fs => fs.map(f => f.id === nf.id ? { ...f, error, status: 'ERROR' } : f));
      } else {
        setNoticeStatuses(ns => ({ ...ns, [nf.id]: 'COMPLETE' }));
        setNoticeFiles(fs => fs.map(f => f.id === nf.id ? { ...f, status: 'COMPLETE' } : f));
        allChanges = [...allChanges, ...(data.changeLog ?? [])];
      }
    }
    patch('loanTape', { changeLog: allChanges });
  }

  async function addNoticeFile(file) {
    const text = await file.text();
    const id   = Date.now().toString();
    setNoticeFiles(fs => [...fs, { id, name: file.name, text, preview: text.slice(0, 120), status: 'PENDING' }]);
  }

  function onTapeDrop(e) {
    e.preventDefault(); setTapeDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleTapeFile(file);
  }

  const summary = loanTape.summary;
  const changeLog = loanTape.changeLog ?? [];

  const toolbarRight = (
    <button
      style={{ ...tbBtn, opacity: loanTape.status !== 'COMPLETE' ? 0.5 : 1 }}
      disabled={loanTape.status !== 'COMPLETE'}
      onClick={() => setScene(2)}
    >
      Run Coverage Tests →
    </button>
  );

  return (
    <div>
      <SceneToolbar stepNum={2} title="Loan Tape" back={() => setScene(0)} backLabel="Deal Onboarding" right={toolbarRight} />
    <div style={s.layout}>
      {/* ── Left panel ── */}
      <div style={s.left}>
        <h2 style={s.heading}>Loan Tape</h2>

        <div
          style={{ ...s.dropzone, borderColor: tapeDragOver ? 'var(--color-dusty-blue)' : 'var(--color-border)' }}
          onDragOver={e => { e.preventDefault(); setTapeDragOver(true); }}
          onDragLeave={() => setTapeDragOver(false)}
          onDrop={onTapeDrop}
          onClick={() => tapeRef.current?.click()}
        >
          <div style={s.dropText}>Drop CSV / TSV loan tape</div>
          <div style={s.dropSub}>or click to browse</div>
          <input ref={tapeRef} type="file" accept=".csv,.tsv,.txt"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            onChange={e => handleTapeFile(e.target.files[0])} />
        </div>

        <button style={s.demoLink} onClick={() => handleTapeFile(null, true)}>
          Use synthetic Carlyle tape (Demo)
        </button>

        {loanTape.status === 'ERROR' && (
          <div style={s.errorBox}>
            <div style={s.errorMsg}>{loanTape.error}</div>
            <button style={s.btnSmallAlt} onClick={() => handleTapeFile(null, true)}>Use demo fixture instead</button>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <h3 style={s.subheading}>Agent Bank Notices <span style={s.optional}>(optional)</span></h3>
          <div
            style={{ ...s.noticeZone, borderColor: noticeDragOver ? 'var(--color-dusty-blue)' : 'var(--color-border)' }}
            onDragOver={e => { e.preventDefault(); setNoticeDragOver(true); }}
            onDragLeave={() => setNoticeDragOver(false)}
            onDrop={e => { e.preventDefault(); setNoticeDragOver(false); [...e.dataTransfer.files].forEach(addNoticeFile); }}
            onClick={() => noticeRef.current?.click()}
          >
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Drop .txt notice files or click to add</span>
            <input ref={noticeRef} type="file" accept=".txt" multiple
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
              onChange={e => [...e.target.files].forEach(addNoticeFile)} />
          </div>

          {noticeFiles.map(nf => (
            <div key={nf.id} style={s.noticeItem}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 12 }}>{nf.name}</strong>
                <StatusBadge status={noticeStatuses[nf.id] ?? 'PENDING'} />
              </div>
              <div style={s.noticePreview}>{nf.preview}…</div>
            </div>
          ))}

          {noticeFiles.length > 0 && (
            <button style={{ ...s.btnSecondary, marginTop: 8 }} onClick={processNotices}>
              Process Notices
            </button>
          )}
        </div>

      </div>

      {/* ── Right panel ── */}
      <div style={s.right}>
        {summary ? (
          <>
            <h3 style={s.subheading}>Tape Summary</h3>
            <div style={s.summaryCards}>
              <StatCard label="Positions"       value={summary.position_count?.toLocaleString()} />
              <StatCard label="Total Par"       value={`$${summary.total_par?.toFixed(1)}M`} />
              <StatCard label="Senior Secured"  value={`${summary.senior_secured_pct?.toFixed(1)}%`} />
              <StatCard label="Second Lien"     value={`${summary.second_lien_pct?.toFixed(1)}%`} />
              <StatCard label="Other"           value={`${summary.other_pct?.toFixed(1)}%`} />
              <StatCard label="Rating Coverage" value={`${summary.rating_coverage_pct?.toFixed(1)}%`} />
            </div>
            {summary.validation_errors?.length > 0 ? (
              <div style={s.warnBox}>
                <strong>Validation warnings:</strong>
                {summary.validation_errors.map((e, i) => <div key={i} style={{ fontSize: 12, marginTop: 4 }}>{e.loan_id}: {e.field} — {e.message}</div>)}
              </div>
            ) : (
              <div style={s.validBanner}>✓ Tape valid — no warnings</div>
            )}
          </>
        ) : (
          <div style={s.emptyRight}>
            <div style={{ fontSize: 32 }}>📊</div>
            <div>Tape summary will appear after file is loaded.</div>
          </div>
        )}

        {changeLog.length > 0 && (
          <>
            <h3 style={{ ...s.subheading, marginTop: 24 }}>Notice Change Log</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <Th>Loan ID</Th><Th>Field</Th><Th>Old Value</Th><Th>New Value</Th><Th>Effective Date</Th>
                </tr></thead>
                <tbody>
                  {changeLog.map((c, i) => (
                    <tr key={i}>
                      <Td><code>{c.loan_id}</code></Td>
                      <Td>{c.field}</Td>
                      <Td style={{ color: 'var(--color-fail)' }}>{String(c.old_value ?? '—')}</Td>
                      <Td style={{ color: 'var(--color-pass)' }}>{String(c.new_value ?? '—')}</Td>
                      <Td>{c.effective_date ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {loanTape.status === 'COMPLETE' && changeLog.length === 0 && (
          <div style={{ ...s.emptyRight, marginTop: 24, height: 80 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No notices processed.</div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface)' }}>
      <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, color: 'var(--color-text-primary)', marginBottom: 5 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const labels = { PENDING: 'PENDING', RUNNING: 'PROCESSING', COMPLETE: 'EXTRACTED', ERROR: 'ERROR' };
  const colors = { PENDING: '#888', RUNNING: 'var(--color-dusty-blue)', COMPLETE: 'var(--color-pass)', ERROR: 'var(--color-fail)' };
  const bgs    = { PENDING: '#f0f0ee', RUNNING: '#e8f0f7', COMPLETE: 'var(--color-pass-tint)', ERROR: 'var(--color-fail-tint)' };
  return (
    <span style={{ fontSize: 10, color: colors[status] ?? '#888', fontWeight: 700, padding: '2px 7px',
                   background: bgs[status] ?? '#f0f0ee', borderRadius: 4, letterSpacing: '0.04em' }}>
      {labels[status] ?? status}
    </span>
  );
}

function Th({ children }) {
  return <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding: '6px 10px', fontSize: 13, borderBottom: '1px solid var(--color-border)', ...style }}>{children}</td>;
}

const s = {
  layout:      { display: 'flex', gap: 24, alignItems: 'flex-start' },
  left:        { width: 340, flexShrink: 0 },
  right:       { flex: 1, minWidth: 0 },
  heading:     { margin: '0 0 16px', fontSize: 16, fontWeight: 700 },
  subheading:  { fontSize: 14, fontWeight: 700, margin: '0 0 10px', color: 'var(--color-text-primary)' },
  optional:    { fontWeight: 400, fontSize: 12, color: 'var(--color-text-muted)' },
  dropzone:    { border: '2px dashed', borderRadius: 8, padding: '20px', textAlign: 'center', cursor: 'pointer', marginBottom: 6 },
  dropText:    { fontWeight: 600, fontSize: 13, marginBottom: 2 },
  dropSub:     { fontSize: 12, color: 'var(--color-text-muted)' },
  noticeZone:  { border: '1px dashed', borderRadius: 6, padding: '12px', textAlign: 'center', cursor: 'pointer', marginBottom: 8 },
  noticeItem:  { border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 10px', marginBottom: 6, background: 'var(--color-bg)' },
  noticePreview: { fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4, fontFamily: 'monospace' },
  demoLink:    { background: 'none', border: 'none', color: 'var(--color-dusty-blue)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: '4px 0', display: 'block', marginBottom: 4 },
  btnPrimary:  { padding: '9px 20px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnSecondary:{ padding: '7px 16px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 13 },
  btnSmallAlt: { padding: '5px 12px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  errorBox:    { marginTop: 10, padding: '10px 12px', background: 'var(--color-fail-tint)', border: '1px solid var(--color-fail-border)', borderRadius: 6 },
  errorMsg:    { color: 'var(--color-fail)', fontSize: 13, marginBottom: 6 },
  warnBox:     { marginTop: 10, padding: '10px 12px', background: 'var(--color-flag-tint)', border: '1px solid var(--color-flag-border)', borderRadius: 6, fontSize: 13 },
  summaryCards: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 },
  validBanner:  { padding: '8px 14px', background: 'var(--color-pass-tint)', border: '1px solid var(--color-pass-border)', borderRadius: 6, fontSize: 13, color: 'var(--color-pass)', fontWeight: 600 },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  emptyRight:  { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 180, color: 'var(--color-text-muted)', gap: 10, textAlign: 'center', fontSize: 14 },
};
