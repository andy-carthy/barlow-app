import { useState, useEffect } from 'react';
import { useBarlowDemo } from '../../context/BarlowDemoContext';
import { SeverityChip, StatusChip } from './ExceptionChip';
import ExceptionDetail, { FIXTURE_USERS } from './ExceptionDetail';
import ResolutionPanel from './ResolutionPanel';

const BASE = 'http://localhost:3001';

export default function ReviewQueueTab() {
  const { activeDeal } = useBarlowDemo();
  const dealId   = activeDeal?.id   ?? 'carlyle-2024-1';
  const dealName = activeDeal?.name ?? 'Unknown Deal';

  const [exceptions,  setExceptions]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [loadErr,     setLoadErr]     = useState(null);
  const [selectedId,  setSelectedId]  = useState(null);
  const [activeUser,  setActiveUser]  = useState('controller_a');

  useEffect(() => {
    loadExceptions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function loadExceptions() {
    setLoading(true);
    setLoadErr(null);
    try {
      const res  = await fetch(`${BASE}/api/exceptions/${dealId}`);
      const data = await res.json();
      if (data.success) {
        setExceptions(data.data.exceptions ?? []);
      } else {
        setLoadErr(data.error ?? 'Failed to load exceptions');
      }
    } catch (e) {
      setLoadErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleUpdate(updated) {
    setExceptions(prev => prev.map(e => e.id === updated.id ? updated : e));
  }

  // Non-cleared exceptions, sorted: OPEN first, then UNDER_REVIEW, PENDING_APPROVAL, etc.
  const STATUS_ORDER = ['OPEN', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'RESOLVED', 'WAIVED', 'ESCALATED'];
  const activeExceptions = exceptions
    .filter(e => !e.cleared)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const selectedIdx = activeExceptions.findIndex(e => e.id === selectedId);
  const selectedExc = selectedIdx >= 0 ? activeExceptions[selectedIdx] : null;

  if (loading) return <div style={{ padding: 32, color: '#5C6360' }}>Loading review queue…</div>;
  if (loadErr) return <div style={{ padding: 32, color: 'var(--status-breach)' }}>Error: {loadErr}</div>;

  return (
    <div>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <span style={s.toolbarTitle}>
          Review Queue
          <span style={s.queueCount}>{activeExceptions.length} active</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={s.toolbarLabel}>Acting as:</span>
          <select
            value={activeUser}
            onChange={e => setActiveUser(e.target.value)}
            style={s.select}
          >
            {FIXTURE_USERS.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedExc ? (
        <div style={s.detailContainer}>
          <ExceptionDetail
            exception={selectedExc}
            dealId={dealId}
            dealName={dealName}
            activeUser={activeUser}
            onUpdate={handleUpdate}
            onClose={() => setSelectedId(null)}
            onPrev={() => setSelectedId(activeExceptions[selectedIdx - 1]?.id)}
            onNext={() => setSelectedId(activeExceptions[selectedIdx + 1]?.id)}
            hasPrev={selectedIdx > 0}
            hasNext={selectedIdx < activeExceptions.length - 1}
          />
          <ResolutionPanel
            key={`${selectedExc.id}-${selectedExc.status}`}
            exception={selectedExc}
            dealId={dealId}
            activeUser={activeUser}
            onUpdate={handleUpdate}
          />
        </div>
      ) : (
        <div>
          {activeExceptions.length === 0 ? (
            <div style={s.empty}>No active exceptions in the queue.</div>
          ) : (
            <div style={s.list}>
              {activeExceptions.map(exc => {
                const leftBorder =
                  exc.severity === 'BREACH'  ? '3px solid var(--status-breach)' :
                  exc.severity === 'WARNING' ? '3px solid var(--status-warning)' :
                  '3px solid transparent';
                return (
                  <div key={exc.id} style={{ ...s.listRow, borderLeft: leftBorder }}>
                    <div style={s.listLeft}>
                      <SeverityChip severity={exc.severity} />
                      <span style={s.testId}>{exc.test_id}</span>
                      <span style={s.desc}>{exc.description}</span>
                    </div>
                    <div style={s.listRight}>
                      <StatusChip status={exc.status} />
                      <span style={s.assignee}>
                        {exc.assigned_to
                          ? (FIXTURE_USERS.find(u => u.id === exc.assigned_to)?.name ?? exc.assigned_to)
                          : <span style={{ color: '#8E9590' }}>Unassigned</span>
                        }
                      </span>
                      <button
                        style={s.reviewBtn}
                        onClick={() => setSelectedId(exc.id)}
                      >
                        Review →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    padding: '10px 0 12px',
    borderBottom: '1px solid #D8D6D0',
  },
  toolbarTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#1A1D1B',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  queueCount: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 10,
    background: 'var(--status-open-bg)',
    color: 'var(--status-open)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  toolbarLabel: {
    fontSize: 12,
    color: '#5C6360',
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
  detailContainer: {
    display: 'flex',
    border: '1px solid #D8D6D0',
    borderRadius: 8,
    overflow: 'hidden',
    minHeight: 480,
    background: '#FAFAF8',
  },
  empty: {
    padding: '60px 0',
    textAlign: 'center',
    color: '#5C6360',
    fontSize: 14,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    border: '1px solid #D8D6D0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  listRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: '#FAFAF8',
    borderBottom: '1px solid #D8D6D0',
    gap: 12,
  },
  listLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  testId: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    fontWeight: 600,
    color: '#1A1D1B',
    whiteSpace: 'nowrap',
  },
  desc: {
    fontSize: 13,
    color: '#5C6360',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  listRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  assignee: {
    fontSize: 12,
    color: '#5C6360',
    minWidth: 100,
  },
  reviewBtn: {
    fontSize: 12,
    padding: '5px 12px',
    borderRadius: 4,
    border: '1px solid var(--brand-primary)',
    background: 'transparent',
    color: 'var(--brand-primary)',
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'background 0.1s',
  },
};
