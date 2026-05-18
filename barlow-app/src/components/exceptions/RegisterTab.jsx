import { useState, useEffect } from 'react';
import { SeverityChip, StatusChip } from './ExceptionChip';
import SummaryCards from './SummaryCards';
import { useBarlowDemo } from '../../context/BarlowDemoContext';

const BASE = 'http://localhost:3001';

const STATUS_OPTS   = ['OPEN', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'RESOLVED', 'WAIVED'];
const TYPE_OPTS     = ['COVERAGE', 'CONCENTRATION', 'WATERFALL', 'MANUAL'];
const SEVERITY_OPTS = ['BREACH', 'WARNING', 'WATCH'];

function toggleItem(arr, val) {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '3px 10px',
        borderRadius: 4,
        cursor: 'pointer',
        border: '1px solid',
        borderColor: active ? 'var(--brand-primary)' : '#D8D6D0',
        background: active ? 'var(--brand-subtle)' : 'transparent',
        color: active ? '#1A1D1B' : '#5C6360',
        transition: 'all 0.1s',
      }}
    >
      {label}
    </button>
  );
}

function CushionCell({ cushion }) {
  if (cushion == null) return <span style={s.mono}>—</span>;
  const neg = cushion < 0;
  return (
    <span style={{ ...s.mono, color: neg ? 'var(--cushion-negative)' : 'var(--cushion-positive)' }}>
      {neg ? '▼ ' : '▲ '}{Math.abs(cushion).toFixed(2)}%
    </span>
  );
}

