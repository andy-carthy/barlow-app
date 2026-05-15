import Anthropic from '@anthropic-ai/sdk';
import type {
  TrusteeReport, ExceptionNarrative, ExceptionEntry,
  CoverageTestEntry, ConcentrationLimitEntry,
} from '../types/report';
import type { ExtractionOutput } from '../types/extraction_output';
import type { DiversionEntry } from '../types/waterfall';
import {
  EXCEPTION_NARRATIVE_SYSTEM_PROMPT,
  buildNarrativeUserMessage,
  type NarrativeGenerationRequest,
} from '../prompts/exception_narrative_prompt';

const MODEL          = 'claude-sonnet-4-6';
const PROMPT_VERSION = '5B.1';
const MAX_WORDS      = 150;

function isCoverageEntry(e: CoverageTestEntry | ConcentrationLimitEntry): e is CoverageTestEntry {
  return 'threshold' in e;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function truncateToWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > limit ? words.slice(0, limit).join(' ') + '…' : text;
}

function permittedDecimals(req: NarrativeGenerationRequest): number[] {
  const td  = req.test_detail;
  const exc = req.exception;
  const figures: number[] = [exc.breach_depth];
  if (isCoverageEntry(td)) {
    figures.push(td.actual, td.threshold);
  } else {
    figures.push(td.actual_pct, td.max_pct);
  }
  if (req.diversion_detail) {
    figures.push(req.diversion_detail.diversion_amount);
  }
  return figures;
}

function spotCheckHallucinations(text: string, req: NarrativeGenerationRequest): string[] {
  const warnings: string[] = [];
  const permitted = permittedDecimals(req);
  const decimals  = (text.match(/\d+\.\d+/g) ?? []).map(Number);
  for (const n of decimals) {
    const ok = permitted.some(p => Math.abs(p - n) < 0.015);
    if (!ok) {
      warnings.push(`figure ${n} not in permitted set [${permitted.join(', ')}]`);
    }
  }
  return warnings;
}

// Strip EXC_{YYYYQ#}_ prefix to recover the original test_id / limit_id.
function idBodyFromExceptionId(excId: string): string {
  return excId.replace(/^EXC_\d{4}Q\d_/, '');
}

function buildRequest(
  exc: ExceptionEntry,
  report: TrusteeReport,
  extractionOutput: ExtractionOutput,
): NarrativeGenerationRequest {
  const idBody = idBodyFromExceptionId(exc.exception_id);

  let testDetail: CoverageTestEntry | ConcentrationLimitEntry;
  let indentureText: string;

  if (exc.exception_type === 'OC_BREACH' || exc.exception_type === 'IC_BREACH') {
    const entry = report.coverage_test_summary.entries.find(e => e.test_id === idBody);
    testDetail  = entry ?? report.coverage_test_summary.entries.find(e => e.result === 'FAIL')!;

    const src = extractionOutput.coverage_tests.find(t => t.test_id === idBody);
    indentureText = src
      ? [
          src.description,
          `Numerator: ${src.numerator}`,
          `Denominator: ${src.denominator}`,
          `Failure action: ${src.failure_action}`,
          `Source: ${src.source_clause}`,
        ].join('\n')
      : exc.indenture_section;
  } else {
    const entry = report.concentration_limit_summary.entries.find(e => e.limit_id === idBody);
    testDetail  = entry ?? report.concentration_limit_summary.entries.find(e => e.result === 'FAIL')!;

    const src = extractionOutput.concentration_limits.find(l => l.limit_id === idBody);
    indentureText = src
      ? [
          src.description,
          `Dimension: ${src.dimension}`,
          `Maximum: ${src.max_pct}%`,
          `Calculation basis: ${src.calculation_basis}`,
          `Source: ${src.source_clause}`,
        ].join('\n')
      : exc.indenture_section;
  }

  // Link diversion if one was triggered for this test.
  const testId           = isCoverageEntry(testDetail) ? testDetail.test_id : undefined;
  const diversionDetail: DiversionEntry | null =
    exc.diversion_triggered && report.diversion_summary && testId
      ? (report.diversion_summary.entries.find(d => d.triggering_test === testId) ?? null)
      : null;

  return { exception: exc, indenture_section_text: indentureText, test_detail: testDetail, diversion_detail: diversionDetail };
}

function validateNarrative(
  raw: string,
  req: NarrativeGenerationRequest,
): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  let text = raw.trim();

  if (wordCount(text) > MAX_WORDS) {
    warnings.push(`word count ${wordCount(text)} exceeds ${MAX_WORDS} — truncated`);
    text = truncateToWords(text, MAX_WORDS);
  }

  const hallucinations = spotCheckHallucinations(text, req);
  warnings.push(...hallucinations.map(w => `hallucination check: ${w}`));

  return { text, warnings };
}

export class ExceptionNarrativeGenerator {
  constructor(private readonly client: Anthropic) {}

  async generateNarratives(
    report: TrusteeReport,
    extractionOutput: ExtractionOutput,
  ): Promise<ExceptionNarrative[]> {
    if (!report.exception_register) return [];

    const narratives: ExceptionNarrative[] = [];

    for (const exc of report.exception_register.entries) {
      const req         = buildRequest(exc, report, extractionOutput);
      const userMessage = buildNarrativeUserMessage(req);

      const response = await this.client.messages.create({
        model:      MODEL,
        max_tokens: 400,
        system:     EXCEPTION_NARRATIVE_SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      });

      const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const { text, warnings } = validateNarrative(rawText, req);

      if (warnings.length > 0 && process.env.BARLOW_VERBOSE) {
        warnings.forEach(w => process.stderr.write(`  [5B WARN] ${exc.exception_id}: ${w}\n`));
      }

      narratives.push({
        exception_id:   exc.exception_id,
        narrative:      text,
        generated_by:   'BARLOW_5B',
        model:          MODEL,
        prompt_version: PROMPT_VERSION,
      });
    }

    return narratives;
  }
}
