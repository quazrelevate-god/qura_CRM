'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireMember, requireAdmin } from '@/lib/auth';
import { STAGES, LOST_REASONS, STAGE_META_EVENTS, CALL_OUTCOMES, CLOSED_STAGES, type Stage } from '@/lib/constants';
import { afterStageChange } from '@/lib/leads';
import { fromIstInput, toIstInput, istDayBounds } from '@/lib/format';
import { normPhone, validEmail } from '@/lib/phone';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function back(id: string, msg?: string, kind: 'ok' | 'error' = 'ok'): never {
  revalidatePath(`/leads/${id}`);
  redirect(msg ? `/leads/${id}?${kind}=${encodeURIComponent(msg)}` : `/leads/${id}`);
}

function quickFollowUp(kind: string): string | null {
  const now = Date.now();
  if (kind === '2h') return new Date(now + 2 * 3600000).toISOString();
  if (kind === 'tomorrow') return new Date(new Date(istDayBounds(1).start).getTime() + 11 * 3600000).toISOString(); // 11:00 IST
  if (kind === '3d') return new Date(new Date(istDayBounds(3).start).getTime() + 11 * 3600000).toISOString();
  if (kind === '1w') return new Date(new Date(istDayBounds(7).start).getTime() + 11 * 3600000).toISOString();
  return null;
}

export async function updateLead(fd: FormData) {
  await requireMember();
  const id = str(fd, 'lead_id');
  const supabase = await createClient();
  const { data: lead } = await supabase.from('leads').select('stage, next_follow_up_at').eq('id', id).maybeSingle();
  if (!lead) back(id, 'Lead not found', 'error');

  const stage = str(fd, 'stage');
  const lostReason = str(fd, 'lost_reason');
  const quick = str(fd, 'quick');
  const patch: Record<string, unknown> = {};

  if (stage && (STAGES as readonly string[]).includes(stage)) patch.stage = stage;
  if (stage === 'Lost') {
    if (!lostReason) back(id, 'Pick a lost reason before moving the lead to Lost.', 'error');
    patch.lost_reason = lostReason;
  } else if (stage) {
    patch.lost_reason = null;
  }
  if (lostReason && !(LOST_REASONS as readonly string[]).includes(lostReason)) back(id, 'Unknown lost reason', 'error');

  const owner = str(fd, 'owner_id');
  patch.owner_id = owner || null;

  if (quick === 'clear') patch.next_follow_up_at = null;
  else if (quick) patch.next_follow_up_at = quickFollowUp(quick);
  else {
    // The box shows the saved time to the minute; only write it when someone actually changed it,
    // so saving a stage or owner never logs a "Follow-up set" line.
    const typed = str(fd, 'next_follow_up_at');
    if (typed !== toIstInput(lead!.next_follow_up_at)) patch.next_follow_up_at = fromIstInput(typed);
  }
  if (CLOSED_STAGES.includes(stage as Stage) && lead!.next_follow_up_at) patch.next_follow_up_at = null;

  const { error } = await supabase.from('leads').update(patch).eq('id', id);
  if (error) back(id, 'Save failed: ' + error.message, 'error');

  if (stage && stage !== lead!.stage && STAGE_META_EVENTS[stage as Stage]) await afterStageChange(id, stage as Stage);
  back(id, 'Saved');
}

export async function logCall(fd: FormData) {
  const me = await requireMember();
  const id = str(fd, 'lead_id');
  const outcome = str(fd, 'outcome');
  const note = str(fd, 'note');
  const label = CALL_OUTCOMES.find((o) => o.value === outcome)?.label;
  if (!label) back(id, 'Pick a call outcome', 'error');

  const supabase = await createClient();
  const { data: lead } = await supabase.from('leads').select('stage, call_attempts, next_follow_up_at').eq('id', id).maybeSingle();
  if (!lead) back(id, 'Lead not found', 'error');

  const attempts = (lead!.call_attempts ?? 0) + 1;
  // A follow-up is set only when the caller fills the follow-up box. Logging a call never picks one by itself.
  const given = fromIstInput(str(fd, 'follow_up'));
  const patch: Record<string, unknown> = { call_attempts: attempts, last_contacted_at: new Date().toISOString() };
  const stage = lead!.stage as Stage;

  if (outcome === 'connected' || outcome === 'callback') {
    if (stage === 'New' || stage === 'Not reachable') patch.stage = 'Contacted';
  }
  if (['rnr', 'busy', 'not_reachable'].includes(outcome)) {
    if (attempts >= 3 && ['New', 'Contacted', 'Not reachable', 'Call scheduled'].includes(stage)) patch.stage = 'Not reachable';
  }
  if (outcome === 'wrong_number') {
    patch.stage = 'Lost';
    patch.lost_reason = 'Invalid number';
    if (lead!.next_follow_up_at) patch.next_follow_up_at = null;
  } else if (given) {
    patch.next_follow_up_at = given;
  }

  const summary = `Call — ${label} · attempt ${attempts}${note ? `\n${note}` : ''}`;
  const { error: aerr } = await supabase.from('activities').insert({
    lead_id: id, actor_id: me.id, type: 'call', summary, data: { outcome, attempt: attempts, note },
  });
  if (aerr) back(id, 'Could not log the call: ' + aerr.message, 'error');
  await supabase.from('leads').update(patch).eq('id', id);
  back(id, `Call logged (${label})`);
}

