import { useBarlowDemo } from '../context/BarlowDemoContext';
import BarlowLogo from './BarlowLogo';

const STEPS = [
  { label: 'Deal Onboarding',      statusKey: 'indenture' },
  { label: 'Loan Tape',            statusKey: 'loanTape' },
  { label: 'Coverage Tests',       statusKey: 'coverageTests' },
  { label: 'Waterfall',            statusKey: 'waterfall' },
  { label: 'Trustee Report',       statusKey: 'report' },
  { label: 'Exception Management', statusKey: null, alwaysEnabled: true },
];

export default function Sidebar() {
  const { state, scene, setScene } = useBarlowDemo();

  return (
    <aside style={s.sidebar}>
      <div style={s.brand}>
        <BarlowLogo />
      </div>

      <nav style={s.nav}>
        {STEPS.map((step, i) => {
          const status      = step.statusKey ? (state[step.statusKey]?.status ?? 'IDLE') : 'IDLE';
          const isActive    = i === scene;
          const isComplete  = status === 'COMPLETE';
          const isError     = status === 'ERROR';
          const isClickable = step.alwaysEnabled || i <= scene || isComplete;

          return (
            <button
              key={step.label}
              style={{
                ...s.step,
                ...(isActive    ? s.stepActive   : {}),
                ...(isClickable ? {} : s.stepDisabled),
              }}
              disabled={!isClickable}
              onClick={() => isClickable && setScene(i)}
            >
              <StepCircle index={i} isActive={isActive} isComplete={isComplete} isError={isError} />
              <span style={{ ...s.label, color: isActive ? '#fff' : isComplete ? '#b0c4b8' : '#888' }}>
                {step.label}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function StepCircle({ index, isActive, isComplete, isError }) {
  let bg      = 'transparent';
  let border  = '#555';
  let color   = '#666';
  let content = String(index + 1);

  if (isComplete) { bg = '#4a7c59'; border = '#4a7c59'; color = '#fff'; content = '✓'; }
  else if (isError)    { bg = '#a05252'; border = '#a05252'; color = '#fff'; content = '✗'; }
  else if (isActive)   { bg = '#7a8fa6'; border = '#7a8fa6'; color = '#fff'; }

  return (
    <span style={{ ...s.circle, background: bg, borderColor: border, color }}>
      {content}
    </span>
  );
}

const SIDEBAR_BG = '#1f2225';

const s = {
  sidebar:      { width: 220, minWidth: 220, height: '100vh', background: SIDEBAR_BG, display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0 },
  brand:        { padding: '28px 20px 22px', borderBottom: '1px solid #2e3438' },
  nav:          { padding: '12px 0', flex: 1 },
  step:         { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 16px', background: 'none', border: 'none', borderLeft: '3px solid transparent', cursor: 'default', textAlign: 'left', transition: 'background 0.15s' },
  stepActive:   { background: 'rgba(122,143,166,0.14)', borderLeftColor: '#7a8fa6', cursor: 'pointer' },
  stepDisabled: { opacity: 0.4 },
  label:        { fontSize: 13, fontWeight: 500, lineHeight: 1.2 },
  circle:       { width: 24, height: 24, borderRadius: '50%', border: '2px solid', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' },
};
