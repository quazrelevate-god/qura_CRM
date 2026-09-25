'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Props = {
  defaultValue: string;
  hidden: Record<string, string>; // f, match, sort, all — carried into the search URL
  clearHref: string;
};

/** Search bar with a pending "Searching…" state on the button so a click always looks like it took effect. */
export default function SearchBar({ defaultValue, hidden, clearHref }: Props) {
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The bar can look pending forever if the user navigates back. Reset on mount.
  useEffect(() => { setPending(false); }, []);

  return (
    <form
      className="searchbar"
      method="get"
      action="/leads"
      role="search"
      onSubmit={() => setPending(true)}
    >
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <input
        ref={inputRef}
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search all leads by name, email or phone number"
        aria-label="Search leads"
        autoComplete="off"
      />
      <button className="btn btn-primary" type="submit" disabled={pending} aria-live="polite">
        {pending ? 'Searching…' : 'Search'}
      </button>
      {defaultValue && (
        <Link
          className="btn"
          href={clearHref}
          onClick={() => setPending(true)}
        >
          Clear
        </Link>
      )}
    </form>
  );
}
