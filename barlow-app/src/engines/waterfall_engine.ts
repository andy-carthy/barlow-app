import type {
  WaterfallStep,
  DiversionEntry,
  NoteBalanceSnapshot,
  NoteClassBalance,
  AllocationEntry,
  WaterfallAllocationLedger,
  NoteClass,
  PaymentType,
  WaterfallStepType,
} from '../types/waterfall';
import type { PeriodCollections } from '../types/collections';
import type { CoverageTestResult } from './waterfall_diversion_engine';
import { evaluateCondition } from './waterfall_diversion_engine';

export type { CoverageTestResult };

export interface WaterfallEngineInput {
  waterfall_steps:       WaterfallStep[];
  coverage_test_results: CoverageTestResult[];
  collections:           PeriodCollections;
  note_balances:         NoteBalanceSnapshot;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolveFeeAmount(step: WaterfallStep, nb: NoteBalanceSnapshot): number {
  const id = step.step_id.toUpperCase();
  const { fees } = nb;
  if (id.includes('TRUSTEE') || id.includes('ADMIN'))         return fees.trustee_and_admin;
  if (id.includes('SR_MGMT') || id.includes('SENIOR_MGMT'))  return fees.senior_management_fee;
  if (id.includes('SUB_MGMT') || id.includes('SUBORDINATE')) return fees.subordinate_management_fee;
  if (id.includes('HEDGE'))                                   return fees.hedge_termination ?? 0;
  return 0;
}

function resolveNoteBalance(noteClass: NoteClass, nb: NoteBalanceSnapshot): NoteClassBalance | null {
  switch (noteClass) {
    case 'CLASS_A': return nb.class_a;
    case 'CLASS_B': return nb.class_b ?? null;
    case 'CLASS_C': return nb.class_c ?? null;
    case 'CLASS_D': return nb.class_d ?? null;
    case 'CLASS_E': return nb.class_e ?? null;
    default:        return null;
  }
}

function resolveInterestDue(step: WaterfallStep, nb: NoteBalanceSnapshot): number {
  if (!step.note_class) return 0;
  const bal = resolveNoteBalance(step.note_class, nb);
  if (!bal) return 0;
  return round2(bal.accrued_interest + (bal.deferred_interest ?? 0));
}

function inferPaymentType(step: WaterfallStep): PaymentType {
  if (step.payment_type) return step.payment_type;
  switch (step.step_type) {
    case 'FEE':                 return 'FEE';
    case 'INTEREST_PAYMENT':    return 'INTEREST';
    case 'PRINCIPAL_PAYMENT':   return 'PRINCIPAL';
    case 'EQUITY_DISTRIBUTION': return 'EQUITY_DISTRIBUTION';
    default:                    return 'INTEREST';
  }
}

function inferAmountDue(step: WaterfallStep, nb: NoteBalanceSnapshot): number {
  if (step.step_type === 'FEE')              return resolveFeeAmount(step, nb);
  if (step.step_type === 'INTEREST_PAYMENT') return resolveInterestDue(step, nb);
  if (step.step_type === 'COVERAGE_TEST_CHECK' && step.note_class) return resolveInterestDue(step, nb);
  return 0;
}

function blockedEntry(step: WaterfallStep, nb: NoteBalanceSnapshot): AllocationEntry {
  const due = inferAmountDue(step, nb);
  return {
    step_id:                step.step_id,
    step_number:            step.step_number,
    step_type:              step.step_type,
    beneficiary:            step.beneficiary ?? '',
    note_class:             step.note_class,
    payment_type:           inferPaymentType(step),
    amount_due:             due,
    amount_paid:            0,
    shortfall:              due,
    proceeds_bucket_before: 0,
    proceeds_bucket_after:  0,
    blocked:                true,
    indenture_section:      step.indenture_section,
  };
}

export function runWaterfall(input: WaterfallEngineInput): WaterfallAllocationLedger {
  const { waterfall_steps, coverage_test_results, collections, note_balances } = input;

  const testIndex = new Map<string, CoverageTestResult>(
    coverage_test_results.map(r => [r.test_id, r]),
  );

  const sortedSteps = [...waterfall_steps].sort((a, b) => a.step_number - b.step_number);

  // Hedge receipts are interest proceeds in CLO mechanics — add to interest bucket.
  let interest_bucket  = round2(collections.total_interest_proceeds + collections.hedge_receipts);
  let principal_bucket = round2(collections.total_principal_proceeds);

  let total_allocated = 0;
  const entries:    AllocationEntry[] = [];
  const diversions: DiversionEntry[]  = [];
  const blockedStepIds = new Set<string>();

  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];

