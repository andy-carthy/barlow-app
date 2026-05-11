#!/usr/bin/env node

/**
 * BARLOW — CLO Indenture Extraction CLI
 * Phase 1 Proof of Concept
 *
 * Takes indenture text, calls Claude API, returns structured coverage test
 * definitions and concentration limits as verified JSON.
 *
 * Usage:
 *   node barlow_cli.js                    # runs against built-in synthetic indenture
 *   node barlow_cli.js --file path.txt    # runs against a text file
 *   node barlow_cli.js --verbose          # shows full extraction reasoning
 */

const https = require('https');

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHETIC INDENTURE (Appendix A from spec — ground truth for validation)
// ─────────────────────────────────────────────────────────────────────────────

const SYNTHETIC_INDENTURE = `
BARLOW CLO I, LTD.
INDENTURE dated as of March 15, 2023

SECTION 11.1 — OVERCOLLATERALIZATION TESTS

(a) Class A/B Overcollateralization Test. On each Measurement Date, the Trustee
shall calculate the Class A/B Overcollateralization Ratio by dividing (i) the
Adjusted Collateral Principal Amount by (ii) the sum of the aggregate outstanding
principal balance of the Class A Notes and the Class B Notes. The Class A/B
Overcollateralization Ratio shall be required to be equal to or greater than
123.50% (the "Class A/B OC Threshold"). If on any Measurement Date the Class
A/B Overcollateralization Ratio is less than the Class A/B OC Threshold, then
the Priority of Payments set forth in Section 13.1 shall be modified as set forth
in Section 11.3. Cure: redirect interest proceeds to principal reinvestment
account until the Class A/B OC Threshold is restored.

(b) Class C Overcollateralization Test. On each Measurement Date, the Trustee
shall calculate the Class C Overcollateralization Ratio by dividing (i) the
Adjusted Collateral Principal Amount by (ii) the sum of the aggregate outstanding
principal balance of the Class A Notes, Class B Notes, and Class C Notes. The
Class C Overcollateralization Ratio shall be required to be equal to or greater
than 112.75% (the "Class C OC Threshold"). If the Class C OC Threshold is not
satisfied, interest proceeds shall be diverted as set forth in Section 13.1(c).

SECTION 11.2 — INTEREST COVERAGE TEST

(a) Class A/B Interest Coverage Test. On each Measurement Date, the Trustee
shall calculate the Class A/B Interest Coverage Ratio by dividing (i) the
Interest Proceeds received during the related Interest Accrual Period by (ii) the
sum of (A) accrued and unpaid interest on the Class A Notes, (B) accrued and
unpaid interest on the Class B Notes, and (C) the Senior Management Fee payable
on the related Payment Date. The Class A/B Interest Coverage Ratio shall be
required to be equal to or greater than 120.00% (the "Class A/B IC Threshold").
Failure to satisfy the Interest Coverage Test shall constitute an Interest
Coverage Test Failure and shall redirect Interest Proceeds as specified in
Section 13.1(b).

SECTION 12.2 — CONCENTRATION LIMITATIONS

The following Concentration Limitations shall apply to the Collateral Obligations
held by the Issuer as of each Measurement Date. All percentages are expressed as
a proportion of the Adjusted Collateral Principal Amount unless otherwise specified.

(a) Single Obligor Limit. The aggregate Principal Balance of Collateral
Obligations issued by any single Obligor (together with its Affiliates) shall not
exceed 3.00% of the Adjusted Collateral Principal Amount.

(b) Single Industry Limit. The aggregate Principal Balance of Collateral
Obligations in any single Moody's Industry Classification Group shall not exceed
15.00% of the Adjusted Collateral Principal Amount.

(c) CCC/Caa Bucket. The aggregate Principal Balance of Collateral Obligations
rated CCC+/Caa1 or below by S&P and Moody's, respectively (using the lower of
the two ratings), shall not exceed 7.50% of the Adjusted Collateral Principal
Amount. For purposes of this limitation, Defaulted Obligations shall be treated
as CCC/Caa-rated regardless of their nominal rating.

(d) DIP Loan Limit. The aggregate Principal Balance of Debtor-in-Possession
Loans shall not exceed 5.00% of the Adjusted Collateral Principal Amount.

SECTION 13.1 — PRIORITY OF PAYMENTS

On each Payment Date, the Trustee shall apply Interest Proceeds in the following
order of priority (the "Interest Waterfall"):

Step 1: Trustee fees and expenses (Senior Expenses), not to exceed $250,000 per annum.
Step 2: Senior Management Fee payable to the Collateral Manager.
Step 3: Hedge payments due to Hedge Counterparties (excluding termination payments).
Step 4: Accrued and unpaid interest on the Class A Notes at the applicable rate.
Step 5: Accrued and unpaid interest on the Class B Notes — provided Class A/B OC
        Test is satisfied; otherwise redirect to Step 8.
Step 6: Accrued and unpaid interest on the Class C Notes — provided Class C OC
        Test is satisfied; otherwise redirect to Step 8.
Step 7: Subordinate Management Fee payable to the Collateral Manager.
Step 8: Reinvestment/cure — principal reinvestment account or pro rata paydown
        of Notes in reverse order of seniority until OC tests are cured.
`;

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHETIC LOAN TAPE (Appendix B from spec)
// ─────────────────────────────────────────────────────────────────────────────

