import type { TrusteeReport, InterestDistributionEntry, NoteBalanceEntry } from '../types/report';
import type { AllocationEntry } from '../types/waterfall';

function fmtM(amountM: number): string {
  const abs = Math.abs(amountM);
  const dollars = Math.round(abs * 1_000_000);
  const formatted = dollars.toLocaleString('en-US');
  return amountM < 0 ? `-$${formatted}` : `$${formatted}`;
}

function fmtPct(n: number, decimals = 2): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

function fmtRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function mdTableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function mdTableSep(widths: number[]): string {
  return `| ${widths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ')} |`;
}

function noteClassLabel(nc: string): string {
  return nc.replace('CLASS_', 'Class ');
}

function allocationStatus(e: AllocationEntry): string {
  if (e.blocked) return 'BLOCKED';
  if (e.step_type === 'EQUITY_DISTRIBUTION') return '✓ EQUITY';
  if (e.shortfall === 0) return '✓';
  if (e.step_type === 'COVERAGE_TEST_CHECK') return 'DIVERTED';
  return 'PARTIAL';
}

export class TrusteeReportRenderer {

  toMarkdown(r: TrusteeReport): string {
    const lines: string[] = [];
    const push = (...l: string[]) => lines.push(...l);

    // Header
    push(
      `# ${r.deal_name}`,
      `## Payment Date Report`,
      '',
      `**Payment Date:** ${r.payment_date}  `,
      `**Period:** ${r.period_start} — ${r.period_end}  `,
      `**Trustee:** ${r.trustee}  `,
      `**Collateral Manager:** ${r.collateral_manager}  `,
      `**CIK:** ${r.deal_cik}  `,
      `*Generated: ${r.generated_at} by ${r.generated_by}*`,
      '',
      '---',
      '',
    );

    // Section 1: Note Balance Statement
    push('## 1. Note Balance Statement', '');
    push(mdTableRow(['Note Class', 'Prior Balance', 'Principal Paid', 'Current Balance', 'Note Rate', 'Interest Paid']));
    push(mdTableSep([10, 15, 14, 16, 10, 13]));
    for (const e of r.note_balance_statement.entries) {
      const ppaid = e.principal_paid > 0 ? fmtM(e.principal_paid) : '—';
      push(mdTableRow([
        noteClassLabel(e.note_class),
        fmtM(e.balance_prior),
        ppaid,
        fmtM(e.balance_current),
        fmtRate(e.note_rate),
        fmtM(e.interest_paid),
      ]));
    }
    push('', '---', '');

    // Section 2: Coverage Test Summary
    push('## 2. Coverage Test Summary', '');
    push(mdTableRow(['Test', 'Section', 'Threshold', 'Actual', 'Cushion', 'Result']));
    push(mdTableSep([14, 14, 10, 8, 9, 9]));
    for (const e of r.coverage_test_summary.entries) {
      const result = e.result === 'PASS' ? '✓ PASS' : '✗ FAIL';
      push(mdTableRow([
        e.test_id,
        e.indenture_section || '—',
        `${e.threshold.toFixed(2)}%`,
        `${e.actual.toFixed(2)}%`,
        fmtPct(e.cushion),
        result,
      ]));
    }
    push('', '---', '');

    // Section 3: Concentration Limit Summary
    push('## 3. Concentration Limit Summary', '');
    push(mdTableRow(['Limit ID', 'Description', 'Max', 'Actual', 'Headroom', 'Result']));
    push(mdTableSep([20, 35, 7, 8, 10, 9]));
    for (const e of r.concentration_limit_summary.entries) {
      const result = e.result === 'PASS' ? '✓ PASS' : '✗ FAIL';
      push(mdTableRow([
        e.limit_id,
        e.description,
        `${e.max_pct.toFixed(2)}%`,
        `${e.actual_pct.toFixed(2)}%`,
        fmtPct(e.headroom),
        result,
      ]));
    }
    push('', '---', '');

    // Section 4: Waterfall Allocation
    push('## 4. Waterfall Allocation', '');
    push(`*Total interest proceeds: ${fmtM(r.waterfall_allocation_table.total_interest_proceeds)}  ·  Total principal proceeds: ${fmtM(r.waterfall_allocation_table.total_principal_proceeds)}  ·  Total allocated: ${fmtM(r.waterfall_allocation_table.total_allocated)}*`, '');
    push(mdTableRow(['Step', 'Beneficiary', 'Type', 'Due', 'Paid', 'Shortfall', 'Status']));
    push(mdTableSep([4, 26, 10, 14, 14, 14, 10]));
    for (const e of r.waterfall_allocation_table.entries) {
      const shortfallStr = e.shortfall > 0 ? fmtM(e.shortfall) : '—';
      push(mdTableRow([
        String(e.step_number),
        e.beneficiary || e.step_id,
        e.step_type,
        fmtM(e.amount_due),
        fmtM(e.amount_paid),
        shortfallStr,
        allocationStatus(e),
      ]));
    }
    push('', '---', '');

    // Section 5: Interest Distribution
    push('## 5. Interest Distribution', '');
    push(`*Period: ${r.interest_distribution.period_start} — ${r.interest_distribution.period_end}*`, '');
    push(mdTableRow(['Note Class', 'Days', 'Rate', 'Due', 'Paid', 'Shortfall', 'Blocked']));
    push(mdTableSep([10, 5, 8, 14, 14, 14, 8]));
    for (const e of r.interest_distribution.entries) {
      push(mdTableRow([
        noteClassLabel(e.note_class),
        String(e.days_accrued),
        fmtRate(e.accrual_rate),
        fmtM(e.interest_due),
        fmtM(e.interest_paid),
        e.shortfall > 0 ? fmtM(e.shortfall) : '—',
        e.blocked ? '✗' : '',
      ]));
    }
    push('', '---', '');

    // Section 6: Principal Distribution
    push('## 6. Principal Distribution', '');
    push(mdTableRow(['Note Class', 'Principal Paid', 'Redemption Type']));
    push(mdTableSep([10, 15, 17]));
    for (const e of r.principal_distribution.entries) {
      push(mdTableRow([
        noteClassLabel(e.note_class),
        e.principal_paid > 0 ? fmtM(e.principal_paid) : '—',
        e.redemption_type,
      ]));
    }
    push(``, `*Total principal distributed: ${fmtM(r.principal_distribution.total_principal_distributed)}*`);
    push('', '---', '');

    // Section 7: Portfolio Characteristics
    const pc = r.portfolio_characteristics;
    push('## 7. Portfolio Characteristics', '');
    push(`*As of ${pc.report_date}*`, '');
    push(mdTableRow(['Characteristic', 'Value']));
    push(mdTableSep([35, 18]));
    push(
      mdTableRow(['Loan Count',                            String(pc.loan_count)]),
      mdTableRow(['Total Par',                             fmtM(pc.total_par)]),
      mdTableRow(['Weighted Avg Spread (WAS)',             `${pc.weighted_avg_spread.toFixed(0)} bps`]),
      mdTableRow(['Weighted Avg Life (WAL)',               `${pc.weighted_avg_life.toFixed(2)} years`]),
      mdTableRow(['Weighted Avg Rating Factor (WARF)',     pc.weighted_avg_rating_factor.toLocaleString('en-US')]),
      mdTableRow(['Diversity Score',                       pc.diversity_score.toFixed(1)]),
      mdTableRow(['CCC / Below (%)',                       `${pc.ccc_pct.toFixed(2)}%`]),
      mdTableRow(['Floating Rate (%)',                     `${pc.floating_rate_pct.toFixed(2)}%`]),
      mdTableRow(['Top 10 Obligor Concentration',          `${pc.top_10_obligor_pct.toFixed(2)}%`]),
    );
    push('', '---', '');

    // Section 8: Diversion Summary
    push('## 8. Diversion Summary', '');
    if (r.diversion_summary) {
      push(`**Total diverted this period:** ${fmtM(r.diversion_summary.total_diverted)}`, '');
      push(mdTableRow(['Step', 'Triggering Test', 'Diversion Amount', 'Cure Mechanism']));
      push(mdTableSep([6, 20, 17, 16]));
      for (const d of r.diversion_summary.entries) {
        push(mdTableRow([
          String(d.step_number),
          d.triggering_test,
          fmtM(d.diversion_amount),
          d.cure_mechanism,
        ]));
      }
    } else {
      push('*No diversions this period.*');
    }
    push('', '---', '');

    // Section 9: Exception Register
    push('## 9. Exception Register', '');
    if (r.exception_register) {
      push(`*As of ${r.exception_register.as_of_date}*`, '');
      push(mdTableRow(['Exception ID', 'Type', 'Description', 'Section', 'Breach Depth', 'Diversion']));
      push(mdTableSep([28, 22, 52, 12, 12, 10]));
      for (const e of r.exception_register.entries) {
        push(mdTableRow([
          e.exception_id,
          e.exception_type,
          e.description,
          e.indenture_section || '—',
          `${e.breach_depth.toFixed(2)}%`,
          e.diversion_triggered ? fmtM(e.diversion_amount ?? 0) : '—',
        ]));
      }
    } else {
      push('*No exceptions this period.*');
    }

    // Section 10: Exception Narratives (populated by Phase 5B generator)
    if (r.exception_narratives && r.exception_narratives.length > 0) {
      push('', '---', '');
      push('## Exception Narratives', '');
      for (const n of r.exception_narratives) {
        const excEntry = r.exception_register?.entries.find(e => e.exception_id === n.exception_id);
        const label    = excEntry
          ? excEntry.description.split(' FAIL')[0].trim()
          : n.exception_id;
        push(`### ${n.exception_id} — ${label}`, '');
        push(n.narrative, '');
        push('*Generated by Barlow 5B. Controller review required before distribution.*');
        push('');
      }
    }

    push('');
    return lines.join('\n');
  }

  toJson(r: TrusteeReport): string {
    return JSON.stringify(r, null, 2);
  }
}
