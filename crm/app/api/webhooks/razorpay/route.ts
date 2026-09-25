import { NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { adminClient } from '@/lib/supabase/admin';
import { normPhone, leadCode } from '@/lib/phone';
import { afterStageChange, logSystem } from '@/lib/leads';
import { WON_STAGES, type Stage } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Razorpay → Settings → Webhooks → URL https://<crm>/api/webhooks/razorpay, event payment.captured, same secret as RAZORPAY_WEBHOOK_SECRET.
export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'Webhook secret not configured' }, { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const valid = signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return NextResponse.json({ ok: false, error: 'Bad signature' }, { status: 401 });

  const body = JSON.parse(raw);
  if (body.event !== 'payment.captured') return NextResponse.json({ ok: true, ignored: body.event });

  const p = body.payload?.payment?.entity ?? {};
  const feePaise = Number(process.env.APPLICATION_FEE_PAISE || 150000);
  if (Number(p.amount) !== feePaise) return NextResponse.json({ ok: true, ignored: `amount ${p.amount}` });

  const db = adminClient();
  const phone = normPhone(p.contact);
  const email = String(p.email ?? '').trim().toLowerCase();

  let lead: { id: string; stage: string } | null = null;
  if (phone.stored) {
    const { data } = await db.from('leads').select('id, stage').eq('phone', phone.stored).maybeSingle();
    lead = data;
  }
  if (!lead && email) {
    const { data } = await db.from('leads').select('id, stage').eq('email', email).order('created_at').limit(1).maybeSingle();
    lead = data;
  }

  if (!lead) {
    const { data, error } = await db.from('leads').insert({
      lead_code: leadCode(phone, email),
      full_name: String(p.notes?.name ?? p.notes?.full_name ?? '').trim() || email || phone.local,
      phone: phone.stored || null,
      phone_valid: phone.valid,
      email: email || null,
      source: 'Razorpay',
      stage: 'New',
    }).select('id, stage').single();
    if (error || !data) return NextResponse.json({ ok: false, error: 'Could not create lead' }, { status: 500 });
    lead = data;
    await logSystem(lead.id, 'created', 'Lead created from a Razorpay payment (no matching form entry)');
  }

  await logSystem(lead.id, 'system', `₹${(feePaise / 100).toLocaleString('en-IN')} application fee paid (Razorpay ${p.id})`, { payment_id: p.id, amount: p.amount });
  if (!WON_STAGES.includes(lead.stage as Stage)) {
    await db.from('leads').update({ stage: 'Fee paid' }).eq('id', lead.id);
  }
  await afterStageChange(lead.id, 'Fee paid', { eventKey: String(p.id) });
  return NextResponse.json({ ok: true });
}