export default function RegisterTab() {
  const { activeDeal } = useBarlowDemo();
  const dealId = activeDeal?.id ?? 'carlyle-2024-1';

  const [register, setRegister] = useState({
    exceptions: [],
    open_count: 0,
    resolved_count: 0,
    waived_count: 0,
  });
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [filterStatus,   setFilterStatus]   = useState([]);
  const [filterType,     setFilterType]     = useState([]);
  const [filterSeverity, setFilterSeverity] = useState([]);
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterText,     setFilterText]     = useState('');

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetch(`${BASE}/api/exceptions/${dealId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setRegister(data.data);
        else setLoadError(data.error ?? 'Failed to load exceptions');
      })
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [dealId]);

  const exceptions = register.exceptions ?? [];

  const visible = exceptions.filter(exc => {
    if (filterStatus.length   && !filterStatus.includes(exc.status))     return false;
    if (filterType.length     && !filterType.includes(exc.test_type))    return false;
    if (filterSeverity.length && !filterSeverity.includes(exc.severity)) return false;
    if (filterAssigned        && exc.assigned_to !== filterAssigned)     return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      if (
        !exc.test_id.toLowerCase().includes(q) &&
        !exc.description.toLowerCase().includes(q) &&
        !(exc.indenture_section?.toLowerCase() ?? '').includes(q)
      ) return false;
    }
    return true;
  });

  const assignees = [...new Set(exceptions.map(e => e.assigned_to).filter(Boolean))];
  const hasFilter = filterStatus.length || filterType.length || filterSeverity.length || filterAssigned || filterText;

  function clearFilters() {
    setFilterStatus([]); setFilterType([]); setFilterSeverity([]);
    setFilterAssigned(''); setFilterText('');
  }

  if (loading)   return <div style={{ padding: 32, color: '#5C6360' }}>Loading exceptions…</div>;
  if (loadError) return <div style={{ padding: 32, color: 'var(--status-breach)' }}>Error: {loadError}</div>;

  return (
    <div>
      <SummaryCards register={register} />

      {/* Filter bar */}
      <div style={s.filterBar}>
        <div style={s.filterRow}>
          <div style={s.filterGroup}>
            <span style={s.filterLabel}>Severity</span>
            <div style={s.chips}>
              {SEVERITY_OPTS.map(v => (
                <FilterChip
                  key={v}
                  label={v}
                  active={filterSeverity.includes(v)}
                  onClick={() => setFilterSeverity(prev => toggleItem(prev, v))}
                />
              ))}
            </div>
          </div>

          <div style={s.filterGroup}>
            <span style={s.filterLabel}>Status</span>
            <div style={s.chips}>
              {STATUS_OPTS.map(v => (
                <FilterChip
                  key={v}
                  label={v.replace(/_/g, ' ')}
                  active={filterStatus.includes(v)}
                  onClick={() => setFilterStatus(prev => toggleItem(prev, v))}
                />
              ))}
            </div>
          </div>

          <div style={s.filterGroup}>
            <span style={s.filterLabel}>Type</span>
            <div style={s.chips}>
              {TYPE_OPTS.map(v => (
                <FilterChip
                  key={v}
                  label={v}
                  active={filterType.includes(v)}
                  onClick={() => setFilterType(prev => toggleItem(prev, v))}
                />
              ))}
            </div>
          </div>
        </div>

        <div style={s.filterRow}>
          <select
            value={filterAssigned}
            onChange={e => setFilterAssigned(e.target.value)}
            style={s.select}
          >
            <option value="">All assignees</option>
            {assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          <input
            type="text"
            placeholder="Search test ID, description, section…"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            style={s.search}
          />

          {hasFilter && (
            <button style={s.clearBtn} onClick={clearFilters}>Clear filters</button>
          )}

          <span style={s.resultCount}>
            {visible.length} of {exceptions.length} exception{exceptions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Severity', 'Test ID', 'Description', 'Status', 'Assigned To', 'Cushion', 'Due', 'Actions'].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#5C6360', padding: '40px 0' }}>
                  No exceptions match the current filters
                </td>
              </tr>
            )}
            {visible.map(exc => {
              const leftBorder =
                exc.severity === 'BREACH'  ? '3px solid var(--status-breach)' :
                exc.severity === 'WARNING' ? '3px solid var(--status-warning)' :
                                             '3px solid transparent';
              return (
                <tr key={exc.id} style={{ ...s.tableRow, borderLeft: leftBorder }}>
                  <td style={s.td}><SeverityChip severity={exc.severity} /></td>
                  <td style={{ ...s.td, ...s.mono, fontSize: 12 }}>{exc.test_id}</td>
                  <td style={{ ...s.td, maxWidth: 280, fontSize: 13 }}>{exc.description}</td>
                  <td style={s.td}><StatusChip status={exc.status} /></td>
                  <td style={{ ...s.td, fontSize: 12, color: exc.assigned_to ? '#1A1D1B' : '#8E9590' }}>
                    {exc.assigned_to ?? 'Unassigned'}
                  </td>
                  <td style={s.td}><CushionCell cushion={exc.cushion} /></td>
                  <td style={{ ...s.td, fontSize: 12, color: exc.due_date ? '#1A1D1B' : '#8E9590' }}>
                    {exc.due_date ?? '—'}
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={s.actionBtn}>Assign</button>
                      <button style={s.actionBtn}>Review</button>
                      <button style={s.actionBtn}>Trail</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const s = {
  filterBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '14px 18px',
    background: '#FAFAF8',
    border: '1px solid #D8D6D0',
    borderRadius: 8,
    marginBottom: 16,
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#5C6360',
    minWidth: 56,
  },
  chips: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
  },
  select: {
    fontSize: 12,
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid #D8D6D0',
    background: '#fff',
    color: '#1A1D1B',
    cursor: 'pointer',
    outline: 'none',
  },
  search: {
    fontSize: 12,
    padding: '5px 10px',
    borderRadius: 4,
    border: '1px solid #D8D6D0',
    background: '#fff',
    color: '#1A1D1B',
    width: 240,
    outline: 'none',
  },
  clearBtn: {
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 4,
    border: '1px solid #D8D6D0',
    background: 'transparent',
    cursor: 'pointer',
    color: '#5C6360',
  },
  resultCount: {
    fontSize: 12,
    color: '#5C6360',
    marginLeft: 'auto',
  },
  tableWrap: {
    overflowX: 'auto',
    borderRadius: 8,
    border: '1px solid #D8D6D0',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    background: '#FAFAF8',
  },
  th: {
    padding: '10px 14px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#5C6360',
    textAlign: 'left',
    background: '#F4F3F0',
    borderBottom: '1px solid #D8D6D0',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '12px 14px',
    verticalAlign: 'middle',
    borderBottom: '1px solid #D8D6D0',
    fontSize: 13,
    color: '#1A1D1B',
  },
  tableRow: {
    borderLeft: '3px solid transparent',
  },
  mono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },
  actionBtn: {
    fontSize: 11,
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid #D8D6D0',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--brand-primary)',
    fontWeight: 500,
  },
};
