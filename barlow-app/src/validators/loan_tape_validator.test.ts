import { validateLoanTape } from './loan_tape_validator';
import { SYNTHETIC_LOAN_TAPE } from '../fixtures/synthetic_loan_tape';
import { LoanPosition } from '../types/loan';

// ── Happy path ────────────────────────────────────────────────────────────────

test('SYNTHETIC_LOAN_TAPE passes validation with zero errors', () => {
  const result = validateLoanTape(SYNTHETIC_LOAN_TAPE);
  if (!result.valid) {
    console.error('Unexpected errors:', JSON.stringify(result.errors, null, 2));
  }
  expect(result.valid).toBe(true);
  expect(result.errors).toHaveLength(0);
});

// ── Required field violations ─────────────────────────────────────────────────

test('missing loan_id surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], loan_id: '' }] as LoanPosition[];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'loan_id')).toBe(true);
});

test('missing obligor_name surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0] }] as LoanPosition[];
  // @ts-expect-error intentional: testing runtime behaviour for missing field
  delete loans[0].obligor_name;
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'obligor_name')).toBe(true);
});

test('missing principal_balance surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0] }] as LoanPosition[];
  // @ts-expect-error intentional
  delete loans[0].principal_balance;
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'principal_balance')).toBe(true);
});

// ── Enum violations ───────────────────────────────────────────────────────────

test('invalid loan_type surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], loan_type: 'MEZZANINE' as any }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'loan_type')).toBe(true);
});

test('invalid reference_rate surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], reference_rate: 'EURIBOR' as any }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'reference_rate')).toBe(true);
});

test('invalid payment_frequency surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], payment_frequency: 'WEEKLY' as any }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'payment_frequency')).toBe(true);
});

test('invalid rating_source surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], rating_source: 'KROLL' as any }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'rating_source')).toBe(true);
});

test('invalid source surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], source: 'BLOOMBERG' as any }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'source')).toBe(true);
});

// ── Numeric range violations ──────────────────────────────────────────────────

test('principal_balance of zero surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], principal_balance: 0 }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'principal_balance')).toBe(true);
});

test('negative accrued_interest surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], accrued_interest: -0.5 }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'accrued_interest')).toBe(true);
});

// ── Conditional: FIXED rate requires coupon ───────────────────────────────────

test('FIXED reference_rate without coupon surfaces a field-level error', () => {
  const loan: LoanPosition = {
    ...SYNTHETIC_LOAN_TAPE[0],
    reference_rate: 'FIXED',
    coupon: undefined,
  };
  const result = validateLoanTape([loan]);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'coupon')).toBe(true);
});

test('FIXED reference_rate with coupon passes validation', () => {
  const loan: LoanPosition = {
    ...SYNTHETIC_LOAN_TAPE[0],
    reference_rate: 'FIXED',
    coupon: 7.5,
    spread: 0,
  };
  const result = validateLoanTape([loan]);
  expect(result.valid).toBe(true);
});

// ── Format violations ─────────────────────────────────────────────────────────

test('malformed maturity_date surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], maturity_date: '29-04-2030' }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'maturity_date')).toBe(true);
});

test('malformed country code surfaces a field-level error', () => {
  const loans = [{ ...SYNTHETIC_LOAN_TAPE[0], country: 'USA' }];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.field === 'country')).toBe(true);
});

// ── Multi-record: errors are reported per loan_id ─────────────────────────────

test('errors on multiple records each include the correct loan_id', () => {
  const loans: LoanPosition[] = [
    { ...SYNTHETIC_LOAN_TAPE[0], loan_type: 'BAD' as any },
    { ...SYNTHETIC_LOAN_TAPE[1], principal_balance: -5 },
  ];
  const result = validateLoanTape(loans);
  expect(result.valid).toBe(false);
  const ids = result.errors.map(e => e.loan_id);
  expect(ids).toContain('L001');
  expect(ids).toContain('L002');
});
