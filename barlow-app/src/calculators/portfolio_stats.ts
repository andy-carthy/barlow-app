import type { LoanPosition } from '../types/loan';
import type { PortfolioCharacteristics } from '../types/report';

// Moody's equivalent rating factors keyed by S&P rating.
const RATING_FACTORS: Record<string, number> = {
  'AAA': 1,
  'AA+': 10,   'AA': 20,   'AA-': 40,
  'A+':  70,   'A':  120,  'A-':  180,
  'BBB+':260,  'BBB':360,  'BBB-':610,
  'BB+': 940,  'BB': 1350, 'BB-': 1766,
  'B+':  2220, 'B':  2720, 'B-':  3490,
  'CCC+':4770, 'CCC':6500, 'CCC-':8070,
  'CC':  10000,'C':  10000,'D':   10000,
  'NR':  5000,
};

const CCC_AND_BELOW = new Set(['CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D']);

function ratingFactor(rating: string | undefined): number {
  if (!rating) return RATING_FACTORS['NR'];
  const upper = rating.toUpperCase().trim();
  return RATING_FACTORS[upper] ?? RATING_FACTORS['NR'];
}

function daysBetween(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
}

export function computePortfolioCharacteristics(
  loans: LoanPosition[],
  reportDate: string,
): PortfolioCharacteristics {
  if (loans.length === 0) {
    return {
      report_date: reportDate, loan_count: 0, total_par: 0,
      weighted_avg_spread: 0, weighted_avg_life: 0,
      weighted_avg_rating_factor: 0, diversity_score: 0,
      ccc_pct: 0, floating_rate_pct: 0, top_10_obligor_pct: 0,
    };
  }

  const totalPar = loans.reduce((s, l) => s + l.principal_balance, 0);

  // WAS
  const was = loans.reduce((s, l) => s + l.spread * l.principal_balance, 0) / totalPar;

  // WAL — years from report_date to maturity, par-weighted
  const wal = loans.reduce((s, l) => {
    const yrs = Math.max(0, daysBetween(reportDate, l.maturity_date) / 365.25);
    return s + yrs * l.principal_balance;
  }, 0) / totalPar;

  // WARF — S&P rating factor, par-weighted
  const warf = loans.reduce((s, l) => {
    return s + ratingFactor(l.sp_rating) * l.principal_balance;
  }, 0) / totalPar;

  // Diversity score: total_par^2 / sum(industry_par^2)
  const industryPar: Record<string, number> = {};
  loans.forEach(l => {
    const ind = l.industry ?? 'Unknown';
    industryPar[ind] = (industryPar[ind] ?? 0) + l.principal_balance;
  });
  const sumSqIndustry = Object.values(industryPar).reduce((s, p) => s + p * p, 0);
  const diversityScore = sumSqIndustry > 0 ? (totalPar * totalPar) / sumSqIndustry : 0;

  // CCC%
  const cccPar = loans
    .filter(l => CCC_AND_BELOW.has((l.sp_rating ?? '').toUpperCase().trim()))
    .reduce((s, l) => s + l.principal_balance, 0);
  const cccPct = (cccPar / totalPar) * 100;

  // Floating rate %
  const floatingPar = loans
    .filter(l => l.reference_rate !== 'FIXED')
    .reduce((s, l) => s + l.principal_balance, 0);
  const floatingPct = (floatingPar / totalPar) * 100;

  // Top 10 obligor concentration
  const obligorPar: Record<string, number> = {};
  loans.forEach(l => {
    const id = l.obligor_id || l.obligor_name;
    obligorPar[id] = (obligorPar[id] ?? 0) + l.principal_balance;
  });
  const sorted = Object.values(obligorPar).sort((a, b) => b - a);
  const top10Sum = sorted.slice(0, 10).reduce((s, v) => s + v, 0);
  const top10Pct = (top10Sum / totalPar) * 100;

  function r2(n: number): number { return Math.round(n * 100) / 100; }

  return {
    report_date:                reportDate,
    loan_count:                 loans.length,
    total_par:                  r2(totalPar),
    weighted_avg_spread:        r2(was),
    weighted_avg_life:          r2(wal),
    weighted_avg_rating_factor: Math.round(warf),
    diversity_score:            r2(diversityScore),
    ccc_pct:                    r2(cccPct),
    floating_rate_pct:          r2(floatingPct),
    top_10_obligor_pct:         r2(top10Pct),
  };
}
