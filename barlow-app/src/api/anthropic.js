// Set REACT_APP_ANTHROPIC_API_KEY in a .env.local file (never committed).
// See .env.local.example for the required format.
const API_KEY = process.env.REACT_APP_ANTHROPIC_API_KEY || '';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-sonnet-4-6';

// ── Extraction system prompt ─────────────────────────────────────────────────
// Mirrors the contract used in barlow_cli.js — must stay in sync if the CLI
// prompt changes.

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
      "max_pct": number — default/fallback maximum as a percentage (e.g. 12.00); always populate even when tiers is present,
      "tiers": [
        {
          "rank": "string — e.g. largest | second_largest | all_others | top_3 | any rank label stated in the indenture",
          "max_pct": number — threshold for this rank tier as a percentage
        }
      ],
      "applies_to": ["array of loan_type strings this limit applies to, e.g. FIRST_LIEN_LAST_OUT, SECOND_LIEN, PERMITTED_DEBT_SECURITY, UNSECURED — omit or null if the limit applies to all loan types"],
      "applies_to_values": ["for dimension:country limits — array of ISO country codes this limit governs, e.g. US, CA, GB — omit or null for limits that apply regardless of country"],
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
5. Return ONLY the JSON object. Nothing else.
6. Tiered limits: if a concentration limit specifies different thresholds by rank or count (e.g. "12% for any industry, except the largest industry may be up to 20% and the second-largest up to 17%"), populate the tiers array with one object per tier using a rank label taken directly from the indenture text. Set max_pct at the top level to the most restrictive (lowest) tier threshold as the fallback.
7. Country limits: if the indenture contains geographic concentration limits (e.g. "no single non-US country may exceed 10% of ACPA"), set dimension to "country" and populate applies_to_values with the ISO country codes explicitly named, or omit applies_to_values if the limit applies to all non-domestic countries generically. Produce one limit row per distinct threshold; use tiers if ranks are stated.`;

// ── Narrative system prompt ──────────────────────────────────────────────────

const NARRATIVE_SYSTEM_PROMPT =
  'You are a precise CLO trustee report writer. Write factual exception narratives for institutional audiences.';

// ── Core fetch wrapper ───────────────────────────────────────────────────────

async function callClaude(systemPrompt, userMessage) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': API_KEY,
      // Required when calling the Anthropic API directly from a browser.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Send indenture text to Claude and return structured rules JSON.
 * Mirrors Step 1 of barlow_cli.js.
 *
 * @param {string} indentureText  — raw indenture document text
 * @returns {Promise<object>}     — parsed extraction object (see schema above)
 */
export async function extractRules(indentureText) {
  const raw = await callClaude(EXTRACTION_SYSTEM_PROMPT, indentureText);
  // Strip any accidental markdown fences Claude may emit despite instructions.
  const clean = raw.replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(clean);
}

/**
 * Send failing test results to Claude and return a trustee-report narrative.
 * Only called when at least one test has result === 'FAIL'.
 * Mirrors Step 5 of barlow_cli.js.
 *
 * @param {Array}  failures  — coverage + concentration results where result === 'FAIL'
 * @returns {Promise<string|null>}  — plain prose narrative, or null if no failures
 */
export async function generateNarrative(failures) {
  if (!failures || failures.length === 0) return null;

  const userMessage = `You are a CLO trustee report writer. Given these test failures, write a concise exception narrative suitable for a trustee report.

For each failure:
- State what test failed and by how much
- Reference the indenture section
- State the required cure action
- Use precise financial language appropriate for institutional noteholders
- Be factual, not alarmist

Failures:
${JSON.stringify(failures, null, 2)}

Return plain prose only. No JSON. No headers. 2-4 sentences per failure, separated by blank lines.`;

  return callClaude(NARRATIVE_SYSTEM_PROMPT, userMessage);
}
