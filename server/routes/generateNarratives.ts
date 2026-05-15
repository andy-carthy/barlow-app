import type { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { EXCEPTION_NARRATIVE_SYSTEM_PROMPT, buildNarrativeUserMessage } from '../../barlow-app/src/prompts/exception_narrative_prompt';
import type { TrusteeReport, ExceptionEntry } from '../../barlow-app/src/types/report';
import type { ExtractionOutput } from '../../barlow-app/src/types/extraction_output';
import type { NarrativeGenerationRequest } from '../../barlow-app/src/prompts/exception_narrative_prompt';

const PROMPT_VERSION = '5B.1';

function idBodyFromExceptionId(exceptionId: string): string {
  return exceptionId.replace(/^EXC_\d{4}Q\d_/, '');
}

function isCoverageEntry(d: unknown): d is { test_id: string; threshold: number; actual: number } {
  return typeof d === 'object' && d !== null && 'threshold' in d;
}

function buildRequest(
  exc: ExceptionEntry,
  report: TrusteeReport,
  extraction: ExtractionOutput,
): NarrativeGenerationRequest | null {
  const testId = idBodyFromExceptionId(exc.exception_id);

  // Find test detail in report summaries
  let test_detail: NarrativeGenerationRequest['test_detail'] | null = null;
  const covEntry = report.coverage_test_summary?.entries.find(e => e.test_id === testId);
  if (covEntry) {
    test_detail = covEntry as NarrativeGenerationRequest['test_detail'];
  } else {
    const concEntry = report.concentration_limit_summary?.entries.find(e => e.limit_id === testId);
    if (concEntry) test_detail = concEntry as NarrativeGenerationRequest['test_detail'];
  }

  if (!test_detail) return null;

  // Get indenture section text
  let indenture_section_text = exc.indenture_section ?? '';
  if (isCoverageEntry(test_detail)) {
    const ct = extraction.coverage_tests.find(t => t.test_id === testId);
    if (ct) indenture_section_text = ct.description + '\n' + (ct.failure_action ?? '');
  } else {
    const cl = extraction.concentration_limits.find(l => l.limit_id === testId);
    if (cl) indenture_section_text = cl.description + '\n' + (cl.calculation_basis ?? '');
  }

  // Find diversion
  const diversion_detail = report.diversion_summary?.entries.find(
    d => d.triggering_test === testId || d.triggering_test === exc.exception_id,
  ) ?? null;

  return { exception: exc, indenture_section_text, test_detail, diversion_detail };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function truncateTo150(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 150) return text.trim();
  return words.slice(0, 150).join(' ') + '…';
}

export async function generateNarrativesRoute(req: Request, res: Response): Promise<void> {
  const { report, extractionOutput } = req.body as {
    report?:          TrusteeReport;
    extractionOutput?: ExtractionOutput;
  };

  if (!report?.exception_register?.entries?.length || !extractionOutput) {
    res.json({ data: { narratives: [] }, error: null });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ data: null, error: 'ANTHROPIC_API_KEY not set on server' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const client = new Anthropic({ apiKey });
  const exceptions = report.exception_register.entries;

  for (const exc of exceptions) {
    const narrativeReq = buildRequest(exc, report, extractionOutput);
    if (!narrativeReq) {
      send({ type: 'skip', exception_id: exc.exception_id, reason: 'no test detail found' });
      continue;
    }

    send({ type: 'start', exception_id: exc.exception_id });

    let fullText = '';

    try {
      const stream = client.messages.stream({
        model:      'claude-sonnet-4-6',
        max_tokens: 400,
        system:     EXCEPTION_NARRATIVE_SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: buildNarrativeUserMessage(narrativeReq) }],
      });

      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          const token = chunk.delta.text;
          fullText += token;
          send({ type: 'token', exception_id: exc.exception_id, token });
        }
      }

      const narrative = truncateTo150(fullText);
      send({
        type:         'complete',
        exception_id: exc.exception_id,
        narrative,
        generated_by: 'BARLOW_5B',
        prompt_version: PROMPT_VERSION,
        model:        'claude-sonnet-4-6',
        word_count:   wordCount(narrative),
      });
    } catch (e) {
      send({ type: 'error', exception_id: exc.exception_id, message: (e as Error).message });
    }
  }

  send({ type: 'done' });
  res.end();
}
