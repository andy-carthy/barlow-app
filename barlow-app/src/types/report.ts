import type { NoteClass, AllocationEntry, DiversionEntry } from './waterfall';
import type { PeriodCollections } from './collections';

export interface ReportMeta {
  payment_date:        string;
  period_start:        string;
  period_end:          string;
  trustee:             string;
  collateral_manager:  string;
  deal_cik?:           string;
}

// ── Section types ─────────────────────────────────────────────────────────────

export interface NoteBalanceEntry {
  note_class:       NoteClass;
  balance_prior:    number;
  principal_paid:   number;
  balance_current:  number;
  note_rate:        number;      // annualised decimal, e.g. 0.1201 for 12.01%
  interest_paid:    number;
}

export interface NoteBalanceStatement {
  entries: NoteBalanceEntry[];
}

export interface CoverageTestEntry {
  test_id:           string;
  test_type:         'OC' | 'IC';
  note_classes:      NoteClass[];
  threshold:         number;
  actual:            number;
  result:            'PASS' | 'FAIL';
  indenture_section: string;
  cushion:           number;     // actual - threshold; negative = breach depth
}

export interface CoverageTestSummary {
  entries: CoverageTestEntry[];
}

export interface ConcentrationLimitEntry {
  limit_id:          string;
  description:       string;
  applies_to:        string;
  max_pct:           number;
  actual_pct:        number;
  result:            'PASS' | 'FAIL';
  indenture_section: string;
  headroom:          number;     // max_pct - actual_pct; negative = breach depth
}

export interface ConcentrationLimitSummary {
  entries: ConcentrationLimitEntry[];
}

export interface WaterfallAllocationTable {
  entries:                  AllocationEntry[];
  total_interest_proceeds:  number;
  total_principal_proceeds: number;
  total_allocated:          number;
}

export interface InterestDistributionEntry {
  note_class:    NoteClass;
  days_accrued:  number;
  accrual_rate:  number;   // annualised decimal
  interest_due:  number;
  interest_paid: number;
  shortfall:     number;
  blocked:       boolean;
}

export interface InterestDistribution {
  period_start: string;
  period_end:   string;
  entries:      InterestDistributionEntry[];
}

export interface PrincipalDistributionEntry {
  note_class:      NoteClass;
  principal_paid:  number;
  redemption_type: 'SCHEDULED' | 'OC_CURE' | 'IC_CURE' | 'OPTIONAL' | 'NONE';
}

export interface PrincipalDistribution {
  entries:                     PrincipalDistributionEntry[];
  total_principal_distributed: number;
}

export interface PortfolioCharacteristics {
  report_date:                   string;
  loan_count:                    number;
  total_par:                     number;
  weighted_avg_spread:           number;    // WAS — basis points
  weighted_avg_life:             number;    // WAL — years
  weighted_avg_rating_factor:    number;    // WARF
  diversity_score:               number;
  ccc_pct:                       number;
  floating_rate_pct:             number;
  top_10_obligor_pct:            number;
}

export interface DiversionSummary {
  total_diverted: number;
  entries:        DiversionEntry[];
}

export interface ExceptionEntry {
  exception_id:          string;
  exception_type:        'OC_BREACH' | 'IC_BREACH' | 'CONCENTRATION_BREACH' | 'DIVERSION';
  description:           string;
  indenture_section:     string;
  breach_depth:          number;      // positive = how far below threshold
  diversion_triggered:   boolean;
  diversion_amount:      number | null;
}

export interface ExceptionRegister {
  as_of_date: string;
  entries:    ExceptionEntry[];
}

export interface ExceptionNarrative {
  exception_id:   string;
  narrative:      string;
  generated_by:   'BARLOW_5B';
  model:          string;
  prompt_version: string;
}

// ── Root report type ──────────────────────────────────────────────────────────

export interface TrusteeReport {
  report_type:          'PAYMENT_DATE_REPORT';
  deal_name:            string;
  deal_cik:             string;
  payment_date:         string;
  period_start:         string;
  period_end:           string;
  trustee:              string;
  collateral_manager:   string;
  generated_at:         string;
  generated_by:         'BARLOW_5A';

  note_balance_statement:       NoteBalanceStatement;
  coverage_test_summary:        CoverageTestSummary;
  concentration_limit_summary:  ConcentrationLimitSummary;
  waterfall_allocation_table:   WaterfallAllocationTable;
  interest_distribution:        InterestDistribution;
  principal_distribution:       PrincipalDistribution;
  portfolio_characteristics:    PortfolioCharacteristics;
  diversion_summary:            DiversionSummary | null;
  exception_register:           ExceptionRegister | null;
  exception_narratives:         ExceptionNarrative[] | null;
}

// ── Concentration test result (from Phase 3 runner) ──────────────────────────

export interface ConcentrationBreachDetail {
  item:       string;
  par_value:  number;
  pct:        number;
  loans?:     string[];
}

export interface ConcentrationTestResult {
  limit_id:        string;
  description:     string;
  max_pct:         number;
  actual_pct:      number;
  result:          'PASS' | 'FAIL';
  headroom:        number;
  breach_count:    number;
  breaches:        ConcentrationBreachDetail[];
  source_clause:   string;
}
