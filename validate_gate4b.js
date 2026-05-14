#!/usr/bin/env node
'use strict';

/**
 * Phase 4B Completion Gate — validates gates 4, 5, and 6.
 *
 * Gate 4: Carlyle CLO 2024-1 waterfall steps + Q1 collections → plausible ledger.
 * Gate 5: All-passing scenario → residual_interest === 0 AND residual_principal === 0.
 * Gate 6: Write waterfall_allocation_ledger.json, read back, verify valid structure.
 *
 * No API key required. Exits 0 on full pass, 1 on any failure.
 */

const fs   = require('fs');
const path = require('path');

// ── Engine helpers ────────────────────────────────────────────────────────────

function r2(n) { return Math.round(n * 100) / 100; }

function noteClassesToSuffix(noteClasses) {
  const order   = { A: 1, B: 2, C: 3, D: 4, E: 5 };
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

function resolveFeeAmount4B(step, nb) {
  const id = step.step_id.toUpperCase();
  const { fees } = nb;
  if (id.includes('TRUSTEE') || id.includes('ADMIN'))         return fees.trustee_and_admin;
  if (id.includes('SR_MGMT') || id.includes('SENIOR_MGMT'))  return fees.senior_management_fee;
  if (id.includes('SUB_MGMT') || id.includes('SUBORDINATE')) return fees.subordinate_management_fee;
  if (id.includes('HEDGE'))                                   return fees.hedge_termination ?? 0;
  return 0;
}

function resolveNoteBalance4B(noteClass, nb) {
  const map = { CLASS_A: 'class_a', CLASS_B: 'class_b', CLASS_C: 'class_c', CLASS_D: 'class_d', CLASS_E: 'class_e' };
  const key = map[noteClass];
  return key ? (nb[key] ?? null) : null;
}

function resolveInterestDue4B(step, nb) {
  if (!step.note_class) return 0;
  const bal = resolveNoteBalance4B(step.note_class, nb);
  if (!bal) return 0;
  return r2(bal.accrued_interest + (bal.deferred_interest ?? 0));
}

function inferAmountDue4B(step, nb) {
  if (step.step_type === 'FEE')                                    return resolveFeeAmount4B(step, nb);
  if (step.step_type === 'INTEREST_PAYMENT')                        return resolveInterestDue4B(step, nb);
  if (step.step_type === 'COVERAGE_TEST_CHECK' && step.note_class) return resolveInterestDue4B(step, nb);
  return 0;
}

function runWaterfall4B({ waterfall_steps, coverage_test_results, collections, note_balances }) {
  const testIndex = new Map(coverage_test_results.map(r => [r.test_id, r]));
  const sorted    = [...waterfall_steps].sort((a, b) => a.step_number - b.step_number);

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
      const due = inferAmountDue4B(step, note_balances);
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
      const due = resolveFeeAmount4B(step, note_balances);
      const paid = r2(Math.min(due, interest_bucket));
      const bef = interest_bucket;
      interest_bucket = r2(interest_bucket - paid);
      total_allocated = r2(total_allocated + paid);
      entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'FEE',
        beneficiary: step.beneficiary ?? '', payment_type: 'FEE',
        amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
        proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
        blocked: false, indenture_section: step.indenture_section });
      continue;
    }

    if (step.step_type === 'INTEREST_PAYMENT') {
      const due = resolveInterestDue4B(step, note_balances);
      const paid = r2(Math.min(due, interest_bucket));
      const bef = interest_bucket;
      interest_bucket = r2(interest_bucket - paid);
      total_allocated = r2(total_allocated + paid);
      entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'INTEREST_PAYMENT',
        beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
        amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
        proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
        blocked: false, indenture_section: step.indenture_section });
      continue;
    }

    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      const { passed, failingTestId } = evaluateCondition(step.condition, testIndex);

      if (passed) {
        if (step.note_class) {
          const due = resolveInterestDue4B(step, note_balances);
          const paid = r2(Math.min(due, interest_bucket));
          const bef = interest_bucket;
          interest_bucket = r2(interest_bucket - paid);
          total_allocated = r2(total_allocated + paid);
          entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'COVERAGE_TEST_CHECK',
            beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
            amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
            proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
            blocked: false, indenture_section: step.indenture_section });
        }
        continue;
      }

      const divAmount = interest_bucket;
      const bef = interest_bucket;
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

      if (step.note_class) {
        const due = resolveInterestDue4B(step, note_balances);
        entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'COVERAGE_TEST_CHECK',
          beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
          amount_due: due, amount_paid: 0, shortfall: due,
          proceeds_bucket_before: bef, proceeds_bucket_after: 0,
          blocked: false, indenture_section: step.indenture_section });
      }

      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].step_type !== 'REINVESTMENT') blockedIds.add(sorted[j].step_id);
      }
      continue;
    }

    if (step.step_type === 'EQUITY_DISTRIBUTION') {
      const combined = r2(interest_bucket + principal_bucket);
      interest_bucket  = 0;
      principal_bucket = 0;
      total_allocated  = r2(total_allocated + combined);
      entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'EQUITY_DISTRIBUTION',
        beneficiary: step.beneficiary ?? 'Preferred Interest Holders', payment_type: 'EQUITY_DISTRIBUTION',
        amount_due: combined, amount_paid: combined, shortfall: 0,
        proceeds_bucket_before: combined, proceeds_bucket_after: 0,
        blocked: false, indenture_section: step.indenture_section });
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

