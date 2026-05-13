import { readFileSync } from 'fs';
import {
  LoanPosition, LoanType,
  LOAN_TYPES, REFERENCE_RATES, PAYMENT_FREQUENCIES, RATING_SOURCES, DATA_SOURCES,
} from '../types/loan';
import { validateLoanTape, ValidationResult } from '../validators/loan_tape_validator';
import rawDefaultMapping from '../config/lms_mappings.json';

// ── Public types ──────────────────────────────────────────────────────────────

type ColumnMapping = Record<string, string[]>;
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export interface LogEntry { level: LogLevel; message: string; }

export interface ParseLMSResult {
  loans:      LoanPosition[];
  logs:       LogEntry[];
  validation: ValidationResult;
}

// ── Loan type inference ───────────────────────────────────────────────────────
// These column names signal asset class but don't map to a canonical field.
// They are silently consumed for inference and NOT reported as unmapped.

const INFERENCE_SOURCE_NAMES = new Set([
  'lien position', 'security type', 'asset type', 'collateral type',
  'instrument type', 'loan classification', 'asset class',
]);

// Order matters: more-specific patterns must come before broader ones
// (FIRST_LIEN_LAST_OUT before SENIOR_SECURED, etc.)
const LOAN_TYPE_PATTERNS: Array<{ pattern: RegExp; type: LoanType }> = [
  { pattern: /first\s*lien\s*last\s*out|fllo|1st\s*lien\s*last\s*out/i, type: 'FIRST_LIEN_LAST_OUT' },
  { pattern: /1st\s*lien|first\s*lien|senior\s*secured|tl\s*[ab]|term\s*loan\s*[ab]/i, type: 'SENIOR_SECURED' },
  { pattern: /2nd\s*lien|second\s*lien/i, type: 'SECOND_LIEN' },
  { pattern: /bond|senior\s*note|high\s*yield|pds|permitted\s*debt\s*security/i, type: 'PERMITTED_DEBT_SECURITY' },
  { pattern: /unsecured/i, type: 'UNSECURED' },
];

// ── Field classification ──────────────────────────────────────────────────────

const NUMERIC_FIELDS = new Set<string>([
  'principal_balance', 'purchase_price', 'market_value', 'spread',
  'coupon', 'unfunded_commitment', 'accrued_interest',
]);

const BOOLEAN_FIELDS = new Set<string>([
  'is_dip', 'is_current_pay', 'is_deferrable', 'is_partial_deferring', 'participation_interest',
]);

const REQUIRED_FIELDS: (keyof LoanPosition)[] = [
  'loan_id', 'obligor_name', 'obligor_id', 'loan_type',
  'principal_balance', 'purchase_price', 'market_value',
  'spread', 'reference_rate', 'payment_frequency', 'maturity_date',
];

// ── CSV/TSV parsing ───────────────────────────────────────────────────────────

function detectDelimiter(firstLine: string): string {
  const tabs   = (firstLine.match(/\t/g)  || []).length;
  const commas = (firstLine.match(/,/g)   || []).length;
  return tabs > commas ? '\t' : ',';
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuote = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')                    { inQuote = true; }
      else if (ch === delimiter)              { row.push(field.trim()); field = ''; }
      else if (ch === '\r' && next === '\n')  { row.push(field.trim()); rows.push(row); row = []; field = ''; i++; }
      else if (ch === '\n')                   { row.push(field.trim()); rows.push(row); row = []; field = ''; }
      else                                    { field += ch; }
    }
  }

  // Flush last field/row (file without trailing newline)
  if (field !== '' || row.length > 0) { row.push(field.trim()); rows.push(row); }

  // Drop empty trailing rows
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();

  return rows;
}

// ── Column index builder ──────────────────────────────────────────────────────

function buildReverseMap(mapping: ColumnMapping): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, variants] of Object.entries(mapping)) {
    if (canonical.startsWith('_')) continue; // skip comment keys
    map.set(canonical.toLowerCase(), canonical);
    for (const v of variants) map.set(v.toLowerCase(), canonical);
  }
  return map;
}

// ── Value coercion ────────────────────────────────────────────────────────────

function normalizeReferenceRate(v: string): string | null {
  const u = v.toUpperCase();
  if (/SOFR/.test(u))           return 'SOFR';
  if (/LIBOR/.test(u))          return 'LIBOR';
  if (/FIXED|FLAT/.test(u))     return 'FIXED';
  if (REFERENCE_RATES.includes(u as any)) return u;
  return null;
}

function normalizePaymentFrequency(v: string): string | null {
  const u = v.toUpperCase().replace(/[-_\s]/g, '');
  if (u === 'M'   || u === 'MONTHLY')                      return 'MONTHLY';
  if (u === 'Q'   || u === 'QUARTERLY')                    return 'QUARTERLY';
  if (u === 'SA'  || u === 'SEMIANNUAL' || u === 'SEMI')   return 'SEMI_ANNUAL';
  if (u === 'A'   || u === 'ANNUAL' || u === 'ANNUALLY')   return 'ANNUAL';
  if (PAYMENT_FREQUENCIES.includes(u as any))              return u;
  return null;
}

