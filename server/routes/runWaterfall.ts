import type { Request, Response } from 'express';
import { runWaterfall } from '../../barlow-app/src/engines/waterfall_engine';
import type { WaterfallEngineInput } from '../../barlow-app/src/engines/waterfall_engine';
import type { DiversionLedger } from '../../barlow-app/src/types/waterfall';

export async function runWaterfallRoute(req: Request, res: Response): Promise<void> {
  try {
    const input = req.body as WaterfallEngineInput;

    if (!input?.waterfall_steps || !input?.collections || !input?.note_balances) {
      res.json({ data: null, error: 'Missing required waterfall inputs: waterfall_steps, collections, note_balances' });
      return;
    }

    const allocationLedger = runWaterfall(input);

    // Extract diversion ledger from the allocation entries
    const diversionEntries = allocationLedger.entries
      .filter(e => e.step_type === 'COVERAGE_TEST_CHECK' && e.amount_paid > 0)
      .map(e => ({
        step_id:          e.step_id,
        step_number:      e.step_number,
        triggering_test:  e.step_id,
        diversion_amount: e.amount_paid,
        cure_mechanism:   'REINVESTMENT' as const,
        diversion_target: {
          step_type:           'REINVESTMENT' as const,
          note_class_priority: [],
          description:         'Reinvestment/cure account',
        },
      }));

    const diversionLedger: DiversionLedger = {
      period_start:    input.collections.period_start,
      period_end:      input.collections.period_end,
      payment_date:    input.collections.payment_date,
      total_diverted:  diversionEntries.reduce((s, e) => s + e.diversion_amount, 0),
      entries:         diversionEntries,
    };

    res.json({ data: { allocationLedger, diversionLedger }, error: null });
  } catch (e) {
    res.json({ data: null, error: (e as Error).message });
  }
}
