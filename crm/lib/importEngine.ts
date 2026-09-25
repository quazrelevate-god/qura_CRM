// Brings rows from the Google Sheet into the CRM without ever duplicating anyone:
//  • new people are added with every form entry and note,
//  • people already in the CRM only get the form entries and notes they don't have yet,
//  • a stage your team changed by hand in the CRM is never overwritten.
// planImport() is pure (tested locally); runSheetImport() reads the CRM, plans, and writes.
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSheetImport, FOLLOW_UP_AT, type SheetRow, type ImportLead, type ImportSubmission, type ImportActivity } from './sheetImport';
import { testReason } from './sheetTests';

export type ExistingLead = {
  id: string; lead_code: string | null; phone: string | null; email: string | null; stage: string; lost_reason: string | null;
  tier: string | null; legacy: Record<string, unknown> | null; submissions_count: number; first_seen_at: string;
  last_submission_at: string | null; call_attempts: number; last_contacted_at: string | null; city: string | null;
  programme: string | null; next_follow_up_at: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null;
};
export type Snapshot = {
  leads: ExistingLead[];
  submissions: { lead_id: string; submitted_at: string; form_type: string | null }[]; // origin = sheet_import
  notes: { lead_id: string; summary: string }[];                                     // type = import_note
  humanStageLeadIds: string[];                                                        // stage changed by a person
};
export type ImportSummary = {
  rowsRead: number; testRowsSkipped: number; testRows: string[]; people: number;
  newLeads: number; updatedLeads: number; unchangedLeads: number;
  newFormEntries: number; newNotes: number; stageChanges: number; keptManualStages: number;
  followUpsSet: number; byStage: Record<string, number>; warnings: string[];
};
export type ImportPlan = {
  inserts: ImportLead[]; submissions: ImportSubmission[]; activities: ImportActivity[];
  updates: { id: string; patch: Record<string, unknown> }[]; summary: ImportSummary;
};

const RANK: Record<string, number> = {
  New: 0, 'Not reachable': 1, Contacted: 2, 'Call scheduled': 3, 'Qualified on call': 4, 'Application link sent': 5,
  'Fee paid': 6, 'Entrance exam done': 7, 'Interview scheduled': 8, 'Interview done': 9, 'Offer made': 10, Enrolled: 11,
};
const HIGH_INTENT = new Set(['Application link sent', 'Fee paid', 'Entrance exam done', 'Interview scheduled']);
const minute = (iso: string) => new Date(iso).toISOString().slice(0, 16);
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
const earlier = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

