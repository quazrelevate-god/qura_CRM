import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type Member = { id: string; email: string; full_name: string; role: 'admin' | 'rep'; active: boolean };

/** The signed-in, active team member — or a redirect to the login page. */
export async function requireMember(): Promise<Member> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('id, email, full_name, role, active').eq('id', auth.user.id).maybeSingle();
  if (!profile || !profile.active) redirect('/login?error=inactive');
  return profile as Member;
}

export async function requireAdmin(): Promise<Member> {
  const m = await requireMember();
  if (m.role !== 'admin') redirect('/leads');
  return m;
}
