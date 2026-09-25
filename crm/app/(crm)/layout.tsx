import Link from 'next/link';
import { Suspense } from 'react';
import { requireMember } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import NavLinks from '@/components/NavLinks';
import NavProgress from '@/components/NavProgress';

export const dynamic = 'force-dynamic';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMember();
  return (
    <>
      <Suspense fallback={null}><NavProgress /></Suspense>
      <header className="topbar">
        <Link href="/leads" className="logo">QURA<span>CRM</span></Link>
        <NavLinks isAdmin={me.role === 'admin'} />
        <div className="me">
          <span className="who">{me.full_name || me.email}{me.role === 'admin' ? ' · admin' : ''}</span>
          <form action={signOut}>
            <button className="btn btn-sm" type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
