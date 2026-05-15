import type { ExtractionOutput } from '../types/extraction_output';
import type { LoanPosition } from '../types/loan';
import type { NoteClass, NoteBalanceSnapshot, WaterfallAllocationLedger } from '../types/waterfall';
import type { CoverageTestResult } from '../engines/waterfall_engine';
import type {
  ReportMeta, TrusteeReport, ConcentrationTestResult,
  NoteBalanceEntry, CoverageTestEntry, ConcentrationLimitEntry,
  InterestDistributionEntry, PrincipalDistributionEntry,
  ExceptionEntry, DiversionSummary, ExceptionRegister,
} from '../types/report';
import { computePortfolioCharacteristics } from '../calculators/portfolio_stats';

function r2(n: number): number { return Math.round(n * 100) / 100; }

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

// Derive NoteClass[] from test_id suffix, following CLO senior-stack convention.
// OC_CLASS_AB or IC_CLASS_AB → [CLASS_A, CLASS_B]
// OC_CLASS_C → [CLASS_A, CLASS_B, CLASS_C], etc.
function noteClassesFromTestId(testId: string): NoteClass[] {
  const upper = testId.toUpperCase();
  if (upper.includes('_AB')) return ['CLASS_A', 'CLASS_B'];
  if (upper.includes('_C'))  return ['CLASS_A', 'CLASS_B', 'CLASS_C'];
  if (upper.includes('_D'))  return ['CLASS_A', 'CLASS_B', 'CLASS_C', 'CLASS_D'];
  if (upper.includes('_E'))  return ['CLASS_A', 'CLASS_B', 'CLASS_C', 'CLASS_D', 'CLASS_E'];
  if (upper.includes('_A'))  return ['CLASS_A'];
  return [];
}

// Quarter tag for exception IDs, e.g. "2025Q1".
function quarterTag(date: string): string {
  const d = new Date(date);
  return `${d.getFullYear()}Q${Math.ceil((d.getMonth() + 1) / 3)}`;
}

