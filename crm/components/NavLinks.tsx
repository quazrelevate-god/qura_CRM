'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const links = [
    { href: '/leads', label: 'Leads' },
    { href: '/leads/new', label: '+ New lead' },
    { href: '/dashboard', label: 'Dashboard' },
    ...(isAdmin ? [{ href: '/team', label: 'Team & settings' }] : []),
  ];
  return (
    <nav>
      {links.map((l) => {
        const active = l.href === '/leads' ? path === '/leads' || (/^\/leads\/[^/]+$/.test(path) && path !== '/leads/new') : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? 'active' : ''}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
