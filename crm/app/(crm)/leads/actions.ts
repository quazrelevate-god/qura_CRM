'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth';
import { STAGES, STAGE_META_EVENTS, type Stage } from '@/lib/constants';
import { afterStageChange } from '@/lib/leads';

function safeBack(v: FormDataEntryValue | null) {
  const s = String(v ?? '/leads');
  return s.startsWith('/leads') ? s : '/leads';
}

export async function bulkUpdate(formData: FormData) {
  await requireMember();
  const back = safeBack(formData.get('back'));
  const ids = formData.getAll('ids').map(String).filter(Boolean);
  const ownerId = String(formData.get('owner_id') ?? '');
  const stage = String(formData.get('stage') ?? '');
  const lostReason = String(formData.get('lost_reason') ?? '');
  const sep = back.includes('?') ? '&' : '?';

  if (!ids.length) redirect(`${back}${sep}done=${encodeURIComponent('Tick at least one lead first.')}`);
  if (!ownerId && !stage) redirect(`${back}${sep}done=${encodeURIComponent('Pick an owner or a stage to apply.')}`);
  if (stage === 'Lost' && !lostReason) redirect(`${back}${sep}done=${encodeURIComponent('Choose a lost reason when moving leads to Lost.')}`);

  const patch: Record<string, unknown> = {};
  if (ownerId) patch.owner_id = ownerId === 'none' ? null : ownerId;
  if (stage && (STAGES as readonly string[]).includes(stage)) {
    patch.stage = stage;
    if (stage === 'Lost') patch.lost_reason = lostReason;
  }

  const supabase = await createClient();
  const { error } = await supabase.from('leads').update(patch).in('id', ids);
  if (error) redirect(`${back}${sep}done=${encodeURIComponent('Update failed: ' + error.message)}`);

  if (stage && STAGE_META_EVENTS[stage as Stage]) {
    for (const id of ids) await afterStageChange(id, stage as Stage);
  }
  revalidatePath('/leads');
  redirect(`${back}${sep}done=${encodeURIComponent(`Updated ${ids.length} lead${ids.length === 1 ? '' : 's'}.`)}`);
}
