function StatCard({ label, value, accent }) {
  return (
    <div style={{ ...s.card, borderTop: `3px solid ${accent}` }}>
      <div style={{ ...s.value, color: accent }}>{value}</div>
      <div style={s.label}>{label}</div>
    </div>
  );
}

export default function SummaryCards({ register }) {
  const exceptions = register?.exceptions ?? [];
  const total = exceptions.length;
  const open = register?.open_count ?? 0;
  const pendingApproval = exceptions.filter(e => e.status === 'PENDING_APPROVAL' && !e.cleared).length;
  const cleared = exceptions.filter(e => e.cleared).length;

  return (
    <div style={s.row}>
      <StatCard label="Total Exceptions" value={total}         accent="var(--brand-primary)" />
      <StatCard label="Open"             value={open}          accent="var(--status-open)" />
      <StatCard label="Pending Approval" value={pendingApproval} accent="var(--status-waived)" />
      <StatCard label="Cleared This Run" value={cleared}       accent="var(--status-resolved)" />
    </div>
  );
}

const s = {
  row: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
    marginBottom: 24,
  },
  card: {
    background: '#FAFAF8',
    border: '1px solid #D8D6D0',
    borderRadius: 8,
    padding: '20px 24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  value: {
    fontSize: 32,
    fontWeight: 600,
    lineHeight: 1,
    marginBottom: 6,
    fontFamily: 'var(--font-mono)',
  },
  label: {
    fontSize: 11,
    color: '#5C6360',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontWeight: 600,
  },
};
