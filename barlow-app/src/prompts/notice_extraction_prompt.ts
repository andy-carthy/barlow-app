export const NOTICE_EXTRACTION_SYSTEM_PROMPT = `You are a CLO agent bank notice parser. Your job is to read LSTA-format agent bank notices and extract structured update data.

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
  "updates":               { /* Partial<LoanPosition> — only fields being changed */ },
  "raw_text":              "full notice text verbatim",
  "extraction_confidence": "HIGH | MEDIUM | LOW",
  "flags":                 ["..."]
}`;

export function buildNoticeUserMessage(
  noticeText:  string,
  tapeContext: Array<{ loan_id: string; obligor_name: string }>,
): string {
  const tapeLines = tapeContext
    .map(l => `  ${l.loan_id}: ${l.obligor_name}`)
    .join('\n');

  return `Existing loan tape (use for obligor/facility matching only — do not extract data from this):
${tapeLines}

Agent bank notice to parse:
${'─'.repeat(60)}
${noticeText}
${'─'.repeat(60)}`;
}
