'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth';
import { normPhone, leadCode, validEmail } from '@/lib/phone';
import { STAGES } from '@/lib/constants';
import { fromIstInput } from '@/lib/format';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (msg: string): never => redirect(`/leads/new?error=${encodeURIComponent(msg)}`);

export async function createLead(fd: FormData) {
  const me = await requireMember();
  const supabase = await createClient();

  const name = str(fd, 'full_name');
  const phone = normPhone(str(fd, 'phone'));
  const email = str(fd, 'email').toLowerCase();
  if (!name) fail('Name is required.');
  if (!phone.valid) fail('Enter a valid 10-digit Indian mobile number.');
  if (email && !validEmail(email)) fail('That email looks wrong.');

  const { data: dup } = await supabase.from('leads').select('id').eq('phone', phone.stored).maybeSingle();
  if (dup) redirect(`/leads/${dup.id}?error=${encodeURIComponent('This number is already in the CRM — here is the existing lead.')}`);

  const stage = STAGES.includes(str(fd, 'stage') as (typeof STAGES)[number]) ? str(fd, 'stage') : 'New';
  const now = new Date().toISOString();
  const { data: lead, error } = await supabase.from('leads').insert({
    lead_code: leadCode(phone, email),
    full_name: name,
    phone: phone.stored,
    phone_valid: true,
    email: email || null,
    city: str(fd, 'city') || null,
    state: str(fd, 'state') || null,
    source: str(fd, 'source') || 'Manual',
    stage,
    owner_id: str(fd, 'owner_id') || null,
    next_follow_up_at: fromIstInput(str(fd, 'follow_up')),
    first_seen_at: now,
    submissions_count: 0,
  }).select('id').single();
  if (error || !lead) fail('Could not add the lead: ' + (error?.message ?? 'unknown error'));

  await supabase.from('activities').insert({ lead_id: lead!.id, actor_id: me.id, type: 'created', summary: `Lead added manually (${str(fd, 'source') || 'Manual'})` });
  const note = str(fd, 'note');
  if (note) await supabase.from('activities').insert({ lead_id: lead!.id, actor_id: me.id, type: 'note', summary: note });
  redirect(`/leads/${lead!.id}?ok=${encodeURIComponent('Lead added')}`);
}
