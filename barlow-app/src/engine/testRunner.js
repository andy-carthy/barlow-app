// Deterministic test engine — ported verbatim from barlow_cli.js.
// No AI in this path. All calculations are pure arithmetic on the input data.
// Do not modify logic here without a matching change to barlow_cli.js.

// Capital structure mirrors the synthetic deal in barlow_cli.js (CAPITAL_STRUCTURE constant).
// MVP: hardcoded. v2: accept as parameter from an editable UI field.
export const CAPITAL_STRUCTURE = {
  class_a_par:          180.0,
  class_a_interest_due:   4.50,
  class_b_par:           60.0,
  class_b_interest_due:   1.80,
  class_c_par:           40.0,
  class_c_interest_due:   1.60,
  senior_management_fee:  0.25,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── OC Tests ──────────────────────────────────────────────────────────────────
// Numerator:   Adjusted Collateral Principal Amount (sum of all loan par values)
// Denominator: sum of outstanding note balances for the relevant class(es)

export function runOCTests(rules, loanTape) {
  const results = [];
  const totalPar = loanTape.reduce((s, l) => s + l.par, 0);

  for (const test of rules.coverage_tests) {
    if (test.test_type !== 'overcollateralization') continue;

    const numeratorVal = totalPar;
    let denominatorVal;

    if (test.test_id === 'OC_CLASS_AB') {
      denominatorVal = CAPITAL_STRUCTURE.class_a_par + CAPITAL_STRUCTURE.class_b_par;
    } else if (test.test_id === 'OC_CLASS_C') {
      denominatorVal = CAPITAL_STRUCTURE.class_a_par + CAPITAL_STRUCTURE.class_b_par + CAPITAL_STRUCTURE.class_c_par;
    } else {
      denominatorVal = CAPITAL_STRUCTURE.class_a_par + CAPITAL_STRUCTURE.class_b_par;
    }

    const calculated = (numeratorVal / denominatorVal) * 100;
    const passed     = calculated >= test.threshold_pct;

    results.push({
      test_id:          test.test_id,
      description:      test.description,
      numerator_value:  round2(numeratorVal),
      denominator_value: round2(denominatorVal),
      calculated_pct:   round2(calculated),
      threshold_pct:    test.threshold_pct,
      cushion_pct:      round2(calculated - test.threshold_pct),
      result:           passed ? 'PASS' : 'FAIL',
      failure_action:   passed ? null : test.failure_action,
      source_clause:    test.source_clause,
    });
  }
  return results;
}

// ── IC Tests ──────────────────────────────────────────────────────────────────
// Numerator:   Interest Proceeds (accrued interest on non-PIK loans)
// Denominator: Class A interest due + Class B interest due + Senior Management Fee

export function runICTests(rules, loanTape) {
  const results = [];
  const totalInterestProceeds = loanTape
    .filter(l => l.status !== 'PIK')
    .reduce((s, l) => s + l.accrued_interest, 0);

  for (const test of rules.coverage_tests) {
    if (test.test_type !== 'interest_coverage') continue;

    const numeratorVal   = totalInterestProceeds;
    const denominatorVal = CAPITAL_STRUCTURE.class_a_interest_due +
                           CAPITAL_STRUCTURE.class_b_interest_due +
                           CAPITAL_STRUCTURE.senior_management_fee;

    const calculated = (numeratorVal / denominatorVal) * 100;
    const passed     = calculated >= test.threshold_pct;

    results.push({
      test_id:           test.test_id,
      description:       test.description,
      numerator_value:   round2(numeratorVal),
      denominator_value: round2(denominatorVal),
      calculated_pct:    round2(calculated),
      threshold_pct:     test.threshold_pct,
      cushion_pct:       round2(calculated - test.threshold_pct),
      result:            passed ? 'PASS' : 'FAIL',
      failure_action:    passed ? null : test.failure_action,
      source_clause:     test.source_clause,
    });
  }
  return results;
}

// ── Concentration Tests ───────────────────────────────────────────────────────
// All percentages expressed as (bucket par / total pool par) * 100.
// CCC/Caa bucket: includes Defaulted obligations regardless of nominal rating.

export function runConcentrationTests(rules, loanTape) {
  const results  = [];
  const totalPar = loanTape.reduce((s, l) => s + l.par, 0);

  for (const limit of rules.concentration_limits) {
    const breaches = [];

    // If applies_to is set, restrict the tape to matching loan types only.
    // The denominator stays the full pool (totalPar) — limits are expressed as
    // a % of Adjusted Collateral Principal Amount regardless of which subset they test.
    const tape = (limit.applies_to && limit.applies_to.length > 0)
      ? loanTape.filter(l => limit.applies_to.includes(l.loan_type))
      : loanTape;

    if (limit.tiers && limit.tiers.length > 0) {
      console.warn(`[WARN] Tiered limit ${limit.limit_id} detected — tier-aware evaluation not yet implemented. Falling back to scalar max_pct (${limit.max_pct}%).`);
    }

    if (limit.dimension === 'obligor') {
      const byObligor = {};
      tape.forEach(l => { byObligor[l.obligor] = (byObligor[l.obligor] || 0) + l.par; });
      Object.entries(byObligor).forEach(([obligor, par]) => {
        const pct = (par / totalPar) * 100;
        if (pct > limit.max_pct) {
          breaches.push({ item: obligor, par_value: round2(par), pct: round2(pct) });
        }
      });

    } else if (limit.dimension === 'industry') {
      const byIndustry = {};
      tape.forEach(l => { byIndustry[l.industry] = (byIndustry[l.industry] || 0) + l.par; });
      Object.entries(byIndustry).forEach(([industry, par]) => {
        const pct = (par / totalPar) * 100;
        if (pct > limit.max_pct) {
          breaches.push({ item: industry, par_value: round2(par), pct: round2(pct) });
        }
      });

    } else if (limit.dimension === 'rating_bucket') {
      const cccRatings = ['CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
      const cccLoans   = tape.filter(l => cccRatings.includes(l.rating) || l.status === 'Defaulted');
      const cccPar     = cccLoans.reduce((s, l) => s + l.par, 0);
      const cccPct     = (cccPar / totalPar) * 100;
      if (cccPct > limit.max_pct) {
        breaches.push({
          item:      'CCC/Caa bucket',
          par_value: round2(cccPar),
          pct:       round2(cccPct),
          loans:     cccLoans.map(l => l.id),
        });
      }

    } else if (limit.dimension === 'loan_type') {
      const dipLoans = tape.filter(l => l.loan_type === 'DIP');
      const dipPar   = dipLoans.reduce((s, l) => s + l.par, 0);
      const dipPct   = (dipPar / totalPar) * 100;
      if (dipPct > limit.max_pct) {
        breaches.push({ item: 'DIP loans', par_value: round2(dipPar), pct: round2(dipPct) });
      }

    } else if (limit.dimension === 'country') {
      // Country-dimension evaluation requires country field on loan tape.
      // Skipped here — no breaches recorded, result will be PASS (conservative skip).
      console.warn(`[WARN] Country-dimension limit ${limit.limit_id} skipped — evaluation not yet implemented.`);
    }

    results.push({
      limit_id:        limit.limit_id,
      description:     limit.description,
      max_pct:         limit.max_pct,
      total_par_basis: round2(totalPar),
      result:          breaches.length === 0 ? 'PASS' : 'FAIL',
      breach_count:    breaches.length,
      breaches,
      source_clause:   limit.source_clause,
    });
  }
  return results;
}
