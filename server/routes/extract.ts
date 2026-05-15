import type { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionOutput } from '../../barlow-app/src/types/extraction_output';

const EXTRACTION_SYSTEM_PROMPT = `You are a CLO indenture analysis engine. Extract structured coverage tests, concentration limits, and waterfall steps from CLO indenture text.

Return ONLY valid JSON — no preamble, no markdown fences. Schema:

{
  "deal_name": "string",
  "extraction_date": "ISO date string (today)",
  "coverage_tests": [{
    "test_id": "string (e.g. OC_CLASS_AB)",
    "test_type": "overcollateralization | interest_coverage",
    "description": "string",
    "numerator": "string",
    "denominator": "string",
    "threshold_pct": number,
    "failure_action": "string",
    "source_clause": "string (e.g. §11.1(a))",
    "confidence": "HIGH | MEDIUM | LOW",
    "confidence_reason": "string"
  }],
  "concentration_limits": [{
    "limit_id": "string",
    "description": "string",
    "dimension": "obligor | industry | country | rating_bucket | loan_type",
    "max_pct": number,
    "tiers": [{"rank": "string", "max_pct": number}],
    "applies_to": ["loan_type strings or null"],
    "calculation_basis": "string",
    "notes": "string or null",
    "source_clause": "string",
    "confidence": "HIGH | MEDIUM | LOW",
    "confidence_reason": "string"
  }],
  "waterfall_steps": [{
    "step_id": "string",
    "step_number": number,
    "step_type": "FEE | INTEREST_PAYMENT | COVERAGE_TEST_CHECK | PRINCIPAL_PAYMENT | REINVESTMENT | EQUITY_DISTRIBUTION",
    "label": "string",
    "indenture_section": "string",
    "beneficiary": "string (optional)",
    "payment_type": "INTEREST | PRINCIPAL | FEE | EQUITY_DISTRIBUTION (optional)",
    "note_class": "CLASS_A | CLASS_B | CLASS_C | CLASS_D | CLASS_E | EQUITY (optional)",
    "amount_basis": "ACCRUED_INTEREST | PRO_RATA | REMAINING_PROCEEDS | FIXED (optional)",
    "condition": {
      "test_type": "OC | IC | COMBINED | NONE",
      "note_classes_tested": ["CLASS_A", "CLASS_B"],
      "operator": "ALL_PASS | ANY_PASS"
    },
    "diverts_to": {
      "step_type": "REINVESTMENT | REDEMPTION | RESERVE",
      "note_class_priority": [],
      "description": "string"
    },
    "cure_mechanism": "REINVESTMENT | REDEMPTION | TRAP"
  }],
  "extraction_summary": {
    "tests_found": number,
    "limits_found": number,
    "waterfall_steps_found": number,
    "overall_confidence": "HIGH | MEDIUM | LOW",
    "flags": []
  }
}

Rules:
1. Extract only what is explicitly stated. Do not infer.
2. Thresholds are percentages: 123.50 not 1.2350.
3. COVERAGE_TEST_CHECK steps have both condition and diverts_to fields.
4. Return ONLY the JSON object.`;

export async function extractRoute(req: Request, res: Response): Promise<void> {
  try {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) {
      res.json({ data: null, error: 'No indenture text provided' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.json({ data: null, error: 'ANTHROPIC_API_KEY not set on server' });
      return;
    }

    const client = new Anthropic({ apiKey });
    const t0 = Date.now();

    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8000,
      system:     EXTRACTION_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: text }],
    });

    const raw   = (message.content[0] as { type: string; text: string }).text;
    const clean = raw.replace(/```json\s*|```\s*/g, '').trim();
    const extraction: ExtractionOutput = JSON.parse(clean);
    extraction.extraction_date = new Date().toISOString().slice(0, 10);

    res.json({ data: { extraction, elapsed_ms: Date.now() - t0 }, error: null });
  } catch (e) {
    res.json({ data: null, error: (e as Error).message });
  }
}
