const TZ = 'Asia/Kolkata';
const IST_OFFSET_MIN = 330;

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(v));
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(v));
}

/** "2 hours ago", "in 3 days" */
export function fmtRelative(v: string | null | undefined): string {
  if (!v) return '';
  const diff = new Date(v).getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: [number, string][] = [[86400000, 'day'], [3600000, 'hour'], [60000, 'minute']];
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      const label = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff < 0 ? `${label} ago` : `in ${label}`;
    }
  }
  return diff < 0 ? 'just now' : 'now';
}

/** Value for <input type="datetime-local"> in IST. */
export function toIstInput(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(new Date(v).getTime() + IST_OFFSET_MIN * 60000);
  return d.toISOString().slice(0, 16);
}

/** Parse a datetime-local value typed in IST into an ISO timestamp. */
export function fromIstInput(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Start and end of "today" in IST, as ISO timestamps. */
export function istDayBounds(offsetDays = 0): { start: string; end: string } {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60000);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth();
  const d = nowIst.getUTCDate() + offsetDays;
  const start = new Date(Date.UTC(y, m, d) - IST_OFFSET_MIN * 60000);
  const end = new Date(start.getTime() + 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function firstName(full: string | null | undefined): string {
  return String(full ?? '').trim().split(/\s+/)[0] || 'there';
}

export function prettyPhone(p: string | null | undefined): string {
  const s = String(p ?? '');
  if (/^91\d{10}$/.test(s)) return `+91 ${s.slice(2, 7)} ${s.slice(7)}`;
  return s || '—';
}
