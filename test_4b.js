#!/usr/bin/env node
// Phase 4B completion gate — runs the 3 full-waterfall allocation scenarios.
// No API key required. Validates runWaterfall output against expected ledger values.

// ── Engine ────────────────────────────────────────────────────────────────────

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
  if (condition.test_type === 'COMBINED') {
    const suffix = noteClassesToSuffix(condition.note_classes_tested || []);
    if (suffix) {
      for (const prefix of ['OC_CLASS_', 'IC_CLASS_']) {
        const id = `${prefix}${suffix}`;
        const r  = testIndex.get(id);
        if (r && r.result === 'FAIL') return { passed: false, failingTestId: id };
      }
    }
    return { passed: true, failingTestId: null };
  }
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

function resolveFeeAmount(step, nb) {
  const id = step.step_id.toUpperCase();
  const { fees } = nb;
  if (id.includes('TRUSTEE') || id.includes('ADMIN'))         return fees.trustee_and_admin;
  if (id.includes('SR_MGMT') || id.includes('SENIOR_MGMT'))  return fees.senior_management_fee;
  if (id.includes('SUB_MGMT') || id.includes('SUBORDINATE')) return fees.subordinate_management_fee;
  if (id.includes('HEDGE'))                                   return fees.hedge_termination ?? 0;
  return 0;
}

function resolveNoteBalance(noteClass, nb) {
  const map = { CLASS_A: 'class_a', CLASS_B: 'class_b', CLASS_C: 'class_c', CLASS_D: 'class_d', CLASS_E: 'class_e' };
  const key = map[noteClass];
  return key ? (nb[key] ?? null) : null;
}

function resolveInterestDue(step, nb) {
  if (!step.note_class) return 0;
  const bal = resolveNoteBalance(step.note_class, nb);
  if (!bal) return 0;
  return r2(bal.accrued_interest + (bal.deferred_interest ?? 0));
}

function inferAmountDue(step, nb) {
  if (step.step_type === 'FEE')                                                return resolveFeeAmount(step, nb);
  if (step.step_type === 'INTEREST_PAYMENT')                                   return resolveInterestDue(step, nb);
  if (step.step_type === 'COVERAGE_TEST_CHECK' && step.note_class)             return resolveInterestDue(step, nb);
  return 0;
}

