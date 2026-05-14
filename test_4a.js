#!/usr/bin/env node
// Phase 4A completion gate — runs the 5 diversion scenarios independently
// of the extraction pipeline. No API key required.

// ── Engine (ported from barlow_cli.js) ───────────────────────────────────────

function r2(n) { return Math.round(n * 100) / 100; }

function noteClassesToSuffix(noteClasses) {
  const order = { A: 1, B: 2, C: 3, D: 4, E: 5 };
  const letters = noteClasses
    .map(c => c.replace('CLASS_', ''))
    .filter(l => order[l] !== undefined)
    .sort((a, b) => order[a] - order[b]);
  if (letters.length === 0) return null;
  if (letters.join('') === 'AB') return 'AB';
  return letters[letters.length - 1];
}

function resolveTestResult(condition, testIndex) {
  const suffix = noteClassesToSuffix(condition.note_classes_tested || []);
  if (!suffix) return { result: null, testId: null };
  const prefix     = condition.test_type === 'OC' ? 'OC_CLASS_' : 'IC_CLASS_';
  const expectedId = `${prefix}${suffix}`;
  const direct     = testIndex.get(expectedId);
  if (direct) return { result: direct, testId: expectedId };
  const typeStr = condition.test_type === 'OC' ? 'overcollateralization' : 'interest_coverage';
  for (const [id, r] of testIndex) {
    if (r.test_type === typeStr && id.includes(suffix)) return { result: r, testId: id };
  }
  return { result: null, testId: null };
}

function evaluateCondition(condition, testIndex) {
  if (!condition || condition.test_type === 'NONE') return { passed: true, failingTestId: null };
  const { result, testId } = resolveTestResult(condition, testIndex);
  if (!result) return { passed: true, failingTestId: null };
  if (condition.operator === 'ALL_PASS') {
    return result.result === 'FAIL'
      ? { passed: false, failingTestId: testId }
      : { passed: true,  failingTestId: null };
  }
  return result.result === 'PASS'
    ? { passed: true,  failingTestId: null }
    : { passed: false, failingTestId: testId };
}

function resolveNoteInterest(noteClass, capital) {
  switch (noteClass) {
    case 'CLASS_A': return capital.class_a_interest_due;
    case 'CLASS_B': return capital.class_b_interest_due ?? 0;
    case 'CLASS_C': return capital.class_c_interest_due ?? 0;
    case 'CLASS_D': return capital.class_d_interest_due ?? 0;
    default:        return 0;
  }
}

function resolveWaterfallPayment(step, capital, remaining) {
  if (step.amount_basis === 'REMAINING_PROCEEDS') return remaining;
  if (step.step_type === 'FEE') {
    const id = step.step_id.toUpperCase();
    if (id.includes('TRUSTEE'))                                 return capital.trustee_fee;
    if (id.includes('SR_MGMT') || id.includes('SENIOR_MGMT'))  return capital.senior_management_fee;
    if (id.includes('HEDGE'))                                   return capital.hedge_payments ?? 0;
    if (id.includes('SUB_MGMT') || id.includes('SUBORDINATE')) return capital.subordinate_management_fee ?? 0;
    return 0;
  }
  if (step.step_type === 'INTEREST_PAYMENT' && step.note_class) {
    return resolveNoteInterest(step.note_class, capital);
  }
  return 0;
}

