import { createHash } from 'crypto';

const FAKE = ['9876543210', '9876543212', '1234567890', '0123456789'];

export type Phone = { local: string; full: string; valid: boolean; stored: string };

/** Normalise an Indian mobile number. `stored` is what goes in the database (91XXXXXXXXXX when valid). */
export function normPhone(raw: unknown): Phone {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  const valid = /^[6-9]\d{9}$/.test(d) && !/^(\d)\1{9}$/.test(d) && !FAKE.includes(d);
  return { local: d, full: valid ? '91' + d : '', valid, stored: valid ? '91' + d : d };
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Same lead code as the database default and the website scoring: 'Q' + 8 hex chars. */
export function leadCode(phone: Phone, email: string): string {
  const key = phone.full || email.toLowerCase() || String(Date.now());
  return 'Q' + sha256(key).slice(0, 8).toUpperCase();
}

export function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e);
}
