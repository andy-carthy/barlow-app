import type { PeriodCollections } from './collections';

export type WaterfallStepType =
  | 'FEE'
  | 'INTEREST_PAYMENT'
  | 'COVERAGE_TEST_CHECK'
  | 'DIVERSION'
  | 'PRINCIPAL_PAYMENT'
  | 'REINVESTMENT'
  | 'EQUITY_DISTRIBUTION'
  | 'RESERVE_ACCOUNT_FUNDING';

export type PaymentType = 'INTEREST' | 'PRINCIPAL' | 'FEE' | 'EQUITY_DISTRIBUTION';

export type NoteClass = 'CLASS_A' | 'CLASS_B' | 'CLASS_C' | 'CLASS_D' | 'CLASS_E' | 'EQUITY';

export type AmountBasis =
  | 'ACCRUED_INTEREST'
  | 'PRO_RATA'
  | 'REMAINING_PROCEEDS'
  | 'FIXED'
  | 'LESSER_OF_ACCRUED_AND_AVAILABLE';

export interface WaterfallCondition {
  test_type:           'OC' | 'IC' | 'COMBINED' | 'NONE';
  note_classes_tested: NoteClass[];
  operator:            'ALL_PASS' | 'ANY_PASS';
}

export interface DiversionTarget {
  step_type:           'REINVESTMENT' | 'REDEMPTION' | 'RESERVE';
  note_class_priority: NoteClass[];
  description:         string;
}

export type CureMechanism = 'REINVESTMENT' | 'REDEMPTION' | 'TRAP';

export interface WaterfallStep {
  step_id:           string;
  step_number:       number;
  step_type:         WaterfallStepType;
  label:             string;
  indenture_section: string;

  beneficiary?:      string;
  payment_type?:     PaymentType;
  note_class?:       NoteClass;
  amount_basis?:     AmountBasis;

  condition?:        WaterfallCondition;
  condition_raw?:    string;

  diverts_to?:       DiversionTarget;
  cure_mechanism?:   CureMechanism;
}

export interface DiversionEntry {
  step_id:           string;
  step_number:       number;
  triggering_test:   string;
  test_result:       'FAIL';
  diversion_amount:  number;
  diversion_target:  DiversionTarget;
  cure_mechanism:    CureMechanism;
  proceeds_before:   number;
  proceeds_after:    number;
  indenture_section: string;
}

export interface DiversionLedger {
  payment_date:            string;
  period_start:            string;
  period_end:              string;
  total_interest_proceeds: number;
  total_diverted:          number;
  total_distributed:       number;
  entries:                 DiversionEntry[];
  blocked_steps:           string[];
}

// ── Phase 4B types ────────────────────────────────────────────────────────────

export interface NoteClassBalance {
  outstanding_balance: number;
  accrued_interest:    number;
  deferred_interest?:  number;
}

export interface PeriodFees {
  trustee_and_admin:          number;
  senior_management_fee:      number;
  subordinate_management_fee: number;
  hedge_termination?:         number;
}

export interface NoteBalanceSnapshot {
  payment_date: string;
  class_a:      NoteClassBalance;
  class_b?:     NoteClassBalance;
  class_c?:     NoteClassBalance;
  class_d?:     NoteClassBalance;
  class_e?:     NoteClassBalance;
  fees:         PeriodFees;
}

export interface AllocationEntry {
  step_id:                string;
  step_number:            number;
  step_type:              WaterfallStepType;
  beneficiary:            string;
  note_class?:            NoteClass;
  payment_type:           PaymentType;
  amount_due:             number;
  amount_paid:            number;
  shortfall:              number;
  proceeds_bucket_before: number;
  proceeds_bucket_after:  number;
  blocked:                boolean;
  indenture_section:      string;
}

export interface WaterfallAllocationLedger {
  payment_date:       string;
  period_start:       string;
  period_end:         string;
  collections:        PeriodCollections;
  total_allocated:    number;
  residual_interest:  number;
  residual_principal: number;
  entries:            AllocationEntry[];
  diversions:         DiversionEntry[];
}
