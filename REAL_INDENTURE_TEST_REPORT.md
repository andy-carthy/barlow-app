# Barlow Phase 1 — Real Indenture Test Report
**Deal tested:** Carlyle Direct Lending CLO 2024-1, LLC (EDGAR CIK 1702510)
**Indenture date:** October 29, 2024
**Trustee:** Wilmington Trust, National Association
**Source:** SEC EDGAR, EX-10.1 filed 2024
**Test date:** 2026-05-11
**Input:** Focused excerpt (12,903 chars) covering definitions, concentration limits, and waterfall

---

## 1. Extraction Results

| Category | Extracted | Notes |
|---|---|---|
| Deal name | ✓ Correct | "Carlyle Direct Lending CLO 2024-1, LLC" |
| Coverage tests | 6 | 2 per class (OC + IC) × 3 classes (A/B, C, D) |
| Concentration limits | 17 | vs 4 in synthetic |
| Waterfall steps | 14 | At least 4 more steps were truncated |
| Overall confidence | HIGH | But 8 material flags raised |

---

## 2. Extraction Accuracy — Coverage Tests

All 6 test thresholds were extracted **correctly** from the real indenture.

| Test ID | Extracted | Actual | Status |
|---|---|---|---|
| OC_CLASS_AB | 137.06% | 137.06% | ✓ |
| IC_CLASS_AB | 120.00% | 120.00% | ✓ |
| OC_CLASS_C | 123.58% | 123.58% | ✓ |
| IC_CLASS_C | 110.00% | 110.00% | ✓ |
| OC_CLASS_D | 115.95% | 115.95% | ✓ |
| IC_CLASS_D | 105.00% | 105.00% | ✓ |

Source clause attribution was correct (Section 11.1.1.2.1.x waterfall subsections).

**Degradation note:** The validation step in the CLI reported OC_CLASS_AB and OC_CLASS_C as *failures* because it compares against hardcoded synthetic expected values (123.5% / 112.75%). This is a CLI design bug — the ground truth check must be disabled or replaced when running against a real indenture.

---

## 3. Extraction Accuracy — Concentration Limits

The real indenture has 14 named concentration limit clauses. All 17 extracted limits were real (no hallucinations).

| Limit ID | Extracted % | Actual % | Status | Notes |
|---|---|---|---|---|
| SENIOR_SECURED_MINIMUM | 92.5% | 92.5% | ✓ | |
| NON_SENIOR_SECURED_MAX | 7.5% | 7.5% | ✓ | |
| FIRST_LIEN_LAST_OUT | 7.5% | 7.5% | ✓ | |
| PERMITTED_DEBT_SECURITIES | 5.0% | 5.0% | ✓ | |
| SINGLE_OBLIGOR_GENERAL | 3.0% | 3.0% | ✓ | |
| SINGLE_OBLIGOR_ENHANCED | 3.5% | 3.5% | ✓ | Up to 3 obligors at higher limit |
| SINGLE_OBLIGOR_SUBORDINATED | 1.5% | 1.5% | ✓ | Applies to sub-debt types only |
| CCC_BUCKET | 17.5% | 17.5% | ✓ | Correctly 17.5%, not 7.5% |
| NON_QUARTERLY_PAY | 5.0% | 5.0% | ✓ | |
| FIXED_RATE | 5.0% | 5.0% | ✓ | |
| CURRENT_PAY | 5.0% | 5.0% | ✓ | |
| DIP | 5.0% | 5.0% | ✓ | |
| UNFUNDED_COMMITMENTS | 10.0% | 10.0% | ✓ | |
| DEFERRABLE_OBLIGATIONS | 5.0% | 5.0% | ✓ | |
| PARTIAL_DEFERRING | 2.5% | 2.5% | ✓ | |
| PARTICIPATION_INTERESTS | 10.0% | 10.0% | ✓ | |
| MOODY_FITCH_DERIVED | 10.0% | 10.0% | ✓ | Limit on S&P ratings derived from Mdy/Fitch |

**Missing limits (not extracted):**
- Country limits (clause 13): tiered structure with 7 sub-limits — **partially truncated in excerpt**
- Industry limit (clause 14): tiered (12% / 20% / 17%) — **partially truncated in excerpt**
- Third Party Credit Exposure Limits (clause 11): referenced, not defined in excerpt
- Interest Diversion Test threshold: referenced, not in excerpt

