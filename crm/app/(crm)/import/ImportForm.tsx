'use client';

import { useActionState, startTransition } from 'react';
import Link from 'next/link';
import { importSheet, type ImportState } from './actions';

export default function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importSheet, null);

  return (
    <>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault(); // keep the chosen file between "Check" and "Import"
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          const fd = new FormData(e.currentTarget);
          fd.set('mode', submitter?.value ?? 'check');
          startTransition(() => action(fd));
        }}
      >
        <h2>Import leads from the Google Sheet</h2>
        <ol className="small" style={{ paddingLeft: 18, marginTop: 0 }}>
          <li>Open the Sheet “QURA Form Submissions” → <b>File → Download → Microsoft Excel (.xlsx)</b>.</li>
          <li>Choose that file below and click <b>Check file</b>. Nothing is saved yet — you’ll see what would change.</li>
          <li>Click <b>Import</b>. People already in the CRM are never duplicated: they only get the form entries and notes they don’t have yet, and a stage your team changed here is never overwritten. Safe to run again whenever the Sheet has new rows.</li>
        </ol>
        <div className="field">
          <label htmlFor="file">Excel file (.xlsx)</label>
          <input id="file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn" type="submit" name="mode" value="check" disabled={pending}>{pending ? 'Working…' : 'Check file'}</button>
          <button className="btn btn-primary" type="submit" name="mode" value="import" disabled={pending}>{pending ? 'Working…' : 'Import'}</button>
        </div>
        {pending && <p className="muted small" style={{ marginBottom: 0 }}>Reading the file and comparing it with the CRM… this can take up to a minute for a big sheet.</p>}
      </form>

      {state && 'error' in state && <div className="notice error" style={{ marginTop: 16 }}>{state.error}</div>}

      {state && !('error' in state) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>{state.mode === 'import' ? '✅ Imported' : 'Check — nothing saved yet'} · {state.fileName}</h2>
          <table className="table">
            <tbody>
              <tr><td>Rows read</td><td className="mono">{state.rowsRead} {state.tabs.map((t) => `· ${t.name}: ${t.rows}${t.copies ? ` (${t.copies} copies of rows in another tab, merged)` : ''}`).join(' ')}</td></tr>
              <tr><td>Test rows left out</td><td className="mono">{state.testRowsSkipped}</td></tr>
              <tr><td>People in the Sheet</td><td className="mono">{state.people}</td></tr>
              <tr><td>{state.mode === 'import' ? 'New leads added' : 'New leads to add'}</td><td className="mono"><b>{state.newLeads}</b></td></tr>
              <tr><td>Leads already in the CRM {state.mode === 'import' ? 'updated' : 'to update'}</td><td className="mono">{state.updatedLeads} (unchanged: {state.unchangedLeads})</td></tr>
              <tr><td>Form entries {state.mode === 'import' ? 'added' : 'to add'}</td><td className="mono">{state.newFormEntries}</td></tr>
              <tr><td>Sales notes {state.mode === 'import' ? 'added' : 'to add'}</td><td className="mono">{state.newNotes}</td></tr>
              <tr><td>Stages updated from new notes</td><td className="mono">{state.stageChanges}{state.keptManualStages ? ` · ${state.keptManualStages} kept because your team set them` : ''}</td></tr>
              <tr><td>Follow-ups set (high intent)</td><td className="mono">{state.followUpsSet}</td></tr>
              <tr><td>Stages of these people</td><td className="mono">{Object.entries(state.byStage).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ')}</td></tr>
            </tbody>
          </table>
          {state.mode === 'import' && <p><Link href="/leads">Go to Leads →</Link> · <Link href="/dashboard?range=all">Dashboard (all time) →</Link></p>}
          {state.mode === 'check' && <p className="muted small">Looks right? Click <b>Import</b> above (the file is still selected).</p>}
          {(state.warnings.length > 0 || state.readWarnings.length > 0) && (
            <details open><summary>Notes ({state.warnings.length + state.readWarnings.length})</summary>
              <ul className="small">{[...state.readWarnings, ...state.warnings].slice(0, 100).map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          <details><summary>Test rows left out ({state.testRows.length})</summary>
            <ul className="small">{state.testRows.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </details>
        </div>
      )}
    </>
  );
}
