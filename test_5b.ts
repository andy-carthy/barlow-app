#!/usr/bin/env tsx
// Phase 5B completion gate — generates exception narratives for scenarios with
// exceptions and validates structural properties.
// Requires ANTHROPIC_API_KEY.  Run: npx tsx test_5b.ts

import Anthropic from '@anthropic-ai/sdk';
import { runWaterfall }                from './barlow-app/src/engines/waterfall_engine';
import { TrusteeReportAssembler }      from './barlow-app/src/assemblers/trustee_report_assembler';
import { TrusteeReportRenderer }       from './barlow-app/src/renderers/trustee_report_renderer';
import { ExceptionNarrativeGenerator } from './barlow-app/src/generators/exception_narrative_generator';
import { REPORT_SCENARIOS_5A }         from './barlow-app/src/fixtures/synthetic_reports/scenarios_5a';
import type { ExtractionOutput }       from './barlow-app/src/types/extraction_output';
import type { TrusteeReport }          from './barlow-app/src/types/report';

// ── API key guard ─────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('\n  ANTHROPIC_API_KEY not set — Phase 5B test requires Claude API access.\n');
  process.exit(1);
}

// ── Extraction stub — includes actual indenture rules so narratives have
//    real source text to cite. Mirrors the synthetic indenture in barlow_cli.js.

const STUB_EXTRACTION: ExtractionOutput = {
  deal_name:       'Barlow Capital CLO I',
  extraction_date: '2025-01-15',
  coverage_tests: [
    {
      test_id:           'OC_CLASS_AB',
      test_type:         'overcollateralization',
      description:       'Class A/B Overcollateralization Test: Adjusted Collateral Principal Amount divided by the aggregate outstanding principal balance of the Class A Notes and Class B Notes.',
      numerator:         'Adjusted Collateral Principal Amount',
      denominator:       'Sum of outstanding principal balance of Class A Notes and Class B Notes',
      threshold_pct:     123.50,
      failure_action:    'Redirect Interest Proceeds to principal reinvestment account per Section 11.3 until the Class A/B OC Threshold is restored.',
      source_clause:     '§11.1(a)',
      confidence:        'HIGH',
      confidence_reason: 'Threshold and cure explicitly stated in indenture.',
    },
    {
      test_id:           'OC_CLASS_C',
      test_type:         'overcollateralization',
      description:       'Class C Overcollateralization Test: Adjusted Collateral Principal Amount divided by the aggregate outstanding principal balance of the Class A, B and C Notes.',
      numerator:         'Adjusted Collateral Principal Amount',
      denominator:       'Sum of outstanding principal balance of Class A, B, and C Notes',
      threshold_pct:     112.75,
      failure_action:    'Interest proceeds shall be diverted as set forth in Section 13.1(c).',
      source_clause:     '§11.1(b)',
      confidence:        'HIGH',
      confidence_reason: 'Threshold and cure explicitly stated in indenture.',
    },
    {
      test_id:           'IC_CLASS_AB',
      test_type:         'interest_coverage',
      description:       'Class A/B Interest Coverage Test: Interest Proceeds divided by the sum of accrued interest on Class A Notes, Class B Notes, and the Senior Management Fee.',
      numerator:         'Interest Proceeds received during the related Interest Accrual Period',
      denominator:       'Accrued interest on Class A Notes + Class B Notes + Senior Management Fee',
      threshold_pct:     120.00,
      failure_action:    'Redirect Interest Proceeds as specified in Section 13.1(b).',
      source_clause:     '§11.2(a)',
      confidence:        'HIGH',
      confidence_reason: 'Threshold and cure explicitly stated in indenture.',
    },
  ],
  concentration_limits: [
    {
      limit_id:           'SINGLE_OBLIGOR_3PCT',
      description:        'Maximum single-obligor concentration',
      dimension:          'obligor',
      max_pct:            3.0,
      calculation_basis:  'Percentage of Adjusted Collateral Principal Amount',
      source_clause:      '§12.2(a)',
      confidence:         'HIGH',
      confidence_reason:  'Explicit limit in indenture.',
    },
    {
      limit_id:           'SINGLE_INDUSTRY_15PCT',
      description:        'Single Moody\'s Industry Classification Group concentration',
      dimension:          'industry',
      max_pct:            15.0,
      calculation_basis:  'Percentage of Adjusted Collateral Principal Amount',
      source_clause:      '§12.2(b)',
      confidence:         'HIGH',
      confidence_reason:  'Explicit limit in indenture.',
    },
    {
      limit_id:           'CCC_BUCKET_7PCT',
      description:        'CCC/Caa-rated or below bucket',
      dimension:          'rating_bucket',
      max_pct:            7.5,
      calculation_basis:  'Percentage of Adjusted Collateral Principal Amount (Defaulted Obligations treated as CCC/Caa-rated)',
      source_clause:      '§12.2(c)',
      confidence:         'HIGH',
      confidence_reason:  'Explicit limit in indenture.',
    },
    {
      limit_id:           'DIP_LOAN_5PCT',
      description:        'Debtor-in-possession loans',
      dimension:          'loan_type',
      max_pct:            5.0,
      calculation_basis:  'Percentage of Adjusted Collateral Principal Amount',
      source_clause:      '§12.2(d)',
      confidence:         'HIGH',
      confidence_reason:  'Explicit limit in indenture.',
    },
  ],
  waterfall_steps:    [],
  extraction_summary: {
    tests_found: 3, limits_found: 4, waterfall_steps_found: 0,
    overall_confidence: 'HIGH', flags: [],
  },
};