function coerceField(canonical: string, rawValue: string): unknown {
  const v = rawValue.trim();
  if (v === '') return undefined;

  if (NUMERIC_FIELDS.has(canonical)) {
    const n = parseFloat(v.replace(/[,$%]/g, ''));
    return isNaN(n) ? undefined : n;
  }

  if (BOOLEAN_FIELDS.has(canonical)) {
    return /^(true|yes|y|1)$/i.test(v);
  }

  if (canonical === 'reference_rate') {
    return normalizeReferenceRate(v) ?? v.toUpperCase();
  }

  if (canonical === 'payment_frequency') {
    return normalizePaymentFrequency(v) ?? v.toUpperCase().replace(/\s+/g, '_');
  }

  if (canonical === 'loan_type') {
    const u = v.toUpperCase().replace(/\s+/g, '_');
    return LOAN_TYPES.includes(u as any) ? u : v;
  }

  if (canonical === 'rating_source') {
    const u = v.toUpperCase().replace(/\s+/g, '_');
    return RATING_SOURCES.includes(u as any) ? u : v;
  }

  if (canonical === 'source') {
    const u = v.toUpperCase().replace(/\s+/g, '_');
    return DATA_SOURCES.includes(u as any) ? u : v;
  }

  return v;
}

// ── Loan type inference ───────────────────────────────────────────────────────

function inferLoanType(
  candidates: Array<{ column: string; value: string }>,
): { type: LoanType; sourceColumn: string } | null {
  for (const { column, value } of candidates) {
    for (const { pattern, type } of LOAN_TYPE_PATTERNS) {
      if (pattern.test(value.trim())) return { type, sourceColumn: column };
    }
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseLMSTape(
  filePath: string,
  mappingConfig?: ColumnMapping,
): Promise<ParseLMSResult> {
  const logs: LogEntry[] = [];
  const log = (level: LogLevel, message: string) => logs.push({ level, message });

  const mapping     = (mappingConfig ?? rawDefaultMapping) as ColumnMapping;
  const reverseMap  = buildReverseMap(mapping);

  // Read and split
  const text      = readFileSync(filePath, 'utf8');
  const firstLine = text.split(/\r?\n/)[0];
  const delimiter = detectDelimiter(firstLine);
  const rows      = parseDelimited(text, delimiter);

  if (rows.length < 2) {
    log('ERROR', 'Tape is empty or contains only a header row');
    return { loans: [], logs, validation: { valid: false, errors: [] } };
  }

  const headers  = rows[0];
  const dataRows = rows.slice(1);

  // Classify each column header
  const columnCanonical: Array<string | null> = [];
  const inferenceColumns: Array<{ index: number; name: string }> = [];
  const unmapped: string[] = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const canonical = reverseMap.get(h.toLowerCase()) ?? null;
    columnCanonical.push(canonical);

    if (!canonical) {
      if (INFERENCE_SOURCE_NAMES.has(h.toLowerCase())) {
        inferenceColumns.push({ index: i, name: h });
      } else {
        unmapped.push(h);
      }
    }
  }

  // Warn on unmapped columns
  for (const col of unmapped) {
    log('WARN', `Unmapped column: "${col}" — skipped`);
  }

  // Check required field coverage (before parsing rows)
  const coveredFields  = new Set(columnCanonical.filter(Boolean));
  const hasInference   = inferenceColumns.length > 0;
  const n              = dataRows.length;

  for (const field of REQUIRED_FIELDS) {
    if (!coveredFields.has(field)) {
      if (field === 'loan_type'   && hasInference) continue; // handled by inference
      if (field === 'obligor_id')                  continue; // derived from obligor_name
      log('ERROR', `Required field "${field}" not found in tape — ${n} record${n !== 1 ? 's' : ''} affected`);
    }
  }

  // Parse rows
  const loans: LoanPosition[] = [];
  const inferenceByColumn = new Map<string, number>();
  let defaultedCount     = 0;
  let obligorIdDerived   = 0;

  for (const rawRow of dataRows) {
    const rec: Record<string, unknown> = {};

    // Collect inference candidates for this row
    const inferCandidates: Array<{ column: string; value: string }> = [];

    for (let i = 0; i < headers.length; i++) {
      const canonical = columnCanonical[i];
      const raw       = rawRow[i] ?? '';

      if (canonical) {
        const coerced = coerceField(canonical, raw);
        if (coerced !== undefined) rec[canonical] = coerced;
      }

      const infCol = inferenceColumns.find(c => c.index === i);
      if (infCol && raw.trim()) {
        inferCandidates.push({ column: infCol.name, value: raw });
      }
    }

    // Infer loan_type if not already mapped
    if (!rec['loan_type']) {
      const inferred = inferLoanType(inferCandidates);
      if (inferred) {
        rec['loan_type'] = inferred.type;
        inferenceByColumn.set(
          inferred.sourceColumn,
          (inferenceByColumn.get(inferred.sourceColumn) ?? 0) + 1,
        );
      } else {
        rec['loan_type'] = 'SENIOR_SECURED';
        defaultedCount++;
      }
    }

    // Derive obligor_id from obligor_name if absent
    if (!rec['obligor_id'] && rec['obligor_name']) {
      rec['obligor_id'] = String(rec['obligor_name'])
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);
      obligorIdDerived++;
    }

    // Default source to LMS_TAPE
    if (!rec['source']) rec['source'] = 'LMS_TAPE';

    loans.push(rec as unknown as LoanPosition);
  }

  // Emit inference summary logs
  for (const [col, count] of inferenceByColumn.entries()) {
    log('INFO', `loan_type inferred from "${col}" for ${count} record${count !== 1 ? 's' : ''}`);
  }
  if (defaultedCount > 0) {
    log('WARN', `loan_type could not be inferred — defaulting to SENIOR_SECURED for ${defaultedCount} record${defaultedCount !== 1 ? 's' : ''}`);
  }
  if (obligorIdDerived > 0) {
    log('INFO', `obligor_id not found in tape — derived from obligor_name for ${obligorIdDerived} record${obligorIdDerived !== 1 ? 's' : ''}`);
  }

  const validation = validateLoanTape(loans);
  return { loans, logs, validation };
}
