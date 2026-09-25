// QURA Film Academy — lead intake proxy (Vercel serverless, Node runtime).
//
// The browser posts the application JSON to this same-origin endpoint. On every
// valid submission this function FANS THE LEAD OUT to all destinations at once:
//   1. QURA CRM      (CRM_URL / PUBLIC_QURA_CRM_INTAKE_URL) -> Supabase `leads`
//   2. Google Sheet  (LEAD_SHEET, Apps Script web app)      -> master sheet
//   3. n8n -> TeleCRM (LEAD_N8N; set SEND_N8N=false to stop) -> legacy CRM
//
// The Sheet (and n8n) ALWAYS receive the lead, even when the CRM succeeds, so
// the spreadsheet stays a permanent backup while the CRM is the working system.
// When the CRM accepts the lead it returns { ok, lead_id, tier, fire_lead,
// lead_event_id, next_url }; we pass that back to the browser unchanged so the
// client can fire the Meta Lead pixel itself (only when fire_lead is true,
// de-duplicated against the CRM's own server-side CAPI event via lead_event_id).
// If the CRM is unreachable the client still gets a safe "warm" result and the
// Lead pixel stays off -- but the lead is already saved in the Sheet + n8n.

const CRM_URL = (process.env.PUBLIC_QURA_CRM_INTAKE_URL || 'https://qura-crm-one.vercel.app/api/intake').trim();

// Always-on backup destinations (identical to the legacy site.js lead pipeline).
const LEAD_SHEET = 'https://script.google.com/macros/s/AKfycbw8A3LHcRuLmZq5RlZd6fEgpOrQBvNGSqkyrNAU9uTgEa39zSOteoRJdurxNwDHKjaJKw/exec';
const LEAD_N8N = 'https://n8n.forgebylevelup.com/webhook/qura-lead-intake';
const SEND_N8N = true; // mirror to n8n -> TeleCRM too; set false to make the new CRM the only CRM.

const TIMEOUT_MS = 10000;

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

// Map the rich application payload onto the legacy lead shape so the existing
// Sheet columns and n8n flow keep working. Everything extra goes in `message`.
function toLegacy(d) {
  const summary = [
    d.current_status && ('Status: ' + d.current_status + (d.current_status === 'other' && d.current_status_other ? ' (' + d.current_status_other + ')' : '')),
    d.looking_for && ('Looking for: ' + d.looking_for + (d.looking_for === 'other' && d.looking_for_other ? ' (' + d.looking_for_other + ')' : '')),
    d.age_band && ('Age: ' + d.age_band),
    d.english && ('English: ' + d.english),
    d.relocate && ('Relocate: ' + d.relocate),
    d.start && ('Start: ' + d.start),
    d.fee_help && ('Fee help: ' + d.fee_help),
    d.fee_note && ('Fee note: ' + d.fee_note),
    d.focus && ('Craft: ' + d.focus + (d.focus === 'other' && d.focus_other ? ' (' + d.focus_other + ')' : '')),
    d.experience && ('Experience: ' + d.experience + (d.experience === 'other' && d.experience_other ? ' (' + d.experience_other + ')' : '')),
    d.portfolio_link && ('Portfolio: ' + d.portfolio_link),
    d.state && ('State: ' + d.state),
    d.intent && ('Intent: ' + d.intent)
  ].filter(Boolean).join(' · ');
  return {
    formType: d.intent || 'apply',
    name: d.full_name || '',
    email: d.email || '',
    phone: d.phone || '',
    message: [d.why || '', summary].filter(Boolean).join(' | '),
    city: d.city || '',
    programme: 'one-year-filmmaking',
    utm_source: d.utm_source || '', utm_medium: d.utm_medium || '',
    utm_campaign: d.utm_campaign || '', utm_content: d.utm_content || '',
    utm_term: d.utm_term || '', fbclid: d.fbclid || '',
    fbp: d.fbp || '', fbc: d.fbc || '',
    page: d.page_url || '', ts: new Date().toISOString()
  };
}

// Google Sheet + n8n. Never throws; resolves once both have been attempted.
async function sendBackup(d) {
  const legacy = toLegacy(d);
  const tasks = [];
  try {
    const body = new URLSearchParams();
    Object.keys(legacy).forEach((k) => body.append(k, legacy[k]));
    tasks.push(fetchWithTimeout(LEAD_SHEET, { method: 'POST', body: body }, TIMEOUT_MS).catch(() => {}));
  } catch (e) { /* ignore */ }
  if (SEND_N8N) {
    try {
      tasks.push(fetchWithTimeout(LEAD_N8N, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legacy)
      }, TIMEOUT_MS).catch(() => {}));
    } catch (e) { /* ignore */ }
  }
  try { await Promise.all(tasks); } catch (e) { /* ignore */ }
}

// QURA CRM. Returns the CRM's JSON when it accepts the lead, else null.
async function sendCRM(data) {
  if (!CRM_URL) return null;
  try {
    const r = await fetchWithTimeout(CRM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }, TIMEOUT_MS);
    if (r.ok) {
      let j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      if (j && j.ok) return j;
    }
  } catch (e) { /* treat as CRM miss */ }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const data = await readBody(req);

  // Honeypot: real people leave `website` empty. If filled, silently accept
  // and drop (no CRM, no backup, no Lead).
  if (data && typeof data.website === 'string' && data.website.trim() !== '') {
    res.status(200).json({ ok: true, tier: 'nurture', fire_lead: false, lead_id: '', lead_event_id: '', next_url: '' });
    return;
  }

  // Fan out to CRM + Sheet + n8n at the same time. Await all so the serverless
  // function is not frozen before the writes finish.
  const [crm] = await Promise.all([ sendCRM(data), sendBackup(data) ]);

  // Prefer the CRM's response (carries fire_lead / lead_event_id / next_url).
  if (crm) { res.status(200).json(crm); return; }

  // CRM missed, but the lead is already in the Sheet + n8n. Warm, pixel off.
  res.status(200).json({ ok: true, tier: 'warm', fire_lead: false, lead_id: '', lead_event_id: '', next_url: '', via: 'backup' });
};