**Tiered structure degradation:** The schema uses a single `max_pct` field per limit. The real indenture has tiered industry limits (standard 12%, largest industry 20%, second-largest 17%) that don't map to a scalar. The extractor produced one row for MOODY_FITCH_DERIVED at 10% and captured the single-obligor tiers as 3 separate rows — a reasonable workaround, but the industry tiering was lost entirely.

---

## 4. Test Runner Misapplication (Schema Mismatch)

Running the deterministic test engine against the synthetic loan tape with the real indenture's rules produced **false breaches** because:

| Problem | Root Cause |
|---|---|
| SINGLE_OBLIGOR_SUBORDINATED: 36 breaches | Loan tape had no `loan_type` field. Engine applied the 1.5% subordinated limit to all loans, but this limit only applies to Permitted Debt Securities, First Lien Last Out Loans, Second Lien Loans, and Unsecured Loans. All 37 synthetic loans are senior secured — this limit does not apply. **Fixed in Step 3: `loan_type` field added; runner now filters by `applicable_loan_types`.** |
| MOODY_FITCH_DERIVED "breach" | Engine matched CCC-rated loans to this limit, but the limit is about *source of rating* (derived from Mdy/Fitch rather than direct S&P), not credit quality. A completely different field would be needed to evaluate this correctly. |
| Country limits not tested | Not in schema — no `country`-dimension limit rows were produced because the excerpt was truncated |

**Coverage tests ran correctly** — all 6 passed against the synthetic pool, with the real thresholds (137.06% OC for A/B vs 150.21% calculated).

---

## 5. Waterfall Extraction Quality

14 steps captured. The waterfall structure was correctly identified as multi-class with diversion triggers:

- Steps 1–6: taxes → admin expenses → management fee → Class A-1/A-L → Class A-2 → Class B ✓
- Steps 7/9/12: inline OC/IC cure triggers per class ✓ (complex conditional logic preserved)
- Steps 8/10/11/13: deferrable interest handling for C and D ✓
- Step 14: Interest Diversion Test reinvestment ✓

**Truncated / missing:** 4–6 additional steps covering Subordinate Management Fee, Incentive Management Fee, Preferred Interest distributions, and principal recycling were cut off by excerpt boundary.

---

## 6. Extraction Flags (8 flagged, all valid)

The model correctly flagged every material gap. Notable:

1. `Adjusted Collateral Principal Amount definition not provided` — This is the denominator for every OC and concentration calculation. Without it, computed ratios are approximate.
2. `Debt Payment Sequence not defined` — Used in 3 waterfall steps but never defined in the excerpt; model correctly flagged rather than hallucinating.
3. `Collateral Interest Amount not fully provided` — Numerator for IC ratio.
4. `Waterfall continues beyond step 14` — Correct: the full waterfall has ~20 steps.

**Confidence calibration was conservative and accurate** — HIGH assigned to everything extracted, flags raised for everything unresolved. No confident hallucinations detected.

---

## 7. Token Budget

| Run | max_tokens | Outcome |
|---|---|---|
| First attempt | 4,000 | JSON truncated mid-string — `Unterminated string in JSON at position 14001` |
| Second attempt | 8,000 | Full extraction completed |

**Finding:** Real indentures produce richer extractions (~4–5× more concentration limits than synthetic). The 4,000 token default in barlow_cli.js is insufficient; 8,000 is the minimum working limit.

---

## 8. Summary: Where It Holds Up vs. Degrades

### Holds up
- All numeric OC/IC thresholds extracted with correct values and section citations
- All explicitly stated concentration limit percentages extracted correctly (17 of 17 present in excerpt)
- No hallucinations — every extracted value was present in the text
- Confidence flags accurate: 8 real gaps identified, no false flags
- Waterfall structure and conditional diversion logic correctly captured for 14 steps
- Multi-class coverage test structure (A/B, C, D) correctly handled

### Degrades
| Issue | Severity | Fix Required |
|---|---|---|
| CLI validation step uses synthetic ground truth | Medium | Disable or parameterize when running real indenture |
| Tiered limits (industry 12%/20%/17%) don't fit scalar schema | High | Schema needs `tiers` array field |
| Test runner applies sub-debt limits to senior-secured-only tape | High | ✓ Fixed (Step 3): `loan_type` added to loan tape; runner filters by `applicable_loan_types` |
| Country limit cluster (7 sub-limits) lost when excerpt truncates | Medium | Either pass full definitions section or handle multi-row country limits |
| 4k token limit insufficient | Critical (now fixed) | Set max_tokens=8000 as default |
| Cross-referenced definitions unresolvable from excerpt | Low | Provide full definitions section (Section 1.1), not just selected passages |
