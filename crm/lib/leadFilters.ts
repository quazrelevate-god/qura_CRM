// The condition filter on the Leads page ("Stage is Lost", "Call attempts greater than 2", ...).
// Shared by the filter builder (browser) and the Leads page query (server). Conditions travel in the
// URL as ?f=[...]&match=all|any. Field names are whitelisted here and every value is quoted, so a URL
// can never add its own filter syntax.

export type FieldType = 'choice' | 'text' | 'number' | 'date';
export type Option = { value: string; label: string };
export type FieldDef = { key: string; label: string; type: FieldType; options?: Option[] };
export type Cond = { f: string; o: string; v?: string | string[]; w?: string };
export type Match = 'all' | 'any';
type InputKind = 'none' | 'one' | 'many' | 'two' | 'days';

export const FILTER_FIELDS: FieldDef[] = [
  { key: 'stage', label: 'Stage', type: 'choice' },
  { key: 'tier', label: 'Tier', type: 'choice' },
  { key: 'score', label: 'Score', type: 'number' },
  { key: 'owner_id', label: 'Owner', type: 'choice' },
  { key: 'source', label: 'Source', type: 'choice' },
  { key: 'lost_reason', label: 'Lost reason', type: 'choice' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'state', label: 'State', type: 'text' },
  { key: 'programme', label: 'Programme', type: 'text' },
  { key: 'call_attempts', label: 'Call attempts', type: 'number' },
  { key: 'submissions_count', label: 'Forms submitted', type: 'number' },
  { key: 'first_seen_at', label: 'First seen', type: 'date' },
  { key: 'last_contacted_at', label: 'Last contacted', type: 'date' },
  { key: 'next_follow_up_at', label: 'Next follow-up', type: 'date' },
  { key: 'utm_source', label: 'UTM source', type: 'text' },
  { key: 'utm_medium', label: 'UTM medium', type: 'text' },
  { key: 'utm_campaign', label: 'UTM campaign', type: 'text' },
];
const FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(FILTER_FIELDS.map((f) => [f.key, f]));

export const OPS: Record<FieldType, { key: string; label: string; input: InputKind }[]> = {
  choice: [
    { key: 'is', label: 'is', input: 'one' },
    { key: 'not', label: 'is not', input: 'one' },
    { key: 'any', label: 'is any of', input: 'many' },
    { key: 'empty', label: 'is empty', input: 'none' },
    { key: 'filled', label: 'is not empty', input: 'none' },
  ],
  text: [
    { key: 'contains', label: 'contains', input: 'one' },
    { key: 'notcontains', label: 'does not contain', input: 'one' },
    { key: 'is', label: 'is', input: 'one' },
    { key: 'not', label: 'is not', input: 'one' },
    { key: 'empty', label: 'is empty', input: 'none' },
    { key: 'filled', label: 'is not empty', input: 'none' },
  ],
  number: [
    { key: 'eq', label: 'is', input: 'one' },
    { key: 'neq', label: 'is not', input: 'one' },
    { key: 'gt', label: 'greater than', input: 'one' },
    { key: 'gte', label: 'greater than or equal to', input: 'one' },
    { key: 'lt', label: 'less than', input: 'one' },
    { key: 'lte', label: 'less than or equal to', input: 'one' },
    { key: 'between', label: 'between', input: 'two' },
    { key: 'empty', label: 'is empty', input: 'none' },
  ],
  date: [
    { key: 'on', label: 'is on', input: 'one' },
    { key: 'before', label: 'is before', input: 'one' },
    { key: 'after', label: 'is after', input: 'one' },
    { key: 'between', label: 'is between', input: 'two' },
    { key: 'last', label: 'is in the last … days', input: 'days' },
    { key: 'next', label: 'is in the next … days', input: 'days' },
    { key: 'empty', label: 'is empty', input: 'none' },
    { key: 'filled', label: 'is not empty', input: 'none' },
  ],
};

export const fieldDef = (key: string) => FIELD_MAP[key];
export const opDef = (type: FieldType, key: string) => OPS[type].find((o) => o.key === key);

/** True when a condition has everything its operator needs. */
export function isComplete(c: Cond): boolean {
  const def = FIELD_MAP[c.f];
  const op = def && opDef(def.type, c.o);
  if (!op) return false;
  const one = typeof c.v === 'string' ? c.v.trim() : '';
  switch (op.input) {
    case 'none': return true;
    case 'one': return one !== '';
    case 'many': return Array.isArray(c.v) && c.v.length > 0;
    case 'two': return one !== '' && String(c.w ?? '').trim() !== '';
    case 'days': return Number(one) > 0;
  }
}

/** Reads ?f= from the URL. Anything malformed is dropped. */
export function parseConds(raw: string | undefined): Cond[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 20).flatMap((c): Cond[] => {
      if (!c || typeof c !== 'object' || typeof c.f !== 'string' || typeof c.o !== 'string') return [];
      const v = Array.isArray(c.v) ? c.v.slice(0, 50).map((x: unknown) => String(x).slice(0, 200)) : c.v === undefined ? undefined : String(c.v).slice(0, 200);
      const w = c.w === undefined ? undefined : String(c.w).slice(0, 200);
      const cond: Cond = { f: c.f, o: c.o, v, w };
      return isComplete(cond) ? [cond] : [];
    });
  } catch {
    return [];
  }
}

