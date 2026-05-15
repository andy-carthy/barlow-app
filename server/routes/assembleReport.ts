import type { Request, Response } from 'express';
import { TrusteeReportAssembler } from '../../barlow-app/src/assemblers/trustee_report_assembler';
import { TrusteeReportRenderer } from '../../barlow-app/src/renderers/trustee_report_renderer';
import type { ExtractionOutput } from '../../barlow-app/src/types/extraction_output';
import type { LoanPosition } from '../../barlow-app/src/types/loan';
import type { WaterfallAllocationLedger, NoteBalanceSnapshot } from '../../barlow-app/src/types/waterfall';
import type { ReportMeta } from '../../barlow-app/src/assemblers/trustee_report_assembler';

export async function assembleReportRoute(req: Request, res: Response): Promise<void> {
  try {
    const { extraction, positions, coverageResults, concentrationResults, allocationLedger, noteBalances, reportMeta } = req.body as {
      extraction?:           ExtractionOutput;
      positions?:            LoanPosition[];
      coverageResults?:      unknown[];
      concentrationResults?: unknown[];
      allocationLedger?:     WaterfallAllocationLedger;
      noteBalances?:         NoteBalanceSnapshot;
      reportMeta?:           ReportMeta;
    };

    if (!extraction || !allocationLedger || !noteBalances || !reportMeta) {
      res.json({ data: null, error: 'Missing required fields: extraction, allocationLedger, noteBalances, reportMeta' });
      return;
    }

    const assembler = new TrusteeReportAssembler();
    const renderer  = new TrusteeReportRenderer();

    const report = assembler.assemble(
      extraction,
      positions ?? [],
      (coverageResults ?? []) as Parameters<typeof assembler.assemble>[2],
      (concentrationResults ?? []) as Parameters<typeof assembler.assemble>[3],
      allocationLedger,
      noteBalances,
      reportMeta,
    );

    const markdown = renderer.toMarkdown(report);

    res.json({ data: { report, markdown }, error: null });
  } catch (e) {
    res.json({ data: null, error: (e as Error).message });
  }
}
