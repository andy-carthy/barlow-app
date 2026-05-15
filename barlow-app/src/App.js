import { BarlowDemoProvider, useBarlowDemo } from './context/BarlowDemoContext';
import ProgressBar from './components/ProgressBar';
import Scene1Onboarding from './scenes/Scene1Onboarding';
import Scene2LoanTape from './scenes/Scene2LoanTape';
import Scene3CoverageTests from './scenes/Scene3CoverageTests';
import Scene4Waterfall from './scenes/Scene4Waterfall';
import Scene5Report from './scenes/Scene5Report';

const SCENE_TITLES = [
  'Deal Onboarding',
  'Loan Tape',
  'Coverage Tests',
  'Waterfall',
  'Trustee Report',
];

function AppShell() {
  const { scene } = useBarlowDemo();

  return (
    <div style={s.app}>
      <header style={s.header}>
        <div style={s.logo}>BARLOW</div>
        <div style={s.subtitle}>CLO Administration AI Pipeline</div>
      </header>

      <ProgressBar />

      <main style={s.main}>
        <div style={s.panelHeader}>
          <h1 style={s.panelTitle}>Scene {scene + 1} — {SCENE_TITLES[scene]}</h1>
        </div>
        <div style={s.panelBody}>
          {scene === 0 && <Scene1Onboarding />}
          {scene === 1 && <Scene2LoanTape />}
          {scene === 2 && <Scene3CoverageTests />}
          {scene === 3 && <Scene4Waterfall />}
          {scene === 4 && <Scene5Report />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BarlowDemoProvider>
      <AppShell />
    </BarlowDemoProvider>
  );
}

const s = {
  app:         { minHeight: '100vh', background: 'var(--color-bg)', fontFamily: "'Inter', system-ui, sans-serif" },
  header:      { background: 'var(--color-text-primary)', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 20 },
  logo:        { color: 'var(--color-surface)', fontWeight: 800, fontSize: 18, letterSpacing: '0.12em' },
  subtitle:    { color: '#888', fontSize: 13 },
  main:        { maxWidth: 1200, margin: '0 auto', padding: '24px' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'var(--color-bg)', borderRadius: '10px 10px 0 0', borderBottom: '1px solid var(--color-border)', border: '1px solid var(--color-border)' },
  panelTitle:  { margin: 0, fontSize: 17, fontWeight: 700 },
  panelBody:   { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '24px' },
};
