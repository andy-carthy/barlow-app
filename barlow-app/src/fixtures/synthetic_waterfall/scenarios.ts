import type { WaterfallStep, DiversionLedger } from '../../types/waterfall';
import type { CoverageTestResult, WaterfallCapitalStructure } from '../../engines/waterfall_diversion_engine';

// ── Shared fixture capital structure ─────────────────────────────────────────
// Extends the Phase 3 CAPITAL_STRUCTURE with fee amounts needed by the waterfall engine.

export const FIXTURE_CAPITAL_STRUCTURE: WaterfallCapitalStructure = {
  class_a_interest_due:        4.50,
  class_b_interest_due:        1.80,
  class_c_interest_due:        1.60,
  trustee_fee:                 0.25,
  senior_management_fee:       0.25,
  hedge_payments:              0.00,
  subordinate_management_fee:  0.20,
};

// ── Shared fixture waterfall steps ───────────────────────────────────────────
// Maps to the synthetic indenture waterfall (Section 13.1) with an IC check
// step added between Class A interest and the OC checks, reflecting the IC
// failure action in Section 11.2(a).

export const FIXTURE_WATERFALL_STEPS: WaterfallStep[] = [
  {
    step_id:           'STEP_01_TRUSTEE_FEE',
    step_number:       1,
    step_type:         'FEE',
    label:             'Trustee fees and expenses (Senior Expenses)',
    indenture_section: 'Section 13.1, Step 1',
    beneficiary:       'Trustee',
    payment_type:      'FEE',
    amount_basis:      'FIXED',
  },
  {
    step_id:           'STEP_02_SR_MGMT_FEE',
    step_number:       2,
    step_type:         'FEE',
    label:             'Senior Management Fee',
    indenture_section: 'Section 13.1, Step 2',
    beneficiary:       'Collateral Manager',
    payment_type:      'FEE',
    amount_basis:      'FIXED',
  },
  {
    step_id:           'STEP_03_HEDGE',
    step_number:       3,
    step_type:         'FEE',
    label:             'Hedge Counterparty payments',
    indenture_section: 'Section 13.1, Step 3',
    beneficiary:       'Hedge Counterparties',
    payment_type:      'FEE',
    amount_basis:      'FIXED',
  },
  {
    step_id:           'STEP_04_CLASS_A_INTEREST',
    step_number:       4,
    step_type:         'INTEREST_PAYMENT',
    label:             'Accrued and unpaid interest on the Class A Notes',
    indenture_section: 'Section 13.1, Step 4',
    beneficiary:       'Class A Noteholders',
    payment_type:      'INTEREST',
    note_class:        'CLASS_A',
    amount_basis:      'ACCRUED_INTEREST',
  },
  {
    // IC check fires before OC checks. IC failure diverts ALL remaining proceeds.
    // The synthetic indenture doesn't number this step explicitly — derived from
    // Section 11.2(a) failure action "redirect Interest Proceeds per Section 13.1(b)".
    step_id:           'STEP_05_IC_CHECK',
    step_number:       5,
    step_type:         'COVERAGE_TEST_CHECK',
    label:             'Class A/B Interest Coverage Test — divert if IC fails',
    indenture_section: 'Section 11.2(a)',
    condition: {
      test_type:           'IC',
      note_classes_tested: ['CLASS_A', 'CLASS_B'],
      operator:            'ALL_PASS',
    },
    condition_raw:  'Interest Proceeds diverted per Section 13.1(b) if IC test fails',
    diverts_to: {
      step_type:           'REINVESTMENT',
      note_class_priority: [],
      description:         'Redirect all remaining interest proceeds to principal reinvestment account',
    },
    cure_mechanism: 'REINVESTMENT',
  },
  {
    step_id:           'STEP_06_OC_AB_CHECK',
    step_number:       6,
    step_type:         'COVERAGE_TEST_CHECK',
    label:             'Class B Notes interest — provided Class A/B OC Test is satisfied',
    indenture_section: 'Section 13.1, Step 5',
    beneficiary:       'Class B Noteholders',
    payment_type:      'INTEREST',
    note_class:        'CLASS_B',
    amount_basis:      'ACCRUED_INTEREST',
    condition: {
      test_type:           'OC',
      note_classes_tested: ['CLASS_A', 'CLASS_B'],
      operator:            'ALL_PASS',
    },
    condition_raw:  'Provided Class A/B OC Test is satisfied; otherwise redirect to Step 8',
    diverts_to: {
      step_type:           'REINVESTMENT',
      note_class_priority: ['CLASS_B', 'CLASS_C'],
      description:         'Redirect to principal reinvestment account or pro rata paydown',
    },
    cure_mechanism: 'REINVESTMENT',
  },
  {
    step_id:           'STEP_07_OC_C_CHECK',
    step_number:       7,
    step_type:         'COVERAGE_TEST_CHECK',
    label:             'Class C Notes interest — provided Class C OC Test is satisfied',
    indenture_section: 'Section 13.1, Step 6',
    beneficiary:       'Class C Noteholders',
    payment_type:      'INTEREST',
    note_class:        'CLASS_C',
    amount_basis:      'ACCRUED_INTEREST',
    condition: {
      test_type:           'OC',
      note_classes_tested: ['CLASS_A', 'CLASS_B', 'CLASS_C'],
      operator:            'ALL_PASS',
    },
    condition_raw:  'Provided Class C OC Test is satisfied; otherwise redirect to Step 8',
    diverts_to: {
      step_type:           'REINVESTMENT',
      note_class_priority: ['CLASS_C'],
      description:         'Redirect to principal reinvestment account or pro rata paydown',
    },
    cure_mechanism: 'REINVESTMENT',
  },
  {
    step_id:           'STEP_08_SUB_MGMT_FEE',
    step_number:       8,
    step_type:         'FEE',
    label:             'Subordinate Management Fee',
    indenture_section: 'Section 13.1, Step 7',
    beneficiary:       'Collateral Manager',
    payment_type:      'FEE',
    amount_basis:      'FIXED',
  },
  {
    // Target of all diversions. Not an execution step — the engine skips it
    // in the payment loop and posts diverted amounts here conceptually.
    step_id:           'STEP_09_REINVESTMENT',
    step_number:       9,
    step_type:         'REINVESTMENT',
    label:             'Reinvestment/cure — principal reinvestment account or pro rata paydown',
    indenture_section: 'Section 13.1, Step 8',
    cure_mechanism:    'REINVESTMENT',
  },
];

