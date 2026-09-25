import Link from 'next/link';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { metaConfigured } from '@/lib/meta';
import { displayLogin } from '@/lib/login';
import { listWaTemplates } from '@/lib/waTemplates';
import { templateVars, varLabel, KNOWN_VARS } from '@/lib/waVars';
import WaTemplateEditor from '@/components/WaTemplateEditor';
import { addMember, updateMember, resetPassword, saveWaTemplate, deleteWaTemplate } from './actions';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const me = await requireAdmin();
  const supabase = await createClient();
  const [{ data: members }, { templates, error: waError }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at'),
    listWaTemplates(),
  ]);
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'your-crm.vercel.app';
  const base = `https://${host}`;

  const integrations: [string, boolean, string][] = [
    ['Website form intake', true, `${base}/api/intake`],
    ['Application link (Hot leads)', !!process.env.APPLICATION_URL, process.env.APPLICATION_URL || 'Set APPLICATION_URL'],
    ['Online programmes link', !!process.env.ONLINE_PROGRAMMES_URL, process.env.ONLINE_PROGRAMMES_URL || 'Set ONLINE_PROGRAMMES_URL'],
    ['WhatsApp', true, `${templates.length} template${templates.length === 1 ? '' : 's'} · opens WhatsApp with the message as a draft (no API key needed)`],
    ['Meta Conversions API', metaConfigured(), metaConfigured() ? `Dataset ${process.env.META_PIXEL_ID}${process.env.META_TEST_EVENT_CODE ? ' · TEST MODE (events go to Test Events only)' : ''}` : 'Set META_ACCESS_TOKEN'],
    ['Razorpay webhook', !!process.env.RAZORPAY_WEBHOOK_SECRET, process.env.RAZORPAY_WEBHOOK_SECRET ? `${base}/api/webhooks/razorpay` : 'Set RAZORPAY_WEBHOOK_SECRET'],
  ];

  return (
    <>
      <div className="page-head"><h1>Team &amp; settings</h1></div>
      {ok && <div className="notice ok">{ok}</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="grid-2">
        <form className="card" action={addMember}>
          <h2>Add a team member</h2>
          <div className="field"><label htmlFor="full_name">Name</label><input id="full_name" name="full_name" required /></div>
          <div className="field"><label htmlFor="email">Username or email (used to sign in)</label><input id="email" name="email" type="text" autoCapitalize="none" placeholder="e.g. ruban" required /></div>
          <div className="field"><label htmlFor="password">Temporary password (min 8 characters)</label><input id="password" name="password" minLength={8} required /></div>
          <div className="field">
            <label htmlFor="role">Role</label>
            <select id="role" name="role" defaultValue="rep"><option value="rep">Sales rep</option><option value="admin">Admin</option></select>
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} type="submit">Add member</button>
          <p className="muted small" style={{ marginBottom: 0 }}>Share the username and temporary password with them. They sign in at {base}. Change your own password with Reset on your row.</p>
        </form>

        <div className="card">
          <h2>Team</h2>
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Since</th><th></th></tr></thead>
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.id}>
                  <td><div className="name">{m.full_name}</div><div className="muted small">{displayLogin(m.email)}</div></td>
                  <td data-label="Role">
                    <form action={updateMember} className="row">
                      <input type="hidden" name="member_id" value={m.id} />
                      <input type="hidden" name="active" value={String(m.active)} />
                      <select name="role" defaultValue={m.role} disabled={m.id === me.id} style={{ width: 'auto' }}>
                        <option value="rep">Rep</option><option value="admin">Admin</option>
                      </select>
                      {m.id !== me.id && <button className="btn btn-sm" type="submit">Save</button>}
                    </form>
                  </td>
                  <td data-label="Status">
                    {m.id === me.id ? <span className="badge stage-won">Active (you)</span> : (
                      <form action={updateMember}>
                        <input type="hidden" name="member_id" value={m.id} />
                        <input type="hidden" name="role" value={m.role} />
                        <input type="hidden" name="active" value={String(!m.active)} />
                        <button className="btn btn-sm" type="submit">{m.active ? 'Deactivate' : 'Activate'}</button>
                        {!m.active && <span className="badge flag" style={{ marginLeft: 6 }}>Inactive</span>}
                      </form>
                    )}
                  </td>
                  <td data-label="Since" className="nowrap">{fmtDate(m.created_at)}</td>
                  <td>
                    <form action={resetPassword} className="row">
                      <input type="hidden" name="member_id" value={m.id} />
                      <input name="password" placeholder="New password" minLength={8} required style={{ width: 130 }} />
                      <button className="btn btn-sm" type="submit">Reset</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" id="whatsapp-templates" style={{ marginTop: 16 }}>
        <h2>WhatsApp templates</h2>
        <p className="small" style={{ marginTop: 0 }}>
          On a lead, pick a template and WhatsApp opens with the message typed in, ready to send from your own WhatsApp.
          Put a variable in double curly brackets, like <code>{'{{first_name}}'}</code>. Each variable becomes a box on the lead page.
          These fill in by themselves from the lead: {Object.keys(KNOWN_VARS).map((v, i) => <span key={v}>{i ? ', ' : ''}<code>{`{{${v}}}`}</code></span>)}.
          Anything else, like <code>{'{{time}}'}</code>, is a box you type in.
        </p>
        {waError && <div className="notice error">Could not load the templates: {waError}</div>}
        <div className="grid-2">
          <div>
            <h3>Add a template</h3>
            <WaTemplateEditor action={saveWaTemplate} submitLabel="Add template" />
          </div>
          <div>
            <h3>Saved templates <span className="muted" style={{ fontWeight: 400 }}>{templates.length}</span></h3>
            {templates.length === 0 ? <p className="muted">None yet. Add your first one on the left.</p> : (
              <ul className="wa-list">
                {templates.map((t) => (
                  <li key={t.id}>
                    <div className="wa-name">{t.name}</div>
                    <div className="wa-body">{t.body}</div>
                    {templateVars(t.body).length > 0 && (
                      <div className="wa-vars">
                        {templateVars(t.body).map((v) => <span key={v} className={`chip ${KNOWN_VARS[v] ? 'chip-auto' : ''}`}>{varLabel(v)}{KNOWN_VARS[v] ? ' · auto' : ''}</span>)}
                      </div>
                    )}
                    <div className="wa-actions">
                      <details>
                        <summary className="btn btn-sm">Edit</summary>
                        <WaTemplateEditor action={saveWaTemplate} template={t} submitLabel="Save changes" />
                      </details>
                      <details>
                        <summary className="btn btn-sm btn-danger">Delete</summary>
                        <form action={deleteWaTemplate} className="row" style={{ marginTop: 8 }}>
                          <input type="hidden" name="template_id" value={t.id} />
                          <span className="small">Delete &ldquo;{t.name}&rdquo; for everyone?</span>
                          <button className="btn btn-sm btn-danger" type="submit">Yes, delete</button>
                        </form>
                      </details>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Connections</h2>
        <table className="table">
          <tbody>
            {integrations.map(([name, okFlag, detail]) => (
              <tr key={name}>
                <td className="name" style={{ width: 240 }}>{name}</td>
                <td style={{ width: 90 }}><span className={`badge ${okFlag ? 'stage-won' : 'flag'}`}>{okFlag ? 'On' : 'Off'}</span></td>
                <td className="mono">{detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginBottom: 0 }}>Keys live in Vercel → qura-crm → Settings → Environment Variables. Redeploy after changing them.</p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Import leads from the Google Sheet</h2>
        <p className="small">Upload the Excel download of “QURA Form Submissions” to bring in new rows. Duplicates are merged, nobody is added twice, and stages your team set here are kept.</p>
        <Link className="btn btn-primary" href="/import">Import from Google Sheet →</Link>
      </div>
    </>
  );
}
