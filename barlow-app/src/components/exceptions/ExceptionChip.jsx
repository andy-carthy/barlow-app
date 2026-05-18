const CHIP = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  padding: '3px 8px',
  borderRadius: 4,
  display: 'inline-block',
  whiteSpace: 'nowrap',
};

const SEV = {
  BREACH:  { bg: 'var(--status-breach-bg)',   color: 'var(--status-breach)' },
  WARNING: { bg: 'var(--status-warning-bg)',  color: 'var(--status-warning)' },
  WATCH:   { bg: 'var(--status-watch-bg)',    color: 'var(--status-watch)' },
};

const STA = {
  OPEN:             { bg: 'var(--status-open-bg)',      color: 'var(--status-open)',     label: 'Open' },
  UNDER_REVIEW:     { bg: 'var(--status-review-bg)',    color: 'var(--status-review)',   label: 'Under Review' },
  PENDING_APPROVAL: { bg: 'var(--status-waived-bg)',    color: 'var(--status-waived)',   label: 'Pending Approval' },
  RESOLVED:         { bg: 'var(--status-resolved-bg)',  color: 'var(--status-resolved)', label: 'Resolved' },
  WAIVED:           { bg: 'var(--status-waived-bg)',    color: 'var(--status-waived)',   label: 'Waived' },
  ESCALATED:        { bg: 'var(--status-breach-bg)',    color: 'var(--status-breach)',   label: 'Escalated' },
};

export function SeverityChip({ severity }) {
  const t = SEV[severity];
  if (!t) return null;
  return <span style={{ ...CHIP, background: t.bg, color: t.color }}>{severity}</span>;
}

export function StatusChip({ status }) {
  const t = STA[status];
  if (!t) return <span style={{ ...CHIP, background: '#eee', color: '#555' }}>{status}</span>;
  return <span style={{ ...CHIP, background: t.bg, color: t.color }}>{t.label}</span>;
}
