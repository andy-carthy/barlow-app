#!/usr/bin/env tsx
// Phase 5A completion gate — assembles a TrusteeReport for each of the 3
// report scenarios and validates the report structure, counts, and renderer output.
// Run: npx tsx test_5a.ts

import { runWaterfall }          from './barlow-app/src/engines/waterfall_engine';
import { TrusteeReportAssembler } from './barlow-app/src/assemblers/trustee_report_assembler';
import { TrusteeReportRenderer }  from './barlow-app/src/renderers/trustee_report_renderer';
import { REPORT_SCENARIOS_5A }    from './barlow-app/src/fixtures/synthetic_reports/scenarios_5a';
import type { ExtractionOutput }  from './barlow-app/src/types/extraction_output';
import type { TrusteeReport }     from './barlow-app/src/types/report';

// ── Shared stubs ──────────────────────────────────────────────────────────────

const STUB_EXTRACTION: ExtractionOutput = {
  deal_name:            'Barlow Capital CLO I',
  extraction_date:      '2025-01-15',
  coverage_tests:       [],
  concentration_limits: [],
  waterfall_steps:      [],
  extraction_summary:   {
    tests_found: 0, limits_found: 0, waterfall_steps_found: 0,
    overall_confidence: 'HIGH', flags: [],
  },
};

// ── Validator ─────────────────────────────────────────────────────────────────

function r2(n: number): number { return Math.round(n * 100) / 100; }

interface CheckResult { passed: boolean; errors: string[] }

function validateReport(report: TrusteeReport, expected: (typeof REPORT_SCENARIOS_5A)[0]['expected']): CheckResult {
  const errors: string[] = [];
  const eq = (label: string, a: unknown, e: unknown) => {
    if (a !== e) errors.push(`${label}: expected ${e}, got ${a}`);
  };

  // Note Balance Statement
  eq('note_balance_entry_count',
    report.note_balance_statement.entries.length,
    expected.note_balance_entry_count);

  // Coverage Test Summary
  const cvPass = report.coverage_test_summary.entries.filter(e => e.result === 'PASS').length;
  const cvFail = report.coverage_test_summary.entries.filter(e => e.result === 'FAIL').length;
  eq('coverage_pass_count', cvPass, expected.coverage_pass_count);
  eq('coverage_fail_count', cvFail, expected.coverage_fail_count);

  // Concentration Limit Summary
  const clFail = report.concentration_limit_summary.entries.filter(e => e.result === 'FAIL').length;
  eq('concentration_fail_count', clFail, expected.concentration_fail_count);

  // Waterfall total
  eq('waterfall_total_allocated',
    r2(report.waterfall_allocation_table.total_allocated),
    r2(expected.waterfall_total_allocated));

  // Diversion Summary presence
  const hasDivSummary = report.diversion_summary !== null;
  eq('has_diversion_summary', hasDivSummary, expected.has_diversion_summary);

  // Exception Register presence
  const hasExcRegister = report.exception_register !== null;
  eq('has_exception_register', hasExcRegister, expected.has_exception_register);

  // Exception count (if expected)
  if (expected.exception_count !== undefined) {
    eq('exception_count',
      report.exception_register?.entries.length ?? 0,
      expected.exception_count);
  }

  // Static fields
  eq('report_type',  report.report_type,  'PAYMENT_DATE_REPORT');
  eq('generated_by', report.generated_by, 'BARLOW_5A');
  eq('deal_name',    report.deal_name,    STUB_EXTRACTION.deal_name);

  return { passed: errors.length === 0, errors };
}

function validateMarkdown(md: string, scenarioId: string): CheckResult {
  const errors: string[] = [];
  const mustContain = [
    '## 1. Note Balance Statement',
    '## 2. Coverage Test Summary',
    '## 3. Concentration Limit Summary',
    '## 4. Waterfall Allocation',
    '## 5. Interest Distribution',
    '## 6. Principal Distribution',
    '## 7. Portfolio Characteristics',
    '## 8. Diversion Summary',
    '## 9. Exception Register',
    'Barlow Capital CLO I',
    '**Payment Date:**',
    '**Trustee:**',
  ];
  for (const phrase of mustContain) {
    if (!md.includes(phrase))
      errors.push(`Markdown missing: "${phrase}"`);
  }
  if (md.length < 1000)
    errors.push(`Markdown suspiciously short (${md.length} chars)`);
  return { passed: errors.length === 0, errors };
}

function validateJson(json: string): CheckResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    errors.push(`JSON.parse failed: ${e}`);
    return { passed: false, errors };
  }
  const r = parsed as Record<string, unknown>;
  for (const key of ['report_type', 'deal_name', 'payment_date', 'note_balance_statement', 'coverage_test_summary']) {
    if (!(key in r)) errors.push(`JSON missing key: ${key}`);
  }
  if (r.report_type !== 'PAYMENT_DATE_REPORT')
    errors.push(`JSON report_type: expected PAYMENT_DATE_REPORT, got ${r.report_type}`);
  return { passed: errors.length === 0, errors };
}

// ── Runner ────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', grey: '\x1b[90m', cyan: '\x1b[36m',
};

console.log(`\n${C.cyan}${C.bold}Barlow Phase 5A — Trustee Report Assembly Test Suite${C.reset}`);
console.log(`${C.grey}${'─'.repeat(60)}${C.reset}\n`);

const assembler = new TrusteeReportAssembler();
const renderer  = new TrusteeReportRenderer();

let passed = 0;
let failed = 0;

for (const scenario of REPORT_SCENARIOS_5A) {
  const ledger = runWaterfall(scenario.waterfallInput);

  const report = assembler.assemble(
    STUB_EXTRACTION,
    [],                                   // empty loan tape → zeroed portfolio stats
    scenario.coverageTestResults,
    scenario.concentrationTestResults,
    ledger,
    scenario.noteBalances,
    scenario.reportMeta,
  );

  const rptCheck = validateReport(report, scenario.expected);
  const md       = renderer.toMarkdown(report);
  const mdCheck  = validateMarkdown(md, scenario.id);
  const jsonStr  = renderer.toJson(report);
  const jsonCheck = validateJson(jsonStr);

  const allErrors = [...rptCheck.errors, ...mdCheck.errors, ...jsonCheck.errors];
  const ok = allErrors.length === 0;

  if (ok) {
    console.log(`  ${C.green}✓${C.reset}  ${C.bold}${scenario.id}${C.reset}  ${C.grey}${scenario.description}${C.reset}`);
    passed++;
  } else {
    console.log(`  ${C.red}✗${C.reset}  ${C.bold}${scenario.id}${C.reset}  ${scenario.description}`);
    allErrors.forEach(e => console.log(`      ${C.red}${e}${C.reset}`));
    failed++;
  }
}

console.log();
const total = passed + failed;
if (failed === 0) {
  console.log(`${C.green}${C.bold}  ✓  ${passed}/${total} scenarios passed — 5A trustee report gate met.${C.reset}`);
} else {
  console.log(`${C.red}${C.bold}  ✗  ${passed}/${total} passed — ${failed} failure(s). Fix before proceeding.${C.reset}`);
}
console.log();

process.exit(failed > 0 ? 1 : 0);
