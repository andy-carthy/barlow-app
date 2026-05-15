import type { Request, Response } from 'express';
import type { LoanPosition } from '../../barlow-app/src/types/loan';
import type { ExtractionOutput } from '../../barlow-app/src/types/extraction_output';

// testRunner.js uses CommonJS exports; import via require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runOCTests, runICTests, runConcentrationTests } = require('../../barlow-app/src/engine/testRunner.js');

export async function runTestsRoute(req: Request, res: Response): Promise<void> {
  try {
    const { extraction, positions } = req.body as {
      extraction?: ExtractionOutput;
      positions?:  LoanPosition[];
    };

    if (!extraction) {
      res.json({ data: null, error: 'No extraction output provided' });
      return;
    }

    const tape = positions ?? [];

    const coverageResults      = [...runOCTests(extraction, tape), ...runICTests(extraction, tape)];
    const concentrationResults = runConcentrationTests(extraction, tape);

    res.json({ data: { coverageResults, concentrationResults }, error: null });
  } catch (e) {
    res.json({ data: null, error: (e as Error).message });
  }
}
