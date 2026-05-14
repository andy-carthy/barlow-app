import type {
  WaterfallStep,
  DiversionLedger,
  DiversionEntry,
  WaterfallCondition,
  DiversionTarget,
  CureMechanism,
  NoteClass,
} from '../types/waterfall';

export interface CoverageTestResult {
  test_id:        string;
  test_type:      string;
  calculated_pct: number;
  threshold_pct:  number;
  result:         'PASS' | 'FAIL';
}

export interface WaterfallCapitalStructure {
  class_a_interest_due:        number;
  class_b_interest_due?:       number;
  class_c_interest_due?:       number;
  class_d_interest_due?:       number;
  trustee_fee:                 number;
  senior_management_fee:       number;
  hedge_payments?:             number;
  subordinate_management_fee?: number;
}

export interface WaterfallDiversionInput {
  payment_date:                string;
  period_start:                string;
  period_end:                  string;
  waterfall_steps:             WaterfallStep[];
  coverage_test_results:       CoverageTestResult[];
  available_interest_proceeds: number;
  capital_structure:           WaterfallCapitalStructure;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Derive the test_id suffix from the condition's note_classes_tested.
// Convention: [CLASS_A, CLASS_B] → 'AB'; [CLASS_A, CLASS_B, CLASS_C] → 'C'
function noteClassesToSuffix(noteClasses: NoteClass[]): string | null {
  const order: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };
  const letters = noteClasses
    .map(c => c.replace('CLASS_', ''))
    .filter(l => order[l] !== undefined)
    .sort((a, b) => order[a] - order[b]);

  if (letters.length === 0) return null;
  // A+B together is named "AB" in standard test IDs, not just "B"
  if (letters.join('') === 'AB') return 'AB';
  return letters[letters.length - 1];
}

// Find the coverage test result that corresponds to a waterfall condition.
function resolveTestResult(
  condition: WaterfallCondition,
  testIndex: Map<string, CoverageTestResult>,
): { result: CoverageTestResult | null; testId: string | null } {
  const suffix = noteClassesToSuffix(condition.note_classes_tested);
  if (!suffix) return { result: null, testId: null };

  const prefix = condition.test_type === 'OC' ? 'OC_CLASS_' : 'IC_CLASS_';
  const expectedId = `${prefix}${suffix}`;

  // Exact match first
  const direct = testIndex.get(expectedId);
  if (direct) return { result: direct, testId: expectedId };

  // Fuzzy fallback: correct type + suffix appears in test_id
  const typeStr = condition.test_type === 'OC' ? 'overcollateralization' : 'interest_coverage';
  for (const [id, r] of testIndex) {
    if (r.test_type === typeStr && id.includes(suffix)) {
      return { result: r, testId: id };
    }
  }

  return { result: null, testId: null };
}

// Evaluate a condition against available test results.
// Returns { passed, failingTestId }.
export function evaluateCondition(
  condition: WaterfallCondition | undefined,
  testIndex: Map<string, CoverageTestResult>,
): { passed: boolean; failingTestId: string | null } {
  if (!condition || condition.test_type === 'NONE') {
    return { passed: true, failingTestId: null };
  }

  // COMBINED: both OC and IC tests for the relevant classes must pass.
  // Carlyle-style: "if either of the Class A/B Coverage Tests is not satisfied".
  if (condition.test_type === 'COMBINED') {
    const suffix = noteClassesToSuffix(condition.note_classes_tested);
    if (suffix) {
      for (const prefix of ['OC_CLASS_', 'IC_CLASS_'] as const) {
        const id = `${prefix}${suffix}`;
        const r  = testIndex.get(id);
        if (r && r.result === 'FAIL') return { passed: false, failingTestId: id };
      }
    }
    return { passed: true, failingTestId: null };
  }

  const { result, testId } = resolveTestResult(condition, testIndex);

  if (!result) {
    return { passed: true, failingTestId: null };
  }

  if (condition.operator === 'ALL_PASS') {
    if (result.result === 'FAIL') return { passed: false, failingTestId: testId };
    return { passed: true, failingTestId: null };
  } else {
    if (result.result === 'PASS') return { passed: true, failingTestId: null };
    return { passed: false, failingTestId: testId };
  }
}

function resolvePaymentAmount(
  step: WaterfallStep,
  capital: WaterfallCapitalStructure,
  remaining: number,
): number {
  if (step.amount_basis === 'REMAINING_PROCEEDS') return remaining;

  if (step.step_type === 'FEE') {
    const id = step.step_id.toUpperCase();
    if (id.includes('TRUSTEE'))                             return capital.trustee_fee;
    if (id.includes('SR_MGMT') || id.includes('SENIOR_MGMT')) return capital.senior_management_fee;
    if (id.includes('HEDGE'))                               return capital.hedge_payments ?? 0;
    if (id.includes('SUB_MGMT') || id.includes('SUBORDINATE')) return capital.subordinate_management_fee ?? 0;
    return 0;
  }

  if (step.step_type === 'INTEREST_PAYMENT' && step.note_class) {
    return resolveInterestAmount(step.note_class, capital);
  }

  return 0;
}

