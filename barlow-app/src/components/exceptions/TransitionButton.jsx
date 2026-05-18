import { useState } from 'react';

const BASE = 'http://localhost:3001';

export default function TransitionButton({
  dealId,
  exception,
  toStatus,
  label,
  actor,
  onSuccess,
  variant = 'primary',
}) {
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/exceptions/${dealId}/${exception.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TRANSITION', to_status: toStatus, actor }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess(data.data);
      } else {
        setError(data.error ?? 'Transition failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const btn = variant === 'primary' ? s.btnPrimary : s.btnGhost;

  return (
    <div>
      <button onClick={handleClick} disabled={loading} style={btn}>
        {loading ? 'Saving…' : label}
      </button>
      {error && (
        <div style={s.error}>{error}</div>
      )}
    </div>
  );
}

const s = {
  btnPrimary: {
    background: 'var(--brand-primary)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    padding: '8px 16px',
    cursor: 'pointer',
    transition: 'background 150ms',
  },
  btnGhost: {
    background: 'transparent',
    color: 'var(--brand-primary)',
    border: 'none',
    fontSize: 12,
    fontWeight: 400,
    padding: '6px 0',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  error: {
    color: 'var(--status-breach)',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 1.4,
    maxWidth: 320,
  },
};
