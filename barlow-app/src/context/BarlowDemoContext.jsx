import { createContext, useContext, useState } from 'react';

const IDLE = 'IDLE';

const initialSubState = {
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

const initialExceptionRegister = {
  exceptions: [],
  open_count: 0,
  resolved_count: 0,
  waived_count: 0,
};

function makeDeal(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: 'New Deal',
    indenture_file: null,
    loan_tape_file: null,
    exception_register: { ...initialExceptionRegister },
    is_active: false,
    loaded_at: new Date().toISOString(),
    ...initialSubState,
    ...overrides,
  };
}

const BarlowDemoContext = createContext(null);

// Fixed ID matches the seed data in server/db/seeds/carlyle.js
const _initial = makeDeal({ id: 'carlyle-2024-1', name: 'Carlyle DL CLO 2024-1', is_active: true });

export function BarlowDemoProvider({ children }) {
  const [deals, setDeals] = useState([_initial]);
  const [activeDealId, setActiveDealId] = useState(_initial.id);
  const [scene, setScene] = useState(0);

  // Re-derive active deal; fall back to first deal if id drifts
  const activeDeal = deals.find(d => d.id === activeDealId) ?? deals[0] ?? null;

  // Backward-compat state object — scenes destructure this unchanged
  const state = {
    indenture:     activeDeal?.indenture     ?? initialSubState.indenture,
    loanTape:      activeDeal?.loanTape      ?? initialSubState.loanTape,
    coverageTests: activeDeal?.coverageTests ?? initialSubState.coverageTests,
    waterfall:     activeDeal?.waterfall     ?? initialSubState.waterfall,
    report:        activeDeal?.report        ?? initialSubState.report,
  };

  // Backward-compat patch — scenes call patch('indenture', { status: 'RUNNING' })
  function patch(key, updates) {
    const id = activeDeal?.id;
    if (!id) return;
    setDeals(ds => ds.map(d =>
      d.id === id
        ? { ...d, [key]: { ...d[key], ...updates } }
        : d
    ));
  }

  // Merge arbitrary fields into the active deal (used by Phase 7 components)
  function updateActiveDeal(dealPatch) {
    const id = activeDeal?.id;
    if (!id) return;
    setDeals(ds => ds.map(d => d.id === id ? { ...d, ...dealPatch } : d));
  }

  function switchDeal(dealId) {
    setDeals(ds => ds.map(d => ({ ...d, is_active: d.id === dealId })));
    setActiveDealId(dealId);
  }

  // Stubbed — full implementation in Step 9
  async function loadNewDeal(indenture, loanTape, name) {
    const newDeal = makeDeal({ name: name ?? 'New Deal', is_active: false });
    setDeals(ds => [...ds, newDeal]);
    switchDeal(newDeal.id);
    return newDeal.id;
  }

  function reset() {
    const id = activeDeal?.id;
    if (!id) return;
    setDeals(ds => ds.map(d =>
      d.id === id ? { ...d, ...initialSubState } : d
    ));
    setScene(0);
  }

  return (
    <BarlowDemoContext.Provider value={{
      // Backward-compat interface (all existing scenes use these unchanged)
      state, patch, scene, setScene, reset,
      // Multi-deal interface (Phase 7)
      deals, activeDeal, activeDealId,
      switchDeal, loadNewDeal, updateActiveDeal,
    }}>
      {children}
    </BarlowDemoContext.Provider>
  );
}

export function useBarlowDemo() {
  const ctx = useContext(BarlowDemoContext);
  if (!ctx) throw new Error('useBarlowDemo must be used within BarlowDemoProvider');
  return ctx;
}
