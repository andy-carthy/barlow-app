import { useState } from 'react';
import IndenturUpload from './components/IndenturUpload';
import RulesPanel from './components/RulesPanel';
import LoanTapeInput from './components/LoanTapeInput';
import TestResults from './components/TestResults';
import { runOCTests, runICTests, runConcentrationTests } from './engine/testRunner';

const STEPS = ['Upload', 'Rules', 'Loan Tape', 'Results'];

export default function App() {
  const [step, setStep] = useState(0);

  // ── Core data state ────────────────────────────────────────────────────────
  const [extractedRules, setExtractedRules] = useState(null);
  const [testResults,    setTestResults]    = useState(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [runningTests, setRunningTests] = useState(false);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleExtracted(rules) {
    setExtractedRules(rules);
    setStep(1);
  }

  function handleRunTests(loans) {
    if (!extractedRules) return;

    setRunningTests(true);
    setTestResults(null);

    const coverage      = [...runOCTests(extractedRules, loans), ...runICTests(extractedRules, loans)];
    const concentration = runConcentrationTests(extractedRules, loans);

    setTestResults({ coverage, concentration });
    setRunningTests(false);
    setStep(3);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.logo}>BARLOW</div>
        <div style={styles.subtitle}>CLO Administration AI Pipeline</div>
        <nav style={styles.nav}>
          {STEPS.map((label, i) => (
            <button
              key={label}
              style={i === step ? styles.navActive : i < step ? styles.navDone : styles.navStep}
              onClick={() => i <= step && setStep(i)}
              disabled={i > step}
            >
              <span style={styles.navNum}>{i + 1}</span>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main style={styles.main}>
        {step === 0 && (
          <Panel title="Step 1 — Upload Indenture">
            <IndenturUpload onExtracted={handleExtracted} />
          </Panel>
        )}

        {step === 1 && (
          <Panel title="Step 2 — Extracted Rules" onNext={() => setStep(2)} nextLabel="Proceed to Loan Tape →">
            <RulesPanel extractedRules={extractedRules} />
          </Panel>
        )}

        {step === 2 && (
          <Panel title="Step 3 — Loan Tape">
            <LoanTapeInput
              onRunTests={handleRunTests}
              loading={runningTests}
              disabled={!extractedRules}
            />
          </Panel>
        )}

        {step === 3 && (
          <Panel title="Step 4 — Test Results" onBack={() => setStep(2)} backLabel="← Back to Tape">
            <TestResults testResults={testResults} />
          </Panel>
        )}
      </main>
    </div>
  );
}

// ── Panel shell ────────────────────────────────────────────────────────────────

function Panel({ title, children, onNext, nextLabel, onBack, backLabel }) {
  return (
    <div style={panel.container}>
      <div style={panel.header}>
        <h1 style={panel.title}>{title}</h1>
        <div style={panel.actions}>
          {onBack && <button style={panel.btnSecondary} onClick={onBack}>{backLabel || '← Back'}</button>}
          {onNext && <button style={panel.btnPrimary}   onClick={onNext}>{nextLabel  || 'Next →'}</button>}
        </div>
      </div>
      <div style={panel.body}>{children}</div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  app:      { minHeight: '100vh', background: 'var(--color-bg)', fontFamily: "'Inter', system-ui, sans-serif" },
  header:   { background: 'var(--color-text-primary)', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 24 },
  logo:     { color: 'var(--color-surface)', fontWeight: 800, fontSize: 20, letterSpacing: '0.12em' },
  subtitle: { color: 'var(--color-text-muted)', fontSize: 13, flex: 1 },
  nav:      { display: 'flex', gap: 4 },
  navStep:  { background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 13, padding: '6px 12px',
              borderRadius: 6, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 },
  navDone:  { background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 13, padding: '6px 12px',
              borderRadius: 6, cursor: 'pointer',    display: 'flex', alignItems: 'center', gap: 6 },
  navActive:{ background: 'var(--color-surface)', border: 'none', color: 'var(--color-text-primary)', fontSize: 13, padding: '6px 12px',
              borderRadius: 6, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 },
  navNum:   { width: 18, height: 18, borderRadius: '50%', background: 'var(--color-dusty-blue)', color: 'var(--color-surface)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 },
  main:     { maxWidth: 1100, margin: '0 auto', padding: '32px 24px' },
};

const panel = {
  container:   { background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                 padding: '16px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' },
  title:       { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' },
  actions:     { display: 'flex', gap: 8 },
  body:        { padding: '20px 24px' },
  btnPrimary:  { padding: '8px 18px', background: 'var(--color-text-primary)', color: 'var(--color-surface)', border: 'none',
                 borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnSecondary:{ padding: '8px 18px', background: 'var(--color-surface)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)',
                 borderRadius: 6, cursor: 'pointer', fontSize: 14 },
};
