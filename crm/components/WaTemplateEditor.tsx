'use client';

import { useState } from 'react';
import { templateVars, varLabel, KNOWN_VARS } from '@/lib/waVars';

type Props = {
  action: (fd: FormData) => void | Promise<void>;
  template?: { id: string; name: string; body: string };
  submitLabel: string;
};

/** Name + message for a WhatsApp template, with the variables it finds shown as you type. */
export default function WaTemplateEditor({ action, template, submitLabel }: Props) {
  const [body, setBody] = useState(template?.body ?? '');
  const vars = templateVars(body);
  const uid = template?.id ?? 'new';

  return (
    <form action={action} className="wa-editor">
      {template && <input type="hidden" name="template_id" value={template.id} />}
      <div className="field">
        <label htmlFor={`tn-${uid}`}>Template name</label>
        <input id={`tn-${uid}`} name="template_name" required maxLength={60} defaultValue={template?.name ?? ''} placeholder="e.g. First call follow-up" />
      </div>
      <div className="field">
        <label htmlFor={`tb-${uid}`}>Message</label>
        <textarea
          id={`tb-${uid}`} name="template_body" required maxLength={3000} rows={5}
          value={body} onChange={(e) => setBody(e.target.value)}
          placeholder={'Hi {{first_name}}, this is {{my_name}} from QURA Film Academy. Can we talk at {{time}}?'}
        />
      </div>
      <div className="wa-vars">
        {vars.length === 0 ? (
          <span className="muted small">No variables yet. Type one like {'{{first_name}}'} and it becomes a box on the lead page.</span>
        ) : (
          <>
            <span className="muted small">Boxes on the lead page:</span>
            {vars.map((v) => (
              <span key={v} className={`chip ${KNOWN_VARS[v] ? 'chip-auto' : ''}`} title={KNOWN_VARS[v] ? 'Filled in from the lead' : 'Typed by the rep'}>
                {varLabel(v)}{KNOWN_VARS[v] ? ' · auto' : ''}
              </span>
            ))}
          </>
        )}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} type="submit">{submitLabel}</button>
    </form>
  );
}