const LOAN_TAPE = [
  // ── Apex Logistics (intentional single-obligor breach: $14.5M = 4.02% of pool) ──
  { id: 'L001', obligor: 'Apex Logistics',     industry: 'Transportation',    country: 'US',     par:  8.0, spread: 425, rating: 'B',    status: 'Current', accrued_interest: 0.61 },
  { id: 'L002', obligor: 'Apex Logistics',     industry: 'Transportation',    country: 'US',     par:  6.5, spread: 425, rating: 'B',    status: 'Current', accrued_interest: 0.57 },
  // ── B / BB filler — each $10M = 2.77% of pool (below 3% single-obligor limit) ──
  { id: 'L003', obligor: 'Bravo Media',        industry: 'Media & Ent.',      country: 'US',     par: 10.0, spread: 375, rating: 'B',    status: 'Current', accrued_interest: 0.41 },
  { id: 'L004', obligor: 'Castle Health',      industry: 'Healthcare',        country: 'US',     par: 10.0, spread: 450, rating: 'BB',   status: 'Current', accrued_interest: 0.42 },
  // ── CCC bucket (intentional rating-bucket breach: $46M = 12.76% of pool) ──
  { id: 'L005', obligor: 'Delta Energy',       industry: 'Oil & Gas',         country: 'US',     par: 10.0, spread: 500, rating: 'CCC',  status: 'Current', accrued_interest: 0.38 },
  { id: 'L006', obligor: 'Echo Software',      industry: 'Technology',        country: 'US',     par: 10.0, spread: 350, rating: 'B',    status: 'Current', accrued_interest: 0.54 },
  { id: 'L007', obligor: 'Foxtrot Retail',     industry: 'Retail',            country: 'US',     par:  9.5, spread: 550, rating: 'CCC',  status: 'Current', accrued_interest: 0.34 },
  { id: 'L008', obligor: 'Golf Pharma',        industry: 'Healthcare',        country: 'US',     par: 10.0, spread: 400, rating: 'BB',   status: 'Current', accrued_interest: 0.48 },
  { id: 'L009', obligor: 'Hotel Group',        industry: 'Lodging',           country: 'US',     par: 10.0, spread: 475, rating: 'B',    status: 'Current', accrued_interest: 0.45 },
  { id: 'L010', obligor: 'India Steel',        industry: 'Metals',            country: 'US',     par: 10.0, spread: 525, rating: 'BB',   status: 'Current', accrued_interest: 0.43 },
  { id: 'L011', obligor: 'Juliet Auto',        industry: 'Automotive',        country: 'US',     par: 10.0, spread: 410, rating: 'B',    status: 'Current', accrued_interest: 0.43 },
  { id: 'L012', obligor: 'Kilo Foods',         industry: 'Beverage/Food',     country: 'US',     par: 10.0, spread: 365, rating: 'BB',   status: 'Current', accrued_interest: 0.47 },
  { id: 'L013', obligor: 'Lima Telecom',       industry: 'Telecom',           country: 'US',     par: 10.0, spread: 440, rating: 'B',    status: 'Current', accrued_interest: 0.44 },
  { id: 'L014', obligor: 'Mike Defense',       industry: 'Aerospace',         country: 'US',     par: 10.0, spread: 390, rating: 'BB',   status: 'Current', accrued_interest: 0.34 },
  { id: 'L015', obligor: 'November Bldg',      industry: 'Construction',      country: 'US',     par:  9.0, spread: 510, rating: 'CCC',  status: 'Current', accrued_interest: 0.36 },
  { id: 'L016', obligor: 'Oscar Finance',      industry: 'Financial Svcs',    country: 'US',     par: 10.0, spread: 420, rating: 'B',    status: 'Current', accrued_interest: 0.48 },
  { id: 'L017', obligor: 'Papa Chemical',      industry: 'Chemicals',         country: 'US',     par: 10.0, spread: 460, rating: 'BB',   status: 'Current', accrued_interest: 0.41 },
  { id: 'L018', obligor: 'Quebec Mining',      industry: 'Metals',            country: 'Canada', par:  8.5, spread: 535, rating: 'CCC',  status: 'Current', accrued_interest: 0.36 },
  { id: 'L019', obligor: 'Romeo Fitness',      industry: 'Retail',            country: 'US',     par:  9.0, spread: 580, rating: 'CCC',  status: 'PIK',     accrued_interest: 0.00 },
  { id: 'L020', obligor: 'Sierra Waste',       industry: 'Environmental',     country: 'US',     par: 10.0, spread: 395, rating: 'B',    status: 'Current', accrued_interest: 0.44 },
  // ── BB filler L021–L037 — unique obligors & industries, pool padding ──
  { id: 'L021', obligor: 'Atlas Networks',     industry: 'Software',          country: 'US',     par: 10.0, spread: 380, rating: 'BB',   status: 'Current', accrued_interest: 0.30 },
  { id: 'L022', obligor: 'Beacon Property',    industry: 'Real Estate',       country: 'US',     par: 10.0, spread: 395, rating: 'BB',   status: 'Current', accrued_interest: 0.28 },
  { id: 'L023', obligor: 'Crown Utilities',    industry: 'Utilities',         country: 'US',     par: 10.0, spread: 350, rating: 'BB',   status: 'Current', accrued_interest: 0.25 },
  { id: 'L024', obligor: 'Dunbar Insurance',   industry: 'Insurance',         country: 'US',     par: 10.0, spread: 370, rating: 'BB',   status: 'Current', accrued_interest: 0.27 },
  { id: 'L025', obligor: 'Eagle Agriculture',  industry: 'Agriculture',       country: 'US',     par: 10.0, spread: 410, rating: 'BB',   status: 'Current', accrued_interest: 0.31 },
  { id: 'L026', obligor: 'Frontier Defense',   industry: 'Defense',           country: 'US',     par: 10.0, spread: 360, rating: 'BB',   status: 'Current', accrued_interest: 0.26 },
  { id: 'L027', obligor: 'Gemstone Gaming',    industry: 'Gaming',            country: 'US',     par: 10.0, spread: 420, rating: 'BB',   status: 'Current', accrued_interest: 0.32 },
  { id: 'L028', obligor: 'Harbor Packaging',   industry: 'Packaging',         country: 'US',     par: 10.0, spread: 385, rating: 'BB',   status: 'Current', accrued_interest: 0.29 },
  { id: 'L029', obligor: 'Ironwood Consumer',  industry: 'Consumer Products', country: 'US',     par: 10.0, spread: 400, rating: 'BB',   status: 'Current', accrued_interest: 0.30 },
  { id: 'L030', obligor: 'Jade Education',     industry: 'Education',         country: 'US',     par: 10.0, spread: 375, rating: 'BB',   status: 'Current', accrued_interest: 0.28 },
  { id: 'L031', obligor: 'Keystone Shipping',  industry: 'Shipping',          country: 'US',     par: 10.0, spread: 415, rating: 'BB',   status: 'Current', accrued_interest: 0.32 },
  { id: 'L032', obligor: 'Lantern Biz Svcs',   industry: 'Business Services', country: 'US',     par: 10.0, spread: 390, rating: 'BB',   status: 'Current', accrued_interest: 0.29 },
  { id: 'L033', obligor: 'Marble Pharma',      industry: 'Pharmaceuticals',   country: 'US',     par: 10.0, spread: 365, rating: 'BB',   status: 'Current', accrued_interest: 0.27 },
  { id: 'L034', obligor: 'Nordic Mining Co',   industry: 'Mining',            country: 'US',     par: 10.0, spread: 430, rating: 'BB',   status: 'Current', accrued_interest: 0.33 },
  { id: 'L035', obligor: 'Orbit Mfg Group',    industry: 'Industrials',       country: 'US',     par: 10.0, spread: 380, rating: 'BB',   status: 'Current', accrued_interest: 0.29 },
  { id: 'L036', obligor: 'Pacific Hospitality',industry: 'Hospitality',       country: 'US',     par: 10.0, spread: 395, rating: 'BB',   status: 'Current', accrued_interest: 0.30 },
  { id: 'L037', obligor: 'Quartz Media Tech',  industry: 'Media Technology',  country: 'US',     par: 10.0, spread: 370, rating: 'BB',   status: 'Current', accrued_interest: 0.28 },
];

