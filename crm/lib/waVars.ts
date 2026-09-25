// WhatsApp template variables, shared by the Team page editor and the lead page card.
// A variable is written in double curly brackets, e.g. {{first_name}}.

export type WaTemplate = { id: string; name: string; body: string; updated_at: string };

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** "First Name" / "first-name" / "first_name" all mean the same variable. */
export const normVar = (v: string) => v.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Variables in the order they first appear, without repeats. */
export function templateVars(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(VAR_RE)) {
    const v = normVar(m[1]);
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen;
}

export function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(VAR_RE, (_, v: string) => values[normVar(v)] ?? '');
}

/** Variables the CRM fills in by itself from the lead (and from the signed-in team member). */
export const KNOWN_VARS: Record<string, string> = {
  name: 'Full name',
  first_name: 'First name',
  phone: 'Phone',
  email: 'Email',
  city: 'City',
  state: 'State',
  programme: 'Programme',
  lead_id: 'Lead ID',
  application_link: 'Application link',
  my_name: 'Your name',
};

export const varLabel = (v: string) =>
  KNOWN_VARS[v] ?? v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
