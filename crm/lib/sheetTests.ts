// Rows the team used for testing the website forms — never imported into the CRM.
import type { SheetRow } from './sheetImport';

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const TEST_EMAILS = new Set([
  'rubancsaravanan@gmail.com', 'admin@leveluplearning.in', 'admin@admin.in', 'admin@levelup.in',
  'gracykennedy77@gmail.com', 'gracykennedy77@gmail.co', 'kennedy111170@gmail.com', 'boopalan@gmail.com',
]);
const TEST_PHONES = new Set(['9876543212', '9999999999', '0000000000', '9840247628', '9962163389']);

export function testReason(r: SheetRow): string | null {
  const email = clean(r.email).toLowerCase();
  const local = String(r.phone ?? '').replace(/\D/g, '').slice(-10);
  if (email.endsWith('@claude.local') || /\.test$/.test(email)) return 'test email';
  if (TEST_EMAILS.has(email) || /@(leveluplearning\.in|levelup\.in|qurafilm\.com)$/.test(email)) return 'team email';
  if (local.length === 10 && (TEST_PHONES.has(local) || /^9000000\d{3}$/.test(local))) return 'team phone';
  const texts = [r.status, r.about, r.f1, r.f2, r.f3, r.f4, ...(r.notes ?? []).map((n) => n.text)].map(clean);
  if (texts.some((t) => /^test(ing)?\.?$/i.test(t))) return 'marked Testing';
  if (/^test$/i.test(clean(r.form))) return 'test form';
  if (/^(zzz )?(claude )?test\b|^test(ing)?$|\btesting\b|\b(e2e|cors|connectivity)\b.*\btest\b/i.test(clean(r.name))) return 'test name';
  return null;
}
