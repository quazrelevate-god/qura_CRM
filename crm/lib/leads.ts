import { adminClient } from './supabase/admin';
import { buildEvent, sendMetaEvents, metaConfigured, type LeadForMeta } from './meta';
import { STAGE_META_EVENTS, type Stage } from './constants';

export const LEAD_META_COLUMNS =
  'id, lead_code, full_name, phone, phone_valid, email, city, state, ip, user_agent, fbc, fbp, page_url, tier, score, meta_events, stage, fee_paid_at, interview_at, enrolled_at, is_test';

type LeadRow = LeadForMeta & {
  id: string;
  meta_events: Record<string, string> | null;
  stage: string;
  fee_paid_at: string | null;
  interview_at: string | null;
  enrolled_at: string | null;
  is_test: boolean;
};

/** Write a system entry (no person) into a lead's history. */
export async function logSystem(leadId: string, type: string, summary: string, data: Record<string, unknown> = {}) {
  await adminClient().from('activities').insert({ lead_id: leadId, actor_id: null, type, summary, data });
}

/**
 * Called after a lead moves to a new stage. Stamps the milestone date and sends the matching
 * Meta event once (Fee paid → SubmitApplication, Interview scheduled → Schedule, Enrolled → Purchase).
 */
export async function afterStageChange(leadId: string, newStage: Stage, opts: { eventKey?: string } = {}) {
  const cfg = STAGE_META_EVENTS[newStage];
  if (!cfg) return;
  const db = adminClient();
  const { data } = await db.from('leads').select(LEAD_META_COLUMNS).eq('id', leadId).maybeSingle();
  const lead = data as LeadRow | null;
  if (!lead) return;

  const patch: Record<string, unknown> = {};
  if (!lead[cfg.stamp]) patch[cfg.stamp] = new Date().toISOString();

  const already = (lead.meta_events ?? {})[cfg.event];
  if (!already && !lead.is_test) {
    if (metaConfigured()) {
      const event = buildEvent(lead, cfg.event, {
        eventKey: opts.eventKey ?? `${lead.lead_code}_${cfg.event}`,
        value: cfg.value,
      });
      const result = await sendMetaEvents([event]);
      if (result.ok) patch.meta_events = { ...(lead.meta_events ?? {}), [cfg.event]: new Date().toISOString() };
      await logSystem(leadId, 'meta_event',
        result.ok ? `Meta: ${cfg.event}${cfg.value ? ` ₹${cfg.value.toLocaleString('en-IN')}` : ''} sent` : `Meta: ${cfg.event} failed — ${result.detail}`,
        { event: cfg.event, ok: result.ok, detail: result.detail });
    } else {
      await logSystem(leadId, 'meta_event', `Meta: ${cfg.event} not sent (Meta not connected yet)`, { event: cfg.event, ok: false });
    }
  }
  if (Object.keys(patch).length) await db.from('leads').update(patch).eq('id', leadId);
}