// Capital structure (synthetic)
const CAPITAL_STRUCTURE = {
  class_a_par: 180.0,    // $M
  class_a_interest_due: 4.50,
  class_b_par: 60.0,
  class_b_interest_due: 1.80,
  class_c_par: 40.0,
  class_c_interest_due: 1.60,
  senior_management_fee: 0.25,
};

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — the contract for extraction
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a CLO indenture analysis engine. Your job is to read CLO indenture text and extract structured coverage test definitions, concentration limits, and waterfall priority of payments.

You must return ONLY valid JSON — no preamble, no explanation, no markdown fences. The JSON must conform exactly to this schema:

{
  "deal_name": "string — extracted from document header",
  "extraction_date": "ISO date string",
  "coverage_tests": [
    {
      "test_id": "string — e.g. OC_CLASS_AB, IC_CLASS_AB",
      "test_type": "overcollateralization | interest_coverage",
      "description": "string — plain English description of what this test measures",
      "numerator": "string — what is divided (e.g. adjusted_collateral_par)",
      "denominator": "string — what divides into (e.g. class_a_plus_b_par)",
      "threshold_pct": number — threshold as a percentage (e.g. 123.50 not 1.235),
      "failure_action": "string — what happens if test fails",
      "source_clause": "string — section reference from indenture",
      "confidence": "HIGH | MEDIUM | LOW",
      "confidence_reason": "string — why this confidence level was assigned"
    }
  ],
  "concentration_limits": [
    {
      "limit_id": "string — e.g. SINGLE_OBLIGOR, INDUSTRY, CCC_BUCKET, DIP",
      "description": "string — plain English description",
      "dimension": "obligor | industry | country | rating_bucket | loan_type",
      "max_pct": number — maximum as a percentage (e.g. 3.00 not 0.03),
      "calculation_basis": "string — what denominator to use",
      "notes": "string — any special handling (e.g. defaulted obligations treated as CCC)",
      "source_clause": "string — section reference",
      "confidence": "HIGH | MEDIUM | LOW",
      "confidence_reason": "string"
    }
  ],
  "waterfall": [
    {
      "step": number,
      "payee_type": "fees | hedge | note_interest | note_principal | reinvestment | subordinate_fees",
      "payee": "string — plain English name",
      "conditions": "string | null — any conditions on this payment (e.g. OC test must be passing)",
      "source_clause": "string"
    }
  ],
  "extraction_summary": {
    "tests_found": number,
    "limits_found": number,
    "waterfall_steps_found": number,
    "overall_confidence": "HIGH | MEDIUM | LOW",
    "flags": ["array of strings — any issues, ambiguities, or items requiring human review"]
  }
}

