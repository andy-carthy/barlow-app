import { useState, useEffect, useRef } from 'react';

export default function SceneToolbar({ stepNum, title, back, backLabel, right }) {
  const [scrolled, setScrolled] = useState(false);
  const barRef = useRef(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    // Walk up to find the scrollable ancestor (the .content div)
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflow + style.overflowY)) break;
      node = node.parentElement;
    }
    if (!node) return;

    const onScroll = () => setScrolled(node.scrollTop > 8);
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      ref={barRef}
      style={{
        ...s.bar,
        boxShadow: scrolled
          ? '0 2px 10px rgba(0,0,0,0.10)'
          : '0 1px 0 var(--color-border)',
      }}
    >
      <div style={s.titleArea}>
        <span style={s.badge}>{stepNum}</span>
        <span style={s.title}>{title}</span>
      </div>
      <div style={s.actions}>
        {back && (
          <button style={s.navLink} onClick={back}>← {backLabel}</button>
        )}
        {right}
      </div>
    </div>
  );
}

// Exported styles so scenes can use consistent toolbar button/link styles
export const tbNavLink = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--color-dusty-blue)', fontSize: 13,
  textDecoration: 'underline', padding: 0,
};

export const tbBtn = {
  padding: '8px 18px', background: 'var(--color-text-primary)',
  color: '#fff', border: 'none', borderRadius: 6,
  cursor: 'pointer', fontWeight: 600, fontSize: 13,
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

const s = {
  bar: {
    position: 'sticky', top: 0, zIndex: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '11px 0', marginBottom: 24,
    background: 'var(--color-bg)', transition: 'box-shadow 0.15s',
  },
  titleArea: { display: 'flex', alignItems: 'center', gap: 10 },
  badge: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 26, height: 26, borderRadius: '50%',
    background: 'var(--color-dusty-blue)', color: '#fff',
    fontSize: 13, fontWeight: 700, flexShrink: 0,
  },
  title:   { fontSize: 17, fontWeight: 700, color: 'var(--color-text-primary)' },
  actions: { display: 'flex', alignItems: 'center', gap: 12 },
  navLink: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--color-dusty-blue)', fontSize: 13,
    textDecoration: 'underline', padding: 0,
  },
};
