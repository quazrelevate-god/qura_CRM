import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth';
import { STAGES, TIERS, LOST_REASONS, CLOSED_STAGES, WON_STAGES } from '@/lib/constants';
import { fmtDate, fmtDateTime, fmtRelative, istDayBounds, prettyPhone } from '@/lib/format';
import { bulkUpdate } from './actions';
import FilterBuilder from '@/components/FilterBuilder';
import SearchBar from '@/components/SearchBar';
import { FILTER_FIELDS, parseConds, filterTree, searchTree, type Cond, type FieldDef, type Match } from '@/lib/leadFilters';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
type SP = Record<string, string | undefined>;

const VIEWS = [
  { key: 'all', label: 'All open' },
  { key: 'today', label: 'My follow-ups today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'new', label: 'New & not called' },
  { key: 'hot', label: 'Hot' },
  { key: 'mine', label: 'My leads' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'closed', label: 'Enrolled / Lost' },
] as const;

const closedList = `(${CLOSED_STAGES.map((s) => `"${s}"`).join(',')})`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyView(q: any, view: string, me: string) {
  const now = new Date().toISOString();
  const { end } = istDayBounds();
  switch (view) {
    case 'today': return q.eq('owner_id', me).lt('next_follow_up_at', end).not('stage', 'in', closedList);
    case 'overdue': return q.lt('next_follow_up_at', now).not('stage', 'in', closedList);
    case 'new': return q.eq('stage', 'New').eq('call_attempts', 0);
    case 'hot': return q.eq('tier', 'Hot').not('stage', 'in', closedList);
    case 'mine': return q.eq('owner_id', me).not('stage', 'in', closedList);
    case 'unassigned': return q.is('owner_id', null).not('stage', 'in', closedList);
    case 'closed': return q.in('stage', CLOSED_STAGES);
    default: return q.not('stage', 'in', closedList);
  }
}

/** Old-style links (?stage=, ?owner=, ?from= ...) still work: they become filter conditions. */
function legacyConds(sp: SP): Cond[] {
  const out: Cond[] = [];
  if (sp.stage) out.push({ f: 'stage', o: 'is', v: sp.stage });
  if (sp.tier === 'none') out.push({ f: 'tier', o: 'empty' });
  else if (sp.tier) out.push({ f: 'tier', o: 'is', v: sp.tier });
  if (sp.owner === 'none') out.push({ f: 'owner_id', o: 'empty' });
  else if (sp.owner) out.push({ f: 'owner_id', o: 'is', v: sp.owner });
  if (sp.source) out.push({ f: 'source', o: 'is', v: sp.source });
  if (sp.from || sp.to) out.push({ f: 'first_seen_at', o: 'between', v: sp.from || '2000-01-01', w: sp.to || '2100-01-01' });
  return out;
}

function qs(sp: SP, patch: SP) {
  const p = new URLSearchParams();
  Object.entries({ ...sp, ...patch }).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `/leads?${s}` : '/leads';
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireMember();
  const supabase = await createClient();
  const view = sp.view && VIEWS.some((v) => v.key === sp.view) ? sp.view : 'all';
  const page = Math.max(1, Number(sp.page) || 1);
  const showAll = sp.all === '1';

  const [{ data: owners }, { data: sourceRows }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, active').order('full_name'),
    supabase.from('leads').select('source').not('source', 'is', null).limit(5000),
  ]);
  const sources = Array.from(new Set((sourceRows ?? []).map((r) => r.source as string))).sort();

  // counts per view
  const counts = await Promise.all(VIEWS.map(async (v) => {
    let cq = supabase.from('leads').select('id', { count: 'exact', head: true });
    if (!showAll) cq = cq.eq('archived', false).eq('is_test', false);
    cq = applyView(cq, v.key, me.id);
    const { count } = await cq;
    return count ?? 0;
  }));

  // Search looks through every lead (all tabs, every stage). Filters narrow the current tab.
  const search = (sp.q ?? '').trim();
  const conds = sp.f ? parseConds(sp.f) : legacyConds(sp);
  const match: Match = sp.match === 'any' ? 'any' : 'all';
  const trees = [searchTree(search), filterTree(conds, match, me.id)].filter((t): t is string => !!t);

  let q = supabase
    .from('leads')
    .select('id, lead_code, full_name, phone, email, city, stage, lost_reason, tier, score, owner_id, next_follow_up_at, call_attempts, last_contacted_at, source, first_seen_at, submissions_count, flags, is_test, archived', { count: 'exact' });
  if (search) {
    if (!showAll) q = q.eq('is_test', false);
  } else {
    if (!showAll) q = q.eq('archived', false).eq('is_test', false);
    q = applyView(q, view, me.id);
  }
  if (trees.length) q = q.or(trees.length === 1 ? trees[0] : `and(${trees.join(',')})`);

  const sort = sp.sort || (view === 'today' || view === 'overdue' ? 'followup' : 'newest');
  if (sort === 'followup') q = q.order('next_follow_up_at', { ascending: true, nullsFirst: false });
  else if (sort === 'score') q = q.order('score', { ascending: false, nullsFirst: false });
  else if (sort === 'oldest') q = q.order('first_seen_at', { ascending: true });
  else q = q.order('first_seen_at', { ascending: false });

  const from = (page - 1) * PAGE_SIZE;
  const { data: leads, count, error } = await q.range(from, from + PAGE_SIZE - 1);
  const total = count ?? 0;
  const ownerName = (id: string | null) => owners?.find((o) => o.id === id)?.full_name ?? '';
  const opt = (arr: readonly string[]) => arr.map((x) => ({ value: x, label: x }));
  const fields: FieldDef[] = FILTER_FIELDS.map((f) => {
    if (f.key === 'stage') return { ...f, options: opt(STAGES) };
    if (f.key === 'tier') return { ...f, options: opt(TIERS) };
    if (f.key === 'lost_reason') return { ...f, options: opt(LOST_REASONS) };
    if (f.key === 'source') return { ...f, options: opt(sources) };
    if (f.key === 'owner_id') {
      return { ...f, options: [{ value: 'me', label: 'Me' }, ...(owners ?? []).map((o) => ({ value: o.id, label: `${o.full_name || o.email}${o.active ? '' : ' (inactive)'}` }))] };
    }
    return f;
  });
  const keepForFilters = { view: search ? '' : view === 'all' ? '' : view, q: search, all: sp.all ?? '' };
  const filterKey = `${sp.f ?? ''}|${match}|${sp.sort ?? ''}|${search}|${view}`;
  const now = Date.now();
  const { end: todayEnd } = istDayBounds();

  return (
    <>
      <div className="page-head">
        <h1>Leads <span className="muted" style={{ fontWeight: 400, fontSize: 16 }}>{total}</span></h1>
        <div className="row">
          {me.role === 'admin' && <a className="btn btn-sm" href="/api/export">Export CSV</a>}
          <Link className="btn btn-primary btn-sm" href="/leads/new">+ New lead</Link>
        </div>
      </div>

      <SearchBar
        defaultValue={search}
        hidden={{ f: sp.f ?? '', match: sp.match ?? '', sort: sp.sort ?? '', all: sp.all ?? '' }}
        clearHref={qs({ all: sp.all, f: sp.f, match: sp.match, sort: sp.sort }, {})}
      />

      <div className="views">
        {VIEWS.map((v, i) => (
          <Link key={v.key} href={qs({ all: sp.all, f: sp.f, match: sp.match, sort: sp.sort }, { view: v.key === 'all' ? undefined : v.key })} className={!search && view === v.key ? 'active' : ''}>
            {v.label}<span className="count">{counts[i]}</span>
          </Link>
        ))}
      </div>

      {search && (
        <div className="notice">
          Showing every lead whose name, email or phone matches &ldquo;{search}&rdquo;, in all stages{conds.length ? ', with the filters below' : ''}.{' '}
          <Link href={qs({ all: sp.all, f: sp.f, match: sp.match, sort: sp.sort }, {})}>Clear search</Link>
        </div>
      )}

      <FilterBuilder key={filterKey} fields={fields} initial={conds} initialMatch={match} sort={sp.sort ?? ''} keep={keepForFilters} />

      {error && <div className="notice error">Could not load leads: {error.message}</div>}
      {sp.done && <div className="notice ok">{sp.done}</div>}

      <form action={bulkUpdate}>
        <input type="hidden" name="back" value={qs(sp, { done: undefined })} />
        <div className="bulkbar">
          <span className="muted small">With selected:</span>
          <select name="owner_id" defaultValue="">
            <option value="">— assign owner —</option>
            <option value="none">Unassign</option>
            {(owners ?? []).filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.full_name || o.email}</option>)}
          </select>
          <select name="stage" defaultValue="">
            <option value="">— change stage —</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="lost_reason" defaultValue="">
            <option value="">— lost reason —</option>
            {LOST_REASONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn btn-sm" type="submit">Apply</button>
          <span className="spacer" />
          <Link className="small" href={qs(sp, { all: showAll ? undefined : '1', page: undefined })}>{showAll ? 'Hide test & archived' : 'Show test & archived'}</Link>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Lead</th>
              <th>Phone</th>
              <th>Stage</th>
              <th>Tier</th>
              <th>Owner</th>
              <th>Next follow-up</th>
              <th>Calls</th>
              <th>Source</th>
              <th>First seen</th>
            </tr>
          </thead>
          <tbody>
            {(leads ?? []).length === 0 && (
              <tr><td colSpan={10} className="muted" style={{ padding: 24, textAlign: 'center' }}>No leads match.</td></tr>
            )}
            {(leads ?? []).map((l) => {
              const due = l.next_follow_up_at ? new Date(l.next_follow_up_at).getTime() : null;
              const dueClass = due === null ? '' : due < now ? 'due-over' : due < new Date(todayEnd).getTime() ? 'due-today' : '';
              const stageClass = l.stage === 'Lost' ? 'stage-lost' : WON_STAGES.includes(l.stage) ? 'stage-won' : 'stage';
              return (
                <tr key={l.id}>
                  <td><input type="checkbox" name="ids" value={l.id} aria-label={`Select ${l.full_name}`} style={{ width: 'auto' }} /></td>
                  <td>
                    <Link href={`/leads/${l.id}`} className="name">{l.full_name || '(no name)'}</Link>
                    <div className="muted small">{l.lead_code}{l.email ? ` · ${l.email}` : ''}{l.city ? ` · ${l.city}` : ''}{l.submissions_count > 1 ? ` · ${l.submissions_count} forms` : ''}</div>
                    {(l.is_test || l.archived || (l.flags ?? []).includes('Invalid number')) && (
                      <div className="row" style={{ marginTop: 3 }}>
                        {l.is_test && <span className="badge flag">Test</span>}
                        {l.archived && <span className="badge flag">Archived</span>}
                        {(l.flags ?? []).includes('Invalid number') && <span className="badge flag">Invalid number</span>}
                      </div>
                    )}
                  </td>
                  <td data-label="Phone" className="nowrap">{prettyPhone(l.phone)}</td>
                  <td data-label="Stage"><span className={`badge ${stageClass}`}>{l.stage}</span>{l.lost_reason && <div className="muted small">{l.lost_reason}</div>}</td>
                  <td data-label="Tier">{l.tier ? <span className={`badge tier-${l.tier}`}>{l.tier}{l.score !== null ? ` ${l.score}` : ''}</span> : <span className="muted">—</span>}</td>
                  <td data-label="Owner">{ownerName(l.owner_id) || <span className="muted">—</span>}</td>
                  <td data-label="Follow-up" className={dueClass}>
                    {l.next_follow_up_at ? <>{fmtDateTime(l.next_follow_up_at)}<div className="small">{fmtRelative(l.next_follow_up_at)}</div></> : <span className="muted">—</span>}
                  </td>
                  <td data-label="Calls">{l.call_attempts}{l.last_contacted_at && <div className="muted small">{fmtRelative(l.last_contacted_at)}</div>}</td>
                  <td data-label="Source">{l.source ?? '—'}</td>
                  <td data-label="First seen" className="nowrap">{fmtDate(l.first_seen_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </form>

      <div className="pager">
        <span className="muted small">
          {total === 0 ? '0' : `${from + 1}–${Math.min(from + PAGE_SIZE, total)}`} of {total}
        </span>
        {page > 1 && <Link className="btn btn-sm" href={qs(sp, { page: String(page - 1) })}>← Previous</Link>}
        {from + PAGE_SIZE < total && <Link className="btn btn-sm" href={qs(sp, { page: String(page + 1) })}>Next →</Link>}
      </div>
    </>
  );
}