export async function addNote(fd: FormData) {
  const me = await requireMember();
  const id = str(fd, 'lead_id');
  const note = str(fd, 'note');
  if (!note) back(id, 'Write a note first', 'error');
  const supabase = await createClient();
  const { error } = await supabase.from('activities').insert({ lead_id: id, actor_id: me.id, type: 'note', summary: note });
  if (error) back(id, 'Could not save the note: ' + error.message, 'error');
  back(id, 'Note added');
}

/** Called from the WhatsApp card after it opens WhatsApp with a draft. Only notes it in the history. */
export async function logWhatsAppDraft(leadId: string, templateName: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireMember();
  if (!leadId || !message.trim()) return { ok: false, error: 'Nothing to log' };
  const supabase = await createClient();
  const { error } = await supabase.from('activities').insert({
    lead_id: leadId, actor_id: me.id, type: 'whatsapp',
    summary: `WhatsApp draft opened${templateName ? ` · ${templateName}` : ''}\n${message.trim()}`.slice(0, 4000),
    data: { template: templateName || null, message: message.trim(), via: 'whatsapp_link' },
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

export async function updateDetails(fd: FormData) {
  const me = await requireMember();
  const id = str(fd, 'lead_id');
  const supabase = await createClient();
  const { data: lead } = await supabase.from('leads').select('full_name, phone, email, city, state').eq('id', id).maybeSingle();
  if (!lead) back(id, 'Lead not found', 'error');

  const patch: Record<string, unknown> = {};
  const changes: string[] = [];
  const name = str(fd, 'full_name');
  const email = str(fd, 'email').toLowerCase();
  const city = str(fd, 'city');
  const state = str(fd, 'state');
  const phoneRaw = str(fd, 'phone');

  if (name && name !== lead!.full_name) { patch.full_name = name; changes.push(`name → ${name}`); }
  if (email !== (lead!.email ?? '')) {
    if (email && !validEmail(email)) back(id, 'That email looks wrong', 'error');
    patch.email = email || null; changes.push(`email → ${email || '(blank)'}`);
  }
  if (city !== (lead!.city ?? '')) { patch.city = city || null; changes.push(`city → ${city || '(blank)'}`); }
  if (state !== (lead!.state ?? '')) { patch.state = state || null; changes.push(`state → ${state || '(blank)'}`); }
  if (phoneRaw) {
    const p = normPhone(phoneRaw);
    if (p.stored !== lead!.phone) {
      const { data: clash } = await supabase.from('leads').select('id, lead_code').eq('phone', p.stored).neq('id', id).maybeSingle();
      if (clash) back(id, `That number already belongs to lead ${clash.lead_code}.`, 'error');
      patch.phone = p.stored; patch.phone_valid = p.valid; changes.push(`phone → ${p.stored}`);
    }
  }
  if (!changes.length) back(id, 'Nothing changed');

  const { error } = await supabase.from('leads').update(patch).eq('id', id);
  if (error) back(id, 'Save failed: ' + error.message, 'error');
  await supabase.from('activities').insert({ lead_id: id, actor_id: me.id, type: 'field_change', summary: `Details edited: ${changes.join(', ')}` });
  back(id, 'Details saved');
}

export async function setFlags(fd: FormData) {
  const me = await requireAdmin();
  const id = str(fd, 'lead_id');
  const field = str(fd, 'field');
  const value = str(fd, 'value') === 'true';
  if (!['archived', 'is_test'].includes(field)) back(id, 'Unknown setting', 'error');
  const supabase = await createClient();
  await supabase.from('leads').update({ [field]: value }).eq('id', id);
  if (field === 'is_test') {
    await supabase.from('activities').insert({ lead_id: id, actor_id: me.id, type: 'system', summary: value ? 'Marked as a test lead' : 'Unmarked as test lead' });
  }
  back(id, 'Updated');
}

export async function resendMeta(fd: FormData) {
  await requireAdmin();
  const id = str(fd, 'lead_id');
  const supabase = await createClient();
  const { data: lead } = await supabase.from('leads').select('stage, fee_paid_at, interview_at, enrolled_at').eq('id', id).maybeSingle();
  if (!lead) back(id, 'Lead not found', 'error');
  const reached: Stage[] = [];
  if (lead!.fee_paid_at || lead!.stage === 'Fee paid') reached.push('Fee paid');
  if (lead!.interview_at || lead!.stage === 'Interview scheduled') reached.push('Interview scheduled');
  if (lead!.enrolled_at || lead!.stage === 'Enrolled') reached.push('Enrolled');
  for (const s of reached) await afterStageChange(id, s);
  back(id, reached.length ? 'Checked and sent any missing Meta events' : 'No milestone reached yet');
}
