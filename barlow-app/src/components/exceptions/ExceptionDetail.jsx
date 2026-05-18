import { useState } from 'react';
import { SeverityChip } from './ExceptionChip';
import StatusStepper from './StatusStepper';
import TransitionButton from './TransitionButton';

const BASE = 'http://localhost:3001';

export const FIXTURE_USERS = [
  { id: 'controller_a',    name: 'Controller A' },
  { id: 'controller_b',    name: 'Controller B' },
  { id: 'senior_reviewer', name: 'Senior Reviewer' },
];

function fmt(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(2)}%`;
}

function transitionButtons(status) {
  switch (status) {
    case 'OPEN':
      return [{ toStatus: 'UNDER_REVIEW', label: 'Start Review →', variant: 'primary' }];
    case 'UNDER_REVIEW':
      return [
        { toStatus: 'PENDING_APPROVAL', label: 'Submit for Approval →', variant: 'primary' },
        { toStatus: 'OPEN',             label: '↩ Re-Open',             variant: 'ghost'   },
      ];
    case 'PENDING_APPROVAL':
      return [
        { toStatus: 'OPEN', label: '↩ Re-Open', variant: 'ghost' },
      ];
    case 'RESOLVED':
    case 'WAIVED':
      return [
        { toStatus: 'OPEN', label: '↩ Re-Open', variant: 'ghost' },
      ];
    default:
      return [];
  }
}

export default function ExceptionDetail({
  exception: exc,
  dealId,
  dealName,
  activeUser,
  onUpdate,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}) {
  const [assignee, setAssignee] = useState(exc.assigned_to ?? '');
  const [dueDate,  setDueDate]  = useState(exc.due_date ?? '');
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState(null);

  async function patch(body) {
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch(`${BASE}/api/exceptions/${dealId}/${exc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, actor: activeUser }),
      });
      const data = await res.json();
      if (data.success) onUpdate(data.data);
      else setSaveErr(data.error);
    } catch (e) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const assigneeDirty = assignee !== (exc.assigned_to ?? '');
  const dueDirty      = dueDate  !== (exc.due_date ?? '');
  const buttons       = transitionButtons(exc.status);

  const metrics = [
    { label: 'Threshold', value: fmt(exc.threshold), color: null },
    { label: 'Actual',    value: fmt(exc.actual),    color: null },
    {
      label: 'Cushion',
      value: exc.cushion != null
        ? `${exc.cushion < 0 ? '▼ ' : '▲ '}${Math.abs(Number(exc.cushion)).toFixed(2)}%`
        : '—',
      color: exc.cushion != null
        ? (exc.cushion < 0 ? 'var(--cushion-negative)' : 'var(--cushion-positive)')
        : null,
    },
  ];

  return (
    <div style={s.panel}>
      {/* Navigation */}
      <div style={s.navBar}>
        <button style={s.navBtn} onClick={onPrev} disabled={!hasPrev}>← Prev</button>
        <button style={{ ...s.navBtn, color: '#5C6360' }} onClick={onClose}>↩ Register</button>
        <button style={s.navBtn} onClick={onNext} disabled={!hasNext}>Next →</button>
      </div>

      {/* Header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <SeverityChip severity={exc.severity} />
          <span style={s.testId}>{exc.test_id}</span>
        </div>
        <div style={s.dealName}>{dealName}</div>
        {exc.indenture_section && (
          <div style={s.section}>{exc.indenture_section}</div>
        )}
        <p style={s.description}>{exc.description}</p>
      </div>

      {/* Test result metrics */}
      <div style={s.metrics}>
        {metrics.map((m, i) => (
          <div
            key={m.label}
            style={{ ...s.metric, borderRight: i < metrics.length - 1 ? '1px solid #D8D6D0' : 'none' }}
          >
            <span style={s.metricLabel}>{m.label}</span>
            <span style={{ ...s.metricValue, ...(m.color ? { color: m.color } : {}) }}>
              {m.value}
            </span>
          </div>
        ))}
      </div>

      {/* Status stepper */}
      <StatusStepper status={exc.status} />

      <hr style={s.divider} />

      {/* Assignment */}
      <div style={s.field}>
        <label style={s.label}>Assigned to</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            style={s.select}
          >
            <option value="">Unassigned</option>
            {FIXTURE_USERS.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          {assigneeDirty && (
            <button style={s.saveBtn} onClick={() => patch({ assigned_to: assignee })} disabled={saving}>
              {saving ? '…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Due date */}
      <div style={s.field}>
        <label style={s.label}>Due date</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            style={s.select}
          />
          {dueDirty && (
            <button style={s.saveBtn} onClick={() => patch({ due_date: dueDate })} disabled={saving}>
              {saving ? '…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {saveErr && <div style={s.saveErr}>{saveErr}</div>}

      {buttons.length > 0 && (
        <>
          <hr style={s.divider} />
          <div style={s.actions}>
            {buttons.map(b => (
              <TransitionButton
                key={b.toStatus}
                dealId={dealId}
                exception={exc}
                toStatus={b.toStatus}
                label={b.label}
                actor={activeUser}
                onSuccess={onUpdate}
                variant={b.variant}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const s = {
  panel: {
    width: 380,
    flexShrink: 0,
    borderRight: '1px solid #D8D6D0',
    padding: '20px 24px',
    overflowY: 'auto',
    background: '#FAFAF8',
  },
  navBar: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navBtn: {
    fontSize: 11,
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid #D8D6D0',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--brand-primary)',
  },
  header: {
    marginBottom: 14,
  },
  testId: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    fontWeight: 600,
    color: '#1A1D1B',
  },
  dealName: {
    fontSize: 12,
    color: '#5C6360',
    marginTop: 2,
  },
  section: {
    fontSize: 11,
    color: '#8E9590',
    fontFamily: 'var(--font-mono)',
    marginTop: 2,
  },
  description: {
    fontSize: 13,
    color: '#1A1D1B',
    lineHeight: 1.5,
    margin: '8px 0 0',
  },
  metrics: {
    display: 'flex',
    border: '1px solid #D8D6D0',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 4,
  },
  metric: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '10px 6px',
    background: '#fff',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#5C6360',
    marginBottom: 4,
  },
  metricValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 16,
    fontWeight: 500,
    color: '#1A1D1B',
  },
  divider: {
    border: 'none',
    borderTop: '1px solid #D8D6D0',
    margin: '14px 0',
  },
  field: {
    marginBottom: 12,
  },
  label: {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#5C6360',
    marginBottom: 4,
  },
  select: {
    fontSize: 12,
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid #D8D6D0',
    background: '#fff',
    color: '#1A1D1B',
    outline: 'none',
    cursor: 'pointer',
  },
  saveBtn: {
    fontSize: 11,
    padding: '5px 12px',
    borderRadius: 4,
    border: 'none',
    background: 'var(--brand-primary)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
  },
  saveErr: {
    color: 'var(--status-breach)',
    fontSize: 12,
    marginTop: 4,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
};
