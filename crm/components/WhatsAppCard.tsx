'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { templateVars, fillTemplate, varLabel, KNOWN_VARS, type WaTemplate } from '@/lib/waVars';

type Props = {
  leadId: string;
  phone: string | null;        // stored as 91XXXXXXXXXX
  phoneValid: boolean;
  templates: Pick<WaTemplate, 'id' | 'name' | 'body'>[];
  known: Record<string, string>; // values the CRM can fill in: name, first_name, city, my_name, ...
  isAdmin: boolean;
  logDraft: (leadId: string, templateName: string, message: string) => Promise<{ ok: boolean; error?: string }>;
};

const CUSTOM = '__custom';

/** Pick a template, fill its boxes, and open WhatsApp with the message ready to send. */
export default function WhatsAppCard({ leadId, phone, phoneValid, templates, known, isAdmin, logDraft }: Props) {
  const router = useRouter();
  const [choice, setChoice] = useState(templates.length ? '' : CUSTOM);
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [, startTransition] = useTransition();

  const template = templates.find((t) => t.id === choice);
  const vars = useMemo(() => (template ? templateVars(template.body) : []), [template]);
  const valueOf = (v: string) => values[`${choice}:${v}`] ?? known[v] ?? '';
  const message = template ? fillTemplate(template.body, Object.fromEntries(vars.map((v) => [v, valueOf(v)]))) : custom;
  const missing = vars.filter((v) => !valueOf(v).trim());
  const ready = phoneValid && !!phone && message.trim().length > 0 && missing.length === 0;
  const href = ready ? `https://wa.me/${phone}?text=${encodeURIComponent(message.trim())}` : undefined;

  function onOpen() {
    if (!ready) return;
    setNote('');
    // The link opens WhatsApp by itself; this only notes it in the lead's history.
    startTransition(async () => {
      const r = await logDraft(leadId, template?.name ?? '', message);
      setNote(r.ok ? 'WhatsApp opened with your message. Press send there.' : `WhatsApp opened, but the history note failed: ${r.error}`);
      router.refresh();
    });
  }

  return (
    <div className="card">
      <h2>Send on WhatsApp</h2>
      {!phoneValid && <div className="notice error">This lead has no valid WhatsApp number.</div>}
      <div className="field">
        <label htmlFor="wa-template">Template</label>
        <select id="wa-template" value={choice} onChange={(e) => { setChoice(e.target.value); setNote(''); }}>
          {templates.length > 0 && <option value="">Choose a template…</option>}
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value={CUSTOM}>No template: write my own</option>
        </select>
        {templates.length === 0 && (
          <p className="muted small" style={{ margin: '6px 0 0' }}>
            No templates yet.{isAdmin ? <> Add them in <Link href="/team#whatsapp-templates">Team &amp; settings → WhatsApp templates</Link>.</> : ' Ask an admin to add some in Team & settings.'}
          </p>
        )}
      </div>

      {template && vars.length > 0 && (
        <div className="wa-fields">
          {vars.map((v) => (
            <div className="field" key={`${choice}:${v}`}>
              <label htmlFor={`wa-${v}`}>{varLabel(v)}{KNOWN_VARS[v] && known[v] ? <span className="muted"> · {v === 'my_name' ? 'from your login' : 'from the lead'}</span> : ''}</label>
              <input
                id={`wa-${v}`} value={valueOf(v)} placeholder={`Type the ${varLabel(v).toLowerCase()}`}
                onChange={(e) => setValues((prev) => ({ ...prev, [`${choice}:${v}`]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      {choice === CUSTOM && (
        <div className="field">
          <label htmlFor="wa-custom">Message</label>
          <textarea id="wa-custom" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Type the message you want to send" />
        </div>
      )}

      {template && (
        <div className="field">
          <label>Preview</label>
          <div className="wa-preview">{message}</div>
        </div>
      )}

      {missing.length > 0 && <p className="muted small" style={{ margin: '10px 0 0' }}>Fill in: {missing.map(varLabel).join(', ')}</p>}
      <a
        className={`btn btn-wa btn-block${ready ? '' : ' is-disabled'}`} style={{ marginTop: 12 }}
        href={href} target="_blank" rel="noreferrer" aria-disabled={!ready} onClick={onOpen}
      >
        Open in WhatsApp
      </a>
      {note && <p className="muted small" style={{ margin: '8px 0 0' }}>{note}</p>}
    </div>
  );
}