export class TrusteeReportAssembler {
  assemble(
    extractionOutput:        ExtractionOutput,
    loanTape:                LoanPosition[],
    coverageTestResults:     CoverageTestResult[],
    concentrationTestResults: ConcentrationTestResult[],
    waterfallLedger:         WaterfallAllocationLedger,
    noteBalances:            NoteBalanceSnapshot,
    reportMeta:              ReportMeta,
  ): TrusteeReport {
    const { payment_date, period_start, period_end } = reportMeta;
    const collections = waterfallLedger.collections;
    const days = daysBetween(collections.period_start, collections.period_end);

    // ── Note Balance Statement ────────────────────────────────────────────────
    const noteClasses: Array<[NoteClass, string]> = [
      ['CLASS_A', 'class_a'], ['CLASS_B', 'class_b'],
      ['CLASS_C', 'class_c'], ['CLASS_D', 'class_d'], ['CLASS_E', 'class_e'],
    ];

    const principalPaidByClass: Partial<Record<NoteClass, number>> = {};
    for (const entry of waterfallLedger.entries) {
      if (entry.step_type === 'PRINCIPAL_PAYMENT' && entry.note_class) {
        principalPaidByClass[entry.note_class] =
          (principalPaidByClass[entry.note_class] ?? 0) + entry.amount_paid;
      }
    }

    const interestPaidByClass: Partial<Record<NoteClass, number>> = {};
    for (const entry of waterfallLedger.entries) {
      if ((entry.step_type === 'INTEREST_PAYMENT' || entry.step_type === 'COVERAGE_TEST_CHECK')
          && entry.note_class) {
        interestPaidByClass[entry.note_class] =
          (interestPaidByClass[entry.note_class] ?? 0) + entry.amount_paid;
      }
    }

    const nbEntries: NoteBalanceEntry[] = [];
    for (const [nc, key] of noteClasses) {
      const bal = (noteBalances as any)[key];
      if (!bal) continue;
      const principalPaid = r2(principalPaidByClass[nc] ?? 0);
      const annualRate = days > 0
        ? bal.accrued_interest / bal.outstanding_balance / (days / 365)
        : 0;
      nbEntries.push({
        note_class:      nc,
        balance_prior:   bal.outstanding_balance,
        principal_paid:  principalPaid,
        balance_current: r2(bal.outstanding_balance - principalPaid),
        note_rate:       r2(annualRate * 10000) / 10000,  // 4 decimal places
        interest_paid:   r2(interestPaidByClass[nc] ?? 0),
      });
    }

    // ── Coverage Test Summary ─────────────────────────────────────────────────
    const ctEntries: CoverageTestEntry[] = coverageTestResults.map(r => ({
      test_id:           r.test_id,
      test_type:         r.test_type === 'overcollateralization' ? 'OC' : 'IC',
      note_classes:      noteClassesFromTestId(r.test_id),
      threshold:         r.threshold_pct,
      actual:            r.calculated_pct,
      result:            r.result,
      indenture_section: (r as any).source_clause ?? '',
      cushion:           r2(r.calculated_pct - r.threshold_pct),
    }));

    // ── Concentration Limit Summary ───────────────────────────────────────────
    const clEntries: ConcentrationLimitEntry[] = concentrationTestResults.map(r => ({
      limit_id:          r.limit_id,
      description:       r.description,
      applies_to:        r.limit_id,
      max_pct:           r.max_pct,
      actual_pct:        r.actual_pct,
      result:            r.result,
      indenture_section: r.source_clause ?? '',
      headroom:          r2(r.max_pct - r.actual_pct),
    }));

    // ── Waterfall Allocation Table ────────────────────────────────────────────
    const waterfallTable = {
      entries:                  waterfallLedger.entries,
      total_interest_proceeds:  r2(collections.total_interest_proceeds + collections.hedge_receipts),
      total_principal_proceeds: collections.total_principal_proceeds,
      total_allocated:          waterfallLedger.total_allocated,
    };

    // ── Interest Distribution ─────────────────────────────────────────────────
    const idEntries: InterestDistributionEntry[] = nbEntries.map(nb => {
      const balanceSnapshot = (noteBalances as any)[nb.note_class.toLowerCase().replace('_', '')] as any ?? { accrued_interest: 0, outstanding_balance: 1 };
      return {
        note_class:    nb.note_class,
        days_accrued:  Math.round(days),
        accrual_rate:  nb.note_rate,
        interest_due:  balanceSnapshot.accrued_interest + (balanceSnapshot.deferred_interest ?? 0),
        interest_paid: nb.interest_paid,
        shortfall:     r2(Math.max(0, (balanceSnapshot.accrued_interest ?? 0) - nb.interest_paid)),
        blocked:       waterfallLedger.entries.some(
          e => e.note_class === nb.note_class && e.blocked,
        ),
      };
    });

    // ── Principal Distribution ────────────────────────────────────────────────
    const pdEntries: PrincipalDistributionEntry[] = nbEntries.map(nb => {
      const paid = r2(principalPaidByClass[nb.note_class] ?? 0);
      let redemptionType: PrincipalDistributionEntry['redemption_type'] = 'NONE';
      if (paid > 0) {
        // Check if any diversion triggered a cure for this class
        const hasCure = waterfallLedger.diversions.some(d =>
          d.cure_mechanism === 'REINVESTMENT' || d.cure_mechanism === 'REDEMPTION',
        );
        redemptionType = hasCure ? 'OC_CURE' : 'SCHEDULED';
      }
      return { note_class: nb.note_class, principal_paid: paid, redemption_type: redemptionType };
    });

    const totalPrincipalDistributed = r2(
      pdEntries.reduce((s, e) => s + e.principal_paid, 0),
    );

    // ── Portfolio Characteristics ─────────────────────────────────────────────
    const portfolioChars = computePortfolioCharacteristics(loanTape, payment_date);

    // ── Diversion Summary ─────────────────────────────────────────────────────
    const totalDiverted = r2(
      waterfallLedger.diversions.reduce((s, d) => s + d.diversion_amount, 0),
    );
    const diversionSummary: DiversionSummary | null =
      waterfallLedger.diversions.length > 0
        ? { total_diverted: totalDiverted, entries: waterfallLedger.diversions }
        : null;

    // ── Exception Register ────────────────────────────────────────────────────
    const excEntries: ExceptionEntry[] = [];
    const qtag = quarterTag(payment_date);

    for (const ct of coverageTestResults) {
      if (ct.result !== 'FAIL') continue;
      const testType = ct.test_type === 'overcollateralization' ? 'OC_BREACH' : 'IC_BREACH';
      const breachDepth = r2(ct.threshold_pct - ct.calculated_pct);
      const linked = waterfallLedger.diversions.find(d => d.triggering_test === ct.test_id);
      excEntries.push({
        exception_id:        `EXC_${qtag}_${ct.test_id}`,
        exception_type:      testType as any,
        description:         `${ct.test_id} ${testType === 'OC_BREACH' ? 'Overcollateralization' : 'Interest Coverage'} Test FAIL: ${ct.calculated_pct}% vs ${ct.threshold_pct}% threshold (breach depth ${breachDepth}%)`,
        indenture_section:   (ct as any).source_clause ?? '',
        breach_depth:        breachDepth,
        diversion_triggered: !!linked,
        diversion_amount:    linked ? linked.diversion_amount : null,
      });
    }

    for (const cl of concentrationTestResults) {
      if (cl.result !== 'FAIL') continue;
      const breachDepth = r2(cl.actual_pct - cl.max_pct);
      excEntries.push({
        exception_id:        `EXC_${qtag}_${cl.limit_id}`,
        exception_type:      'CONCENTRATION_BREACH',
        description:         `${cl.description} FAIL: ${cl.actual_pct}% vs ${cl.max_pct}% limit (excess ${breachDepth}%)`,
        indenture_section:   cl.source_clause ?? '',
        breach_depth:        breachDepth,
        diversion_triggered: false,
        diversion_amount:    null,
      });
    }

    const exceptionRegister: ExceptionRegister | null =
      excEntries.length > 0
        ? { as_of_date: payment_date, entries: excEntries }
        : null;

    return {
      report_type:         'PAYMENT_DATE_REPORT',
      deal_name:           extractionOutput.deal_name,
      deal_cik:            reportMeta.deal_cik ?? 'N/A',
      payment_date,
      period_start:        collections.period_start,
      period_end:          collections.period_end,
      trustee:             reportMeta.trustee,
      collateral_manager:  reportMeta.collateral_manager,
      generated_at:        new Date().toISOString(),
      generated_by:        'BARLOW_5A',

      note_balance_statement:      { entries: nbEntries },
      coverage_test_summary:       { entries: ctEntries },
      concentration_limit_summary: { entries: clEntries },
      waterfall_allocation_table:  waterfallTable,
      interest_distribution:       { period_start: collections.period_start, period_end: collections.period_end, entries: idEntries },
      principal_distribution:      { entries: pdEntries, total_principal_distributed: totalPrincipalDistributed },
      portfolio_characteristics:   portfolioChars,
      diversion_summary:           diversionSummary,
      exception_register:          exceptionRegister,
      exception_narratives:        null,
    };
  }
}
