import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseLMSTape } from './lms_tape_parser';

// ── Dirty CSV fixture ─────────────────────────────────────────────────────────
//
// Deliberately non-canonical:
//   • "Borrower"       instead of obligor_name
//   • "Par Amount"     instead of principal_balance
//   • "Spread (bps)"   instead of spread
//   • "Pay Freq"       instead of payment_frequency
//   • "S&P Rating"     instead of sp_rating
//   • "Moody's Rating" instead of moodys_rating
//   • "Accrued Int"    instead of accrued_interest
//   • "Lien Position"  — inference source, not a canonical field
//   • "Bloomberg_ID"   — unmapped column (should trigger WARN)
//   • No obligor_id column — must be derived from Borrower
//   • No loan_type column — must be inferred from Lien Position
//   • country missing for rows 5–10 (optional field, should still pass validation)

const DIRTY_CSV = `Loan ID,Borrower,Par Amount,Purchase Price,Market Value,Spread (bps),Reference Rate,Pay Freq,Maturity Date,S&P Rating,Moody's Rating,Country,Lien Position,Accrued Int,Bloomberg_ID
L001,Apex Logistics,8.0,98.25,7.86,425,SOFR,QUARTERLY,2029-04-15,B,B2,US,1st Lien,0.61,BBG001
L002,Apex Logistics,6.5,98.25,6.39,425,SOFR,QUARTERLY,2030-10-15,B,B2,US,First Lien,0.57,BBG002
L003,Bravo Media,10.0,97.75,9.78,375,SOFR,QUARTERLY,2028-07-30,B,B2,US,Senior Secured,0.41,BBG003
L004,Castle Health,10.0,99.25,9.93,450,SOFR,QUARTERLY,2029-01-31,BB,Ba2,US,1st Lien,0.42,BBG004
L005,Delta Energy,10.0,89.50,8.95,500,SOFR,QUARTERLY,2027-09-30,CCC,Caa2,,1st Lien,0.38,BBG005
L006,Echo Software,10.0,98.50,9.85,350,SOFR,QUARTERLY,2030-03-31,B,B2,,1st Lien,0.54,BBG006
L007,Foxtrot Retail,9.5,87.00,8.27,550,SOFR,QUARTERLY,2027-06-30,CCC,Caa2,,1st Lien,0.34,BBG007
L008,Golf Pharma,10.0,99.00,9.90,400,SOFR,QUARTERLY,2029-11-30,BB,Ba2,,1st Lien,0.48,BBG008
L009,Hotel Group,10.0,98.00,9.80,475,SOFR,QUARTERLY,2028-05-31,B,B2,,1st Lien,0.45,BBG009
L010,India Steel,10.0,99.50,9.95,525,SOFR,QUARTERLY,2030-08-31,BB,Ba2,,1st Lien,0.43,BBG010`;

const DIRTY_TSV = DIRTY_CSV.replace(/,/g, '\t');

let csvPath: string;
let tsvPath: string;

beforeAll(() => {
  csvPath = join(tmpdir(), `barlow_dirty_tape_${Date.now()}.csv`);
  tsvPath = join(tmpdir(), `barlow_dirty_tape_${Date.now()}.tsv`);
  writeFileSync(csvPath, DIRTY_CSV, 'utf8');
  writeFileSync(tsvPath, DIRTY_TSV, 'utf8');
});

afterAll(() => {
  try { unlinkSync(csvPath); } catch {}
  try { unlinkSync(tsvPath); } catch {}
});

// ── Core parsing ──────────────────────────────────────────────────────────────

test('parses all 10 rows from dirty CSV', async () => {
  const { loans } = await parseLMSTape(csvPath);
  expect(loans).toHaveLength(10);
});

test('parses TSV input identically to CSV', async () => {
  const { loans } = await parseLMSTape(tsvPath);
  expect(loans).toHaveLength(10);
  expect(loans[0].loan_id).toBe('L001');
});

// ── Column mapping ────────────────────────────────────────────────────────────

test('maps non-canonical column names to canonical fields', async () => {
  const { loans } = await parseLMSTape(csvPath);
  const l = loans[0];

  expect(l.loan_id).toBe('L001');
  expect(l.obligor_name).toBe('Apex Logistics');
  expect(l.principal_balance).toBe(8.0);
  expect(l.spread).toBe(425);
  expect(l.payment_frequency).toBe('QUARTERLY');
  expect(l.sp_rating).toBe('B');
  expect(l.moodys_rating).toBe('B2');
  expect(l.accrued_interest).toBe(0.61);
  expect(l.reference_rate).toBe('SOFR');
  expect(l.maturity_date).toBe('2029-04-15');
});

