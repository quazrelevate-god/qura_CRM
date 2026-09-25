// One-time setup + health check. Only works with ?key=<SETUP_KEY>; returns 404 otherwise.
//   /api/setup?key=...           → checks the database, creates the first admin login if there is none
//   /api/setup?key=...&import=1  → also imports the bundled first 120 Google Sheet rows (safe to run again)
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase/admin';
import { toLoginEmail, displayLogin } from '@/lib/login';
import type { SheetRow } from '@/lib/sheetImport';
import { runSheetImport } from '@/lib/importEngine';
import sheetRows from '@/lib/seed/sheet_rows.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Makes sure there is an active admin. Reuses the login if it already exists (e.g. created before the
// tables were), otherwise creates it. Never touches a password once an admin exists.
async function ensureAdmin(db: SupabaseClient, user: string | undefined, pass: string | undefined): Promise<string> {
  const { data: admins, error } = await db.from('profiles').select('id').eq('role', 'admin').eq('active', true).limit(1);
  if (error) return `could not check: ${error.message}`;
  if (admins && admins.length) return 'already set up';
  if (!user || !pass) return 'no admin yet and no bootstrap credentials configured';

  const email = toLoginEmail(user);
  let authUser: { id: string } | null = null;
  for (let page = 1; page <= 25 && !authUser; page++) {
    const { data, error: listErr } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) return `could not list logins: ${listErr.message}`;
    authUser = data.users.find((u) => (u.email ?? '').toLowerCase() === email) ?? null;
    if (data.users.length < 200) break;
  }
  let created = false;
  if (!authUser) {
    const { data, error: createErr } = await db.auth.admin.createUser({
      email, password: pass, email_confirm: true, user_metadata: { full_name: 'Admin' },
    });
    if (createErr || !data.user) return `could not create: ${createErr?.message ?? 'unknown error'}`;
    authUser = data.user;
    created = true;
  }
  const { error: upErr } = await db
    .from('profiles')
    .upsert({ id: authUser.id, email, full_name: 'Admin', role: 'admin', active: true }, { onConflict: 'id' });
  if (upErr) return `login exists but its profile could not be saved: ${upErr.message}`;
  return `${created ? 'created' : 'activated'} — sign in as "${user}"`;
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (!process.env.SETUP_KEY || key !== process.env.SETUP_KEY) return new NextResponse('Not found', { status: 404 });

  const db = adminClient();
  const out: Record<string, unknown> = {};

  // A plain select (not a HEAD count): supabase-js reports a HEAD request on a missing table as success.
  const missing: string[] = [];
  for (const table of ['profiles', 'leads', 'submissions', 'activities']) {
    const { error } = await db.from(table).select('id').limit(1);
    if (error) missing.push(`${table}: ${error.message}`);
  }
  if (missing.length) {
    return NextResponse.json({ schema: 'missing — run 01_schema.sql in Supabase → SQL Editor first', detail: missing });
  }
  out.schema = 'ok';

  out.admin = await ensureAdmin(db, process.env.ADMIN_BOOTSTRAP_USERNAME, process.env.ADMIN_BOOTSTRAP_PASSWORD);

  if (req.nextUrl.searchParams.get('import') === '1') {
    try {
      out.import = await runSheetImport(db, sheetRows as SheetRow[], { dryRun: false });
    } catch (e) {
      out.import = { error: (e as Error).message };
    }
  }

  // one-off: Sheet notes that were dated in the future move to the person's last form time
  if (req.nextUrl.searchParams.get('repair') === '1') {
    const nowIso = new Date().toISOString();
    const { data: future, error: fErr } = await db.from('activities').select('id, lead_id, summary, occurred_at').eq('type', 'import_note').gt('occurred_at', nowIso);
    const fixed: string[] = [];
    for (const a of future ?? []) {
      const { data: lead } = await db.from('leads').select('last_submission_at, first_seen_at').eq('id', a.lead_id).maybeSingle();
      const base = new Date((lead?.last_submission_at ?? lead?.first_seen_at ?? nowIso) as string).getTime() + 60000;
      const when = new Date(Math.min(base, Date.now())).toISOString();
      const { error } = await db.from('activities').update({ occurred_at: when }).eq('id', a.id);
      if (!error) fixed.push(`${String(a.summary).slice(0, 60)} → ${when}`);
    }
    const { data: badLeads } = await db.from('leads').select('id').gt('last_contacted_at', nowIso);
    for (const l of badLeads ?? []) {
      const { data: last } = await db.from('activities').select('occurred_at').eq('lead_id', l.id).eq('type', 'import_note').order('occurred_at', { ascending: false }).limit(1).maybeSingle();
      await db.from('leads').update({ last_contacted_at: last?.occurred_at ?? null }).eq('id', l.id);
    }
    out.repair = fErr ? { error: fErr.message } : { notes_fixed: fixed, leads_fixed: (badLeads ?? []).length };
  }

  const [leadsQ, subsQ, actsQ, stagesQ, teamQ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('submissions').select('id', { count: 'exact', head: true }),
    db.from('activities').select('id', { count: 'exact', head: true }),
    db.from('leads').select('stage').limit(10000),
    db.from('profiles').select('email, role, active').order('created_at'),
  ]);
  const byStage: Record<string, number> = {};
  (stagesQ.data ?? []).forEach((r) => { byStage[r.stage] = (byStage[r.stage] ?? 0) + 1; });
  out.leads = leadsQ.error ? `error: ${leadsQ.error.message}` : leadsQ.count;
  out.submissions = subsQ.error ? `error: ${subsQ.error.message}` : subsQ.count;
  out.history_entries = actsQ.error ? `error: ${actsQ.error.message}` : actsQ.count;
  out.by_stage = byStage;
  out.team = (teamQ.data ?? []).map((t) => ({ login: displayLogin(t.email), role: t.role, active: t.active }));
  out.connections = {
    meta: !!process.env.META_ACCESS_TOKEN,
    meta_test_mode: !!process.env.META_TEST_EVENT_CODE,
    whatsapp: !!process.env.INTERAKT_API_KEY,
    application_url: process.env.APPLICATION_URL || null,
  };
  return NextResponse.json(out);
}
