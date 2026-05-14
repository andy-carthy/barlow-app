import type { WaterfallStep } from './waterfall';

export interface CoverageTest {
  test_id:           string;
  test_type:         'overcollateralization' | 'interest_coverage';
  description:       string;
  numerator:         string;
  denominator:       string;
  threshold_pct:     number;
  failure_action:    string;
  source_clause:     string;
  confidence:        'HIGH' | 'MEDIUM' | 'LOW';
  confidence_reason: string;
}

export interface ConcentrationLimitTier {
  rank:    string;
  max_pct: number;
}

export interface ConcentrationLimit {
  limit_id:           string;
  description:        string;
  dimension:          'obligor' | 'industry' | 'country' | 'rating_bucket' | 'loan_type';
  max_pct:            number;
  tiers?:             ConcentrationLimitTier[];
  applies_to?:        string[] | null;
  applies_to_values?: string[] | null;
  calculation_basis:  string;
  notes?:             string | null;
  source_clause:      string;
  confidence:         'HIGH' | 'MEDIUM' | 'LOW';
  confidence_reason:  string;
}

export interface ExtractionSummary {
  tests_found:           number;
  limits_found:          number;
  waterfall_steps_found: number;
  overall_confidence:    'HIGH' | 'MEDIUM' | 'LOW';
  flags:                 string[];
}

export interface ExtractionOutput {
  deal_name:            string;
  extraction_date:      string;
  coverage_tests:       CoverageTest[];
  concentration_limits: ConcentrationLimit[];
  waterfall_steps:      WaterfallStep[];
  extraction_summary:   ExtractionSummary;
}
