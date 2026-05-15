import type { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { parseAgentNotice } from '../../barlow-app/src/extractors/notice_extractor';
import { matchNoticeToLoans, applyNoticeUpdate } from '../../barlow-app/src/reconciliation/notice_reconciler';
import type { LoanPosition } from '../../barlow-app/src/types/loan';

export async function processNoticeRoute(req: Request, res: Response): Promise<void> {
  try {
    const { noticeText, positions } = req.body as { noticeText?: string; positions?: LoanPosition[] };

    if (!noticeText?.trim()) {
      res.json({ data: null, error: 'No notice text provided' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.json({ data: null, error: 'ANTHROPIC_API_KEY not set on server' });
      return;
    }

    const client = new Anthropic({ apiKey });

    // Monkey-patch callClaude used internally by parseAgentNotice to use SDK
    // The notice extractor imports callClaude from api/claude.ts which does browser fetch.
    // We re-implement the API call here using the SDK and pass the result through.
    const { NOTICE_EXTRACTION_SYSTEM_PROMPT, buildNoticeUserMessage } =
      await import('../../barlow-app/src/prompts/notice_extraction_prompt');

    const tape = positions ?? [];
    const userMessage = buildNoticeUserMessage(noticeText, tape);

    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system:     NOTICE_EXTRACTION_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    });

    const raw   = (message.content[0] as { type: string; text: string }).text;
    const clean = raw.replace(/```json\s*|```\s*/g, '').trim();
    const parsed = JSON.parse(clean);

    const logs: Array<{ level: string; message: string }> = [];
    const changeLog = applyNoticeUpdate(parsed, tape, logs);

    res.json({ data: { changeLog, notice: parsed, logs }, error: null });
  } catch (e) {
    res.json({ data: null, error: (e as Error).message });
  }
}
