import { useBarlowDemo } from '../context/BarlowDemoContext';

const SCENES = [
  { label: 'Deal Onboarding',  statusKey: 'indenture' },
  { label: 'Loan Tape',        statusKey: 'loanTape' },
  { label: 'Coverage Tests',   statusKey: 'coverageTests' },
  { label: 'Waterfall',        statusKey: 'waterfall' },
  { label: 'Trustee Report',   statusKey: 'report' },
];

export default function ProgressBar() {
  const { state, scene, setScene } = useBarlowDemo();

  return (
    <nav style={s.bar}>
      {SCENES.map((sc, i) => {
        const status = state[sc.statusKey]?.status ?? 'IDLE';
        const isActive   = i === scene;
        const isComplete = status === 'COMPLETE';
        const isError    = status === 'ERROR';
        const isClickable = i <= scene || isComplete;

        let nodeColor = 'var(--color-border)';
        if (isActive)   nodeColor = 'var(--color-dusty-blue)';
        if (isComplete) nodeColor = 'var(--color-pass)';
        if (isError)    nodeColor = 'var(--color-fail)';

        return (
          <div key={sc.label} style={s.item}>
            {i > 0 && (
              <div style={{
                ...s.connector,
                background: isComplete || i <= scene ? 'var(--color-dusty-blue)' : 'var(--color-border)',
              }} />
            )}
            <button
              style={{ ...s.node, borderColor: nodeColor, color: isActive ? 'var(--color-surface)' : nodeColor,
                       background: isActive ? nodeColor : 'var(--color-surface)',
                       cursor: isClickable ? 'pointer' : 'not-allowed', opacity: isClickable ? 1 : 0.45 }}
              disabled={!isClickable}
              onClick={() => isClickable && setScene(i)}
              title={sc.label}
            >
              {isComplete ? '✓' : isError ? '✗' : i + 1}
            </button>
            <span style={{ ...s.label, color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                           fontWeight: isActive ? 700 : 400 }}>
              {sc.label}
            </span>
          </div>
        );
      })}
    </nav>
  );
}

const s = {
  bar:       { display: 'flex', alignItems: 'center', gap: 0, padding: '12px 32px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' },
  item:      { display: 'flex', alignItems: 'center', gap: 8 },
  connector: { width: 40, height: 2, marginRight: 8 },
  node:      { width: 28, height: 28, borderRadius: '50%', border: '2px solid', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' },
  label:     { fontSize: 13, whiteSpace: 'nowrap' },
};
