'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { toLoginEmail, displayLogin } from '@/lib/login';
import { listWaTemplates, saveWaTemplates } from '@/lib/waTemplates';
import { templateVars } from '@/lib/waVars';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const done = (msg: string, kind: 'ok' | 'error' = 'ok', anchor = ''): never => {
  revalidatePath('/team');
  redirect(`/team?${kind}=${encodeURIComponent(msg)}${anchor}`);
};
const WA = '#whatsapp-templates';

export async function addMember(fd: FormData) {
  await requireAdmin();
  const name = str(fd, 'full_name');
  const email = toLoginEmail(str(fd, 'email'));
  const password = str(fd, 'password');
  const role = str(fd, 'role') === 'admin' ? 'admin' : 'rep';
  if (!name || !email || password.length < 8) done('Name, username (or email) and an 8+ character password are required.', 'error');

  const db = adminClient();
  const { data, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name },
  });
  if (error || !data.user) done('Could not create the login: ' + (error?.message ?? 'unknown error'), 'error');

  const { error: perr } = await db.from('profiles').update({ full_name: name, role, active: true }).eq('id', data.user!.id);
  if (perr) done('Login created, but activating it failed: ' + perr.message, 'error');
  done(`${name} added. They sign in as "${displayLogin(email)}" with the temporary password.`);
}

export async function updateMember(fd: FormData) {
  const me = await requireAdmin();
  const id = str(fd, 'member_id');
  if (id === me.id) done("You can't change your own role or status.", 'error');
  const role = str(fd, 'role') === 'admin' ? 'admin' : 'rep';
  const active = str(fd, 'active') === 'true';
  const db = adminClient();
  const { error } = await db.from('profiles').update({ role, active }).eq('id', id);
  if (error) done('Update failed: ' + error.message, 'error');
  // a deactivated member is also signed out everywhere
  if (!active) await db.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  else await db.auth.admin.updateUserById(id, { ban_duration: 'none' });
  done('Team member updated.');
}

export async function resetPassword(fd: FormData) {
  await requireAdmin();
  const id = str(fd, 'member_id');
  const password = str(fd, 'password');
  if (password.length < 8) done('Passwords need at least 8 characters.', 'error');
  const { error } = await adminClient().auth.admin.updateUserById(id, { password });
  if (error) done('Reset failed: ' + error.message, 'error');
  done('Password reset. Share the new password with them.');
}

export async function saveWaTemplate(fd: FormData) {
  await requireAdmin();
  const templateId = str(fd, 'template_id');
  const name = str(fd, 'template_name').replace(/\s+/g, ' ');
  const body = String(fd.get('template_body') ?? '').replace(/\r\n/g, '\n').trim();
  if (!name) done('Give the template a name.', 'error', WA);
  if (name.length > 60) done('Keep the template name under 60 characters.', 'error', WA);
  if (!body) done('Write the template message.', 'error', WA);
  if (body.length > 3000) done('Keep the message under 3,000 characters.', 'error', WA);

  const { templates, error } = await listWaTemplates();
  if (error) done('Could not load the saved templates, so nothing was changed: ' + error, 'error', WA);
  if (templates.some((t) => t.id !== templateId && t.name.toLowerCase() === name.toLowerCase())) {
    done(`There is already a template called "${name}". Pick another name.`, 'error', WA);
  }
  const now = new Date().toISOString();
  const existing = templates.find((t) => t.id === templateId);
  const next = existing
    ? templates.map((t) => (t.id === templateId ? { ...t, name, body, updated_at: now } : t))
    : [...templates, { id: crypto.randomUUID(), name, body, updated_at: now }];
  const saveError = await saveWaTemplates(next);
  if (saveError) done('Could not save the template: ' + saveError, 'error', WA);
  const vars = templateVars(body);
  done(`Template "${name}" ${existing ? 'updated' : 'added'}${vars.length ? ` with ${vars.length} variable${vars.length === 1 ? '' : 's'}` : ''}.`, 'ok', WA);
}

export async function deleteWaTemplate(fd: FormData) {
  await requireAdmin();
  const templateId = str(fd, 'template_id');
  const { templates, error } = await listWaTemplates();
  if (error) done('Could not load the saved templates, so nothing was changed: ' + error, 'error', WA);
  const gone = templates.find((t) => t.id === templateId);
  if (!gone) done('That template was already deleted.', 'ok', WA);
  const saveError = await saveWaTemplates(templates.filter((t) => t.id !== templateId));
  if (saveError) done('Could not delete the template: ' + saveError, 'error', WA);
  done(`Template "${gone!.name}" deleted.`, 'ok', WA);
}
