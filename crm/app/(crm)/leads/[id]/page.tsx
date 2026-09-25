import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth';
import { STAGES, LOST_REASONS, CALL_OUTCOMES, ANSWER_LABELS, answerLabel, WON_STAGES } from '@/lib/constants';
import { fmtDateTime, fmtRelative, toIstInput, prettyPhone } from '@/lib/format';
import { applicationLink } from '@/lib/interakt';
import { listWaTemplates } from '@/lib/waTemplates';
import WhatsAppCard from '@/components/WhatsAppCard';
import { metaConfigured } from '@/lib/meta';
import { updateLead, logCall, addNote, logWhatsAppDraft, updateDetails, setFlags, resendMeta } from './actions';

export const dynamic = 'force-dynamic';

const ICONS: Record<string, string> = {
  created: '✦', submission: '📝', note: '💬', call: '📞', stage_change: '➜', owner_change: '👤',
  follow_up: '⏰', lost_reason: '✖', tier_change: '★', whatsapp: '🟢', meta_event: 'Ⓜ', field_change: '✎',
  import_note: '📄', system: '⚙',
};

type Activity = { id: number; type: string; summary: string; occurred_at: string; actor: { full_name: string } | null };
type Submission = { id: number; submitted_at: string; origin: string; form_type: string | null; intent: string | null; message: string | null };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const { ok, error } = await searchParams;
  const me = await requireMember();
  const supabase = await createClient();

  const [{ data: lead }, { data: acts }, { data: subs }, { data: owners }, wa] = await Promise.all([
    supabase.from('leads').select('*').eq('id', id).maybeSingle(),
    supabase.from('activities').select('id, type, summary, occurred_at, actor:profiles!activities_actor_id_fkey(full_name)').eq('lead_id', id).order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(500),
    supabase.from('submissions').select('id, submitted_at, origin, form_type, intent, message').eq('lead_id', id).order('submitted_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, email, active').eq('active', true).order('full_name'),
    listWaTemplates(),
  ]);
  if (!lead) notFound();

  const activities = (acts ?? []) as unknown as Activity[];
  const submissions = (subs ?? []) as Submission[];
  const phoneLocal = String(lead.phone ?? '').replace(/^91/, '');
  const stageClass = lead.stage === 'Lost' ? 'stage-lost' : WON_STAGES.includes(lead.stage) ? 'stage-won' : 'stage';
  const overdue = lead.next_follow_up_at && new Date(lead.next_follow_up_at).getTime() < Date.now();
  const legacy = (lead.legacy ?? {}) as Record<string, unknown>;
  const metaSent = (lead.meta_events ?? {}) as Record<string, string>;
  const answered = Object.keys(ANSWER_LABELS).some((k) => lead[k]);
  // Values the WhatsApp templates can fill in by themselves
  const known: Record<string, string> = Object.fromEntries(Object.entries({
    name: lead.full_name, first_name: String(lead.full_name ?? '').trim().split(/\s+/)[0], phone: lead.phone_valid ? prettyPhone(lead.phone) : '',
    email: lead.email, city: lead.city, state: lead.state, programme: lead.programme, lead_id: lead.lead_code,
    application_link: applicationLink(lead), my_name: me.full_name,
  }).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));

  return (
    <>
      <p className="small" style={{ margin: '0 0 8px' }}><Link href="/leads">← All leads</Link></p>
      {ok && <div className="notice ok">{ok}</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="lead-head">
        <div>
          <h1>
            {lead.full_name || '(no name)'}
            {lead.tier && <span className={`badge tier-${lead.tier}`}>{lead.tier}{lead.score !== null ? ` · ${lead.score}` : ''}</span>}
            <span className={`badge ${stageClass}`}>{lead.stage}</span>
            {lead.is_test && <span className="badge flag">Test</span>}
            {lead.archived && <span className="badge flag">Archived</span>}
          </h1>
          <div className="muted" style={{ marginTop: 4 }}>
            {lead.lead_code} · {prettyPhone(lead.phone)}{lead.email ? ` · ${lead.email}` : ''}{lead.city ? ` · ${lead.city}` : ''}{lead.state ? `, ${lead.state}` : ''}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>
            First seen {fmtDateTime(lead.first_seen_at)} · {lead.submissions_count} form{lead.submissions_count === 1 ? '' : 's'} · {lead.call_attempts} call attempt{lead.call_attempts === 1 ? '' : 's'}
            {lead.lost_reason ? ` · Lost: ${lead.lost_reason}` : ''}
          </div>
          {(lead.knockouts?.length > 0 || lead.flags?.length > 0) && (
            <div className="row" style={{ marginTop: 6 }}>
              {(lead.knockouts ?? []).map((k: string) => <span key={k} className="badge flag">{k}</span>)}
              {(lead.flags ?? []).map((f: string) => <span key={f} className="badge flag">{f}</span>)}
            </div>
          )}
        </div>
        {lead.phone_valid && (
          <div className="contact">
            <a className="btn btn-call" href={`tel:+91${phoneLocal}`}>📞 Call</a>
            <a className="btn btn-wa" href={`https://wa.me/91${phoneLocal}`} target="_blank" rel="noreferrer">WhatsApp chat</a>
          </div>
        )}
      </div>

      <div className="grid-2">
        {/* ---------------- left: actions ---------------- */}
        <div className="stack">
          <form className="card" action={updateLead}>
            <h2>Stage, owner &amp; follow-up</h2>
            {/* Pressing Enter in a box never saves: only the Save and quick buttons do */}
            <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />
            {/* Never name a form field "id": it hides form.id, and React then drops the clicked button's value */}
            <input type="hidden" name="lead_id" value={lead.id} />
            <div className="field">
              <label htmlFor="stage">Stage</label>
              <select id="stage" name="stage" defaultValue={lead.stage}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lost_reason">Lost reason (needed for Lost)</label>
              <select id="lost_reason" name="lost_reason" defaultValue={lead.lost_reason ?? ''}>
                <option value="">—</option>
                {LOST_REASONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="owner_id">Owner</label>
              <select id="owner_id" name="owner_id" defaultValue={lead.owner_id ?? ''}>
                <option value="">Unassigned</option>
                {(owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.full_name || o.email}{o.id === me.id ? ' (me)' : ''}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="next_follow_up_at">
                Next follow-up (IST){lead.next_follow_up_at && <span className={overdue ? 'due-over' : ''}> · {fmtRelative(lead.next_follow_up_at)}</span>}
              </label>
              <input id="next_follow_up_at" name="next_follow_up_at" type="datetime-local" defaultValue={toIstInput(lead.next_follow_up_at)} />
            </div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} type="submit">Save</button>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted small">Quick follow-up:</span>
              <button className="btn btn-sm" name="quick" value="2h">+2 hours</button>
              <button className="btn btn-sm" name="quick" value="tomorrow">Tomorrow 11am</button>
              <button className="btn btn-sm" name="quick" value="3d">In 3 days</button>
              <button className="btn btn-sm" name="quick" value="1w">Next week</button>
              <button className="btn btn-sm" name="quick" value="clear">Clear</button>
            </div>
            <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
              Moving to Fee paid, Interview scheduled or Enrolled also tells Meta{metaConfigured() ? '.' : ' (once Meta is connected).'}
            </p>
          </form>

          <form className="card" action={logCall}>
            <h2>Log a call</h2>
            {/* blocks "Enter" from submitting an outcome by accident */}
            <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />
            <input type="hidden" name="lead_id" value={lead.id} />
            <div className="field">
              <label htmlFor="call-note">What happened? (optional)</label>
              <textarea id="call-note" name="note" placeholder="e.g. Spoke to his father, will decide after exams" />
            </div>
            <div className="field">
              <label htmlFor="follow_up">Set next follow-up (optional)</label>
              <input id="follow_up" name="follow_up" type="datetime-local" />
            </div>
            <div className="outcomes" style={{ marginTop: 10 }}>
              {CALL_OUTCOMES.map((o) => (
                <button key={o.value} className={`btn ${o.value === 'connected' ? 'btn-primary' : ''} ${o.value === 'wrong_number' ? 'btn-danger' : ''}`} name="outcome" value={o.value}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
              Logging a call never changes the follow-up unless you pick a time above. The third missed call moves the lead to Not reachable. Wrong number moves it to Lost.
            </p>
          </form>

          <form className="card" action={addNote}>
            <h2>Add a note</h2>
            <input type="hidden" name="lead_id" value={lead.id} />
            <textarea name="note" required placeholder="Anything the next person should know" />
            <button className="btn btn-block" style={{ marginTop: 8 }} type="submit">Add note</button>
          </form>

          <WhatsAppCard
            leadId={lead.id} phone={lead.phone} phoneValid={!!lead.phone_valid}
            templates={wa.templates.map(({ id, name, body }) => ({ id, name, body }))}
            known={known} isAdmin={me.role === 'admin'} logDraft={logWhatsAppDraft}
          />

          <form className="card" action={updateDetails}>
            <h2>Contact details</h2>
            <input type="hidden" name="lead_id" value={lead.id} />
            <div className="field"><label htmlFor="full_name">Name</label><input id="full_name" name="full_name" defaultValue={lead.full_name} /></div>
            <div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" defaultValue={lead.phone ?? ''} /></div>
            <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" defaultValue={lead.email ?? ''} /></div>
            <div className="fields-2" style={{ marginTop: 10 }}>
              <div><label htmlFor="city">City</label><input id="city" name="city" defaultValue={lead.city ?? ''} /></div>
              <div><label htmlFor="state">State</label><input id="state" name="state" defaultValue={lead.state ?? ''} /></div>
            </div>
            <button className="btn btn-block" style={{ marginTop: 10 }} type="submit">Save details</button>
          </form>

          {me.role === 'admin' && (
            <div className="card">
              <h2>Admin</h2>
              <div className="row">
                <form action={setFlags}>
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <input type="hidden" name="field" value="archived" />
                  <input type="hidden" name="value" value={String(!lead.archived)} />
                  <button className="btn btn-sm" type="submit">{lead.archived ? 'Restore lead' : 'Archive lead'}</button>
                </form>
                <form action={setFlags}>
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <input type="hidden" name="field" value="is_test" />
                  <input type="hidden" name="value" value={String(!lead.is_test)} />
                  <button className="btn btn-sm" type="submit">{lead.is_test ? 'Not a test' : 'Mark as test'}</button>
                </form>
                <form action={resendMeta}>
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <button className="btn btn-sm" type="submit">Send missing Meta events</button>
                </form>
              </div>
              <p className="muted small" style={{ marginBottom: 0 }}>
                Meta events sent: {Object.keys(metaSent).length ? Object.entries(metaSent).map(([k, v]) => `${k} (${fmtDateTime(v)})`).join(', ') : 'none yet'}
              </p>
            </div>
          )}
        </div>

        {/* ---------------- right: history + info ---------------- */}
        <div className="stack">
          <div className="card">
            <h2>History <span className="muted" style={{ fontWeight: 400 }}>{activities.length}</span></h2>
            {activities.length === 0 ? <p className="muted">Nothing yet.</p> : (
              <ul className="timeline">
                {activities.map((a) => (
                  <li key={a.id}>
                    <div className="dot" aria-hidden>{ICONS[a.type] ?? '•'}</div>
                    <div>
                      <div className="body">{a.summary}</div>
                      <div className="meta">{a.actor?.full_name ?? 'System'} · {fmtDateTime(a.occurred_at)} · {fmtRelative(a.occurred_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2>Application answers</h2>
            {!answered && !lead.why ? <p className="muted">No answers yet. This lead came from the old forms.</p> : (
              <>
                <dl className="kv">
                  {Object.entries(ANSWER_LABELS).map(([k, meta]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{meta.label}</dt><dd>{answerLabel(k, lead[k])}</dd>
                    </div>
                  ))}
                  <dt>Portfolio</dt>
                  <dd>{lead.portfolio_link ? <a href={lead.portfolio_link} target="_blank" rel="noreferrer">{lead.portfolio_link}</a> : '—'}</dd>
                </dl>
                {lead.why && <><h3 style={{ margin: '12px 0 6px' }}>Why filmmaking, why now</h3><div className="why">{lead.why}</div></>}
              </>
            )}
          </div>

          <div className="card">
            <h2>Form submissions <span className="muted" style={{ fontWeight: 400 }}>{submissions.length}</span></h2>
            {submissions.length === 0 ? <p className="muted">None.</p> : (
              <ul className="timeline">
                {submissions.map((s) => (
                  <li key={s.id}>
                    <div className="dot" aria-hidden>📝</div>
                    <div>
                      <div><strong>{s.form_type ?? 'Form'}</strong>{s.intent ? ` · ${s.intent}` : ''} <span className="muted small">({s.origin === 'sheet_import' ? 'from Google Sheet' : s.origin})</span></div>
                      {s.message && <div className="body">{s.message}</div>}
                      <div className="meta">{fmtDateTime(s.submitted_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2>Source &amp; tracking</h2>
            <dl className="kv">
              <dt>Source</dt><dd>{lead.source ?? '—'}</dd>
              <dt>Intent</dt><dd>{lead.intent ?? '—'}</dd>
              <dt>utm_source</dt><dd>{lead.utm_source ?? '—'}</dd>
              <dt>utm_medium</dt><dd>{lead.utm_medium ?? '—'}</dd>
              <dt>utm_campaign</dt><dd>{lead.utm_campaign ?? '—'}</dd>
              <dt>utm_content</dt><dd>{lead.utm_content ?? '—'}</dd>
              <dt>utm_term</dt><dd>{lead.utm_term ?? '—'}</dd>
              <dt>Meta click (fbclid)</dt><dd className="mono">{lead.fbclid ?? '—'}</dd>
              <dt>Landing page</dt><dd className="mono">{lead.page_url ?? '—'}</dd>
              <dt>Last form</dt><dd>{fmtDateTime(lead.last_submission_at)}</dd>
            </dl>
          </div>

          {Object.keys(legacy).length > 0 && (
            <div className="card">
              <h2>Original Google Sheet values</h2>
              <dl className="kv">
                {Object.entries(legacy).map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{k}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{Array.isArray(v) ? v.join('\n') : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
