export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function formatYear(year: number | null) {
  if (year == null) return '';
  if (year < 0) return `c. ${Math.abs(year)} BCE`;
  if (year < 1000) return `c. ${year} CE`;
  return String(year);
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, opts);
}

const DAY = 86400000;

/** "due in 3 days", "due tomorrow", "3 days overdue" */
export function dueLabel(iso: string, now = Date.now()) {
  const days = Math.ceil((Date.parse(iso) - now) / DAY);
  if (days < 0) return { text: `${plural(-days, 'day')} overdue`, tone: 'danger' as const };
  if (days === 0) return { text: 'Due today', tone: 'warning' as const };
  if (days === 1) return { text: 'Due tomorrow', tone: 'warning' as const };
  if (days <= 3) return { text: `Due in ${days} days`, tone: 'warning' as const };
  return { text: `Due ${formatDate(iso, { month: 'short', day: 'numeric' })}`, tone: 'ok' as const };
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${plural(d, 'day')} ago`;
  return formatDate(iso);
}

export function readingTime(minutes: number) {
  if (minutes < 60) return `${Math.max(1, minutes)} min read`;
  const h = minutes / 60;
  return `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} hr read`;
}

export function compact(n: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
