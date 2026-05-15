import type { WaterfallEngineInput } from '../../engines/waterfall_engine';
import type { ConcentrationTestResult, ReportMeta } from '../../types/report';
import type { NoteBalanceSnapshot } from '../../types/waterfall';
import { FIXTURE_WATERFALL_STEPS_4B, FIXTURE_NOTE_BALANCES, FIXTURE_COLLECTIONS_NORMAL } from '../synthetic_waterfall/scenarios_4b';

// ── Shared report metadata ───────────────────────────────────────────────────

export const REPORT_META_BARLOW: ReportMeta = {
  payment_date:       '2025-01-15',
  period_start:       '2024-10-29',
  period_end:         '2025-01-13',
  trustee:            'U.S. Bank National Association',
  collateral_manager: 'Barlow Capital Management LLC',
  deal_cik:           '0001234567',
};

// ── Coverage test result sets ────────────────────────────────────────────────

export const COVERAGE_TESTS_ALL_PASS = [
  { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' as const, cushion_pct: 26.71, source_clause: '§11.1(a)(i)' },
  { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' as const, cushion_pct: 16.00, source_clause: '§11.1(a)(ii)' },
  { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' as const, cushion_pct: 83.05, source_clause: '§11.1(b)(i)' },
];

export const COVERAGE_TESTS_OC_AB_FAIL = [
  { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 114.58, threshold_pct: 123.50, result: 'FAIL' as const, cushion_pct: -8.92, source_clause: '§11.1(a)(i)' },
  { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct:  98.21, threshold_pct: 112.75, result: 'FAIL' as const, cushion_pct: -14.54, source_clause: '§11.1(a)(ii)' },
  { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' as const, cushion_pct: 83.05, source_clause: '§11.1(b)(i)' },
];

// ── Concentration test result sets ───────────────────────────────────────────

export const CONC_TESTS_ALL_PASS: ConcentrationTestResult[] = [
  { limit_id: 'SINGLE_OBLIGOR_3PCT',   description: 'Maximum single-obligor concentration',   max_pct: 3.0,  actual_pct: 2.77,  result: 'PASS', headroom:  0.23, breach_count: 0, breaches: [], source_clause: '§12.2(a)' },
  { limit_id: 'SINGLE_INDUSTRY_15PCT', description: 'Single Moody\'s industry concentration', max_pct: 15.0, actual_pct: 5.13,  result: 'PASS', headroom:  9.87, breach_count: 0, breaches: [], source_clause: '§12.2(b)' },
  { limit_id: 'CCC_BUCKET_7PCT',       description: 'CCC/Caa-rated or below bucket',          max_pct: 7.5,  actual_pct: 4.50,  result: 'PASS', headroom:  3.00, breach_count: 0, breaches: [], source_clause: '§12.2(c)' },
  { limit_id: 'DIP_LOAN_5PCT',         description: 'Debtor-in-possession loans',             max_pct: 5.0,  actual_pct: 0.00,  result: 'PASS', headroom:  5.00, breach_count: 0, breaches: [], source_clause: '§12.2(d)' },
];

export const CONC_TESTS_TWO_FAIL: ConcentrationTestResult[] = [
  { limit_id: 'SINGLE_OBLIGOR_3PCT',   description: 'Maximum single-obligor concentration',   max_pct: 3.0,  actual_pct: 4.02,  result: 'FAIL', headroom: -1.02, breach_count: 1, breaches: [{ item: 'Apex Logistics', par_value: 14.5, pct: 4.02 }], source_clause: '§12.2(a)' },
  { limit_id: 'SINGLE_INDUSTRY_15PCT', description: 'Single Moody\'s industry concentration', max_pct: 15.0, actual_pct: 5.13,  result: 'PASS', headroom:  9.87, breach_count: 0, breaches: [], source_clause: '§12.2(b)' },
  { limit_id: 'CCC_BUCKET_7PCT',       description: 'CCC/Caa-rated or below bucket',          max_pct: 7.5,  actual_pct: 12.76, result: 'FAIL', headroom: -5.26, breach_count: 1, breaches: [{ item: 'CCC/Caa bucket', par_value: 46.0, pct: 12.76 }], source_clause: '§12.2(c)' },
  { limit_id: 'DIP_LOAN_5PCT',         description: 'Debtor-in-possession loans',             max_pct: 5.0,  actual_pct: 0.00,  result: 'PASS', headroom:  5.00, breach_count: 0, breaches: [], source_clause: '§12.2(d)' },
];

// ── Scenario type ────────────────────────────────────────────────────────────

export interface ReportScenario5A {
  id:          string;
  description: string;
  waterfallInput: WaterfallEngineInput;
  noteBalances: NoteBalanceSnapshot;
  coverageTestResults: typeof COVERAGE_TESTS_ALL_PASS;
  concentrationTestResults: ConcentrationTestResult[];
  reportMeta: ReportMeta;
  expected: {
    note_balance_entry_count:          number;
    coverage_pass_count:               number;
    coverage_fail_count:               number;
    concentration_fail_count:          number;
    waterfall_total_allocated:         number;
    has_diversion_summary:             boolean;
    has_exception_register:            boolean;
    exception_count?:                  number;
  };
}

export const REPORT_SCENARIOS_5A: ReportScenario5A[] = [
  {
    id: 'SYN_5A_01',
    description: 'Clean period — all tests pass, full distribution, no exceptions',
    waterfallInput: { waterfall_steps: FIXTURE_WATERFALL_STEPS_4B, note_balances: FIXTURE_NOTE_BALANCES, collections: FIXTURE_COLLECTIONS_NORMAL, coverage_test_results: COVERAGE_TESTS_ALL_PASS },
    noteBalances: FIXTURE_NOTE_BALANCES,
    coverageTestResults: COVERAGE_TESTS_ALL_PASS,
    concentrationTestResults: CONC_TESTS_ALL_PASS,
    reportMeta: REPORT_META_BARLOW,
    expected: {
      note_balance_entry_count:   3,
      coverage_pass_count:        3,
      coverage_fail_count:        0,
      concentration_fail_count:   0,
      waterfall_total_allocated:  17.00,
      has_diversion_summary:      false,
      has_exception_register:     false,
    },
  },
  {
    id: 'SYN_5A_02',
    description: 'OC breach — diversion fired, Class B/C blocked, exception register populated',
    waterfallInput: { waterfall_steps: FIXTURE_WATERFALL_STEPS_4B, note_balances: FIXTURE_NOTE_BALANCES, collections: FIXTURE_COLLECTIONS_NORMAL, coverage_test_results: COVERAGE_TESTS_OC_AB_FAIL },
    noteBalances: FIXTURE_NOTE_BALANCES,
    coverageTestResults: COVERAGE_TESTS_OC_AB_FAIL,
    concentrationTestResults: CONC_TESTS_ALL_PASS,
    reportMeta: REPORT_META_BARLOW,
    expected: {
      note_balance_entry_count:   3,
      coverage_pass_count:        1,
      coverage_fail_count:        2,
      concentration_fail_count:   0,
      waterfall_total_allocated:  5.00,
      has_diversion_summary:      true,
      has_exception_register:     true,
      exception_count:            2,
    },
  },
  {
    id: 'SYN_5A_03',
    description: 'Concentration limit breaches — clean coverage tests, no diversion, exception register with concentrations',
    waterfallInput: { waterfall_steps: FIXTURE_WATERFALL_STEPS_4B, note_balances: FIXTURE_NOTE_BALANCES, collections: FIXTURE_COLLECTIONS_NORMAL, coverage_test_results: COVERAGE_TESTS_ALL_PASS },
    noteBalances: FIXTURE_NOTE_BALANCES,
    coverageTestResults: COVERAGE_TESTS_ALL_PASS,
    concentrationTestResults: CONC_TESTS_TWO_FAIL,
    reportMeta: REPORT_META_BARLOW,
    expected: {
      note_balance_entry_count:   3,
      coverage_pass_count:        3,
      coverage_fail_count:        0,
      concentration_fail_count:   2,
      waterfall_total_allocated:  17.00,
      has_diversion_summary:      false,
      has_exception_register:     true,
      exception_count:            2,
    },
  },
];