function runWaterfall({ waterfall_steps, coverage_test_results, collections, note_balances }) {
  const testIndex  = new Map(coverage_test_results.map(r => [r.test_id, r]));
  const sorted     = [...waterfall_steps].sort((a, b) => a.step_number - b.step_number);

  // Hedge receipts are interest proceeds in CLO mechanics.
  let interest_bucket  = r2(collections.total_interest_proceeds + collections.hedge_receipts);
  let principal_bucket = r2(collections.total_principal_proceeds);
  let total_allocated  = 0;
  const entries    = [];
  const diversions = [];
  const blockedIds = new Set();

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];

    if (step.step_type === 'REINVESTMENT') continue;

    if (blockedIds.has(step.step_id)) {
      const due = inferAmountDue(step, note_balances);
      entries.push({
        step_id: step.step_id, step_number: step.step_number, step_type: step.step_type,
        beneficiary: step.beneficiary ?? '', note_class: step.note_class,
        payment_type: step.payment_type ?? 'INTEREST',
        amount_due: due, amount_paid: 0, shortfall: due,
        proceeds_bucket_before: 0, proceeds_bucket_after: 0,
        blocked: true, indenture_section: step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'FEE') {
      const due  = resolveFeeAmount(step, note_balances);
      const paid = r2(Math.min(due, interest_bucket));
      const bef  = interest_bucket;
      interest_bucket = r2(interest_bucket - paid);
      total_allocated = r2(total_allocated + paid);
      entries.push({
        step_id: step.step_id, step_number: step.step_number, step_type: 'FEE',
        beneficiary: step.beneficiary ?? '', payment_type: 'FEE',
        amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
        proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
        blocked: false, indenture_section: step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'INTEREST_PAYMENT') {
      const due  = resolveInterestDue(step, note_balances);
      const paid = r2(Math.min(due, interest_bucket));
      const bef  = interest_bucket;
      interest_bucket = r2(interest_bucket - paid);
      total_allocated = r2(total_allocated + paid);
      entries.push({
        step_id: step.step_id, step_number: step.step_number, step_type: 'INTEREST_PAYMENT',
        beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
        amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
        proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
        blocked: false, indenture_section: step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      const { passed, failingTestId } = evaluateCondition(step.condition, testIndex);

      if (passed) {
        if (step.note_class) {
          const due  = resolveInterestDue(step, note_balances);
          const paid = r2(Math.min(due, interest_bucket));
          const bef  = interest_bucket;
          interest_bucket = r2(interest_bucket - paid);
          total_allocated = r2(total_allocated + paid);
          entries.push({
            step_id: step.step_id, step_number: step.step_number, step_type: 'COVERAGE_TEST_CHECK',
            beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
            amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
            proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
            blocked: false, indenture_section: step.indenture_section,
          });
        }
        // Pure-check step (no note_class): no entry, no payment.
        continue;
      }

      // Diversion fires — transfer all remaining interest to principal bucket.
      const divAmount = interest_bucket;
      const bef       = interest_bucket;
      interest_bucket  = 0;
      principal_bucket = r2(principal_bucket + divAmount);

      diversions.push({
        step_id: step.step_id, step_number: step.step_number,
        triggering_test: failingTestId ?? (step.condition && step.condition.test_type) ?? 'UNKNOWN',
        test_result: 'FAIL', diversion_amount: r2(divAmount),
        diversion_target: step.diverts_to ?? { step_type: 'REINVESTMENT', note_class_priority: [], description: 'Principal reinvestment/cure' },
        cure_mechanism: step.cure_mechanism ?? 'REINVESTMENT',
        proceeds_before: r2(bef), proceeds_after: 0,
        indenture_section: step.indenture_section,
      });

      // AllocationEntry: shortfall view for the blocked beneficiary (if any).
      if (step.note_class) {
        const due = resolveInterestDue(step, note_balances);
        entries.push({
          step_id: step.step_id, step_number: step.step_number, step_type: 'COVERAGE_TEST_CHECK',
          beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
          amount_due: due, amount_paid: 0, shortfall: due,
          proceeds_bucket_before: bef, proceeds_bucket_after: 0,
          blocked: false, indenture_section: step.indenture_section,
        });
      }

      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].step_type !== 'REINVESTMENT') blockedIds.add(sorted[j].step_id);
      }
      continue;
    }

    if (step.step_type === 'PRINCIPAL_PAYMENT') {
      const due  = principal_bucket;
      const paid = r2(Math.min(due, principal_bucket));
      const bef  = principal_bucket;
      principal_bucket = r2(principal_bucket - paid);
      total_allocated  = r2(total_allocated + paid);
      entries.push({
        step_id: step.step_id, step_number: step.step_number, step_type: 'PRINCIPAL_PAYMENT',
        beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'PRINCIPAL',
        amount_due: due, amount_paid: paid, shortfall: 0,
        proceeds_bucket_before: bef, proceeds_bucket_after: principal_bucket,
        blocked: false, indenture_section: step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'RESERVE_ACCOUNT_FUNDING') {
      const due  = principal_bucket;
      const paid = r2(Math.min(due, principal_bucket));
      const bef  = principal_bucket;
      principal_bucket = r2(principal_bucket - paid);
      total_allocated  = r2(total_allocated + paid);
      entries.push({
        step_id: step.step_id, step_number: step.step_number, step_type: 'RESERVE_ACCOUNT_FUNDING',
        beneficiary: step.beneficiary ?? 'Reserve Account', payment_type: 'PRINCIPAL',
        amount_due: due, amount_paid: paid, shortfall: 0,
        proceeds_bucket_before: bef, proceeds_bucket_after: principal_bucket,
        blocked: false, indenture_section: step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'EQUITY_DISTRIBUTION') {
      const combined = r2(interest_bucket + principal_bucket);
      interest_bucket  = 0;
      principal_bucket = 0;
      total_allocated  = r2(total_allocated + combined);
      entries.push({
        step_id: step.step_id, step_number: step.step_number, step_type: 'EQUITY_DISTRIBUTION',
        beneficiary: step.beneficiary ?? 'Preferred Interest Holders', payment_type: 'EQUITY_DISTRIBUTION',
        amount_due: combined, amount_paid: combined, shortfall: 0,
        proceeds_bucket_before: combined, proceeds_bucket_after: 0,
        blocked: false, indenture_section: step.indenture_section,
      });
      continue;
    }
  }

  return {
    payment_date:       collections.payment_date,
    period_start:       collections.period_start,
    period_end:         collections.period_end,
    collections,
    total_allocated:    r2(total_allocated),
    residual_interest:  r2(interest_bucket),
    residual_principal: r2(principal_bucket),
    entries,
    diversions,
  };
}

// ── Validator ─────────────────────────────────────────────────────────────────

function validateLedger(actual, expected) {
  const errors = [];
  const check = (label, a, e) => { if (r2(a) !== r2(e)) errors.push(`${label}: expected ${e}, got ${a}`); };

  check('total_allocated',    actual.total_allocated,    expected.total_allocated);
  check('residual_interest',  actual.residual_interest,  expected.residual_interest);
  check('residual_principal', actual.residual_principal, expected.residual_principal);

  if (actual.entries.length !== expected.entry_count)
    errors.push(`entry_count: expected ${expected.entry_count}, got ${actual.entries.length}`);
  if (actual.diversions.length !== expected.diversion_count)
    errors.push(`diversion_count: expected ${expected.diversion_count}, got ${actual.diversions.length}`);

  for (const ec of (expected.entry_checks || [])) {
    const entry = actual.entries.find(e => e.step_id === ec.step_id);
    if (!entry) { errors.push(`entry ${ec.step_id}: not found`); continue; }
    check(`${ec.step_id}.amount_due`,  entry.amount_due,  ec.amount_due);
    check(`${ec.step_id}.amount_paid`, entry.amount_paid, ec.amount_paid);
    check(`${ec.step_id}.shortfall`,   entry.shortfall,   ec.shortfall);
    if (entry.blocked !== ec.blocked)
      errors.push(`${ec.step_id}.blocked: expected ${ec.blocked}, got ${entry.blocked}`);
  }

  for (const dc of (expected.diversion_checks || [])) {
    const div = actual.diversions.find(d => d.step_id === dc.step_id);
    if (!div) { errors.push(`diversion ${dc.step_id}: not found`); continue; }
    check(`${dc.step_id}.diversion_amount`, div.diversion_amount, dc.diversion_amount);
    if (div.triggering_test !== dc.triggering_test)
      errors.push(`${dc.step_id}.triggering_test: expected ${dc.triggering_test}, got ${div.triggering_test}`);
  }

  return { passed: errors.length === 0, errors };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOTE_BALANCES = {
  payment_date: '2025-01-15',
  class_a: { outstanding_balance: 180.00, accrued_interest: 4.50 },
  class_b: { outstanding_balance:  72.00, accrued_interest: 1.80 },
  class_c: { outstanding_balance:  64.00, accrued_interest: 1.60 },
  fees: { trustee_and_admin: 0.25, senior_management_fee: 0.25, subordinate_management_fee: 0.20 },
};

const COLLECTIONS_NORMAL = {
  payment_date: '2025-01-15', period_start: '2024-10-29', period_end: '2025-01-13',
  scheduled_interest: 11.50, unscheduled_interest: 0.50, default_interest_recovered: 0.00,
  total_interest_proceeds: 12.00,
  scheduled_principal: 2.00, unscheduled_principal: 2.50, default_principal_recovered: 0.50,
  total_principal_proceeds: 5.00,
  hedge_receipts: 0.00, reserve_account_balance: 1.50,
};

const COLLECTIONS_THIN = {
  payment_date: '2025-01-15', period_start: '2024-10-29', period_end: '2025-01-13',
  scheduled_interest: 5.80, unscheduled_interest: 0.00, default_interest_recovered: 0.00,
  total_interest_proceeds: 5.80,
  scheduled_principal: 0.50, unscheduled_principal: 0.50, default_principal_recovered: 0.00,
  total_principal_proceeds: 1.00,
  hedge_receipts: 0.00, reserve_account_balance: 0.20,
};

const STEPS = [
  { step_id: 'STEP_01_TRUSTEE_FEE',      step_number: 1, step_type: 'FEE',
    label: 'Trustee fees and expenses', indenture_section: 'Section 13.1, Step 1',
    beneficiary: 'Trustee', payment_type: 'FEE', amount_basis: 'FIXED' },
  { step_id: 'STEP_02_SR_MGMT_FEE',      step_number: 2, step_type: 'FEE',
    label: 'Senior Management Fee', indenture_section: 'Section 13.1, Step 2',
    beneficiary: 'Collateral Manager', payment_type: 'FEE', amount_basis: 'FIXED' },
  { step_id: 'STEP_03_HEDGE',            step_number: 3, step_type: 'FEE',
    label: 'Hedge payments', indenture_section: 'Section 13.1, Step 3',
    beneficiary: 'Hedge Counterparties', payment_type: 'FEE', amount_basis: 'FIXED' },
  { step_id: 'STEP_04_CLASS_A_INTEREST', step_number: 4, step_type: 'INTEREST_PAYMENT',
    label: 'Class A Notes interest', indenture_section: 'Section 13.1, Step 4',
    beneficiary: 'Class A Noteholders', payment_type: 'INTEREST',
    note_class: 'CLASS_A', amount_basis: 'ACCRUED_INTEREST' },
  { step_id: 'STEP_05_IC_CHECK',         step_number: 5, step_type: 'COVERAGE_TEST_CHECK',
    label: 'IC check — divert if IC fails', indenture_section: 'Section 11.2(a)',
    condition: { test_type: 'IC', note_classes_tested: ['CLASS_A','CLASS_B'], operator: 'ALL_PASS' },
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: [], description: 'All remaining to principal reinvestment' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_06_OC_AB_CHECK',      step_number: 6, step_type: 'COVERAGE_TEST_CHECK',
    label: 'Class B interest — if OC_AB passes', indenture_section: 'Section 13.1, Step 5',
    beneficiary: 'Class B Noteholders', payment_type: 'INTEREST',
    note_class: 'CLASS_B', amount_basis: 'ACCRUED_INTEREST',
    condition: { test_type: 'OC', note_classes_tested: ['CLASS_A','CLASS_B'], operator: 'ALL_PASS' },
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: ['CLASS_B','CLASS_C'], description: 'Redirect to principal reinvestment' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_07_OC_C_CHECK',       step_number: 7, step_type: 'COVERAGE_TEST_CHECK',
    label: 'Class C interest — if OC_C passes', indenture_section: 'Section 13.1, Step 6',
    beneficiary: 'Class C Noteholders', payment_type: 'INTEREST',
    note_class: 'CLASS_C', amount_basis: 'ACCRUED_INTEREST',
    condition: { test_type: 'OC', note_classes_tested: ['CLASS_A','CLASS_B','CLASS_C'], operator: 'ALL_PASS' },
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: ['CLASS_C'], description: 'Redirect to principal reinvestment' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_08_SUB_MGMT_FEE',    step_number: 8, step_type: 'FEE',
    label: 'Subordinate Management Fee', indenture_section: 'Section 13.1, Step 7',
    beneficiary: 'Collateral Manager', payment_type: 'FEE', amount_basis: 'FIXED' },
  { step_id: 'STEP_09_REINVESTMENT',     step_number: 9, step_type: 'REINVESTMENT',
    label: 'Reinvestment/cure', indenture_section: 'Section 13.1, Step 8',
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_10_EQUITY',           step_number: 10, step_type: 'EQUITY_DISTRIBUTION',
    label: 'Residual to Preferred Interest Holders', indenture_section: 'Section 13.1, Step 9',
    beneficiary: 'Preferred Interest Holders', payment_type: 'EQUITY_DISTRIBUTION' },
];

const TESTS_PASS = [
  { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
  { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
  { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
];

const SCENARIOS = [
  // ── SYN_4B_01 — All tests pass, full allocation ──────────────────────────
  // interest_bucket = 12.00, principal_bucket = 5.00.
  // Steps 1–8 fully funded; equity receives 3.40 (interest residual) + 5.00 (principal) = 8.40.
  {
    id:          'SYN_4B_01',
    description: 'All tests pass — full debt service funded, equity receives residual',
    input: { waterfall_steps: STEPS, note_balances: NOTE_BALANCES, collections: COLLECTIONS_NORMAL, coverage_test_results: TESTS_PASS },
    expected: {
      total_allocated: 17.00, residual_interest: 0, residual_principal: 0,
      entry_count: 8, diversion_count: 0,
      entry_checks: [
        { step_id: 'STEP_04_CLASS_A_INTEREST', amount_due: 4.50, amount_paid: 4.50, shortfall: 0,    blocked: false },
        { step_id: 'STEP_06_OC_AB_CHECK',      amount_due: 1.80, amount_paid: 1.80, shortfall: 0,    blocked: false },
        { step_id: 'STEP_07_OC_C_CHECK',       amount_due: 1.60, amount_paid: 1.60, shortfall: 0,    blocked: false },
        { step_id: 'STEP_10_EQUITY',           amount_due: 8.40, amount_paid: 8.40, shortfall: 0,    blocked: false },
      ],
    },
  },

  // ── SYN_4B_02 — OC breach ────────────────────────────────────────────────
  // Steps 1–4 pay fees + Class A (5.00). IC check passes. OC_AB fires at step 6.
  // Remaining 7.00 diverted to principal. Class B shortfall 1.80. Steps 7,8,10 blocked.
  // residual_principal = 5.00 (collected) + 7.00 (diverted) = 12.00 (reinvestment proceeds).
  {
    id:          'SYN_4B_02',
    description: 'OC breach — Class B diverted, junior blocked, principal bucket grows to 12.00',
    input: {
      waterfall_steps: STEPS, note_balances: NOTE_BALANCES, collections: COLLECTIONS_NORMAL,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 114.58, threshold_pct: 123.50, result: 'FAIL' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct:  98.21, threshold_pct: 112.75, result: 'FAIL' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ],
    },
    expected: {
      total_allocated: 5.00, residual_interest: 0, residual_principal: 12.00,
      entry_count: 8, diversion_count: 1,
      diversion_checks: [
        { step_id: 'STEP_06_OC_AB_CHECK', diversion_amount: 7.00, triggering_test: 'OC_CLASS_AB' },
      ],
      entry_checks: [
        { step_id: 'STEP_06_OC_AB_CHECK',  amount_due: 1.80, amount_paid: 0,    shortfall: 1.80, blocked: false },
        { step_id: 'STEP_07_OC_C_CHECK',   amount_due: 1.60, amount_paid: 0,    shortfall: 1.60, blocked: true  },
        { step_id: 'STEP_08_SUB_MGMT_FEE', amount_due: 0.20, amount_paid: 0,    shortfall: 0.20, blocked: true  },
        { step_id: 'STEP_10_EQUITY',        amount_due: 0,    amount_paid: 0,    shortfall: 0,    blocked: true  },
      ],
    },
  },

  // ── SYN_4B_03 — Thin collections ─────────────────────────────────────────
  // All tests pass. interest_bucket = 5.80, principal_bucket = 1.00.
  // Class A paid in full (5.00 consumed). 0.80 left → Class B partial (0.80/1.80, shortfall 1.00).
  // Class C: 0 paid (1.60 shortfall). Sub-mgmt: 0 paid. Equity sweeps residual principal 1.00.
  {
    id:          'SYN_4B_03',
    description: 'Thin collections — shortfall propagates through Class B, C, sub-mgmt; equity sweeps principal',
    input: {
      waterfall_steps: STEPS, note_balances: NOTE_BALANCES, collections: COLLECTIONS_THIN,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 114.50, threshold_pct: 120.00, result: 'PASS' },
      ],
    },
    expected: {
      total_allocated: 6.80, residual_interest: 0, residual_principal: 0,
      entry_count: 8, diversion_count: 0,
      entry_checks: [
        { step_id: 'STEP_04_CLASS_A_INTEREST', amount_due: 4.50, amount_paid: 4.50, shortfall: 0,    blocked: false },
        { step_id: 'STEP_06_OC_AB_CHECK',      amount_due: 1.80, amount_paid: 0.80, shortfall: 1.00, blocked: false },
        { step_id: 'STEP_07_OC_C_CHECK',       amount_due: 1.60, amount_paid: 0.00, shortfall: 1.60, blocked: false },
        { step_id: 'STEP_08_SUB_MGMT_FEE',     amount_due: 0.20, amount_paid: 0.00, shortfall: 0.20, blocked: false },
        { step_id: 'STEP_10_EQUITY',           amount_due: 1.00, amount_paid: 1.00, shortfall: 0,    blocked: false },
      ],
    },
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', amber: '\x1b[33m', grey: '\x1b[90m', cyan: '\x1b[36m',
};

console.log(`\n${C.cyan}${C.bold}Barlow Phase 4B — Full Waterfall Allocation Test Suite${C.reset}`);
console.log(`${C.grey}${'─'.repeat(60)}${C.reset}\n`);

let passed = 0;
let failed = 0;

for (const scenario of SCENARIOS) {
  const ledger = runWaterfall(scenario.input);
  const { passed: ok, errors } = validateLedger(ledger, scenario.expected);

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
  console.log(`${C.green}${C.bold}  ✓  ${passed}/${total} scenarios passed — 4B full waterfall gate met.${C.reset}`);
} else {
  console.log(`${C.red}${C.bold}  ✗  ${passed}/${total} passed — ${failed} failure(s). Fix before proceeding.${C.reset}`);
}
console.log();

process.exit(failed > 0 ? 1 : 0);
