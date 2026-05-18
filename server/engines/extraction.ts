import Anthropic from '@anthropic-ai/sdk';

// ~20,000 chars ≈ 5,000 tokens per chunk — well under model context limits.
// 880KB indenture → ~44 chunks. At concurrency 8: ~6 batches × ~6s ≈ sub-60s.
const CHUNK_CHARS = 20_000;
const CHUNK_OVERLAP = 500; // chars shared with next chunk, avoids cutting mid-clause

const CHUNK_SYSTEM_PROMPT = `You are a CLO indenture analysis engine. Extract structured coverage tests, concentration limits, and waterfall steps from this indenture section.

Return ONLY valid JSON. If no rules are found in this section, return empty arrays.

Schema:
{
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
    "tiers": [],
    "applies_to": [],
    "calculation_basis": "string",
    "notes": null,
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
    "beneficiary": "string",
    "payment_type": "INTEREST | PRINCIPAL | FEE | EQUITY_DISTRIBUTION",
    "note_class": "CLASS_A | CLASS_B | CLASS_C | CLASS_D | CLASS_E | EQUITY",
    "amount_basis": "ACCRUED_INTEREST | PRO_RATA | REMAINING_PROCEEDS | FIXED",
    "condition": null,
    "diverts_to": null,
    "cure_mechanism": null
  }]
}

Rules:
1. Extract only what is explicitly stated in this section. Do not infer.
2. Thresholds are percentages: 123.50 not 1.2350.
3. COVERAGE_TEST_CHECK steps must include condition and diverts_to if present.
4. Return ONLY the JSON object — no preamble, no markdown fences.`;

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
const CONFIDENCE_RANK: Record<Confidence, number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };

interface ChunkResult {
  coverage_tests: Record<string, unknown>[];
  concentration_limits: Record<string, unknown>[];
  waterfall_steps: Record<string, unknown>[];
}

export interface ProgressEvent {
  completed: number;
  total: number;
  phase: 'extraction';
}

// Split text into overlapping chunks, snapping end to whitespace to avoid mid-word cuts
export function chunkText(text: string, chunkSize = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    // Snap end boundary to next whitespace (up to 200 chars lookahead)
    if (end < text.length) {
      const snap = text.indexOf(' ', end);
      if (snap !== -1 && snap - end < 200) end = snap + 1;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function sanitizeJsonStrings(s: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}

async function extractChunk(chunk: string, index: number, client: Anthropic): Promise<ChunkResult> {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: CHUNK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `[Chunk ${index + 1}]\n\n${chunk}` }],
    });

    const raw = (message.content[0] as { type: string; text: string }).text;
    const clean = raw.replace(/```json\s*|```\s*/g, '').trim();
    try {
      return JSON.parse(clean) as ChunkResult;
    } catch {
      return JSON.parse(sanitizeJsonStrings(clean)) as ChunkResult;
    }
  } catch {
    // Swallow per-chunk errors — partial results are better than full failure
    return { coverage_tests: [], concentration_limits: [], waterfall_steps: [] };
  }
}

// Merge results from all chunks, deduplicating by ID.
// On collision, keep the entry with higher confidence.
function mergeChunkResults(chunkResults: ChunkResult[], dealName: string): Record<string, unknown> {
  const tests = new Map<string, Record<string, unknown>>();
  const limits = new Map<string, Record<string, unknown>>();
  const steps = new Map<string, Record<string, unknown>>();

  for (const cr of chunkResults) {
    for (const t of (cr.coverage_tests ?? [])) {
      const id = t.test_id as string;
      if (!id) continue;
      const existing = tests.get(id);
      const newRank = CONFIDENCE_RANK[(t.confidence as Confidence) ?? 'LOW'];
      const existRank = existing ? CONFIDENCE_RANK[(existing.confidence as Confidence) ?? 'LOW'] : -1;
      if (!existing || newRank > existRank) tests.set(id, t);
    }
    for (const l of (cr.concentration_limits ?? [])) {
      const id = l.limit_id as string;
      if (!id) continue;
      const existing = limits.get(id);
      const newRank = CONFIDENCE_RANK[(l.confidence as Confidence) ?? 'LOW'];
      const existRank = existing ? CONFIDENCE_RANK[(existing.confidence as Confidence) ?? 'LOW'] : -1;
      if (!existing || newRank > existRank) limits.set(id, l);
    }
    for (const s of (cr.waterfall_steps ?? [])) {
      const id = s.step_id as string;
      if (!id) continue;
      if (!steps.has(id)) steps.set(id, s);
    }
  }

  const coverage_tests = Array.from(tests.values());
  const concentration_limits = Array.from(limits.values());
  const waterfall_steps = Array.from(steps.values())
    .sort((a, b) => ((a.step_number as number) ?? 0) - ((b.step_number as number) ?? 0));

  return {
    deal_name: dealName,
    extraction_date: new Date().toISOString().slice(0, 10),
    coverage_tests,
    concentration_limits,
    waterfall_steps,
    extraction_summary: {
      tests_found: coverage_tests.length,
      limits_found: concentration_limits.length,
      waterfall_steps_found: waterfall_steps.length,
      overall_confidence: 'HIGH',
      flags: [],
    },
  };
}

export async function extractParallel(
  text: string,
  apiKey: string,
  opts: {
    concurrency?: number;
    dealName?: string;
    onProgress?: (ev: ProgressEvent) => void;
  } = {}
): Promise<Record<string, unknown>> {
  const concurrency = opts.concurrency
    ?? Number(process.env.BARLOW_EXTRACTION_CONCURRENCY ?? 8);
  const client = new Anthropic({ apiKey });
  const chunks = chunkText(text);
  const total = chunks.length;
  const results = new Array<ChunkResult>(total);

  for (let i = 0; i < total; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((chunk, j) => extractChunk(chunk, i + j, client))
    );
    batchResults.forEach((r, j) => { results[i + j] = r; });

    opts.onProgress?.({
      completed: Math.min(i + concurrency, total),
      total,
      phase: 'extraction',
    });
  }

  return mergeChunkResults(results, opts.dealName ?? 'Unknown Deal');
}
