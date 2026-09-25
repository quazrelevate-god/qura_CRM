import { NextResponse, after, type NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { scoreLead } from '@/lib/scoring';
import { leadCode } from '@/lib/phone';
import { buildEvent, eventIdFor, personKey, sendMetaEvents, metaConfigured } from '@/lib/meta';
import { sendTemplate, interaktConfigured, applicationLink } from '@/lib/interakt';
import { logSystem } from '@/lib/leads';
import { firstName } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

// [form field, leads column] for the application answers
const ANSWER_FIELDS = [
  ['age_band', 'age_band'], ['current_status', 'current_status'], ['looking_for', 'looking_for'],
  ['english', 'english'], ['relocate', 'relocate'], ['start', 'start_pref'], ['funding', 'funding'],
  ['parents', 'parents'], ['focus', 'focus'], ['experience', 'experience'],
  ['portfolio_link', 'portfolio_link'], ['why', 'why'],
] as const;

type ExistingLead = {
  id: string; lead_code: string; full_name: string | null; stage: string; submissions_count: number; tier: string | null;
  archived: boolean; is_test: boolean;
} & Record<(typeof ANSWER_FIELDS)[number][1], string | null>;

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const list = (process.env.ALLOWED_ORIGINS || 'https://qurafilm.com,https://www.qurafilm.com')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*') || list.includes(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]*qura[a-z0-9-]*\.vercel\.app$/i.test(origin)) return origin; // website preview deployments
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = allowedOrigin(origin);
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function sourceLabel(b: Record<string, unknown>): string {
  const s = clean(b.utm_source).toLowerCase();
  if (/insta|^ig$/.test(s)) return 'Instagram';
  if (/facebook|^fb$/.test(s)) return 'Facebook';
  if (/meta/.test(s) || clean(b.fbclid)) return 'Meta Ads';
  if (/google/.test(s)) return 'Google';
  if (/youtube|^yt$/.test(s)) return 'YouTube';
  if (s) return clean(b.utm_source);
  return 'Website';
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req.headers.get('origin'));
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers });
  }

  const scoreOpts = { testEventCode: process.env.META_TEST_EVENT_CODE };
  let s = scoreLead(b, scoreOpts);
  const name = clean(b.full_name);
  if (!name && !s.phone.local && !s.email) {
    return NextResponse.json({ ok: false, error: 'Missing contact details' }, { status: 400, headers });
  }

  const db = adminClient();
  const now = new Date().toISOString();
  const ip = clean(req.headers.get('x-forwarded-for')).split(',')[0].trim() || clean(req.headers.get('x-real-ip'));
  const userAgent = clean(b.user_agent) || clean(req.headers.get('user-agent'));
  const fbclid = clean(b.fbclid);
  const fbc = clean(b.fbc) || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : '');

  const attribution = {
    utm_source: clean(b.utm_source) || null,
    utm_medium: clean(b.utm_medium) || null,
    utm_campaign: clean(b.utm_campaign) || null,
    utm_content: clean(b.utm_content) || null,
    utm_term: clean(b.utm_term) || null,
    fbclid: fbclid || null,
    fbc: fbc || null,
    fbp: clean(b.fbp) || null,
    ip: ip || null,
    user_agent: userAgent || null,
    page_url: clean(b.page_url) || null,
  };

  // --- find the same person (phone first, then email) ---
  const existingCols = `id, lead_code, full_name, stage, submissions_count, tier, archived, is_test, ${ANSWER_FIELDS.map(([, col]) => col).join(', ')}`;
  let existing: ExistingLead | null = null;
  if (s.phone.stored) {
    const { data } = await db.from('leads').select(existingCols).eq('phone', s.phone.stored).maybeSingle();
    existing = data as ExistingLead | null;
  }
  if (!existing && s.email) {
    const { data } = await db.from('leads').select(existingCols).eq('email', s.email).order('created_at').limit(1).maybeSingle();
    existing = data as ExistingLead | null;
  }

  // A repeat form (e.g. "Download prospectus" after a full application) only adds what's new:
  // earlier answers are kept and the lead is scored on everything we know, so it isn't downgraded.
  // Spam and test checks still look at this submission only.
  const src: Record<string, unknown> = { ...b };
  if (existing) {
    let filled = false;
    for (const [key, col] of ANSWER_FIELDS) {
      if (!clean(b[key]) && existing[col]) { src[key] = existing[col]; filled = true; }
    }
    if (filled) s = scoreLead(src, scoreOpts);
  }
  const answers = Object.fromEntries(ANSWER_FIELDS.map(([key, col]) => [col, clean(src[key]) || null]));
  const ownAnswers = Object.fromEntries(ANSWER_FIELDS.map(([key, col]) => [col, clean(b[key]) || null])); // this form only
  const personName = name || existing?.full_name || '';

  const scored = {
    full_name: name,
    email: s.email || null,
    city: clean(b.city) || null,
    state: clean(b.state) || null,
    ...answers,
    score: s.score,
    tier: s.tier,
    knockouts: s.knockouts,
    flags: s.flags,
    intent: clean(b.intent) || 'apply',
    last_submission_at: now,
  };

  let leadId: string;
  let code: string;
  if (existing) {
    leadId = existing.id;
    code = existing.lead_code;
    // contact fields: never blank out what we already have
    const keep = Object.fromEntries(
      Object.entries(scored).filter(([k, v]) => !['full_name', 'email', 'city', 'state'].includes(k) || (v !== null && v !== '')),
    );
    const patch: Record<string, unknown> = {
      ...keep,
      submissions_count: (existing.submissions_count ?? 0) + 1,
      // refresh click IDs so Meta can match the latest visit
      ...(attribution.fbc ? { fbc: attribution.fbc } : {}),
      ...(attribution.fbp ? { fbp: attribution.fbp } : {}),
      ...(attribution.ip ? { ip: attribution.ip } : {}),
      ...(attribution.user_agent ? { user_agent: attribution.user_agent } : {}),
    };
    if (existing.archived && !s.isSpam) patch.archived = false;
    if (!s.isTest && existing.is_test) patch.is_test = false;
    await db.from('leads').update(patch).eq('id', leadId);
  } else {
    code = leadCode(s.phone, s.email);
    const { data, error } = await db.from('leads').insert({
      lead_code: code,
      phone: s.phone.stored || null,
      phone_valid: s.phone.valid,
      ...scored,
      ...attribution,
      source: sourceLabel(b),
      first_seen_at: now,
      submissions_count: 1,
      is_test: s.isTest,
      archived: s.isSpam,
    }).select('id, lead_code').single();
    if (error || !data) {
      console.error('intake insert failed', error);
      return NextResponse.json({ ok: false, error: 'Could not save lead' }, { status: 500, headers });
    }
    leadId = data.id;
    code = data.lead_code;
    await logSystem(leadId, 'created', `Lead created from the website form (${sourceLabel(b)})`);
  }

  await db.from('submissions').insert({
    lead_id: leadId,
    submitted_at: now,
    origin: 'website',
    form_type: 'Application form',
    intent: clean(b.intent) || 'apply',
    message: ownAnswers.why,
    answers: { ...ownAnswers, full_name: name, phone: s.phone.stored, email: s.email, city: scored.city, state: scored.state, seconds_on_form: s.secondsOnForm },
    attribution,
  });
  await logSystem(leadId, 'submission',
    `Form submitted (${clean(b.intent) || 'apply'}) — ${s.tier}, score ${s.score}${s.knockouts.length ? ` · ${s.knockouts.join(', ')}` : ''}${s.flags.length ? ` · ${s.flags.join(', ')}` : ''}`,
    { score: s.score, tier: s.tier, breakdown: s.breakdown, knockouts: s.knockouts, flags: s.flags });

  // --- what the website shows next ---
  const leadForMeta = {
    lead_code: code, full_name: personName, phone: s.phone.stored, phone_valid: s.phone.valid, email: s.email,
    city: scored.city, state: scored.state, ip: attribution.ip, user_agent: attribution.user_agent,
    fbc: attribution.fbc, fbp: attribution.fbp, page_url: attribution.page_url, tier: s.tier, score: s.score,
  };
  const pKey = personKey(leadForMeta);
  let nextUrl = '';
  if (s.tier === 'Hot') nextUrl = applicationLink({ full_name: personName, email: s.email, phone: s.phone.stored, lead_code: code });
  else if (s.knockouts.includes('Wants online / cannot relocate')) nextUrl = process.env.ONLINE_PROGRAMMES_URL || '';

  // --- WhatsApp + Meta run after the response, so the website never waits on them ---
  after(async () => {
    if (s.canSendEvents && metaConfigured()) {
      const events = s.metaEvents.map((evt) => buildEvent(leadForMeta, evt, { eventKey: pKey, extra: { lead_intent: clean(b.intent) || 'apply' } }));
      const r = await sendMetaEvents(events);
      await logSystem(leadId, 'meta_event', r.ok ? `Meta: ${s.metaEvents.join(', ')} sent` : `Meta: ${s.metaEvents.join(', ')} failed — ${r.detail}`,
        { events: s.metaEvents, ok: r.ok, detail: r.detail });
    }
    if (s.canMessage && interaktConfigured()) {
      const template = s.tier === 'Hot' ? 'qura_hot_v1' : s.tier === 'Warm' ? 'qura_warm_v1' : 'qura_nurture_v1';
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count: recent } = await db.from('activities').select('id', { count: 'exact', head: true })
        .eq('lead_id', leadId).eq('type', 'whatsapp').eq('summary', `WhatsApp ${template} sent`).gte('occurred_at', since);
      if (recent) {
        await logSystem(leadId, 'whatsapp', `WhatsApp ${template} not sent again — already sent in the last 24 hours`);
      } else if (template === 'qura_hot_v1' && !nextUrl) {
        await logSystem(leadId, 'whatsapp', 'WhatsApp qura_hot_v1 not sent — APPLICATION_URL is not set');
      } else {
        const values = template === 'qura_hot_v1' ? [firstName(personName), nextUrl] : [firstName(personName)];
        const r = await sendTemplate({ phoneLocal: s.phone.local, templateName: template, bodyValues: values, callbackData: code });
        await logSystem(leadId, 'whatsapp', r.ok ? `WhatsApp ${template} sent` : `WhatsApp ${template} failed — ${r.detail}`,
          { template, ok: r.ok, detail: r.detail });
      }
    }
  });

  return NextResponse.json(
    {
      ok: true,
      lead_id: code,
      tier: s.tier.toLowerCase(),
      fire_lead: s.metaEvents.includes('Lead'),
      lead_event_id: eventIdFor('Lead', pKey),
      next_url: nextUrl,
    },
    { headers },
  );
}