// ── Unmapped column warning ───────────────────────────────────────────────────

test('logs WARN for Bloomberg_ID (unmapped column)', async () => {
  const { logs } = await parseLMSTape(csvPath);
  const warn = logs.find(e => e.level === 'WARN' && e.message.includes('Bloomberg_ID'));
  expect(warn).toBeDefined();
  expect(warn!.message).toMatch(/Unmapped column.*Bloomberg_ID.*skipped/);
});

test('does not log WARN for Lien Position (inference source)', async () => {
  const { logs } = await parseLMSTape(csvPath);
  const spurious = logs.find(
    e => e.level === 'WARN' && e.message.includes('Lien Position'),
  );
  expect(spurious).toBeUndefined();
});

// ── Loan type inference ───────────────────────────────────────────────────────

test('infers loan_type SENIOR_SECURED from Lien Position column', async () => {
  const { loans } = await parseLMSTape(csvPath);
  expect(loans.every(l => l.loan_type === 'SENIOR_SECURED')).toBe(true);
});

test('logs INFO for loan_type inference with source column name', async () => {
  const { logs } = await parseLMSTape(csvPath);
  const info = logs.find(
    e => e.level === 'INFO' && e.message.includes('loan_type inferred') && e.message.includes('Lien Position'),
  );
  expect(info).toBeDefined();
  expect(info!.message).toMatch(/10 records/);
});

// ── obligor_id derivation ─────────────────────────────────────────────────────

test('derives obligor_id from obligor_name when column absent', async () => {
  const { loans } = await parseLMSTape(csvPath);
  expect(loans.every(l => typeof l.obligor_id === 'string' && l.obligor_id.length > 0)).toBe(true);
});

test('logs INFO for obligor_id derivation', async () => {
  const { logs } = await parseLMSTape(csvPath);
  const info = logs.find(
    e => e.level === 'INFO' && e.message.includes('obligor_id') && e.message.includes('derived'),
  );
  expect(info).toBeDefined();
});

// ── Optional field: missing country ──────────────────────────────────────────

test('country is populated for rows 1-4 and absent for rows 5-10', async () => {
  const { loans } = await parseLMSTape(csvPath);
  expect(loans[0].country).toBe('US');
  expect(loans[3].country).toBe('US');
  expect(loans[4].country).toBeUndefined();
  expect(loans[9].country).toBeUndefined();
});

// ── Source default ────────────────────────────────────────────────────────────

test('defaults source to LMS_TAPE when column absent', async () => {
  const { loans } = await parseLMSTape(csvPath);
  expect(loans.every(l => l.source === 'LMS_TAPE')).toBe(true);
});

// ── Validation ────────────────────────────────────────────────────────────────

test('full parse result passes validateLoanTape with zero errors', async () => {
  const { validation } = await parseLMSTape(csvPath);
  if (!validation.valid) {
    console.error('Unexpected validation errors:', JSON.stringify(validation.errors, null, 2));
  }
  expect(validation.valid).toBe(true);
  expect(validation.errors).toHaveLength(0);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('empty file returns zero loans and an ERROR log', async () => {
  const emptyPath = join(tmpdir(), `barlow_empty_${Date.now()}.csv`);
  writeFileSync(emptyPath, '', 'utf8');
  try {
    const { loans, logs } = await parseLMSTape(emptyPath);
    expect(loans).toHaveLength(0);
    expect(logs.some(e => e.level === 'ERROR')).toBe(true);
  } finally {
    try { unlinkSync(emptyPath); } catch {}
  }
});

test('custom mappingConfig overrides default mappings', async () => {
  const customMapping: Record<string, string[]> = {
    loan_id:           ['Loan ID'],
    obligor_name:      ['Borrower'],
    // obligor_id intentionally absent — derivation should still populate it
    loan_type:         [],
    principal_balance: ['Par Amount'],
    purchase_price:    ['Purchase Price'],
    market_value:      ['Market Value'],
    spread:            ['Spread (bps)'],
    reference_rate:    ['Reference Rate'],
    payment_frequency: ['Pay Freq'],
    maturity_date:     ['Maturity Date'],
    sp_rating:         ['S&P Rating'],
    moodys_rating:     ["Moody's Rating"],
    accrued_interest:  ['Accrued Int'],
    country:           ['Country'],
  };
  const { loans } = await parseLMSTape(csvPath, customMapping);
  expect(loans).toHaveLength(10);
  expect(loans[0].obligor_name).toBe('Apex Logistics');
});
