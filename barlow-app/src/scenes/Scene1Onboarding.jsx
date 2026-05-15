import { useState, useRef } from 'react';
import { useBarlowDemo } from '../context/BarlowDemoContext';
import { extract } from '../api/barlowApi';

const STATUS_MESSAGES = [
  'Reading indenture...',
  'Extracting coverage tests...',
  'Extracting concentration limits...',
  'Extracting waterfall steps...',
];

export default function Scene1Onboarding() {
  const { state, patch, setScene } = useBarlowDemo();
  const { indenture } = state;

  const [msgIdx, setMsgIdx] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const intervalRef = useRef(null);
  const fileRef     = useRef(null);

  function cycleMessages() {
    setMsgIdx(0);
    intervalRef.current = setInterval(() => {
      setMsgIdx(i => (i + 1) % STATUS_MESSAGES.length);
    }, 1800);
  }

  function stopCycling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function handleFile(file) {
    if (!file) return;
    const text = await file.text();
    patch('indenture', { file, text, status: 'IDLE', error: null, extractionOutput: null });
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function runExtraction(textOverride, useFallback = false) {
    const text = textOverride ?? indenture.text;
    if (!text && !useFallback) return;

    patch('indenture', { status: 'RUNNING', error: null, extractionOutput: null, elapsed_ms: null });
    cycleMessages();

    const { data, error } = await extract(text, { useFallback });
    stopCycling();

    if (error || !data) {
      patch('indenture', { status: 'ERROR', error: error ?? 'Unknown error' });
      return;
    }

    patch('indenture', {
      status: 'COMPLETE',
      extractionOutput: data.extraction,
      elapsed_ms: data.elapsed_ms,
    });
  }

  async function loadDemo() {
    try {
      const res = await fetch('/fixtures/demo/carlyle_indenture_excerpt.txt');
      const text = res.ok ? await res.text() : null;
      patch('indenture', { file: { name: 'Carlyle CLO 2024-1 (Demo)', size: text?.length ?? 0 }, text, status: 'IDLE', error: null });
      if (text) runExtraction(text, false);
      else runExtraction(null, true);
    } catch {
      runExtraction(null, true);
    }
  }

  const ex = indenture.extractionOutput;
  const isRunning  = indenture.status === 'RUNNING';
  const isComplete = indenture.status === 'COMPLETE';
  const isError    = indenture.status === 'ERROR';

  return (
    <div style={s.layout}>
      {/* ── Left panel ── */}
      <div style={s.left}>
        <h2 style={s.heading}>Upload Indenture</h2>

        <div
          style={{ ...s.dropzone, borderColor: dragOver ? 'var(--color-dusty-blue)' : 'var(--color-border)',
                   background: dragOver ? '#f0f4f8' : 'var(--color-bg)' }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <div style={s.dropIcon}>📄</div>
          <div style={s.dropText}>Drop indenture PDF or .txt here</div>
          <div style={s.dropSub}>or click to browse</div>
          <input ref={fileRef} type="file" accept=".pdf,.txt" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
        </div>

        {indenture.file && (
          <div style={s.fileInfo}>
            <strong>{indenture.file.name}</strong>
            <span style={s.fileMeta}>
              {indenture.file.size ? `${(indenture.file.size / 1024).toFixed(0)} KB` : ''}
              {indenture.text ? ` · ${indenture.text.length.toLocaleString()} chars` : ''}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            style={{ ...s.btnPrimary, opacity: (!indenture.text || isRunning) ? 0.5 : 1 }}
            disabled={!indenture.text || isRunning}
            onClick={() => runExtraction()}
          >
            {isRunning ? 'Extracting…' : 'Run Extraction'}
          </button>
        </div>

        <button style={s.demoLink} onClick={loadDemo}>
          Use Carlyle CLO 2024-1 (Demo)
        </button>

        {/* Status indicator */}
        {isRunning && (
          <div style={s.statusBox}>
            <Spinner />
            <div style={{ marginLeft: 10 }}>
              <div style={s.statusMsg}>{STATUS_MESSAGES[msgIdx]}</div>
              <div style={s.aiCallout}>
                Claude is reading legal prose and extracting structured deal rules.
                This takes a human analyst 2–3 days.
              </div>
            </div>
          </div>
        )}

        {isComplete && (
          <div style={s.successBox}>
            <span style={s.checkmark}>✓</span>
            <span>Extraction complete{indenture.elapsed_ms ? ` in ${(indenture.elapsed_ms / 1000).toFixed(1)}s` : ''}</span>
          </div>
        )}

        {isError && (
          <div style={s.errorBox}>
            <div style={s.errorMsg}>Extraction failed — {indenture.error}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button style={s.btnSmall} onClick={() => runExtraction()}>Retry</button>
              <button style={s.btnSmallAlt} onClick={() => runExtraction(null, true)}>Use demo fixture instead</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right panel ── */}
      <div style={s.right}>
        {isComplete && ex ? (
          <>
            <div style={s.summaryBar}>
              {ex.coverage_tests?.length ?? 0} coverage tests ·&nbsp;
              {ex.concentration_limits?.length ?? 0} concentration limits ·&nbsp;
              {ex.waterfall_steps?.length ?? 0} waterfall steps
              {indenture.elapsed_ms ? ` · Extracted in ${(indenture.elapsed_ms / 1000).toFixed(1)}s` : ''}
            </div>

            <Collapsible title={`Coverage Tests (${ex.coverage_tests?.length ?? 0})`}>
              <table style={s.table}>
                <thead><tr>
                  <Th>Test ID</Th><Th>Threshold</Th><Th>Type</Th><Th>Section</Th>
                </tr></thead>
                <tbody>
                  {(ex.coverage_tests ?? []).map(t => (
                    <tr key={t.test_id}>
                      <Td><code>{t.test_id}</code></Td>
                      <Td>{t.threshold_pct?.toFixed(2)}%</Td>
                      <Td>{t.test_type === 'overcollateralization' ? 'OC' : 'IC'}</Td>
                      <Td style={{ color: 'var(--color-dusty-blue)' }}>{t.source_clause}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Collapsible>

            <Collapsible title={`Concentration Limits (${ex.concentration_limits?.length ?? 0})`}>
              <table style={s.table}>
                <thead><tr>
                  <Th>Description</Th><Th>Max %</Th><Th>Dimension</Th><Th>Section</Th>
                </tr></thead>
                <tbody>
                  {(ex.concentration_limits ?? []).map(l => (
                    <tr key={l.limit_id}>
                      <Td>{l.description}</Td>
                      <Td>{l.max_pct?.toFixed(2)}%</Td>
                      <Td>{l.dimension}</Td>
                      <Td style={{ color: 'var(--color-dusty-blue)' }}>{l.source_clause}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Collapsible>

            <Collapsible title={`Waterfall Steps (${ex.waterfall_steps?.length ?? 0})`}>
              <table style={s.table}>
                <thead><tr>
                  <Th>#</Th><Th>Type</Th><Th>Label</Th><Th>Condition</Th>
                </tr></thead>
                <tbody>
                  {(ex.waterfall_steps ?? []).map(step => {
                    const isDiversion = step.step_type === 'COVERAGE_TEST_CHECK';
                    return (
                      <tr key={step.step_id} style={isDiversion ? { borderLeft: '3px solid var(--color-flag)' } : {}}>
                        <Td>{step.step_number}</Td>
                        <Td><span style={isDiversion ? { color: 'var(--color-flag)', fontWeight: 600 } : {}}>{step.step_type}</span></Td>
                        <Td>{step.label}</Td>
                        <Td style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {step.condition ? `${step.condition.test_type} ${step.condition.note_classes_tested?.join('+')}` : '—'}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Collapsible>

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <button style={s.btnPrimary} onClick={() => setScene(1)}>
                Load Loan Tape →
              </button>
            </div>
          </>
        ) : (
          <div style={s.emptyRight}>
            <div style={s.emptyIcon}>🔍</div>
            <div>Extraction results will appear here after you run extraction.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Collapsible({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 16, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={s.collapseHeader}>
        <span>{open ? '▾' : '▸'}</span> {title}
      </button>
      {open && <div style={{ padding: '12px 16px', overflowX: 'auto' }}>{children}</div>}
    </div>
  );
}

function Th({ children }) {
  return <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding: '6px 10px', fontSize: 13, borderBottom: '1px solid var(--color-border)', verticalAlign: 'top', ...style }}>{children}</td>;
}

function Spinner() {
  return <div style={{ width: 18, height: 18, border: '2px solid var(--color-border)', borderTopColor: 'var(--color-dusty-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />;
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = {
  layout:     { display: 'flex', gap: 24, alignItems: 'flex-start' },
  left:       { width: 340, flexShrink: 0 },
  right:      { flex: 1, minWidth: 0 },
  heading:    { margin: '0 0 16px', fontSize: 16, fontWeight: 700 },
  dropzone:   { border: '2px dashed', borderRadius: 10, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', marginBottom: 12 },
  dropIcon:   { fontSize: 28, marginBottom: 8 },
  dropText:   { fontWeight: 600, fontSize: 14, marginBottom: 4 },
  dropSub:    { fontSize: 12, color: 'var(--color-text-muted)' },
  fileInfo:   { padding: '8px 12px', background: 'var(--color-bg)', borderRadius: 6, fontSize: 13, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  fileMeta:   { color: 'var(--color-text-muted)', fontSize: 12 },
  btnPrimary: { padding: '9px 20px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnSmall:   { padding: '6px 14px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 13 },
  btnSmallAlt:{ padding: '6px 14px', background: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 13 },
  demoLink:   { background: 'none', border: 'none', color: 'var(--color-dusty-blue)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: '8px 0', display: 'block', marginTop: 6 },
  statusBox:  { marginTop: 16, display: 'flex', alignItems: 'flex-start', padding: '12px', background: 'var(--color-bg)', borderRadius: 8, border: '1px solid var(--color-border)' },
  statusMsg:  { fontWeight: 600, fontSize: 13, marginBottom: 4 },
  aiCallout:  { fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5, fontStyle: 'italic' },
  successBox: { marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--color-pass-tint)', border: '1px solid var(--color-pass-border)', borderRadius: 6, fontSize: 13, color: 'var(--color-pass)' },
  checkmark:  { fontWeight: 700, fontSize: 16 },
  errorBox:   { marginTop: 16, padding: '12px', background: 'var(--color-fail-tint)', border: '1px solid var(--color-fail-border)', borderRadius: 6 },
  errorMsg:   { color: 'var(--color-fail)', fontSize: 13, fontWeight: 600 },
  summaryBar: { padding: '8px 12px', background: 'var(--color-bg)', borderRadius: 6, fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16, border: '1px solid var(--color-border)' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  collapseHeader: { width: '100%', background: 'var(--color-bg)', border: 'none', padding: '10px 14px', textAlign: 'left', cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 },
  emptyRight: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: 'var(--color-text-muted)', gap: 12, textAlign: 'center', fontSize: 14 },
  emptyIcon:  { fontSize: 36 },
};
