export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo-mark">
      <rect width="64" height="64" rx="14" fill="var(--brand)" />
      <path d="M12 21c7-3 14-3 20 2 6-5 13-5 20-2v26c-7-3-14-3-20 2-6-5-13-5-20-2z" fill="#fbf7ef" />
      <path d="M32 23v26" stroke="var(--brand)" strokeWidth="2" />
      <path d="M17 28c4-1 8-1 11 1M17 34c4-1 8-1 11 1M17 40c4-1 8-1 11 1M36 29c3-2 7-2 11-1M36 35c3-2 7-2 11-1M36 41c3-2 7-2 11-1" stroke="#0b2a5b" strokeOpacity=".25" strokeWidth="1.4" fill="none" />
      <path d="M32 7l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L32 21.8l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="#e23b4e" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-words">
        <span className="logo-name">Liberia</span>
        <span className="logo-sub">Online Library</span>
      </span>
    </span>
  );
}