export function planImport(rows: SheetRow[], snap: Snapshot, nowIso = new Date().toISOString()): ImportPlan {
  const warnings: string[] = [];
  const tests = rows.filter((r) => testReason(r));
  const real = rows.filter((r) => !testReason(r));
  const built = buildSheetImport(real, nowIso);

  const byId = new Map(snap.leads.map((l) => [l.id, l]));
  const byPhone = new Map(snap.leads.filter((l) => l.phone).map((l) => [l.phone!, l]));
  const byEmail = new Map(snap.leads.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l]));
  const human = new Set(snap.humanStageLeadIds);
  const takenCodes = new Set(snap.leads.map((l) => l.lead_code).filter(Boolean) as string[]);
  const takenPhones = new Set(snap.leads.map((l) => l.phone).filter(Boolean) as string[]);

  const subsOf = new Map<string, ImportSubmission[]>();
  for (const s of built.submissions) (subsOf.get(s.lead_id) ?? subsOf.set(s.lead_id, []).get(s.lead_id)!).push(s);
  const actsOf = new Map<string, ImportActivity[]>();
  for (const a of built.activities) (actsOf.get(a.lead_id) ?? actsOf.set(a.lead_id, []).get(a.lead_id)!).push(a);
  const count = <T>(xs: T[], key: (x: T) => string) => xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>());
  const haveSubs = new Map<string, Map<string, number>>();
  for (const s of snap.submissions) {
    const m = haveSubs.get(s.lead_id) ?? haveSubs.set(s.lead_id, new Map()).get(s.lead_id)!;
    const k = `${minute(s.submitted_at)}|${s.form_type ?? ''}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const haveNotes = new Map<string, Map<string, number>>();
  for (const n of snap.notes) {
    const m = haveNotes.get(n.lead_id) ?? haveNotes.set(n.lead_id, new Map()).get(n.lead_id)!;
    m.set(n.summary, (m.get(n.summary) ?? 0) + 1);
  }

  const plan: ImportPlan = { inserts: [], submissions: [], activities: [], updates: [], summary: {} as ImportSummary };
  let unchanged = 0, newNotes = 0, stageChanges = 0, keptManual = 0, followUps = 0;
  const byStage: Record<string, number> = {};

  for (const lead of built.leads) {
    const phones = [lead.phone, ...((lead.legacy['Other phones'] as string[] | undefined) ?? [])].filter(Boolean) as string[];
    const emails = [lead.email, ...((lead.legacy['Other emails'] as string[] | undefined) ?? [])].filter(Boolean) as string[];
    const matches = new Set<ExistingLead>();
    const direct = byId.get(lead.id);
    if (direct) matches.add(direct);
    for (const p of phones) { const m = byPhone.get(p); if (m) matches.add(m); }
    if (!matches.size) for (const e of emails) { const m = byEmail.get(e.toLowerCase()); if (m) matches.add(m); }
    const target = direct ?? [...matches][0];
    if (matches.size > 1) warnings.push(`${lead.full_name}: matches ${matches.size} leads already in the CRM (${[...matches].map((m) => m.lead_code).join(', ')}); added to ${target.lead_code}.`);
    const subs = subsOf.get(lead.id) ?? [];
    const acts = actsOf.get(lead.id) ?? [];

    // ---------- someone new ----------
    if (!target) {
      let code = lead.lead_code;
      for (let n = 9; takenCodes.has(code); n++) code = lead.lead_code + lead.id.replace(/-/g, '').slice(0, n - 8).toUpperCase();
      takenCodes.add(code);
      let phone = lead.phone;
      if (phone && takenPhones.has(phone)) { warnings.push(`${lead.full_name}: phone ${phone} is already used by another lead — saved without it.`); phone = null; }
      if (phone) takenPhones.add(phone);
      const closed = lead.stage === 'Lost' || lead.stage === 'Enrolled';
      const hot = HIGH_INTENT.has(lead.stage) || (lead.tier === 'Hot' && !closed);
      const followUp = lead.next_follow_up_at ?? (hot ? FOLLOW_UP_AT : null);
      if (followUp && !lead.next_follow_up_at) {
        followUps++;
        acts.push({ lead_id: lead.id, actor_id: null, type: 'system', summary: 'Follow-up set for 25 Sep, 11 AM — high intent in the Sheet notes', occurred_at: nowIso });
      }
      plan.inserts.push({ ...lead, lead_code: code, phone, next_follow_up_at: followUp });
      plan.submissions.push(...subs);
      plan.activities.push(...acts);
      byStage[lead.stage] = (byStage[lead.stage] ?? 0) + 1;
      continue;
    }

    // ---------- already in the CRM: add only what's missing ----------
    const id = target.id;
    const have = new Map(haveSubs.get(id) ?? []);
    const newSubs: ImportSubmission[] = [];
    for (const s of subs) {
      const k = `${minute(s.submitted_at)}|${s.form_type}`;
      const n = have.get(k) ?? 0;
      if (n > 0) have.set(k, n - 1); else newSubs.push({ ...s, lead_id: id });
    }
    const newActs: ImportActivity[] = [];
    const subActs = acts.filter((a) => a.type === 'submission');
    for (const s of newSubs) {
      const i = subActs.findIndex((a) => a.occurred_at === s.submitted_at && a.summary.startsWith(`Form submitted (${s.form_type})`));
      if (i >= 0) newActs.push({ ...subActs.splice(i, 1)[0], lead_id: id });
    }
    const haveN = new Map(haveNotes.get(id) ?? []);
    for (const a of acts.filter((x) => x.type === 'import_note')) {
      const n = haveN.get(a.summary) ?? 0;
      if (n > 0) haveN.set(a.summary, n - 1); else newActs.push({ ...a, lead_id: id });
    }
    const addedNotes = newActs.filter((a) => a.type === 'import_note').length;

    const patch: Record<string, unknown> = {};
    if (newSubs.length) {
      patch.submissions_count = (target.submissions_count ?? 0) + newSubs.length;
      patch.last_submission_at = later(target.last_submission_at, lead.last_submission_at);
      const first = earlier(target.first_seen_at, lead.first_seen_at);
      if (first !== target.first_seen_at) patch.first_seen_at = first;
    }
    if (newSubs.length || addedNotes) {
      const oldLegacy = target.legacy ?? {};
      const oldNotes = (oldLegacy['Sheet notes'] as string[] | undefined) ?? [];
      const allNotes = [...oldNotes, ...((lead.legacy['Sheet notes'] as string[] | undefined) ?? []).filter((n) => !oldNotes.includes(n))];
      patch.legacy = { ...oldLegacy, ...lead.legacy, ...(allNotes.length ? { 'Sheet notes': allNotes } : {}), 'Sheet rows merged': Math.max(Number(oldLegacy['Sheet rows merged'] ?? 0), Number(lead.legacy['Sheet rows merged'] ?? 0)) };
    }
    if (addedNotes) {
      patch.call_attempts = (target.call_attempts ?? 0) + addedNotes;
      patch.last_contacted_at = later(target.last_contacted_at, lead.last_contacted_at);
    }
    for (const k of ['email', 'city', 'programme', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const) {
      const v = (lead as unknown as Record<string, string | null>)[k];
      if (!target[k] && v) patch[k] = v;
    }
    // stage: follow the Sheet only while nobody has moved this lead by hand, and never step back from real progress
    if (newSubs.length || addedNotes) {
      const fromSheet = !!target.legacy?.['Imported from'] || target.stage === 'New';
      if (human.has(id)) { if (lead.stage !== target.stage) keptManual++; }
      else if (fromSheet && lead.stage !== target.stage && !((RANK[target.stage] ?? -1) >= 6 && (RANK[lead.stage] ?? -1) < RANK[target.stage])) {
        patch.stage = lead.stage;
        patch.lost_reason = lead.lost_reason;
        if (lead.tier) patch.tier = lead.tier;
        stageChanges++;
      }
    }
    if (!Object.keys(patch).length && !newActs.length) { unchanged++; byStage[target.stage] = (byStage[target.stage] ?? 0) + 1; continue; }
    if (newSubs.length || addedNotes)
      newActs.push({ lead_id: id, actor_id: null, type: 'system', occurred_at: nowIso,
        summary: `Updated from the Google Sheet: ${newSubs.length} new form entr${newSubs.length === 1 ? 'y' : 'ies'}, ${addedNotes} new note${addedNotes === 1 ? '' : 's'}` });
    newNotes += addedNotes;
    plan.submissions.push(...newSubs);
    plan.activities.push(...newActs);
    if (Object.keys(patch).length) plan.updates.push({ id, patch });
    const st = (patch.stage as string) ?? target.stage;
    byStage[st] = (byStage[st] ?? 0) + 1;
  }

  plan.summary = {
    rowsRead: rows.length, testRowsSkipped: tests.length,
    testRows: tests.map((r) => `${r.name || '(no name)'} · ${r.email || r.phone} · ${testReason(r)}`),
    people: built.leads.length, newLeads: plan.inserts.length, updatedLeads: plan.updates.length, unchangedLeads: unchanged,
    newFormEntries: plan.submissions.length, newNotes: newNotes + plan.inserts.reduce((n, l) => n + ((l.legacy['Sheet notes'] as string[] | undefined)?.length ?? 0), 0),
    stageChanges, keptManualStages: keptManual, followUpsSet: followUps, byStage, warnings,
  };
  return plan;
}

// ---------------------------------------------------------------------------------------------
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function loadSnapshot(db: SupabaseClient): Promise<Snapshot> {
  const leadCols = 'id, lead_code, phone, email, stage, lost_reason, tier, legacy, submissions_count, first_seen_at, last_submission_at, call_attempts, last_contacted_at, city, programme, next_follow_up_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term';
  const [leads, submissions, notes, human] = await Promise.all([
    readAll<ExistingLead>((a, b) => db.from('leads').select(leadCols).order('id').range(a, b)),
    readAll<Snapshot['submissions'][number]>((a, b) => db.from('submissions').select('lead_id, submitted_at, form_type').eq('origin', 'sheet_import').order('id').range(a, b)),
    readAll<Snapshot['notes'][number]>((a, b) => db.from('activities').select('lead_id, summary').eq('type', 'import_note').order('id').range(a, b)),
    readAll<{ lead_id: string }>((a, b) => db.from('activities').select('lead_id').eq('type', 'stage_change').not('actor_id', 'is', null).order('id').range(a, b)),
  ]);
  return { leads, submissions, notes, humanStageLeadIds: [...new Set(human.map((h) => h.lead_id))] };
}

async function inChunks<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

export async function runSheetImport(db: SupabaseClient, rows: SheetRow[], opts: { dryRun: boolean }): Promise<ImportSummary> {
  const snap = await loadSnapshot(db);
  const plan = planImport(rows, snap);
  if (opts.dryRun) return plan.summary;

  await inChunks(plan.inserts, 250, async (chunk) => {
    const { error } = await db.from('leads').upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error('Saving new leads failed: ' + error.message);
  });
  await inChunks(plan.submissions, 500, async (chunk) => {
    const { error } = await db.from('submissions').insert(chunk);
    if (error) throw new Error('Saving form entries failed: ' + error.message);
  });
  await inChunks(plan.activities, 1000, async (chunk) => {
    const { error } = await db.from('activities').insert(chunk);
    if (error) throw new Error('Saving history failed: ' + error.message);
  });
  await inChunks(plan.updates, 10, async (chunk) => {
    const results = await Promise.all(chunk.map((u) => db.from('leads').update(u.patch).eq('id', u.id)));
    const bad = results.find((r) => r.error);
    if (bad?.error) throw new Error('Updating leads failed: ' + bad.error.message);
  });
  return plan.summary;
}
