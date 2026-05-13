import { LoanPosition } from './loan';

export type NoticeType =
  | 'RATE_RESET'
  | 'PAYDOWN'
  | 'PIK_ELECTION'
  | 'AMENDMENT'
  | 'DEFAULT_NOTICE'
  | 'RATING_CHANGE'
  | 'COMMITMENT_CHANGE'
  | 'MATURITY_EXTENSION'
  | 'UNKNOWN';

export const NOTICE_TYPES: NoticeType[] = [
  'RATE_RESET',
  'PAYDOWN',
  'PIK_ELECTION',
  'AMENDMENT',
  'DEFAULT_NOTICE',
  'RATING_CHANGE',
  'COMMITMENT_CHANGE',
  'MATURITY_EXTENSION',
  'UNKNOWN',
];

export interface NoticeUpdate {
  notice_id:             string;
  notice_type:           NoticeType;
  effective_date:        string;
  loan_ids:              string[];
  obligor_name:          string;
  updates:               Partial<LoanPosition>;
  raw_text:              string;
  extraction_confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  flags:                 string[];
}