// ---------------- server side: conditions → PostgREST logic tree ----------------

const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const likeQ = (v: string) => quote(`%${v.replace(/[%*]/g, '')}%`);
const num = (v: unknown) => {
  const s = String(v ?? '').trim();
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? String(n) : null;
};
/** "2026-09-01" → the ISO time of that day's midnight in India (+ n days). */
const istDay = (d: unknown, addDays = 0) => {
  const s = String(d ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = new Date(`${s}T00:00:00+05:30`).getTime();
  return Number.isNaN(t) ? null : new Date(t + addDays * 86400000).toISOString();
};

function condExpr(c: Cond, meId: string): string | null {
  const def = FIELD_MAP[c.f];
  if (!def) return null;
  const f = def.key;
  const one = typeof c.v === 'string' ? c.v.trim() : '';
  const many = Array.isArray(c.v) ? c.v.map((x) => String(x).trim()).filter(Boolean) : [];
  const val = (x: string) => (f === 'owner_id' && x === 'me' ? meId : x);

  if (def.type === 'choice') {
    if (c.o === 'is' && one) return `${f}.eq.${quote(val(one))}`;
    if (c.o === 'not' && one) return `or(${f}.neq.${quote(val(one))},${f}.is.null)`;
    if (c.o === 'any' && many.length) return `${f}.in.(${many.map((x) => quote(val(x))).join(',')})`;
    if (c.o === 'empty') return `${f}.is.null`;
    if (c.o === 'filled') return `${f}.not.is.null`;
    return null;
  }
  if (def.type === 'text') {
    const exact = quote(one.replace(/[%*]/g, ''));
    if (c.o === 'contains' && one) return `${f}.ilike.${likeQ(one)}`;
    if (c.o === 'notcontains' && one) return `or(${f}.not.ilike.${likeQ(one)},${f}.is.null)`;
    if (c.o === 'is' && one) return `${f}.ilike.${exact}`;
    if (c.o === 'not' && one) return `or(${f}.not.ilike.${exact},${f}.is.null)`;
    if (c.o === 'empty') return `or(${f}.is.null,${f}.eq."")`;
    if (c.o === 'filled') return `and(${f}.not.is.null,${f}.neq."")`;
    return null;
  }
  if (def.type === 'number') {
    if (c.o === 'empty') return `${f}.is.null`;
    const n = num(one);
    if (c.o === 'between') {
      const m = num(c.w);
      if (n === null || m === null) return null;
      const [lo, hi] = Number(n) <= Number(m) ? [n, m] : [m, n];
      return `and(${f}.gte.${lo},${f}.lte.${hi})`;
    }
    if (n === null) return null;
    if (c.o === 'neq') return `or(${f}.neq.${n},${f}.is.null)`;
    if (['eq', 'gt', 'gte', 'lt', 'lte'].includes(c.o)) return `${f}.${c.o}.${n}`;
    return null;
  }
  // date (days are India days)
  if (c.o === 'empty') return `${f}.is.null`;
  if (c.o === 'filled') return `${f}.not.is.null`;
  if (c.o === 'last' || c.o === 'next') {
    const days = Math.min(3650, Math.floor(Number(one)));
    if (!(days > 0)) return null;
    const now = Date.now();
    const [a, b] = c.o === 'last' ? [now - days * 86400000, now] : [now, now + days * 86400000];
    return `and(${f}.gte.${quote(new Date(a).toISOString())},${f}.lte.${quote(new Date(b).toISOString())})`;
  }
  if (c.o === 'on') {
    const a = istDay(one), b = istDay(one, 1);
    return a && b ? `and(${f}.gte.${quote(a)},${f}.lt.${quote(b)})` : null;
  }
  if (c.o === 'before') { const a = istDay(one); return a ? `${f}.lt.${quote(a)}` : null; }
  if (c.o === 'after') { const b = istDay(one, 1); return b ? `${f}.gte.${quote(b)}` : null; }
  if (c.o === 'between') {
    let [x, y] = [one, String(c.w ?? '')];
    if (x > y) [x, y] = [y, x];
    const a = istDay(x), b = istDay(y, 1);
    return a && b ? `and(${f}.gte.${quote(a)},${f}.lt.${quote(b)})` : null;
  }
  return null;
}

/** All conditions joined by and(...) or or(...); null when there is nothing to filter. */
export function filterTree(conds: Cond[], match: Match, meId: string): string | null {
  const parts = conds.map((c) => condExpr(c, meId)).filter((p): p is string => !!p);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${match === 'any' ? 'or' : 'and'}(${parts.join(',')})`;
}

/** Search on name, email or phone. */
export function searchTree(raw: string): string | null {
  const term = raw.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!term) return null;
  const parts = [`full_name.ilike.${likeQ(term)}`, `email.ilike.${likeQ(term)}`];
  const digits = term.replace(/\D/g, '');
  if (digits.length >= 3) parts.push(`phone.ilike.${likeQ(digits.length > 10 ? digits.slice(-10) : digits)}`);
  return `or(${parts.join(',')})`;
}
