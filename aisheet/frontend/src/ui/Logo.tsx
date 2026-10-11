export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#lg)" />
      <path d="M17 24h30M17 33h30M17 42h30M29 16v34" stroke="#fff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 10l2.4 5.6L54 18l-5.6 2.4L46 26l-2.4-5.6L38 18l5.6-2.4z" fill="#34d399" />
    </svg>
  );
}
