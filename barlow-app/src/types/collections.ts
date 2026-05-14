export interface PeriodCollections {
  payment_date:   string;
  period_start:   string;
  period_end:     string;

  // Interest proceeds
  scheduled_interest:           number;
  unscheduled_interest:         number;
  default_interest_recovered:   number;
  total_interest_proceeds:      number;  // must equal sum of above three

  // Principal proceeds
  scheduled_principal:          number;
  unscheduled_principal:        number;  // prepayments, sales
  default_principal_recovered:  number;
  total_principal_proceeds:     number;  // must equal sum of above three

  // Other
  hedge_receipts:               number;
  reserve_account_balance:      number;
}
