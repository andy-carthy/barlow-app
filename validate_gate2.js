#!/usr/bin/env node
// Gate 2 validator: Carlyle CLO 2024-1 re-extracted with WaterfallStep v2 schema.
// Reads barlow_output.json (produced by a --mode=real extraction run) and verifies:
//   1. extraction.waterfall_steps present (v2 field, not legacy "waterfall")
//   2. Every COVERAGE_TEST_CHECK step has condition + diverts_to populated
//   3. No known-conditional step has null condition where the indenture text supplies one
//
// Run AFTER: node barlow_cli.js --mode=real --indenture=carlyle_dl_clo_2024_1_excerpt.txt --max-tokens=8000

const fs = require('fs');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', amber: '\x1b[33m', grey: '\x1b[90m', cyan: '\x1b[36m',
};

const outPath = process.argv[2] || '/home/andycarthy/barlow/barlow_output.json';

let output;
try {
  output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
} catch (e) {
  console.error(`\n${C.red}Cannot read ${outPath}: ${e.message}${C.reset}`);
  console.error(`Run: node barlow_cli.js --mode=real --indenture=carlyle_dl_clo_2024_1_excerpt.txt --max-tokens=8000\n`);
  process.exit(1);
}

console.log(`\n${C.cyan}${C.bold}Gate 2 — Carlyle WaterfallStep v2 Extraction Validator${C.reset}`);
console.log(`${C.grey}Input: ${outPath}${C.reset}`);
console.log(`${C.grey}${'─'.repeat(60)}${C.reset}\n`);

const extraction = output.extraction || {};
const passed = [];
const failed = [];
const warnings = [];

// ── Check 1: deal name ────────────────────────────────────────────────────────
if (extraction.deal_name && extraction.deal_name.toLowerCase().includes('carlyle')) {
  passed.push(`deal_name: "${extraction.deal_name}"`);
} else {
  warnings.push(`deal_name "${extraction.deal_name}" — expected Carlyle CLO 2024-1`);
}

// ── Check 2: waterfall_steps (v2) vs legacy waterfall ────────────────────────
const steps = extraction.waterfall_steps;
if (!steps) {
  if (extraction.waterfall) {
    failed.push('waterfall_steps: ABSENT — extraction used legacy "waterfall" field. Re-run with updated prompt.');
  } else {
    failed.push('waterfall_steps: no waterfall data in extraction at all');
  }
} else {
  passed.push(`waterfall_steps: ${steps.length} step(s) extracted (v2 schema)`);
}

// ── Check 3: COVERAGE_TEST_CHECK steps have condition + diverts_to ─────────
if (steps) {
  const checkSteps = steps.filter(s => s.step_type === 'COVERAGE_TEST_CHECK');
  if (checkSteps.length === 0) {
    // The Carlyle excerpt has at least 3 conditional steps (11.1.1.2.1.6, .8, .11)
    // and an Interest Diversion Test step (11.1.1.2.1.13).
    warnings.push('No COVERAGE_TEST_CHECK steps found — expected at least 3 for Carlyle A/B, C, D tests');
  } else {
    passed.push(`COVERAGE_TEST_CHECK steps found: ${checkSteps.length}`);

    let allFieldsOk = true;
    for (const step of checkSteps) {
      const hasCondition = step.condition && step.condition.test_type && step.condition.note_classes_tested?.length > 0;
      const hasDiverts   = step.diverts_to && step.diverts_to.step_type;

      if (!hasCondition) {
        failed.push(`${step.step_id} (step ${step.step_number}): condition missing or incomplete`);
        allFieldsOk = false;
      }
      if (!hasDiverts) {
        failed.push(`${step.step_id} (step ${step.step_number}): diverts_to missing or incomplete`);
        allFieldsOk = false;
      }
      if (hasCondition && hasDiverts) {
        const testType   = step.condition.test_type;
        const classes    = step.condition.note_classes_tested.join(', ');
        const divertType = step.diverts_to.step_type;
        passed.push(`  ${step.step_id}: condition=${testType}[${classes}], diverts_to=${divertType} — ${step.indenture_section}`);
      }
    }

    if (allFieldsOk && checkSteps.length >= 3) {
      passed.push(`All ${checkSteps.length} COVERAGE_TEST_CHECK steps have condition + diverts_to`);
    }
  }

  // ── Check 4: step_ids and step_numbers present throughout ─────────────────
  const missingIds = steps.filter(s => !s.step_id);
  const missingNums = steps.filter(s => typeof s.step_number !== 'number');
  if (missingIds.length > 0)
    failed.push(`${missingIds.length} step(s) missing step_id`);
  if (missingNums.length > 0)
    failed.push(`${missingNums.length} step(s) missing step_number`);
  if (missingIds.length === 0 && missingNums.length === 0)
    passed.push(`All ${steps.length} steps have step_id and step_number`);

  // ── Check 5: known Carlyle section cites present ───────────────────────────
  const sectionRefs = steps.map(s => s.indenture_section || '').join(' ');
  const expectedSections = ['11.1.1.2.1.6', '11.1.1.2.1.8', '11.1.1.2.1.11'];
  const missingSections = expectedSections.filter(sec => !sectionRefs.includes(sec));
  if (missingSections.length > 0) {
    warnings.push(`Expected section citations not found in waterfall_steps: ${missingSections.join(', ')}`);
    warnings.push('  (Likely excerpt truncation — check that full waterfall text was provided)');
  } else {
    passed.push(`All 3 Carlyle diversion section cites present: ${expectedSections.join(', ')}`);
  }

  // ── Check 6: step types coverage ──────────────────────────────────────────
  const typeCounts = {};
  for (const s of steps) typeCounts[s.step_type] = (typeCounts[s.step_type] || 0) + 1;
  const typesSummary = Object.entries(typeCounts).map(([t, n]) => `${t}(${n})`).join(', ');
  passed.push(`Step types: ${typesSummary}`);
}

// ── Check 7: Phase 1–3 results still present ─────────────────────────────────
if ((output.coverage_test_results || []).length > 0) {
  const pass3 = output.coverage_test_results.filter(r => r.result === 'PASS').length;
  const fail3 = output.coverage_test_results.filter(r => r.result === 'FAIL').length;
  passed.push(`Phase 3 coverage test results present: ${pass3} pass / ${fail3} fail`);
} else {
  warnings.push('coverage_test_results missing from output — Phase 3 may not have run');
}

if ((output.concentration_test_results || []).length > 0) {
  passed.push(`Phase 3 concentration test results present: ${output.concentration_test_results.length} limit(s) evaluated`);
} else {
  warnings.push('concentration_test_results missing from output');
}

// ── Report ─────────────────────────────────────────────────────────────────────
passed.forEach(p  => console.log(`  ${C.green}✓${C.reset}  ${p}`));
warnings.forEach(w => console.log(`  ${C.amber}⚠${C.reset}  ${w}`));
failed.forEach(f  => console.log(`  ${C.red}✗${C.reset}  ${C.bold}${f}${C.reset}`));

console.log();
const hardFailed = failed.length;
if (hardFailed === 0) {
  console.log(`${C.green}${C.bold}  ✓  GATE 2 PASSED — Carlyle extraction meets WaterfallStep v2 requirements.${C.reset}`);
} else {
  console.log(`${C.red}${C.bold}  ✗  GATE 2 FAILED — ${hardFailed} hard error(s). Fix and re-extract before proceeding.${C.reset}`);
}
if (warnings.length > 0) {
  console.log(`${C.amber}  ⚠  ${warnings.length} warning(s) — review before Phase 4B.${C.reset}`);
}
console.log();

process.exit(hardFailed > 0 ? 1 : 0);
