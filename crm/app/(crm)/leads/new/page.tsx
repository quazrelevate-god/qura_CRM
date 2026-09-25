import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth';
import { STAGES } from '@/lib/constants';
import { createLead } from './actions';

export const dynamic = 'force-dynamic';

const SOURCES = ['Phone enquiry', 'Walk-in', 'Instagram DM', 'WhatsApp', 'Referral', 'Event / workshop', 'Other'];

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const me = await requireMember();
  const supabase = await createClient();
  const { data: owners } = await supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name');

  return (
    <>
      <div className="page-head"><h1>New lead</h1></div>
      {error && <div className="notice error">{error}</div>}
      <form className="card" action={createLead} style={{ maxWidth: 640 }}>
        <div className="fields-2">
          <div><label htmlFor="full_name">Name *</label><input id="full_name" name="full_name" required /></div>
          <div><label htmlFor="phone">Phone (10 digits) *</label><input id="phone" name="phone" inputMode="tel" required /></div>
        </div>
        <div className="fields-2" style={{ marginTop: 10 }}>
          <div><label htmlFor="email">Email</label><input id="email" name="email" type="email" /></div>
          <div>
            <label htmlFor="source">How did they reach us?</label>
            <select id="source" name="source" defaultValue="Phone enquiry">
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="fields-2" style={{ marginTop: 10 }}>
          <div><label htmlFor="city">City</label><input id="city" name="city" /></div>
          <div><label htmlFor="state">State</label><input id="state" name="state" /></div>
        </div>
        <div className="fields-2" style={{ marginTop: 10 }}>
          <div>
            <label htmlFor="owner_id">Owner</label>
            <select id="owner_id" name="owner_id" defaultValue={me.id}>
              <option value="">Unassigned</option>
              {(owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.full_name || o.email}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="stage">Stage</label>
            <select id="stage" name="stage" defaultValue="New">
              {STAGES.filter((s) => s !== 'Lost').map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="note">Note</label>
          <textarea id="note" name="note" placeholder="What they asked about, when to call back…" />
        </div>
        <div className="field">
          <label htmlFor="follow_up">Next follow-up (IST)</label>
          <input id="follow_up" name="follow_up" type="datetime-local" />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14 }} type="submit">Add lead</button>
      </form>
    </>
  );
}
