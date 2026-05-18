const STEPS = [
  { key: 'OPEN',             label: 'Open' },
  { key: 'UNDER_REVIEW',     label: 'Under Review' },
  { key: 'PENDING_APPROVAL', label: 'Pending' },
  { key: 'RESOLVED',         label: 'Resolved' },
  { key: 'CLEARED',          label: 'Cleared' },
];

function stepIndex(status) {
  if (status === 'WAIVED') return 3;
  const idx = STEPS.findIndex(s => s.key === status);
  return idx >= 0 ? idx : 0;
}

export default function StatusStepper({ status }) {
  const current = stepIndex(status);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 12, marginBottom: 4 }}>
      {STEPS.map((step, i) => {
        const done   = i < current;
        const active = i === current;
        const isLast = i === STEPS.length - 1;

        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'flex-start', flex: isLast ? '0 0 auto' : 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
                background: done   ? 'var(--brand-primary)' :
                            active ? 'var(--brand-light)'   : '#D8D6D0',
                color: done || active ? '#fff' : '#8E9590',
                outline: active ? '2px solid var(--brand-primary)' : 'none',
                outlineOffset: 1,
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 9, fontWeight: active ? 700 : 400,
                color: active ? 'var(--brand-primary)' : done ? '#5C6360' : '#8E9590',
                marginTop: 4, textAlign: 'center',
                letterSpacing: '0.03em', textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div style={{
                flex: 1, height: 2, marginTop: 10,
                background: done ? 'var(--brand-primary)' : '#D8D6D0',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
