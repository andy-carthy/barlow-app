export type LoanType =
  | 'SENIOR_SECURED'
  | 'FIRST_LIEN_LAST_OUT'
  | 'SECOND_LIEN'
  | 'PERMITTED_DEBT_SECURITY'
  | 'UNSECURED';

export type ReferenceRate = 'SOFR' | 'LIBOR' | 'FIXED';

export type PaymentFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';

// Tracks which rating agency is the source of record.
// MOODYS_FITCH_DERIVED supports CLO tests that take the lower of Moody's and Fitch.
export type RatingSource =
  | 'SP_DIRECT'
  | 'MOODYS_DERIVED'
  | 'FITCH_DERIVED'
  | 'MOODYS_FITCH_DERIVED';

export type DataSource = 'LMS_TAPE' | 'AGENT_NOTICE' | 'MANUAL';

export interface LoanPosition {
  // ── Required ──────────────────────────────────────────────────────────────
  loan_id:            string;
  obligor_name:       string;
  obligor_id:         string;
  loan_type:          LoanType;
  principal_balance:  number;   // Outstanding par, $M
  purchase_price:     number;   // As % of par (e.g. 98.50)
  market_value:       number;   // Current market value, $M
  spread:             number;   // Spread over reference rate, bps
  reference_rate:     ReferenceRate;
  payment_frequency:  PaymentFrequency;
  maturity_date:      string;   // ISO 8601 date (YYYY-MM-DD)

  // coupon is required when reference_rate === 'FIXED'; optional otherwise
  coupon?: number;

  // ── Optional ──────────────────────────────────────────────────────────────
  sp_rating?:             string;   // e.g. B+, CCC, NR
  moodys_rating?:         string;   // e.g. B2, Caa2
  fitch_rating?:          string;
  rating_source?:         RatingSource;
  country?:               string;   // ISO 3166-1 alpha-2
  industry?:              string;   // GICS or custom
  is_dip?:                boolean;  // Debtor-in-possession financing
  is_current_pay?:        boolean;  // Current pay obligation
  is_deferrable?:         boolean;  // Deferrable interest
  is_partial_deferring?:  boolean;  // Partially deferring interest
  unfunded_commitment?:   number;   // Undrawn revolver / delayed draw, $M
  participation_interest?: boolean;
  accrued_interest?:      number;   // Accrued interest, $M
  last_updated?:          string;   // ISO 8601 datetime
  source?:                DataSource;
}

// ── Enum value sets (used by validator and JSON Schema) ───────────────────────

export const LOAN_TYPES: LoanType[] = [
  'SENIOR_SECURED',
  'FIRST_LIEN_LAST_OUT',
  'SECOND_LIEN',
  'PERMITTED_DEBT_SECURITY',
  'UNSECURED',
];

export const REFERENCE_RATES: ReferenceRate[] = ['SOFR', 'LIBOR', 'FIXED'];

export const PAYMENT_FREQUENCIES: PaymentFrequency[] = [
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL',
];

export const RATING_SOURCES: RatingSource[] = [
  'SP_DIRECT',
  'MOODYS_DERIVED',
  'FITCH_DERIVED',
  'MOODYS_FITCH_DERIVED',
];

export const DATA_SOURCES: DataSource[] = ['LMS_TAPE', 'AGENT_NOTICE', 'MANUAL'];
