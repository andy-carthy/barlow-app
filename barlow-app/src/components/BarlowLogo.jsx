export default function BarlowLogo() {
  return (
    <div style={s.wrapper}>
      <div style={s.wordmark}>
        <span style={s.bigB}>B</span>
        <span style={s.arlow}>arlow</span>
      </div>
      <div style={s.subtitle}>CLO Administration Pipeline</div>
    </div>
  );
}

const s = {
  wrapper:  { lineHeight: 1 },
  wordmark: { display: 'flex', alignItems: 'baseline', gap: 1 },
  bigB: {
    fontFamily: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
    fontWeight: 700,
    fontStyle:  'italic',
    fontSize:   52,
    color:      '#ffffff',
    lineHeight: 0.88,
    letterSpacing: '-0.01em',
  },
  arlow: {
    fontFamily: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
    fontWeight: 300,
    fontStyle:  'italic',
    fontSize:   26,
    color:      '#7a8fa6',
    lineHeight: 1,
    letterSpacing: '0.04em',
  },
  subtitle: {
    fontFamily: "'Courier New', Courier, monospace",
    fontSize:    9.5,
    color:       '#50606e',
    letterSpacing: '0.13em',
    textTransform: 'uppercase',
    marginTop:   10,
    lineHeight:  1.5,
  },
};