// ── Scenario type ─────────────────────────────────────────────────────────────

export interface WaterfallScenario {
  id:          string;
  description: string;
  input: {
    payment_date:                string;
    period_start:                string;
    period_end:                  string;
    waterfall_steps:             WaterfallStep[];
    coverage_test_results:       CoverageTestResult[];
    available_interest_proceeds: number;
    capital_structure:           WaterfallCapitalStructure;
  };
  expected: Pick<DiversionLedger,
    'total_interest_proceeds' | 'total_diverted' | 'total_distributed' | 'blocked_steps'
  > & {
    entry_count:     number;
    entry_checks:    Array<{
      step_id:          string;
      triggering_test:  string;
      diversion_amount: number;
      proceeds_before:  number;
    }>;
  };
}

// ── SYN_4A_01 — All tests pass ────────────────────────────────────────────────
// Pool par $360.5M → OC_AB 150.21% / OC_C 128.75%. Interest proceeds $13.30M → IC 203.05%.
// All steps execute, total_diverted = 0.

const SYN_4A_01: WaterfallScenario = {
  id:          'SYN_4A_01',
  description: 'All OC/IC tests pass — no diversion, full interest distributed',
  input: {
    payment_date: '2026-04-15',
    period_start: '2026-01-15',
    period_end:   '2026-04-14',
    waterfall_steps:       FIXTURE_WATERFALL_STEPS,
    capital_structure:     FIXTURE_CAPITAL_STRUCTURE,
    available_interest_proceeds: 13.30,
    coverage_test_results: [
      { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
      { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
      { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
    ],
  },
  expected: {
    total_interest_proceeds: 13.30,
    total_diverted:          0,
    // 0.25+0.25+0+4.50+1.80+1.60+0.20 = 8.60
    total_distributed:       8.60,
    entry_count:             0,
    entry_checks:            [],
    blocked_steps:           [],
  },
};

// ── SYN_4A_02 — OC_AB fails (IC passes) ──────────────────────────────────────
// Pool par $275M → OC_AB 114.58% FAIL / OC_C 98.21% FAIL. IC 203.05% PASS.
// Steps 1-4 execute ($5.00M). IC check passes (step 5). OC_AB check fires at step 6,
// diverts remaining $8.30M. Steps 7 and 8 blocked.

const SYN_4A_02: WaterfallScenario = {
  id:          'SYN_4A_02',
  description: 'Class A/B OC test fails — diversion fires, junior classes blocked',
  input: {
    payment_date: '2026-04-15',
    period_start: '2026-01-15',
    period_end:   '2026-04-14',
    waterfall_steps:       FIXTURE_WATERFALL_STEPS,
    capital_structure:     FIXTURE_CAPITAL_STRUCTURE,
    available_interest_proceeds: 13.30,
    coverage_test_results: [
      { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 114.58, threshold_pct: 123.50, result: 'FAIL' },
      { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 98.21,  threshold_pct: 112.75, result: 'FAIL' },
      { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
    ],
  },
  expected: {
    total_interest_proceeds: 13.30,
    total_diverted:          8.30,
    total_distributed:       5.00,
    entry_count:             1,
    entry_checks: [
      { step_id: 'STEP_06_OC_AB_CHECK', triggering_test: 'OC_CLASS_AB', diversion_amount: 8.30, proceeds_before: 8.30 },
    ],
    blocked_steps: ['STEP_07_OC_C_CHECK', 'STEP_08_SUB_MGMT_FEE'],
  },
};

// ── SYN_4A_03 — IC fails (OC passes) ─────────────────────────────────────────
// Pool par $360.5M, OC tests pass. Interest proceeds $7.50M → IC 114.50% FAIL.
// Steps 1-4 pay $5.00M. IC check fires at step 5, diverts remaining $2.50M.
// Steps 6, 7, 8 blocked — OC checks never execute.

const SYN_4A_03: WaterfallScenario = {
  id:          'SYN_4A_03',
  description: 'IC test fails — separate diversion path from OC',
  input: {
    payment_date: '2026-04-15',
    period_start: '2026-01-15',
    period_end:   '2026-04-14',
    waterfall_steps:       FIXTURE_WATERFALL_STEPS,
    capital_structure:     FIXTURE_CAPITAL_STRUCTURE,
    available_interest_proceeds: 7.50,
    coverage_test_results: [
      { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
      { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
      { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 114.50, threshold_pct: 120.00, result: 'FAIL' },
    ],
  },
  expected: {
    total_interest_proceeds: 7.50,
    total_diverted:          2.50,
    total_distributed:       5.00,
    entry_count:             1,
    entry_checks: [
      { step_id: 'STEP_05_IC_CHECK', triggering_test: 'IC_CLASS_AB', diversion_amount: 2.50, proceeds_before: 2.50 },
    ],
    blocked_steps: ['STEP_06_OC_AB_CHECK', 'STEP_07_OC_C_CHECK', 'STEP_08_SUB_MGMT_FEE'],
  },
};

// ── SYN_4A_04 — Multiple tests fail simultaneously ────────────────────────────
// Pool par $250M (OC fails), interest proceeds $6.00M (IC fails).
// IC check fires FIRST at step 5 — it has lower step_number than the OC checks.
// OC checks are blocked and never execute. Only one diversion entry recorded.
// This validates that waterfall priority ordering (step_number) determines which
// diversion fires when multiple tests fail.

const SYN_4A_04: WaterfallScenario = {
  id:          'SYN_4A_04',
  description: 'Multiple tests fail simultaneously — diversion priority ordering',
  input: {
    payment_date: '2026-04-15',
    period_start: '2026-01-15',
    period_end:   '2026-04-14',
    waterfall_steps:       FIXTURE_WATERFALL_STEPS,
    capital_structure:     FIXTURE_CAPITAL_STRUCTURE,
    available_interest_proceeds: 6.00,
    coverage_test_results: [
      { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 104.17, threshold_pct: 123.50, result: 'FAIL' },
      { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 89.29,  threshold_pct: 112.75, result: 'FAIL' },
      { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 91.60,  threshold_pct: 120.00, result: 'FAIL' },
    ],
  },
  expected: {
    total_interest_proceeds: 6.00,
    total_diverted:          1.00,   // Only IC diversion fires
    total_distributed:       5.00,
    entry_count:             1,      // Not 3 — OC checks are blocked by IC diversion
    entry_checks: [
      { step_id: 'STEP_05_IC_CHECK', triggering_test: 'IC_CLASS_AB', diversion_amount: 1.00, proceeds_before: 1.00 },
    ],
    blocked_steps: ['STEP_06_OC_AB_CHECK', 'STEP_07_OC_C_CHECK', 'STEP_08_SUB_MGMT_FEE'],
  },
};

// ── SYN_4A_05 — Right at threshold (pass by 1bp) ─────────────────────────────
// Pool par $315.73M → OC_C 112.76% (1bp above 112.75% threshold), PASS.
// OC_AB 131.55% PASS. IC 203.05% PASS.
// Validates that calculated_pct >= threshold_pct is PASS (not strictly >).
// All steps execute, no diversion.

const SYN_4A_05: WaterfallScenario = {
  id:          'SYN_4A_05',
  description: 'Test is right at threshold (pass by 1bp) — no diversion fires',
  input: {
    payment_date: '2026-04-15',
    period_start: '2026-01-15',
    period_end:   '2026-04-14',
    waterfall_steps:       FIXTURE_WATERFALL_STEPS,
    capital_structure:     FIXTURE_CAPITAL_STRUCTURE,
    available_interest_proceeds: 13.30,
    coverage_test_results: [
      { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 131.55, threshold_pct: 123.50, result: 'PASS' },
      { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 112.76, threshold_pct: 112.75, result: 'PASS' },
      { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
    ],
  },
  expected: {
    total_interest_proceeds: 13.30,
    total_diverted:          0,
    total_distributed:       8.60,
    entry_count:             0,
    entry_checks:            [],
    blocked_steps:           [],
  },
};

export const WATERFALL_SCENARIOS: WaterfallScenario[] = [
  SYN_4A_01,
  SYN_4A_02,
  SYN_4A_03,
  SYN_4A_04,
  SYN_4A_05,
];
