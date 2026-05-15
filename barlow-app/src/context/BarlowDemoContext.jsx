import { createContext, useContext, useState } from 'react';

const IDLE = 'IDLE', RUNNING = 'RUNNING', COMPLETE = 'COMPLETE', ERROR = 'ERROR';

const initial = {
  indenture: {
    file: null, text: null, status: IDLE,
    extractionOutput: null, error: null, elapsed_ms: null,
  },
  loanTape: {
    file: null, status: IDLE, positions: null, summary: null,
    notices: [], changeLog: null, error: null,
  },
  coverageTests: {
    status: IDLE, results: null, concentrationResults: null, error: null,
  },
  waterfall: {
    status: IDLE, collections: null,
    diversionLedger: null, allocationLedger: null, error: null,
  },
  report: {
    status: IDLE, trusteeReport: null, markdown: null,
    narrativeStatus: IDLE, narratives: [], error: null,
  },
};

const BarlowDemoContext = createContext(null);

export function BarlowDemoProvider({ children }) {
  const [state, setState] = useState(initial);
  const [scene, setScene] = useState(0);

  function patch(key, updates) {
    setState(s => ({ ...s, [key]: { ...s[key], ...updates } }));
  }

  function reset() {
    setState(initial);
    setScene(0);
  }

  return (
    <BarlowDemoContext.Provider value={{ state, patch, scene, setScene, reset }}>
      {children}
    </BarlowDemoContext.Provider>
  );
}

export function useBarlowDemo() {
  const ctx = useContext(BarlowDemoContext);
  if (!ctx) throw new Error('useBarlowDemo must be used within BarlowDemoProvider');
  return ctx;
}