// ── Carlyle CLO 2024-1 fixture data ──────────────────────────────────────────

// Derived from Carlyle Direct Lending CLO 2024-1 indenture Section 11.1.1.2.1
const CARLYLE_WATERFALL_STEPS = [
  {
    step_id:           'CARLYLE_S01_ADMIN',
    step_number:       1,
    step_type:         'FEE',
    label:             'Taxes, Government Charges, Admin & Trustee Fees',
    indenture_section: '11.1.1.2.1.1',
    beneficiary:       'Trustee / Administrator',
    payment_type:      'FEE',
  },
  {
    step_id:           'CARLYLE_S02_SR_MGMT_FEE',
    step_number:       2,
    step_type:         'FEE',
    label:             'Base Management Fee',
    indenture_section: '11.1.1.2.1.2',
    beneficiary:       'Collateral Manager',
    payment_type:      'FEE',
  },
  {
    step_id:           'CARLYLE_S03_CLASS_A_INT',
    step_number:       3,
    step_type:         'INTEREST_PAYMENT',
    label:             'Class A Notes — Accrued Interest',
    indenture_section: '11.1.1.2.1.3',
    beneficiary:       'Class A Noteholders',
    note_class:        'CLASS_A',
    payment_type:      'INTEREST',
    amount_basis:      'ACCRUED_INTEREST',
  },
  {
    step_id:           'CARLYLE_S04_CLASS_B_INT',
    step_number:       4,
    step_type:         'INTEREST_PAYMENT',
    label:             'Class B Notes — Accrued Interest',
    indenture_section: '11.1.1.2.1.4',
    beneficiary:       'Class B Noteholders',
    note_class:        'CLASS_B',
    payment_type:      'INTEREST',
    amount_basis:      'ACCRUED_INTEREST',
  },
  {
    // Pure COMBINED check — no note_class → no AllocationEntry win or lose.
    step_id:           'CARLYLE_S05_AB_COVERAGE',
    step_number:       5,
    step_type:         'COVERAGE_TEST_CHECK',
    label:             'Class A/B Coverage Tests (OC & IC)',
    indenture_section: '11.1.1.2.1.6',
    beneficiary:       'Class A/B Noteholders (cure)',
    condition: {
      test_type:           'COMBINED',
      note_classes_tested: ['CLASS_A', 'CLASS_B'],
      operator:            'ALL_PASS',
    },
    cure_mechanism: 'REINVESTMENT',
  },
  {
    step_id:           'CARLYLE_S06_CLASS_C_INT',
    step_number:       6,
    step_type:         'INTEREST_PAYMENT',
    label:             'Class C Notes — Accrued Interest',
    indenture_section: '11.1.1.2.1.7',
    beneficiary:       'Class C Noteholders',
    note_class:        'CLASS_C',
    payment_type:      'INTEREST',
    amount_basis:      'ACCRUED_INTEREST',
  },
  {
    step_id:           'CARLYLE_S07_C_COVERAGE',
    step_number:       7,
    step_type:         'COVERAGE_TEST_CHECK',
    label:             'Class C Coverage Tests (OC & IC)',
    indenture_section: '11.1.1.2.1.8',
    beneficiary:       'Class A/B/C Noteholders (cure)',
    condition: {
      test_type:           'COMBINED',
      note_classes_tested: ['CLASS_A', 'CLASS_B', 'CLASS_C'],
      operator:            'ALL_PASS',
    },
    cure_mechanism: 'REINVESTMENT',
  },
  {
    step_id:           'CARLYLE_S08_CLASS_D_INT',
    step_number:       8,
    step_type:         'INTEREST_PAYMENT',
    label:             'Class D Notes — Accrued Interest',
    indenture_section: '11.1.1.2.1.10',
    beneficiary:       'Class D Noteholders',
    note_class:        'CLASS_D',
    payment_type:      'INTEREST',
    amount_basis:      'ACCRUED_INTEREST',
  },
  {
    step_id:           'CARLYLE_S09_D_COVERAGE',
    step_number:       9,
    step_type:         'COVERAGE_TEST_CHECK',
    label:             'Class D Coverage Tests (OC & IC)',
    indenture_section: '11.1.1.2.1.11',
    beneficiary:       'Class A/B/C/D Noteholders (cure)',
    condition: {
      test_type:           'COMBINED',
      note_classes_tested: ['CLASS_A', 'CLASS_B', 'CLASS_C', 'CLASS_D'],
      operator:            'ALL_PASS',
    },
    cure_mechanism: 'REINVESTMENT',
  },
  {
    step_id:           'CARLYLE_S10_SUB_MGMT',
    step_number:       10,
    step_type:         'FEE',
    label:             'Subordinated Management Fee',
    indenture_section: '11.1.1.2.1.12',
    beneficiary:       'Collateral Manager',
    payment_type:      'FEE',
  },
  {
    step_id:           'CARLYLE_S11_REINVESTMENT',
    step_number:       11,
    step_type:         'REINVESTMENT',
    label:             'Principal Reinvestment / Cure Pool',
    indenture_section: '11.1.1.2.1.13',
  },
  {
    step_id:           'CARLYLE_S12_EQUITY',
    step_number:       12,
    step_type:         'EQUITY_DISTRIBUTION',
    label:             'Residual to Preferred Interest Holders',
    indenture_section: '11.1.1.2.1.14',
    beneficiary:       'Preferred Interest Holders',
    payment_type:      'EQUITY_DISTRIBUTION',
  },
];