function runWaterfallDiversion({ payment_date, period_start, period_end,
    waterfall_steps, coverage_test_results, available_interest_proceeds, capital_structure }) {
  const testIndex = new Map(coverage_test_results.map(r => [r.test_id, r]));
  const sorted    = [...waterfall_steps].sort((a, b) => a.step_number - b.step_number);
  let remaining        = available_interest_proceeds;
  let totalDiverted    = 0;
  let totalDistributed = 0;
  const entries = [];
  const blocked = new Set();

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];
    if (blocked.has(step.step_id))        continue;
    if (step.step_type === 'REINVESTMENT') continue;

    if (step.step_type === 'FEE' || step.step_type === 'INTEREST_PAYMENT') {
      const amt  = resolveWaterfallPayment(step, capital_structure, remaining);
      const paid = r2(Math.min(amt, remaining));
      remaining        = r2(remaining - paid);
      totalDistributed = r2(totalDistributed + paid);
      continue;
    }

    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      const { passed, failingTestId } = evaluateCondition(step.condition, testIndex);
      if (passed) {
        if (step.note_class) {
          const amt  = resolveNoteInterest(step.note_class, capital_structure);
          const paid = r2(Math.min(amt, remaining));
          remaining        = r2(remaining - paid);
          totalDistributed = r2(totalDistributed + paid);
        }
      } else {
        const before   = remaining;
        const diverted = remaining;
        remaining     = 0;
        totalDiverted = r2(totalDiverted + diverted);
        const target  = step.diverts_to || { step_type: 'REINVESTMENT', note_class_priority: [], description: 'Principal reinvestment/cure' };
        entries.push({
          step_id:           step.step_id,
          step_number:       step.step_number,
          triggering_test:   failingTestId || (step.condition && step.condition.test_type) || 'UNKNOWN',
          test_result:       'FAIL',
          diversion_amount:  r2(diverted),
          diversion_target:  target,
          cure_mechanism:    step.cure_mechanism || 'REINVESTMENT',
          proceeds_before:   r2(before),
          proceeds_after:    0,
          indenture_section: step.indenture_section,
        });
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].step_type !== 'REINVESTMENT') blocked.add(sorted[j].step_id);
        }
        break;
      }
    }
  }

  return {
    payment_date, period_start, period_end,
    total_interest_proceeds: r2(available_interest_proceeds),
    total_diverted:          r2(totalDiverted),
    total_distributed:       r2(totalDistributed),
    entries,
    blocked_steps: [...blocked],
  };
}

