import type { ExceptionEntry, CoverageTestEntry, ConcentrationLimitEntry } from '../types/report';
import type { DiversionEntry } from '../types/waterfall';

export interface NarrativeGenerationRequest {
  exception:              ExceptionEntry;
  indenture_section_text: string;
  test_detail:            CoverageTestEntry | ConcentrationLimitEntry;
  diversion_detail:       DiversionEntry | null;
}

export const EXCEPTION_NARRATIVE_SYSTEM_PROMPT = `\
You are a CLO trustee report writer producing official exception narratives for institutional noteholder disclosure.

HARD RULES — EVERY RULE IS MANDATORY:

1. LENGTH: 150 words maximum. Count carefully before responding.
2. SECTION CITATION: Cite the exact indenture section provided (e.g., "pursuant to Section 11.1(a)" or "as set forth in §12.2(c)"). The citation must appear in the narrative.
3. NO HALLUCINATION: Use ONLY the numbers listed under PERMITTED FIGURES. Do not calculate, estimate, infer, or round to any other value. Every percentage and dollar figure in your narrative must exactly match a permitted figure.
4. REGISTER: Formal, passive, institutional English. Third person throughout. No contractions. No opinion or commentary.
5. FORMAT: One plain prose paragraph. No headers. No bullet points. No markdown formatting.

Do not include a disclaimer line — it is appended automatically by the system.
Do not preface your response with any explanation. Begin the paragraph directly.`;

function isCoverageEntry(e: CoverageTestEntry | ConcentrationLimitEntry): e is CoverageTestEntry {
  return 'threshold' in e;
}

function pct(n: number): string { return `${n.toFixed(2)}%`; }
function usdM(n: number): string { return `$${n.toFixed(2)}M`; }

export function buildNarrativeUserMessage(req: NarrativeGenerationRequest): string {
  const { exception: exc, indenture_section_text, test_detail, diversion_detail } = req;

  let metricsLines: string[];
  let permittedFigures: string[];

  if (isCoverageEntry(test_detail)) {
    metricsLines = [
      `Test ID:           ${test_detail.test_id}`,
      `Test Type:         ${test_detail.test_type === 'OC' ? 'Overcollateralization' : 'Interest Coverage'}`,
      `Actual ratio:      ${pct(test_detail.actual)}`,
      `Required threshold:${pct(test_detail.threshold)}`,
      `Breach depth:      ${pct(exc.breach_depth)} below threshold`,
      `Result:            FAIL`,
    ];
    permittedFigures = [
      `${pct(test_detail.actual)} (actual ratio)`,
      `${pct(test_detail.threshold)} (required threshold)`,
      `${pct(exc.breach_depth)} (breach depth / shortfall below threshold)`,
    ];
  } else {
    metricsLines = [
      `Limit ID:          ${test_detail.limit_id}`,
      `Description:       ${test_detail.description}`,
      `Actual level:      ${pct(test_detail.actual_pct)}`,
      `Maximum permitted: ${pct(test_detail.max_pct)}`,
      `Excess:            ${pct(exc.breach_depth)} above limit`,
      `Result:            FAIL`,
    ];
    permittedFigures = [
      `${pct(test_detail.actual_pct)} (actual concentration)`,
      `${pct(test_detail.max_pct)} (maximum permitted)`,
      `${pct(exc.breach_depth)} (excess above limit)`,
    ];
  }

  let diversionBlock = '';
  if (diversion_detail) {
    diversionBlock = [
      '',
      'DIVERSION TRIGGERED:',
      `  Amount diverted:  ${usdM(diversion_detail.diversion_amount)}`,
      `  Cure mechanism:   ${diversion_detail.cure_mechanism}`,
      `  Target:           ${diversion_detail.diversion_target.description}`,
    ].join('\n');
    permittedFigures.push(`${usdM(diversion_detail.diversion_amount)} (amount diverted to cure mechanism)`);
  }

  const permittedList = permittedFigures.map((f, i) => `  ${i + 1}. ${f}`).join('\n');

  return [
    `EXCEPTION ID:      ${exc.exception_id}`,
    `TYPE:              ${exc.exception_type}`,
    `INDENTURE SECTION: ${exc.indenture_section}`,
    '',
    'INDENTURE TEXT:',
    indenture_section_text,
    '',
    'BREACH METRICS:',
    metricsLines.join('\n'),
    diversionBlock,
    '',
    'PERMITTED FIGURES (use ONLY these numbers in your narrative — no others are permitted):',
    permittedList,
    '',
    'Write the narrative paragraph for this exception now.',
  ].join('\n');
}
