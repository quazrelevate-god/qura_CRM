// Meta Conversions API — server-side events for the QURA dataset.
import { sha256 } from './phone';
import { PROGRAMME_NAME } from './constants';

export type LeadForMeta = {
  lead_code: string | null;
  full_name: string | null;
  phone: string | null;
  phone_valid: boolean | null;
  email: string | null;
  city: string | null;
  state: string | null;
  ip: string | null;
  user_agent: string | null;
  fbc: string | null;
  fbp: string | null;
  page_url: string | null;
  tier?: string | null;
  score?: number | null;
};

export const metaConfigured = () => !!(process.env.META_ACCESS_TOKEN && process.env.META_PIXEL_ID);

const low = (v: unknown) => String(v ?? '').trim().toLowerCase();
const placeKey = (v: unknown) => low(v).replace(/[^a-z]/g, '');

/** Stable event id: the same person + event always produces the same id, so Meta de-duplicates repeats. */
export function eventIdFor(eventName: string, key: string) {
  return `${eventName.toLowerCase()}_${sha256(key).slice(0, 16)}`;
}

export function personKey(lead: Pick<LeadForMeta, 'phone' | 'phone_valid' | 'email' | 'lead_code'>) {
  return (lead.phone_valid && lead.phone) || low(lead.email) || lead.lead_code || '';
}

export function buildUserData(lead: LeadForMeta) {
  const [firstName, ...rest] = String(lead.full_name ?? '').trim().split(/\s+/);
  const lastName = rest.join(' ');
  const email = low(lead.email);
  const ud: Record<string, unknown> = {
    ph: lead.phone_valid && lead.phone ? [sha256(lead.phone)] : undefined,
    em: email ? [sha256(email)] : undefined,
    fn: firstName ? [sha256(low(firstName))] : undefined,
    ln: lastName ? [sha256(low(lastName))] : undefined,
    ct: lead.city ? [sha256(placeKey(lead.city))] : undefined,
    st: lead.state ? [sha256(placeKey(lead.state))] : undefined,
    country: [sha256('in')],
    external_id: lead.lead_code ? [sha256(lead.lead_code)] : undefined,
    client_ip_address: lead.ip || undefined,
    client_user_agent: lead.user_agent || undefined,
    fbc: lead.fbc || undefined,
    fbp: lead.fbp || undefined,
  };
  Object.keys(ud).forEach((k) => ud[k] === undefined && delete ud[k]);
  return ud;
}

export function buildEvent(
  lead: LeadForMeta,
  eventName: string,
  opts: { eventKey?: string; value?: number; extra?: Record<string, unknown> } = {},
) {
  const userData = buildUserData(lead);
  const website = !!userData.client_user_agent; // Meta needs a browser user agent for 'website' events
  const event: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventIdFor(eventName, opts.eventKey || personKey(lead)),
    action_source: website ? 'website' : 'system_generated',
    user_data: userData,
    custom_data: {
      content_name: PROGRAMME_NAME,
      ...(lead.tier ? { lead_tier: lead.tier } : {}),
      ...(typeof lead.score === 'number' ? { lead_score: lead.score } : {}),
      ...(opts.value ? { value: opts.value, currency: 'INR' } : {}),
      ...(opts.extra ?? {}),
    },
  };
  if (website) event.event_source_url = lead.page_url || 'https://qurafilm.com/';
  return event;
}

export async function sendMetaEvents(events: Record<string, unknown>[]): Promise<{ ok: boolean; detail: string }> {
  if (!metaConfigured()) return { ok: false, detail: 'Meta not configured' };
  if (!events.length) return { ok: true, detail: 'nothing to send' };
  const version = process.env.META_API_VERSION || 'v23.0';
  const url = `https://graph.facebook.com/${version}/${process.env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(process.env.META_ACCESS_TOKEN!)}`;
  const body: Record<string, unknown> = { data: events };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    return { ok: res.ok, detail: res.ok ? text.slice(0, 200) : `HTTP ${res.status}: ${text.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
