#!/usr/bin/env node

/**
 * BARLOW — CLO Indenture Extraction CLI
 * Phase 1 Proof of Concept
 *
 * Takes indenture text, calls Claude API, returns structured coverage test
 * definitions and concentration limits as verified JSON.
 *
 * Usage:
 *   node barlow_cli.js                    # runs against built-in synthetic indenture
 *   node barlow_cli.js --file path.txt    # runs against a text file
 *   node barlow_cli.js --verbose          # shows full extraction reasoning
 */

const https = require('https');
const fs    = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHETIC INDENTURE (Appendix A from spec — ground truth for validation)
// ─────────────────────────────────────────────────────────────────────────────

const SYNTHETIC_INDENTURE = `
BARLOW CLO I, LTD.
INDENTURE dated as of March 15, 2023

SECTION 11.1 — OVERCOLLATERALIZATION TESTS

(a) Class A/B Overcollateralization Test. On each Measurement Date, the Trustee
shall calculate the Class A/B Overcollateralization Ratio by dividing (i) the
Adjusted Collateral Principal Amount by (ii) the sum of the aggregate outstanding
principal balance of the Class A Notes and the Class B Notes. The Class A/B
Overcollateralization Ratio shall be required to be equal to or greater than
123.50% (the "Class A/B OC Threshold"). If on any Measurement Date the Class
A/B Overcollateralization Ratio is less than the Class A/B OC Threshold, then
the Priority of Payments set forth in Section 13.1 shall be modified as set forth
in Section 11.3. Cure: redirect interest proceeds to principal reinvestment
account until the Class A/B OC Threshold is restored.

(b) Class C Overcollateralization Test. On each Measurement Date, the Trustee
shall calculate the Class C Overcollateralization Ratio by dividing (i) the
Adjusted Collateral Principal Amount by (ii) the sum of the aggregate outstanding
principal balance of the Class A Notes, Class B Notes, and Class C Notes. The
Class C Overcollateralization Ratio shall be required to be equal to or greater
than 112.75% (the "Class C OC Threshold"). If the Class C OC Threshold is not
satisfied, interest proceeds shall be diverted as set forth in Section 13.1(c).

SECTION 11.2 — INTEREST COVERAGE TEST

(a) Class A/B Interest Coverage Test. On each Measurement Date, the Trustee
shall calculate the Class A/B Interest Coverage Ratio by dividing (i) the
Interest Proceeds received during the related Interest Accrual Period by (ii) the
sum of (A) accrued and unpaid interest on the Class A Notes, (B) accrued and
unpaid interest on the Class B Notes, and (C) the Senior Management Fee payable
on the related Payment Date. The Class A/B Interest Coverage Ratio shall be
required to be equal to or greater than 120.00% (the "Class A/B IC Threshold").
Failure to satisfy the Interest Coverage Test shall constitute an Interest
Coverage Test Failure and shall redirect Interest Proceeds as specified in
Section 13.1(b).

SECTION 12.2 — CONCENTRATION LIMITATIONS

The following Concentration Limitations shall apply to the Collateral Obligations
held by the Issuer as of each Measurement Date. All percentages are expressed as
a proportion of the Adjusted Collateral Principal Amount unless otherwise specified.

(a) Single Obligor Limit. The aggregate Principal Balance of Collateral
Obligations issued by any single Obligor (together with its Affiliates) shall not
exceed 3.00% of the Adjusted Collateral Principal Amount.

(b) Single Industry Limit. The aggregate Principal Balance of Collateral
Obligations in any single Moody's Industry Classification Group shall not exceed
15.00% of the Adjusted Collateral Principal Amount.

(c) CCC/Caa Bucket. The aggregate Principal Balance of Collateral Obligations
rated CCC+/Caa1 or below by S&P and Moody's, respectively (using the lower of
the two ratings), shall not exceed 7.50% of the Adjusted Collateral Principal
Amount. For purposes of this limitation, Defaulted Obligations shall be treated
as CCC/Caa-rated regardless of their nominal rating.

(d) DIP Loan Limit. The aggregate Principal Balance of Debtor-in-Possession
Loans shall not exceed 5.00% of the Adjusted Collateral Principal Amount.

SECTION 13.1 — PRIORITY OF PAYMENTS

On each Payment Date, the Trustee shall apply Interest Proceeds in the following
order of priority (the "Interest Waterfall"):

Step 1: Trustee fees and expenses (Senior Expenses), not to exceed $250,000 per annum.
Step 2: Senior Management Fee payable to the Collateral Manager.
Step 3: Hedge payments due to Hedge Counterparties (excluding termination payments).
Step 4: Accrued and unpaid interest on the Class A Notes at the applicable rate.
Step 5: Accrued and unpaid interest on the Class B Notes — provided Class A/B OC
        Test is satisfied; otherwise redirect to Step 8.
Step 6: Accrued and unpaid interest on the Class C Notes — provided Class C OC
        Test is satisfied; otherwise redirect to Step 8.
Step 7: Subordinate Management Fee payable to the Collateral Manager.
Step 8: Reinvestment/cure — principal reinvestment account or pro rata paydown
        of Notes in reverse order of seniority until OC tests are cured.
`;

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHETIC LOAN TAPE (Appendix B from spec)
//
// Loan tape field schema:
//   id                string   Unique loan identifier (L001–L037)
//   obligor           string   Borrower name (affiliates share the same name for single-obligor grouping)
//   industry          string   Moody's Industry Classification Group name
//   country           string   ISO country code of obligor domicile (optional; used by dimension:"country"
//                              concentration limits via applies_to_values; absent treated as unclassified)
//   par               number   Outstanding principal balance ($M)
//   spread            number   Spread over SOFR (bps)
//   rating            string   Lower of S&P / Moody's rating (e.g. 'B', 'BB', 'CCC')
//   status            string   Payment status: 'Current' | 'PIK' | 'Defaulted'
//   accrued_interest  number   Interest accrued in the period ($M); 0 for PIK loans
//   loan_type         string   Asset class for dimension-filtered concentration limits:
//                                SENIOR_SECURED          — first-lien senior secured (default for all synthetic loans)
//                                FIRST_LIEN_LAST_OUT     — first-lien last-out tranche
//                                SECOND_LIEN             — second-lien term loan
//                                PERMITTED_DEBT_SECURITY — bonds / notes (not loans)
//                                UNSECURED               — unsecured term loan
//                              Limits such as SINGLE_OBLIGOR_SUBORDINATED apply only to
//                              FIRST_LIEN_LAST_OUT, SECOND_LIEN, PERMITTED_DEBT_SECURITY,
//                              and UNSECURED — not SENIOR_SECURED.
// ─────────────────────────────────────────────────────────────────────────────

const LOAN_TAPE = [
  // ── Apex Logistics (intentional single-obligor breach: $14.5M = 4.02% of pool) ──
  { id: 'L001', obligor: 'Apex Logistics',     industry: 'Transportation',    country: 'US',     par:  8.0, spread: 425, rating: 'B',    status: 'Current', accrued_interest: 0.61, loan_type: 'SENIOR_SECURED' },
  { id: 'L002', obligor: 'Apex Logistics',     industry: 'Transportation',    country: 'US',     par:  6.5, spread: 425, rating: 'B',    status: 'Current', accrued_interest: 0.57, loan_type: 'SENIOR_SECURED' },
  // ── B / BB filler — each $10M = 2.77% of pool (below 3% single-obligor limit) ──
  { id: 'L003', obligor: 'Bravo Media',        industry: 'Media & Ent.',      country: 'US',     par: 10.0, spread: 375, rating: 'B',    status: 'Current', accrued_interest: 0.41, loan_type: 'SENIOR_SECURED' },
  { id: 'L004', obligor: 'Castle Health',      industry: 'Healthcare',        country: 'US',     par: 10.0, spread: 450, rating: 'BB',   status: 'Current', accrued_interest: 0.42, loan_type: 'SENIOR_SECURED' },
  // ── CCC bucket (intentional rating-bucket breach: $46M = 12.76% of pool) ──
  { id: 'L005', obligor: 'Delta Energy',       industry: 'Oil & Gas',         country: 'US',     par: 10.0, spread: 500, rating: 'CCC',  status: 'Current', accrued_interest: 0.38, loan_type: 'SENIOR_SECURED' },
  { id: 'L006', obligor: 'Echo Software',      industry: 'Technology',        country: 'US',     par: 10.0, spread: 350, rating: 'B',    status: 'Current', accrued_interest: 0.54, loan_type: 'SENIOR_SECURED' },
  { id: 'L007', obligor: 'Foxtrot Retail',     industry: 'Retail',            country: 'US',     par:  9.5, spread: 550, rating: 'CCC',  status: 'Current', accrued_interest: 0.34, loan_type: 'SENIOR_SECURED' },
  { id: 'L008', obligor: 'Golf Pharma',        industry: 'Healthcare',        country: 'US',     par: 10.0, spread: 400, rating: 'BB',   status: 'Current', accrued_interest: 0.48, loan_type: 'SENIOR_SECURED' },
  { id: 'L009', obligor: 'Hotel Group',        industry: 'Lodging',           country: 'US',     par: 10.0, spread: 475, rating: 'B',    status: 'Current', accrued_interest: 0.45, loan_type: 'SENIOR_SECURED' },
  { id: 'L010', obligor: 'India Steel',        industry: 'Metals',            country: 'US',     par: 10.0, spread: 525, rating: 'BB',   status: 'Current', accrued_interest: 0.43, loan_type: 'SENIOR_SECURED' },
  { id: 'L011', obligor: 'Juliet Auto',        industry: 'Automotive',        country: 'US',     par: 10.0, spread: 410, rating: 'B',    status: 'Current', accrued_interest: 0.43, loan_type: 'SENIOR_SECURED' },
  { id: 'L012', obligor: 'Kilo Foods',         industry: 'Beverage/Food',     country: 'US',     par: 10.0, spread: 365, rating: 'BB',   status: 'Current', accrued_interest: 0.47, loan_type: 'SENIOR_SECURED' },
  { id: 'L013', obligor: 'Lima Telecom',       industry: 'Telecom',           country: 'US',     par: 10.0, spread: 440, rating: 'B',    status: 'Current', accrued_interest: 0.44, loan_type: 'SENIOR_SECURED' },
  { id: 'L014', obligor: 'Mike Defense',       industry: 'Aerospace',         country: 'US',     par: 10.0, spread: 390, rating: 'BB',   status: 'Current', accrued_interest: 0.34, loan_type: 'SENIOR_SECURED' },
  { id: 'L015', obligor: 'November Bldg',      industry: 'Construction',      country: 'US',     par:  9.0, spread: 510, rating: 'CCC',  status: 'Current', accrued_interest: 0.36, loan_type: 'SENIOR_SECURED' },
  { id: 'L016', obligor: 'Oscar Finance',      industry: 'Financial Svcs',    country: 'US',     par: 10.0, spread: 420, rating: 'B',    status: 'Current', accrued_interest: 0.48, loan_type: 'SENIOR_SECURED' },
  { id: 'L017', obligor: 'Papa Chemical',      industry: 'Chemicals',         country: 'US',     par: 10.0, spread: 460, rating: 'BB',   status: 'Current', accrued_interest: 0.41, loan_type: 'SENIOR_SECURED' },
  { id: 'L018', obligor: 'Quebec Mining',      industry: 'Metals',            country: 'Canada', par:  8.5, spread: 535, rating: 'CCC',  status: 'Current', accrued_interest: 0.36, loan_type: 'SENIOR_SECURED' },
  { id: 'L019', obligor: 'Romeo Fitness',      industry: 'Retail',            country: 'US',     par:  9.0, spread: 580, rating: 'CCC',  status: 'PIK',     accrued_interest: 0.00, loan_type: 'SENIOR_SECURED' },
  { id: 'L020', obligor: 'Sierra Waste',       industry: 'Environmental',     country: 'US',     par: 10.0, spread: 395, rating: 'B',    status: 'Current', accrued_interest: 0.44, loan_type: 'SENIOR_SECURED' },
  // ── BB filler L021–L037 — unique obligors & industries, pool padding ──
  { id: 'L021', obligor: 'Atlas Networks',     industry: 'Software',          country: 'US',     par: 10.0, spread: 380, rating: 'BB',   status: 'Current', accrued_interest: 0.30, loan_type: 'SENIOR_SECURED' },
  { id: 'L022', obligor: 'Beacon Property',    industry: 'Real Estate',       country: 'US',     par: 10.0, spread: 395, rating: 'BB',   status: 'Current', accrued_interest: 0.28, loan_type: 'SENIOR_SECURED' },
  { id: 'L023', obligor: 'Crown Utilities',    industry: 'Utilities',         country: 'US',     par: 10.0, spread: 350, rating: 'BB',   status: 'Current', accrued_interest: 0.25, loan_type: 'SENIOR_SECURED' },
  { id: 'L024', obligor: 'Dunbar Insurance',   industry: 'Insurance',         country: 'US',     par: 10.0, spread: 370, rating: 'BB',   status: 'Current', accrued_interest: 0.27, loan_type: 'SENIOR_SECURED' },
  { id: 'L025', obligor: 'Eagle Agriculture',  industry: 'Agriculture',       country: 'US',     par: 10.0, spread: 410, rating: 'BB',   status: 'Current', accrued_interest: 0.31, loan_type: 'SENIOR_SECURED' },
  { id: 'L026', obligor: 'Frontier Defense',   industry: 'Defense',           country: 'US',     par: 10.0, spread: 360, rating: 'BB',   status: 'Current', accrued_interest: 0.26, loan_type: 'SENIOR_SECURED' },
  { id: 'L027', obligor: 'Gemstone Gaming',    industry: 'Gaming',            country: 'US',     par: 10.0, spread: 420, rating: 'BB',   status: 'Current', accrued_interest: 0.32, loan_type: 'SENIOR_SECURED' },
  { id: 'L028', obligor: 'Harbor Packaging',   industry: 'Packaging',         country: 'US',     par: 10.0, spread: 385, rating: 'BB',   status: 'Current', accrued_interest: 0.29, loan_type: 'SENIOR_SECURED' },
  { id: 'L029', obligor: 'Ironwood Consumer',  industry: 'Consumer Products', country: 'US',     par: 10.0, spread: 400, rating: 'BB',   status: 'Current', accrued_interest: 0.30, loan_type: 'SENIOR_SECURED' },
  { id: 'L030', obligor: 'Jade Education',     industry: 'Education',         country: 'US',     par: 10.0, spread: 375, rating: 'BB',   status: 'Current', accrued_interest: 0.28, loan_type: 'SENIOR_SECURED' },
  { id: 'L031', obligor: 'Keystone Shipping',  industry: 'Shipping',          country: 'US',     par: 10.0, spread: 415, rating: 'BB',   status: 'Current', accrued_interest: 0.32, loan_type: 'SENIOR_SECURED' },
  { id: 'L032', obligor: 'Lantern Biz Svcs',   industry: 'Business Services', country: 'US',     par: 10.0, spread: 390, rating: 'BB',   status: 'Current', accrued_interest: 0.29, loan_type: 'SENIOR_SECURED' },
  { id: 'L033', obligor: 'Marble Pharma',      industry: 'Pharmaceuticals',   country: 'US',     par: 10.0, spread: 365, rating: 'BB',   status: 'Current', accrued_interest: 0.27, loan_type: 'SENIOR_SECURED' },
  { id: 'L034', obligor: 'Nordic Mining Co',   industry: 'Mining',            country: 'US',     par: 10.0, spread: 430, rating: 'BB',   status: 'Current', accrued_interest: 0.33, loan_type: 'SENIOR_SECURED' },
  { id: 'L035', obligor: 'Orbit Mfg Group',    industry: 'Industrials',       country: 'US',     par: 10.0, spread: 380, rating: 'BB',   status: 'Current', accrued_interest: 0.29, loan_type: 'SENIOR_SECURED' },
  { id: 'L036', obligor: 'Pacific Hospitality',industry: 'Hospitality',       country: 'US',     par: 10.0, spread: 395, rating: 'BB',   status: 'Current', accrued_interest: 0.30, loan_type: 'SENIOR_SECURED' },
  { id: 'L037', obligor: 'Quartz Media Tech',  industry: 'Media Technology',  country: 'US',     par: 10.0, spread: 370, rating: 'BB',   status: 'Current', accrued_interest: 0.28, loan_type: 'SENIOR_SECURED' },
];

