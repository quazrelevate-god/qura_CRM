'use client';

import { useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { OPS, fieldDef, opDef, isComplete, type Cond, type FieldDef, type Match } from '@/lib/leadFilters';

type Props = {
  fields: FieldDef[];          // with options filled in for choice fields
  initial: Cond[];
  initialMatch: Match;
  sort: string;
  keep: Record<string, string>; // other URL params to keep (view, q, all)
};

const SORTS = [
  { value: '', label: 'Default order' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'followup', label: 'Follow-up due' },
  { value: 'score', label: 'Highest score' },
];

function blank(fields: FieldDef[]): Cond {
  const f = fields[0];
  return { f: f.key, o: OPS[f.type][0].key, v: '' };
}

/** "+ Add condition" rows of [Field] [Condition] [Value], applied with the Filter button. */
export default function FilterBuilder({ fields, initial, initialMatch, sort: initialSort, keep }: Props) {
  const router = useRouter();
  const [conds, setConds] = useState<Cond[]>(initial);
  const [match, setMatch] = useState<Match>(initialMatch);
  const [sort, setSort] = useState(initialSort);
  const [warn, setWarn] = useState('');
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));

  const update = (i: number, patch: Partial<Cond>) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const changeField = (i: number, key: string) => {
    const def = byKey[key] ?? fieldDef(key);
    update(i, { f: key, o: OPS[def.type][0].key, v: '', w: undefined });
  };
  const changeOp = (i: number, o: string) => {
    const def = byKey[conds[i].f];
    const input = opDef(def.type, o)?.input;
    const prev = conds[i];
    const v = input === 'many' ? (Array.isArray(prev.v) ? prev.v : prev.v ? [prev.v] : []) : Array.isArray(prev.v) ? prev.v[0] ?? '' : prev.v ?? '';
    update(i, { o, v, w: input === 'two' ? prev.w ?? '' : undefined });
  };

  function go(list: Cond[], m: Match, s: string) {
    const p = new URLSearchParams();
    Object.entries(keep).forEach(([k, v]) => { if (v) p.set(k, v); });
    if (list.length) {
      p.set('f', JSON.stringify(list));
      if (list.length > 1 && m === 'any') p.set('match', 'any');
    }
    if (s) p.set('sort', s);
    const qs = p.toString();
    router.push(qs ? `/leads?${qs}` : '/leads');
  }

  function apply() {
    const ready = conds.filter(isComplete);
    if (ready.length < conds.length) {
      setWarn('Finish or remove the conditions that are missing a value.');
      return;
    }
    setWarn('');
    go(ready, match, sort);
  }

  return (
    <div className="filterbox">
      <div className="filter-head">
        <strong>Filters</strong>
        {conds.length > 1 && (
          <select value={match} onChange={(e) => setMatch(e.target.value as Match)} aria-label="How conditions combine" style={{ width: 'auto' }}>
            <option value="all">Match all conditions</option>
            <option value="any">Match any condition</option>
          </select>
        )}
        {conds.length === 0 && <span className="muted small">No filters. Add a condition to narrow the list.</span>}
      </div>

      {conds.map((c, i) => {
        const def = byKey[c.f];
        if (!def) return null;
        const op = opDef(def.type, c.o) ?? OPS[def.type][0];
        return (
          <div className="cond-row" key={i}>
            <span className="cond-join">{i === 0 ? 'Where' : match === 'any' ? 'or' : 'and'}</span>
            <select value={c.f} onChange={(e) => changeField(i, e.target.value)} aria-label="Field">
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select value={op.key} onChange={(e) => changeOp(i, e.target.value)} aria-label="Condition">
              {OPS[def.type].map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <div className="cond-value">
              <ValueInput def={def} input={op.input} cond={c} onChange={(patch) => update(i, patch)} onEnter={apply} />
            </div>
            <button type="button" className="btn btn-sm cond-remove" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove condition">✕</button>
          </div>
        );
      })}

      <div className="filter-actions">
        <button type="button" className="btn btn-sm" onClick={() => setConds((cs) => [...cs, blank(fields)])}>+ Add condition</button>
        <span className="spacer" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" style={{ width: 'auto' }}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {(initial.length > 0 || conds.length > 0) && (
          <button type="button" className="btn btn-sm" onClick={() => { setConds([]); setWarn(''); go([], 'all', sort); }}>Clear filters</button>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={apply}>Filter</button>
      </div>
      {warn && <p className="small" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{warn}</p>}
    </div>
  );
}

function ValueInput({ def, input, cond, onChange, onEnter }: {
  def: FieldDef; input: string; cond: Cond; onChange: (p: Partial<Cond>) => void; onEnter: () => void;
}) {
  const one = typeof cond.v === 'string' ? cond.v : '';
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } };
  const kind = def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text';

  if (input === 'none') return <span className="muted small">—</span>;
  if (input === 'days') {
    return (
      <span className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="number" min={1} max={3650} value={one} onChange={(e) => onChange({ v: e.target.value })} onKeyDown={onKey} aria-label="Days" style={{ width: 90 }} />
        <span className="muted small">days</span>
      </span>
    );
  }
  if (input === 'two') {
    return (
      <span className="row" style={{ flexWrap: 'nowrap' }}>
        <input type={kind} value={one} onChange={(e) => onChange({ v: e.target.value })} onKeyDown={onKey} aria-label="From" />
        <span className="muted small">and</span>
        <input type={kind} value={cond.w ?? ''} onChange={(e) => onChange({ w: e.target.value })} onKeyDown={onKey} aria-label="To" />
      </span>
    );
  }
  if (def.type === 'choice' && input === 'many') {
    const picked = Array.isArray(cond.v) ? cond.v : [];
    const label = picked.length === 0 ? 'Choose…' : picked.length === 1 ? (def.options?.find((o) => o.value === picked[0])?.label ?? picked[0]) : `${picked.length} selected`;
    return (
      <details className="multi">
        <summary>{label}</summary>
        <div className="multi-list">
          {(def.options ?? []).map((o) => (
            <label key={o.value}>
              <input
                type="checkbox" checked={picked.includes(o.value)}
                onChange={(e) => onChange({ v: e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value) })}
              />
              {o.label}
            </label>
          ))}
        </div>
      </details>
    );
  }
  if (def.type === 'choice') {
    return (
      <select value={one} onChange={(e) => onChange({ v: e.target.value })} aria-label="Value">
        <option value="">Choose…</option>
        {(def.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return <input type={kind} value={one} onChange={(e) => onChange({ v: e.target.value })} onKeyDown={onKey} aria-label="Value" placeholder={def.type === 'text' ? 'Type a value' : ''} />;
}
