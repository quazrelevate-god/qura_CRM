// WhatsApp templates via Interakt.
export const interaktConfigured = () => !!process.env.INTERAKT_API_KEY;

export async function sendTemplate(opts: {
  phoneLocal: string;
  templateName: string;
  bodyValues: string[];
  callbackData?: string;
}): Promise<{ ok: boolean; detail: string }> {
  if (!interaktConfigured()) return { ok: false, detail: 'Interakt not configured' };
  if (!/^[6-9]\d{9}$/.test(opts.phoneLocal)) return { ok: false, detail: 'Invalid phone number' };
  try {
    const res = await fetch('https://api.interakt.ai/v1/public/message/', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${process.env.INTERAKT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        countryCode: '+91',
        phoneNumber: opts.phoneLocal,
        callbackData: opts.callbackData ?? '',
        type: 'Template',
        template: { name: opts.templateName, languageCode: 'en', bodyValues: opts.bodyValues },
      }),
    });
    const text = await res.text();
    return { ok: res.ok, detail: res.ok ? text.slice(0, 200) : `HTTP ${res.status}: ${text.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** The application link sent to Hot leads, pre-filled with their details. */
export function applicationLink(lead: { full_name?: string | null; email?: string | null; phone?: string | null; lead_code?: string | null }) {
  const base = process.env.APPLICATION_URL;
  if (!base) return '';
  const params = new URLSearchParams({
    name: lead.full_name ?? '',
    email: lead.email ?? '',
    phone: (lead.phone ?? '').replace(/^91/, ''),
    lead_id: lead.lead_code ?? '',
  });
  return `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`;
}