    // REINVESTMENT steps are realised by the diversion bucket transfer, not as explicit entries.
    if (step.step_type === 'REINVESTMENT') continue;

    if (blockedStepIds.has(step.step_id)) {
      entries.push(blockedEntry(step, note_balances));
      continue;
    }

    if (step.step_type === 'FEE') {
      const due          = resolveFeeAmount(step, note_balances);
      const paid         = round2(Math.min(due, interest_bucket));
      const bucketBefore = interest_bucket;
      interest_bucket    = round2(interest_bucket - paid);
      total_allocated    = round2(total_allocated + paid);

      entries.push({
        step_id:                step.step_id,
        step_number:            step.step_number,
        step_type:              'FEE',
        beneficiary:            step.beneficiary ?? '',
        payment_type:           'FEE',
        amount_due:             due,
        amount_paid:            paid,
        shortfall:              round2(due - paid),
        proceeds_bucket_before: bucketBefore,
        proceeds_bucket_after:  interest_bucket,
        blocked:                false,
        indenture_section:      step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'INTEREST_PAYMENT') {
      const due          = resolveInterestDue(step, note_balances);
      const paid         = round2(Math.min(due, interest_bucket));
      const bucketBefore = interest_bucket;
      interest_bucket    = round2(interest_bucket - paid);
      total_allocated    = round2(total_allocated + paid);

      entries.push({
        step_id:                step.step_id,
        step_number:            step.step_number,
        step_type:              'INTEREST_PAYMENT',
        beneficiary:            step.beneficiary ?? '',
        note_class:             step.note_class,
        payment_type:           'INTEREST',
        amount_due:             due,
        amount_paid:            paid,
        shortfall:              round2(due - paid),
        proceeds_bucket_before: bucketBefore,
        proceeds_bucket_after:  interest_bucket,
        blocked:                false,
        indenture_section:      step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      const { passed, failingTestId } = evaluateCondition(step.condition, testIndex);

      if (passed) {
        if (step.note_class) {
          const due          = resolveInterestDue(step, note_balances);
          const paid         = round2(Math.min(due, interest_bucket));
          const bucketBefore = interest_bucket;
          interest_bucket    = round2(interest_bucket - paid);
          total_allocated    = round2(total_allocated + paid);

          entries.push({
            step_id:                step.step_id,
            step_number:            step.step_number,
            step_type:              'COVERAGE_TEST_CHECK',
            beneficiary:            step.beneficiary ?? '',
            note_class:             step.note_class,
            payment_type:           'INTEREST',
            amount_due:             due,
            amount_paid:            paid,
            shortfall:              round2(due - paid),
            proceeds_bucket_before: bucketBefore,
            proceeds_bucket_after:  interest_bucket,
            blocked:                false,
            indenture_section:      step.indenture_section,
          });
        }
        // No note_class: pure conditional check, no entry needed.
        continue;
      }

      // Diversion fires — transfer all remaining interest proceeds to the principal bucket.
      const diversionAmount = interest_bucket;
      const bucketBefore    = interest_bucket;
      interest_bucket       = 0;
      principal_bucket      = round2(principal_bucket + diversionAmount);

      const target = step.diverts_to ?? {
        step_type:           'REINVESTMENT' as const,
        note_class_priority: [],
        description:         'Principal reinvestment/cure',
      };

      diversions.push({
        step_id:           step.step_id,
        step_number:       step.step_number,
        triggering_test:   failingTestId ?? step.condition?.test_type ?? 'UNKNOWN',
        test_result:       'FAIL',
        diversion_amount:  round2(diversionAmount),
        diversion_target:  target,
        cure_mechanism:    step.cure_mechanism ?? 'REINVESTMENT',
        proceeds_before:   round2(bucketBefore),
        proceeds_after:    0,
        indenture_section: step.indenture_section,
      });

      // AllocationEntry shows the shortfall from the beneficiary's perspective.
      // The cash mechanics (diversion_amount) live in the DiversionEntry above.
      // Pure-check steps (no note_class) have no beneficiary to show a shortfall for.
      if (step.note_class) {
        const due = resolveInterestDue(step, note_balances);
        entries.push({
          step_id:                step.step_id,
          step_number:            step.step_number,
          step_type:              'COVERAGE_TEST_CHECK',
          beneficiary:            step.beneficiary ?? '',
          note_class:             step.note_class,
          payment_type:           'INTEREST',
          amount_due:             due,
          amount_paid:            0,
          shortfall:              due,
          proceeds_bucket_before: bucketBefore,
          proceeds_bucket_after:  0,
          blocked:                false,
          indenture_section:      step.indenture_section,
        });
      }

      // Block all downstream non-REINVESTMENT steps.
      for (let j = i + 1; j < sortedSteps.length; j++) {
        if (sortedSteps[j].step_type !== 'REINVESTMENT') {
          blockedStepIds.add(sortedSteps[j].step_id);
        }
      }
      continue;
    }

    if (step.step_type === 'PRINCIPAL_PAYMENT') {
      const due          = step.amount_basis === 'REMAINING_PROCEEDS' ? principal_bucket : principal_bucket;
      const paid         = round2(Math.min(due, principal_bucket));
      const bucketBefore = principal_bucket;
      principal_bucket   = round2(principal_bucket - paid);
      total_allocated    = round2(total_allocated + paid);

      entries.push({
        step_id:                step.step_id,
        step_number:            step.step_number,
        step_type:              'PRINCIPAL_PAYMENT',
        beneficiary:            step.beneficiary ?? '',
        note_class:             step.note_class,
        payment_type:           'PRINCIPAL',
        amount_due:             due,
        amount_paid:            paid,
        shortfall:              round2(due - paid),
        proceeds_bucket_before: bucketBefore,
        proceeds_bucket_after:  principal_bucket,
        blocked:                false,
        indenture_section:      step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'RESERVE_ACCOUNT_FUNDING') {
      const due          = principal_bucket;
      const paid         = round2(Math.min(due, principal_bucket));
      const bucketBefore = principal_bucket;
      principal_bucket   = round2(principal_bucket - paid);
      total_allocated    = round2(total_allocated + paid);

      entries.push({
        step_id:                step.step_id,
        step_number:            step.step_number,
        step_type:              'RESERVE_ACCOUNT_FUNDING',
        beneficiary:            step.beneficiary ?? 'Reserve Account',
        payment_type:           'PRINCIPAL',
        amount_due:             due,
        amount_paid:            paid,
        shortfall:              0,
        proceeds_bucket_before: bucketBefore,
        proceeds_bucket_after:  principal_bucket,
        blocked:                false,
        indenture_section:      step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'EQUITY_DISTRIBUTION') {
      const combined = round2(interest_bucket + principal_bucket);
      interest_bucket  = 0;
      principal_bucket = 0;
      total_allocated  = round2(total_allocated + combined);

      entries.push({
        step_id:                step.step_id,
        step_number:            step.step_number,
        step_type:              'EQUITY_DISTRIBUTION',
        beneficiary:            step.beneficiary ?? 'Preferred Interest Holders',
        payment_type:           'EQUITY_DISTRIBUTION',
        amount_due:             combined,
        amount_paid:            combined,
        shortfall:              0,
        proceeds_bucket_before: combined,
        proceeds_bucket_after:  0,
        blocked:                false,
        indenture_section:      step.indenture_section,
      });
      continue;
    }
  }

  return {
    payment_date:       collections.payment_date,
    period_start:       collections.period_start,
    period_end:         collections.period_end,
    collections,
    total_allocated:    round2(total_allocated),
    residual_interest:  round2(interest_bucket),
    residual_principal: round2(principal_bucket),
    entries,
    diversions,
  };
}
