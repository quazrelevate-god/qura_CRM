'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { toLoginEmail } from '@/lib/login';

export async function signIn(formData: FormData) {
  const email = toLoginEmail(formData.get('email'));
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/login?error=missing');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect('/login?error=invalid');

  const { data: profile } = await supabase.from('profiles').select('active').eq('id', data.user.id).maybeSingle();
  if (!profile?.active) {
    await supabase.auth.signOut();
    redirect('/login?error=inactive');
  }
  redirect('/leads');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
