import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const COLUMNS: [string, string][] = [
  ['lead_code', 'Lead ID'], ['full_name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['city', 'City'], ['state', 'State'],
  ['stage', 'Stage'], ['lost_reason', 'Lost reason'], ['tier', 'Tier'], ['score', 'Score'], ['owner', 'Owner'],
  ['next_follow_up_at', 'Next follow-up'], ['call_attempts', 'Call attempts'], ['last_contacted_at', 'Last contacted'],
  ['source', 'Source'], ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_campaign', 'utm_campaign'],
  ['utm_content', 'utm_content'], ['utm_term', 'utm_term'], ['first_seen_at', 'First seen'], ['last_submission_at', 'Last submission'],
  ['submissions_count', 'Submissions'], ['age_band', 'Age'], ['current_status', 'Status now'], ['english', 'English'],
  ['relocate', 'Relocate'], ['start_pref', 'Start'], ['funding', 'Funding'], ['focus', 'Craft'], ['experience', 'Experience'],
  ['fee_paid_at', 'Fee paid at'], ['interview_at', 'Interview at'], ['enrolled_at', 'Enrolled at'],
];

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse('Not signed in', { status: 401 });
  const { data: me } = await supabase.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle();
  if (!me?.active || me.role !== 'admin') return new NextResponse('Admins only', { status: 403 });

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('leads')
      .select('*, owner:profiles!leads_owner_id_fkey(full_name)')
      .eq('archived', false)
      .order('first_seen_at', { ascending: false })
      .range(from, from + 999);
    if (error) return new NextResponse(error.message, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const lines = [COLUMNS.map(([, h]) => h).join(',')];
  for (const r of rows) {
    const row = { ...r, owner: (r.owner as { full_name?: string } | null)?.full_name ?? '' };
    lines.push(COLUMNS.map(([k]) => esc((row as Record<string, unknown>)[k])).join(','));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse('﻿' + lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="qura-leads-${stamp}.csv"`,
    },
  });
}
