export interface ChangeLogEntry {
  loan_id:        string;
  field:          string;
  old_value:      unknown;
  new_value:      unknown;
  notice_id:      string;
  effective_date: string | null;
}
