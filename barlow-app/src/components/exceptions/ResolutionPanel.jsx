import { useState } from 'react';
import { FIXTURE_USERS } from './ExceptionDetail';

const BASE = 'http://localhost:3001';

const RESOLUTION_TYPES = ['Portfolio Action', 'Cure Period', 'Calculation Correction', 'Other'];
const WAIVER_TYPES     = ['Administrative', 'Temporary Cure Period', 'Permanent'];

const ACTION_ICONS = {
  CREATED:        '○',
  ASSIGNED:       '◎',
  STATUS_CHANGED: '→',
  NOTE_ADDED:     '✎',
  FILE_ATTACHED:  '⊕',
  APPROVAL_GIVEN: '✓',
  CLEARED:        '■',
};

function formatTs(ts) {
  try { return new Date(ts).toLocaleString(); }
  catch { return ts; }
}

export default function ResolutionPanel({ exception: exc, dealId, activeUser, onUpdate }) {
  const [activeTab,  setActiveTab]  = useState('Resolution');
  const [notes,      setNotes]      = useState(exc.resolution_notes ?? '');
  const [resType,    setResType]    = useState('');
  const [cureDate,   setCureDate]   = useState('');
  const [waiver,     setWaiver]     = useState(exc.waiver_rationale ?? '');
  const [waiverType, setWaiverType] = useState('');
  const [waiverExp,  setWaiverExp]  = useState('');

  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState(null);

  const [l1User,    setL1User]    = useState('');
  const [l1Comment, setL1Comment] = useState('');
  const [l1Err,     setL1Err]     = useState(null);
  const [l2User,    setL2User]    = useState('');
  const [l2Comment, setL2Comment] = useState('');
  const [l2Err,     setL2Err]     = useState(null);

  const l1Approval = exc.approvals?.find(a => a.level === 1) ?? null;
  const l2Approval = exc.approvals?.find(a => a.level === 2) ?? null;
  const l2Eligible = FIXTURE_USERS.filter(u => u.id !== l1Approval?.approver_id);

  async function saveNotes() {
    setSaving(true); setSaveMsg(null);
    try {
      const res = await fetch(`${BASE}/api/exceptions/${dealId}/${exc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_notes: notes, actor: activeUser }),
      });
      const data = await res.json();
      if (data.success) { onUpdate(data.data); setSaveMsg('Saved ✓'); }
      else setSaveMsg(`Error: ${data.error}`);
    } catch (e) { setSaveMsg(`Error: ${e.message}`); }
    finally { setSaving(false); }
  }

  async function saveWaiver() {
    setSaving(true); setSaveMsg(null);
    try {
      const res = await fetch(`${BASE}/api/exceptions/${dealId}/${exc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waiver_rationale: waiver, actor: activeUser }),
      });
      const data = await res.json();
      if (data.success) { onUpdate(data.data); setSaveMsg('Saved ✓'); }
      else setSaveMsg(`Error: ${data.error}`);
    } catch (e) { setSaveMsg(`Error: ${e.message}`); }
    finally { setSaving(false); }
  }

  async function submitApproval(level, userId, comment, setErr) {
    setErr(null);
    if (!userId) { setErr('Select an approver'); return; }
    const user = FIXTURE_USERS.find(u => u.id === userId);
    try {
      const res = await fetch(`${BASE}/api/exceptions/${dealId}/${exc.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level,
          approver_id: userId,
          approver_name: user?.name ?? userId,
          comment: comment || null,
        }),
      });
      const data = await res.json();
      if (data.success) { onUpdate(data.data); }
      else setErr(data.error);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div style={s.root}>
      {/* Inner tab bar */}
      <div style={s.tabBar}>
        {['Resolution', 'Waiver', 'Files', 'History'].map(t => (
          <button
            key={t}
            style={{ ...s.tab, ...(activeTab === t ? s.tabActive : {}) }}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={s.content}>

        {/* ── Resolution tab ── */}
        {activeTab === 'Resolution' && (
          <div>
            <div style={s.field}>
              <label style={s.label}>Resolution Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Document the resolution. Minimum 20 characters required to submit for approval."
                style={s.textarea}
                rows={5}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <button style={s.saveBtn} onClick={saveNotes} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Notes'}
                </button>
                <span style={{ fontSize: 11, color: notes.length < 20 ? 'var(--status-breach)' : '#5C6360' }}>
                  {notes.length < 20
                    ? `${20 - notes.length} more characters required for approval`
                    : `${notes.length} characters ✓`}
                </span>
              </div>
              {saveMsg && (
                <div style={{ fontSize: 12, marginTop: 4, color: saveMsg.startsWith('Error') ? 'var(--status-breach)' : 'var(--status-resolved)' }}>
                  {saveMsg}
                </div>
              )}
            </div>

            <div style={s.row}>
              <div style={s.field}>
                <label style={s.label}>Resolution Type</label>
                <select value={resType} onChange={e => setResType(e.target.value)} style={s.select}>
                  <option value="">Select type…</option>
                  {RESOLUTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={s.field}>
                <label style={s.label}>Expected Cure Date</label>
                <input type="date" value={cureDate} onChange={e => setCureDate(e.target.value)} style={s.select} />
              </div>
            </div>

            <hr style={s.divider} />

            {/* Level 1 approval */}
            <div style={s.approvalBlock}>
              <div style={s.approvalTitle}>
                Level 1 Sign-off
                {l1Approval && <span style={s.badge}>✓ Given</span>}
              </div>

              {l1Approval ? (
                <div style={s.approvalRecord}>
                  <strong>{l1Approval.approver_name}</strong>
                  {' · '}{formatTs(l1Approval.approved_at)}
                  {l1Approval.comment && <div style={s.approvalComment}>{l1Approval.comment}</div>}
                </div>
              ) : exc.status === 'PENDING_APPROVAL' ? (
                <div>
                  <div style={s.approvalForm}>
                    <select value={l1User} onChange={e => setL1User(e.target.value)} style={s.select}>
                      <option value="">Select approver…</option>
                      {FIXTURE_USERS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <input
                      type="text"
                      placeholder="Optional comment"
                      value={l1Comment}
                      onChange={e => setL1Comment(e.target.value)}
                      style={{ ...s.select, flex: 1 }}
                    />
                    <button style={s.saveBtn} onClick={() => submitApproval(1, l1User, l1Comment, setL1Err)}>
                      Sign Off
                    </button>
                  </div>
                  {l1Err && <div style={s.errMsg}>{l1Err}</div>}
                </div>
              ) : (
                <div style={s.approvalPending}>
                  Available once exception reaches Pending Approval status
                </div>
              )}
            </div>

            {/* Level 2 approval */}
            <div style={{ ...s.approvalBlock, opacity: l1Approval ? 1 : 0.45 }}>
              <div style={s.approvalTitle}>
                Level 2 Sign-off
                {l2Approval && <span style={s.badge}>✓ Given</span>}
                {!l1Approval && <span style={s.pendingNote}>Awaiting Level 1</span>}
              </div>

              {l2Approval ? (
                <div style={s.approvalRecord}>
                  <strong>{l2Approval.approver_name}</strong>
                  {' · '}{formatTs(l2Approval.approved_at)}
                  {l2Approval.comment && <div style={s.approvalComment}>{l2Approval.comment}</div>}
                </div>
              ) : l1Approval && (exc.status === 'RESOLVED' || exc.status === 'WAIVED') ? (
                <div>
                  <div style={s.approvalForm}>
                    <select value={l2User} onChange={e => setL2User(e.target.value)} style={s.select}>
                      <option value="">Select approver…</option>
                      {l2Eligible.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <input
                      type="text"
                      placeholder="Optional comment"
                      value={l2Comment}
                      onChange={e => setL2Comment(e.target.value)}
                      style={{ ...s.select, flex: 1 }}
                    />
                    <button style={s.saveBtn} onClick={() => submitApproval(2, l2User, l2Comment, setL2Err)}>
                      Sign Off
                    </button>
                  </div>
                  {l2Err && <div style={s.errMsg}>{l2Err}</div>}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ── Waiver tab ── */}
        {activeTab === 'Waiver' && (
          <div>
            <div style={s.field}>
              <label style={s.label}>Waiver Rationale</label>
              <textarea
                value={waiver}
                onChange={e => setWaiver(e.target.value)}
                placeholder="Document the rationale for waiving this exception. Minimum 20 characters."
                style={s.textarea}
                rows={5}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <button style={s.saveBtn} onClick={saveWaiver} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Waiver Rationale'}
                </button>
                <span style={{ fontSize: 11, color: waiver.length < 20 ? 'var(--status-breach)' : '#5C6360' }}>
                  {waiver.length < 20
                    ? `${20 - waiver.length} more characters required`
                    : `${waiver.length} characters ✓`}
                </span>
              </div>
              {saveMsg && (
                <div style={{ fontSize: 12, marginTop: 4, color: saveMsg.startsWith('Error') ? 'var(--status-breach)' : 'var(--status-resolved)' }}>
                  {saveMsg}
                </div>
              )}
            </div>
            <div style={s.row}>
              <div style={s.field}>
                <label style={s.label}>Waiver Type</label>
                <select value={waiverType} onChange={e => setWaiverType(e.target.value)} style={s.select}>
                  <option value="">Select type…</option>
                  {WAIVER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {waiverType === 'Temporary Cure Period' && (
                <div style={s.field}>
                  <label style={s.label}>Waiver Expiry</label>
                  <input type="date" value={waiverExp} onChange={e => setWaiverExp(e.target.value)} style={s.select} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Files tab ── */}
        {activeTab === 'Files' && (
          <div>
            <div style={s.dropZone}>
              <span style={s.dropIcon}>⊕</span>
              <span style={s.dropText}>Drag files here, or click to browse</span>
              <span style={{ fontSize: 11, color: '#8E9590', marginTop: 2 }}>
                Supporting documents, correspondence, calculations
              </span>
            </div>

            {(exc.supporting_files ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: '#8E9590', textAlign: 'center', padding: '16px 0' }}>
                No files attached
              </div>
            ) : (
              <div style={s.fileList}>
                {exc.supporting_files.map(f => (
                  <div key={f.id} style={s.fileRow}>
                    <span style={s.fileName}>{f.filename}</span>
                    <span style={s.fileMeta}>
                      {(f.size_bytes / 1024).toFixed(1)} KB · {f.uploaded_by} · {new Date(f.uploaded_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── History tab ── */}
        {activeTab === 'History' && (
          <div>
            {(exc.audit_trail ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: '#8E9590', textAlign: 'center', padding: '20px 0' }}>
                No audit events
              </div>
            ) : (
              [...(exc.audit_trail ?? [])].reverse().map(ev => (
                <div key={ev.id} style={s.auditRow}>
                  <span style={s.auditIcon}>{ACTION_ICONS[ev.action] ?? '•'}</span>
                  <div style={s.auditBody}>
                    <div>
                      <strong style={{ fontSize: 12 }}>{ev.actor}</strong>
                      {' '}
                      <span style={{ fontSize: 12, color: '#5C6360' }}>
                        {ev.action.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      {' '}
                      <span style={{ fontSize: 11, color: '#8E9590' }}>{formatTs(ev.timestamp)}</span>
                    </div>
                    {(ev.from_value || ev.to_value) && (
                      <div style={s.auditDelta}>
                        {ev.from_value && <span>{ev.from_value}</span>}
                        {ev.from_value && ev.to_value && <span> → </span>}
                        {ev.to_value && <span style={{ fontWeight: 600 }}>{ev.to_value}</span>}
                      </div>
                    )}
                    {ev.note && <div style={s.auditNote}>{ev.note}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #D8D6D0',
    background: '#F4F3F0',
    padding: '0 20px',
  },
  tab: {
    padding: '10px 16px',
    fontSize: 12,
    fontWeight: 500,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: -1,
    cursor: 'pointer',
    color: '#5C6360',
    transition: 'all 0.1s',
  },
  tabActive: {
    color: 'var(--brand-primary)',
    borderBottomColor: 'var(--brand-primary)',
    fontWeight: 600,
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 24px',
  },
  field: {
    marginBottom: 14,
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
  textarea: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13,
    border: '1px solid #D8D6D0',
    borderRadius: 6,
    resize: 'vertical',
    fontFamily: 'inherit',
    color: '#1A1D1B',
    outline: 'none',
    boxSizing: 'border-box',
    lineHeight: 1.5,
  },
  row: {
    display: 'flex',
    gap: 16,
  },
  select: {
    fontSize: 12,
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid #D8D6D0',
    background: '#fff',
    color: '#1A1D1B',
    outline: 'none',
    cursor: 'pointer',
  },
  saveBtn: {
    fontSize: 12,
    padding: '6px 14px',
    borderRadius: 5,
    border: 'none',
    background: 'var(--brand-primary)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
  },
  divider: {
    border: 'none',
    borderTop: '1px solid #D8D6D0',
    margin: '16px 0',
  },
  approvalBlock: {
    marginBottom: 16,
    padding: '14px 16px',
    background: '#fff',
    border: '1px solid #D8D6D0',
    borderRadius: 6,
  },
  approvalTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#1A1D1B',
    marginBottom: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 4,
    background: 'var(--status-resolved-bg)',
    color: 'var(--status-resolved)',
    fontWeight: 600,
  },
  pendingNote: {
    fontSize: 11,
    color: '#8E9590',
    fontWeight: 400,
  },
  approvalRecord: {
    fontSize: 12,
    color: '#5C6360',
    lineHeight: 1.5,
  },
  approvalComment: {
    fontSize: 12,
    color: '#5C6360',
    fontStyle: 'italic',
    marginTop: 2,
  },
  approvalPending: {
    fontSize: 12,
    color: '#8E9590',
    fontStyle: 'italic',
  },
  approvalForm: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  errMsg: {
    color: 'var(--status-breach)',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 1.4,
  },
  dropZone: {
    border: '2px dashed #D8D6D0',
    borderRadius: 8,
    padding: '28px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer',
    marginBottom: 16,
    background: '#FAFAF8',
  },
  dropIcon: {
    fontSize: 24,
    color: '#8E9590',
  },
  dropText: {
    fontSize: 13,
    color: '#5C6360',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  fileRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 4,
    background: '#FAFAF8',
    border: '1px solid #D8D6D0',
  },
  fileName: {
    fontSize: 12,
    fontWeight: 500,
    color: '#1A1D1B',
  },
  fileMeta: {
    fontSize: 11,
    color: '#8E9590',
  },
  auditRow: {
    display: 'flex',
    gap: 10,
    padding: '10px 0',
    borderBottom: '1px solid #D8D6D0',
  },
  auditIcon: {
    fontSize: 14,
    color: '#5C6360',
    flexShrink: 0,
    marginTop: 1,
    width: 18,
    textAlign: 'center',
  },
  auditBody: {
    flex: 1,
    minWidth: 0,
  },
  auditDelta: {
    fontSize: 11,
    color: '#5C6360',
    fontFamily: 'var(--font-mono)',
    marginTop: 2,
  },
  auditNote: {
    fontSize: 11,
    color: '#8E9590',
    marginTop: 2,
    fontStyle: 'italic',
  },
};