// Capital structure (synthetic)
const CAPITAL_STRUCTURE = {
  class_a_par: 180.0,    // $M
  class_a_interest_due: 4.50,
  class_b_par: 60.0,
  class_b_interest_due: 1.80,
  class_c_par: 40.0,
  class_c_interest_due: 1.60,
  senior_management_fee: 0.25,
};

// ─────────────────────────────────────────────────────────────────────────────
// LMS TAPE PARSER — inline JS port of src/parsers/lms_tape_parser.ts
// ─────────────────────────────────────────────────────────────────────────────

const LMS_MAPPINGS = require('./barlow-app/src/config/lms_mappings.json');

const INFERENCE_SOURCE_NAMES = new Set([
  'lien position', 'security type', 'asset type', 'collateral type',
  'instrument type', 'loan classification', 'asset class',
]);

const LOAN_TYPE_PATTERNS = [
  { pattern: /first\s*lien\s*last\s*out|fllo|1st\s*lien\s*last\s*out/i, type: 'FIRST_LIEN_LAST_OUT' },
  { pattern: /1st\s*lien|first\s*lien|senior\s*secured|tl\s*[ab]|term\s*loan\s*[ab]/i, type: 'SENIOR_SECURED' },
  { pattern: /2nd\s*lien|second\s*lien/i, type: 'SECOND_LIEN' },
  { pattern: /bond|senior\s*note|high\s*yield|pds|permitted\s*debt\s*security/i, type: 'PERMITTED_DEBT_SECURITY' },
  { pattern: /unsecured/i, type: 'UNSECURED' },
];

const NUMERIC_TAPE_FIELDS = new Set([
  'principal_balance', 'purchase_price', 'market_value', 'spread',
  'coupon', 'unfunded_commitment', 'accrued_interest',
]);

const BOOLEAN_TAPE_FIELDS = new Set([
  'is_dip', 'is_current_pay', 'is_deferrable', 'is_partial_deferring', 'participation_interest',
]);

function detectDelimiter(firstLine) {
  const tabs   = (firstLine.match(/\t/g)  || []).length;
  const commas = (firstLine.match(/,/g)   || []).length;
  return tabs > commas ? '\t' : ',';
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuote = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')                   { inQuote = true; }
      else if (ch === delimiter)             { row.push(field.trim()); field = ''; }
      else if (ch === '\r' && next === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; i++; }
      else if (ch === '\n')                  { row.push(field.trim()); rows.push(row); row = []; field = ''; }
      else                                   { field += ch; }
    }
  }
  if (field !== '' || row.length > 0) { row.push(field.trim()); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();
  return rows;
}

function buildReverseMap(mapping) {
  const map = new Map();
  for (const [canonical, variants] of Object.entries(mapping)) {
    if (canonical.startsWith('_')) continue;
    map.set(canonical.toLowerCase(), canonical);
    for (const v of variants) map.set(v.toLowerCase(), canonical);
  }
  return map;
}

function coerceTapeField(canonical, rawValue) {
  const v = rawValue.trim();
  if (v === '') return undefined;
  if (NUMERIC_TAPE_FIELDS.has(canonical)) {
    const n = parseFloat(v.replace(/[,$%]/g, ''));
    return isNaN(n) ? undefined : n;
  }
  if (BOOLEAN_TAPE_FIELDS.has(canonical)) return /^(true|yes|y|1)$/i.test(v);
  if (canonical === 'reference_rate') {
    const u = v.toUpperCase();
    if (/SOFR/.test(u)) return 'SOFR';
    if (/LIBOR/.test(u)) return 'LIBOR';
    if (/FIXED|FLAT/.test(u)) return 'FIXED';
    return u;
  }
  if (canonical === 'payment_frequency') {
    const u = v.toUpperCase().replace(/[-_\s]/g, '');
    if (u === 'M' || u === 'MONTHLY')                    return 'MONTHLY';
    if (u === 'Q' || u === 'QUARTERLY')                  return 'QUARTERLY';
    if (u === 'SA' || u === 'SEMIANNUAL' || u === 'SEMI') return 'SEMI_ANNUAL';
    if (u === 'A' || u === 'ANNUAL' || u === 'ANNUALLY') return 'ANNUAL';
    return u;
  }
  return v;
}

function inferLoanType(candidates) {
  for (const { column, value } of candidates) {
    for (const { pattern, type } of LOAN_TYPE_PATTERNS) {
      if (pattern.test(value.trim())) return { type, sourceColumn: column };
    }
  }
  return null;
}

const MOODYS_TO_SP = {
  'Aaa': 'AAA', 'Aa1': 'AA+',  'Aa2': 'AA',   'Aa3': 'AA-',
  'A1':  'A+',  'A2':  'A',    'A3':  'A-',
  'Baa1':'BBB+','Baa2':'BBB',  'Baa3':'BBB-',
  'Ba1': 'BB+', 'Ba2': 'BB',   'Ba3': 'BB-',
  'B1':  'B+',  'B2':  'B',    'B3':  'B-',
  'Caa1':'CCC+','Caa2':'CCC',  'Caa3':'CCC-',
  'Ca':  'CC',  'C':   'C',    'D':   'D',
};

const RATING_RANK = {
  'AAA': 1, 'AA+': 2,  'AA': 3,   'AA-': 4,
  'A+':  5, 'A':   6,  'A-':  7,
  'BBB+':8, 'BBB': 9,  'BBB-':10,
  'BB+':11, 'BB':  12, 'BB-': 13,
  'B+': 14, 'B':   15, 'B-':  16,
  'CCC+':17,'CCC': 18, 'CCC-':19,
  'CC':  20,'C':   21, 'D':   22,
};

function lowerOfRating(spRating, moodysRating) {
  const spEquiv = spRating || null;
  const mEquiv  = moodysRating ? (MOODYS_TO_SP[moodysRating] || null) : null;
  if (!spEquiv && !mEquiv) return null;
  if (!spEquiv) return mEquiv;
  if (!mEquiv)  return spEquiv;
  return (RATING_RANK[spEquiv] || 99) >= (RATING_RANK[mEquiv] || 99) ? spEquiv : mEquiv;
}

function canonicalToLegacy(loan) {
  return {
    id:               loan.loan_id,
    obligor:          loan.obligor_name,
    industry:         loan.industry || 'Unknown',
    country:          loan.country  || undefined,
    par:              loan.principal_balance,
    spread:           loan.spread,
    rating:           lowerOfRating(loan.sp_rating, loan.moodys_rating) || loan.sp_rating || loan.moodys_rating || '',
    status:           loan.is_current_pay === false ? 'PIK' : 'Current',
    accrued_interest: loan.accrued_interest || 0,
    loan_type:        loan.loan_type,
  };
}

function loadLoanTape(filePath) {
  const text      = fs.readFileSync(filePath, 'utf8');
  const firstLine = text.split(/\r?\n/)[0];
  const delimiter = detectDelimiter(firstLine);
  const rows      = parseDelimited(text, delimiter);

  if (rows.length < 2) throw new Error(`"${filePath}" is empty or header-only`);

  const reverseMap       = buildReverseMap(LMS_MAPPINGS);
  const headers          = rows[0];
  const columnCanonical  = [];
  const inferenceColumns = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const canonical = reverseMap.get(h.toLowerCase()) || null;
    columnCanonical.push(canonical);
    if (!canonical) {
      if (INFERENCE_SOURCE_NAMES.has(h.toLowerCase())) inferenceColumns.push({ index: i, name: h });
      else warn(`Unmapped column: "${h}" — skipped`);
    }
  }

  const canonical = [];
  for (const rawRow of rows.slice(1)) {
    const rec = {};
    const inferCandidates = [];

    for (let i = 0; i < headers.length; i++) {
      const can = columnCanonical[i];
      const raw = rawRow[i] || '';
      if (can) {
        const coerced = coerceTapeField(can, raw);
        if (coerced !== undefined) rec[can] = coerced;
      }
      const infCol = inferenceColumns.find(c => c.index === i);
      if (infCol && raw.trim()) inferCandidates.push({ column: infCol.name, value: raw });
    }

    if (!rec['loan_type']) {
      const inferred = inferLoanType(inferCandidates);
      rec['loan_type'] = inferred ? inferred.type : 'SENIOR_SECURED';
    }
    if (!rec['obligor_id'] && rec['obligor_name']) {
      rec['obligor_id'] = String(rec['obligor_name']).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    }
    if (!rec['source']) rec['source'] = 'LMS_TAPE';
    canonical.push(rec);
  }

  return { canonical, legacy: canonical.map(canonicalToLegacy) };
}

