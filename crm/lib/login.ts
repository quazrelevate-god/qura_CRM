// Team members can sign in with a plain username (e.g. "admin") or an email.
// A username is stored in Supabase as <username>@crm.qurafilm.com — no emails are ever sent to it.
export const LOGIN_DOMAIN = 'crm.qurafilm.com';

export function toLoginEmail(input: unknown): string {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('@')) return s;
  return `${s.replace(/[^a-z0-9._-]/g, '')}@${LOGIN_DOMAIN}`;
}

export function displayLogin(email: string | null | undefined): string {
  const s = String(email ?? '');
  return s.endsWith(`@${LOGIN_DOMAIN}`) ? s.slice(0, -(LOGIN_DOMAIN.length + 1)) : s;
}
