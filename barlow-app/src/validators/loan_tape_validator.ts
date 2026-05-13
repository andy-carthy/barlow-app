import {
  LoanPosition,
  LOAN_TYPES,
  REFERENCE_RATES,
  PAYMENT_FREQUENCIES,
  RATING_SOURCES,
  DATA_SOURCES,
} from '../types/loan';

export interface ValidationError {
  loan_id: string;
  field:   string;
  message: string;
}

export interface ValidationResult {
  valid:  boolean;
  errors: ValidationError[];
}

const REQUIRED_FIELDS: (keyof LoanPosition)[] = [
  'loan_id',
  'obligor_name',
  'obligor_id',
  'loan_type',
  'principal_balance',
  'purchase_price',
  'market_value',
  'spread',
  'reference_rate',
  'payment_frequency',
  'maturity_date',
];

const ISO_DATE_RE     = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const COUNTRY_RE      = /^[A-Z]{2}$/;

export function validateLoanTape(loans: LoanPosition[]): ValidationResult {
  const errors: ValidationError[] = [];

  loans.forEach((loan, index) => {
    const id = loan.loan_id ?? `[index ${index}]`;

    function err(field: string, message: string) {
      errors.push({ loan_id: id, field, message });
    }

    // ── Required field presence ───────────────────────────────────────────────
    for (const field of REQUIRED_FIELDS) {
      if (loan[field] === undefined || loan[field] === null || loan[field] === '') {
        err(field, `required field is missing or empty`);
      }
    }

    // ── Enum fields ───────────────────────────────────────────────────────────
    if (loan.loan_type !== undefined && !LOAN_TYPES.includes(loan.loan_type)) {
      err('loan_type', `invalid value "${loan.loan_type}"; must be one of: ${LOAN_TYPES.join(', ')}`);
    }
    if (loan.reference_rate !== undefined && !REFERENCE_RATES.includes(loan.reference_rate)) {
      err('reference_rate', `invalid value "${loan.reference_rate}"; must be one of: ${REFERENCE_RATES.join(', ')}`);
    }
    if (loan.payment_frequency !== undefined && !PAYMENT_FREQUENCIES.includes(loan.payment_frequency)) {
      err('payment_frequency', `invalid value "${loan.payment_frequency}"; must be one of: ${PAYMENT_FREQUENCIES.join(', ')}`);
    }
    if (loan.rating_source !== undefined && !RATING_SOURCES.includes(loan.rating_source)) {
      err('rating_source', `invalid value "${loan.rating_source}"; must be one of: ${RATING_SOURCES.join(', ')}`);
    }
    if (loan.source !== undefined && !DATA_SOURCES.includes(loan.source)) {
      err('source', `invalid value "${loan.source}"; must be one of: ${DATA_SOURCES.join(', ')}`);
    }

    // ── Numeric range checks ──────────────────────────────────────────────────
    if (typeof loan.principal_balance === 'number' && loan.principal_balance <= 0) {
      err('principal_balance', `must be greater than 0 (got ${loan.principal_balance})`);
    }
    if (typeof loan.purchase_price === 'number' && loan.purchase_price <= 0) {
      err('purchase_price', `must be greater than 0 (got ${loan.purchase_price})`);
    }
    if (typeof loan.market_value === 'number' && loan.market_value <= 0) {
      err('market_value', `must be greater than 0 (got ${loan.market_value})`);
    }
    if (typeof loan.unfunded_commitment === 'number' && loan.unfunded_commitment < 0) {
      err('unfunded_commitment', `must be >= 0 (got ${loan.unfunded_commitment})`);
    }
    if (typeof loan.accrued_interest === 'number' && loan.accrued_interest < 0) {
      err('accrued_interest', `must be >= 0 (got ${loan.accrued_interest})`);
    }

    // ── Conditional: coupon required when reference_rate is FIXED ─────────────
    if (loan.reference_rate === 'FIXED' && (loan.coupon === undefined || loan.coupon === null)) {
      err('coupon', `required when reference_rate is FIXED`);
    }

    // ── Format checks ─────────────────────────────────────────────────────────
    if (loan.maturity_date !== undefined && !ISO_DATE_RE.test(loan.maturity_date)) {
      err('maturity_date', `must be ISO 8601 date format YYYY-MM-DD (got "${loan.maturity_date}")`);
    }
    if (loan.last_updated !== undefined && !ISO_DATETIME_RE.test(loan.last_updated)) {
      err('last_updated', `must be ISO 8601 datetime (got "${loan.last_updated}")`);
    }
    if (loan.country !== undefined && !COUNTRY_RE.test(loan.country)) {
      err('country', `must be ISO 3166-1 alpha-2 uppercase code (got "${loan.country}")`);
    }
  });

  return { valid: errors.length === 0, errors };
}
