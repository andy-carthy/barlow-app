import type { WaterfallStep, NoteBalanceSnapshot, AllocationEntry } from '../../types/waterfall';
import type { PeriodCollections } from '../../types/collections';
import type { CoverageTestResult, WaterfallEngineInput } from '../../engines/waterfall_engine';
import { FIXTURE_WATERFALL_STEPS } from './scenarios';

// ── 4B-only waterfall steps ───────────────────────────────────────────────────
// Extends the 4A fixture with an EQUITY_DISTRIBUTION step at the end.

const STEP_10_EQUITY: WaterfallStep = {
  step_id:           'STEP_10_EQUITY',
  step_number:       10,
  step_type:         'EQUITY_DISTRIBUTION',
  label:             'Residual to Preferred Interest Holders',
  indenture_section: 'Section 13.1, Step 9',
  beneficiary:       'Preferred Interest Holders',
  payment_type:      'EQUITY_DISTRIBUTION',
};

export const FIXTURE_WATERFALL_STEPS_4B: WaterfallStep[] = [
  ...FIXTURE_WATERFALL_STEPS,
  STEP_10_EQUITY,
];

// ── Shared note balances ──────────────────────────────────────────────────────
// Consistent with the 4A capital structure; adds outstanding_balance per class
// and pre-computed accrued interest.

export const FIXTURE_NOTE_BALANCES: NoteBalanceSnapshot = {
  payment_date: '2025-01-15',
  class_a: { outstanding_balance: 180.00, accrued_interest: 4.50 },
  class_b: { outstanding_balance:  72.00, accrued_interest: 1.80 },
  class_c: { outstanding_balance:  64.00, accrued_interest: 1.60 },
  fees: {
    trustee_and_admin:          0.25,
    senior_management_fee:      0.25,
    subordinate_management_fee: 0.20,
  },
};

// ── Shared collections ────────────────────────────────────────────────────────

export const FIXTURE_COLLECTIONS_NORMAL: PeriodCollections = {
  payment_date: '2025-01-15',
  period_start: '2024-10-29',
  period_end:   '2025-01-13',
  scheduled_interest:         11.50,
  unscheduled_interest:        0.50,
  default_interest_recovered:  0.00,
  total_interest_proceeds:    12.00,
  scheduled_principal:         2.00,
  unscheduled_principal:       2.50,
  default_principal_recovered: 0.50,
  total_principal_proceeds:    5.00,
  hedge_receipts:         0.00,
  reserve_account_balance: 1.50,
};

export const FIXTURE_COLLECTIONS_THIN: PeriodCollections = {
  payment_date: '2025-01-15',
  period_start: '2024-10-29',
  period_end:   '2025-01-13',
  scheduled_interest:         5.80,
  unscheduled_interest:       0.00,
  default_interest_recovered: 0.00,
  total_interest_proceeds:    5.80,
  scheduled_principal:         0.50,
  unscheduled_principal:       0.50,
  default_principal_recovered: 0.00,
  total_principal_proceeds:    1.00,
  hedge_receipts:          0.00,
  reserve_account_balance: 0.20,
};

// ── Scenario type ─────────────────────────────────────────────────────────────

interface EntryCheck {
  step_id:      string;
  amount_due:   number;
  amount_paid:  number;
  shortfall:    number;
  blocked:      boolean;
}

interface DiversionCheck {
  step_id:          string;
  diversion_amount: number;
  triggering_test:  string;
}

export interface WaterfallScenario4B {
  id:          string;
  description: string;
  input:       WaterfallEngineInput;
  expected: {
    total_allocated:    number;
    residual_interest:  number;
    residual_principal: number;
    entry_count:        number;
    diversion_count:    number;
    entry_checks:       EntryCheck[];
    diversion_checks?:  DiversionCheck[];
  };
}

// ── SYN_4B_01 — All tests pass, full allocation ───────────────────────────────
// OC_AB 150.21% PASS, OC_C 128.75% PASS, IC 203.05% PASS.
// interest_bucket = 12.00, principal_bucket = 5.00.
// Steps 1–8 fully funded; equity receives residual 3.40 + 5.00 = 8.40.
// total_allocated = 8.60 (debt service) + 8.40 (equity) = 17.00.

