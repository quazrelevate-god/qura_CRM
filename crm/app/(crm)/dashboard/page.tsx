import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth';
import { STAGES, TIERS, CLOSED_STAGES, type Stage } from '@/lib/constants';
import { fmtDateTime, istDayBounds } from '@/lib/format';

export const dynamic = 'force-dynamic';

type L = {
  id: string; stage: Stage; tier: string | null; owner_id: string | null; source: string | null;
  first_seen_at: string; next_follow_up_at: string | null; fee_paid_at: string | null; enrolled_at: string | null;
};

const RANGES = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: 0 },
];

function Bars({ rows }: { rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="bars">
      {rows.map(([label, n]) => (
        <div className="bar" key={label}>
          <span>{label}</span>
          <span className="track"><span className="fill" style={{ width: `${(n / max) * 100}%`, display: 'block' }} /></span>
          <span className="v">{n}</span>
        </div>
      ))}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range = '30' } = await searchParams;
  await requireMember();
  const supabase = await createClient();

  const leads: L[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('leads')
      .select('id, stage, tier, owner_id, source, first_seen_at, next_follow_up_at, fee_paid_at, enrolled_at')
      .eq('archived', false).eq('is_test', false)
      .range(from, from + 999);
    leads.push(...((data ?? []) as L[]));
    if (!data || data.length < 1000) break;
  }

  const r = RANGES.find((x) => x.key === range) ?? RANGES[1];
  const since = r.days ? Date.now() - r.days * 86400000 : 0;
  const inRange = leads.filter((l) => new Date(l.first_seen_at).getTime() >= since);

  const [{ data: owners }, { data: calls }, { data: recent }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, active').order('full_name'),
    supabase.from('activities').select('actor_id').eq('type', 'call').gte('occurred_at', new Date(Date.now() - 7 * 86400000).toISOString()).limit(5000),
    supabase.from('activities').select('id, summary, occurred_at, lead_id, actor:profiles!activities_actor_id_fkey(full_name), lead:leads!activities_lead_id_fkey(full_name)').neq('type', 'meta_event').order('occurred_at', { ascending: false }).limit(15),
  ]);

  const now = Date.now();
  const { end } = istDayBounds();
  const open = leads.filter((l) => !CLOSED_STAGES.includes(l.stage));
  const overdue = open.filter((l) => l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() < now);
  const dueToday = open.filter((l) => l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() >= now && new Date(l.next_follow_up_at).getTime() < new Date(end).getTime());
  const count = <T,>(arr: T[], key: (x: T) => string) => arr.reduce<Record<string, number>>((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

  const byStage = count(inRange, (l) => l.stage);
  const byTier = count(inRange, (l) => l.tier ?? 'Not scored');
  const bySource = Object.entries(count(inRange, (l) => l.source ?? 'Unknown')).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const callsBy = count(calls ?? [], (c) => c.actor_id ?? 'system');

  const repRows = (owners ?? []).filter((o) => o.active).map((o) => {
    const mine = open.filter((l) => l.owner_id === o.id);
    return {
      id: o.id,
      name: o.full_name || o.email,
      open: mine.length,
      overdue: mine.filter((l) => overdue.includes(l)).length,
      today: mine.filter((l) => dueToday.includes(l)).length,
      calls: callsBy[o.id] ?? 0,
    };
  });
  const unassigned = open.filter((l) => !l.owner_id).length;

  type RecentRow = { id: number; summary: string; occurred_at: string; lead_id: string; actor: { full_name: string } | null; lead: { full_name: string } | null };

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <div className="views" style={{ margin: 0 }}>
          {RANGES.map((x) => <Link key={x.key} href={`/dashboard?range=${x.key}`} className={r.key === x.key ? 'active' : ''}>{x.label}</Link>)}
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><div className="n">{inRange.length}</div><div className="l">New leads · {r.label.toLowerCase()}</div></div>
        <div className="tile"><div className="n">{inRange.filter((l) => l.tier === 'Hot').length}</div><div className="l">Hot leads · {r.label.toLowerCase()}</div></div>
        <div className="tile"><Link href="/leads?view=today"><div className="n">{dueToday.length}</div><div className="l">Follow-ups due today</div></Link></div>
        <div className="tile"><Link href="/leads?view=overdue"><div className="n" style={{ color: overdue.length ? 'var(--bad)' : undefined }}>{overdue.length}</div><div className="l">Overdue follow-ups</div></Link></div>
        <div className="tile"><Link href="/leads?view=unassigned"><div className="n">{unassigned}</div><div className="l">Open & unassigned</div></Link></div>
        <div className="tile"><div className="n">{leads.filter((l) => l.fee_paid_at || ['Fee paid', 'Entrance exam done', 'Interview scheduled', 'Interview done', 'Offer made', 'Enrolled'].includes(l.stage)).length}</div><div className="l">Fee paid (all time)</div></div>
        <div className="tile"><div className="n">{leads.filter((l) => l.stage === 'Enrolled').length}</div><div className="l">Enrolled (all time)</div></div>
      </div>

      <div className="dash-grid">
        <div className="card">
          <h2>Leads by stage · {r.label.toLowerCase()}</h2>
          <Bars rows={STAGES.map((s) => [s, byStage[s] ?? 0] as [string, number])} />
        </div>
        <div className="stack">
          <div className="card">
            <h2>By tier · {r.label.toLowerCase()}</h2>
            <Bars rows={[...TIERS, 'Not scored'].map((t) => [t, byTier[t] ?? 0] as [string, number])} />
          </div>
          <div className="card">
            <h2>By source · {r.label.toLowerCase()}</h2>
            {bySource.length ? <Bars rows={bySource} /> : <p className="muted">No leads in this period.</p>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Team</h2>
        <table className="table">
          <thead><tr><th>Rep</th><th>Open leads</th><th>Due today</th><th>Overdue</th><th>Calls logged (7 days)</th></tr></thead>
          <tbody>
            {repRows.map((x) => (
              <tr key={x.id}>
                <td className="name"><Link href={`/leads?owner=${x.id}`}>{x.name}</Link></td>
                <td data-label="Open">{x.open}</td>
                <td data-label="Due today">{x.today}</td>
                <td data-label="Overdue" className={x.overdue ? 'due-over' : ''}>{x.overdue}</td>
                <td data-label="Calls (7d)">{x.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Latest activity</h2>
        <ul className="timeline">
          {((recent ?? []) as unknown as RecentRow[]).map((a) => (
            <li key={a.id}>
              <div className="dot" aria-hidden>•</div>
              <div>
                <div><Link href={`/leads/${a.lead_id}`}><strong>{a.lead?.full_name ?? 'Lead'}</strong></Link> — <span className="body">{a.summary.split('\n')[0]}</span></div>
                <div className="meta">{a.actor?.full_name ?? 'System'} · {fmtDateTime(a.occurred_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
