import { useState } from 'react';

const SYNTHETIC_INDENTURE = `BARLOW CLO I, LTD.
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

(a) Single Obligor Limit. The aggregate Principal Balance of Collateral
Obligations issued by any single Obligor shall not exceed 3.00% of the Adjusted
Collateral Principal Amount.

(b) Single Industry Limit. The aggregate Principal Balance of Collateral
Obligations in any single Moody's Industry Classification Group shall not exceed
15.00% of the Adjusted Collateral Principal Amount.

(c) CCC/Caa Bucket. The aggregate Principal Balance of Collateral Obligations
rated CCC+/Caa1 or below shall not exceed 7.50% of the Adjusted Collateral
Principal Amount. Defaulted Obligations shall be treated as CCC/Caa-rated.

(d) DIP Loan Limit. The aggregate Principal Balance of Debtor-in-Possession
Loans shall not exceed 5.00% of the Adjusted Collateral Principal Amount.

SECTION 13.1 — PRIORITY OF PAYMENTS

Step 1: Trustee fees and expenses (Senior Expenses), not to exceed $250,000 per annum.
Step 2: Senior Management Fee payable to the Collateral Manager.
Step 3: Hedge payments due to Hedge Counterparties (excluding termination payments).
Step 4: Accrued and unpaid interest on the Class A Notes.
Step 5: Accrued and unpaid interest on the Class B Notes — provided Class A/B OC Test is satisfied; otherwise redirect to Step 8.
Step 6: Accrued and unpaid interest on the Class C Notes — provided Class C OC Test is satisfied; otherwise redirect to Step 8.
Step 7: Subordinate Management Fee payable to the Collateral Manager.
Step 8: Reinvestment/cure — principal reinvestment account or pro rata paydown of Notes in reverse order of seniority until OC tests are cured.`;

export default function IndentureUpload({ onExtract, loading }) {
  const [text, setText] = useState('');

  function loadSynthetic() {
    setText(SYNTHETIC_INDENTURE);
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setText(ev.target.result);
    reader.readAsText(file);
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Indenture Upload</h2>
        <div style={styles.actions}>
          <button style={styles.btnSecondary} onClick={loadSynthetic}>
            Load Synthetic (Barlow CLO I)
          </button>
          <label style={styles.btnSecondary}>
            Upload .txt
            <input type="file" accept=".txt,.pdf" onChange={handleFile} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      <textarea
        style={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste indenture text here, or use the buttons above..."
        spellCheck={false}
      />

      <div style={styles.footer}>
        <span style={styles.charCount}>{text.length.toLocaleString()} chars</span>
        <button
          style={text.trim() && !loading ? styles.btnPrimary : styles.btnDisabled}
          onClick={() => onExtract(text)}
          disabled={!text.trim() || loading}
        >
          {loading ? 'Extracting...' : 'Extract Rules →'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#1a1a2e',
  },
  actions: {
    display: 'flex',
    gap: 8,
  },
  textarea: {
    width: '100%',
    height: 320,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 1.5,
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    resize: 'vertical',
    boxSizing: 'border-box',
    background: '#fafafa',
    color: '#1a1a2e',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCount: {
    fontSize: 12,
    color: '#6b7280',
  },
  btnPrimary: {
    padding: '8px 20px',
    background: '#1a1a2e',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
  },
  btnDisabled: {
    padding: '8px 20px',
    background: '#d1d5db',
    color: '#9ca3af',
    border: 'none',
    borderRadius: 6,
    cursor: 'not-allowed',
    fontWeight: 600,
    fontSize: 14,
  },
  btnSecondary: {
    padding: '6px 14px',
    background: '#fff',
    color: '#1a1a2e',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  },
};