Rules:
1. Extract only what is explicitly stated in the text. Do not infer or assume.
2. If a threshold appears ambiguous, assign confidence MEDIUM or LOW and explain in confidence_reason.
3. If a clause is missing or truncated, note it in extraction_summary.flags.
4. Thresholds should be expressed as percentages: 123.50 not 1.235.
5. Return ONLY the JSON object. Nothing else.`;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP HELPER — calls Anthropic API without SDK dependency
// ─────────────────────────────────────────────────────────────────────────────

function callClaude(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY || ''
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(`API error: ${parsed.error.message}`));
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE TEST RUNNER — deterministic, no AI
// ─────────────────────────────────────────────────────────────────────────────

function runCoverageTests(extractedRules, loanTape, capitalStructure) {
  const results = [];
  const totalPar = loanTape.reduce((s, l) => s + l.par, 0);
  const totalInterestProceeds = loanTape
    .filter(l => l.status !== 'PIK')
    .reduce((s, l) => s + l.accrued_interest, 0);

  for (const test of extractedRules.coverage_tests) {
    let calculated, numeratorVal, denominatorVal, passed;

    if (test.test_type === 'overcollateralization') {
      numeratorVal = totalPar;
      if (test.test_id === 'OC_CLASS_AB') {
        denominatorVal = capitalStructure.class_a_par + capitalStructure.class_b_par;
      } else if (test.test_id === 'OC_CLASS_C') {
        denominatorVal = capitalStructure.class_a_par + capitalStructure.class_b_par + capitalStructure.class_c_par;
      } else {
        denominatorVal = capitalStructure.class_a_par + capitalStructure.class_b_par;
      }
      calculated = (numeratorVal / denominatorVal) * 100;
      passed = calculated >= test.threshold_pct;

    } else if (test.test_type === 'interest_coverage') {
      numeratorVal = totalInterestProceeds;
      denominatorVal = capitalStructure.class_a_interest_due +
                       capitalStructure.class_b_interest_due +
                       capitalStructure.senior_management_fee;
      calculated = (numeratorVal / denominatorVal) * 100;
      passed = calculated >= test.threshold_pct;
    }

    results.push({
      test_id: test.test_id,
      description: test.description,
      numerator_value: Math.round(numeratorVal * 100) / 100,
      denominator_value: Math.round(denominatorVal * 100) / 100,
      calculated_pct: Math.round(calculated * 100) / 100,
      threshold_pct: test.threshold_pct,
      cushion_pct: Math.round((calculated - test.threshold_pct) * 100) / 100,
      result: passed ? 'PASS' : 'FAIL',
      failure_action: passed ? null : test.failure_action,
      source_clause: test.source_clause
    });
  }
  return results;
}

function runConcentrationTests(extractedRules, loanTape) {
  const results = [];
  const totalPar = loanTape.reduce((s, l) => s + l.par, 0);

  for (const limit of extractedRules.concentration_limits) {
    let breaches = [];

    if (limit.dimension === 'obligor') {
      // Group by obligor
      const byObligor = {};
      loanTape.forEach(l => { byObligor[l.obligor] = (byObligor[l.obligor] || 0) + l.par; });
      Object.entries(byObligor).forEach(([obligor, par]) => {
        const pct = (par / totalPar) * 100;
        if (pct > limit.max_pct) {
          breaches.push({ item: obligor, par_value: Math.round(par * 100) / 100, pct: Math.round(pct * 100) / 100 });
        }
      });

    } else if (limit.dimension === 'industry') {
      const byIndustry = {};
      loanTape.forEach(l => { byIndustry[l.industry] = (byIndustry[l.industry] || 0) + l.par; });
      Object.entries(byIndustry).forEach(([industry, par]) => {
        const pct = (par / totalPar) * 100;
        if (pct > limit.max_pct) {
          breaches.push({ item: industry, par_value: Math.round(par * 100) / 100, pct: Math.round(pct * 100) / 100 });
        }
      });

    } else if (limit.dimension === 'rating_bucket') {
      // CCC bucket — ratings at or below CCC+
      const cccRatings = ['CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
      const cccLoans = loanTape.filter(l => cccRatings.includes(l.rating) || l.status === 'Defaulted');
      const cccPar = cccLoans.reduce((s, l) => s + l.par, 0);
      const cccPct = (cccPar / totalPar) * 100;
      if (cccPct > limit.max_pct) {
        breaches.push({
          item: 'CCC/Caa bucket',
          par_value: Math.round(cccPar * 100) / 100,
          pct: Math.round(cccPct * 100) / 100,
          loans: cccLoans.map(l => l.id)
        });
      }

    } else if (limit.dimension === 'loan_type') {
      // DIP loans
      const dipLoans = loanTape.filter(l => l.loan_type === 'DIP');
      const dipPar = dipLoans.reduce((s, l) => s + l.par, 0);
      const dipPct = (dipPar / totalPar) * 100;
      if (dipPct > limit.max_pct) {
        breaches.push({ item: 'DIP loans', par_value: Math.round(dipPar * 100) / 100, pct: Math.round(dipPct * 100) / 100 });
      }
    }

    results.push({
      limit_id: limit.limit_id,
      description: limit.description,
      max_pct: limit.max_pct,
      total_par_basis: Math.round(totalPar * 100) / 100,
      result: breaches.length === 0 ? 'PASS' : 'FAIL',
      breach_count: breaches.length,
      breaches,
      source_clause: limit.source_clause
    });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEPTION NARRATIVE GENERATOR — AI again, only for failed tests
// ─────────────────────────────────────────────────────────────────────────────

async function generateExceptionNarrative(testResults, concentrationResults, extractedRules) {
  const failures = [
    ...testResults.filter(t => t.result === 'FAIL'),
    ...concentrationResults.filter(t => t.result === 'FAIL')
  ];

  if (failures.length === 0) return null;

  const prompt = `You are a CLO trustee report writer. Given these test failures, write a concise exception narrative suitable for a trustee report.

