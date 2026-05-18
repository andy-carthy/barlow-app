import { BarlowDemoProvider, useBarlowDemo } from './context/BarlowDemoContext';
import Sidebar from './components/Sidebar';
import Scene1Onboarding from './scenes/Scene1Onboarding';
import Scene2LoanTape from './scenes/Scene2LoanTape';
import Scene3CoverageTests from './scenes/Scene3CoverageTests';
import Scene4Waterfall from './scenes/Scene4Waterfall';
import Scene5Report from './scenes/Scene5Report';
import Scene6ExceptionManagement from './scenes/Scene6_ExceptionManagement';

function AppShell() {
  const { scene } = useBarlowDemo();

  return (
    <div style={s.app}>
      <Sidebar />
      <div style={s.content}>
        {scene === 0 && <Scene1Onboarding />}
        {scene === 1 && <Scene2LoanTape />}
        {scene === 2 && <Scene3CoverageTests />}
        {scene === 3 && <Scene4Waterfall />}
        {scene === 4 && <Scene5Report />}
        {scene === 5 && <Scene6ExceptionManagement />}
      </div>
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
  app:     { display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--color-bg)', fontFamily: "'Inter', system-ui, sans-serif" },
  content: { flex: 1, minWidth: 0, height: '100vh', overflowY: 'auto', padding: '16px 32px 40px' },
};
