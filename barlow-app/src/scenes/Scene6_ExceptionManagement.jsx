import { useState } from 'react';
import RegisterTab from '../components/exceptions/RegisterTab';
import ReviewQueueTab from '../components/exceptions/ReviewQueueTab';

const TABS = [
  { id: 'register', label: 'Register' },
  { id: 'review',   label: 'Review Queue' },
  { id: 'audit',    label: 'Audit Trail' },
  { id: 'deals',    label: 'Deal Switcher' },
];

function PlaceholderTab({ label }) {
  return (
    <div style={{ padding: '60px 40px', textAlign: 'center', color: '#5C6360' }}>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#1A1D1B' }}>{label}</div>
      <div style={{ fontSize: 13 }}>Coming in the next implementation step.</div>
    </div>
  );
}

export default function Scene6ExceptionManagement() {
  const [activeTab, setActiveTab] = useState('register');

  return (
    <div>
      {/* Sticky toolbar */}
      <div style={s.toolbar}>
        <span style={s.title}>Exception Management</span>
      </div>

      {/* Horizontal tab bar */}
      <div style={s.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            style={{ ...s.tab, ...(activeTab === tab.id ? s.tabActive : {}) }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={s.content}>
        {activeTab === 'register' && <RegisterTab />}
        {activeTab === 'review'   && <ReviewQueueTab />}
        {activeTab === 'audit'    && <PlaceholderTab label="Audit Trail" />}
        {activeTab === 'deals'    && <PlaceholderTab label="Deal Switcher" />}
      </div>
    </div>
  );
}

const s = {
  toolbar: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0 16px',
    background: 'var(--color-bg)',
  },
  title: {
    fontSize: 22,
    fontWeight: 600,
    color: '#1A1D1B',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #D8D6D0',
    marginBottom: 24,
    gap: 0,
  },
  tab: {
    padding: '10px 20px',
    fontSize: 13,
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
    minHeight: 400,
  },
};