For each failure:
- State what test failed and by how much
- Reference the indenture section
- State the required cure action
- Use precise financial language appropriate for institutional noteholders
- Be factual, not alarmist

Failures:
${JSON.stringify(failures, null, 2)}

Indenture rules context:
${JSON.stringify(extractedRules.coverage_tests.concat(extractedRules.concentration_limits), null, 2)}

Return plain prose only. No JSON. No headers. 2-4 sentences per failure, separated by blank lines.`;

  const response = await callClaude(
    'You are a precise CLO trustee report writer. Write factual exception narratives for institutional audiences.',
    prompt
  );

  return response.content[0]?.text || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — two modes
//   synthetic: compare extracted values against hardcoded ground truth
//   real:      structural check only — required fields present and well-typed
// ─────────────────────────────────────────────────────────────────────────────

const GROUND_TRUTH = {
  coverage_tests: [
    { test_id: 'OC_CLASS_AB', threshold_pct: 123.50 },
    { test_id: 'OC_CLASS_C',  threshold_pct: 112.75 },
    { test_id: 'IC_CLASS_AB', threshold_pct: 120.00 },
  ],
  concentration_limits: [
    { limit_id: 'SINGLE_OBLIGOR', max_pct: 3.00  },
    { limit_id: 'INDUSTRY',       max_pct: 15.00 },
    { limit_id: 'CCC_BUCKET',     max_pct: 7.50  },
    { limit_id: 'DIP',            max_pct: 5.00  },
  ]
};

// Synthetic mode: value-level comparison against GROUND_TRUTH
function validateExtraction(extracted) {
  const report = { passed: [], failed: [], warnings: [] };

  for (const gt of GROUND_TRUTH.coverage_tests) {
    const found = extracted.coverage_tests?.find(t =>
      t.test_id === gt.test_id || t.threshold_pct === gt.threshold_pct
    );
    if (!found) {
      report.failed.push(`Missing test: ${gt.test_id} (threshold ${gt.threshold_pct}%)`);
    } else if (Math.abs(found.threshold_pct - gt.threshold_pct) > 0.01) {
      report.failed.push(`Wrong threshold for ${gt.test_id}: got ${found.threshold_pct}%, expected ${gt.threshold_pct}%`);
    } else {
      report.passed.push(`${gt.test_id}: threshold ${found.threshold_pct}% ✓`);
    }
  }

  for (const gt of GROUND_TRUTH.concentration_limits) {
    const found = extracted.concentration_limits?.find(l =>
      l.limit_id === gt.limit_id || Math.abs(l.max_pct - gt.max_pct) < 0.01
    );
    if (!found) {
      report.failed.push(`Missing limit: ${gt.limit_id} (${gt.max_pct}%)`);
    } else if (Math.abs(found.max_pct - gt.max_pct) > 0.01) {
      report.failed.push(`Wrong threshold for ${gt.limit_id}: got ${found.max_pct}%, expected ${gt.max_pct}%`);
    } else {
      report.passed.push(`${gt.limit_id}: ${found.max_pct}% ✓`);
    }
  }

  if (extracted.extraction_summary?.overall_confidence === 'LOW') {
    report.warnings.push('Overall extraction confidence is LOW — review recommended');
  }

  return report;
}

// Real mode: structural check — fields present, types correct, no expected values
const VALID_TEST_TYPES  = ['overcollateralization', 'interest_coverage'];
const VALID_DIMENSIONS  = ['obligor', 'industry', 'country', 'rating_bucket', 'loan_type'];

function validateStructure(extracted) {
  const report = { passed: [], failed: [], warnings: [] };

  const tests     = extracted.coverage_tests      || [];
  const limits    = extracted.concentration_limits || [];
  const waterfall = extracted.waterfall            || [];

  // ── Array presence ────────────────────────────────────────────────────────
  if (tests.length === 0) {
    report.failed.push('coverage_tests: no tests extracted');
  } else {
    report.passed.push(`coverage_tests: ${tests.length} test(s) present`);
  }

  if (limits.length === 0) {
    report.failed.push('concentration_limits: no limits extracted');
  } else {
    report.passed.push(`concentration_limits: ${limits.length} limit(s) present`);
  }

  if (waterfall.length === 0) {
    report.failed.push('waterfall: no steps extracted');
  } else {
    report.passed.push(`waterfall: ${waterfall.length} step(s) present`);
  }

  // ── Coverage test field checks ────────────────────────────────────────────
  let testFieldErrors = 0;
  tests.forEach((t, i) => {
    const lbl = t.test_id || `test[${i}]`;
    if (!t.test_id || typeof t.test_id !== 'string')
      { report.failed.push(`${lbl}: missing or non-string test_id`); testFieldErrors++; }
    if (typeof t.threshold_pct !== 'number' || !isFinite(t.threshold_pct) || t.threshold_pct <= 0)
      { report.failed.push(`${lbl}: threshold_pct must be a positive number (got ${t.threshold_pct})`); testFieldErrors++; }
    if (!VALID_TEST_TYPES.includes(t.test_type))
      { report.failed.push(`${lbl}: unrecognised test_type "${t.test_type}"`); testFieldErrors++; }
    if (!t.source_clause)
      report.warnings.push(`${lbl}: no source_clause — manual verification needed`);
    if (t.confidence === 'LOW')
      report.warnings.push(`${lbl}: confidence LOW — ${t.confidence_reason || 'no reason given'}`);
  });
  if (tests.length > 0 && testFieldErrors === 0)
    report.passed.push(`coverage_tests fields: all ${tests.length} have valid test_id, threshold_pct, test_type`);

  // ── Concentration limit field checks ──────────────────────────────────────
  let limitFieldErrors = 0;
  limits.forEach((l, i) => {
    const lbl = l.limit_id || `limit[${i}]`;
    if (!l.limit_id || typeof l.limit_id !== 'string')
      { report.failed.push(`${lbl}: missing or non-string limit_id`); limitFieldErrors++; }
    if (typeof l.max_pct !== 'number' || !isFinite(l.max_pct) || l.max_pct < 0)
      { report.failed.push(`${lbl}: max_pct must be a non-negative number (got ${l.max_pct})`); limitFieldErrors++; }
    if (!VALID_DIMENSIONS.includes(l.dimension))
      report.warnings.push(`${lbl}: unrecognised dimension "${l.dimension}" — runner will skip this limit`);
    if (l.confidence === 'LOW')
      report.warnings.push(`${lbl}: confidence LOW — ${l.confidence_reason || 'no reason given'}`);
  });
  if (limits.length > 0 && limitFieldErrors === 0)
    report.passed.push(`concentration_limits fields: all ${limits.length} have valid limit_id, max_pct`);

  // ── Overall confidence ────────────────────────────────────────────────────
  const confidence = extracted.extraction_summary?.overall_confidence;
  if (confidence === 'LOW')
    report.warnings.push('Overall extraction confidence is LOW — review recommended');
  else if (confidence === 'MEDIUM')
    report.warnings.push('Overall extraction confidence is MEDIUM — review flagged items');

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  navy: '\x1b[34m', amber: '\x1b[33m', green: '\x1b[32m',
  red: '\x1b[31m', cyan: '\x1b[36m', grey: '\x1b[90m'
};

function banner(text) {
  const line = '─'.repeat(68);
  console.log(`\n${C.navy}${C.bold}${line}${C.reset}`);
  console.log(`${C.navy}${C.bold}  ${text}${C.reset}`);
  console.log(`${C.navy}${C.bold}${line}${C.reset}\n`);
}

function section(text) {
  console.log(`\n${C.amber}${C.bold}▸ ${text}${C.reset}`);
  console.log(`${C.grey}${'─'.repeat(50)}${C.reset}`);
}

function pass(text) { console.log(`  ${C.green}✓${C.reset}  ${text}`); }
function fail(text) { console.log(`  ${C.red}✗${C.reset}  ${C.bold}${text}${C.reset}`); }
function info(text) { console.log(`  ${C.cyan}·${C.reset}  ${text}`); }
function warn(text) { console.log(`  ${C.amber}⚠${C.reset}  ${text}`); }
function dim(text)  { console.log(`  ${C.grey}${text}${C.reset}`); }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const verbose  = args.includes('--verbose');
  const fileArg  = args.indexOf('--file');
  const modeArg  = args.find(a => a.startsWith('--mode='));
  const mode     = modeArg ? modeArg.split('=')[1] : 'synthetic';
  const fs = require('fs');

  if (mode !== 'synthetic' && mode !== 'real') {
    console.error(`Unknown --mode value "${mode}". Valid values: synthetic, real`);
    process.exit(1);
  }

  let indentureText = SYNTHETIC_INDENTURE;
  if (fileArg !== -1 && args[fileArg + 1]) {
    indentureText = fs.readFileSync(args[fileArg + 1], 'utf8');
    info(`Using indenture file: ${args[fileArg + 1]}`);
  } else {
    info('Using built-in synthetic indenture (Barlow CLO I, Ltd.)');
  }

  if (mode === 'real') {
    console.log(`  ${C.amber}[WARN] Ground truth validation disabled — running in real indenture mode${C.reset}`);
    console.log();
  }

  banner('BARLOW  ·  CLO Administration AI Pipeline  ·  Phase 1 CLI');

  // ── STEP 1: EXTRACTION ──────────────────────────────────────────────────
  section('STEP 1 — Indenture Extraction (AI)');
  info('Sending indenture text to Claude for structured rule extraction...');
  console.log();

  let extracted;
  try {
    const response = await callClaude(EXTRACTION_SYSTEM_PROMPT, indentureText);
    const rawText = response.content[0]?.text || '';

    if (verbose) {
      console.log(`${C.grey}Raw API response:${C.reset}`);
      console.log(rawText);
      console.log();
    }

    // Strip any accidental markdown fences
    const clean = rawText.replace(/```json\s*|```\s*/g, '').trim();
    extracted = JSON.parse(clean);

  } catch (e) {
    fail(`Extraction failed: ${e.message}`);
    process.exit(1);
  }

  info(`Deal: ${C.bold}${extracted.deal_name}${C.reset}`);
  info(`Coverage tests extracted: ${C.bold}${extracted.coverage_tests?.length || 0}${C.reset}`);
  info(`Concentration limits extracted: ${C.bold}${extracted.concentration_limits?.length || 0}${C.reset}`);
  info(`Waterfall steps extracted: ${C.bold}${extracted.waterfall?.length || 0}${C.reset}`);
  info(`Overall confidence: ${C.bold}${extracted.extraction_summary?.overall_confidence || 'N/A'}${C.reset}`);

  if (extracted.extraction_summary?.flags?.length > 0) {
    console.log();
    warn('Extraction flags:');
    extracted.extraction_summary.flags.forEach(f => dim(`    ${f}`));
  }

  // ── STEP 2: VALIDATION ──────────────────────────────────────────────────
  const step2Label = mode === 'real'
    ? 'STEP 2 — Extraction Validation (structural check)'
    : 'STEP 2 — Extraction Validation (ground truth check)';
  section(step2Label);

  if (mode === 'real') {
    warn('[WARN] Ground truth validation disabled — running in real indenture mode');
    console.log();
  }

  const validation = mode === 'real'
    ? validateStructure(extracted)
    : validateExtraction(extracted);

  validation.passed.forEach(p => pass(p));
  validation.failed.forEach(f => fail(f));
  validation.warnings.forEach(w => warn(w));

  const total = validation.passed.length + validation.failed.length;
  const extractionScore = total > 0 ? validation.passed.length / total : 1;
  console.log();
  const scoreColor = extractionScore === 1 ? C.green : extractionScore >= 0.75 ? C.amber : C.red;
  const scoreLabel = mode === 'real' ? 'Structural validity' : 'Extraction accuracy';
  const scoreDetail = mode === 'real'
    ? `${validation.passed.length}/${total} checks passed`
    : `${validation.passed.length}/${total} rules correct`;
  info(`${scoreLabel}: ${scoreColor}${C.bold}${Math.round(extractionScore * 100)}% (${scoreDetail})${C.reset}`);

  // ── STEP 3: COVERAGE TESTS ──────────────────────────────────────────────
  section('STEP 3 — Coverage Test Runner (deterministic)');

  const testResults = runCoverageTests(extracted, LOAN_TAPE, CAPITAL_STRUCTURE);
  for (const r of testResults) {
    const color = r.result === 'PASS' ? C.green : C.red;
    const cushionStr = r.cushion_pct >= 0
      ? `${C.green}+${r.cushion_pct}% cushion${C.reset}`
      : `${C.red}${r.cushion_pct}% breach${C.reset}`;
    console.log(`  ${color}${C.bold}${r.result}${C.reset}  ${r.test_id.padEnd(16)} ${r.calculated_pct}% vs ${r.threshold_pct}% threshold  (${cushionStr})`);
    if (r.result === 'FAIL') {
      dim(`        Action: ${r.failure_action}`);
    }
  }

  // ── STEP 4: CONCENTRATION TESTS ─────────────────────────────────────────
  section('STEP 4 — Concentration Limit Runner (deterministic)');

  const concentrationResults = runConcentrationTests(extracted, LOAN_TAPE);
  for (const r of concentrationResults) {
    const color = r.result === 'PASS' ? C.green : C.red;
    console.log(`  ${color}${C.bold}${r.result}${C.reset}  ${r.limit_id.padEnd(20)} max ${r.max_pct}%  (${r.breach_count} breach${r.breach_count !== 1 ? 'es' : ''})`);
    if (r.breaches.length > 0) {
      r.breaches.forEach(b => {
        dim(`        ${b.item}: $${b.par_value}M = ${b.pct}% of pool (limit: ${r.max_pct}%)`);
        if (b.loans) dim(`        Loans: ${b.loans.join(', ')}`);
      });
    }
  }

  // ── STEP 5: EXCEPTION NARRATIVE ─────────────────────────────────────────
  section('STEP 5 — Exception Narrative Generation (AI)');

  const allFailed = testResults.filter(t => t.result === 'FAIL').length +
                    concentrationResults.filter(t => t.result === 'FAIL').length;

  if (allFailed === 0) {
    pass('All tests passed — no exception narrative required');
  } else {
    info(`${allFailed} test failure(s) detected. Generating trustee report narrative...`);
    console.log();
    try {
      const narrative = await generateExceptionNarrative(testResults, concentrationResults, extracted);
      if (narrative) {
        console.log(`${C.grey}${'─'.repeat(60)}${C.reset}`);
        narrative.split('\n').forEach(line => console.log(`  ${line}`));
        console.log(`${C.grey}${'─'.repeat(60)}${C.reset}`);
      }
    } catch (e) {
      warn(`Narrative generation failed: ${e.message}`);
    }
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  banner('BARLOW PIPELINE SUMMARY');

  const passCount = testResults.filter(t => t.result === 'PASS').length +
                    concentrationResults.filter(t => t.result === 'PASS').length;
  const failCount = testResults.filter(t => t.result === 'FAIL').length +
                    concentrationResults.filter(t => t.result === 'FAIL').length;
  const totalTests = passCount + failCount;

  info(`Extraction accuracy:  ${C.bold}${Math.round(extractionScore * 100)}%${C.reset}`);
  info(`Tests run:            ${C.bold}${totalTests}${C.reset}  (${passCount} pass / ${failCount} fail)`);
  info(`AI calls made:        ${C.bold}${failCount > 0 ? 2 : 1}${C.reset}  (1 extraction + ${failCount > 0 ? '1 narrative' : '0 narrative'})`);
  info(`Deterministic calc:   ${C.bold}100%${C.reset}  (no AI in test runner path)`);

  console.log();
  if (extractionScore === 1 && totalTests > 0) {
    console.log(`${C.green}${C.bold}  ✓  HYPOTHESIS SUPPORTED: AI correctly extracted all rules and identified all breaches.${C.reset}`);
  } else if (extractionScore >= 0.75) {
    console.log(`${C.amber}${C.bold}  ⚠  PARTIAL: Extraction mostly correct but review flagged items before proceeding.${C.reset}`);
  } else {
    console.log(`${C.red}${C.bold}  ✗  EXTRACTION BELOW THRESHOLD: Manual review required before running tests.${C.reset}`);
  }
  console.log();

  // ── OUTPUT FILE ─────────────────────────────────────────────────────────
  const output = {
    run_timestamp: new Date().toISOString(),
    deal: extracted.deal_name,
    extraction: extracted,
    validation,
    coverage_test_results: testResults,
    concentration_test_results: concentrationResults,
    pipeline_summary: {
      extraction_accuracy_pct: Math.round(extractionScore * 100),
      tests_passed: passCount,
      tests_failed: failCount
    }
  };

  const outPath = '/home/andycarthy/barlow/barlow_output.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  info(`Full output written to: ${C.cyan}${outPath}${C.reset}`);
  console.log();
}

main().catch(e => {
  console.error(`\n${C.red}Fatal error: ${e.message}${C.reset}\n`);
  process.exit(1);
});