function validateDiversionLedger(actual, expected) {
  const errors = [];
  if (r2(actual.total_diverted) !== r2(expected.total_diverted))
    errors.push(`total_diverted: expected ${expected.total_diverted}, got ${actual.total_diverted}`);
  if (r2(actual.total_distributed) !== r2(expected.total_distributed))
    errors.push(`total_distributed: expected ${expected.total_distributed}, got ${actual.total_distributed}`);
  if (actual.entries.length !== expected.entry_count)
    errors.push(`entry count: expected ${expected.entry_count}, got ${actual.entries.length}`);
  (expected.entry_checks || []).forEach((exp, i) => {
    const act = actual.entries[i];
    if (!act) { errors.push(`entry[${i}] missing`); return; }
    if (act.step_id         !== exp.step_id)         errors.push(`entry[${i}].step_id: expected ${exp.step_id}, got ${act.step_id}`);
    if (act.triggering_test !== exp.triggering_test) errors.push(`entry[${i}].triggering_test: expected ${exp.triggering_test}, got ${act.triggering_test}`);
    if (r2(act.diversion_amount) !== r2(exp.diversion_amount)) errors.push(`entry[${i}].diversion_amount: expected ${exp.diversion_amount}, got ${act.diversion_amount}`);
    if (r2(act.proceeds_before)  !== r2(exp.proceeds_before))  errors.push(`entry[${i}].proceeds_before: expected ${exp.proceeds_before}, got ${act.proceeds_before}`);
  });
  const expBlocked = new Set(expected.blocked_steps || []);
  const actBlocked = new Set(actual.blocked_steps   || []);
  for (const s of expBlocked) { if (!actBlocked.has(s)) errors.push(`blocked_steps: missing "${s}"`); }
  for (const s of actBlocked) { if (!expBlocked.has(s)) errors.push(`blocked_steps: unexpected "${s}"`); }
  return { passed: errors.length === 0, errors };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CAPITAL = {
  class_a_interest_due:       4.50,
  class_b_interest_due:       1.80,
  class_c_interest_due:       1.60,
  trustee_fee:                0.25,
  senior_management_fee:      0.25,
  hedge_payments:             0.00,
  subordinate_management_fee: 0.20,
};

const STEPS = [
  { step_id: 'STEP_01_TRUSTEE_FEE',      step_number: 1, step_type: 'FEE',
    label: 'Trustee fees and expenses', indenture_section: 'Section 13.1, Step 1',
    amount_basis: 'FIXED' },
  { step_id: 'STEP_02_SR_MGMT_FEE',      step_number: 2, step_type: 'FEE',
    label: 'Senior Management Fee', indenture_section: 'Section 13.1, Step 2',
    amount_basis: 'FIXED' },
  { step_id: 'STEP_03_HEDGE',            step_number: 3, step_type: 'FEE',
    label: 'Hedge payments', indenture_section: 'Section 13.1, Step 3',
    amount_basis: 'FIXED' },
  { step_id: 'STEP_04_CLASS_A_INTEREST', step_number: 4, step_type: 'INTEREST_PAYMENT',
    label: 'Class A Notes interest', indenture_section: 'Section 13.1, Step 4',
    note_class: 'CLASS_A', amount_basis: 'ACCRUED_INTEREST' },
  { step_id: 'STEP_05_IC_CHECK',         step_number: 5, step_type: 'COVERAGE_TEST_CHECK',
    label: 'IC check — divert if IC fails', indenture_section: 'Section 11.2(a)',
    condition: { test_type: 'IC', note_classes_tested: ['CLASS_A','CLASS_B'], operator: 'ALL_PASS' },
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: [], description: 'All remaining to principal reinvestment' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_06_OC_AB_CHECK',      step_number: 6, step_type: 'COVERAGE_TEST_CHECK',
    label: 'Class B interest — if OC_AB passes', indenture_section: 'Section 13.1, Step 5',
    note_class: 'CLASS_B', amount_basis: 'ACCRUED_INTEREST',
    condition: { test_type: 'OC', note_classes_tested: ['CLASS_A','CLASS_B'], operator: 'ALL_PASS' },
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: ['CLASS_B','CLASS_C'], description: 'Redirect to principal reinvestment' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_07_OC_C_CHECK',       step_number: 7, step_type: 'COVERAGE_TEST_CHECK',
    label: 'Class C interest — if OC_C passes', indenture_section: 'Section 13.1, Step 6',
    note_class: 'CLASS_C', amount_basis: 'ACCRUED_INTEREST',
    condition: { test_type: 'OC', note_classes_tested: ['CLASS_A','CLASS_B','CLASS_C'], operator: 'ALL_PASS' },
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: ['CLASS_C'], description: 'Redirect to principal reinvestment' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_08_SUB_MGMT_FEE',    step_number: 8, step_type: 'FEE',
    label: 'Subordinate Management Fee', indenture_section: 'Section 13.1, Step 7',
    amount_basis: 'FIXED' },
  { step_id: 'STEP_09_REINVESTMENT',     step_number: 9, step_type: 'REINVESTMENT',
    label: 'Reinvestment/cure', indenture_section: 'Section 13.1, Step 8',
    cure_mechanism: 'REINVESTMENT' },
];

const SCENARIOS = [
  {
    id: 'SYN_4A_01', description: 'All OC/IC tests pass — no diversion, full interest distributed',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: STEPS, capital_structure: CAPITAL,
      available_interest_proceeds: 13.30,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ],
    },
    expected: { total_interest_proceeds: 13.30, total_diverted: 0, total_distributed: 8.60, entry_count: 0, entry_checks: [], blocked_steps: [] },
  },
  {
    id: 'SYN_4A_02', description: 'Class A/B OC test fails — diversion fires, junior classes blocked',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: STEPS, capital_structure: CAPITAL,
      available_interest_proceeds: 13.30,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 114.58, threshold_pct: 123.50, result: 'FAIL' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct:  98.21, threshold_pct: 112.75, result: 'FAIL' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ],
    },
    expected: { total_interest_proceeds: 13.30, total_diverted: 8.30, total_distributed: 5.00, entry_count: 1,
      entry_checks: [{ step_id: 'STEP_06_OC_AB_CHECK', triggering_test: 'OC_CLASS_AB', diversion_amount: 8.30, proceeds_before: 8.30 }],
      blocked_steps: ['STEP_07_OC_C_CHECK','STEP_08_SUB_MGMT_FEE'] },
  },
  {
    id: 'SYN_4A_03', description: 'IC test fails — separate diversion path from OC',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: STEPS, capital_structure: CAPITAL,
      available_interest_proceeds: 7.50,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 114.50, threshold_pct: 120.00, result: 'FAIL' },
      ],
    },
    expected: { total_interest_proceeds: 7.50, total_diverted: 2.50, total_distributed: 5.00, entry_count: 1,
      entry_checks: [{ step_id: 'STEP_05_IC_CHECK', triggering_test: 'IC_CLASS_AB', diversion_amount: 2.50, proceeds_before: 2.50 }],
      blocked_steps: ['STEP_06_OC_AB_CHECK','STEP_07_OC_C_CHECK','STEP_08_SUB_MGMT_FEE'] },
  },
  {
    id: 'SYN_4A_04', description: 'Multiple tests fail simultaneously — diversion priority ordering',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: STEPS, capital_structure: CAPITAL,
      available_interest_proceeds: 6.00,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 104.17, threshold_pct: 123.50, result: 'FAIL' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct:  89.29, threshold_pct: 112.75, result: 'FAIL' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct:  91.60, threshold_pct: 120.00, result: 'FAIL' },
      ],
    },
    expected: { total_interest_proceeds: 6.00, total_diverted: 1.00, total_distributed: 5.00, entry_count: 1,
      entry_checks: [{ step_id: 'STEP_05_IC_CHECK', triggering_test: 'IC_CLASS_AB', diversion_amount: 1.00, proceeds_before: 1.00 }],
      blocked_steps: ['STEP_06_OC_AB_CHECK','STEP_07_OC_C_CHECK','STEP_08_SUB_MGMT_FEE'] },
  },
  {
    id: 'SYN_4A_05', description: 'Test is right at threshold (pass by 1bp) — no diversion fires',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: STEPS, capital_structure: CAPITAL,
      available_interest_proceeds: 13.30,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 131.55, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 112.76, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ],
    },
    expected: { total_interest_proceeds: 13.30, total_diverted: 0, total_distributed: 8.60, entry_count: 0, entry_checks: [], blocked_steps: [] },
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', amber: '\x1b[33m', grey: '\x1b[90m', cyan: '\x1b[36m',
};

console.log(`\n${C.cyan}${C.bold}Barlow Phase 4A — Diversion Engine Test Suite${C.reset}`);
console.log(`${C.grey}${'─'.repeat(60)}${C.reset}\n`);

let passed = 0;
let failed = 0;

for (const scenario of SCENARIOS) {
  const ledger = runWaterfallDiversion(scenario.input);
  const { passed: ok, errors } = validateDiversionLedger(ledger, scenario.expected);

  if (ok) {
    console.log(`  ${C.green}✓${C.reset}  ${C.bold}${scenario.id}${C.reset}  ${C.grey}${scenario.description}${C.reset}`);
    passed++;
  } else {
    console.log(`  ${C.red}✗${C.reset}  ${C.bold}${scenario.id}${C.reset}  ${scenario.description}`);
    errors.forEach(e => console.log(`      ${C.red}${e}${C.reset}`));
    failed++;
  }
}

console.log();
const total = passed + failed;
if (failed === 0) {
  console.log(`${C.green}${C.bold}  ✓  ${passed}/${total} scenarios passed — 4A completion gate met.${C.reset}`);
} else {
  console.log(`${C.red}${C.bold}  ✗  ${passed}/${total} passed — ${failed} failure(s). Fix before starting Phase 4B.${C.reset}`);
}
console.log();

process.exit(failed > 0 ? 1 : 0);
