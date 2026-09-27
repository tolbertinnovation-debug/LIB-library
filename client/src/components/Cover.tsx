import type { CSSProperties } from 'react';

// Every title gets a typographic cover generated from its name, so the
// catalog looks complete without depending on outside image services.

const PALETTES: [bg: string, fg: string, accent: string][] = [
  ['#0b2a5b', '#fbf7ef', '#e23b4e'],
  ['#7a1f1f', '#f3e6c8', '#e0b04a'],
  ['#1f4d3a', '#f1ead8', '#d9a441'],
  ['#2d2a4a', '#efe7ff', '#f28c6b'],
  ['#b5542a', '#fff4e6', '#1d2a3a'],
  ['#123c4a', '#e7f2ef', '#f2c14e'],
  ['#4a2c1d', '#f5e9d8', '#c9a15b'],
  ['#262626', '#f4efe6', '#d64933'],
  ['#6b2d5c', '#fbeef7', '#f2b134'],
  ['#e8dcc4', '#2a2118', '#8c2f1f'],
  ['#d9e4dd', '#1e3a2f', '#b5542a'],
  ['#f2d06b', '#2a2118', '#0b2a5b'],
];

const MOTIFS = ['band', 'star', 'rings', 'stripes', 'frame', 'arch'] as const;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function Motif({ kind, accent, fg }: { kind: (typeof MOTIFS)[number]; accent: string; fg: string }) {
  switch (kind) {
    case 'star':
      return (
        <svg className="cover-motif" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden>
          <path d="M50 18l6.2 13 14.3 1.7-10.5 9.8 2.8 14.2L50 49.6l-12.8 7.1 2.8-14.2-10.5-9.8 14.3-1.7z" fill={accent} />
          <path d="M0 136h100M0 141h100" stroke={fg} strokeOpacity=".35" strokeWidth="1" />
        </svg>
      );
    case 'rings':
      return (
        <svg className="cover-motif" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {[46, 36, 26, 16].map((r, i) => (
            <circle key={r} cx="78" cy="120" r={r} fill="none" stroke={i % 2 ? fg : accent} strokeOpacity={i % 2 ? 0.25 : 0.9} strokeWidth="2.2" />
          ))}
        </svg>
      );
    case 'stripes':
      return (
        <svg className="cover-motif" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden>
          {Array.from({ length: 11 }, (_, i) => (
            <path key={i} d={`M${-40 + i * 16} 150 L${20 + i * 16} 96`} stroke={i % 3 === 0 ? accent : fg} strokeOpacity={i % 3 === 0 ? 0.95 : 0.22} strokeWidth="3" />
          ))}
        </svg>
      );
    case 'frame':
      return (
        <svg className="cover-motif" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden>
          <rect x="6" y="6" width="88" height="138" fill="none" stroke={accent} strokeWidth="1.6" />
          <rect x="10" y="10" width="80" height="130" fill="none" stroke={fg} strokeOpacity=".35" strokeWidth=".8" />
        </svg>
      );
    case 'arch':
      return (
        <svg className="cover-motif" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden>
          <path d="M20 150V118a30 30 0 0 1 60 0v32" fill={accent} fillOpacity=".92" />
          <path d="M29 150V120a21 21 0 0 1 42 0v30" fill="none" stroke={fg} strokeOpacity=".4" strokeWidth="1.2" />
        </svg>
      );
    default:
      return (
        <svg className="cover-motif" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden>
          <rect x="0" y="104" width="100" height="16" fill={accent} />
          <rect x="0" y="123" width="100" height="3" fill={accent} fillOpacity=".7" />
        </svg>
      );
  }
}

export function Cover({
  title,
  author,
  seed,
  size = 'md',
  className = '',
}: {
  title: string;
  author: string;
  seed?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const h = hash(seed || title);
  const [bg, fg, accent] = PALETTES[h % PALETTES.length]!;
  const motif = MOTIFS[(h >>> 8) % MOTIFS.length]!;
  const long = title.length > 38;
  const style = { '--cover-bg': bg, '--cover-fg': fg, '--cover-accent': accent } as CSSProperties;
  return (
    <div className={`cover cover-${size} cover-${motif} ${className}`} style={style} role="img" aria-label={`Cover of ${title} by ${author}`}>
      <Motif kind={motif} accent={accent} fg={fg} />
      <div className="cover-text">
        <div className={`cover-title ${long ? 'cover-title-long' : ''}`}>{title}</div>
        <div className="cover-rule" />
        <div className="cover-author">{author}</div>
      </div>
      <div className="cover-spine" />
    </div>
  );
}
