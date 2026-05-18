import { useState, useRef, useEffect } from 'react';
import { useBarlowDemo } from '../context/BarlowDemoContext';
import { extract } from '../api/barlowApi';
import SceneToolbar, { tbBtn, tbNavLink } from '../components/SceneToolbar';

const STATUS_MESSAGES = [
  'Reading indenture...',
  'Extracting coverage tests...',
  'Extracting concentration limits...',
  'Extracting waterfall steps...',
];

export default function Scene1Onboarding() {
  const { state, patch, setScene } = useBarlowDemo();
  const { indenture } = state;

  useEffect(() => { document.title = 'Barlow — Deal Onboarding'; }, []);

  const [msgIdx, setMsgIdx]     = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [apiKey, setApiKey]     = useState('');
  const [showKey, setShowKey]   = useState(false);
  const intervalRef = useRef(null);

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

    const { data, error } = await extract(text, { useFallback, apiKey: apiKey.trim() || undefined });
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
    patch('indenture', { file: { name: 'Carlyle CLO 2024-1 (Demo)', size: 0 }, status: 'RUNNING', error: null, extractionOutput: null });
    stopCycling();
    const { data, error } = await extract(null, { useFallback: true });
    if (error || !data) {
      patch('indenture', { status: 'ERROR', error: error ?? 'Could not load demo fixture' });
      return;
    }
    patch('indenture', { status: 'COMPLETE', extractionOutput: data.extraction, elapsed_ms: 0 });
  }

  const ex = indenture.extractionOutput;
  const isRunning  = indenture.status === 'RUNNING';
  const isComplete = indenture.status === 'COMPLETE';
  const isError    = indenture.status === 'ERROR';

  const toolbarRight = (
    <>
      {isComplete && (
        <button style={tbNavLink} onClick={() => setScene(1)}>Loan Tape →</button>
      )}
      <button
        style={{ ...tbBtn, opacity: (!indenture.text || isRunning) ? 0.5 : 1 }}
        disabled={!indenture.text || isRunning}
        onClick={() => runExtraction()}
      >
        {isRunning ? 'Extracting…' : 'Run Extraction'}
      </button>
    </>
  );

  return (
    <div>
      <SceneToolbar stepNum={1} title="Deal Onboarding" right={toolbarRight} />
    <div style={s.layout}>
      {/* ── Left panel ── */}
      <div style={s.left}>
        <h2 style={s.heading}>Upload Indenture</h2>

        {/* Drop zone — label wraps the input so the whole area is clickable */}
        <label
          style={{ ...s.dropzone, borderColor: dragOver ? 'var(--color-dusty-blue)' : 'var(--color-border)',
                   background: dragOver ? '#f0f4f8' : 'var(--color-bg)' }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div style={s.dropIcon}>📄</div>
          <div style={s.dropText}>Drop indenture .txt or .pdf here</div>
          <div style={s.dropSub}>or click to browse</div>
          <input type="file" accept=".pdf,.txt" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
        </label>

        {indenture.file && indenture.file.name !== 'Carlyle CLO 2024-1 (Demo)' && (
          <div style={s.fileInfo}>
            <strong style={{ fontSize: 13 }}>{indenture.file.name}</strong>
            <span style={s.fileMeta}>
              {indenture.text ? `${(indenture.text.length / 1024).toFixed(0)} KB · ${indenture.text.length.toLocaleString()} chars` : ''}
            </span>
          </div>
        )}

        {/* API key field */}
        <div style={s.keyRow}>
          <input
            type={showKey ? 'text' : 'password'}
            placeholder="Anthropic API key (sk-ant-…)"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={s.keyInput}
          />
          <button style={s.keyToggle} onClick={() => setShowKey(v => !v)} title={showKey ? 'Hide' : 'Show'}>
            {showKey ? '🙈' : '👁'}
          </button>
        </div>
        <div style={s.keyHint}>Required for live extraction. Key is sent only to your local server.</div>

        <button style={s.demoLink} onClick={loadDemo}>
          Use Carlyle CLO 2024-1 (Demo) — no API key needed
        </button>

        {/* Status */}
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
            <span>Extraction complete{indenture.elapsed_ms > 0 ? ` in ${(indenture.elapsed_ms / 1000).toFixed(1)}s` : ''}</span>
          </div>
        )}

        {isError && (
          <div style={s.errorBox}>
            <div style={s.errorMsg}>{indenture.error}</div>
            {indenture.error?.includes('API_KEY') && (
              <div style={s.errorHint}>Paste your Anthropic API key above and retry.</div>
            )}
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
              {indenture.elapsed_ms > 0 ? ` · Extracted in ${(indenture.elapsed_ms / 1000).toFixed(1)}s` : ''}
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

          </>
        ) : isRunning ? (
          <>
            {msgIdx < 1 ? (
              <div style={s.emptyRight}>
                <div style={{ width: 24, height: 24, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-dusty-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <div>Reading indenture structure…</div>
              </div>
            ) : null}
            {msgIdx >= 1 && <SkeletonCard title="Coverage Tests" />}
            {msgIdx >= 2 && <SkeletonCard title="Concentration Limits" />}
            {msgIdx >= 3 && <SkeletonCard title="Waterfall Steps" />}
          </>
        ) : (
          <div style={s.emptyRight}>
            <div style={s.emptyIcon}>🔍</div>
            <div>Extraction results will appear here after you run extraction.</div>
          </div>
        )}
      </div>
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

function SkeletonCard({ title }) {
  return (
    <div style={{ marginBottom: 16, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ ...s.collapseHeader, justifyContent: 'space-between' }}>
        <span>▾ {title}</span>
        <span style={{ width: 12, height: 12, border: '2px solid var(--color-border)', borderTopColor: 'var(--color-dusty-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
      </div>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[75, 55, 88, 62].map((w, i) => (
          <div key={i} style={{ height: 10, background: 'var(--color-border)', borderRadius: 3, width: `${w}%`, opacity: 0.6 }} />
        ))}
      </div>
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
  layout:      { display: 'flex', gap: 24, alignItems: 'flex-start' },
  left:        { width: 340, flexShrink: 0 },
  right:       { flex: 1, minWidth: 0 },
  heading:     { margin: '0 0 16px', fontSize: 16, fontWeight: 700 },
  dropzone:    { border: '2px dashed', borderRadius: 10, padding: '28px 20px', minHeight: 180,
                 textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s', marginBottom: 12,
                 display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  dropIcon:    { fontSize: 28, marginBottom: 8 },
  dropText:    { fontWeight: 600, fontSize: 14, marginBottom: 4 },
  dropSub:     { fontSize: 12, color: 'var(--color-text-muted)' },
  fileInfo:    { padding: '7px 10px', background: 'var(--color-bg)', borderRadius: 6, marginBottom: 8,
                 display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--color-border)' },
  fileMeta:    { color: 'var(--color-text-muted)', fontSize: 12 },
  keyRow:      { display: 'flex', gap: 4, marginTop: 4 },
  keyInput:    { flex: 1, padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 5,
                 fontSize: 12, fontFamily: 'monospace', background: 'var(--color-bg)', color: 'var(--color-text-primary)' },
  keyToggle:   { background: 'none', border: '1px solid var(--color-border)', borderRadius: 5,
                 cursor: 'pointer', padding: '0 8px', fontSize: 14 },
  keyHint:     { fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 4 },
  btnPrimary:  { padding: '9px 20px', background: 'var(--color-text-primary)', color: 'var(--color-surface)',
                 border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnSmall:    { padding: '6px 14px', background: 'var(--color-text-primary)', color: 'var(--color-surface)',
                 border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 13 },
  btnSmallAlt: { padding: '6px 14px', background: 'transparent', color: 'var(--color-text-primary)',
                 border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 13 },
  demoLink:    { padding: '7px 14px', background: 'transparent', color: 'var(--color-text-primary)',
                 border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', fontSize: 13,
                 display: 'block', marginTop: 12, textAlign: 'center' },
  statusBox:   { marginTop: 16, display: 'flex', alignItems: 'flex-start', padding: '12px',
                 background: 'var(--color-bg)', borderRadius: 8, border: '1px solid var(--color-border)' },
  statusMsg:   { fontWeight: 600, fontSize: 13, marginBottom: 4 },
  aiCallout:   { fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5, fontStyle: 'italic' },
  successBox:  { marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
                 background: 'var(--color-pass-tint)', border: '1px solid var(--color-pass-border)',
                 borderRadius: 6, fontSize: 13, color: 'var(--color-pass)' },
  checkmark:   { fontWeight: 700, fontSize: 16 },
  errorBox:    { marginTop: 14, padding: '12px', background: 'var(--color-fail-tint)',
                 border: '1px solid var(--color-fail-border)', borderRadius: 6 },
  errorMsg:    { color: 'var(--color-fail)', fontSize: 13, fontWeight: 600 },
  errorHint:   { fontSize: 12, color: 'var(--color-fail)', marginTop: 4, opacity: 0.8 },
  summaryBar:  { padding: '8px 12px', background: 'var(--color-surface)', borderRadius: 6, fontSize: 13,
                 color: 'var(--color-text-muted)', marginBottom: 16, border: '1px solid var(--color-border)',
                 position: 'sticky', top: 0, zIndex: 1 },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  collapseHeader: { width: '100%', background: 'var(--color-bg)', border: 'none', padding: '10px 14px',
                    textAlign: 'left', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    display: 'flex', alignItems: 'center', gap: 6 },
  emptyRight:  { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                 height: 260, color: 'var(--color-text-muted)', gap: 12, textAlign: 'center', fontSize: 14 },
  emptyIcon:   { fontSize: 36 },
};
