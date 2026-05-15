import type { Request, Response } from 'express';
import { parseLMSTape } from '../../barlow-app/src/parsers/lms_tape_parser';
import { validateLoanTape } from '../../barlow-app/src/validators/loan_tape_validator';

export async function ingestTapeRoute(req: Request, res: Response): Promise<void> {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv?.trim()) {
      res.json({ data: null, error: 'No CSV content provided' });
      return;
    }

    const positions  = parseLMSTape(csv);
    const validation = validateLoanTape(positions);

    const totalPar      = positions.reduce((s, p) => s + p.par, 0);
    const seniorSecured = positions.filter(p => p.loan_type === 'SENIOR_SECURED');
    const secondLien    = positions.filter(p => p.loan_type === 'SECOND_LIEN');
    const ratedCount    = positions.filter(p => p.rating && p.rating !== 'NR').length;

    const summary = {
      position_count:    positions.length,
      total_par:         totalPar,
      senior_secured_pct: totalPar > 0 ? (seniorSecured.reduce((s, p) => s + p.par, 0) / totalPar) * 100 : 0,
      second_lien_pct:   totalPar > 0 ? (secondLien.reduce((s, p) => s + p.par, 0) / totalPar) * 100 : 0,
      other_pct:         totalPar > 0 ? ((totalPar - seniorSecured.reduce((s,p)=>s+p.par,0) - secondLien.reduce((s,p)=>s+p.par,0)) / totalPar) * 100 : 0,
      rating_coverage_pct: positions.length > 0 ? (ratedCount / positions.length) * 100 : 0,
      validation_errors: validation.errors,
    };

    res.json({ data: { positions, summary }, error: null });
  } catch (e) {
    res.json({ data: null, error: (e as Error).message });
  }
}