// ── Narrative assertion helpers ───────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface NarrativeScenario {
  exceptionId:       string;
  indentureSections: RegExp;   // must match at least one section reference
  breachFigures:     number[]; // at least one must appear in the narrative
  permittedDecimals: number[]; // all decimal figures must be in this set
}

const DISCLAIMER_RE = /Controller review required before distribution/i;

// ── Scenario narrative specs ──────────────────────────────────────────────────

const SCENARIOS_5B: {
  scenarioIndex: number;
  expectedNarrativeCount: number;
  checks: NarrativeScenario[];
}[] = [
  {
    scenarioIndex: 0,          // SYN_5A_01 — no exceptions
    expectedNarrativeCount: 0,
    checks: [],
  },
  {
    scenarioIndex: 1,          // SYN_5A_02 — OC breach
    expectedNarrativeCount: 2,
    checks: [
      {
        exceptionId:       'EXC_2025Q1_OC_CLASS_AB',
        indentureSections: /§11\.1|Section 11\.1/i,
        breachFigures:     [114.58, 123.50, 8.92],
        permittedDecimals: [114.58, 123.50, 8.92, 7.00],
      },
      {
        exceptionId:       'EXC_2025Q1_OC_CLASS_C',
        indentureSections: /§11\.1|Section 11\.1/i,
        breachFigures:     [98.21, 112.75, 14.54],
        permittedDecimals: [98.21, 112.75, 14.54],
      },
    ],
  },
  {
    scenarioIndex: 2,          // SYN_5A_03 — concentration failures
    expectedNarrativeCount: 2,
    checks: [
      {
        exceptionId:       'EXC_2025Q1_SINGLE_OBLIGOR_3PCT',
        indentureSections: /§12\.2|Section 12\.2/i,
        breachFigures:     [4.02, 3.0, 1.02],
        permittedDecimals: [4.02, 3.0, 1.02],
      },
      {
        exceptionId:       'EXC_2025Q1_CCC_BUCKET_7PCT',
        indentureSections: /§12\.2|Section 12\.2/i,
        breachFigures:     [12.76, 7.5, 5.26],
        permittedDecimals: [12.76, 7.5, 5.26],
      },
    ],
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', grey: '\x1b[90m', cyan: '\x1b[36m', amber: '\x1b[33m',
};

console.log(`\n${C.cyan}${C.bold}Barlow Phase 5B — Exception Narrative Test Suite${C.reset}`);
console.log(`${C.grey}${'─'.repeat(60)}${C.reset}\n`);

const client    = new Anthropic({ apiKey });
const assembler = new TrusteeReportAssembler();
const renderer  = new TrusteeReportRenderer();
const generator = new ExceptionNarrativeGenerator(client);

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`      ${C.green}✓${C.reset}  ${label}`);
  } else {
    console.log(`      ${C.red}✗${C.reset}  ${label}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

async function runScenario(spec: typeof SCENARIOS_5B[0]): Promise<void> {
  const scenario = REPORT_SCENARIOS_5A[spec.scenarioIndex];
  const ledger   = runWaterfall(scenario.waterfallInput);
  const report   = assembler.assemble(
    STUB_EXTRACTION, [], scenario.coverageTestResults, scenario.concentrationTestResults,
    ledger, scenario.noteBalances, scenario.reportMeta,
  );

  console.log(`  ${C.bold}${scenario.id}${C.reset}  ${C.grey}${scenario.description}${C.reset}`);

  const narratives = await generator.generateNarratives(report, STUB_EXTRACTION);

  // ── Gate 1: count ───────────────────────────────────────────────────────────
  check(
    `narrative count = ${spec.expectedNarrativeCount}`,
    narratives.length === spec.expectedNarrativeCount,
    `got ${narratives.length}`,
  );

  if (narratives.length === 0) {
    // Gate 2: no Exception Narratives section in Markdown when empty
    const md = renderer.toMarkdown(report);
    check(
      'Markdown omits Exception Narratives section when none generated',
      !md.includes('## Exception Narratives'),
    );
    passed++;
    console.log();
    return;
  }

  // Attach narratives to the report for renderer check
  report.exception_narratives = narratives;
  const md = renderer.toMarkdown(report);

  // ── Gate 2: Markdown section present ────────────────────────────────────────
  check('Markdown includes ## Exception Narratives', md.includes('## Exception Narratives'));

  for (const spec_n of spec.checks) {
    const n = narratives.find(n => n.exception_id === spec_n.exceptionId);
    console.log(`\n      ${C.grey}Narrative: ${spec_n.exceptionId}${C.reset}`);

    if (!n) {
      check(`narrative found for ${spec_n.exceptionId}`, false, 'not in output');
      failed++;
      continue;
    }

    const text  = n.narrative;
    const wc    = wordCount(text);

    // Gate 3: word count
    check(`≤ 150 words (got ${wc})`, wc <= 150);

    // Gate 4: indenture section cited
    check(
      `cites indenture section (${spec_n.indentureSections})`,
      spec_n.indentureSections.test(text),
      text.slice(0, 80) + '…',
    );

    // Gate 5: at least one breach figure present (prompt injects .toFixed(2) form)
    const hasFigure = spec_n.breachFigures.some(f => {
      const s = f.toFixed(2);
      return text.includes(s) || text.includes(f.toString());
    });
    check(
      `contains a breach figure [${spec_n.breachFigures.map(f => f.toFixed(2)).join('/')}]`,
      hasFigure,
    );

    // Gate 6: no decimal hallucinations
    const decimals = (text.match(/\d+\.\d+/g) ?? []).map(Number);
    const hallucinations = decimals.filter(
      d => !spec_n.permittedDecimals.some(p => Math.abs(p - d) < 0.015),
    );
    check(
      `no decimal hallucinations (${decimals.length} decimals found)`,
      hallucinations.length === 0,
      hallucinations.length > 0 ? `unexpected figures: ${hallucinations.join(', ')}` : '',
    );

    // Gate 7: narrative does NOT already contain the disclaimer (renderer adds it)
    check(
      'narrative text does not pre-include disclaimer',
      !DISCLAIMER_RE.test(text),
    );

    // Gate 8: renderer adds disclaimer to Markdown
    check(
      'Markdown contains disclaimer for this exception',
      md.includes('Controller review required before distribution'),
    );

    // Gate 9: generated_by and prompt_version fields
    check('generated_by = BARLOW_5B', n.generated_by === 'BARLOW_5B');
    check('prompt_version present', !!n.prompt_version);
  }

  passed++;
  console.log();
}

(async () => {
  try {
    for (const spec of SCENARIOS_5B) {
      await runScenario(spec);
    }

    // ── Run all prior gates to confirm no regressions ─────────────────────────
    console.log(`${C.grey}Prior gates (regression check)...${C.reset}`);
    const { execSync } = await import('child_process');
    try {
      execSync('node test_4a.js', { stdio: 'pipe' });
      execSync('node test_4b.js', { stdio: 'pipe' });
      execSync('npx tsx test_5a.ts', { stdio: 'pipe' });
      console.log(`  ${C.green}✓${C.reset}  4A + 4B + 5A gates all pass\n`);
    } catch {
      console.log(`  ${C.red}✗${C.reset}  Prior gate regression detected — check 4A/4B/5A\n`);
      failed++;
    }

    if (failed === 0) {
      console.log(`${C.green}${C.bold}  ✓  Phase 5B gate met — ${passed} scenario(s) passed.${C.reset}`);
    } else {
      console.log(`${C.red}${C.bold}  ✗  ${failed} assertion(s) failed. Fix before proceeding.${C.reset}`);
    }
    console.log();
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.error(`\n${C.red}Fatal: ${(e as Error).message}${C.reset}\n`);
    process.exit(1);
  }
})();