function resolveInterestAmount(
  noteClass: NoteClass,
  capital: WaterfallCapitalStructure,
): number {
  switch (noteClass) {
    case 'CLASS_A': return capital.class_a_interest_due;
    case 'CLASS_B': return capital.class_b_interest_due ?? 0;
    case 'CLASS_C': return capital.class_c_interest_due ?? 0;
    case 'CLASS_D': return capital.class_d_interest_due ?? 0;
    default:        return 0;
  }
}

export function runWaterfallDiversion(input: WaterfallDiversionInput): DiversionLedger {
  const {
    payment_date, period_start, period_end,
    waterfall_steps, coverage_test_results,
    available_interest_proceeds, capital_structure,
  } = input;

  const testIndex = new Map<string, CoverageTestResult>(
    coverage_test_results.map(r => [r.test_id, r]),
  );

  const sortedSteps = [...waterfall_steps].sort((a, b) => a.step_number - b.step_number);

  let remaining      = available_interest_proceeds;
  let totalDiverted  = 0;
  let totalDistributed = 0;
  const entries: DiversionEntry[]   = [];
  const blockedStepIds = new Set<string>();

  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];

    if (blockedStepIds.has(step.step_id)) continue;
    if (step.step_type === 'REINVESTMENT') continue;

    if (step.step_type === 'FEE' || step.step_type === 'INTEREST_PAYMENT') {
      const amount = resolvePaymentAmount(step, capital_structure, remaining);
      const paid   = round2(Math.min(amount, remaining));
      remaining        = round2(remaining - paid);
      totalDistributed = round2(totalDistributed + paid);
      continue;
    }

    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      const { passed, failingTestId } = evaluateCondition(step.condition, testIndex);

      if (passed) {
        // Conditional payment (if step has a note class)
        if (step.note_class) {
          const amount = resolveInterestAmount(step.note_class, capital_structure);
          const paid   = round2(Math.min(amount, remaining));
          remaining        = round2(remaining - paid);
          totalDistributed = round2(totalDistributed + paid);
        }
      } else {
        const proceedsBefore  = remaining;
        const diversionAmount = remaining;
        remaining      = 0;
        totalDiverted  = round2(totalDiverted + diversionAmount);

        const target: DiversionTarget = step.diverts_to ?? {
          step_type:           'REINVESTMENT',
          note_class_priority: [],
          description:         'Principal reinvestment/cure',
        };

        entries.push({
          step_id:          step.step_id,
          step_number:      step.step_number,
          triggering_test:  failingTestId ?? step.condition?.test_type ?? 'UNKNOWN',
          test_result:      'FAIL',
          diversion_amount: round2(diversionAmount),
          diversion_target: target,
          cure_mechanism:   step.cure_mechanism ?? 'REINVESTMENT',
          proceeds_before:  round2(proceedsBefore),
          proceeds_after:   0,
          indenture_section: step.indenture_section,
        });

        // Block all downstream non-REINVESTMENT steps
        for (let j = i + 1; j < sortedSteps.length; j++) {
          if (sortedSteps[j].step_type !== 'REINVESTMENT') {
            blockedStepIds.add(sortedSteps[j].step_id);
          }
        }

        break;
      }
    }
  }

  return {
    payment_date,
    period_start,
    period_end,
    total_interest_proceeds: round2(available_interest_proceeds),
    total_diverted:          round2(totalDiverted),
    total_distributed:       round2(totalDistributed),
    entries,
    blocked_steps:           [...blockedStepIds],
  };
}

// ── Extraction validation ─────────────────────────────────────────────────────

export interface ExtractionValidationError {
  field:   string;
  message: string;
}

export function validateWaterfallSteps(steps: WaterfallStep[]): ExtractionValidationError[] {
  const errors: ExtractionValidationError[] = [];
  const VALID_STEP_TYPES = new Set([
    'FEE', 'INTEREST_PAYMENT', 'COVERAGE_TEST_CHECK', 'DIVERSION',
    'PRINCIPAL_PAYMENT', 'REINVESTMENT', 'EQUITY_DISTRIBUTION', 'RESERVE_ACCOUNT_FUNDING',
  ]);

  steps.forEach((step, i) => {
    const lbl = step.step_id || `step[${i}]`;

    if (!step.step_id)
      errors.push({ field: lbl, message: 'missing step_id' });
    if (typeof step.step_number !== 'number')
      errors.push({ field: lbl, message: 'step_number must be a number' });
    if (!VALID_STEP_TYPES.has(step.step_type))
      errors.push({ field: lbl, message: `unrecognised step_type "${step.step_type}"` });
    if (!step.label)
      errors.push({ field: lbl, message: 'missing label' });

    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      if (!step.condition)
        errors.push({ field: lbl, message: 'COVERAGE_TEST_CHECK step missing condition' });
      if (!step.diverts_to)
        errors.push({ field: lbl, message: 'COVERAGE_TEST_CHECK step missing diverts_to' });
    }
  });

  return errors;
}