const SYN_4B_01: WaterfallScenario4B = {
  id:          'SYN_4B_01',
  description: 'All tests pass — full debt service funded, equity receives residual',
  input: {
    waterfall_steps:       FIXTURE_WATERFALL_STEPS_4B,
    note_balances:         FIXTURE_NOTE_BALANCES,
    collections:           FIXTURE_COLLECTIONS_NORMAL,
    coverage_test_results: [
      { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
      { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
      { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
    ],
  },
  expected: {
    total_allocated:    17.00,
    residual_interest:  0,
    residual_principal: 0,
    entry_count:        8,  // steps 1,2,3,4,6,7,8,10 — step 5 (pure IC check, passes) + step 9 (REINVESTMENT) produce no entry
    diversion_count:    0,
    entry_checks: [
      { step_id: 'STEP_04_CLASS_A_INTEREST', amount_due: 4.50, amount_paid: 4.50, shortfall: 0,    blocked: false },
      { step_id: 'STEP_06_OC_AB_CHECK',      amount_due: 1.80, amount_paid: 1.80, shortfall: 0,    blocked: false },
      { step_id: 'STEP_07_OC_C_CHECK',       amount_due: 1.60, amount_paid: 1.60, shortfall: 0,    blocked: false },
      { step_id: 'STEP_10_EQUITY',           amount_due: 8.40, amount_paid: 8.40, shortfall: 0,    blocked: false },
    ],
  },
};

// ── SYN_4B_02 — OC breach ────────────────────────────────────────────────────
// OC_AB 114.58% FAIL, IC 203.05% PASS.
// Steps 1–4 pay fees + Class A (5.00). IC check passes (step 5, no payment).
// OC_AB fires at step 6 — diverts remaining 7.00 to principal bucket.
// Class B entry shows shortfall 1.80 (amount_paid=0, blocked=false: step ran but diverted).
// Steps 7, 8, 10 blocked. principal_bucket = 5.00 + 7.00 = 12.00 (reinvestment proceeds).

const SYN_4B_02: WaterfallScenario4B = {
  id:          'SYN_4B_02',
  description: 'OC breach — senior classes paid, Class B diverted, junior blocked, principal redirected',
  input: {
    waterfall_steps:       FIXTURE_WATERFALL_STEPS_4B,
    note_balances:         FIXTURE_NOTE_BALANCES,
    collections:           FIXTURE_COLLECTIONS_NORMAL,
    coverage_test_results: [
      { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 114.58, threshold_pct: 123.50, result: 'FAIL' },
      { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct:  98.21, threshold_pct: 112.75, result: 'FAIL' },
      { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
    ],
  },
  expected: {
    total_allocated:    5.00,   // fees + Class A only
    residual_interest:  0,
    residual_principal: 12.00,  // 5.00 collected + 7.00 diverted = reinvestment proceeds
    entry_count:        8,
    diversion_count:    1,
    diversion_checks: [
      { step_id: 'STEP_06_OC_AB_CHECK', diversion_amount: 7.00, triggering_test: 'OC_CLASS_AB' },
    ],
    entry_checks: [
      // Diversion step: shortfall view — Class B was supposed to receive 1.80, received 0.
      { step_id: 'STEP_06_OC_AB_CHECK', amount_due: 1.80, amount_paid: 0, shortfall: 1.80, blocked: false },
      { step_id: 'STEP_07_OC_C_CHECK',  amount_due: 1.60, amount_paid: 0, shortfall: 1.60, blocked: true  },
      { step_id: 'STEP_08_SUB_MGMT_FEE',amount_due: 0.20, amount_paid: 0, shortfall: 0.20, blocked: true  },
      { step_id: 'STEP_10_EQUITY',       amount_due: 0,    amount_paid: 0, shortfall: 0,    blocked: true  },
    ],
  },
};

// ── SYN_4B_03 — Thin collections ─────────────────────────────────────────────
// All tests pass, but interest proceeds (5.80) are insufficient to cover all obligations.
// Steps 1–4 consume 5.00; only 0.80 remains for Class B (1.80 due → 1.00 shortfall).
// Class C and sub-mgmt fee receive nothing. Equity takes residual principal 1.00.
// Validates that shortfall propagates and zero-remainder steps record amount_paid=0.

const SYN_4B_03: WaterfallScenario4B = {
  id:          'SYN_4B_03',
  description: 'Thin collections — shortfall propagates through Class B, C and sub-mgmt; equity sweeps principal',
  input: {
    waterfall_steps:       FIXTURE_WATERFALL_STEPS_4B,
    note_balances:         FIXTURE_NOTE_BALANCES,
    collections:           FIXTURE_COLLECTIONS_THIN,
    coverage_test_results: [
      { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
      { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
      { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 114.50, threshold_pct: 120.00, result: 'PASS' },  // set PASS for this scenario
    ],
  },
  expected: {
    total_allocated:    6.80,  // 5.00 (fees+ClassA) + 0.80 (partial ClassB) + 0 + 0 + 1.00 (equity)
    residual_interest:  0,
    residual_principal: 0,
    entry_count:        8,
    diversion_count:    0,
    entry_checks: [
      { step_id: 'STEP_04_CLASS_A_INTEREST', amount_due: 4.50, amount_paid: 4.50, shortfall: 0,    blocked: false },
      { step_id: 'STEP_06_OC_AB_CHECK',      amount_due: 1.80, amount_paid: 0.80, shortfall: 1.00, blocked: false },
      { step_id: 'STEP_07_OC_C_CHECK',       amount_due: 1.60, amount_paid: 0.00, shortfall: 1.60, blocked: false },
      { step_id: 'STEP_08_SUB_MGMT_FEE',     amount_due: 0.20, amount_paid: 0.00, shortfall: 0.20, blocked: false },
      { step_id: 'STEP_10_EQUITY',           amount_due: 1.00, amount_paid: 1.00, shortfall: 0,    blocked: false },
    ],
  },
};

export const WATERFALL_SCENARIOS_4B: WaterfallScenario4B[] = [
  SYN_4B_01,
  SYN_4B_02,
  SYN_4B_03,
];