function logTapeSummary(canonicalLoans) {
  const totalPar = canonicalLoans.reduce((s, l) => s + (l.principal_balance || 0), 0);
  const obligors = new Set(canonicalLoans.map(l => l.obligor_name || l.obligor_id || '')).size;

  const loanTypeCounts = {};
  for (const l of canonicalLoans) {
    const lt = l.loan_type || 'UNKNOWN';
    loanTypeCounts[lt] = (loanTypeCounts[lt] || 0) + 1;
  }
  const loanTypeStr = Object.entries(loanTypeCounts).map(([t, n]) => `${t} (${n})`).join(', ');

  let spCount = 0, moodysOnlyCount = 0, unratedCount = 0;
  for (const l of canonicalLoans) {
    if (l.sp_rating)          spCount++;
    else if (l.moodys_rating) moodysOnlyCount++;
    else                      unratedCount++;
  }

  info(`Loan tape loaded: ${canonicalLoans.length} positions, $${Math.round(totalPar)}M par, ${obligors} obligor${obligors !== 1 ? 's' : ''}`);
  info(`Loan types: ${loanTypeStr}`);
  info(`Ratings: S&P (${spCount}), Moody's (${moodysOnlyCount}), Unrated (${unratedCount})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTICE PROCESSING — agent bank notice ingestion helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOTICE_SYSTEM_PROMPT = `You are a CLO agent bank notice parser. Your job is to read LSTA-format agent bank notices and extract structured update data.

You must return ONLY valid JSON — no preamble, no explanation, no markdown fences. The JSON must conform exactly to the schema below.

Notice types — choose the single best match:
  RATE_RESET         New reference rate or spread
  PAYDOWN            Principal reduction or prepayment
  PIK_ELECTION       Pay-in-kind interest election
  AMENDMENT          General amendment to credit agreement terms
  DEFAULT_NOTICE     Borrower default or event of default
  RATING_CHANGE      Agency credit rating update
  COMMITMENT_CHANGE  Change to revolving credit or delayed draw commitment amount
  MATURITY_EXTENSION Extension of the loan maturity date
  UNKNOWN            Cannot be classified into any of the above

LoanPosition fields you may populate in "updates":
  principal_balance  number ($M)     New outstanding principal
  spread             number (bps)    New spread over reference rate
  reference_rate     string          SOFR | LIBOR | FIXED
  maturity_date      string          YYYY-MM-DD
  sp_rating          string          New S&P credit rating (e.g. B, BB, CCC)
  moodys_rating      string          New Moody's credit rating (e.g. B2, Ba2, Caa2)
  is_current_pay     boolean         false if PIK elected, true if cash interest
  is_deferrable      boolean         true if PIK is in effect
  payment_frequency  string          MONTHLY | QUARTERLY | SEMI_ANNUAL | ANNUAL
  unfunded_commitment number ($M)    New unfunded commitment amount
  accrued_interest   number ($M)     Accrued interest at notice date

Extraction rules:
1. Extract ONLY values explicitly stated in the notice. Do not infer, estimate, or calculate.
2. loan_ids: match loans to the provided tape using obligor name and any facility identifiers in the notice. Leave empty if no match can be made.
3. effective_date: use YYYY-MM-DD format. Set to null (JSON null, not the string "null") if not explicitly stated; add a flag explaining why.
4. extraction_confidence:
     HIGH   — Complete, unambiguous, all material terms present in this notice
     MEDIUM — Minor ambiguities or routine cross-references to standard exhibits
     LOW    — Material information missing, undefined terms, pending data, or undefined cross-references
5. flags: array of strings. Each flag describes a specific missing piece of information, undefined cross-reference, or material ambiguity. Empty array if none.
6. raw_text: copy the full notice text verbatim.
7. notice_id: generate a UUID v4.
8. Return ONLY the JSON object. Nothing else.

Required JSON schema:
{
  "notice_id":             "uuid-v4-string",
  "notice_type":           "RATE_RESET | PAYDOWN | ...",
  "effective_date":        "YYYY-MM-DD or null",
  "loan_ids":              ["L001", ...],
  "obligor_name":          "exactly as it appears in the notice",
  "updates":               {},
  "raw_text":              "full notice text verbatim",
  "extraction_confidence": "HIGH | MEDIUM | LOW",
  "flags":                 []
}`;

const NOTICE_LEGAL_SUFFIXES =
  /\b(llc|lp|llp|ltd|inc|corp|co|holdings?|group|company|limited|partners?|partnership|international|intl|industries|enterprises|n\.?a\.?|trust|bank)\b/gi;

function normalizeObligorCLI(name) {
  return name
    .toLowerCase()
    .replace(/\bn\.a\./gi, 'na')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()']/g, ' ')
    .replace(NOTICE_LEGAL_SUFFIXES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchNoticeCLI(update, loans) {
  if (update.loan_ids && update.loan_ids.length > 0) {
    const idSet = new Set(update.loan_ids);
    return loans.filter(l => idSet.has(l.loan_id));
  }
  const normalizedNotice = normalizeObligorCLI(update.obligor_name || '');
  return loans.filter(l => normalizeObligorCLI(l.obligor_name || '') === normalizedNotice);
}

function applyNoticeCLI(update, loans) {
  const matched    = matchNoticeCLI(update, loans);
  const matchedIds = new Set(matched.map(l => l.loan_id));
  const changeLog  = [];

  const updatedLoans = loans.map(loan => {
    if (!matchedIds.has(loan.loan_id)) return loan;
    const updated = { ...loan };
    for (const [field, newValue] of Object.entries(update.updates || {})) {
      if (newValue === undefined) continue;
      changeLog.push({
        loan_id:        loan.loan_id,
        field,
        old_value:      loan[field],
        new_value:      newValue,
        notice_id:      update.notice_id,
        effective_date: update.effective_date,
      });
      updated[field] = newValue;
    }
    return updated;
  });

  return { updatedLoans, changeLog, matchCount: matched.length };
}

function buildNoticeMsgCLI(noticeText, loans) {
  const tapeLines = loans.map(l => `  ${l.loan_id}: ${l.obligor_name}`).join('\n');
  return `Existing loan tape (use for obligor/facility matching only — do not extract data from this):
${tapeLines}

Agent bank notice to parse:
${'─'.repeat(60)}
${noticeText}
${'─'.repeat(60)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — the contract for extraction
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a CLO indenture analysis engine. Your job is to read CLO indenture text and extract structured coverage test definitions, concentration limits, and waterfall priority of payments.

You must return ONLY valid JSON — no preamble, no explanation, no markdown fences. The JSON must conform exactly to this schema:

{
  "deal_name": "string — extracted from document header",
  "extraction_date": "ISO date string",
  "coverage_tests": [
    {
      "test_id": "string — e.g. OC_CLASS_AB, IC_CLASS_AB",
      "test_type": "overcollateralization | interest_coverage",
      "description": "string — plain English description of what this test measures",
      "numerator": "string — what is divided (e.g. adjusted_collateral_par)",
      "denominator": "string — what divides into (e.g. class_a_plus_b_par)",
      "threshold_pct": number — threshold as a percentage (e.g. 123.50 not 1.235),
      "failure_action": "string — what happens if test fails",
      "source_clause": "string — section reference from indenture",
      "confidence": "HIGH | MEDIUM | LOW",
      "confidence_reason": "string — why this confidence level was assigned"
    }
  ],
  "concentration_limits": [
    {
      "limit_id": "string — e.g. SINGLE_OBLIGOR, INDUSTRY, CCC_BUCKET, DIP",
      "description": "string — plain English description",
      "dimension": "obligor | industry | country | rating_bucket | loan_type",
      "max_pct": number — default/fallback maximum as a percentage (e.g. 12.00); always populate even when tiers is present,
      "tiers": [
        {
          "rank": "string — e.g. largest | second_largest | all_others | top_3 | any rank label stated in the indenture",
          "max_pct": number — threshold for this rank tier as a percentage
        }
      ],
      "applies_to": ["array of loan_type strings this limit applies to, e.g. FIRST_LIEN_LAST_OUT, SECOND_LIEN, PERMITTED_DEBT_SECURITY, UNSECURED — omit or null if the limit applies to all loan types"],
      "applies_to_values": ["for dimension:country limits — array of ISO country codes this limit governs, e.g. US, CA, GB — omit or null for limits that apply regardless of country"],
      "calculation_basis": "string — what denominator to use",
      "notes": "string — any special handling (e.g. defaulted obligations treated as CCC)",
      "source_clause": "string — section reference",
      "confidence": "HIGH | MEDIUM | LOW",
      "confidence_reason": "string"
    }
  ],
  "waterfall_steps": [
    {
      "step_id": "string — e.g. STEP_04_CLASS_A_INTEREST, STEP_05_OC_AB_CHECK",
      "step_number": number,
      "step_type": "FEE | INTEREST_PAYMENT | COVERAGE_TEST_CHECK | DIVERSION | PRINCIPAL_PAYMENT | REINVESTMENT | EQUITY_DISTRIBUTION | RESERVE_ACCOUNT_FUNDING",
      "label": "string — plain English label from indenture",
      "indenture_section": "string",
      "beneficiary": "string or omit",
      "payment_type": "INTEREST | PRINCIPAL | FEE | EQUITY_DISTRIBUTION or omit",
      "note_class": "CLASS_A | CLASS_B | CLASS_C | CLASS_D | CLASS_E | EQUITY or omit",
      "amount_basis": "ACCRUED_INTEREST | PRO_RATA | REMAINING_PROCEEDS | FIXED | LESSER_OF_ACCRUED_AND_AVAILABLE or omit",
      "condition": {
        "test_type": "OC | IC | COMBINED | NONE",
        "note_classes_tested": ["CLASS_A", "CLASS_B"],
        "operator": "ALL_PASS | ANY_PASS"
      },
      "condition_raw": "string — exact prose from indenture or omit",
      "diverts_to": {
        "step_type": "REINVESTMENT | REDEMPTION | RESERVE",
        "note_class_priority": [],
        "description": "string"
      },
      "cure_mechanism": "REINVESTMENT | REDEMPTION | TRAP or omit"
    }
  ],
  "extraction_summary": {
    "tests_found": number,
    "limits_found": number,
    "waterfall_steps_found": number,
    "overall_confidence": "HIGH | MEDIUM | LOW",
    "flags": ["array of strings — any issues, ambiguities, or items requiring human review"]
  }
}

Waterfall step rules:
  step_type assignment:
    FEE               — trustee fees, management fees, hedge payments, expenses
    INTEREST_PAYMENT  — unconditional note interest payment (no OC/IC gate)
    COVERAGE_TEST_CHECK — conditional payment gated by an OC or IC test; populate condition AND diverts_to
    REINVESTMENT      — principal reinvestment / cure step (target of diversions)
    PRINCIPAL_PAYMENT — scheduled principal distribution
    EQUITY_DISTRIBUTION — residual distributions to equity / income notes

  For COVERAGE_TEST_CHECK steps:
    - condition.test_type: OC for overcollateralization, IC for interest coverage
    - condition.note_classes_tested: all classes in the ratio denominator (e.g. A/B OC → ["CLASS_A","CLASS_B"])
    - note_class: populate if this step pays interest when the test passes
    - diverts_to: required — where cash goes on failure

  step_id format: STEP_{number:02d}_{LABEL}  e.g. STEP_05_OC_AB_CHECK
  note_class: CLASS_A | CLASS_B | CLASS_C | CLASS_D (not "A", "Class A")

  FEW-SHOT EXAMPLE — conditional interest payment with OC check:
  Indenture text: "Step 5: Accrued and unpaid interest on the Class B Notes — provided the
  Class A/B OC Ratio is at or above 123.50%; otherwise redirect to the reinvestment account."

  Correct extraction:
  {
    "step_id": "STEP_05_OC_AB_CHECK",
    "step_number": 5,
    "step_type": "COVERAGE_TEST_CHECK",
    "label": "Accrued and unpaid interest on the Class B Notes",
    "indenture_section": "Section 13.1, Step 5",
    "beneficiary": "Class B Noteholders",
    "payment_type": "INTEREST",
    "note_class": "CLASS_B",
    "amount_basis": "ACCRUED_INTEREST",
    "condition": { "test_type": "OC", "note_classes_tested": ["CLASS_A","CLASS_B"], "operator": "ALL_PASS" },
    "condition_raw": "provided Class A/B OC Ratio is at or above 123.50%; otherwise redirect to reinvestment account",
    "diverts_to": { "step_type": "REINVESTMENT", "note_class_priority": [], "description": "Redirect to principal reinvestment account until OC threshold restored" },
    "cure_mechanism": "REINVESTMENT"
  }

General rules:
1. Extract only what is explicitly stated. Do not infer or assume.
2. If a threshold appears ambiguous, assign confidence MEDIUM or LOW and explain in confidence_reason.
3. If a clause is missing or truncated, note it in extraction_summary.flags.
4. Thresholds as percentages: 123.50 not 1.235.
5. Return ONLY the JSON object. Nothing else.
6. Tiered limits: populate tiers array; set max_pct to the most restrictive tier as fallback.
7. Country limits: dimension="country", populate applies_to_values with ISO codes.`;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP HELPER — calls Anthropic API without SDK dependency
// ─────────────────────────────────────────────────────────────────────────────

function callClaude(systemPrompt, userMessage, maxTokens = 8000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY || ''
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(`API error: ${parsed.error.message}`));
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE TEST RUNNER — deterministic, no AI
// ─────────────────────────────────────────────────────────────────────────────

function runCoverageTests(extractedRules, loanTape, capitalStructure) {
  const results = [];
  const totalPar = loanTape.reduce((s, l) => s + l.par, 0);
  const totalInterestProceeds = loanTape
    .filter(l => l.status !== 'PIK')
    .reduce((s, l) => s + l.accrued_interest, 0);

  for (const test of extractedRules.coverage_tests) {
    let calculated, numeratorVal, denominatorVal, passed;

    if (test.test_type === 'overcollateralization') {
      numeratorVal = totalPar;
      if (test.test_id === 'OC_CLASS_AB') {
        denominatorVal = capitalStructure.class_a_par + capitalStructure.class_b_par;
      } else if (test.test_id === 'OC_CLASS_C') {
        denominatorVal = capitalStructure.class_a_par + capitalStructure.class_b_par + capitalStructure.class_c_par;
      } else {
        denominatorVal = capitalStructure.class_a_par + capitalStructure.class_b_par;
      }
      calculated = (numeratorVal / denominatorVal) * 100;
      passed = calculated >= test.threshold_pct;

    } else if (test.test_type === 'interest_coverage') {
      numeratorVal = totalInterestProceeds;
      denominatorVal = capitalStructure.class_a_interest_due +
                       capitalStructure.class_b_interest_due +
                       capitalStructure.senior_management_fee;
      calculated = (numeratorVal / denominatorVal) * 100;
      passed = calculated >= test.threshold_pct;
    }

    results.push({
      test_id: test.test_id,
      description: test.description,
      numerator_value: Math.round(numeratorVal * 100) / 100,
      denominator_value: Math.round(denominatorVal * 100) / 100,
      calculated_pct: Math.round(calculated * 100) / 100,
      threshold_pct: test.threshold_pct,
      cushion_pct: Math.round((calculated - test.threshold_pct) * 100) / 100,
      result: passed ? 'PASS' : 'FAIL',
      failure_action: passed ? null : test.failure_action,
      source_clause: test.source_clause
    });
  }
  return results;
}

function runConcentrationTests(extractedRules, loanTape, verbose = false) {
  const results = [];
  const totalPar = loanTape.reduce((s, l) => s + l.par, 0);

  for (const limit of extractedRules.concentration_limits) {
    let breaches = [];

    // If applies_to is set, restrict the tape to matching loan types only.
    // The denominator stays the full pool (totalPar) — limits are expressed as
    // a % of Adjusted Collateral Principal Amount regardless of which subset they test.
    const tape = (limit.applies_to && limit.applies_to.length > 0)
      ? loanTape.filter(l => limit.applies_to.includes(l.loan_type))
      : loanTape;

    if (verbose && limit.applies_to && limit.applies_to.length > 0) {
      console.log(`  ${C.grey}[DEBUG] ${limit.limit_id}: applying to ${tape.length}/${loanTape.length} loans (asset class filter)${C.reset}`);
    }

    if (limit.tiers && limit.tiers.length > 0) {
      console.log(`  ${C.amber}⚠${C.reset}  [WARN] Tiered limit ${limit.limit_id} detected — tier-aware evaluation not yet implemented. Falling back to scalar max_pct (${limit.max_pct}%).`);
    }

    if (limit.dimension === 'obligor') {
      const byObligor = {};
      tape.forEach(l => { byObligor[l.obligor] = (byObligor[l.obligor] || 0) + l.par; });
      Object.entries(byObligor).forEach(([obligor, par]) => {
        const pct = (par / totalPar) * 100;
        if (pct > limit.max_pct) {
          breaches.push({ item: obligor, par_value: Math.round(par * 100) / 100, pct: Math.round(pct * 100) / 100 });
        }
      });

    } else if (limit.dimension === 'industry') {
      const byIndustry = {};
      tape.forEach(l => { byIndustry[l.industry] = (byIndustry[l.industry] || 0) + l.par; });
      Object.entries(byIndustry).forEach(([industry, par]) => {
        const pct = (par / totalPar) * 100;
        if (pct > limit.max_pct) {
          breaches.push({ item: industry, par_value: Math.round(par * 100) / 100, pct: Math.round(pct * 100) / 100 });
        }
      });

    } else if (limit.dimension === 'rating_bucket') {
      // CCC bucket — ratings at or below CCC+
      const cccRatings = ['CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
      const cccLoans = tape.filter(l => cccRatings.includes(l.rating) || l.status === 'Defaulted');
      const cccPar = cccLoans.reduce((s, l) => s + l.par, 0);
      const cccPct = (cccPar / totalPar) * 100;
      if (cccPct > limit.max_pct) {
        breaches.push({
          item: 'CCC/Caa bucket',
          par_value: Math.round(cccPar * 100) / 100,
          pct: Math.round(cccPct * 100) / 100,
          loans: cccLoans.map(l => l.id)
        });
      }

    } else if (limit.dimension === 'loan_type') {
      // DIP loans
      const dipLoans = tape.filter(l => l.loan_type === 'DIP');
      const dipPar = dipLoans.reduce((s, l) => s + l.par, 0);
      const dipPct = (dipPar / totalPar) * 100;
      if (dipPct > limit.max_pct) {
        breaches.push({ item: 'DIP loans', par_value: Math.round(dipPar * 100) / 100, pct: Math.round(dipPct * 100) / 100 });
      }

    } else if (limit.dimension === 'country') {
      console.log(`  ${C.amber}⚠${C.reset}  [WARN] Country-dimension limit detected — evaluation requires country field on loan tape. Skipping.`);
    }

    results.push({
      limit_id: limit.limit_id,
      description: limit.description,
      max_pct: limit.max_pct,
      total_par_basis: Math.round(totalPar * 100) / 100,
      result: breaches.length === 0 ? 'PASS' : 'FAIL',
      breach_count: breaches.length,
      breaches,
      source_clause: limit.source_clause
    });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEPTION NARRATIVE GENERATOR — AI again, only for failed tests
// ─────────────────────────────────────────────────────────────────────────────

async function generateExceptionNarrative(testResults, concentrationResults, extractedRules) {
  const failures = [
    ...testResults.filter(t => t.result === 'FAIL'),
    ...concentrationResults.filter(t => t.result === 'FAIL')
  ];

  if (failures.length === 0) return null;

  const prompt = `You are a CLO trustee report writer. Given these test failures, write a concise exception narrative suitable for a trustee report.

For each failure:
- State what test failed and by how much
- Reference the indenture section
- State the required cure action
- Use precise financial language appropriate for institutional noteholders
- Be factual, not alarmist

Failures:
${JSON.stringify(failures, null, 2)}

Indenture rules context:
${JSON.stringify(extractedRules.coverage_tests.concat(extractedRules.concentration_limits), null, 2)}

Return plain prose only. No JSON. No headers. 2-4 sentences per failure, separated by blank lines.`;

  const response = await callClaude(
    'You are a precise CLO trustee report writer. Write factual exception narratives for institutional audiences.',
    prompt
  );

  return response.content[0]?.text || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — two modes
//   synthetic: compare extracted values against hardcoded ground truth
//   real:      structural check only — required fields present and well-typed
// ─────────────────────────────────────────────────────────────────────────────

const GROUND_TRUTH = {
  coverage_tests: [
    { test_id: 'OC_CLASS_AB', threshold_pct: 123.50 },
    { test_id: 'OC_CLASS_C',  threshold_pct: 112.75 },
    { test_id: 'IC_CLASS_AB', threshold_pct: 120.00 },
  ],
  concentration_limits: [
    { limit_id: 'SINGLE_OBLIGOR', max_pct: 3.00  },
    { limit_id: 'INDUSTRY',       max_pct: 15.00 },
    { limit_id: 'CCC_BUCKET',     max_pct: 7.50  },
    { limit_id: 'DIP',            max_pct: 5.00  },
  ]
};

// Synthetic mode: value-level comparison against GROUND_TRUTH
function validateExtraction(extracted) {
  const report = { passed: [], failed: [], warnings: [] };

  for (const gt of GROUND_TRUTH.coverage_tests) {
    const found = extracted.coverage_tests?.find(t =>
      t.test_id === gt.test_id || t.threshold_pct === gt.threshold_pct
    );
    if (!found) {
      report.failed.push(`Missing test: ${gt.test_id} (threshold ${gt.threshold_pct}%)`);
    } else if (Math.abs(found.threshold_pct - gt.threshold_pct) > 0.01) {
      report.failed.push(`Wrong threshold for ${gt.test_id}: got ${found.threshold_pct}%, expected ${gt.threshold_pct}%`);
    } else {
      report.passed.push(`${gt.test_id}: threshold ${found.threshold_pct}% ✓`);
    }
  }

  for (const gt of GROUND_TRUTH.concentration_limits) {
    const found = extracted.concentration_limits?.find(l =>
      l.limit_id === gt.limit_id || Math.abs(l.max_pct - gt.max_pct) < 0.01
    );
    if (!found) {
      report.failed.push(`Missing limit: ${gt.limit_id} (${gt.max_pct}%)`);
    } else if (Math.abs(found.max_pct - gt.max_pct) > 0.01) {
      report.failed.push(`Wrong threshold for ${gt.limit_id}: got ${found.max_pct}%, expected ${gt.max_pct}%`);
    } else {
      report.passed.push(`${gt.limit_id}: ${found.max_pct}% ✓`);
    }
  }

  if (extracted.extraction_summary?.overall_confidence === 'LOW') {
    report.warnings.push('Overall extraction confidence is LOW — review recommended');
  }

  return report;
}

// Real mode: structural check — fields present, types correct, no expected values
const VALID_TEST_TYPES  = ['overcollateralization', 'interest_coverage'];
const VALID_DIMENSIONS  = ['obligor', 'industry', 'country', 'rating_bucket', 'loan_type'];

function validateStructure(extracted) {
  const report = { passed: [], failed: [], warnings: [] };

  const tests     = extracted.coverage_tests      || [];
  const limits    = extracted.concentration_limits || [];
  // Accept v2 waterfall_steps or legacy waterfall field
  const waterfall = extracted.waterfall_steps || extracted.waterfall || [];
  const isV2      = !!extracted.waterfall_steps;

  // ── Array presence ────────────────────────────────────────────────────────
  if (tests.length === 0) {
    report.failed.push('coverage_tests: no tests extracted');
  } else {
    report.passed.push(`coverage_tests: ${tests.length} test(s) present`);
  }

  if (limits.length === 0) {
    report.failed.push('concentration_limits: no limits extracted');
  } else {
    report.passed.push(`concentration_limits: ${limits.length} limit(s) present`);
  }

  if (waterfall.length === 0) {
    report.failed.push('waterfall_steps: no steps extracted');
  } else {
    const fieldLabel = isV2 ? 'waterfall_steps (v2)' : 'waterfall (legacy)';
    report.passed.push(`${fieldLabel}: ${waterfall.length} step(s) present`);
    if (!isV2) {
      report.warnings.push('waterfall: legacy schema detected — diversion engine requires waterfall_steps (v2)');
    }
  }

  // ── Waterfall step v2 field checks ────────────────────────────────────────
  if (isV2) {
    const VALID_STEP_TYPES = new Set(['FEE','INTEREST_PAYMENT','COVERAGE_TEST_CHECK','DIVERSION',
      'PRINCIPAL_PAYMENT','REINVESTMENT','EQUITY_DISTRIBUTION','RESERVE_ACCOUNT_FUNDING']);
    let stepFieldErrors = 0;
    let checkStepsOk    = 0;
    let checkStepsMissingFields = 0;
    waterfall.forEach((step, i) => {
      const lbl = step.step_id || `step[${i}]`;
      if (!step.step_id)                             { report.failed.push(`${lbl}: missing step_id`); stepFieldErrors++; }
      if (typeof step.step_number !== 'number')      { report.failed.push(`${lbl}: step_number not a number`); stepFieldErrors++; }
      if (!VALID_STEP_TYPES.has(step.step_type))     { report.warnings.push(`${lbl}: unrecognised step_type "${step.step_type}"`); }
      if (!step.label)                               { report.warnings.push(`${lbl}: missing label`); }
      if (step.step_type === 'COVERAGE_TEST_CHECK') {
        if (!step.condition || !step.diverts_to) {
          report.warnings.push(`${lbl}: COVERAGE_TEST_CHECK missing condition or diverts_to`);
          checkStepsMissingFields++;
        } else {
          checkStepsOk++;
        }
      }
    });
    if (waterfall.length > 0 && stepFieldErrors === 0)
      report.passed.push(`waterfall_steps fields: all ${waterfall.length} have valid step_id, step_number, step_type`);
    const checkTotal = checkStepsOk + checkStepsMissingFields;
    if (checkTotal > 0) {
      if (checkStepsMissingFields === 0)
        report.passed.push(`COVERAGE_TEST_CHECK steps: all ${checkStepsOk} have condition + diverts_to`);
      else
        report.warnings.push(`COVERAGE_TEST_CHECK steps: ${checkStepsMissingFields}/${checkTotal} missing condition or diverts_to`);
    }
  }

  // ── Coverage test field checks ────────────────────────────────────────────
  let testFieldErrors = 0;
  tests.forEach((t, i) => {
    const lbl = t.test_id || `test[${i}]`;
    if (!t.test_id || typeof t.test_id !== 'string')
      { report.failed.push(`${lbl}: missing or non-string test_id`); testFieldErrors++; }
    if (typeof t.threshold_pct !== 'number' || !isFinite(t.threshold_pct) || t.threshold_pct <= 0)
      { report.failed.push(`${lbl}: threshold_pct must be a positive number (got ${t.threshold_pct})`); testFieldErrors++; }
    if (!VALID_TEST_TYPES.includes(t.test_type))
      { report.failed.push(`${lbl}: unrecognised test_type "${t.test_type}"`); testFieldErrors++; }
    if (!t.source_clause)
      report.warnings.push(`${lbl}: no source_clause — manual verification needed`);
    if (t.confidence === 'LOW')
      report.warnings.push(`${lbl}: confidence LOW — ${t.confidence_reason || 'no reason given'}`);
  });
  if (tests.length > 0 && testFieldErrors === 0)
    report.passed.push(`coverage_tests fields: all ${tests.length} have valid test_id, threshold_pct, test_type`);

  // ── Concentration limit field checks ──────────────────────────────────────
  let limitFieldErrors = 0;
  limits.forEach((l, i) => {
    const lbl = l.limit_id || `limit[${i}]`;
    if (!l.limit_id || typeof l.limit_id !== 'string')
      { report.failed.push(`${lbl}: missing or non-string limit_id`); limitFieldErrors++; }
    if (typeof l.max_pct !== 'number' || !isFinite(l.max_pct) || l.max_pct < 0)
      { report.failed.push(`${lbl}: max_pct must be a non-negative number (got ${l.max_pct})`); limitFieldErrors++; }
    if (!VALID_DIMENSIONS.includes(l.dimension))
      report.warnings.push(`${lbl}: unrecognised dimension "${l.dimension}" — runner will skip this limit`);
    if (l.confidence === 'LOW')
      report.warnings.push(`${lbl}: confidence LOW — ${l.confidence_reason || 'no reason given'}`);
  });
  if (limits.length > 0 && limitFieldErrors === 0)
    report.passed.push(`concentration_limits fields: all ${limits.length} have valid limit_id, max_pct`);

  // ── Overall confidence ────────────────────────────────────────────────────
  const confidence = extracted.extraction_summary?.overall_confidence;
  if (confidence === 'LOW')
    report.warnings.push('Overall extraction confidence is LOW — review recommended');
  else if (confidence === 'MEDIUM')
    report.warnings.push('Overall extraction confidence is MEDIUM — review flagged items');

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4A — WATERFALL DIVERSION ENGINE
// Port of src/engines/waterfall_diversion_engine.ts.
// Do not modify logic here without a matching change to the TypeScript source.
// ─────────────────────────────────────────────────────────────────────────────

// Extends CAPITAL_STRUCTURE with per-step fee amounts required by the waterfall engine.
const WATERFALL_CAPITAL_STRUCTURE = {
  ...CAPITAL_STRUCTURE,
  trustee_fee:                0.25,
  hedge_payments:             0.00,
  subordinate_management_fee: 0.20,
};

function r2(n) { return Math.round(n * 100) / 100; }

function noteClassesToSuffix(noteClasses) {
  const order = { A: 1, B: 2, C: 3, D: 4, E: 5 };
  const letters = noteClasses
    .map(c => c.replace('CLASS_', ''))
    .filter(l => order[l] !== undefined)
    .sort((a, b) => order[a] - order[b]);
  if (letters.length === 0) return null;
  if (letters.join('') === 'AB') return 'AB';
  return letters[letters.length - 1];
}

function resolveTestResult(condition, testIndex) {
  const suffix = noteClassesToSuffix(condition.note_classes_tested || []);
  if (!suffix) return { result: null, testId: null };
  const prefix     = condition.test_type === 'OC' ? 'OC_CLASS_' : 'IC_CLASS_';
  const expectedId = `${prefix}${suffix}`;
  const direct     = testIndex.get(expectedId);
  if (direct) return { result: direct, testId: expectedId };
  const typeStr = condition.test_type === 'OC' ? 'overcollateralization' : 'interest_coverage';
  for (const [id, r] of testIndex) {
    if (r.test_type === typeStr && id.includes(suffix)) return { result: r, testId: id };
  }
  return { result: null, testId: null };
}

function evaluateCondition(condition, testIndex) {
  if (!condition || condition.test_type === 'NONE') return { passed: true, failingTestId: null };

  // COMBINED: both OC and IC tests for the relevant classes must pass.
  // Carlyle-style: "if either of the Class A/B Coverage Tests is not satisfied".
  if (condition.test_type === 'COMBINED') {
    const suffix = noteClassesToSuffix(condition.note_classes_tested || []);
    if (suffix) {
      for (const prefix of ['OC_CLASS_', 'IC_CLASS_']) {
        const id = `${prefix}${suffix}`;
        const r  = testIndex.get(id);
        if (r && r.result === 'FAIL') return { passed: false, failingTestId: id };
      }
    }
    return { passed: true, failingTestId: null };
  }

  const { result, testId } = resolveTestResult(condition, testIndex);
  if (!result) return { passed: true, failingTestId: null };
  if (condition.operator === 'ALL_PASS') {
    return result.result === 'FAIL'
      ? { passed: false, failingTestId: testId }
      : { passed: true,  failingTestId: null };
  }
  return result.result === 'PASS'
    ? { passed: true,  failingTestId: null }
    : { passed: false, failingTestId: testId };
}

function resolveWaterfallPayment(step, capital, remaining) {
  if (step.amount_basis === 'REMAINING_PROCEEDS') return remaining;
  if (step.step_type === 'FEE') {
    const id = step.step_id.toUpperCase();
    if (id.includes('TRUSTEE'))                                  return capital.trustee_fee;
    if (id.includes('SR_MGMT') || id.includes('SENIOR_MGMT'))   return capital.senior_management_fee;
    if (id.includes('HEDGE'))                                    return capital.hedge_payments ?? 0;
    if (id.includes('SUB_MGMT') || id.includes('SUBORDINATE'))  return capital.subordinate_management_fee ?? 0;
    return 0;
  }
  if (step.step_type === 'INTEREST_PAYMENT' && step.note_class) {
    return resolveNoteInterest(step.note_class, capital);
  }
  return 0;
}

function resolveNoteInterest(noteClass, capital) {
  switch (noteClass) {
    case 'CLASS_A': return capital.class_a_interest_due;
    case 'CLASS_B': return capital.class_b_interest_due ?? 0;
    case 'CLASS_C': return capital.class_c_interest_due ?? 0;
    case 'CLASS_D': return capital.class_d_interest_due ?? 0;
    default:        return 0;
  }
}

function runWaterfallDiversion({ payment_date, period_start, period_end,
    waterfall_steps, coverage_test_results, available_interest_proceeds, capital_structure }) {

  const testIndex = new Map(coverage_test_results.map(r => [r.test_id, r]));
  const sorted    = [...waterfall_steps].sort((a, b) => a.step_number - b.step_number);

  let remaining        = available_interest_proceeds;
  let totalDiverted    = 0;
  let totalDistributed = 0;
  const entries        = [];
  const blocked        = new Set();

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];
    if (blocked.has(step.step_id))       continue;
    if (step.step_type === 'REINVESTMENT') continue;

    if (step.step_type === 'FEE' || step.step_type === 'INTEREST_PAYMENT') {
      const amt  = resolveWaterfallPayment(step, capital_structure, remaining);
      const paid = r2(Math.min(amt, remaining));
      remaining        = r2(remaining - paid);
      totalDistributed = r2(totalDistributed + paid);
      continue;
    }

    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      const { passed, failingTestId } = evaluateCondition(step.condition, testIndex);
      if (passed) {
        if (step.note_class) {
          const amt  = resolveNoteInterest(step.note_class, capital_structure);
          const paid = r2(Math.min(amt, remaining));
          remaining        = r2(remaining - paid);
          totalDistributed = r2(totalDistributed + paid);
        }
      } else {
        const before   = remaining;
        const diverted = remaining;
        remaining      = 0;
        totalDiverted  = r2(totalDiverted + diverted);
        const target   = step.diverts_to || { step_type: 'REINVESTMENT', note_class_priority: [], description: 'Principal reinvestment/cure' };
        entries.push({
          step_id:           step.step_id,
          step_number:       step.step_number,
          triggering_test:   failingTestId || (step.condition && step.condition.test_type) || 'UNKNOWN',
          test_result:       'FAIL',
          diversion_amount:  r2(diverted),
          diversion_target:  target,
          cure_mechanism:    step.cure_mechanism || 'REINVESTMENT',
          proceeds_before:   r2(before),
          proceeds_after:    0,
          indenture_section: step.indenture_section,
        });
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].step_type !== 'REINVESTMENT') blocked.add(sorted[j].step_id);
        }
        break;
      }
    }
  }

  return {
    payment_date,
    period_start,
    period_end,
    total_interest_proceeds: r2(available_interest_proceeds),
    total_diverted:          r2(totalDiverted),
    total_distributed:       r2(totalDistributed),
    entries,
    blocked_steps: [...blocked],
  };
}

// ── Phase 4B — Full Waterfall Allocation Engine ───────────────────────────────

function resolveFeeAmount4B(step, nb) {
  const id = step.step_id.toUpperCase();
  const { fees } = nb;
  if (id.includes('TRUSTEE') || id.includes('ADMIN'))         return fees.trustee_and_admin;
  if (id.includes('SR_MGMT') || id.includes('SENIOR_MGMT'))  return fees.senior_management_fee;
  if (id.includes('SUB_MGMT') || id.includes('SUBORDINATE')) return fees.subordinate_management_fee;
  if (id.includes('HEDGE'))                                   return fees.hedge_termination ?? 0;
  return 0;
}

function resolveNoteBalance4B(noteClass, nb) {
  const map = { CLASS_A: 'class_a', CLASS_B: 'class_b', CLASS_C: 'class_c', CLASS_D: 'class_d', CLASS_E: 'class_e' };
  const key = map[noteClass];
  return key ? (nb[key] ?? null) : null;
}

function resolveInterestDue4B(step, nb) {
  if (!step.note_class) return 0;
  const bal = resolveNoteBalance4B(step.note_class, nb);
  if (!bal) return 0;
  return r2(bal.accrued_interest + (bal.deferred_interest ?? 0));
}

function inferAmountDue4B(step, nb) {
  if (step.step_type === 'FEE')                                              return resolveFeeAmount4B(step, nb);
  if (step.step_type === 'INTEREST_PAYMENT')                                 return resolveInterestDue4B(step, nb);
  if (step.step_type === 'COVERAGE_TEST_CHECK' && step.note_class)           return resolveInterestDue4B(step, nb);
  return 0;
}

function runWaterfall4B({ waterfall_steps, coverage_test_results, collections, note_balances }) {
  const testIndex = new Map(coverage_test_results.map(r => [r.test_id, r]));
  const sorted    = [...waterfall_steps].sort((a, b) => a.step_number - b.step_number);

  let interest_bucket  = r2(collections.total_interest_proceeds + collections.hedge_receipts);
  let principal_bucket = r2(collections.total_principal_proceeds);
  let total_allocated  = 0;
  const entries    = [];
  const diversions = [];
  const blockedIds = new Set();

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];

    if (step.step_type === 'REINVESTMENT') continue;

    if (blockedIds.has(step.step_id)) {
      const due = inferAmountDue4B(step, note_balances);
      entries.push({
        step_id: step.step_id, step_number: step.step_number, step_type: step.step_type,
        beneficiary: step.beneficiary ?? '', note_class: step.note_class,
        payment_type: step.payment_type ?? 'INTEREST',
        amount_due: due, amount_paid: 0, shortfall: due,
        proceeds_bucket_before: 0, proceeds_bucket_after: 0,
        blocked: true, indenture_section: step.indenture_section,
      });
      continue;
    }

    if (step.step_type === 'FEE') {
      const due = resolveFeeAmount4B(step, note_balances);
      const paid = r2(Math.min(due, interest_bucket));
      const bef = interest_bucket;
      interest_bucket = r2(interest_bucket - paid);
      total_allocated = r2(total_allocated + paid);
      entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'FEE',
        beneficiary: step.beneficiary ?? '', payment_type: 'FEE',
        amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
        proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
        blocked: false, indenture_section: step.indenture_section });
      continue;
    }

    if (step.step_type === 'INTEREST_PAYMENT') {
      const due = resolveInterestDue4B(step, note_balances);
      const paid = r2(Math.min(due, interest_bucket));
      const bef = interest_bucket;
      interest_bucket = r2(interest_bucket - paid);
      total_allocated = r2(total_allocated + paid);
      entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'INTEREST_PAYMENT',
        beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
        amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
        proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
        blocked: false, indenture_section: step.indenture_section });
      continue;
    }

    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      const { passed, failingTestId } = evaluateCondition(step.condition, testIndex);

      if (passed) {
        if (step.note_class) {
          const due = resolveInterestDue4B(step, note_balances);
          const paid = r2(Math.min(due, interest_bucket));
          const bef = interest_bucket;
          interest_bucket = r2(interest_bucket - paid);
          total_allocated = r2(total_allocated + paid);
          entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'COVERAGE_TEST_CHECK',
            beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
            amount_due: due, amount_paid: paid, shortfall: r2(due - paid),
            proceeds_bucket_before: bef, proceeds_bucket_after: interest_bucket,
            blocked: false, indenture_section: step.indenture_section });
        }
        continue;
      }

      // Diversion fires — transfer all remaining interest to the principal bucket.
      const divAmount = interest_bucket;
      const bef = interest_bucket;
      interest_bucket  = 0;
      principal_bucket = r2(principal_bucket + divAmount);

      diversions.push({
        step_id: step.step_id, step_number: step.step_number,
        triggering_test: failingTestId ?? (step.condition && step.condition.test_type) ?? 'UNKNOWN',
        test_result: 'FAIL', diversion_amount: r2(divAmount),
        diversion_target: step.diverts_to ?? { step_type: 'REINVESTMENT', note_class_priority: [], description: 'Principal reinvestment/cure' },
        cure_mechanism: step.cure_mechanism ?? 'REINVESTMENT',
        proceeds_before: r2(bef), proceeds_after: 0,
        indenture_section: step.indenture_section,
      });

      if (step.note_class) {
        const due = resolveInterestDue4B(step, note_balances);
        entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'COVERAGE_TEST_CHECK',
          beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'INTEREST',
          amount_due: due, amount_paid: 0, shortfall: due,
          proceeds_bucket_before: bef, proceeds_bucket_after: 0,
          blocked: false, indenture_section: step.indenture_section });
      }

      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].step_type !== 'REINVESTMENT') blockedIds.add(sorted[j].step_id);
      }
      continue;
    }

    if (step.step_type === 'PRINCIPAL_PAYMENT') {
      const due = principal_bucket;
      const paid = r2(Math.min(due, principal_bucket));
      const bef = principal_bucket;
      principal_bucket = r2(principal_bucket - paid);
      total_allocated  = r2(total_allocated + paid);
      entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'PRINCIPAL_PAYMENT',
        beneficiary: step.beneficiary ?? '', note_class: step.note_class, payment_type: 'PRINCIPAL',
        amount_due: due, amount_paid: paid, shortfall: 0,
        proceeds_bucket_before: bef, proceeds_bucket_after: principal_bucket,
        blocked: false, indenture_section: step.indenture_section });
      continue;
    }

    if (step.step_type === 'RESERVE_ACCOUNT_FUNDING') {
      const due = principal_bucket;
      const paid = r2(Math.min(due, principal_bucket));
      const bef = principal_bucket;
      principal_bucket = r2(principal_bucket - paid);
      total_allocated  = r2(total_allocated + paid);
      entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'RESERVE_ACCOUNT_FUNDING',
        beneficiary: step.beneficiary ?? 'Reserve Account', payment_type: 'PRINCIPAL',
        amount_due: due, amount_paid: paid, shortfall: 0,
        proceeds_bucket_before: bef, proceeds_bucket_after: principal_bucket,
        blocked: false, indenture_section: step.indenture_section });
      continue;
    }

    if (step.step_type === 'EQUITY_DISTRIBUTION') {
      const combined = r2(interest_bucket + principal_bucket);
      interest_bucket  = 0;
      principal_bucket = 0;
      total_allocated  = r2(total_allocated + combined);
      entries.push({ step_id: step.step_id, step_number: step.step_number, step_type: 'EQUITY_DISTRIBUTION',
        beneficiary: step.beneficiary ?? 'Preferred Interest Holders', payment_type: 'EQUITY_DISTRIBUTION',
        amount_due: combined, amount_paid: combined, shortfall: 0,
        proceeds_bucket_before: combined, proceeds_bucket_after: 0,
        blocked: false, indenture_section: step.indenture_section });
      continue;
    }
  }

  return {
    payment_date:       collections.payment_date,
    period_start:       collections.period_start,
    period_end:         collections.period_end,
    collections,
    total_allocated:    r2(total_allocated),
    residual_interest:  r2(interest_bucket),
    residual_principal: r2(principal_bucket),
    entries,
    diversions,
  };
}

// Build NoteBalanceSnapshot from the legacy capital structure (real-mode fallback).
function noteBalancesFromCapital(capital) {
  const nb = {
    payment_date: new Date().toISOString().slice(0, 10),
    class_a: { outstanding_balance: 0, accrued_interest: capital.class_a_interest_due },
    fees: {
      trustee_and_admin:          capital.trustee_fee,
      senior_management_fee:      capital.senior_management_fee,
      subordinate_management_fee: capital.subordinate_management_fee ?? 0,
    },
  };
  if (capital.class_b_interest_due != null) nb.class_b = { outstanding_balance: 0, accrued_interest: capital.class_b_interest_due };
  if (capital.class_c_interest_due != null) nb.class_c = { outstanding_balance: 0, accrued_interest: capital.class_c_interest_due };
  if (capital.class_d_interest_due != null) nb.class_d = { outstanding_balance: 0, accrued_interest: capital.class_d_interest_due };
  return nb;
}

// ── Extraction validation for waterfall_steps ─────────────────────────────────

function validateWaterfallStepsExtraction(steps) {
  const errors = [];
  const VALID_TYPES = new Set(['FEE','INTEREST_PAYMENT','COVERAGE_TEST_CHECK','DIVERSION',
    'PRINCIPAL_PAYMENT','REINVESTMENT','EQUITY_DISTRIBUTION','RESERVE_ACCOUNT_FUNDING']);
  (steps || []).forEach((step, i) => {
    const lbl = step.step_id || `step[${i}]`;
    if (!step.step_id)                        errors.push(`${lbl}: missing step_id`);
    if (typeof step.step_number !== 'number') errors.push(`${lbl}: step_number must be a number`);
    if (!VALID_TYPES.has(step.step_type))     errors.push(`${lbl}: unrecognised step_type "${step.step_type}"`);
    if (step.step_type === 'COVERAGE_TEST_CHECK') {
      if (!step.condition)  errors.push(`${lbl}: COVERAGE_TEST_CHECK missing condition`);
      if (!step.diverts_to) errors.push(`${lbl}: COVERAGE_TEST_CHECK missing diverts_to`);
    }
  });
  return errors;
}

// ── Scenario validation ───────────────────────────────────────────────────────

function validateDiversionLedger(actual, expected, scenarioId) {
  const errors = [];
  if (r2(actual.total_diverted) !== r2(expected.total_diverted))
    errors.push(`total_diverted: expected ${expected.total_diverted}, got ${actual.total_diverted}`);
  if (r2(actual.total_distributed) !== r2(expected.total_distributed))
    errors.push(`total_distributed: expected ${expected.total_distributed}, got ${actual.total_distributed}`);
  if (actual.entries.length !== expected.entry_count)
    errors.push(`entry count: expected ${expected.entry_count}, got ${actual.entries.length}`);

  (expected.entry_checks || []).forEach((exp, i) => {
    const act = actual.entries[i];
    if (!act) { errors.push(`entry[${i}] missing`); return; }
    if (act.step_id         !== exp.step_id)         errors.push(`entry[${i}].step_id: expected ${exp.step_id}, got ${act.step_id}`);
    if (act.triggering_test !== exp.triggering_test) errors.push(`entry[${i}].triggering_test: expected ${exp.triggering_test}, got ${act.triggering_test}`);
    if (r2(act.diversion_amount) !== r2(exp.diversion_amount)) errors.push(`entry[${i}].diversion_amount: expected ${exp.diversion_amount}, got ${act.diversion_amount}`);
    if (r2(act.proceeds_before)  !== r2(exp.proceeds_before))  errors.push(`entry[${i}].proceeds_before: expected ${exp.proceeds_before}, got ${act.proceeds_before}`);
  });

  const expBlocked = new Set(expected.blocked_steps || []);
  const actBlocked = new Set(actual.blocked_steps   || []);
  for (const s of expBlocked) { if (!actBlocked.has(s)) errors.push(`blocked_steps: missing "${s}"`); }
  for (const s of actBlocked) { if (!expBlocked.has(s)) errors.push(`blocked_steps: unexpected "${s}"`); }

  return { passed: errors.length === 0, errors };
}

// ── Fixture: waterfall steps for synthetic deal ───────────────────────────────

const FIXTURE_WATERFALL_STEPS = [
  { step_id: 'STEP_01_TRUSTEE_FEE',      step_number: 1, step_type: 'FEE',
    label: 'Trustee fees and expenses (Senior Expenses)', indenture_section: 'Section 13.1, Step 1',
    beneficiary: 'Trustee', payment_type: 'FEE', amount_basis: 'FIXED' },
  { step_id: 'STEP_02_SR_MGMT_FEE',      step_number: 2, step_type: 'FEE',
    label: 'Senior Management Fee', indenture_section: 'Section 13.1, Step 2',
    beneficiary: 'Collateral Manager', payment_type: 'FEE', amount_basis: 'FIXED' },
  { step_id: 'STEP_03_HEDGE',            step_number: 3, step_type: 'FEE',
    label: 'Hedge Counterparty payments', indenture_section: 'Section 13.1, Step 3',
    beneficiary: 'Hedge Counterparties', payment_type: 'FEE', amount_basis: 'FIXED' },
  { step_id: 'STEP_04_CLASS_A_INTEREST', step_number: 4, step_type: 'INTEREST_PAYMENT',
    label: 'Accrued and unpaid interest on the Class A Notes', indenture_section: 'Section 13.1, Step 4',
    beneficiary: 'Class A Noteholders', payment_type: 'INTEREST', note_class: 'CLASS_A', amount_basis: 'ACCRUED_INTEREST' },
  { step_id: 'STEP_05_IC_CHECK',         step_number: 5, step_type: 'COVERAGE_TEST_CHECK',
    label: 'Class A/B Interest Coverage Test — divert if IC fails', indenture_section: 'Section 11.2(a)',
    condition: { test_type: 'IC', note_classes_tested: ['CLASS_A', 'CLASS_B'], operator: 'ALL_PASS' },
    condition_raw: 'Interest Proceeds diverted per Section 13.1(b) if IC test fails',
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: [], description: 'Redirect all remaining interest proceeds to principal reinvestment account' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_06_OC_AB_CHECK',      step_number: 6, step_type: 'COVERAGE_TEST_CHECK',
    label: 'Class B Notes interest — provided Class A/B OC Test is satisfied', indenture_section: 'Section 13.1, Step 5',
    beneficiary: 'Class B Noteholders', payment_type: 'INTEREST', note_class: 'CLASS_B', amount_basis: 'ACCRUED_INTEREST',
    condition: { test_type: 'OC', note_classes_tested: ['CLASS_A', 'CLASS_B'], operator: 'ALL_PASS' },
    condition_raw: 'Provided Class A/B OC Test is satisfied; otherwise redirect to Step 8',
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: ['CLASS_B', 'CLASS_C'], description: 'Redirect to principal reinvestment account or pro rata paydown' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_07_OC_C_CHECK',       step_number: 7, step_type: 'COVERAGE_TEST_CHECK',
    label: 'Class C Notes interest — provided Class C OC Test is satisfied', indenture_section: 'Section 13.1, Step 6',
    beneficiary: 'Class C Noteholders', payment_type: 'INTEREST', note_class: 'CLASS_C', amount_basis: 'ACCRUED_INTEREST',
    condition: { test_type: 'OC', note_classes_tested: ['CLASS_A', 'CLASS_B', 'CLASS_C'], operator: 'ALL_PASS' },
    condition_raw: 'Provided Class C OC Test is satisfied; otherwise redirect to Step 8',
    diverts_to: { step_type: 'REINVESTMENT', note_class_priority: ['CLASS_C'], description: 'Redirect to principal reinvestment account or pro rata paydown' },
    cure_mechanism: 'REINVESTMENT' },
  { step_id: 'STEP_08_SUB_MGMT_FEE',    step_number: 8, step_type: 'FEE',
    label: 'Subordinate Management Fee', indenture_section: 'Section 13.1, Step 7',
    beneficiary: 'Collateral Manager', payment_type: 'FEE', amount_basis: 'FIXED' },
  { step_id: 'STEP_09_REINVESTMENT',     step_number: 9, step_type: 'REINVESTMENT',
    label: 'Reinvestment/cure — principal reinvestment account or pro rata paydown', indenture_section: 'Section 13.1, Step 8',
    cure_mechanism: 'REINVESTMENT' },
];

// ── Fixture: 5 scenarios ──────────────────────────────────────────────────────

const FIXTURE_CAPITAL = WATERFALL_CAPITAL_STRUCTURE;

const WATERFALL_SCENARIOS = [
  {
    id: 'SYN_4A_01', description: 'All OC/IC tests pass — no diversion, full interest distributed',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: FIXTURE_WATERFALL_STEPS, capital_structure: FIXTURE_CAPITAL,
      available_interest_proceeds: 13.30,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ],
    },
    expected: { total_interest_proceeds: 13.30, total_diverted: 0, total_distributed: 8.60, entry_count: 0, entry_checks: [], blocked_steps: [] },
  },
  {
    id: 'SYN_4A_02', description: 'Class A/B OC test fails — diversion fires, junior classes blocked',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: FIXTURE_WATERFALL_STEPS, capital_structure: FIXTURE_CAPITAL,
      available_interest_proceeds: 13.30,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 114.58, threshold_pct: 123.50, result: 'FAIL' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct:  98.21, threshold_pct: 112.75, result: 'FAIL' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ],
    },
    expected: { total_interest_proceeds: 13.30, total_diverted: 8.30, total_distributed: 5.00, entry_count: 1,
      entry_checks: [{ step_id: 'STEP_06_OC_AB_CHECK', triggering_test: 'OC_CLASS_AB', diversion_amount: 8.30, proceeds_before: 8.30 }],
      blocked_steps: ['STEP_07_OC_C_CHECK', 'STEP_08_SUB_MGMT_FEE'] },
  },
  {
    id: 'SYN_4A_03', description: 'IC test fails — separate diversion path from OC',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: FIXTURE_WATERFALL_STEPS, capital_structure: FIXTURE_CAPITAL,
      available_interest_proceeds: 7.50,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 114.50, threshold_pct: 120.00, result: 'FAIL' },
      ],
    },
    expected: { total_interest_proceeds: 7.50, total_diverted: 2.50, total_distributed: 5.00, entry_count: 1,
      entry_checks: [{ step_id: 'STEP_05_IC_CHECK', triggering_test: 'IC_CLASS_AB', diversion_amount: 2.50, proceeds_before: 2.50 }],
      blocked_steps: ['STEP_06_OC_AB_CHECK', 'STEP_07_OC_C_CHECK', 'STEP_08_SUB_MGMT_FEE'] },
  },
  {
    id: 'SYN_4A_04', description: 'Multiple tests fail simultaneously — diversion priority ordering',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: FIXTURE_WATERFALL_STEPS, capital_structure: FIXTURE_CAPITAL,
      available_interest_proceeds: 6.00,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 104.17, threshold_pct: 123.50, result: 'FAIL' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct:  89.29, threshold_pct: 112.75, result: 'FAIL' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct:  91.60, threshold_pct: 120.00, result: 'FAIL' },
      ],
    },
    // IC fires first (step 5 < step 6/7); OC checks blocked and never execute
    expected: { total_interest_proceeds: 6.00, total_diverted: 1.00, total_distributed: 5.00, entry_count: 1,
      entry_checks: [{ step_id: 'STEP_05_IC_CHECK', triggering_test: 'IC_CLASS_AB', diversion_amount: 1.00, proceeds_before: 1.00 }],
      blocked_steps: ['STEP_06_OC_AB_CHECK', 'STEP_07_OC_C_CHECK', 'STEP_08_SUB_MGMT_FEE'] },
  },
  {
    id: 'SYN_4A_05', description: 'Test is right at threshold (pass by 1bp) — no diversion fires',
    input: {
      payment_date: '2026-04-15', period_start: '2026-01-15', period_end: '2026-04-14',
      waterfall_steps: FIXTURE_WATERFALL_STEPS, capital_structure: FIXTURE_CAPITAL,
      available_interest_proceeds: 13.30,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 131.55, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 112.76, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ],
    },
    expected: { total_interest_proceeds: 13.30, total_diverted: 0, total_distributed: 8.60, entry_count: 0, entry_checks: [], blocked_steps: [] },
  },
];

// ── Phase 4B fixtures ─────────────────────────────────────────────────────────

const FIXTURE_WATERFALL_STEPS_4B = [
  ...FIXTURE_WATERFALL_STEPS,
  { step_id: 'STEP_10_EQUITY', step_number: 10, step_type: 'EQUITY_DISTRIBUTION',
    label: 'Residual to Preferred Interest Holders', indenture_section: 'Section 13.1, Step 9',
    beneficiary: 'Preferred Interest Holders', payment_type: 'EQUITY_DISTRIBUTION' },
];

const FIXTURE_NOTE_BALANCES_4B = {
  payment_date: '2025-01-15',
  class_a: { outstanding_balance: 180.00, accrued_interest: 4.50 },
  class_b: { outstanding_balance:  72.00, accrued_interest: 1.80 },
  class_c: { outstanding_balance:  64.00, accrued_interest: 1.60 },
  fees: { trustee_and_admin: 0.25, senior_management_fee: 0.25, subordinate_management_fee: 0.20 },
};

const FIXTURE_COLLECTIONS_NORMAL_4B = {
  payment_date: '2025-01-15', period_start: '2024-10-29', period_end: '2025-01-13',
  scheduled_interest: 11.50, unscheduled_interest: 0.50, default_interest_recovered: 0.00,
  total_interest_proceeds: 12.00,
  scheduled_principal: 2.00, unscheduled_principal: 2.50, default_principal_recovered: 0.50,
  total_principal_proceeds: 5.00,
  hedge_receipts: 0.00, reserve_account_balance: 1.50,
};

const FIXTURE_COLLECTIONS_THIN_4B = {
  payment_date: '2025-01-15', period_start: '2024-10-29', period_end: '2025-01-13',
  scheduled_interest: 5.80, unscheduled_interest: 0.00, default_interest_recovered: 0.00,
  total_interest_proceeds: 5.80,
  scheduled_principal: 0.50, unscheduled_principal: 0.50, default_principal_recovered: 0.00,
  total_principal_proceeds: 1.00,
  hedge_receipts: 0.00, reserve_account_balance: 0.20,
};

const WATERFALL_SCENARIOS_4B = [
  {
    id: 'SYN_4B_01', description: 'All tests pass — full debt service funded, equity receives residual',
    input: { waterfall_steps: FIXTURE_WATERFALL_STEPS_4B, note_balances: FIXTURE_NOTE_BALANCES_4B,
      collections: FIXTURE_COLLECTIONS_NORMAL_4B,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ] },
    expected: { total_allocated: 17.00, residual_interest: 0, residual_principal: 0, entry_count: 8, diversion_count: 0,
      entry_checks: [
        { step_id: 'STEP_04_CLASS_A_INTEREST', amount_due: 4.50, amount_paid: 4.50, shortfall: 0,    blocked: false },
        { step_id: 'STEP_06_OC_AB_CHECK',      amount_due: 1.80, amount_paid: 1.80, shortfall: 0,    blocked: false },
        { step_id: 'STEP_10_EQUITY',           amount_due: 8.40, amount_paid: 8.40, shortfall: 0,    blocked: false },
      ] },
  },
  {
    id: 'SYN_4B_02', description: 'OC breach — Class B diverted, junior blocked, principal bucket grows to 12.00',
    input: { waterfall_steps: FIXTURE_WATERFALL_STEPS_4B, note_balances: FIXTURE_NOTE_BALANCES_4B,
      collections: FIXTURE_COLLECTIONS_NORMAL_4B,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 114.58, threshold_pct: 123.50, result: 'FAIL' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct:  98.21, threshold_pct: 112.75, result: 'FAIL' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 203.05, threshold_pct: 120.00, result: 'PASS' },
      ] },
    expected: { total_allocated: 5.00, residual_interest: 0, residual_principal: 12.00, entry_count: 8, diversion_count: 1,
      diversion_checks: [{ step_id: 'STEP_06_OC_AB_CHECK', diversion_amount: 7.00, triggering_test: 'OC_CLASS_AB' }],
      entry_checks: [
        { step_id: 'STEP_06_OC_AB_CHECK',  amount_due: 1.80, amount_paid: 0,    shortfall: 1.80, blocked: false },
        { step_id: 'STEP_07_OC_C_CHECK',   amount_due: 1.60, amount_paid: 0,    shortfall: 1.60, blocked: true  },
        { step_id: 'STEP_08_SUB_MGMT_FEE', amount_due: 0.20, amount_paid: 0,    shortfall: 0.20, blocked: true  },
        { step_id: 'STEP_10_EQUITY',        amount_due: 0,    amount_paid: 0,    shortfall: 0,    blocked: true  },
      ] },
  },
  {
    id: 'SYN_4B_03', description: 'Thin collections — shortfall propagates; Class B partial, C zero; equity sweeps principal',
    input: { waterfall_steps: FIXTURE_WATERFALL_STEPS_4B, note_balances: FIXTURE_NOTE_BALANCES_4B,
      collections: FIXTURE_COLLECTIONS_THIN_4B,
      coverage_test_results: [
        { test_id: 'OC_CLASS_AB', test_type: 'overcollateralization', calculated_pct: 150.21, threshold_pct: 123.50, result: 'PASS' },
        { test_id: 'OC_CLASS_C',  test_type: 'overcollateralization', calculated_pct: 128.75, threshold_pct: 112.75, result: 'PASS' },
        { test_id: 'IC_CLASS_AB', test_type: 'interest_coverage',     calculated_pct: 114.50, threshold_pct: 120.00, result: 'PASS' },
      ] },
    expected: { total_allocated: 6.80, residual_interest: 0, residual_principal: 0, entry_count: 8, diversion_count: 0,
      entry_checks: [
        { step_id: 'STEP_06_OC_AB_CHECK',  amount_due: 1.80, amount_paid: 0.80, shortfall: 1.00, blocked: false },
        { step_id: 'STEP_07_OC_C_CHECK',   amount_due: 1.60, amount_paid: 0.00, shortfall: 1.60, blocked: false },
        { step_id: 'STEP_08_SUB_MGMT_FEE', amount_due: 0.20, amount_paid: 0.00, shortfall: 0.20, blocked: false },
        { step_id: 'STEP_10_EQUITY',        amount_due: 1.00, amount_paid: 1.00, shortfall: 0,    blocked: false },
      ] },
  },
];

function validateAllocationLedger4B(actual, expected) {
  const errors = [];
  const chk = (lbl, a, e) => { if (r2(a) !== r2(e)) errors.push(`${lbl}: expected ${e}, got ${a}`); };
  chk('total_allocated',    actual.total_allocated,    expected.total_allocated);
  chk('residual_interest',  actual.residual_interest,  expected.residual_interest);
  chk('residual_principal', actual.residual_principal, expected.residual_principal);
  if (actual.entries.length !== expected.entry_count)
    errors.push(`entry_count: expected ${expected.entry_count}, got ${actual.entries.length}`);
  if (actual.diversions.length !== expected.diversion_count)
    errors.push(`diversion_count: expected ${expected.diversion_count}, got ${actual.diversions.length}`);
  for (const ec of (expected.entry_checks || [])) {
    const entry = actual.entries.find(e => e.step_id === ec.step_id);
    if (!entry) { errors.push(`entry ${ec.step_id}: not found`); continue; }
    chk(`${ec.step_id}.amount_due`,  entry.amount_due,  ec.amount_due);
    chk(`${ec.step_id}.amount_paid`, entry.amount_paid, ec.amount_paid);
    chk(`${ec.step_id}.shortfall`,   entry.shortfall,   ec.shortfall);
    if (entry.blocked !== ec.blocked) errors.push(`${ec.step_id}.blocked: expected ${ec.blocked}, got ${entry.blocked}`);
  }
  for (const dc of (expected.diversion_checks || [])) {
    const div = actual.diversions.find(d => d.step_id === dc.step_id);
    if (!div) { errors.push(`diversion ${dc.step_id}: not found`); continue; }
    chk(`${dc.step_id}.diversion_amount`, div.diversion_amount, dc.diversion_amount);
    if (div.triggering_test !== dc.triggering_test)
      errors.push(`${dc.step_id}.triggering_test: expected ${dc.triggering_test}, got ${div.triggering_test}`);
  }
  return { passed: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  navy: '\x1b[34m', amber: '\x1b[33m', green: '\x1b[32m',
  red: '\x1b[31m', cyan: '\x1b[36m', grey: '\x1b[90m'
};

function banner(text) {
  const line = '─'.repeat(68);
  console.log(`\n${C.navy}${C.bold}${line}${C.reset}`);
  console.log(`${C.navy}${C.bold}  ${text}${C.reset}`);
  console.log(`${C.navy}${C.bold}${line}${C.reset}\n`);
}

function section(text) {
  console.log(`\n${C.amber}${C.bold}▸ ${text}${C.reset}`);
  console.log(`${C.grey}${'─'.repeat(50)}${C.reset}`);
}

function pass(text) { console.log(`  ${C.green}✓${C.reset}  ${text}`); }
function fail(text) { console.log(`  ${C.red}✗${C.reset}  ${C.bold}${text}${C.reset}`); }
function info(text) { console.log(`  ${C.cyan}·${C.reset}  ${text}`); }
function warn(text) { console.log(`  ${C.amber}⚠${C.reset}  ${text}`); }
function dim(text)  { console.log(`  ${C.grey}${text}${C.reset}`); }

function printAllocationTable(entries) {
  const pL = (s, n) => String(s ?? '').padEnd(n);
  const pR = (s, n) => String(s ?? '').padStart(n);
  const HR = '─'.repeat(92);
  console.log(`\n  ${C.grey}${HR}${C.reset}`);
  console.log(`  ${C.grey}${pL('#  Step ID', 30)} ${pL('Beneficiary', 28)} ${pR('Due $M', 7)} ${pR('Paid $M', 7)} ${pR('Shortfall', 9)}  Blocked${C.reset}`);
  console.log(`  ${C.grey}${HR}${C.reset}`);
  for (const e of entries) {
    const stepLabel = pL(`${e.step_number}  ${e.step_id}`, 30);
    const bene      = pL((e.beneficiary || '—').slice(0, 27), 28);
    const due       = pR(e.amount_due.toFixed(2), 7);
    const paid      = pR(e.amount_paid.toFixed(2), 7);
    const sfStr     = pR(e.shortfall.toFixed(2), 9);
    const sfColor   = e.shortfall > 0 ? C.amber : C.grey;
    const blkStr    = e.blocked ? `${C.amber}YES${C.reset}` : `${C.grey}—${C.reset}`;
    const diverted  = e.step_type === 'COVERAGE_TEST_CHECK' && e.amount_paid === 0 && !e.blocked;
    const rowColor  = diverted ? C.amber : (e.blocked ? C.grey : C.reset);
    console.log(`  ${rowColor}${stepLabel}${C.reset} ${rowColor}${bene}${C.reset} ${due} ${e.shortfall > 0 && !e.blocked ? C.amber : ''}${paid}${C.reset} ${sfColor}${sfStr}${C.reset}  ${blkStr}`);
  }
  console.log(`  ${C.grey}${HR}${C.reset}\n`);
}

function printAllocationSummary(ledger) {
  const feesPaid = ledger.entries
    .filter(e => e.step_type === 'FEE' && !e.blocked)
    .reduce((s, e) => s + e.amount_paid, 0);

  const byClass = {};
  for (const e of ledger.entries) {
    if (!e.blocked && e.note_class && (e.step_type === 'INTEREST_PAYMENT' || e.step_type === 'COVERAGE_TEST_CHECK')) {
      byClass[e.note_class] = r2((byClass[e.note_class] ?? 0) + e.amount_paid);
    }
  }

  const equityEntry = ledger.entries.find(e => e.step_type === 'EQUITY_DISTRIBUTION' && !e.blocked);
  const totalInterest = r2(Object.values(byClass).reduce((s, v) => s + v, 0));

  info(`Fees:                  ${C.bold}$${r2(feesPaid).toFixed(2)}M${C.reset}`);
  for (const [cls, amt] of Object.entries(byClass)) {
    const lbl = `Interest — ${cls.replace('CLASS_', 'Class ')}:`;
    info(`${lbl.padEnd(23)} ${C.bold}$${amt.toFixed(2)}M${C.reset}`);
  }
  if (Object.keys(byClass).length > 1) {
    info(`Total interest:        ${C.bold}$${totalInterest.toFixed(2)}M${C.reset}`);
  }
  if (equityEntry && equityEntry.amount_paid > 0) {
    info(`Equity distribution:   ${C.bold}$${equityEntry.amount_paid.toFixed(2)}M${C.reset}`);
  }
  console.log();
  info(`Total allocated:       ${C.bold}$${ledger.total_allocated.toFixed(2)}M${C.reset}`);

  if (ledger.diversions.length > 0) {
    console.log();
    for (const div of ledger.diversions) {
      const tgt = div.diversion_target ? (div.diversion_target.description || div.diversion_target.step_type) : 'REINVESTMENT';
      warn(`Diversion fired: $${div.diversion_amount.toFixed(2)}M → ${tgt}`);
      dim(`    Test: ${div.triggering_test} FAIL  ·  Section: ${div.indenture_section}`);
    }
  }

  console.log();
  if (ledger.residual_interest === 0 && ledger.residual_principal === 0) {
    pass('Both buckets closed to zero — waterfall fully allocated');
  } else {
    if (ledger.residual_interest  > 0) warn(`Residual interest:     $${ledger.residual_interest.toFixed(2)}M  (spec gap)`);
    if (ledger.residual_principal > 0) info(`Residual principal:    ${C.bold}$${ledger.residual_principal.toFixed(2)}M${C.reset}  (reinvestment proceeds)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const verbose       = args.includes('--verbose');
  const runWaterfall  = args.includes('--waterfall');
  const outputJson    = args.includes('--output=json');
  const fileArg       = args.indexOf('--file');
  const modeArg       = args.find(a => a.startsWith('--mode='));
  const mode          = modeArg ? modeArg.split('=')[1] : 'synthetic';
  const maxTokensArg  = args.find(a => a.startsWith('--max-tokens='));
  const maxTokens     = maxTokensArg ? parseInt(maxTokensArg.split('=')[1], 10) : 8000;
  const indentureArg  = args.find(a => a.startsWith('--indenture='));
  const loanTapeArg   = args.find(a => a.startsWith('--loan-tape='));
  const noticeArgs    = args.filter(a => a.startsWith('--notice='));

  if (mode !== 'synthetic' && mode !== 'real') {
    console.error(`Unknown --mode value "${mode}". Valid values: synthetic, real`);
    process.exit(1);
  }

  let indentureText = SYNTHETIC_INDENTURE;
  if (indentureArg) {
    const indPath = indentureArg.split('=').slice(1).join('=');
    indentureText = fs.readFileSync(indPath, 'utf8');
    info(`Using indenture file: ${indPath}`);
  } else if (fileArg !== -1 && args[fileArg + 1]) {
    indentureText = fs.readFileSync(args[fileArg + 1], 'utf8');
    info(`Using indenture file: ${args[fileArg + 1]}`);
  } else {
    info('Using built-in synthetic indenture (Barlow CLO I, Ltd.)');
  }

  let activeLoanTape = LOAN_TAPE;
  let canonicalLoans = null;
  if (loanTapeArg) {
    const tapePath = loanTapeArg.split('=').slice(1).join('=');
    try {
      const loaded = loadLoanTape(tapePath);
      canonicalLoans = loaded.canonical;
      activeLoanTape = loaded.legacy;
    } catch (e) {
      fail(`Failed to load loan tape: ${e.message}`);
      process.exit(1);
    }
  }

  if (mode === 'real') {
    console.log(`  ${C.amber}[WARN] Ground truth validation disabled — running in real indenture mode${C.reset}`);
    console.log();
  }

  banner('BARLOW  ·  CLO Administration AI Pipeline  ·  Phase 1 CLI');

  // ── STEP 1: EXTRACTION ──────────────────────────────────────────────────
  section('STEP 1 — Indenture Extraction (AI)');
  info('Sending indenture text to Claude for structured rule extraction...');
  console.log();

  let extracted;
  try {
    const response = await callClaude(EXTRACTION_SYSTEM_PROMPT, indentureText, maxTokens);
    const rawText = response.content[0]?.text || '';

    if (verbose) {
      console.log(`${C.grey}Raw API response:${C.reset}`);
      console.log(rawText);
      console.log();
    }

    // Strip any accidental markdown fences
    const clean = rawText.replace(/```json\s*|```\s*/g, '').trim();
    extracted = JSON.parse(clean);

    const limitCount = extracted.concentration_limits?.length || 0;
    if (limitCount < 10) {
      warn(`[WARN] Low concentration limit count (${limitCount}). Consider increasing --max-tokens if running a real indenture.`);
    }

  } catch (e) {
    fail(`Extraction failed: ${e.message}`);
    process.exit(1);
  }

  info(`Deal: ${C.bold}${extracted.deal_name}${C.reset}`);
  info(`Coverage tests extracted: ${C.bold}${extracted.coverage_tests?.length || 0}${C.reset}`);
  info(`Concentration limits extracted: ${C.bold}${extracted.concentration_limits?.length || 0}${C.reset}`);
  const extractedWaterfallSteps = extracted.waterfall_steps || extracted.waterfall || [];
  if (extracted.waterfall && !extracted.waterfall_steps) {
    warn('[WARN] Extraction used legacy "waterfall" field — diversion engine requires "waterfall_steps" (new schema). Re-run with updated prompt.');
  }
  info(`Waterfall steps extracted: ${C.bold}${extractedWaterfallSteps.length}${C.reset}`);
  info(`Overall confidence: ${C.bold}${extracted.extraction_summary?.overall_confidence || 'N/A'}${C.reset}`);

  if (extracted.extraction_summary?.flags?.length > 0) {
    console.log();
    warn('Extraction flags:');
    extracted.extraction_summary.flags.forEach(f => dim(`    ${f}`));
  }

  // ── STEP 2: VALIDATION ──────────────────────────────────────────────────
  const step2Label = mode === 'real'
    ? 'STEP 2 — Extraction Validation (structural check)'
    : 'STEP 2 — Extraction Validation (ground truth check)';
  section(step2Label);

  if (mode === 'real') {
    warn('[WARN] Ground truth validation disabled — running in real indenture mode');
    console.log();
  }

  const validation = mode === 'real'
    ? validateStructure(extracted)
    : validateExtraction(extracted);

  validation.passed.forEach(p => pass(p));
  validation.failed.forEach(f => fail(f));
  validation.warnings.forEach(w => warn(w));

  const total = validation.passed.length + validation.failed.length;
  const extractionScore = total > 0 ? validation.passed.length / total : 1;
  console.log();
  const scoreColor = extractionScore === 1 ? C.green : extractionScore >= 0.75 ? C.amber : C.red;
  const scoreLabel = mode === 'real' ? 'Structural validity' : 'Extraction accuracy';
  const scoreDetail = mode === 'real'
    ? `${validation.passed.length}/${total} checks passed`
    : `${validation.passed.length}/${total} rules correct`;
  info(`${scoreLabel}: ${scoreColor}${C.bold}${Math.round(extractionScore * 100)}% (${scoreDetail})${C.reset}`);

  // ── LOAN TAPE SUMMARY ────────────────────────────────────────────────────
  if (canonicalLoans) {
    section('LOAN TAPE SUMMARY');
    logTapeSummary(canonicalLoans);
  }

  // ── NOTICE PROCESSING ────────────────────────────────────────────────────
  if (noticeArgs.length > 0) {
    section('NOTICE PROCESSING — Agent Bank Notice Ingestion');

    if (!canonicalLoans) {
      warn('[WARN] --notice flags ignored — --loan-tape= must be set to apply notices');
    } else {
      const noticePaths = noticeArgs.map(a => a.split('=').slice(1).join('='));
      const rawNotices  = [];

      for (const noticePath of noticePaths) {
        try {
          rawNotices.push({ path: noticePath, text: fs.readFileSync(noticePath, 'utf8') });
        } catch (e) {
          fail(`Failed to read notice file "${noticePath}": ${e.message}`);
          process.exit(1);
        }
      }

      info(`Extracting ${rawNotices.length} notice${rawNotices.length !== 1 ? 's' : ''} via Claude...`);
      console.log();

      const parsedNotices = [];
      for (const { path: noticePath, text: noticeText } of rawNotices) {
        try {
          const response = await callClaude(
            NOTICE_SYSTEM_PROMPT,
            buildNoticeMsgCLI(noticeText, canonicalLoans),
            4000,
          );
          const rawText = response.content[0]?.text || '';
          const clean   = rawText.replace(/```json\s*|```\s*/g, '').trim();
          const parsed  = JSON.parse(clean);
          // Always use the original text, never trust model's echo
          parsed.raw_text = noticeText;
          parsedNotices.push(parsed);
          dim(`  Extracted: ${parsed.notice_type} — ${parsed.obligor_name || '(no obligor)'} — confidence ${parsed.extraction_confidence}`);
        } catch (e) {
          fail(`Notice extraction failed for "${noticePath}": ${e.message}`);
          process.exit(1);
        }
      }

      // Sort by effective_date ascending; nulls last
      parsedNotices.sort((a, b) => {
        if (!a.effective_date) return 1;
        if (!b.effective_date) return -1;
        return a.effective_date < b.effective_date ? -1 : 1;
      });

      let totalChanges   = 0;
      const affectedIds  = new Set();
      const allChanges   = [];

      for (const notice of parsedNotices) {
        if (notice.extraction_confidence === 'LOW') {
          warn(`[WARN] LOW-confidence notice ${notice.notice_id} (${notice.notice_type}) — manual verification recommended`);
        }
        const { updatedLoans, changeLog, matchCount } = applyNoticeCLI(notice, canonicalLoans);
        if (matchCount === 0) {
          warn(`[ERROR] No loans matched for notice "${notice.obligor_name}" (${notice.notice_id})`);
        } else if (matchCount > 1 && (!notice.loan_ids || notice.loan_ids.length === 0)) {
          warn(`[WARN] Multiple loans matched for obligor "${notice.obligor_name}" — update applied to all`);
        }
        canonicalLoans = updatedLoans;
        // Rebuild legacy tape so coverage tests reflect notice updates
        activeLoanTape = canonicalLoans.map(l => ({
          loan_id:           l.loan_id,
          obligor_name:      l.obligor_name || l.obligor_id,
          loan_type:         l.loan_type,
          principal_balance: l.principal_balance,
          spread:            l.spread,
          sp_rating:         l.sp_rating,
          moodys_rating:     l.moodys_rating,
          industry:          l.industry,
          maturity_date:     l.maturity_date,
          is_current_pay:    l.is_current_pay,
          is_deferrable:     l.is_deferrable,
        }));
        changeLog.forEach(e => affectedIds.add(e.loan_id));
        totalChanges += changeLog.length;
        allChanges.push(...changeLog);
      }

      console.log();
      info(`${C.bold}${parsedNotices.length} notice${parsedNotices.length !== 1 ? 's' : ''} applied: ${totalChanges} field change${totalChanges !== 1 ? 's' : ''} across ${affectedIds.size} loan${affectedIds.size !== 1 ? 's' : ''}${C.reset}`);

      if (verbose && allChanges.length > 0) {
        console.log();
        dim('  Change log:');
        for (const e of allChanges) {
          dim(`    [${e.notice_id}] ${e.loan_id}.${e.field}: ${JSON.stringify(e.old_value)} → ${JSON.stringify(e.new_value)}  (effective ${e.effective_date ?? 'unspecified'})`);
        }
      }
    }
  }

  // ── STEP 3: COVERAGE TESTS ──────────────────────────────────────────────
  section('STEP 3 — Coverage Test Runner (deterministic)');

  const testResults = runCoverageTests(extracted, activeLoanTape, CAPITAL_STRUCTURE);
  for (const r of testResults) {
    const color = r.result === 'PASS' ? C.green : C.red;
    const cushionStr = r.cushion_pct >= 0
      ? `${C.green}+${r.cushion_pct}% cushion${C.reset}`
      : `${C.red}${r.cushion_pct}% breach${C.reset}`;
    console.log(`  ${color}${C.bold}${r.result}${C.reset}  ${r.test_id.padEnd(16)} ${r.calculated_pct}% vs ${r.threshold_pct}% threshold  (${cushionStr})`);
    if (r.result === 'FAIL') {
      dim(`        Action: ${r.failure_action}`);
    }
  }

  // ── STEP 4: CONCENTRATION TESTS ─────────────────────────────────────────
  section('STEP 4 — Concentration Limit Runner (deterministic)');

  const concentrationResults = runConcentrationTests(extracted, activeLoanTape, verbose);
  for (const r of concentrationResults) {
    const color = r.result === 'PASS' ? C.green : C.red;
    console.log(`  ${color}${C.bold}${r.result}${C.reset}  ${r.limit_id.padEnd(20)} max ${r.max_pct}%  (${r.breach_count} breach${r.breach_count !== 1 ? 'es' : ''})`);
    if (r.breaches.length > 0) {
      r.breaches.forEach(b => {
        dim(`        ${b.item}: $${b.par_value}M = ${b.pct}% of pool (limit: ${r.max_pct}%)`);
        if (b.loans) dim(`        Loans: ${b.loans.join(', ')}`);
      });
    }
  }

  // ── STEP 5: EXCEPTION NARRATIVE ─────────────────────────────────────────
  section('STEP 5 — Exception Narrative Generation (AI)');

  const allFailed = testResults.filter(t => t.result === 'FAIL').length +
                    concentrationResults.filter(t => t.result === 'FAIL').length;

  if (allFailed === 0) {
    pass('All tests passed — no exception narrative required');
  } else {
    info(`${allFailed} test failure(s) detected. Generating trustee report narrative...`);
    console.log();
    try {
      const narrative = await generateExceptionNarrative(testResults, concentrationResults, extracted);
      if (narrative) {
        console.log(`${C.grey}${'─'.repeat(60)}${C.reset}`);
        narrative.split('\n').forEach(line => console.log(`  ${line}`));
        console.log(`${C.grey}${'─'.repeat(60)}${C.reset}`);
      }
    } catch (e) {
      warn(`Narrative generation failed: ${e.message}`);
    }
  }

  // ── STEP 6: FULL WATERFALL ALLOCATION (Phase 4B) ────────────────────────
  let waterfallScenarioPassed = 0;
  let waterfallScenarioFailed = 0;
  let waterfall4BPassed       = 0;
  let waterfall4BFailed       = 0;
  let liveAllocationLedger    = null;

  if (runWaterfall) {
    section('STEP 6 — Full Waterfall Allocation Engine (Phase 4B)');

    if (mode === 'synthetic') {
      // Gate 4A: diversion engine scenarios
      info(`Running ${WATERFALL_SCENARIOS.length} diversion scenarios (SYN_4A_01–SYN_4A_05)...`);
      console.log();
      for (const scenario of WATERFALL_SCENARIOS) {
        const ledger = runWaterfallDiversion(scenario.input);
        const { passed, errors } = validateDiversionLedger(ledger, scenario.expected, scenario.id);
        if (passed) {
          pass(`${scenario.id}  ${C.grey}${scenario.description}${C.reset}`);
          waterfallScenarioPassed++;
        } else {
          fail(`${scenario.id}  ${scenario.description}`);
          errors.forEach(e => dim(`        ${e}`));
          waterfallScenarioFailed++;
        }
      }
      console.log();
      const total4A  = waterfallScenarioPassed + waterfallScenarioFailed;
      const color4A  = waterfallScenarioFailed === 0 ? C.green : C.red;
      info(`4A gate: ${color4A}${C.bold}${waterfallScenarioPassed}/${total4A} passed${C.reset}`);

      // Gate 4B: full allocation scenarios
      console.log();
      info(`Running ${WATERFALL_SCENARIOS_4B.length} full waterfall scenarios (SYN_4B_01–SYN_4B_03)...`);
      console.log();
      for (const scenario of WATERFALL_SCENARIOS_4B) {
        const ledger = runWaterfall4B(scenario.input);
        const { passed, errors } = validateAllocationLedger4B(ledger, scenario.expected);
        if (passed) {
          pass(`${scenario.id}  ${C.grey}${scenario.description}${C.reset}`);
          waterfall4BPassed++;
        } else {
          fail(`${scenario.id}  ${scenario.description}`);
          errors.forEach(e => dim(`        ${e}`));
          waterfall4BFailed++;
        }
      }
      console.log();
      const total4B = waterfall4BPassed + waterfall4BFailed;
      const color4B = waterfall4BFailed === 0 ? C.green : C.red;
      info(`4B gate: ${color4B}${C.bold}${waterfall4BPassed}/${total4B} passed${C.reset}`);

      if (waterfallScenarioFailed === 0 && waterfall4BFailed === 0) {
        console.log();
        console.log(`${C.green}${C.bold}  ✓  4A + 4B GATES PASSED — Full waterfall engine verified.${C.reset}`);
      } else {
        console.log();
        console.log(`${C.red}${C.bold}  ✗  GATE NOT MET: Fix failing scenarios before proceeding.${C.reset}`);
      }

    } else {
      // Real mode: run 4B full engine against extracted steps + coverage results
      if (extractedWaterfallSteps.length === 0) {
        warn('No waterfall_steps in extraction — cannot run waterfall engine. Check extraction output.');
      } else {
        const valErrors = validateWaterfallStepsExtraction(extractedWaterfallSteps);
        if (valErrors.length > 0) {
          warn(`Waterfall step validation: ${valErrors.length} error(s):`);
          valErrors.forEach(e => dim(`    ${e}`));
        }

        const totalInterestProceeds = r2(activeLoanTape
          .filter(l => l.status !== 'PIK')
          .reduce((s, l) => s + (l.accrued_interest || 0), 0));

        const collectionsForRun = {
          payment_date: new Date().toISOString().slice(0, 10),
          period_start: '', period_end: '',
          scheduled_interest: totalInterestProceeds, unscheduled_interest: 0, default_interest_recovered: 0,
          total_interest_proceeds: totalInterestProceeds,
          scheduled_principal: 0, unscheduled_principal: 0, default_principal_recovered: 0,
          total_principal_proceeds: 0,
          hedge_receipts: 0, reserve_account_balance: 0,
        };

        const noteBalancesForRun = noteBalancesFromCapital(WATERFALL_CAPITAL_STRUCTURE);

        info(`Interest proceeds (from tape):  ${C.bold}$${totalInterestProceeds.toFixed(2)}M${C.reset}`);
        info(`Principal proceeds:             ${C.grey}$0.00M (not in extraction scope)${C.reset}`);
        console.log();

        liveAllocationLedger = runWaterfall4B({
          waterfall_steps:       extractedWaterfallSteps,
          coverage_test_results: testResults,
          collections:           collectionsForRun,
          note_balances:         noteBalancesForRun,
        });

        printAllocationTable(liveAllocationLedger.entries);
        printAllocationSummary(liveAllocationLedger);
      }
    }
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  banner('BARLOW PIPELINE SUMMARY');

  const passCount = testResults.filter(t => t.result === 'PASS').length +
                    concentrationResults.filter(t => t.result === 'PASS').length;
  const failCount = testResults.filter(t => t.result === 'FAIL').length +
                    concentrationResults.filter(t => t.result === 'FAIL').length;
  const totalTests = passCount + failCount;

  info(`Extraction accuracy:  ${C.bold}${Math.round(extractionScore * 100)}%${C.reset}`);
  info(`Tests run:            ${C.bold}${totalTests}${C.reset}  (${passCount} pass / ${failCount} fail)`);
  if (runWaterfall && mode === 'synthetic') {
    const total4A = waterfallScenarioPassed + waterfallScenarioFailed;
    const total4B = waterfall4BPassed + waterfall4BFailed;
    const c4A = waterfallScenarioFailed === 0 ? C.green : C.red;
    const c4B = waterfall4BFailed       === 0 ? C.green : C.red;
    info(`4A scenarios:         ${c4A}${C.bold}${waterfallScenarioPassed}/${total4A} passed${C.reset}`);
    info(`4B scenarios:         ${c4B}${C.bold}${waterfall4BPassed}/${total4B} passed${C.reset}`);
  }
  if (runWaterfall && liveAllocationLedger) {
    const ndiv = liveAllocationLedger.diversions.length;
    const divAmt = liveAllocationLedger.diversions.reduce((s, d) => s + d.diversion_amount, 0);
    const dc = ndiv > 0 ? C.amber : C.green;
    info(`Total allocated:      ${C.bold}$${liveAllocationLedger.total_allocated.toFixed(2)}M${C.reset}`);
    info(`Diversions (cure):    ${dc}${C.bold}$${r2(divAmt).toFixed(2)}M${C.reset}  across ${ndiv} event(s)`);
    if (liveAllocationLedger.residual_principal > 0)
      info(`Reinvestment pool:    ${C.bold}$${liveAllocationLedger.residual_principal.toFixed(2)}M${C.reset}`);
  }
  info(`AI calls made:        ${C.bold}${failCount > 0 ? 2 : 1}${C.reset}  (1 extraction + ${failCount > 0 ? '1 narrative' : '0 narrative'})`);
  info(`Deterministic calc:   ${C.bold}100%${C.reset}  (no AI in waterfall/test runner path)`);

  console.log();
  if (extractionScore === 1 && totalTests > 0) {
    console.log(`${C.green}${C.bold}  ✓  HYPOTHESIS SUPPORTED: AI correctly extracted all rules and identified all breaches.${C.reset}`);
  } else if (extractionScore >= 0.75) {
    console.log(`${C.amber}${C.bold}  ⚠  PARTIAL: Extraction mostly correct but review flagged items before proceeding.${C.reset}`);
  } else {
    console.log(`${C.red}${C.bold}  ✗  EXTRACTION BELOW THRESHOLD: Manual review required before running tests.${C.reset}`);
  }
  console.log();

  // ── OUTPUT FILE ─────────────────────────────────────────────────────────
  const output = {
    run_timestamp: new Date().toISOString(),
    deal: extracted.deal_name,
    extraction: extracted,
    validation,
    coverage_test_results: testResults,
    concentration_test_results: concentrationResults,
    ...(liveAllocationLedger ? { waterfall_allocation_ledger: liveAllocationLedger } : {}),
    pipeline_summary: {
      extraction_accuracy_pct: Math.round(extractionScore * 100),
      tests_passed: passCount,
      tests_failed: failCount,
      ...(runWaterfall && mode === 'synthetic' ? {
        waterfall_4a_scenarios_passed: waterfallScenarioPassed,
        waterfall_4a_scenarios_failed: waterfallScenarioFailed,
      } : {}),
    }
  };

  const outPath = '/home/andycarthy/barlow/barlow_output.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  info(`Full output written to: ${C.cyan}${outPath}${C.reset}`);

  if (outputJson && liveAllocationLedger) {
    const ledgerPath = '/home/andycarthy/barlow/waterfall_allocation_ledger.json';
    fs.writeFileSync(ledgerPath, JSON.stringify(liveAllocationLedger, null, 2));
    info(`Allocation ledger written to: ${C.cyan}${ledgerPath}${C.reset}  (Phase 5 input)`);
  }
  console.log();
}

main().catch(e => {
  console.error(`\n${C.red}Fatal error: ${e.message}${C.reset}\n`);
  process.exit(1);
});