// Synthetic Q1 2025 note balances — ~$480M CLO portfolio, 78-day period, SOFR 5.30%.
// Class A $298M @ 7.15%, Class B $24M @ 8.1%, Class C $19M @ 8.6%, Class D $14M @ 9.3%.
const CARLYLE_NOTE_BALANCES = {
  payment_date: '2025-01-15',
  class_a: { outstanding_balance: 298.00, accrued_interest: 4.61 },
  class_b: { outstanding_balance:  24.00, accrued_interest: 0.42 },
  class_c: { outstanding_balance:  19.00, accrued_interest: 0.35 },
  class_d: { outstanding_balance:  14.00, accrued_interest: 0.28 },
  fees: {
    trustee_and_admin:          0.10,
    senior_management_fee:      0.16,
    subordinate_management_fee: 0.16,
  },
};

// Q1 collections loaded from the synthetic fixture file.
const collectionsPath = path.resolve(
  __dirname,
  'barlow-app/src/fixtures/synthetic_collections/CARLYLE_2024_1_Q1.json',
);
const CARLYLE_COLLECTIONS = JSON.parse(fs.readFileSync(collectionsPath, 'utf8'));

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label, actual, expected, opts = {}) {
  const { tol = 0.005 } = opts;
  const ok = (expected === undefined || expected === null || typeof expected === 'boolean' || typeof expected === 'string')
    ? actual === expected
    : Math.abs(actual - expected) <= tol;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.log(`  ✗  ${label}  (expected ${expected}, got ${actual})`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(title);
  console.log('─'.repeat(60));
}

// ── All-passing coverage test results ────────────────────────────────────────

const ALL_PASS_TESTS = [
  { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 128.40, threshold_pct: 123.50, result: 'PASS' },
  { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 195.20, threshold_pct: 120.00, result: 'PASS' },
  { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 115.80, threshold_pct: 112.75, result: 'PASS' },
  { test_id: 'IC_CLASS_C',  test_type: 'interest_coverage',     calculated_pct: 182.30, threshold_pct: 105.00, result: 'PASS' },
  { test_id: 'OC_CLASS_D',  test_type: 'overcollateralization', calculated_pct: 106.10, threshold_pct: 104.00, result: 'PASS' },
  { test_id: 'IC_CLASS_D',  test_type: 'interest_coverage',     calculated_pct: 158.00, threshold_pct: 101.00, result: 'PASS' },
];

// ── GATE 4 + GATE 5 — All-passing scenario ───────────────────────────────────

section('GATE 4 + 5 — Carlyle Q1 all-tests-passing (plausibility + zero residuals)');

const allPassLedger = runWaterfall4B({
  waterfall_steps:       CARLYLE_WATERFALL_STEPS,
  coverage_test_results: ALL_PASS_TESTS,
  collections:           CARLYLE_COLLECTIONS,
  note_balances:         CARLYLE_NOTE_BALANCES,
});

// interest_bucket start = 8.78 + 0.14 hedge = 8.92
// fees: 0.10 + 0.16 = 0.26
// class A: 4.61, class B: 0.42, class C: 0.35, class D: 0.28
// sub mgmt: 0.16
// equity residual: (8.92 - 0.26 - 4.61 - 0.42 - 0.35 - 0.28 - 0.16) + 5.63 = 2.84 + 5.63 = 8.47
// total_allocated = 0.26 + 4.61 + 0.42 + 0.35 + 0.28 + 0.16 + 8.47 = 14.55

check('total_allocated = 14.55',      allPassLedger.total_allocated,    14.55);
check('residual_interest = 0 [gate5]',allPassLedger.residual_interest,  0);
check('residual_principal = 0 [gate5]',allPassLedger.residual_principal, 0);
check('entry_count = 8',              allPassLedger.entries.length,      8);
check('diversion_count = 0',          allPassLedger.diversions.length,   0);

// Spot-check specific entries
const e = (id) => allPassLedger.entries.find(x => x.step_id === id);

check('S01 trustee fee paid = 0.10',       e('CARLYLE_S01_ADMIN').amount_paid,       0.10);
check('S02 base mgmt paid = 0.16',         e('CARLYLE_S02_SR_MGMT_FEE').amount_paid, 0.16);
check('S03 class A interest paid = 4.61',  e('CARLYLE_S03_CLASS_A_INT').amount_paid, 4.61);
check('S04 class B interest paid = 0.42',  e('CARLYLE_S04_CLASS_B_INT').amount_paid, 0.42);
check('S06 class C interest paid = 0.35',  e('CARLYLE_S06_CLASS_C_INT').amount_paid, 0.35);
check('S08 class D interest paid = 0.28',  e('CARLYLE_S08_CLASS_D_INT').amount_paid, 0.28);
check('S10 sub mgmt paid = 0.16',          e('CARLYLE_S10_SUB_MGMT').amount_paid,    0.16);
check('S12 equity paid = 8.47',            e('CARLYLE_S12_EQUITY').amount_paid,      8.47);

// Plausibility: total_allocated must equal total proceeds (interest + hedge + principal).
const totalProceeds = r2(
  CARLYLE_COLLECTIONS.total_interest_proceeds
  + CARLYLE_COLLECTIONS.hedge_receipts
  + CARLYLE_COLLECTIONS.total_principal_proceeds,
);
check('total_allocated ≡ total proceeds (all sweep to equity)', allPassLedger.total_allocated, totalProceeds);

// Plausibility: pure check steps must not appear as entries.
check('S05 produces no entry (pure check)', allPassLedger.entries.find(x => x.step_id === 'CARLYLE_S05_AB_COVERAGE'), undefined, { tol: -1 });
check('S07 produces no entry (pure check)', allPassLedger.entries.find(x => x.step_id === 'CARLYLE_S07_C_COVERAGE'),  undefined, { tol: -1 });
check('S09 produces no entry (pure check)', allPassLedger.entries.find(x => x.step_id === 'CARLYLE_S09_D_COVERAGE'),  undefined, { tol: -1 });

// ── GATE 4 — OC breach at Class A/B ──────────────────────────────────────────

section('GATE 4 — A/B OC breach: interest diverted, junior blocked, principal redirected');

const OC_AB_BREACH_TESTS = [
  { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 114.20, threshold_pct: 123.50, result: 'FAIL' },
  { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 195.20, threshold_pct: 120.00, result: 'PASS' },
  { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 103.10, threshold_pct: 112.75, result: 'FAIL' },
  { test_id: 'IC_CLASS_C',  test_type: 'interest_coverage',     calculated_pct: 182.30, threshold_pct: 105.00, result: 'PASS' },
  { test_id: 'OC_CLASS_D',  test_type: 'overcollateralization', calculated_pct:  96.40, threshold_pct: 104.00, result: 'FAIL' },
  { test_id: 'IC_CLASS_D',  test_type: 'interest_coverage',     calculated_pct: 158.00, threshold_pct: 101.00, result: 'PASS' },
];

const breachLedger = runWaterfall4B({
  waterfall_steps:       CARLYLE_WATERFALL_STEPS,
  coverage_test_results: OC_AB_BREACH_TESTS,
  collections:           CARLYLE_COLLECTIONS,
  note_balances:         CARLYLE_NOTE_BALANCES,
});

// After fees (0.26) and Class A/B interest (5.03), remaining interest = 8.92 - 5.03 - 0.26 = 3.63.
// S05 COMBINED fires (OC_CLASS_AB FAIL) — diverts 3.63 to principal_bucket.
// principal_bucket = 5.63 + 3.63 = 9.26. All downstream blocked.

check('total_allocated = 5.29',                    breachLedger.total_allocated,    5.29);
check('residual_interest = 0',                     breachLedger.residual_interest,  0);
check('residual_principal = 9.26 (reinvestment)',  breachLedger.residual_principal, 9.26);
check('entry_count = 10',                          breachLedger.entries.length,     10);
check('diversion_count = 1',                       breachLedger.diversions.length,  1);

const div = breachLedger.diversions[0];
check('diversion at S05',                          div.step_id,          'CARLYLE_S05_AB_COVERAGE', { tol: -1 });
check('diversion_amount = 3.63',                   div.diversion_amount, 3.63);
check('triggering_test = OC_CLASS_AB',             div.triggering_test,  'OC_CLASS_AB', { tol: -1 });

const eb = (id) => breachLedger.entries.find(x => x.step_id === id);

check('S03 class A fully paid in breach',           eb('CARLYLE_S03_CLASS_A_INT').amount_paid, 4.61);
check('S06 class C blocked',                        eb('CARLYLE_S06_CLASS_C_INT').blocked,      true,  { tol: -1 });
check('S06 class C shortfall = 0.35',               eb('CARLYLE_S06_CLASS_C_INT').shortfall,    0.35);
check('S08 class D blocked',                        eb('CARLYLE_S08_CLASS_D_INT').blocked,      true,  { tol: -1 });
check('S10 sub mgmt blocked',                       eb('CARLYLE_S10_SUB_MGMT').blocked,         true,  { tol: -1 });
check('S12 equity blocked',                         eb('CARLYLE_S12_EQUITY').blocked,           true,  { tol: -1 });
check('S12 equity amount_paid = 0 when blocked',    eb('CARLYLE_S12_EQUITY').amount_paid,       0);
check('S05 produces no entry (pure check, breach)', breachLedger.entries.find(x => x.step_id === 'CARLYLE_S05_AB_COVERAGE'), undefined, { tol: -1 });

// ── GATE 6 — JSON write + read-back ──────────────────────────────────────────

section('GATE 6 — Write waterfall_allocation_ledger.json and verify structure');

const outputPath = path.resolve(__dirname, 'waterfall_allocation_ledger.json');

const jsonPayload = {
  generated_at:               new Date().toISOString(),
  deal:                       'Carlyle Direct Lending CLO 2024-1, LLC',
  waterfall_allocation_ledger: allPassLedger,
};

fs.writeFileSync(outputPath, JSON.stringify(jsonPayload, null, 2), 'utf8');
console.log(`  → wrote ${outputPath}`);

const readBack  = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
const ledger    = readBack.waterfall_allocation_ledger;

function checkField(label, val) {
  const ok = val !== undefined && val !== null;
  if (ok) { console.log(`  ✓  ${label}`); passed++; }
  else    { console.log(`  ✗  ${label}  (field missing or null)`); failed++; }
}

checkField('root.generated_at present',                  readBack.generated_at);
checkField('root.deal present',                          readBack.deal);
checkField('ledger.payment_date present',                ledger.payment_date);
checkField('ledger.total_allocated present',             ledger.total_allocated);
checkField('ledger.residual_interest present',           ledger.residual_interest !== undefined ? true : null);
checkField('ledger.residual_principal present',          ledger.residual_principal !== undefined ? true : null);
checkField('ledger.entries is non-empty array',          Array.isArray(ledger.entries) && ledger.entries.length > 0 ? true : null);
checkField('ledger.diversions is array',                 Array.isArray(ledger.diversions) ? true : null);
checkField('ledger.collections.total_interest_proceeds', ledger.collections && ledger.collections.total_interest_proceeds !== undefined ? true : null);

// Verify numeric round-trip integrity.
check('JSON round-trip total_allocated = 14.55', ledger.total_allocated, 14.55);
check('JSON round-trip entries[0].step_id',
  ledger.entries[0].step_id, 'CARLYLE_S01_ADMIN', { tol: -1 });

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`Phase 4B Gates 4/5/6 — ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));

if (failed > 0) {
  console.log('\n✗  One or more gate checks failed. See output above.');
  process.exit(1);
} else {
  console.log('\n✓  All gates pass. Phase 4B complete.\n');
  process.exit(0);
}
